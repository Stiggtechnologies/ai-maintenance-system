/**
 * Discount-rate sensitivity for a recorded business case (E9.11).
 *
 * The question is the one `findBreakEven` exists to answer: at what recorded
 * assumption does the decision reverse? The assumption analysed here is the
 * business case's own discount rate, because that rate is the one input whose
 * effect on the recorded cash flows is defined by the shared NPV kernel.
 *
 * What this does not do:
 * - invent a confidence interval, hurdle rate, or ± band;
 * - apply recorded benefit probabilities the option comparison does not apply;
 * - read or fabricate SAP actuals. Cash flows stay the tenant's recorded rows.
 */
import {
  cashFlowsDefect,
  compareOptions,
  findBreakEven,
  type Option,
  type OptionComparison,
  type SensitivityResult,
} from "./index.ts";

/** Inclusive lower bound of `business_cases.discount_rate`. */
const DISCOUNT_RATE_DOMAIN_LOW = 0;
/**
 * Numerical stand-in for the open upper bound `discount_rate < 1`.
 * This is the stored domain, not a recommended rate.
 */
const DISCOUNT_RATE_DOMAIN_HIGH = 0.999999;
/** Evenly spaced probes used only to refuse a non-single-crossing margin. */
const DOMAIN_SAMPLES = 33;

export const SENSITIVITY_UNCERTAINTY_NOTE =
  "No uncertainty interval, confidence level, or probability distribution is recorded on the discount rate. Headroom is the distance from the recorded point assumption to the break-even, not a confidence interval. A single break-even is stated only when the decision margin changes sign once on 33 evenly spaced rates plus the recorded rate, across the stored domain [0, 1); a narrower reversal between those samples is not ruled out. Recorded benefit probabilities are not applied by the option-comparison kernel and are not turned into a probability-weighted case. Cash flows are the tenant's recorded business-case rows; SAP actuals are not read or substituted.";

export interface BusinessCaseSensitivity {
  status: "computed" | "refused";
  parameter: "discount_rate";
  baseValue: number | null;
  discountRateSource: string | null;
  basis: "npv" | "equivalent_annual" | null;
  baseBest: string | null;
  baseAlternative: string | null;
  decision: string | null;
  breakEven: number | null;
  headroomPct: number | null;
  reason: string;
  refusal: string | null;
  uncertainty: string;
  /** Constant. This function has no SAP client. */
  sapActualsUsed: false;
  searchLow: number | null;
  searchHigh: number | null;
  /**
   * Inclusive sample points where the base winner's margin stays positive.
   * Present only when a single break-even was refused and that lead is one
   * contiguous block of samples. These are not solved roots.
   */
  sampledLeadLow: number | null;
  sampledLeadHigh: number | null;
}

export interface BusinessCaseSensitivityInput {
  options: Option[];
  discountRate: number;
  discountRateSource: string | null;
}

function blank(
  source: string | null,
  baseValue: number | null,
  refusal: string,
  search?: { low: number; high: number },
): BusinessCaseSensitivity {
  return {
    status: "refused",
    parameter: "discount_rate",
    baseValue,
    discountRateSource: source,
    basis: null,
    baseBest: null,
    baseAlternative: null,
    decision: null,
    breakEven: null,
    headroomPct: null,
    reason: refusal,
    refusal,
    uncertainty: SENSITIVITY_UNCERTAINTY_NOTE,
    sapActualsUsed: false,
    searchLow: search?.low ?? null,
    searchHigh: search?.high ?? null,
    sampledLeadLow: null,
    sampledLeadHigh: null,
  };
}

function contiguousPositiveSpan(
  rates: number[],
  margins: number[],
): { low: number | null; high: number | null } {
  const positive = margins.map((margin) => margin > 0);
  const first = positive.indexOf(true);
  const last = positive.lastIndexOf(true);
  if (first < 0) return { low: null, high: null };
  for (let i = first; i <= last; i += 1) {
    if (!positive[i]) return { low: null, high: null };
  }
  return { low: rates[first], high: rates[last] };
}

function score(
  comparison: OptionComparison,
  basis: "npv" | "equivalent_annual",
  label: string,
): number {
  const row = comparison.ranked.find((item) => item.label === label);
  if (!row) return Number.NaN;
  return basis === "npv" ? row.npv : row.equivalentAnnual;
}

function signChanges(values: number[]): number {
  let changes = 0;
  let previous: number | null = null;
  for (const value of values) {
    if (!Number.isFinite(value) || value === 0) continue;
    const sign = Math.sign(value);
    if (previous !== null && previous !== sign) changes += 1;
    previous = sign;
  }
  return changes;
}

function domainRates(low: number, high: number): number[] {
  const rates: number[] = [];
  for (let i = 0; i < DOMAIN_SAMPLES; i += 1) {
    const t = i / (DOMAIN_SAMPLES - 1);
    rates.push(low + t * (high - low));
  }
  return rates;
}

/**
 * Break-even of the recorded ranking against the business case discount rate.
 *
 * The outcome is the margin of the base-rate winner over the best other
 * option on the same basis `compareOptions` uses (NPV when lives match,
 * equivalent annual value when they do not). With one option the margin is
 * that option's score, so zero is the do-versus-don't boundary.
 */
