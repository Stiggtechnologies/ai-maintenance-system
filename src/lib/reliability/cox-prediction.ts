import {
  fitCoxWithDiagnostics,
  type CoxInterval,
  type CoxResult,
} from "./cox.ts";
import {
  coxModelConfidenceBounds,
  type CoxModelConfidenceBounds,
} from "./cox-confidence.ts";

export interface CoxConditionalProfile {
  stratum: string;
  originHours: number;
  horizonHours: number;
  path: Array<{
    startHours: number;
    stopHours: number;
    covariates: number[];
    observedAtHours: number;
    availableAtHours: number;
    validThroughHours: number;
  }>;
  /** Derived by the server from exact independently reviewed canonical rows. */
  source?:
    | {
        kind?: "historical_life";
        eventId: number;
        overlayVersion: number;
        intervalIndex: number;
        evidenceItemIds: string[];
      }
    | {
        kind: "active_component";
        componentInstanceId: string;
        meterReadingId: string;
        asOf: string;
        overlayVersion: number;
        intervalIndex: number;
        evidenceItemIds: string[];
      };
}
export type CoxJointHazardUncertainty =
  | {
      status: "refused";
      uncertaintyVersion: "cox-joint-asset/1/draft";
      authority: "advisory_only";
      reason: string;
    }
  | {
      status: "computed";
      uncertaintyVersion: "cox-joint-asset/1/draft";
      authority: "advisory_only";
      method: "efron_full_asset_case_weight_influence";
      clusterCount: number;
      cumulativeHazardVariance: number;
      cumulativeHazardStandardError: number;
      clusterInfluences: Array<{ clusterId: string; influence: number }>;
      /** Optional for historical receipts; never reconstructed on read. */
      modelConfidenceBounds?: CoxModelConfidenceBounds;
      limitations: string[];
    };
export type CoxConditionalScenario =
  | {
      status: "refused";
      reason: string;
      scenarioVersion: "cox-conditional/1/draft";
      authority: "advisory_only";
    }
  | {
      status: "estimated";
      scenarioVersion: "cox-conditional/1/draft";
      authority: "advisory_only";
      liveAssetForecast: false;
      calibration: "unqualified";
      confidenceInterval: null;
      /** Optional for historical receipts; never recomputed on read. */
      predictionUncertainty?: CoxJointHazardUncertainty;
      profile: CoxConditionalProfile;
      cumulativeHazardIncrement: number;
      conditionalFailureProbability: number;
      conditionalSurvivalProbability: number;
      eventTimesInWindow: number;
      limitations: string[];
    };
export type CoxScenarioRequest = CoxConditionalProfile | { refusal: string };

/** One fit over the exact complete population; never trust browser model output.
 * Numerical scenarios remain distinct from a qualified live-asset forecast.
 */
export function analyseCoxSurvival(
  rows: CoxInterval[],
  names: string[],
  clusters: ReadonlyMap<string, string>,
  request?: CoxScenarioRequest,
): CoxResult {
  const fit = fitCoxWithDiagnostics(rows, names, clusters);
  if (fit.status !== "fitted" || request === undefined) return fit;
  const refused = (reason: string): CoxConditionalScenario => ({
    status: "refused",
    reason,
    scenarioVersion: "cox-conditional/1/draft",
    authority: "advisory_only",
  });
  if (!request || typeof request !== "object" || Array.isArray(request))
    return {
      ...fit,
      conditionalScenario: refused(
        "The conditional scenario request must be an explicit measured profile.",
      ),
    };
  return {
    ...fit,
    conditionalScenario:
      "refusal" in request
        ? refused(
            typeof request.refusal === "string" && request.refusal.trim()
              ? request.refusal
              : "The source scenario has no valid refusal rationale or measured profile.",
          )
        : estimate(rows, fit, clusters, request, refused),
  };
}

