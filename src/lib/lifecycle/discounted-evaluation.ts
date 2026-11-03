/**
 * Customer-facing repair / replace / redesign / defer comparison.
 *
 * Consumer of BOK-07. The discounted arithmetic stays in
 * `compareLifeCycleOptions` (`src/lib/lifecycle/discounted-lcc.ts`). This
 * module only turns supplied asset economics and the deferral consequence
 * into cash flows, then refuses when a governed discount policy or two
 * priced options are absent. It does not invent a rate, a sensitivity band,
 * a redesign cost, or a post-replacement maintenance spend.
 *
 * Sign convention matches the kernel: costs are positive. Recurring costs
 * are placed at each whole year-end, and a fractional final year is a named
 * pro-rata flow at the stated life. Capital is placed at year 0.
 */
import type { WeibullFit } from "../reliability";
import {
  compareLifeCycleOptions,
  type DiscountPolicy,
  type LccComparison,
  type LccOption,
} from "./discounted-lcc";
import {
  assessUncertainty,
  type AssetEconomics,
  type DeferralRisk,
  type OptionCost,
  type Uncertainty,
} from "./index";

const DAYS_PER_YEAR = 365;

export interface DiscountedOptionView {
  option: OptionCost["option"];
  /** Equivalent annual cost at the governed rate, or null when unpriced. */
  annualCostUsd: number | null;
  npv: number | null;
  undiscountedEac: number | null;
  missingInputs: string[];
  basis: string;
}

export interface DiscountedLifecycleEvaluation {
  options: DiscountedOptionView[];
  recommended: OptionCost["option"] | null;
  uncertainty: Uncertainty;
  rationale: string;
  comparison: LccComparison | null;
  refusal: string | null;
}

export interface DiscountedLifecycleRequest {
  economics: AssetEconomics;
  risk: DeferralRisk;
  redesignCostUsd: number | null;
  redesignMaintenanceReductionPct: number | null;
  /** Null when the tenant has no usable finance-owned rate. Never defaulted. */
  policy: DiscountPolicy | null;
  fit: Pick<WeibullFit, "failures" | "converged">;
}

const MISSING_POLICY =
  "No governed discount rate is available, so repair, replace, redesign and defer are not ranked on life-cycle cost. The rate is not assumed.";

function policyRefusal(policy: DiscountPolicy | null): string | null {
  if (!policy) return MISSING_POLICY;
  if (!(policy.rate >= 0 && policy.rate < 1) || !Number.isFinite(policy.rate)) {
    return "The discount rate must be a finite fraction in [0, 1). It is a corporate input and is not assumed.";
  }
  if (!policy.owner?.trim() || policy.basis.trim().length < 15) {
    return "The discount rate needs a named owner and a stated basis of at least 15 characters.";
  }
  return null;
}

function recurringFlows(
  annual: number,
  lifeYears: number,
  label: string,
): LccOption["cashFlows"] {
  const flows: LccOption["cashFlows"] = [];
  const whole = Math.floor(lifeYears + 1e-9);
  for (let year = 1; year <= whole; year += 1) {
    flows.push({ year, amount: annual, label });
  }
  const remainder = lifeYears - whole;
  if (remainder > 1e-6) {
    flows.push({
      year: lifeYears,
      amount: annual * remainder,
      label: `${label} (partial year)`,
    });
  }
  return flows;
}

interface DraftOption {
  option: OptionCost["option"];
  missing: string[];
  lifeYears: number | null;
  cashFlows: LccOption["cashFlows"] | null;
  basis: string;
}

function finiteNonNegative(
  value: number | null,
  label: string,
  missing: string[],
) {
  if (value == null) {
    missing.push(label);
    return false;
  }
  if (!Number.isFinite(value) || value < 0) {
    missing.push(`${label} (negative or non-numeric cost is refused)`);
    return false;
  }
  return true;
}

