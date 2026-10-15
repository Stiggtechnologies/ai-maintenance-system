/**
 * Interval decisions that respect the uncertainty in the life model
 * (BOK-01 consumer) and block replacement (BOK-11).
 *
 * optimalAgeReplacement() refuses when the POINT estimate of beta is ≤ 1.
 * With field-sized samples the confidence interval on beta often straddles 1,
 * so the refusal (or the interval) is decided by noise. This wrapper decides
 * against the interval instead:
 *   - wear-out NOT demonstrated (lower bound ≤ 1): no age-based interval is
 *     recommended; the point result is still shown, labelled, so the engineer
 *     sees what more data would have to confirm;
 *   - wear-out demonstrated: the interval is reported with the cost-rate
 *     REGRET of using it if the truth sits at either end of the interval.
 *
 * Block replacement replaces on a fixed calendar regardless of age. It costs
 * more than age replacement for the same component (Barlow & Proschan 1965,
 * Thm 4.3) but is what shutdown-driven plants actually execute, so the
 * comparison is computed rather than assumed. The renewal function is solved
 * numerically from the renewal equation (Jardine & Tsang 2013 §2.6).
 *
 * Pure: no I/O, no randomness, no LLM.
 */

import type { AgeReplacementInput, AgeReplacementResult } from "./index";
import {
  ageReplacementCostRate,
  optimalAgeReplacement,
  reliabilityAt,
} from "./index";
import type {
  WeibullBounds,
  WeibullParams,
} from "../reliability/life-data-bounds";
import { lnGamma } from "../reliability/stats";

export interface IntervalUnderUncertainty {
  recommended: boolean;
  wearOutDemonstrated: boolean;
  confidence: number;
  point: AgeReplacementResult;
  /** Optimum if beta were at its lower / upper bound (eta held at its MLE). */
  atLowerBeta: AgeReplacementResult | null;
  atUpperBeta: AgeReplacementResult | null;
  /** Extra cost rate (%) of using the point optimum if beta were at each bound. */
  regretPct: { atLowerBeta: number | null; atUpperBeta: number | null };
  reason: string;
}

export function ageReplacementUnderUncertainty(
  fit: WeibullParams & { failures: number },
  bounds: WeibullBounds,
  cost: AgeReplacementInput,
): IntervalUnderUncertainty {
  if (Math.abs(bounds.beta.estimate - fit.beta) > 1e-9 * fit.beta)
    throw new Error("The bounds were computed for a different fit.");
  const point = optimalAgeReplacement(fit, cost);
  const conf = `${(bounds.confidence * 100).toFixed(0)}%`;
  if (!bounds.wearOutDemonstrated) {
    return {
      recommended: false,
      wearOutDemonstrated: false,
      confidence: bounds.confidence,
      point,
      atLowerBeta: null,
      atUpperBeta: null,
      regretPct: { atLowerBeta: null, atUpperBeta: null },
      reason:
        `Wear-out is not demonstrated: the ${conf} interval on beta is ${bounds.beta.lower.toFixed(2)}–${Number.isFinite(bounds.beta.upper) ? bounds.beta.upper.toFixed(2) : "∞"}, which includes beta ≤ 1. ` +
        `An age-based replacement interval cannot be justified from this data; consider condition monitoring, more failure data, or a documented prior (Weibayes).`,
    };
  }
  const lo = optimalAgeReplacement({ ...fit, beta: bounds.beta.lower }, cost);
  const hi = Number.isFinite(bounds.beta.upper)
    ? optimalAgeReplacement({ ...fit, beta: bounds.beta.upper }, cost)
    : null;
  const regret = (
    scenarioBeta: number,
    scenario: AgeReplacementResult | null,
  ) => {
    if (
      !point.optimalAge ||
      !scenario?.optimalAge ||
      !scenario.costRateAtOptimum
    )
      return null;
    const used = ageReplacementCostRate(
      { beta: scenarioBeta, eta: fit.eta },
      point.optimalAge,
      cost,
    );
    return (
      ((used - scenario.costRateAtOptimum) / scenario.costRateAtOptimum) * 100
    );
  };
  return {
    recommended: point.recommended,
    wearOutDemonstrated: true,
    confidence: bounds.confidence,
    point,
    atLowerBeta: lo,
    atUpperBeta: hi,
    regretPct: {
      atLowerBeta: regret(bounds.beta.lower, lo),
      atUpperBeta: hi ? regret(bounds.beta.upper, hi) : null,
    },
    reason: point.recommended
      ? `Wear-out is demonstrated at ${conf} confidence (beta ≥ ${bounds.beta.lower.toFixed(2)}). The point optimum is ${point.optimalAge?.toFixed(0)}; the regret figures show what it costs if beta sits at either bound.`
      : point.reason,
  };
}