function estimate(
  rows: CoxInterval[],
  fit: Extract<CoxResult, { status: "fitted" }>,
  clusters: ReadonlyMap<string, string>,
  profile: CoxConditionalProfile,
  refused: (reason: string) => CoxConditionalScenario,
): CoxConditionalScenario {
  const p = fit.coefficients.length;
  if (
    !profile ||
    typeof profile.stratum !== "string" ||
    !profile.stratum.trim() ||
    !Number.isFinite(profile.originHours) ||
    profile.originHours < 0 ||
    !Number.isFinite(profile.horizonHours) ||
    profile.horizonHours <= profile.originHours ||
    !Array.isArray(profile.path) ||
    !profile.path.length ||
    profile.path.length > 50
  )
    return refused(
      "State an explicit stratum, positive conditional window and complete measured covariate path.",
    );
  const cohort = rows.filter((row) => row.stratum === profile.stratum);
  const failures = cohort.filter((row) => row.failed);
  if (
    !failures.length ||
    profile.originHours < Math.min(...cohort.map((row) => row.start)) ||
    profile.horizonHours > Math.max(...failures.map((row) => row.stop))
  )
    return refused(
      "The conditional window is outside this stratum's observed failure support; no extrapolation is provided.",
    );
  let next = profile.originHours;
  for (const interval of profile.path) {
    if (
      !interval ||
      interval.startHours !== next ||
      !Number.isFinite(interval.stopHours) ||
      interval.stopHours <= interval.startHours ||
      interval.stopHours > profile.horizonHours ||
      !Array.isArray(interval.covariates) ||
      interval.covariates.length !== p ||
      !interval.covariates.every(Number.isFinite) ||
      !Number.isFinite(interval.observedAtHours) ||
      interval.observedAtHours < 0 ||
      !Number.isFinite(interval.availableAtHours) ||
      interval.availableAtHours < interval.observedAtHours ||
      interval.availableAtHours > profile.originHours ||
      !Number.isFinite(interval.validThroughHours) ||
      interval.validThroughHours < interval.stopHours
    )
      return refused(
        "The complete path needs contiguous coverage and measurements already available at origin with explicit validity through each interval; no future measurements or carry-forward defaults.",
      );
    if (
      !cohort.some((row) =>
        row.covariates.every((value, j) => value === interval.covariates[j]),
      )
    )
      return refused(
        "The joint covariate profile is not observed in the declared stratum; engineering applicability is not inferred from marginal ranges.",
      );
    next = interval.stopHours;
  }
  if (next !== profile.horizonHours)
    return refused(
      "The measured path does not cover the entire conditional window.",
    );
  const times = [...new Set(failures.map((row) => row.stop))]
    .filter(
      (time) => time > profile.originHours && time <= profile.horizonHours,
    )
    .sort((a, b) => a - b);
  let hazard = 0;
  // Differentiate the SAME Efron increments used by the point scenario.
  // Aggregate all path pieces before squaring, preserving cross-piece and
  // baseline/coefficient covariance within each canonical physical asset.
  const gradient = Array<number>(p).fill(0);
  const direct = new Map<string, number>();
  for (const time of times) {
    const interval = profile.path.find(
      (item) => item.startHours < time && item.stopHours >= time,
    )!;
    const risk = cohort.filter((row) => row.start < time && row.stop >= time);
    const deaths = risk.filter((row) => row.failed && row.stop === time);
    // Center on the requested profile before exponentiation: H0*exp(lp) at
    // a zero reference can underflow/overflow even for an ordinary profile.
    const lp = risk.map((row) =>
      row.covariates.reduce(
        (sum, value, j) =>
          sum + fit.coefficients[j] * (value - interval.covariates[j]),
        0,
      ),
    );
    const shift = Math.max(...lp);
    const weights = lp.map((value) => Math.exp(value - shift));
    const sum = weights.reduce((a, b) => a + b, 0);
    const tied = weights.reduce(
      (sum, value, i) =>
        sum + (risk[i].failed && risk[i].stop === time ? value : 0),
      0,
    );
    for (let k = 0; k < deaths.length; k++) {
      const denominator = sum - (k * tied) / deaths.length;
      const increment = Math.exp(-shift - Math.log(denominator));
      if (!Number.isFinite(increment) || increment <= 0)
        return refused(
          "Conditional hazard exceeds representable numerical range; no clipped or precise-looking probability is returned.",
        );
      hazard += increment;
      if (fit.diagnostics?.status === "computed") {
        const fraction = k / deaths.length;
        for (let i = 0; i < risk.length; i++) {
          const row = risk[i];
          const event = row.failed && row.stop === time;
          const effective = weights[i] * (event ? 1 - fraction : 1);
          const proportion = effective / denominator;
          const asset = clusters.get(row.subjectId)!;
          direct.set(asset, (direct.get(asset) ?? 0) - proportion * increment);
          // Center differences on the requested profile, rather than
          // subtracting two large uncentered covariate means.
          for (let j = 0; j < p; j++)
            gradient[j] -=
              increment *
              proportion *
              (row.covariates[j] - interval.covariates[j]);
        }
        for (const row of deaths) {
          const asset = clusters.get(row.subjectId)!;
          direct.set(
            asset,
            (direct.get(asset) ?? 0) + increment / deaths.length,
          );
        }
      }
    }
  }
  if (!Number.isFinite(hazard))
    return refused(
      "Conditional cumulative hazard is numerically unresolvable.",
    );
  return {
    status: "estimated",
    scenarioVersion: "cox-conditional/1/draft",
    authority: "advisory_only",
    liveAssetForecast: false,
    calibration: "unqualified",
    confidenceInterval: null,
    predictionUncertainty: jointHazardUncertainty(
      fit,
      gradient,
      direct,
      hazard,
      times.length,
    ),
    profile: structuredClone(profile),
    cumulativeHazardIncrement: hazard,
    conditionalFailureProbability: -Math.expm1(-hazard),
    conditionalSurvivalProbability: Math.exp(-hazard),
    eventTimesInWindow: times.length,
    limitations: [
      "This is an evidence-backed numerical conditional scenario, not a qualified live-asset forecast or a customer-calibrated model.",
      "Covariate paths must be known at origin and valid through the stated window; no future condition measurements are invented.",
      "An observed joint profile and bounded age window do not prove physical applicability, stationarity or proportional hazards.",
      "No predictive confidence interval is supplied; coefficient uncertainty is not survival-prediction uncertainty.",
      "A zero point estimate from a window with no observed event increments is not proof that failure cannot occur.",
      "No PM interval, work execution, risk acceptance, spending or return-to-service authority is granted.",
    ],
  };
}