export function analyseBusinessCaseSensitivity(
  input: BusinessCaseSensitivityInput,
): BusinessCaseSensitivity {
  const source = input.discountRateSource?.trim() || null;
  const rate = input.discountRate;
  if (!Number.isFinite(rate) || rate < 0 || rate >= 1) {
    return blank(
      source,
      Number.isFinite(rate) ? rate : null,
      "The business-case discount rate is not a finite rate in the stored domain [0, 1).",
    );
  }

  if (input.options.length === 0) {
    return blank(
      source,
      rate,
      "No business-case options are recorded, so there is no decision whose reversal can be located.",
    );
  }

  const labels = input.options.map((option) => option.label);
  if (labels.some((label) => label.trim() === "")) {
    return blank(
      source,
      rate,
      "A business-case option has no label, so a ranking cannot name it.",
    );
  }
  if (new Set(labels).size !== labels.length) {
    return blank(
      source,
      rate,
      "Business-case option labels are not unique, so a reversed ranking could not name one option.",
    );
  }

  for (const option of input.options) {
    if (!Number.isInteger(option.lifePeriods) || option.lifePeriods <= 0) {
      return blank(
        source,
        rate,
        `${option.label}: service life is not a positive whole number of periods.`,
      );
    }
    if (option.cashFlows.length === 0) {
      return blank(
        source,
        rate,
        `${option.label}: no cash flows are recorded, so discounting has nothing to vary.`,
      );
    }
    const defect = cashFlowsDefect(option.cashFlows);
    if (defect) return blank(source, rate, `${option.label}: ${defect}`);
  }

  const searchLow = DISCOUNT_RATE_DOMAIN_LOW;
  const searchHigh = Math.max(DISCOUNT_RATE_DOMAIN_HIGH, rate);
  if (!(searchHigh < 1) || searchHigh <= searchLow) {
    return blank(
      source,
      rate,
      "The stored discount-rate domain does not leave a range in which a reversal can be searched.",
      { low: searchLow, high: searchHigh },
    );
  }

  const baseComparison = compareOptions(input.options, rate);
  const basis = baseComparison.basis;
  const baseBest = baseComparison.best;
  if (!baseBest) {
    return blank(
      source,
      rate,
      "The recorded options did not produce a ranking.",
      {
        low: searchLow,
        high: searchHigh,
      },
    );
  }
  const runnerUp =
    baseComparison.ranked.find((row) => row.label !== baseBest)?.label ?? null;
  const decision = runnerUp
    ? `Margin of ${baseBest} over the best other recorded option on ${basis === "npv" ? "NPV" : "equivalent annual value"}. Zero is where that ranking reverses.`
    : `Score of ${baseBest} on ${basis === "npv" ? "NPV" : "equivalent annual value"}. Zero is where this single option stops supporting the case.`;

  const margin = (candidate: number): number => {
    const comparison = compareOptions(input.options, candidate);
    const bestScore = score(comparison, basis, baseBest);
    if (!runnerUp) return bestScore;
    let alternative = Number.NEGATIVE_INFINITY;
    for (const row of comparison.ranked) {
      if (row.label === baseBest) continue;
      const value = basis === "npv" ? row.npv : row.equivalentAnnual;
      if (value > alternative) alternative = value;
    }
    return bestScore - alternative;
  };

  const rates = [
    ...new Set([...domainRates(searchLow, searchHigh), rate]),
  ].sort((a, b) => a - b);
  const probed = rates.map(margin);
  if (probed.some((value) => !Number.isFinite(value))) {
    return {
      ...blank(
        source,
        rate,
        "The decision margin is not finite across the stored discount-rate domain, so no break-even is stated.",
        { low: searchLow, high: searchHigh },
      ),
      basis,
      baseBest,
      baseAlternative: runnerUp,
      decision,
    };
  }

  const crossings = signChanges(probed);
  if (crossings > 1) {
    const lead = contiguousPositiveSpan(rates, probed);
    const leadNote =
      lead.low == null || lead.high == null
        ? ""
        : ` On these samples ${baseBest} leads from ${lead.low.toPrecision(4)} through ${lead.high.toPrecision(4)}. Those are sample points, not solved roots.`;
    return {
      ...blank(
        source,
        rate,
        `The decision margin changes sign ${crossings} times between ${searchLow} and ${searchHigh}. A single break-even would overclaim which rate the ranking turns on, so none is stated.${leadNote}`,
        { low: searchLow, high: searchHigh },
      ),
      basis,
      baseBest,
      baseAlternative: runnerUp,
      decision,
      sampledLeadLow: lead.low,
      sampledLeadHigh: lead.high,
    };
  }

  const kernel: SensitivityResult = findBreakEven(
    "discount rate",
    rate,
    margin,
    searchLow,
    searchHigh,
  );
  if (crossings === 1 && kernel.breakEven === null) {
    return {
      ...blank(
        source,
        rate,
        "The decision margin changes sign once, but no single break-even rate was returned. None is stated.",
        { low: searchLow, high: searchHigh },
      ),
      basis,
      baseBest,
      baseAlternative: runnerUp,
      decision,
    };
  }

  return {
    status: "computed",
    parameter: "discount_rate",
    baseValue: rate,
    discountRateSource: source,
    basis,
    baseBest,
    baseAlternative: runnerUp,
    decision,
    breakEven: kernel.breakEven,
    headroomPct: kernel.headroomPct,
    reason: kernel.reason,
    refusal: null,
    uncertainty: SENSITIVITY_UNCERTAINTY_NOTE,
    sapActualsUsed: false,
    searchLow,
    searchHigh,
    sampledLeadLow: null,
    sampledLeadHigh: null,
  };
}
