import {
  fitCoxWithDiagnostics,
  type CoxInterval,
  type CoxResult,
} from "./cox.ts";

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
  source?: {
    eventId: number;
    overlayVersion: number;
    intervalIndex: number;
    evidenceItemIds: string[];
  };
}
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
        : estimate(rows, fit, request, refused),
  };
}

function estimate(
  rows: CoxInterval[],
  fit: Extract<CoxResult, { status: "fitted" }>,
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
    profile: structuredClone(profile),
    cumulativeHazardIncrement: hazard,
    conditionalFailureProbability: -Math.expm1(-hazard),
    conditionalSurvivalProbability: Math.exp(-hazard),
    eventTimesInWindow: times.length,
    limitations: [
      "This is an evidence-backed numerical conditional scenario, not a forecast for a currently installed component or a customer-calibrated model.",
      "Covariate paths must be known at origin and valid through the stated window; no future condition measurements are invented.",
      "An observed joint profile and bounded age window do not prove physical applicability, stationarity or proportional hazards.",
      "No predictive confidence interval is supplied; coefficient uncertainty is not survival-prediction uncertainty.",
      "A zero point estimate from a window with no observed event increments is not proof that failure cannot occur.",
      "No PM interval, work execution, risk acceptance, spending or return-to-service authority is granted.",
    ],
  };
}