function jointHazardUncertainty(
  fit: Extract<CoxResult, { status: "fitted" }>,
  gradient: number[],
  direct: ReadonlyMap<string, number>,
  hazard: number,
  events: number,
): CoxJointHazardUncertainty {
  const refuse = (reason: string): CoxJointHazardUncertainty => ({
    status: "refused",
    uncertaintyVersion: "cox-joint-asset/1/draft",
    authority: "advisory_only",
    reason,
  });
  const diagnostics = fit.diagnostics;
  if (diagnostics?.status !== "computed")
    return refuse(
      diagnostics?.status === "refused"
        ? diagnostics.reason
        : "Complete canonical-asset coefficient influences are required; no model-based substitution.",
    );
  if (!events || !(hazard > 0))
    return refuse(
      "No observed event increment in this conditional window; zero point hazard does not establish zero uncertainty.",
    );
  const clusterInfluences = diagnostics.clusterInfluences.map(
    ({ clusterId, dfbeta }) => ({
      clusterId,
      influence:
        (direct.get(clusterId) ?? 0) +
        gradient.reduce((sum, value, j) => sum + value * dfbeta[j], 0),
    }),
  );
  const variance = clusterInfluences.reduce(
    (sum, asset) => sum + asset.influence ** 2,
    0,
  );
  if (
    !gradient.every(Number.isFinite) ||
    !clusterInfluences.every((asset) => Number.isFinite(asset.influence)) ||
    !Number.isFinite(variance) ||
    !(variance > 0)
  )
    return refuse(
      "Joint asset prediction uncertainty is degenerate or numerically unresolvable; no precise-looking zero or clipped variance.",
    );
  return {
    status: "computed",
    uncertaintyVersion: "cox-joint-asset/1/draft",
    authority: "advisory_only",
    method: "efron_full_asset_case_weight_influence",
    clusterCount: diagnostics.clusterCount,
    cumulativeHazardVariance: variance,
    cumulativeHazardStandardError: Math.sqrt(variance),
    clusterInfluences,
    modelConfidenceBounds: coxModelConfidenceBounds(hazard, variance),
    limitations: [
      "Full joint Efron baseline/coefficient physical-asset case-weight uncertainty, not the survfit variance convention or coefficient uncertainty alone.",
      "Asymptotic sampling uncertainty assumes independent asset clusters and a suitable model; cluster count alone does not prove adequacy.",
      "This is not a future-event prediction interval, customer calibration, validated coverage, physical applicability or operational authority.",
      "Retained model sampling-confidence bounds are nominal and pointwise; they do not establish empirical predictive coverage or a qualified live forecast.",
    ],
  };
}
