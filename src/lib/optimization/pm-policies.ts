/**
 * Preventive-maintenance policies beyond single-component age replacement
 * (capability register C7.08, BOK-11B).
 *
 * Age replacement is already decided, including its refusal when the failure
 * rate is not increasing. This module adds the three policies that refusal
 * does not cover:
 *
 *   * Block replacement — one calendar interval, failures replaced as they
 *     occur. Cost rate (Cp + Cf · H(T)) / T, with H the Weibull renewal
 *     function. It is never claimed to beat age replacement.
 *   * Opportunistic grouping — when an access is already open, the age at
 *     which a survivor should be included. The threshold is the Weibull age
 *     whose hazard cost equals the dedicated policy's long-run cost rate,
 *     using the cheaper opportunity replacement cost. It is not a simulated
 *     multi-unit Markov cost.
 *   * Multi-component common block — one shared interval for the members that
 *     may legally share it. A shared access cost is paid once only when a
 *     named human has recorded that cost AND stated that each task cost
 *     excludes it. Otherwise no grouping saving is claimed.
 *
 * Costs, safety and regulatory applicability are inputs. None are invented.
 * A missing cost, a non-increasing failure rate, or unknown safety or
 * regulatory context refuses the corresponding preventive action.
 *
 * Pure: no database, no network, no randomness.
 */
import type { AgeReplacementInput } from "./index.ts";
import { optimalAgeReplacement, runToFailureCostRate } from "./index.ts";
import {
  optimalBlockReplacement,
  weibullRenewalFunction,
} from "./interval-under-uncertainty.ts";
import type { BlockReplacementResult } from "./interval-under-uncertainty.ts";
import type { AgeReplacementResult } from "./index.ts";

export const PM_POLICY_KERNEL_VERSION = "pm-policy/1";

export type PmEstimator = "rank_regression" | "mle_censored" | "mle" | "none";

export interface PmComponentInput {
  key: string;
  label: string;
  method: PmEstimator;
  failures: number;
  suspensions: number;
  beta: number | null;
  eta: number | null;
  eventIds: number[];
  planVersion: number;
  plannedItemCost: number | null;
  failureCost: number | null;
  costBasis: string | null;
  safetyCritical: boolean | null;
  regulatoryRequired: boolean | null;
  /** Operating hours since installation, when a single installed instance and meter exist. */
  ageHours: number | null;
}

export interface PmAccessDeclaration {
  sharedAccessCost: number;
  /** True only when the human states that each task cost excludes this access cost. */
  accessExcludedFromTaskCosts: boolean;
}

export interface PmComponentPolicy {
  key: string;
  label: string;
  method: PmEstimator;
  failures: number;
  suspensions: number;
  beta: number | null;
  eta: number | null;
  eventIds: number[];
  planVersion: number;
  plannedItemCost: number | null;
  failureCost: number | null;
  safetyCritical: boolean | null;
  regulatoryRequired: boolean | null;
  ageHours: number | null;
  ageReplacement: AgeReplacementResult;
  blockReplacement: BlockReplacementResult;
  /** Standing interval a human may apply, in the life unit. Null when none is justified. */
  standingIntervalHours: number | null;
  /** False for safety-critical, regulatory, or unknown-applicability plans. */
  applyInterval: boolean;
  opportunistic: {
    thresholdAge: number | null;
    preventiveAge: number | null;
    includeOnOpenAccess: boolean | null;
    reason: string;
  };
  reason: string;
}

export interface PmPolicyResult {
  kernelVersion: typeof PM_POLICY_KERNEL_VERSION;
  advisory: true;
  mayChangePmInterval: false;
  mayCreateWork: false;
  mayAcceptRisk: false;
  mayCommitSpend: false;
  mayReturnToService: false;
  components: PmComponentPolicy[];
  separateAge: { costRate: number | null; reason: string };
  separateBlock: { costRate: number | null; reason: string };
  commonBlock: {
    recommended: boolean;
    intervalHours: number | null;
    costRate: number | null;
    memberKeys: string[];
    premiumOverSeparateAgePct: number | null;
    reason: string;
  };
  opportunistic: {
    applicable: boolean;
    reason: string;
  };
  selected: "common_block" | "separate_age" | "evidence_gap";
  recommendation: {
    kind: "common_block" | "separate_age" | "evidence_gap";
    reason: string;
    humanApprovalRequired: true;
  };
  refusals: string[];
  limitations: string[];
}

