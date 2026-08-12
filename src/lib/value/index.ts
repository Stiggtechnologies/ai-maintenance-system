/**
 * Financial and value-management controls (register E9.01–E9.08, E9.11).
 *
 * Four pieces of arithmetic, each guarding a specific way these decisions go
 * wrong in practice.
 *
 * 1. NPV, done properly. Discounting is not controversial; getting the sign
 *    convention and the timing right is where errors live. Costs are negative,
 *    benefits positive, and period 0 is undiscounted.
 *
 * 2. EQUIVALENT ANNUAL COST, because comparing the NPV of a 10-year option
 *    against the NPV of a 20-year option is a category error that looks like
 *    analysis. The 20-year option will usually "win" simply by lasting longer.
 *    `compareOptions` REFUSES to rank on NPV when the lives differ and ranks
 *    on EAC instead, saying so.
 *
 * 3. PRIORITISATION UNDER A BUDGET is not "rank by NPV". Ranking by value per
 *    pound spent fits more value into the same budget, and the difference is
 *    reported rather than assumed away. Where there is no budget constraint
 *    there is no prioritisation problem, and the module says that too.
 *
 * 4. SENSITIVITY answers the only question that matters about an assumption:
 *    at what value does the decision REVERSE? A tornado chart of ±10% swings
 *    is decoration; the break-even point is the thing a person can argue with.
 *
 * WHAT IS NOT CLAIMED. Expected value is not risk. `costOfRisk` returns the
 * expectation and says in the same breath that a 1-in-1000 chance of a
 * £50m loss and a certain £50k loss have the same expected value and are not
 * the same decision.
 *
 * Pure: no database, no network.
 */

export interface CashFlow {
  /** Period index. 0 is today and is not discounted. */
  period: number;
  /** Negative for cost, positive for benefit. */
  amount: number;
}

/** Net present value at a per-period discount rate. */
export function npv(cashFlows: CashFlow[], rate: number): number {
  return cashFlows.reduce(
    (sum, cf) => sum + cf.amount / Math.pow(1 + rate, cf.period),
    0,
  );
}

/**
 * Capital recovery factor: the annuity that has the same present value as 1.
 *
 *     CRF = r(1+r)^n / ((1+r)^n − 1),  and 1/n when r = 0.
 */
export function capitalRecoveryFactor(rate: number, periods: number): number {
  if (periods <= 0) return 0;
  if (rate === 0) return 1 / periods;
  const g = Math.pow(1 + rate, periods);
  return (rate * g) / (g - 1);
}

/** The level annual amount equivalent to a present value over `life`. */
export function equivalentAnnual(
  presentValue: number,
  life: number,
  rate: number,
): number {
  return presentValue * capitalRecoveryFactor(rate, life);
}

export interface Option {
  label: string;
  cashFlows: CashFlow[];
  /** Service life in periods. Options with different lives cannot share NPV. */
  lifePeriods: number;
}

export interface RankedOption {
  label: string;
  npv: number;
  equivalentAnnual: number;
  lifePeriods: number;
}

export interface OptionComparison {
  basis: "npv" | "equivalent_annual";
  ranked: RankedOption[];
  best: string | null;
  /** True when ranking on NPV would have chosen differently. */
  npvWouldMislead: boolean;
  reason: string;
}

/**
 * Rank options, on the right basis.
 *
 * Where every option has the same life, NPV is a fair comparison. Where lives
 * differ it is not, and the module switches to equivalent annual cost and
 * reports whether the naive NPV ranking would have picked a different winner.
 */
