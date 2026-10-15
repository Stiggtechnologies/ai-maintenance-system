/**
 * Bayesian failure-rate estimation from generic priors (BOK-09).
 *
 * A new site has too few failures to estimate anything, so the platform
 * refuses — correctly, but uselessly. Industry practice is to start from a
 * generic rate (OREDA, ISO 14224-class data, a fleet population) and update
 * it with the site's own experience. This is the conjugate gamma–Poisson
 * update used in probabilistic safety assessment (NUREG/CR-6823 §6.2;
 * Hamada et al., "Bayesian Reliability", 2008, ch. 3).
 *
 * The prior is never defaulted: its source and revision are mandatory, and
 * the result reports how much of the answer came from the prior rather than
 * the plant, so nobody mistakes a handbook number for site evidence.
 *
 * Pure: no I/O, no randomness, no LLM.
 */

import { gammaQuantile } from "./stats";

export interface GammaPrior {
  /** Shape. */
  alpha: number;
  /** Rate, in units of exposure time (e.g. per hour). */
  beta: number;
  /** Citation: handbook, edition, table/equipment class, or fleet analysis id. */
  source: string;
}

/**
 * Gamma prior from a generic source quoted as a mean rate and a lognormal
 * error factor (EF = 95th / 50th percentile), by moment matching
 * (NUREG/CR-6823 §6.2.3.2).
 */
export function gammaPriorFromMeanAndErrorFactor(
  meanRate: number,
  errorFactor: number,
  source: string,
): GammaPrior {
  if (!(meanRate > 0))
    throw new Error("The generic mean rate must be positive.");
  if (!(errorFactor > 1))
    throw new Error("The error factor must be greater than 1.");
  if (!source || source.trim().length < 15)
    throw new Error(
      "A generic prior must cite its source (handbook, edition, equipment class).",
    );
  const sigma = Math.log(errorFactor) / 1.6448536269514722;
  const alpha = 1 / (Math.exp(sigma * sigma) - 1);
  return { alpha, beta: alpha / meanRate, source: source.trim() };
}

export interface RateUpdate {
  prior: GammaPrior;
  failures: number;
  exposure: number;
  posterior: { alpha: number; beta: number };
  posteriorMean: number;
  lower: number;
  upper: number;
  credibility: number;
  /** Site-only estimate (failures / exposure); null with zero failures. */
  siteOnlyRate: number | null;
  /** Fraction of the posterior mean's information carried by the prior. */
  priorWeight: number;
  reason: string;
}

/** Conjugate update of a gamma prior with n failures in exposure T. */
export function updateFailureRate(
  prior: GammaPrior,
  failures: number,
  exposure: number,
  credibility = 0.9,
): RateUpdate {
  if (!(prior.alpha > 0) || !(prior.beta > 0))
    throw new Error("The prior must have positive shape and rate.");
  if (!prior.source || prior.source.trim().length < 15)
    throw new Error("The prior must cite its source.");
  if (!Number.isInteger(failures) || failures < 0)
    throw new Error("Failures must be a non-negative integer.");
  if (!(exposure > 0)) throw new Error("Exposure time must be positive.");
  if (!(credibility > 0 && credibility < 1))
    throw new Error("Credibility must be in (0, 1).");
  const a = prior.alpha + failures;
  const b = prior.beta + exposure;
  const tail = (1 - credibility) / 2;
  const priorWeight = prior.beta / b;
  return {
    prior,
    failures,
    exposure,
    posterior: { alpha: a, beta: b },
    posteriorMean: a / b,
    lower: gammaQuantile(tail, a, b),
    upper: gammaQuantile(1 - tail, a, b),
    credibility,
    siteOnlyRate: failures > 0 ? failures / exposure : null,
    priorWeight,
    reason:
      priorWeight > 0.5
        ? `The prior (${prior.source}) still carries ${(priorWeight * 100).toFixed(0)}% of the estimate; the site evidence is not yet enough to stand on its own.`
        : `Site evidence now dominates (${((1 - priorWeight) * 100).toFixed(0)}% of the estimate).`,
  };
}
