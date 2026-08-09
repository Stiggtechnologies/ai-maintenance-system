/**
 * Interval optimisation — age replacement and inspection frequency
 * (capability register C7.07, C7.08, C7.14).
 *
 * The section this belongs to is titled "validated code, not plausible
 * equations", and interval optimisation is where plausible equations do the
 * most damage: the arithmetic always returns a number, so a wrong model
 * produces a confident replacement interval that quietly wastes life or
 * courts failure.
 *
 * The single most important result here is a REFUSAL. Preventive replacement
 * on age can only reduce the long-run cost rate when the failure rate is
 * INCREASING — that is, Weibull beta > 1. For beta <= 1 the item is no more
 * likely to fail tomorrow than it was yesterday, so replacing a survivor
 * throws away good life and buys nothing. Half the PM programmes in industry
 * violate this, because a tool asked for an interval will hand one over.
 *
 * This one will not. It returns the reason instead.
 *
 * Pure: no database, no network — the same posture as the reliability and
 * lifecycle engines it sits beside.
 */
import type { WeibullFit } from "../reliability";

export interface AgeReplacementInput {
  /** Cost of a PLANNED replacement, including the labour and the lost run time. */
  plannedCost: number;
  /** Total cost of a FAILURE: repair, downtime, consequence. */
  failureCost: number;
}

export interface AgeReplacementResult {
  recommended: boolean;
  /** Optimal replacement age in the fit's time unit, when one exists. */
  optimalAge: number | null;
  /** Long-run cost per unit time at the optimum. */
  costRateAtOptimum: number | null;
  /** Cost rate of running to failure, for comparison. */
  runToFailureCostRate: number | null;
  savingsPct: number | null;
  reason: string;
}

/** Weibull reliability: R(t) = exp(-(t/eta)^beta). */
export function reliabilityAt(
  fit: Pick<WeibullFit, "beta" | "eta">,
  t: number,
): number {
  if (t <= 0) return 1;
  return Math.exp(-Math.pow(t / fit.eta, fit.beta));
}

/**
 * Mean time in service under an age-replacement policy: the integral of R(t)
 * from 0 to T.
 *
 * The Weibull has no elementary closed form for this (it is an incomplete
 * gamma), so it is integrated numerically with composite Simpson. The test
 * suite pins the result against the ONE case with an exact answer — beta = 1,
 * where the integral is eta·(1 - e^(-T/eta)) — which is what makes the
 * numerical method trustworthy for the cases that have no closed form.
 */
export function expectedCycleLength(
  fit: Pick<WeibullFit, "beta" | "eta">,
  T: number,
  intervals = 2000,
): number {
  if (T <= 0) return 0;
  const n = intervals % 2 === 0 ? intervals : intervals + 1;
  const h = T / n;
  let s = reliabilityAt(fit, 0) + reliabilityAt(fit, T);
  for (let i = 1; i < n; i++) {
    s += reliabilityAt(fit, i * h) * (i % 2 === 0 ? 2 : 4);
  }
  return (h / 3) * s;
}

/**
 * Long-run cost per unit time for replacing at age T.
 *
 *   C(T) = [Cp·R(T) + Cf·(1 − R(T))] / ∫₀ᵀ R(t) dt
 *
 * Numerator: the expected cost of one cycle — planned cost if the item
 * survives to T, failure cost if it does not. Denominator: the expected length
 * of that cycle.
 */
export function ageReplacementCostRate(
  fit: Pick<WeibullFit, "beta" | "eta">,
  T: number,
  cost: AgeReplacementInput,
): number {
  const R = reliabilityAt(fit, T);
  const cycle = expectedCycleLength(fit, T);
  if (cycle <= 0) return Number.POSITIVE_INFINITY;
  return (cost.plannedCost * R + cost.failureCost * (1 - R)) / cycle;
}

/** Cost rate of running to failure: Cf divided by the MTTF. */
export function runToFailureCostRate(
  fit: Pick<WeibullFit, "beta" | "eta">,
  cost: AgeReplacementInput,
): number {
  // MTTF = eta · Γ(1 + 1/beta)
  const mttf = fit.eta * gamma(1 + 1 / fit.beta);
  return cost.failureCost / mttf;
}