/**
 * Weibull renewal function H(t) — expected number of renewals in [0, t] —
 * from the renewal equation H(t) = F(t) + ∫₀ᵗ H(t − x) dF(x), discretised
 * on `steps` points.
 */
export function weibullRenewalFunction(
  fit: WeibullParams,
  t: number,
  steps = 2000,
): number {
  if (!(t > 0)) return 0;
  const h = t / steps;
  const F = (x: number) => 1 - reliabilityAt(fit, x);
  const Fk = Array.from({ length: steps + 1 }, (_, k) => F(k * h));
  // Implicit trapezoid (Riemann–Stieltjes) scheme:
  //   H_i = F_i + Σ_{k=1..i} ½(H_{i−k} + H_{i−k+1}) (F_k − F_{k−1}),
  // where the k = 1 term contains H_i itself and is moved to the left side.
  const H = new Array<number>(steps + 1).fill(0);
  const dF1 = Fk[1] - Fk[0];
  for (let i = 1; i <= steps; i++) {
    let rhs = Fk[i] + 0.5 * H[i - 1] * dF1;
    for (let k = 2; k <= i; k++) {
      rhs += 0.5 * (H[i - k] + H[i - k + 1]) * (Fk[k] - Fk[k - 1]);
    }
    H[i] = rhs / (1 - 0.5 * dF1);
  }
  return H[steps];
}

export interface BlockReplacementResult {
  recommended: boolean;
  optimalInterval: number | null;
  costRateAtOptimum: number | null;
  /** Age-replacement optimum for the same component, for comparison. */
  ageReplacement: AgeReplacementResult;
  /** How much more block replacement costs than age replacement, %. */
  premiumOverAgePct: number | null;
  reason: string;
}

/** Block (constant-interval) replacement: C(T) = (cp + cf · H(T)) / T. */
export function optimalBlockReplacement(
  fit: WeibullParams & { failures: number },
  cost: AgeReplacementInput,
): BlockReplacementResult {
  const age = optimalAgeReplacement(fit, cost);
  const none = (reason: string): BlockReplacementResult => ({
    recommended: false,
    optimalInterval: null,
    costRateAtOptimum: null,
    ageReplacement: age,
    premiumOverAgePct: null,
    reason,
  });
  if (!(cost.plannedCost > 0) || !(cost.failureCost > 0))
    return none(
      "Both a planned-replacement cost and a failure cost are needed; neither is assumed.",
    );
  if (!(fit.beta > 1))
    return none(
      `Block replacement cannot help with beta = ${fit.beta.toFixed(2)}: the failure rate is not increasing.`,
    );
  const rate = (T: number) =>
    (cost.plannedCost +
      cost.failureCost * weibullRenewalFunction(fit, T, 400)) /
    T;
  // Coarse grid, then golden-section refinement.
  let bestT = 0;
  let best = Infinity;
  for (let i = 1; i <= 60; i++) {
    const T = (fit.eta * 3 * i) / 60;
    const c = rate(T);
    if (c < best) {
      best = c;
      bestT = T;
    }
  }
  let a = Math.max(1e-9, bestT - (fit.eta * 3) / 60);
  let b = bestT + (fit.eta * 3) / 60;
  const g = (Math.sqrt(5) - 1) / 2;
  for (let i = 0; i < 60; i++) {
    const c1 = b - g * (b - a);
    const c2 = a + g * (b - a);
    if (rate(c1) < rate(c2)) b = c2;
    else a = c1;
  }
  const T = (a + b) / 2;
  const cT =
    (cost.plannedCost +
      cost.failureCost * weibullRenewalFunction(fit, T, 2000)) /
    T;
  const rtf =
    cost.failureCost / (fit.eta * Math.exp(lnGamma(1 + 1 / fit.beta)));
  if (cT >= rtf)
    return none(
      "Block replacement never beats running to failure at these costs.",
    );
  const premium = age.costRateAtOptimum
    ? ((cT - age.costRateAtOptimum) / age.costRateAtOptimum) * 100
    : null;
  return {
    recommended: true,
    optimalInterval: T,
    costRateAtOptimum: cT,
    ageReplacement: age,
    premiumOverAgePct: premium,
    reason: `Replacing every ${T.toFixed(0)} regardless of age costs ${cT.toPrecision(3)} per unit time${premium !== null ? `, ${premium.toFixed(1)}% more than age replacement` : ""}; that premium is the price of calendar convenience.`,
  };
}