export function compareOptions(
  options: Option[],
  rate: number,
): OptionComparison {
  if (options.length === 0) {
    return {
      basis: "npv",
      ranked: [],
      best: null,
      npvWouldMislead: false,
      reason: "No options were supplied.",
    };
  }

  const withValues: RankedOption[] = options.map((o) => {
    const value = npv(o.cashFlows, rate);
    return {
      label: o.label,
      npv: value,
      equivalentAnnual: equivalentAnnual(value, o.lifePeriods, rate),
      lifePeriods: o.lifePeriods,
    };
  });

  const livesDiffer = new Set(options.map((o) => o.lifePeriods)).size > 1;
  const basis = livesDiffer ? ("equivalent_annual" as const) : ("npv" as const);

  const byNpv = [...withValues].sort((a, b) => b.npv - a.npv);
  const byEac = [...withValues].sort(
    (a, b) => b.equivalentAnnual - a.equivalentAnnual,
  );
  const ranked = livesDiffer ? byEac : byNpv;
  const misleads = livesDiffer && byNpv[0].label !== byEac[0].label;

  return {
    basis,
    ranked,
    best: ranked[0].label,
    npvWouldMislead: misleads,
    reason: livesDiffer
      ? `Options have different service lives (${[...new Set(options.map((o) => o.lifePeriods))].sort((a, b) => a - b).join(", ")} periods), so their NPVs are NOT comparable — a longer-lived option accumulates more value simply by lasting longer. Ranked on equivalent annual value instead.` +
        (misleads
          ? ` Ranking on raw NPV would have chosen ${byNpv[0].label}; on the correct basis the best is ${byEac[0].label}. That is the error this comparison exists to prevent.`
          : ` On this set both bases happen to agree on ${byEac[0].label}, which is luck rather than a reason to trust NPV next time.`)
      : `All options share a ${options[0].lifePeriods}-period life, so NPV is a fair comparison. Best is ${byNpv[0].label} at ${byNpv[0].npv.toFixed(0)}.`,
  };
}

export interface Candidate {
  label: string;
  cost: number;
  /** Present value of the benefit. */
  benefit: number;
}

export interface PrioritisationResult {
  selected: string[];
  rejected: string[];
  totalCost: number;
  totalBenefit: number;
  /** Benefit that ranking by raw size would have left on the table. */
  benefitLostToNaiveRanking: number;
  reason: string;
}

/**
 * Choose what to fund within a budget (E9.06).
 *
 * Greedy on benefit-per-unit-cost, which is the standard and near-optimal
 * approach for this shape of problem. Compared explicitly against ranking by
 * raw benefit, because that is what most capital lists actually do and the
 * difference is the point.
 */
export function prioritiseUnderBudget(
  candidates: Candidate[],
  budget: number,
): PrioritisationResult {
  if (candidates.length === 0) {
    return {
      selected: [],
      rejected: [],
      totalCost: 0,
      totalBenefit: 0,
      benefitLostToNaiveRanking: 0,
      reason: "No candidates were supplied.",
    };
  }
  if (!(budget > 0)) {
    return {
      selected: [],
      rejected: candidates.map((c) => c.label),
      totalCost: 0,
      totalBenefit: 0,
      benefitLostToNaiveRanking: 0,
      reason:
        "No budget is set, so there is no prioritisation problem to solve — only a list. Prioritisation is what a constraint forces; without one, the question is which of these is worth doing at all, which is a different analysis.",
    };
  }

  const fit = (order: Candidate[]) => {
    let spend = 0;
    const taken: Candidate[] = [];
    for (const c of order) {
      if (c.cost <= 0) continue;
      if (spend + c.cost <= budget) {
        spend += c.cost;
        taken.push(c);
      }
    }
    return {
      taken,
      spend,
      benefit: taken.reduce((s, c) => s + c.benefit, 0),
    };
  };

  const byRatio = fit(
    [...candidates].sort((a, b) => b.benefit / b.cost - a.benefit / a.cost),
  );
  const byBenefit = fit([...candidates].sort((a, b) => b.benefit - a.benefit));

  const chosen = new Set(byRatio.taken.map((c) => c.label));
  const lost = byRatio.benefit - byBenefit.benefit;

  return {
    selected: byRatio.taken.map((c) => c.label),
    rejected: candidates
      .filter((c) => !chosen.has(c.label))
      .map((c) => c.label),
    totalCost: byRatio.spend,
    totalBenefit: byRatio.benefit,
    benefitLostToNaiveRanking: lost,
    reason:
      `${byRatio.taken.length} of ${candidates.length} candidate(s) fit within ${budget.toFixed(0)}, spending ${byRatio.spend.toFixed(0)} for ${byRatio.benefit.toFixed(0)} of benefit.` +
      (lost > 0
        ? ` Ranking by raw benefit instead of benefit-per-unit-cost would have returned ${byBenefit.benefit.toFixed(0)} — ${lost.toFixed(0)} less from the same budget. That gap is what a capital list ordered by size costs.`
        : ` Ranking by raw benefit would have produced the same result on this set.`),
  };
}