export function optimalAgeReplacement(
  fit: Pick<WeibullFit, "beta" | "eta" | "failures">,
  cost: AgeReplacementInput,
): AgeReplacementResult {
  const none = (reason: string): AgeReplacementResult => ({
    recommended: false,
    optimalAge: null,
    costRateAtOptimum: null,
    runToFailureCostRate: null,
    savingsPct: null,
    reason,
  });

  if (!(fit.eta > 0) || !(fit.beta > 0))
    return none(
      "The failure model is not valid: beta and eta must both be positive.",
    );
  if (!(cost.plannedCost > 0) || !(cost.failureCost > 0))
    return none(
      "Both a planned-replacement cost and a failure cost are needed; neither is assumed.",
    );

  // THE REFUSAL. This is the whole point of the function.
  if (fit.beta <= 1)
    return none(
      `Age replacement cannot help: beta is ${fit.beta.toFixed(2)}, so the failure rate is ${fit.beta < 1 ? "DECREASING (infant mortality)" : "CONSTANT (random)"}. ` +
        `Replacing a survivor discards good life and does not reduce the failure rate. ` +
        `${fit.beta < 1 ? "Look at installation, commissioning and early-life quality." : "Use condition monitoring or accept run-to-failure; a time-based interval is spend without benefit."}`,
    );

  if (cost.failureCost <= cost.plannedCost)
    return none(
      "A failure costs no more than a planned replacement, so there is nothing to buy by intervening early. Run to failure.",
    );

  // Search over a range wide enough to contain the optimum for any sane
  // beta/eta, at a resolution fine enough that the reported age is meaningful.
  const upper = fit.eta * 3;
  const steps = 3000;
  let bestT = 0;
  let bestC = Number.POSITIVE_INFINITY;
  for (let i = 1; i <= steps; i++) {
    const T = (upper * i) / steps;
    const c = ageReplacementCostRate(fit, T, cost);
    if (c < bestC) {
      bestC = c;
      bestT = T;
    }
  }

  const rtf = runToFailureCostRate(fit, cost);
  // If the optimum sits at the top of the search range the cost curve is still
  // falling, which means the model is telling us not to replace on age.
  if (bestT >= upper * 0.999)
    return none(
      "The cost rate is still falling at three times the characteristic life, so no finite replacement age is optimal on these inputs. Run to failure or reconsider the costs.",
    );

  const savings = rtf > 0 ? ((rtf - bestC) / rtf) * 100 : 0;
  return {
    recommended: savings > 0,
    optimalAge: Number(bestT.toFixed(1)),
    costRateAtOptimum: Number(bestC.toFixed(6)),
    runToFailureCostRate: Number(rtf.toFixed(6)),
    savingsPct: Number(savings.toFixed(1)),
    reason:
      savings > 0
        ? `Beta is ${fit.beta.toFixed(2)}, so the failure rate increases with age and a planned replacement has something to buy. Replacing at ${bestT.toFixed(0)} lowers the long-run cost rate by ${savings.toFixed(1)}% against running to failure.`
        : "An optimum exists arithmetically but does not beat running to failure on these costs.",
  };
}

export interface InspectionResult {
  intervalDays: number | null;
  detectionProbability: number;
  opportunities: number;
  reason: string;
}

/**
 * Inspection interval from a P-F interval.
 *
 * The standard rule is to inspect at half the P-F interval so at least two
 * opportunities fall inside the detectable window. This states the resulting
 * detection probability rather than leaving "two opportunities" to imply
 * certainty: with a per-inspection detection probability p and n opportunities
 * the chance of catching it is 1 − (1 − p)^n, and at p = 0.9 with two looks
 * that is 99%, not 100%.
 */
export function inspectionInterval(
  pfIntervalDays: number,
  perInspectionDetection = 0.9,
  opportunities = 2,
): InspectionResult {
  if (!(pfIntervalDays > 0))
    return {
      intervalDays: null,
      detectionProbability: 0,
      opportunities: 0,
      reason:
        "A positive P-F interval is required; it is an engineering determination, not a default.",
    };
  if (perInspectionDetection <= 0 || perInspectionDetection > 1)
    return {
      intervalDays: null,
      detectionProbability: 0,
      opportunities: 0,
      reason: "Per-inspection detection probability must be between 0 and 1.",
    };
  if (opportunities < 1)
    return {
      intervalDays: null,
      detectionProbability: 0,
      opportunities: 0,
      reason:
        "At least one inspection opportunity is required inside the P-F interval.",
    };

  const interval = pfIntervalDays / opportunities;
  const detection = 1 - Math.pow(1 - perInspectionDetection, opportunities);
  return {
    intervalDays: Number(interval.toFixed(1)),
    detectionProbability: Number(detection.toFixed(4)),
    opportunities,
    reason:
      `Inspecting every ${interval.toFixed(1)} days puts ${opportunities} opportunities inside a ${pfIntervalDays}-day P-F interval. ` +
      `At ${(perInspectionDetection * 100).toFixed(0)}% detection per inspection that is a ${(detection * 100).toFixed(1)}% chance of catching it before functional failure — not certainty, and the residual is the risk being accepted.`,
  };
}

/**
 * Lanczos approximation to the gamma function, needed for the Weibull mean.
 * Accurate to roughly 15 significant figures across the range that matters
 * here, and pinned in the tests against known exact values.
 */
export function gamma(z: number): number {
  const g = 7;
  const C = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
  z -= 1;
  let x = C[0];
  for (let i = 1; i < g + 2; i++) x += C[i] / (z + i);
  const t = z + g + 0.5;
  return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
}
