/**
 * Cox partial-likelihood kernel: Efron ties, right censoring, strata and
 * piecewise covariates on (start, stop]. No imputation, automatic feature
 * selection, LLM arithmetic or engineering authority.
 *
 * This kernel alone DOES NOT close C7.14: source approval, canonical
 * persistence, diagnostics, calibration and workbench wiring remain needed.
 * Model-based covariance assumes independent physical lives and a suitable
 * proportional-hazards specification. It is not cluster-robust covariance.
 */
import type { CoxConditionalScenario } from "./cox-prediction.ts";
export const COX_KERNEL_VERSION = "cox-efron/1/draft";

export interface CoxInterval {
  id: string;
  /** Physical component life, not merely an asset or unit identifier. */
  subjectId: string;
  stratum: string;
  start: number;
  stop: number;
  failed: boolean;
  covariates: number[];
  /** Covariates must have been observed no later than interval start. */
  observedAt: number;
}

interface BaselinePoint {
  stratum: string;
  time: number;
  /** Post-event Efron cumulative hazard at the zero-covariate reference. */
  cumulativeHazard: number;
}

export type CoxResult =
  | {
      status: "refused";
      code: "invalid_input" | "not_identifiable" | "non_convergence";
      reason: string;
      kernelVersion: string;
      authority: "advisory_only";
    }
  | {
      status: "fitted";
      kernelVersion: string;
      authority: "advisory_only";
      coefficients: number[];
      covariateNames?: string[];
      covariance: number[][];
      standardErrors: number[];
      logLikelihood: number;
      iterations: number;
      subjects: number;
      failures: number;
      baseline: BaselinePoint[];
      phAssumptionValidated: false;
      limitations: string[];
      diagnostics?: CoxDiagnostics;
      conditionalScenario?: CoxConditionalScenario;
    };

export interface CoxScoreTest {
  statistic: number;
  degreesOfFreedom: number;
  pValue: number;
}
export type CoxDiagnostics =
  | { status: "refused"; reason: string; authority: "advisory_only" }
  | {
      status: "computed";
      diagnosticVersion: "cox-diagnostics/1/draft";
      authority: "advisory_only";
      clusterCount: number;
      clusteredCovariance: number[][];
      clusteredStandardErrors: number[];
      /** Efron infinitesimal-jackknife score residuals, in input row order. */
      scoreResiduals: number[][];
      clusterInfluences: Array<{ clusterId: string; dfbeta: number[] }>;
      phIdentity:
        | {
            status: "computed";
            covariates: CoxScoreTest[];
            global: CoxScoreTest;
          }
        | { status: "refused"; reason: string };
      limitations: string[];
    };

const vector = (p: number) => Array<number>(p).fill(0);
const matrix = (p: number) => Array.from({ length: p }, () => vector(p));
const dot = (a: number[], b: number[]) =>
  a.reduce((s, x, i) => s + x * b[i], 0);

/** Positive-definite information inversion. Refuse rather than pseudo-invert. */
function inverse(information: number[][]): number[][] | null {
  const p = information.length;
  const lower = matrix(p);
  for (let i = 0; i < p; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = information[i][j];
      for (let k = 0; k < j; k++) sum -= lower[i][k] * lower[j][k];
      if (i === j) {
        if (!Number.isFinite(sum) || sum <= 1e-8) return null;
        lower[i][j] = Math.sqrt(sum);
      } else lower[i][j] = sum / lower[j][j];
    }
  }
  const result = matrix(p);
  for (let column = 0; column < p; column++) {
    const y = vector(p);
    const x = vector(p);
    for (let i = 0; i < p; i++) {
      let sum = i === column ? 1 : 0;
      for (let j = 0; j < i; j++) sum -= lower[i][j] * y[j];
      y[i] = sum / lower[i][i];
    }
    for (let i = p - 1; i >= 0; i--) {
      let sum = y[i];
      for (let j = i + 1; j < p; j++) sum -= lower[j][i] * x[j];
      x[i] = sum / lower[i][i];
      result[i][column] = x[i];
    }
  }
  return result;
}

interface RiskSet {
  stratum: string;
  time: number;
  risk: CoxInterval[];
  deaths: CoxInterval[];
}

