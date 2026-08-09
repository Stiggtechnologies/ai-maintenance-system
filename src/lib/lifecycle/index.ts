/**
 * Lifecycle decision mathematics — repair, replace, redesign, defer
 * (capability register C8.09).
 *
 * WHY THIS LIVES IN TYPESCRIPT BESIDE THE RELIABILITY ENGINE, NOT IN SQL.
 * Every option here needs a conditional failure probability from a Weibull
 * fit. That fit already exists in src/lib/reliability with twelve validation
 * tests behind it, including hand-computed identities and seeded parameter
 * recovery. Reimplementing it in plpgsql would create a second engine that can
 * silently drift from the tested one, and the two would disagree about a
 * number that decides whether a machine keeps running. One engine.
 *
 * Evaluations are persisted WITH their inputs so any figure can be recomputed
 * and challenged later. They are decision aids requiring human adoption, never
 * autonomous action — which is what makes a client-side computation acceptable
 * here: the number is an argument, not an instruction.
 *
 * Every function refuses rather than guesses. A missing cost is reported as a
 * missing cost, because a lifecycle decision built on an invented replacement
 * value is worse than no analysis: it carries the authority of arithmetic.
 */
import type { WeibullFit } from "../reliability";

export interface AssetEconomics {
  replacementValueUsd: number | null;
  annualMaintenanceCostUsd: number | null;
  downtimeCostPerHourUsd: number | null;
  expectedRepairCostUsd: number | null;
  expectedRepairHours: number | null;
  expectedRemainingLifeYears: number | null;
}

/**
 * Conditional probability that an item which has already survived to `ageHours`
 * fails within the next `windowHours`.
 *
 *   P = 1 − R(age + window) / R(age),  R(t) = exp(−(t/η)^β)
 *
 * The conditioning matters: an asset that has already run 8,000 hours is not
 * the same risk as a new one, and using the unconditional CDF would understate
 * a wear-out item and overstate an infant-mortality one.
 */
export function conditionalFailureProbability(
  fit: Pick<WeibullFit, "beta" | "eta">,
  ageHours: number,
  windowHours: number,
): number {
  if (!(fit.eta > 0) || !(fit.beta > 0)) {
    throw new Error("Weibull fit must have positive beta and eta.");
  }
  if (ageHours < 0 || windowHours <= 0) {
    throw new Error("age must be >= 0 and window must be > 0 hours.");
  }
  const H = (t: number) => Math.pow(t / fit.eta, fit.beta); // cumulative hazard
  // Computed as 1 − exp(−ΔH) rather than a ratio of two exponentials, which
  // loses all precision once the cumulative hazard is large.
  return -Math.expm1(-(H(ageHours + windowHours) - H(ageHours)));
}

export interface DeferralRisk {
  probability: number;
  windowDays: number;
  /** Expected cost of deferring, or null when the consequence is unpriced. */
  expectedCostUsd: number | null;
  missingInputs: string[];
}

/**
 * The deferral question — "can this wait until the October window?" — is the
 * one lifecycle decision that is answerable WITHOUT a replacement value. It
 * needs only a failure model and the cost of the failure it risks.
 */
export function deferralRisk(
  fit: Pick<WeibullFit, "beta" | "eta">,
  ageHours: number,
  windowDays: number,
  econ: Pick<AssetEconomics, "downtimeCostPerHourUsd" | "expectedRepairHours">,
): DeferralRisk {
  const probability = conditionalFailureProbability(
    fit,
    ageHours,
    windowDays * 24,
  );
  const missing: string[] = [];
  if (econ.downtimeCostPerHourUsd == null)
    missing.push("downtime cost per hour");
  if (econ.expectedRepairHours == null) missing.push("expected repair hours");

  return {
    probability,
    windowDays,
    expectedCostUsd:
      missing.length === 0
        ? probability *
          (econ.downtimeCostPerHourUsd as number) *
          (econ.expectedRepairHours as number)
        : null,
    missingInputs: missing,
  };
}

export interface OptionCost {
  option: "repair" | "replace" | "redesign" | "defer";
  /** Equivalent annual cost in USD, or null when an input is missing. */
  annualCostUsd: number | null;
  missingInputs: string[];
  basis: string;
}

/**
 * Equivalent annual cost of each option, on a common basis so they can be
 * compared at all. Undiscounted deliberately: a discount rate is a corporate
 * finance policy, and picking one on the operator's behalf would bury a
 * material assumption inside a maintenance tool. State the horizon, compare
 * like with like, and let finance apply their own rate to the outputs.
 */
