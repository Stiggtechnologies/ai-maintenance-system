export type CoxModelConfidenceBounds =
  | {
      status: "refused";
      boundsVersion: "cox-model-confidence/1/draft";
      authority: "advisory_only";
      reason: string;
    }
  | {
      status: "computed";
      boundsVersion: "cox-model-confidence/1/draft";
      authority: "advisory_only";
      method: "pointwise_asymptotic_log_cumulative_hazard";
      nominalConfidenceLevel: 0.95;
      coverageValidated: false;
      futureEventPredictionInterval: false;
      logHazardHalfWidth: number;
      logCumulativeHazard: { lower: number; upper: number };
      cumulativeHazard: { lower: number; upper: number };
      conditionalFailureProbability: { lower: number; upper: number };
      conditionalSurvivalProbability: { lower: number; upper: number };
      limitations: string[];
    };

/** Sampling confidence in the model probability, not a future outcome interval.
 * A declared log-hazard delta transform of full joint physical-asset variance.
 * Independently qualified against R qnorm/log/exp/expm1 on pinned synthetic
 * full-refit witnesses; this does not establish model adequacy or coverage.
 */
export function coxModelConfidenceBounds(
  hazard: number,
  variance: number,
): CoxModelConfidenceBounds {
  const refused = (reason: string): CoxModelConfidenceBounds => ({
    status: "refused",
    boundsVersion: "cox-model-confidence/1/draft",
    authority: "advisory_only",
    reason,
  });
  if (
    !Number.isFinite(hazard) ||
    !Number.isFinite(variance) ||
    hazard <= 0 ||
    variance <= 0
  )
    return refused(
      "Model confidence bounds require finite positive conditional hazard and full joint asset variance.",
    );
  // Actual independently retained R 4.6.0 qnorm(0.975); a statistical nominal
  // quantile, never an engineering tolerance, acceptance criterion or coverage.
  const criticalValue = 1.9599639845400536;
  const logHazardHalfWidth = criticalValue * (Math.sqrt(variance) / hazard);
  const center = Math.log(hazard);
  const logCumulativeHazard = {
    lower: center - logHazardHalfWidth,
    upper: center + logHazardHalfWidth,
  };
  const cumulativeHazard = {
    lower: Math.exp(logCumulativeHazard.lower),
    upper: Math.exp(logCumulativeHazard.upper),
  };
  if (
    ![
      logHazardHalfWidth,
      logCumulativeHazard.lower,
      logCumulativeHazard.upper,
      cumulativeHazard.lower,
      cumulativeHazard.upper,
    ].every(Number.isFinite) ||
    cumulativeHazard.lower <= 0 ||
    cumulativeHazard.lower >= hazard ||
    cumulativeHazard.upper <= hazard
  )
    return refused(
      "Model confidence bounds are numerically unresolvable; no clipping, overflow substitution or zero-width interval is permitted.",
    );
  const conditionalFailureProbability = {
    lower: -Math.expm1(-cumulativeHazard.lower),
    upper: -Math.expm1(-cumulativeHazard.upper),
  };
  const conditionalSurvivalProbability = {
    lower: Math.exp(-cumulativeHazard.upper),
    upper: Math.exp(-cumulativeHazard.lower),
  };
  // Stable transforms are still limited by representable floating-point
  // probabilities. Do not disguise saturation as a precise 0%, 100% or width.
  const failure = -Math.expm1(-hazard),
    survival = Math.exp(-hazard);
  for (const [bounds, point] of [
    [conditionalFailureProbability, failure],
    [conditionalSurvivalProbability, survival],
  ] as const)
    if (
      !Number.isFinite(bounds.lower) ||
      !Number.isFinite(bounds.upper) ||
      bounds.lower <= 0 ||
      bounds.upper >= 1 ||
      bounds.lower >= point ||
      bounds.upper <= point
    )
      return refused(
        "Model confidence probabilities have boundary saturation or an unresolvable width; no clipping or precise-looking endpoint is supplied.",
      );
  return {
    status: "computed",
    boundsVersion: "cox-model-confidence/1/draft",
    authority: "advisory_only",
    method: "pointwise_asymptotic_log_cumulative_hazard",
    nominalConfidenceLevel: 0.95,
    coverageValidated: false,
    futureEventPredictionInterval: false,
    logHazardHalfWidth,
    logCumulativeHazard,
    cumulativeHazard,
    conditionalFailureProbability,
    conditionalSurvivalProbability,
    limitations: [
      "Pointwise nominal 95% asymptotic model sampling-confidence bounds, not a simultaneous band or future-event prediction interval.",
      "Nominal confidence is not validated coverage. Independent-asset adequacy, model suitability, PH applicability and held-out customer calibration remain unproven.",
      "No engineering threshold, life-extension claim, maintenance change, risk acceptance or operational authorization is derived from these bounds.",
    ],
  };
}