function likelihood(sets: Iterable<RiskSet>, beta: number[], p: number) {
  let value = 0;
  const score = vector(p);
  const information = matrix(p);
  const baseline: BaselinePoint[] = [];
  const cumulative = new Map<string, number>();
  for (const set of sets) {
    const eta = set.risk.map((row) => dot(row.covariates, beta));
    const shift = Math.max(...eta);
    let sum = 0;
    let tied = 0;
    const first = vector(p);
    const tiedFirst = vector(p);
    const second = matrix(p);
    const tiedSecond = matrix(p);
    const deaths = new Set(set.deaths.map((row) => row.id));
    set.risk.forEach((row, r) => {
      const weight = Math.exp(eta[r] - shift);
      const event = deaths.has(row.id);
      sum += weight;
      if (event) {
        tied += weight;
        value += eta[r];
      }
      for (let i = 0; i < p; i++) {
        first[i] += weight * row.covariates[i];
        if (event) {
          score[i] += row.covariates[i];
          tiedFirst[i] += weight * row.covariates[i];
        }
        for (let j = 0; j < p; j++) {
          const moment = weight * row.covariates[i] * row.covariates[j];
          second[i][j] += moment;
          if (event) tiedSecond[i][j] += moment;
        }
      }
    });
    let increment = 0;
    for (let k = 0; k < set.deaths.length; k++) {
      const fraction = k / set.deaths.length;
      const denominator = sum - fraction * tied;
      value -= Math.log(denominator) + shift;
      increment += Math.exp(-shift) / denominator;
      const mean = first.map(
        (x, i) => (x - fraction * tiedFirst[i]) / denominator,
      );
      for (let i = 0; i < p; i++) {
        score[i] -= mean[i];
        for (let j = 0; j < p; j++) {
          information[i][j] +=
            (second[i][j] - fraction * tiedSecond[i][j]) / denominator -
            mean[i] * mean[j];
        }
      }
    }
    const hazard = (cumulative.get(set.stratum) ?? 0) + increment;
    cumulative.set(set.stratum, hazard);
    baseline.push({
      stratum: set.stratum,
      time: set.time,
      cumulativeHazard: hazard,
    });
  }
  return { value, score, information, baseline };
}

function riskSets(rows: CoxInterval[]): RiskSet[] {
  const sets: RiskSet[] = [];
  for (const stratum of [...new Set(rows.map((row) => row.stratum))].sort()) {
    const times = [
      ...new Set(
        rows
          .filter((row) => row.stratum === stratum && row.failed)
          .map((row) => row.stop),
      ),
    ].sort((a, b) => a - b);
    for (const time of times) {
      const risk = rows.filter(
        (row) =>
          row.stratum === stratum && row.start < time && row.stop >= time,
      );
      sets.push({
        stratum,
        time,
        risk,
        deaths: risk.filter((row) => row.failed && row.stop === time),
      });
    }
  }
  return sets;
}

/** Chi-square upper tail for the supported 1–8 degrees of freedom.
 * Direct convergent gamma series/continued fraction, not a normal-tail proxy.
 */
export function coxScoreTailProbability(
  statistic: number,
  degrees: number,
): number {
  if (
    !Number.isFinite(statistic) ||
    statistic < 0 ||
    !Number.isInteger(degrees) ||
    degrees < 1 ||
    degrees > 8
  )
    return Number.NaN;
  if (statistic === 0) return 1;
  const a = degrees / 2;
  const x = statistic / 2;
  let gamma = degrees % 2 ? Math.sqrt(Math.PI) : 1;
  for (let s = degrees % 2 ? 0.5 : 1; s < a; s++) gamma *= s;
  const prefactor = Math.exp(a * Math.log(x) - x - Math.log(gamma));
  if (x < a + 1) {
    let term = 1 / a;
    let sum = term;
    for (let k = 1; k <= 1000; k++) {
      term *= x / (a + k);
      sum += term;
      if (Math.abs(term) <= Math.abs(sum) * 1e-15)
        return Math.max(0, Math.min(1, 1 - prefactor * sum));
    }
  } else {
    const floor = 1e-300;
    let b = x + 1 - a;
    let c = 1 / floor;
    let d = 1 / b;
    let h = d;
    for (let k = 1; k <= 1000; k++) {
      const numerator = -k * (k - a);
      b += 2;
      d = numerator * d + b;
      c = b + numerator / c;
      if (Math.abs(d) < floor) d = floor;
      if (Math.abs(c) < floor) c = floor;
      d = 1 / d;
      const delta = d * c;
      h *= delta;
      if (Math.abs(delta - 1) <= 1e-15)
        return Math.max(0, Math.min(1, prefactor * h));
    }
  }
  return Number.NaN; // Refuse numerical failure, never invent a p-value.
}