const AUTHORITY = {
  kernelVersion: PM_POLICY_KERNEL_VERSION,
  advisory: true,
  mayChangePmInterval: false,
  mayCreateWork: false,
  mayAcceptRisk: false,
  mayCommitSpend: false,
  mayReturnToService: false,
} as const;

function round1(value: number): number {
  return Number(value.toFixed(1));
}

function round6(value: number): number {
  return Number(value.toFixed(6));
}

export function hasPmCostEvidence(
  component: Pick<
    PmComponentInput,
    "plannedItemCost" | "failureCost" | "costBasis"
  >,
): boolean {
  return (
    component.plannedItemCost != null &&
    component.plannedItemCost > 0 &&
    component.failureCost != null &&
    component.failureCost > 0 &&
    typeof component.costBasis === "string" &&
    component.costBasis.trim().length >= 20
  );
}

/** Interval rewrite is allowed only when both flags were explicitly recorded as false. */
export function pmIntervalWriteAllowed(
  component: Pick<PmComponentInput, "safetyCritical" | "regulatoryRequired">,
): boolean {
  return (
    component.safetyCritical === false && component.regulatoryRequired === false
  );
}

/**
 * Weibull hazard h(t) = (β/η) (t/η)^(β−1).
 * At β ≤ 1 the hazard is not increasing, so no finite preventive age is implied.
 */
export function weibullFailureRate(
  fit: { beta: number; eta: number },
  t: number,
): number {
  if (!(fit.beta > 0) || !(fit.eta > 0) || !(t > 0)) return Number.NaN;
  return (fit.beta / fit.eta) * Math.pow(t / fit.eta, fit.beta - 1);
}

/** Invert the Weibull hazard. Returns null when the hazard is not strictly increasing. */
export function ageAtWeibullFailureRate(
  fit: { beta: number; eta: number },
  hazard: number,
): number | null {
  if (!(fit.beta > 1) || !(fit.eta > 0) || !(hazard > 0)) return null;
  const ratio = (hazard * fit.eta) / fit.beta;
  if (!(ratio > 0)) return null;
  const age = fit.eta * Math.pow(ratio, 1 / (fit.beta - 1));
  return Number.isFinite(age) && age > 0 ? age : null;
}

function accessSavingClaimed(access: PmAccessDeclaration | null): boolean {
  return (
    access != null &&
    access.accessExcludedFromTaskCosts === true &&
    access.sharedAccessCost > 0
  );
}

function dedicatedCost(
  component: PmComponentInput,
  access: PmAccessDeclaration | null,
): AgeReplacementInput | null {
  if (!hasPmCostEvidence(component)) return null;
  const planned = component.plannedItemCost as number;
  const failure = component.failureCost as number;
  if (accessSavingClaimed(access) && access != null) {
    return {
      plannedCost: planned + access.sharedAccessCost,
      failureCost: failure + access.sharedAccessCost,
    };
  }
  return { plannedCost: planned, failureCost: failure };
}

function fitOf(
  component: PmComponentInput,
): { beta: number; eta: number; failures: number } | null {
  if (component.method === "none") return null;
  if (
    component.beta == null ||
    component.eta == null ||
    !(component.beta > 0) ||
    !(component.eta > 0) ||
    !(component.failures >= 2)
  ) {
    return null;
  }
  return {
    beta: component.beta,
    eta: component.eta,
    failures: component.failures,
  };
}

function refusedAge(reason: string): AgeReplacementResult {
  return {
    recommended: false,
    optimalAge: null,
    costRateAtOptimum: null,
    runToFailureCostRate: null,
    savingsPct: null,
    reason,
  };
}

function refusedBlock(
  age: AgeReplacementResult,
  reason: string,
): BlockReplacementResult {
  return {
    recommended: false,
    optimalInterval: null,
    costRateAtOptimum: null,
    ageReplacement: age,
    premiumOverAgePct: null,
    reason,
  };
}

/**
 * Opportunistic age τ where h(τ) = c* / (Cf_dedicated − Co).
 * Co is the task cost once access is already paid. Cf_dedicated is the cost
 * of a later failure that must open the asset itself. c* is the dedicated
 * age-replacement cost rate. τ is useful only when it falls before the
 * dedicated preventive age.
 */