export function compareOptions(
  econ: AssetEconomics,
  risk: DeferralRisk,
  redesignCostUsd: number | null,
  redesignMaintenanceReductionPct: number | null,
): OptionCost[] {
  const out: OptionCost[] = [];

  const repairMissing: string[] = [];
  if (econ.annualMaintenanceCostUsd == null)
    repairMissing.push("annual maintenance cost");
  out.push({
    option: "repair",
    annualCostUsd:
      repairMissing.length === 0 ? econ.annualMaintenanceCostUsd : null,
    missingInputs: repairMissing,
    basis:
      "Continue the current strategy: recurring maintenance cost as it stands.",
  });

  const replaceMissing: string[] = [];
  if (econ.replacementValueUsd == null)
    replaceMissing.push("replacement value");
  if (econ.expectedRemainingLifeYears == null)
    replaceMissing.push("expected life of the replacement");
  out.push({
    option: "replace",
    annualCostUsd:
      replaceMissing.length === 0
        ? (econ.replacementValueUsd as number) /
          (econ.expectedRemainingLifeYears as number)
        : null,
    missingInputs: replaceMissing,
    basis:
      "Capital spread straight-line over the replacement's expected life. Undiscounted: apply your own cost of capital to this figure.",
  });

  const redesignMissing: string[] = [];
  if (redesignCostUsd == null) redesignMissing.push("redesign cost");
  if (redesignMaintenanceReductionPct == null)
    redesignMissing.push("expected maintenance reduction");
  if (econ.annualMaintenanceCostUsd == null)
    redesignMissing.push("annual maintenance cost");
  if (econ.expectedRemainingLifeYears == null)
    redesignMissing.push("remaining life over which to spread it");
  out.push({
    option: "redesign",
    annualCostUsd:
      redesignMissing.length === 0
        ? (redesignCostUsd as number) /
            (econ.expectedRemainingLifeYears as number) +
          (econ.annualMaintenanceCostUsd as number) *
            (1 - (redesignMaintenanceReductionPct as number) / 100)
        : null,
    missingInputs: redesignMissing,
    basis:
      "Engineering spend spread over remaining life, plus the reduced recurring cost it is expected to buy.",
  });

  out.push({
    option: "defer",
    annualCostUsd:
      risk.expectedCostUsd == null
        ? null
        : risk.expectedCostUsd * (365 / risk.windowDays),
    missingInputs: risk.missingInputs,
    basis: `Expected cost of failure over a ${risk.windowDays}-day deferral, annualised. Carries the risk rather than removing it.`,
  });

  return out;
}

export interface Uncertainty {
  level: "low" | "moderate" | "high";
  reasons: string[];
}

/**
 * Uncertainty is reported alongside every verdict, because the cheapest option
 * computed from six failures and two guessed costs is not a finding. A
 * recommendation without its uncertainty invites a decision the evidence
 * cannot support.
 */
export function assessUncertainty(
  fit: Pick<WeibullFit, "failures" | "converged">,
  options: OptionCost[],
): Uncertainty {
  const reasons: string[] = [];
  if (!fit.converged) reasons.push("the Weibull fit did not converge");
  if (fit.failures < 5)
    reasons.push(`only ${fit.failures} failures underpin the failure model`);
  else if (fit.failures < 10)
    reasons.push(
      `${fit.failures} failures is a thin basis for a life estimate`,
    );

  const priced = options.filter((o) => o.annualCostUsd != null);
  if (priced.length < 2)
    reasons.push(
      `${priced.length} of ${options.length} options could be priced, so they cannot be ranked`,
    );

  const gap = rankedGapPct(priced);
  if (gap != null && gap < 15)
    reasons.push(
      `the best and second-best options differ by only ${gap.toFixed(0)}%, which is inside the error of these inputs`,
    );

  const level: Uncertainty["level"] =
    reasons.length === 0 ? "low" : reasons.length <= 1 ? "moderate" : "high";
  return { level, reasons };
}

function rankedGapPct(priced: OptionCost[]): number | null {
  if (priced.length < 2) return null;
  const sorted = [...priced].sort(
    (a, b) => (a.annualCostUsd as number) - (b.annualCostUsd as number),
  );
  const best = sorted[0].annualCostUsd as number;
  const next = sorted[1].annualCostUsd as number;
  if (best <= 0) return null;
  return ((next - best) / best) * 100;
}

export interface LifecycleVerdict {
  recommended: OptionCost["option"] | null;
  options: OptionCost[];
  uncertainty: Uncertainty;
  rationale: string;
}

/** Ranks the options, or declines to when too few can be priced. */
export function recommendOption(
  options: OptionCost[],
  uncertainty: Uncertainty,
): LifecycleVerdict {
  const priced = options.filter((o) => o.annualCostUsd != null);
  if (priced.length < 2) {
    return {
      recommended: null,
      options,
      uncertainty,
      rationale:
        "Not enough options can be priced to rank them. Ranking two options when only one has a cost would present a default as a decision.",
    };
  }
  const sorted = [...priced].sort(
    (a, b) => (a.annualCostUsd as number) - (b.annualCostUsd as number),
  );
  const gap = rankedGapPct(priced);
  return {
    recommended: sorted[0].option,
    options,
    uncertainty,
    rationale:
      gap != null && gap < 15
        ? `${sorted[0].option} is nominally cheapest but only ${gap.toFixed(0)}% ahead of ${sorted[1].option} — too close to call on these inputs.`
        : `${sorted[0].option} carries the lowest equivalent annual cost of the ${priced.length} options that could be priced.`,
  };
}