/** Formal PH identity-time score tests and Efron clustered uncertainty.
 * Asset clusters MUST be explicit canonical mappings, not guessed from IDs.
 * This diagnostic is independently witnessed against R survival 3.8.6.
 * A non-significant test does NOT prove PH or qualify a customer prediction.
 */
export function diagnoseCox(
  input: CoxInterval[],
  covariateNames: string[],
  clusterBySubject: ReadonlyMap<string, string>,
): CoxDiagnostics {
  const refused = (reason: string): CoxDiagnostics => ({
    status: "refused",
    reason,
    authority: "advisory_only",
  });
  const fit = fitCox(input, covariateNames);
  if (fit.status === "refused") return refused(fit.reason);
  return diagnoseFittedCox(input, covariateNames, clusterBySubject, fit);
}

export function fitCoxWithDiagnostics(
  input: CoxInterval[],
  covariateNames: string[],
  clusterBySubject: ReadonlyMap<string, string>,
): CoxResult {
  const fit = fitCox(input, covariateNames);
  return fit.status === "refused"
    ? fit
    : {
        ...fit,
        covariateNames: [...covariateNames],
        diagnostics: diagnoseFittedCox(
          input,
          covariateNames,
          clusterBySubject,
          fit,
        ),
      };
}

function diagnoseFittedCox(
  input: CoxInterval[],
  covariateNames: string[],
  clusterBySubject: ReadonlyMap<string, string>,
  fit: Extract<CoxResult, { status: "fitted" }>,
): CoxDiagnostics {
  const refused = (reason: string): CoxDiagnostics => ({
    status: "refused",
    reason,
    authority: "advisory_only",
  });
  if (!(clusterBySubject instanceof Map))
    return refused("Explicit canonical asset clusters are required.");
  const p = covariateNames.length;
  const subjects = new Set(input.map((row) => row.subjectId));
  if (
    clusterBySubject.size !== subjects.size ||
    [...subjects].some(
      (id) =>
        typeof clusterBySubject.get(id) !== "string" ||
        !clusterBySubject.get(id)!.trim(),
    )
  ) {
    return refused(
      "Every physical life needs exactly one non-empty canonical asset cluster; no subset is analysed.",
    );
  }
  const clusterIds = [...new Set(clusterBySubject.values())].sort();
  if (clusterIds.length < 2)
    return refused(
      "Clustered uncertainty cannot be estimated from a single independent asset cluster.",
    );
  const sets = riskSets(input);
  const residuals = input.map(() => vector(p));
  const rowIndex = new Map(input.map((row, i) => [row.id, i]));
  for (const set of sets) {
    const deaths = new Set(set.deaths.map((row) => row.id));
    const eta = set.risk.map((row) => dot(row.covariates, fit.coefficients));
    const shift = Math.max(...eta);
    const weights = eta.map((value) => Math.exp(value - shift));
    for (let k = 0; k < set.deaths.length; k++) {
      const fraction = k / set.deaths.length;
      const effective = weights.map(
        (weight, i) => weight * (deaths.has(set.risk[i].id) ? 1 - fraction : 1),
      );
      const denominator = effective.reduce((sum, value) => sum + value, 0);
      const mean = vector(p).map(
        (_, j) =>
          set.risk.reduce(
            (sum, row, i) => sum + effective[i] * row.covariates[j],
            0,
          ) / denominator,
      );
      set.risk.forEach((row, i) => {
        const residual = residuals[rowIndex.get(row.id)!];
        for (let j = 0; j < p; j++)
          residual[j] -=
            (effective[i] / denominator) * (row.covariates[j] - mean[j]);
      });
      for (const row of set.deaths) {
        const residual = residuals[rowIndex.get(row.id)!];
        for (let j = 0; j < p; j++)
          residual[j] += (row.covariates[j] - mean[j]) / set.deaths.length;
      }
    }
  }
  const clusterInfluences = clusterIds.map((clusterId) => {
    const score = vector(p);
    input.forEach((row, i) => {
      if (clusterBySubject.get(row.subjectId) === clusterId)
        residuals[i].forEach((value, j) => {
          score[j] += value;
        });
    });
    return { clusterId, dfbeta: fit.covariance.map((row) => dot(row, score)) };
  });
  const clusteredCovariance = matrix(p);
  for (const { dfbeta } of clusterInfluences)
    for (let i = 0; i < p; i++)
      for (let j = 0; j < p; j++)
        clusteredCovariance[i][j] += dfbeta[i] * dfbeta[j];
  const standardErrors = clusteredCovariance.map((row, i) => Math.sqrt(row[i]));
  const correlation = clusteredCovariance.map((row, i) =>
    row.map((value, j) => value / standardErrors[i] / standardErrors[j]),
  );
  if (
    !residuals.flat().every(Number.isFinite) ||
    !standardErrors.every((value) => Number.isFinite(value) && value > 0) ||
    !inverse(correlation)
  ) {
    return refused(
      "Clustered covariance is singular or numerically unresolvable; no precise-looking confidence is reported.",
    );
  }
  let phIdentity: Extract<
    CoxDiagnostics,
    { status: "computed" }
  >["phIdentity"] = {
    status: "refused",
    reason:
      "PH time interactions are not identifiable from the observed failure support.",
  };
  const failureTimes = input.filter((row) => row.failed).map((row) => row.stop);
  const timeMean = failureTimes.reduce(
    (sum, time) => sum + time / failureTimes.length,
    0,
  );
  const timeScale = Math.sqrt(
    failureTimes.reduce(
      (sum, time) => sum + (time - timeMean) ** 2 / failureTimes.length,
      0,
    ),
  );
  if (timeScale > 0 && Number.isFinite(timeScale)) {
    // Predictor/time scaling changes conditioning, not the declared identity
    // time score test. PH information conditions on all baseline coefficients.
    const means = vector(p).map((_, j) =>
      input.reduce((sum, row) => sum + row.covariates[j] / input.length, 0),
    );
    const scales = means.map((mean, j) =>
      Math.sqrt(
        input.reduce(
          (sum, row) => sum + (row.covariates[j] - mean) ** 2 / input.length,
          0,
        ),
      ),
    );
    function* augmented(): Generator<RiskSet> {
      for (const set of sets) {
        const time = (set.time - timeMean) / timeScale;
        const convert = (row: CoxInterval): CoxInterval => {
          const xs = row.covariates.map(
            (value, j) => (value - means[j]) / scales[j],
          );
          return {
            ...row,
            covariates: [...xs, ...xs.map((value) => value * time)],
          };
        };
        yield {
          ...set,
          risk: set.risk.map(convert),
          deaths: set.deaths.map(convert),
        };
      }
    }
    const evaluated = likelihood(
      augmented(),
      [...fit.coefficients.map((value, j) => value * scales[j]), ...vector(p)],
      2 * p,
    );
    const test = (interactions: number[]): CoxScoreTest | null => {
      const indices = [
        ...Array.from({ length: p }, (_, i) => i),
        ...interactions.map((i) => p + i),
      ];
      const information = indices.map((i) =>
        indices.map((j) => evaluated.information[i][j]),
      );
      const covariance = inverse(information);
      if (!covariance) return null;
      const score = [
        ...vector(p),
        ...interactions.map((i) => evaluated.score[p + i]),
      ];
      const statistic = dot(
        score,
        covariance.map((row) => dot(row, score)),
      );
      const pValue = coxScoreTailProbability(statistic, interactions.length);
      return Number.isFinite(statistic) &&
        statistic >= 0 &&
        Number.isFinite(pValue)
        ? { statistic, degreesOfFreedom: interactions.length, pValue }
        : null;
    };
    const covariates = Array.from({ length: p }, (_, i) => test([i]));
    const global = test(Array.from({ length: p }, (_, i) => i));
    if (
      global &&
      covariates.every((item): item is CoxScoreTest => item !== null)
    )
      phIdentity = { status: "computed", covariates, global };
  }
  return {
    status: "computed",
    diagnosticVersion: "cox-diagnostics/1/draft",
    authority: "advisory_only",
    clusterCount: clusterIds.length,
    clusteredCovariance,
    clusteredStandardErrors: clusteredCovariance.map((row, i) =>
      Math.sqrt(row[i]),
    ),
    scoreResiduals: residuals,
    clusterInfluences,
    phIdentity,
    limitations: [
      "The identity-time formal score test is one declared diagnostic, not proof of proportional hazards or an automatic model-acceptance threshold.",
      "PH score-test information is model-based, not adjusted for within-asset dependence; clustered coefficient covariance does not make these PH p-values cluster-robust.",
      "Clustered infinitesimal-jackknife covariance relies on genuinely independent asset clusters; sufficient clusters and engineering applicability still require review.",
      "Repeated physical lives remain clustered by their actual assets; no independence is invented from row identifiers.",
      "No predictive calibration, causal effect, PM interval, risk acceptance or return-to-service authority is established.",
    ],
  };
}