export function opportunisticAgeThreshold(
  fit: { beta: number; eta: number; failures: number },
  dedicated: AgeReplacementInput,
  opportunityItemCost: number,
): { thresholdAge: number; preventiveAge: number; costRate: number } | null {
  if (!(fit.beta > 1) || !(opportunityItemCost > 0)) return null;
  const age = optimalAgeReplacement(fit, dedicated);
  if (
    !age.recommended ||
    age.optimalAge == null ||
    age.costRateAtOptimum == null
  ) {
    return null;
  }
  const denominator = dedicated.failureCost - opportunityItemCost;
  if (!(denominator > 0) || !(age.costRateAtOptimum > 0)) return null;
  const threshold = ageAtWeibullFailureRate(
    fit,
    age.costRateAtOptimum / denominator,
  );
  if (threshold == null || threshold >= age.optimalAge) return null;
  return {
    thresholdAge: threshold,
    preventiveAge: age.optimalAge,
    costRate: age.costRateAtOptimum,
  };
}

function commonBlockCost(
  members: Array<{
    plannedItemCost: number;
    failureCost: number;
    fit: { beta: number; eta: number };
  }>,
  T: number,
  chargeSharedAccess: number,
  steps: number,
): number {
  if (!(T > 0)) return Number.POSITIVE_INFINITY;
  let numerator = chargeSharedAccess;
  for (const member of members) {
    const renewals = weibullRenewalFunction(member.fit, T, steps);
    if (chargeSharedAccess > 0) {
      numerator +=
        member.plannedItemCost +
        (member.failureCost + chargeSharedAccess) * renewals;
    } else {
      numerator += member.plannedItemCost + member.failureCost * renewals;
    }
  }
  return numerator / T;
}

function minimizeCommonBlock(
  members: Array<{
    plannedItemCost: number;
    failureCost: number;
    fit: { beta: number; eta: number };
  }>,
  chargeSharedAccess: number,
): { interval: number; costRate: number } | null {
  if (members.length < 2) return null;
  const etas = members.map((member) => member.fit.eta);
  const upper = Math.max(...etas) * 3;
  const lower = Math.min(...etas) * 0.05;
  if (!(upper > lower)) return null;
  const coarse = (T: number) =>
    commonBlockCost(members, T, chargeSharedAccess, 200);
  const steps = 40;
  let bestT = lower;
  let best = Number.POSITIVE_INFINITY;
  for (let i = 1; i <= steps; i += 1) {
    const T = lower + ((upper - lower) * i) / steps;
    const cost = coarse(T);
    if (cost < best) {
      best = cost;
      bestT = T;
    }
  }
  let a = Math.max(lower, bestT - (upper - lower) / steps);
  let b = Math.min(upper, bestT + (upper - lower) / steps);
  const golden = (Math.sqrt(5) - 1) / 2;
  for (let i = 0; i < 36; i += 1) {
    const left = b - golden * (b - a);
    const right = a + golden * (b - a);
    if (coarse(left) < coarse(right)) b = right;
    else a = left;
  }
  const interval = round1((a + b) / 2);
  if (!(interval > 0)) return null;
  const costRate = commonBlockCost(members, interval, chargeSharedAccess, 800);
  if (!Number.isFinite(costRate)) return null;
  return { interval, costRate };
}