function buildDrafts(request: DiscountedLifecycleRequest): DraftOption[] {
  const { economics: econ, risk } = request;
  const life = econ.expectedRemainingLifeYears;
  const lifeOk = life != null && Number.isFinite(life) && life > 0;

  const repairMissing: string[] = [];
  finiteNonNegative(
    econ.annualMaintenanceCostUsd,
    "annual maintenance cost",
    repairMissing,
  );
  if (!lifeOk) repairMissing.push("expected remaining life");
  const repair: DraftOption = {
    option: "repair",
    missing: repairMissing,
    lifeYears: lifeOk ? life : null,
    cashFlows:
      repairMissing.length === 0
        ? recurringFlows(
            econ.annualMaintenanceCostUsd as number,
            life as number,
            "recurring maintenance",
          )
        : null,
    basis:
      "Discounted equivalent annual cost of the supplied recurring maintenance spend over the stated remaining life. A partial final year is prorated and named. Failure consequence is not added on this option.",
  };

  const replaceMissing: string[] = [];
  finiteNonNegative(
    econ.replacementValueUsd,
    "replacement value",
    replaceMissing,
  );
  if (!lifeOk) replaceMissing.push("expected life of the replacement");
  const replace: DraftOption = {
    option: "replace",
    missing: replaceMissing,
    lifeYears: lifeOk ? life : null,
    cashFlows:
      replaceMissing.length === 0
        ? [
            {
              year: 0,
              amount: econ.replacementValueUsd as number,
              label: "replacement capital",
            },
          ]
        : null,
    basis:
      "Replacement capital at the decision date, spread by the capital-recovery factor over the stated life. Later maintenance of the replacement is omitted because it was not supplied.",
  };

  const redesignMissing: string[] = [];
  finiteNonNegative(request.redesignCostUsd, "redesign cost", redesignMissing);
  if (request.redesignMaintenanceReductionPct == null) {
    redesignMissing.push("expected maintenance reduction");
  } else if (
    !Number.isFinite(request.redesignMaintenanceReductionPct) ||
    request.redesignMaintenanceReductionPct < 0 ||
    request.redesignMaintenanceReductionPct > 100
  ) {
    redesignMissing.push(
      "redesign maintenance reduction (must be from 0 to 100 percent)",
    );
  }
  finiteNonNegative(
    econ.annualMaintenanceCostUsd,
    "annual maintenance cost",
    redesignMissing,
  );
  if (!lifeOk) redesignMissing.push("remaining life over which to spread it");
  const redesign: DraftOption = {
    option: "redesign",
    missing: redesignMissing,
    lifeYears: lifeOk ? life : null,
    cashFlows: null,
    basis:
      "Engineering spend at the decision date, plus the reduced recurring maintenance it is stated to buy. The reduction is the supplied percentage, not an assumed one.",
  };
  if (redesignMissing.length === 0) {
    const reduced =
      (econ.annualMaintenanceCostUsd as number) *
      (1 - (request.redesignMaintenanceReductionPct as number) / 100);
    redesign.cashFlows = [
      {
        year: 0,
        amount: request.redesignCostUsd as number,
        label: "redesign capital",
      },
      ...recurringFlows(reduced, life as number, "reduced maintenance"),
    ];
  }

  const deferMissing = [...risk.missingInputs];
  const horizon =
    Number.isFinite(risk.windowDays) && risk.windowDays > 0
      ? risk.windowDays / DAYS_PER_YEAR
      : null;
  if (horizon == null) deferMissing.push("deferral window");
  if (risk.expectedCostUsd == null) {
    // missingInputs from deferralRisk already names the absent prices.
  } else if (
    !Number.isFinite(risk.expectedCostUsd) ||
    risk.expectedCostUsd < 0
  ) {
    deferMissing.push("deferral consequence (negative cost is refused)");
  }
  const defer: DraftOption = {
    option: "defer",
    missing: [...new Set(deferMissing)],
    lifeYears: horizon,
    cashFlows:
      deferMissing.length === 0
        ? [
            {
              year: horizon as number,
              amount: risk.expectedCostUsd as number,
              label: "expected failure cost over the deferral",
            },
          ]
        : null,
    basis: `Expected failure cost at the end of the ${risk.windowDays}-day deferral. Consequence is the supplied downtime cost per hour times the supplied repair hours times the conditional failure probability. No separate consequence score is invented.`,
  };

  return [repair, replace, redesign, defer];
}

function viewsFrom(
  drafts: DraftOption[],
  comparison: LccComparison | null,
): DiscountedOptionView[] {
  const priced = new Map(
    comparison?.options.map((option) => [option.name, option]),
  );
  return drafts.map((draft) => {
    const row = priced.get(draft.option);
    return {
      option: draft.option,
      annualCostUsd: row ? row.eac : null,
      npv: row ? row.npv : null,
      undiscountedEac: row ? row.undiscountedEac : null,
      missingInputs: draft.missing,
      basis: draft.basis,
    };
  });
}

/** Rank supplied options at a governed discount rate, or refuse. */
export function buildDiscountedLifecycleComparison(
  request: DiscountedLifecycleRequest,
): DiscountedLifecycleEvaluation {
  const drafts = buildDrafts(request);
  const refusedPolicy = policyRefusal(request.policy);
  const comparable: LccOption[] = drafts
    .filter(
      (draft) => draft.cashFlows && draft.lifeYears && draft.lifeYears > 0,
    )
    .map((draft) => ({
      name: draft.option,
      lifeYears: draft.lifeYears as number,
      cashFlows: draft.cashFlows as LccOption["cashFlows"],
    }));

  let comparison: LccComparison | null = null;
  let refusal = refusedPolicy;
  if (!refusal && comparable.length < 2) {
    refusal =
      "Fewer than two options have complete cash flows, so they are not ranked. Ranking one priced option against named gaps would present a default as a life-cycle-cost decision.";
  }
  if (!refusal && request.policy) {
    comparison = compareLifeCycleOptions(comparable, request.policy);
  }

  const options = viewsFrom(drafts, comparison);
  const uncertainty = assessUncertainty(request.fit, options);
  const recommended =
    comparison &&
    (comparison.preferred === "repair" ||
      comparison.preferred === "replace" ||
      comparison.preferred === "redesign" ||
      comparison.preferred === "defer")
      ? comparison.preferred
      : null;

  return {
    options,
    recommended,
    uncertainty,
    comparison,
    refusal,
    rationale: refusal ?? comparison?.reason ?? MISSING_POLICY,
  };
}