export function fitCox(
  input: CoxInterval[],
  covariateNames: string[],
): CoxResult {
  const refuse = (
    code: "invalid_input" | "not_identifiable" | "non_convergence",
    reason: string,
  ): CoxResult => ({
    status: "refused",
    code,
    reason,
    kernelVersion: COX_KERNEL_VERSION,
    authority: "advisory_only",
  });
  if (!Array.isArray(input) || !Array.isArray(covariateNames)) {
    return refuse(
      "invalid_input",
      "Exposure intervals and named covariates must be arrays.",
    );
  }
  const p = covariateNames.length;
  // Computational bounds, not sample-adequacy or engineering thresholds.
  if (
    !p ||
    p > 8 ||
    !input.length ||
    input.length > 2000 ||
    covariateNames.some((name) => typeof name !== "string" || !name.trim()) ||
    new Set(covariateNames).size !== p
  ) {
    return refuse(
      "invalid_input",
      "Provide 1–8 named covariates and 1–2000 complete exposure intervals.",
    );
  }
  const identities = new Set<string>();
  const lives = new Map<string, CoxInterval[]>();
  for (const row of input) {
    if (
      !row ||
      typeof row.id !== "string" ||
      !row.id.trim() ||
      typeof row.subjectId !== "string" ||
      !row.subjectId.trim() ||
      typeof row.stratum !== "string" ||
      !row.stratum.trim() ||
      identities.has(row.id) ||
      typeof row.failed !== "boolean" ||
      !Number.isFinite(row.start) ||
      !Number.isFinite(row.stop) ||
      row.start < 0 ||
      row.stop <= row.start ||
      !Number.isFinite(row.observedAt) ||
      row.observedAt < 0 ||
      row.observedAt > row.start ||
      !Array.isArray(row.covariates) ||
      row.covariates.length !== p ||
      !row.covariates.every(Number.isFinite)
    ) {
      return refuse(
        "invalid_input",
        "Missing, duplicate, non-finite, post-start covariates or invalid exposure interval; no rows were dropped.",
      );
    }
    identities.add(row.id);
    const life = lives.get(row.subjectId) ?? [];
    life.push(row);
    lives.set(row.subjectId, life);
  }
  for (const intervals of lives.values()) {
    const sorted = [...intervals].sort((a, b) => a.start - b.start);
    for (let i = 1; i < sorted.length; i++) {
      if (
        sorted[i].start !== sorted[i - 1].stop ||
        sorted[i - 1].failed ||
        sorted[i].stratum !== sorted[0].stratum
      ) {
        return refuse(
          "invalid_input",
          "A physical life must have contiguous nonoverlapping intervals, one terminal event and a stable stratum.",
        );
      }
    }
  }
  const failures = input.filter((row) => row.failed).length;
  if (!failures)
    return refuse(
      "not_identifiable",
      "No observed failures; covariate effects and baseline cannot be estimated.",
    );
  const means = vector(p);
  const scales = vector(p);
  for (let i = 0; i < p; i++) {
    means[i] = input.reduce(
      (sum, row) => sum + row.covariates[i] / input.length,
      0,
    );
    scales[i] = Math.sqrt(
      input.reduce(
        (sum, row) => sum + (row.covariates[i] - means[i]) ** 2 / input.length,
        0,
      ),
    );
    if (!(scales[i] > 0) || !Number.isFinite(scales[i])) {
      return refuse(
        "not_identifiable",
        "Constant or numerically unresolvable covariates are not identifiable.",
      );
    }
  }
  const rows = input.map((row) => ({
    ...row,
    covariates: row.covariates.map((x, i) => (x - means[i]) / scales[i]),
  }));
  const sets: RiskSet[] = [];
  for (const stratum of [...new Set(rows.map((row) => row.stratum))].sort()) {
    const times = [
      ...new Set(
        rows
          .filter((row) => row.stratum === stratum && row.failed)
          .map((row) => row.stop),
      ),
    ].sort((a, b) => a - b);
    if (!times.length)
      return refuse(
        "not_identifiable",
        "A requested stratum has no observed failures; its baseline cannot be estimated.",
      );
    for (const time of times) {
      const risk = rows.filter(
        (row) =>
          row.stratum === stratum && row.start < time && row.stop >= time,
      );
      sets.push({
        stratum,
        time,
        risk,
        deaths: risk.filter((row) => row.failed && row.stop === time),
      });
    }
  }
  let beta = vector(p);
  let current = likelihood(sets, beta, p);
  for (let iteration = 0; iteration < 100; iteration++) {
    const covariance = inverse(current.information);
    if (!covariance)
      return refuse(
        "not_identifiable",
        "Singular or vanishing information; check collinearity, risk sets and separation.",
      );
    const step = covariance.map((row) => dot(row, current.score));
    if (
      Math.max(...current.score.map(Math.abs)) < 1e-9 &&
      dot(current.score, step) < 1e-10
    ) {
      const coefficients = beta.map((b, i) => b / scales[i]);
      const originalCovariance = covariance.map((row, i) =>
        row.map((cell, j) => cell / scales[i] / scales[j]),
      );
      const adjustment = Math.exp(-dot(coefficients, means));
      const baseline = current.baseline.map((point) => ({
        ...point,
        cumulativeHazard: point.cumulativeHazard * adjustment,
      }));
      if (
        !coefficients.every(Number.isFinite) ||
        !baseline.every((point) => Number.isFinite(point.cumulativeHazard))
      ) {
        return refuse(
          "non_convergence",
          "Estimate or zero-covariate baseline exceeds representable numerical range.",
        );
      }
      return {
        status: "fitted",
        kernelVersion: COX_KERNEL_VERSION,
        authority: "advisory_only",
        coefficients,
        covariance: originalCovariance,
        standardErrors: originalCovariance.map((row, i) => Math.sqrt(row[i])),
        logLikelihood: current.value,
        iterations: iteration,
        subjects: lives.size,
        failures,
        baseline,
        phAssumptionValidated: false,
        limitations: [
          "Proportional hazards assumption and predictive calibration have not been validated by this fit.",
          "Model-based covariance assumes independent physical lives; repeated assets need governed clustering analysis.",
          "Associations are not causal effects and do not authorize maintenance, interval, risk or operating changes.",
          "No survival extrapolation beyond observed failure support is provided.",
        ],
      };
    }
    let accepted = false;
    for (let damping = 1; damping >= 1 / 4096; damping /= 2) {
      const candidate = beta.map((b, i) => b + damping * step[i]);
      // A numerical refusal, not clipping to a plausible engineering effect.
      if (candidate.some((b) => !Number.isFinite(b) || Math.abs(b) > 30))
        continue;
      const next = likelihood(sets, candidate, p);
      if (Number.isFinite(next.value) && next.value >= current.value - 1e-12) {
        beta = candidate;
        current = next;
        accepted = true;
        break;
      }
    }
    if (!accepted)
      return refuse(
        "non_convergence",
        "Partial-likelihood maximization failed; check separation or numerical conditioning.",
      );
  }
  return refuse(
    "non_convergence",
    "Partial likelihood did not converge within the bounded solver; no fit is published.",
  );
}