export function optimizePmPolicies(
  components: PmComponentInput[],
  access: PmAccessDeclaration | null,
): PmPolicyResult {
  const refusals: string[] = [];
  const savingClaimed = accessSavingClaimed(access);
  const limitations = [
    "Block, opportunistic and common-block results are advisory. A different assigned human must adopt them before any maintenance-plan interval can change.",
    "The opportunistic threshold is the age at which the hazard cost of continuing equals the dedicated policy cost rate, given an access that is already open. It is not a simulated long-run cost of a state-dependent multi-unit policy.",
    "Safety-critical, regulatory, and unknown-applicability tasks are not interval-rewritten by this workflow.",
    "No work order, expenditure, risk acceptance, operating-limit change or return-to-service authority is created.",
  ];
  if (!savingClaimed) {
    limitations.push(
      "No shared-access saving is claimed. A grouping discount requires a named human to record a shared access cost and to state that each task cost excludes it.",
    );
  }

  const pricedRates: number[] = [];
  const blockRates: number[] = [];
  const policies: PmComponentPolicy[] = [];
  const individualRates = new Map<string, number>();
  const eligible: Array<{
    key: string;
    plannedItemCost: number;
    failureCost: number;
    fit: { beta: number; eta: number; failures: number };
  }> = [];

  for (const component of components) {
    const fit = fitOf(component);
    const cost = dedicatedCost(component, access);
    const identity = {
      key: component.key,
      label: component.label,
      method: component.method,
      failures: component.failures,
      suspensions: component.suspensions,
      beta: fit?.beta ?? component.beta,
      eta: fit?.eta ?? component.eta,
      eventIds: component.eventIds,
      planVersion: component.planVersion,
      plannedItemCost: component.plannedItemCost,
      failureCost: component.failureCost,
      safetyCritical: component.safetyCritical,
      regulatoryRequired: component.regulatoryRequired,
      ageHours: component.ageHours,
    };

    if (!fit || !cost) {
      const reason = !fit
        ? `${component.label} has no identifiable life distribution, so no preventive interval is calculated.`
        : `${component.label} has no positive planned-task cost, failure-consequence cost, and cost provenance of at least 20 characters. None is assumed.`;
      refusals.push(reason);
      policies.push({
        ...identity,
        ageReplacement: refusedAge(reason),
        blockReplacement: refusedBlock(refusedAge(reason), reason),
        standingIntervalHours: null,
        applyInterval: false,
        opportunistic: {
          thresholdAge: null,
          preventiveAge: null,
          includeOnOpenAccess: null,
          reason,
        },
        reason,
      });
      continue;
    }

    const age = optimalAgeReplacement(fit, cost);
    const block = optimalBlockReplacement(fit, cost);
    const individualRate =
      age.recommended && age.costRateAtOptimum != null
        ? age.costRateAtOptimum
        : runToFailureCostRate(fit, cost);
    if (Number.isFinite(individualRate)) {
      pricedRates.push(individualRate);
      individualRates.set(component.key, individualRate);
    }
    const blockRate =
      block.recommended && block.costRateAtOptimum != null
        ? block.costRateAtOptimum
        : runToFailureCostRate(fit, cost);
    if (Number.isFinite(blockRate)) blockRates.push(blockRate);

    const opportunity =
      savingClaimed && component.plannedItemCost != null
        ? opportunisticAgeThreshold(fit, cost, component.plannedItemCost)
        : null;
    let include: boolean | null = null;
    let opportunityReason: string;
    if (!savingClaimed) {
      opportunityReason =
        "No opportunistic window is priced because a shared access saving is not established.";
    } else if (opportunity == null) {
      opportunityReason = age.recommended
        ? "The hazard does not justify pulling this component forward before its own preventive age."
        : age.reason;
    } else {
      const threshold = round1(opportunity.thresholdAge);
      const due = round1(opportunity.preventiveAge);
      if (component.ageHours == null) {
        include = null;
        opportunityReason = `Include this component on an already-open access once its age reaches ${threshold}. Current age is not in the evidence, so no include-now instruction is given. Its own preventive age remains ${due}.`;
      } else if (component.ageHours >= due) {
        include = false;
        opportunityReason = `Current age ${round1(component.ageHours)} has reached the dedicated preventive age ${due}. That is its own policy, not an opportunistic pull-forward.`;
      } else if (component.ageHours >= threshold) {
        include = true;
        opportunityReason = `Current age ${round1(component.ageHours)} is inside the opportunistic window ${threshold}–${due}. An already-open access can include it; a dedicated opening is not justified yet.`;
      } else {
        include = false;
        opportunityReason = `Current age ${round1(component.ageHours)} is below the opportunistic threshold ${threshold}. Leave it.`;
      }
    }

    const shareable =
      pmIntervalWriteAllowed(component) &&
      age.recommended &&
      age.optimalAge != null &&
      component.plannedItemCost != null &&
      component.failureCost != null;
    if (
      shareable &&
      component.plannedItemCost != null &&
      component.failureCost != null
    ) {
      eligible.push({
        key: component.key,
        plannedItemCost: component.plannedItemCost,
        failureCost: component.failureCost,
        fit,
      });
    } else if (fit.beta <= 1) {
      refusals.push(
        `${component.label} is excluded from preventive grouping because its failure rate is not increasing.`,
      );
    } else if (!pmIntervalWriteAllowed(component)) {
      refusals.push(
        `${component.label} stays off a shared interval because safety-critical or regulatory applicability is true or unknown.`,
      );
    }

    const standing =
      age.recommended && age.optimalAge != null ? age.optimalAge : null;
    policies.push({
      ...identity,
      ageReplacement: age,
      blockReplacement: block,
      standingIntervalHours: standing,
      applyInterval: standing != null && pmIntervalWriteAllowed(component),
      opportunistic: {
        thresholdAge:
          opportunity == null ? null : round1(opportunity.thresholdAge),
        preventiveAge:
          opportunity == null ? null : round1(opportunity.preventiveAge),
        includeOnOpenAccess: include,
        reason: opportunityReason,
      },
      reason: block.recommended
        ? `${age.reason} ${block.reason}`
        : `${age.reason} ${block.reason}`,
    });
  }

  const separateAgeRate =
    pricedRates.length > 0
      ? round6(pricedRates.reduce((sum, rate) => sum + rate, 0))
      : null;
  const separateBlockRate =
    blockRates.length > 0
      ? round6(blockRates.reduce((sum, rate) => sum + rate, 0))
      : null;
  const charge = savingClaimed && access != null ? access.sharedAccessCost : 0;
  const grouped = minimizeCommonBlock(eligible, charge);
  const eligibleKeys = new Set(eligible.map((member) => member.key));
  const ineligibleRate = [...individualRates.entries()].reduce(
    (sum, [key, rate]) => (eligibleKeys.has(key) ? sum : sum + rate),
    0,
  );

  let commonRecommended = false;
  let commonInterval: number | null = null;
  let commonRate: number | null = null;
  let premium: number | null = null;
  let commonReason: string;
  if (grouped == null) {
    commonReason =
      eligible.length < 2
        ? "A common block needs at least two components whose own age replacement is recommended and whose safety and regulatory applicability are explicitly false."
        : "No finite common block interval could be priced.";
  } else if (separateAgeRate == null) {
    commonReason =
      "Separate age policies could not be priced, so a common block is not selected.";
  } else {
    const comparable = round6(grouped.costRate + ineligibleRate);
    premium =
      separateAgeRate > 0
        ? round1(((comparable - separateAgeRate) / separateAgeRate) * 100)
        : null;
    commonInterval = grouped.interval;
    commonRate = comparable;
    // Require a clear saving. A fraction of a percent is search noise, and
    // block replacement is known not to beat age replacement on its own.
    if (comparable < separateAgeRate * 0.995) {
      commonRecommended = true;
      commonReason = `One shared interval of ${grouped.interval} prices at ${comparable} per unit time, ${Math.abs(premium ?? 0).toFixed(1)}% below the sum of the separate age policies. ${charge > 0 ? "The recorded shared access cost is paid once." : "No shared-access saving is included in that comparison."}`;
    } else {
      commonReason = `The best common interval of ${grouped.interval} does not beat separate age replacement${premium != null ? ` (premium ${premium}%)` : ""}. ${charge > 0 ? "The shared access cost was included." : "No shared-access saving was claimed."}`;
    }
  }

  const opportunisticApplicable = policies.some(
    (policy) => policy.opportunistic.thresholdAge != null,
  );
  const selected: PmPolicyResult["selected"] =
    pricedRates.length === 0
      ? "evidence_gap"
      : commonRecommended
        ? "common_block"
        : "separate_age";

  if (selected === "common_block" && commonInterval != null) {
    for (const policy of policies) {
      if (!eligible.some((member) => member.key === policy.key)) continue;
      policy.standingIntervalHours = commonInterval;
      policy.applyInterval = true;
    }
  }

  const recommendationReason =
    selected === "evidence_gap"
      ? "No component has both an identifiable life distribution and recorded planned and failure costs, so no preventive policy is selected."
      : selected === "common_block"
        ? commonReason
        : "Separate age-replacement policies are retained. Block replacement is reported for each component and is not selected over age replacement. A common interval is not cheaper on these costs.";

  return {
    ...AUTHORITY,
    components: policies,
    separateAge: {
      costRate: separateAgeRate,
      reason:
        separateAgeRate == null
          ? "No component could be priced."
          : `Sum of individual age-replacement cost rates, or run-to-failure where age replacement is refused: ${separateAgeRate}.`,
    },
    separateBlock: {
      costRate: separateBlockRate,
      reason:
        separateBlockRate == null
          ? "No component could be priced as a block policy."
          : `Sum of individual block cost rates, or run-to-failure where block replacement is refused: ${separateBlockRate}. Block replacement is not selected merely because a calendar is convenient.`,
    },
    commonBlock: {
      recommended: commonRecommended,
      intervalHours: commonRecommended ? commonInterval : commonInterval,
      costRate: commonRate,
      memberKeys: grouped == null ? [] : eligible.map((member) => member.key),
      premiumOverSeparateAgePct: premium,
      reason: commonReason,
    },
    opportunistic: {
      applicable: opportunisticApplicable,
      reason: opportunisticApplicable
        ? "At least one component has an opportunistic age below its own preventive age. Include it only when an access is already open and its age has reached that threshold."
        : savingClaimed
          ? "A shared access cost is recorded, but no component has an opportunistic window before its own preventive age."
          : "Opportunistic grouping is not priced until a shared access saving is recorded.",
    },
    selected,
    recommendation: {
      kind: selected,
      reason: recommendationReason,
      humanApprovalRequired: true,
    },
    refusals,
    limitations,
  };
}