export interface SensitivityResult {
  parameter: string;
  baseValue: number;
  baseOutcome: number;
  /** The value at which the outcome crosses zero, if it does in range. */
  breakEven: number | null;
  /** How far the parameter can move before the decision reverses, as a share. */
  headroomPct: number | null;
  reason: string;
}

/**
 * At what value of this assumption does the decision reverse? (E9.11)
 *
 * Bisection on a monotone outcome. A ±10% swing chart is decoration; the
 * break-even point is what a person can actually argue with — "this only
 * stacks up if availability improves by more than 4 points" is a sentence
 * somebody can agree or disagree with.
 */
export function findBreakEven(
  parameter: string,
  baseValue: number,
  outcomeFor: (value: number) => number,
  searchLow: number,
  searchHigh: number,
  iterations = 60,
): SensitivityResult {
  const baseOutcome = outcomeFor(baseValue);
  const lowOutcome = outcomeFor(searchLow);
  const highOutcome = outcomeFor(searchHigh);

  if (lowOutcome === 0 || highOutcome === 0 || lowOutcome * highOutcome > 0) {
    return {
      parameter,
      baseValue,
      baseOutcome,
      breakEven: null,
      headroomPct: null,
      reason:
        `The decision does not reverse anywhere between ${searchLow} and ${searchHigh} for ${parameter}. ` +
        `Within that range the answer is robust to this assumption, which is worth more than a precise number: ` +
        `it means arguing about ${parameter} is not the argument to have.`,
    };
  }

  let lo = searchLow;
  let hi = searchHigh;
  let loVal = lowOutcome;
  for (let i = 0; i < iterations; i++) {
    const mid = (lo + hi) / 2;
    const v = outcomeFor(mid);
    if (v === 0) {
      lo = hi = mid;
      break;
    }
    if (loVal * v < 0) {
      hi = mid;
    } else {
      lo = mid;
      loVal = v;
    }
  }
  const breakEven = (lo + hi) / 2;
  const headroom =
    baseValue !== 0
      ? Math.abs(breakEven - baseValue) / Math.abs(baseValue)
      : null;

  return {
    parameter,
    baseValue,
    baseOutcome,
    breakEven,
    headroomPct: headroom,
    reason:
      `The decision reverses when ${parameter} reaches ${breakEven.toPrecision(4)}, against a base assumption of ${baseValue}. ` +
      (headroom !== null
        ? `That is ${(headroom * 100).toFixed(0)}% away from the assumption — ` +
          (headroom < 0.1
            ? `close enough that the answer rests on this number being right.`
            : headroom < 0.5
              ? `enough margin to proceed, but this is the assumption to challenge first.`
              : `far enough that this assumption is not what the decision turns on.`)
        : ""),
  };
}

export interface RiskCost {
  expectedAnnualCost: number;
  reason: string;
}

/**
 * Cost of risk (E9.08), with the caveat stated rather than buried.
 *
 * Expected value is the right input to a portfolio decision and the wrong
 * input to a survival decision, and the difference is not a nuance.
 */
export function costOfRisk(
  annualProbability: number,
  consequenceCost: number,
): RiskCost {
  if (!(annualProbability >= 0 && annualProbability <= 1)) {
    return {
      expectedAnnualCost: 0,
      reason: "An annual probability must lie between 0 and 1.",
    };
  }
  const expected = annualProbability * consequenceCost;
  const returnPeriod = annualProbability > 0 ? 1 / annualProbability : Infinity;

  return {
    expectedAnnualCost: expected,
    reason:
      `${(annualProbability * 100).toFixed(2)}% a year against a consequence of ${consequenceCost.toFixed(0)} is an expected annual cost of ${expected.toFixed(0)} — ` +
      (Number.isFinite(returnPeriod)
        ? `roughly one event every ${returnPeriod.toFixed(0)} years. `
        : "") +
      `Expected value is not risk: this same figure would arise from a certain small loss, and the two are not the same decision. ` +
      (consequenceCost > 0 && annualProbability < 0.01
        ? `A low-probability, high-consequence exposure like this one is exactly where an expected value misleads, because the organisation experiences the event or it does not — never the average.`
        : ""),
  };
}
