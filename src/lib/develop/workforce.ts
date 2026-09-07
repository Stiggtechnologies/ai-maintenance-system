/**
 * Sync Develop Slice 7C — resources, competency readiness and the workface
 * metrics. The shared vocabulary and the pure arithmetic, stated ONCE so the
 * SQL and the screens cannot drift apart.
 *
 * ── WHY THIS FILE IS MOSTLY ABOUT REFUSING ─────────────────────────────────
 *
 * Four of this slice's rows are PERCENTAGES, and a percentage is the easiest
 * place in a product to state a number nobody can defend. The failure is not
 * exotic: it is `numerator / denominator` where the denominator is empty.
 *
 *     0 ready of 0 planned, rendered as 100%  → reads as perfect.
 *     0 ready of 0 planned, rendered as   0%  → reads as broken.
 *
 * Both are wrong, and both are wrong in a way that survives review, because
 * the number LOOKS like the output of a calculation. So there is exactly one
 * division in this slice — `ratio()` below — every metric goes through it,
 * and it returns a REFUSAL rather than a number whenever it cannot defend one.
 *
 * Two facts this file refuses to merge, anywhere:
 *
 *     NOT ASSESSED       nobody has looked. There is no position.
 *     ASSESSED AND ZERO  somebody looked and the answer is none.
 *
 * They are opposite facts. A screen that renders both as "0%" has destroyed
 * the difference between a clean bill and an empty file, which is the same
 * defect `get_package_constraint_burndown` refuses over a package with no
 * constraints (RULING 21) and `sync_work_package_release_verdict` refuses as
 * `unassessed` (RULING 22). The three now agree.
 *
 * NON-FINITE INPUTS ARE REFUSED AT THE DOOR. `Number.NaN`, `Infinity` and a
 * negative count are each rejected by name before any arithmetic happens —
 * the TypeScript half of the guard whose SQL half exists because
 * `'NaN'::numeric = 'NaN'::numeric` is TRUE in Postgres and `'NaN' > 0` is
 * TRUE as well, so `check (hours > 0)` admits NaN without complaint.
 */

/* ─────────────────────────── the nine categories ────────────────────────── */

/**
 * Spec I.22's nine resource categories, in the order the specification lists
 * them: "engineering, PM, skilled trades, inspectors, commissioning, cranes,
 * specialty tools, facilities, suppliers".
 *
 * `skilled_trades` is FIRST among equals in one respect only: it is the
 * category the pre-existing `craft_capacity` rows carry, because that table
 * has only ever held craft-week hours. The migration's default is therefore
 * `skilled_trades`, which is a statement about the rows that already exist
 * rather than a preference between categories.
 */
export const RESOURCE_CATEGORIES = [
  "engineering",
  "project_management",
  "skilled_trades",
  "inspectors",
  "commissioning",
  "cranes",
  "specialty_tools",
  "facilities",
  "suppliers",
] as const;

export type ResourceCategory = (typeof RESOURCE_CATEGORIES)[number];

/** Human labels. The SQL stores the key; only screens read this. */
export const RESOURCE_CATEGORY_LABELS: Record<ResourceCategory, string> = {
  engineering: "Engineering",
  project_management: "Project management",
  skilled_trades: "Skilled trades",
  inspectors: "Inspectors",
  commissioning: "Commissioning",
  cranes: "Cranes",
  specialty_tools: "Specialty tools",
  facilities: "Facilities",
  suppliers: "Suppliers",
};

export function isResourceCategory(value: unknown): value is ResourceCategory {
  return (
    typeof value === "string" &&
    (RESOURCE_CATEGORIES as readonly string[]).includes(value)
  );
}

/** The demand row's provenance. `manual` is a stated judgement, not a gap. */
export const RESOURCE_DEMAND_SOURCES = [
  "job_plan",
  "estimate",
  "vendor_quote",
  "manual",
] as const;

export type ResourceDemandSource = (typeof RESOURCE_DEMAND_SOURCES)[number];

/* ───────────────────────────── finite numbers ───────────────────────────── */

/**
 * Every numeric door in this slice. Rejects NaN, ±Infinity, non-numbers and
 * (unless `allowZero`) anything at or below zero.
 *
 * `Number.isFinite` alone is the whole guard in TypeScript. It is spelled out
 * here anyway because the SQL side needs three separate predicates to say the
 * same thing, and a reader comparing the two should see the same list.
 */
export function isFinitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/* ─────────────────────────────── THE RATIO ──────────────────────────────── */

/**
 * The single division in this slice.
 *
 * `kind` names WHICH refusal happened, so a caller can tell "nobody looked"
 * from "somebody looked and the answer is none" without parsing prose:
 *
 *   `empty_denominator`  the set this ratio is over has no members at all.
 *   `not_assessed`       the set has members and none of them was assessed.
 *   `not_finite`         an input was NaN, ±Infinity or not a number.
 *   `negative`           a count was below zero.
 *   `numerator_exceeds`  more members passed than exist. A counting fault.
 */
export const RATIO_REFUSALS = [
  "empty_denominator",
  "not_assessed",
  "not_finite",
  "negative",
  "numerator_exceeds",
] as const;

export type RatioRefusal = (typeof RATIO_REFUSALS)[number];

export interface RatioAnswer {
  answered: true;
  /** 0..100, one decimal place. */
  pct: number;
  numerator: number;
  denominator: number;
}

export interface RatioRefused {
  answered: false;
  kind: RatioRefusal;
  refusal: string;
  numerator: number | null;
  denominator: number | null;
}

export type RatioResult = RatioAnswer | RatioRefused;

/**
 * @param subject  what is being counted, for the refusal sentence — e.g.
 *                 "planned work orders". Appears verbatim to the reader.
 * @param assessed when supplied, the count of denominator members that were
 *                 actually assessed. An assessed count of zero is refused as
 *                 `not_assessed`, NOT answered as 0%: the work exists, nobody
 *                 looked at it, and 0% would read as "none of it is ready".
 * @param existing how many exist in the window at all, for the `not_assessed`
 *                 sentence. The denominator is the ASSESSED count, so it is
 *                 zero in exactly the case this sentence has to describe.
 */
export function ratio(
  numerator: number,
  denominator: number,
  subject: string,
  assessed?: number,
  existing?: number,
): RatioResult {
  if (
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    (assessed !== undefined && !Number.isFinite(assessed))
  ) {
    return {
      answered: false,
      kind: "not_finite",
      numerator: null,
      denominator: null,
      refusal: `No percentage for ${subject}: one of the counts is not a finite number, and a ratio computed from NaN or infinity is a number nobody can defend.`,
    };
  }
  if (numerator < 0 || denominator < 0 || (assessed ?? 0) < 0) {
    return {
      answered: false,
      kind: "negative",
      numerator,
      denominator,
      refusal: `No percentage for ${subject}: a count below zero was supplied, which is a fault in whatever produced it rather than a position to report.`,
    };
  }
  // NOT-ASSESSED IS DIAGNOSED FIRST, and the order is the whole point rather
  // than a preference. Callers pass the ASSESSED count as the denominator — a
  // package nobody looked at is not a constrained one — so a set nobody has
  // assessed arrives here as denominator 0 AND assessed 0, and the generic
  // "the window is empty" would be the less true of two true things. Mirrors
  // `sync_metric_ratio` in 20261212090300 clause for clause.
  if (assessed !== undefined && assessed === 0) {
    return {
      answered: false,
      kind: "not_assessed",
      numerator,
      denominator,
      // `existing ?? denominator` was the first draft, and it printed
      // "0 exist in the window and NONE of them has been assessed" — a
      // sentence that contradicts itself — because the denominator IS the
      // assessed count and is zero in exactly this branch. The SQL mirror says
      // the same thing in words when the caller states no total.
      refusal: `No percentage for ${subject}: ${
        // The denominator IS the assessed count in every product caller, so it
        // is ZERO in exactly this branch — and `existing ?? denominator` then
        // printed "0 exist in the window and NONE of them has been assessed",
        // a sentence that contradicts itself. A non-zero denominator is still
        // a real count and is still used.
        (existing ?? denominator) > 0
          ? `${existing ?? denominator} exist in the window`
          : "members of the set exist"
      } and NONE of them has been assessed. "Not assessed" and "assessed and found not ready" are opposite facts, and reporting 0% here would state the second one about the first.`,
    };
  }
  if (denominator === 0) {
    return {
      answered: false,
      kind: "empty_denominator",
      numerator,
      denominator,
      refusal: `No percentage for ${subject}: there are none in the window at all, so the denominator is empty. This is NOT 0% and it is NOT 100% — it is a window nobody has planned work into, and a percentage over an empty set states a position that does not exist.`,
    };
  }
  if (numerator > denominator) {
    return {
      answered: false,
      kind: "numerator_exceeds",
      numerator,
      denominator,
      refusal: `No percentage for ${subject}: ${numerator} passed out of ${denominator} that exist, which is a counting fault rather than a position.`,
    };
  }
  return {
    answered: true,
    numerator,
    denominator,
    pct: Math.round((numerator / denominator) * 1000) / 10,
  };
}

/* ───────────────────────── qualified WHEN NEEDED ────────────────────────── */

/**
 * Spec I.23: readiness is not "14 people available", it is "14 QUALIFIED
 * people available WHEN NEEDED".
 *
 * The distinction this vocabulary exists to hold is `expires_during_window`.
 * A certificate that is valid today and lapses three weeks before the work
 * happens makes its holder qualified NOW and unqualified THEN, and a check
 * that asks `expires_on >= current_date` reports that person as available.
 * That is the defect this row was written to close, so it gets its own state
 * rather than folding into `not_held`.
 *
 * FOUR STATES, BECAUSE FOUR IS WHAT `sync_competency_when_needed` CAN RETURN.
 * A draft of this list carried a fifth, `expires_before_needed`, that nothing
 * on either side produced — and a state no code can reach invites a reader to
 * filter on it and get an always-empty answer, which is the shape
 * `work_packages.status` deliberately refused when it shipped three states
 * rather than six (20261210090000:214).
 */
export const COMPETENCY_WHEN_NEEDED_STATES = [
  "qualified_through",
  "expires_during_window",
  "already_expired",
  "not_held",
] as const;

export type CompetencyWhenNeeded =
  (typeof COMPETENCY_WHEN_NEEDED_STATES)[number];

/**
 * All dates are ISO `YYYY-MM-DD`. Comparison is lexical, which is exact for
 * that format and avoids a timezone shifting a certificate's expiry across a
 * day boundary — the reason this takes strings rather than `Date`.
 *
 * @param expiresOn  null means the competency does not expire.
 */
export function competencyWhenNeeded(
  held: boolean,
  expiresOn: string | null,
  windowStart: string,
  windowEnd: string,
): CompetencyWhenNeeded {
  if (!held) return "not_held";
  if (expiresOn === null) return "qualified_through";
  // THE EXPIRY CONVENTION IS INCLUSIVE. `expiresOn` is the LAST DAY the
  // certificate is valid — valid through the end of that date — which is how a
  // ticket, a medical and a statutory authorisation are written. Both
  // comparisons follow from that single convention:
  //
  //   expiresOn < windowStart   it lapsed before the work begins. A
  //                             certificate expiring ON the first day still
  //                             covers that day, so it is not already expired.
  //   expiresOn < windowEnd     it lapses while the work is still running. A
  //                             certificate expiring ON the last day covers the
  //                             last day, so it is `qualified_through`.
  //
  // An earlier draft of this comment claimed the opposite — that `<` would
  // "call a certificate expiring the morning of the final shift sufficient" —
  // while `<` shipped. The code was right and the prose was wrong, on the one
  // boundary D7.04 exists for. The three boundary cases have a test each.
  if (expiresOn < windowStart) return "already_expired";
  if (expiresOn < windowEnd) return "expires_during_window";
  return "qualified_through";
}

/** The two states that mean "not qualified when the work happens". */
export function isQualifiedWhenNeeded(state: CompetencyWhenNeeded): boolean {
  return state === "qualified_through";
}

/* ───────────────────────────── time phasing ─────────────────────────────── */

/**
 * The number of WEEKS a date window covers, as a fraction, for converting a
 * weekly capacity rate into hours available across an arbitrary window.
 *
 * Refuses a zero-length or inverted window rather than returning 0: a window
 * of no days has no capacity in it, and multiplying a rate by zero would
 * report "no capacity" for what is really "no window".
 */
export function weeksInWindow(
  startIso: string,
  endIso: string,
): { answered: true; weeks: number } | { answered: false; refusal: string } {
  const start = Date.parse(`${startIso}T00:00:00Z`);
  const end = Date.parse(`${endIso}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return {
      answered: false,
      refusal:
        "The window is not a pair of calendar dates, so nothing can be time-phased across it.",
    };
  }
  const days = (end - start) / 86_400_000;
  if (days <= 0) {
    return {
      answered: false,
      refusal:
        "The window ends on or before it starts. A window of no days holds no capacity and no demand — reporting zero hours for it would read as a shortage.",
    };
  }
  return { answered: true, weeks: Math.round((days / 7) * 1000) / 1000 };
}

/**
 * How a (category, pool, period) cell reads once demand and capacity are put
 * beside each other.
 *
 * `not_assessable` is the whole point of the enum. It is what a cell says
 * when demand exists and NO capacity figure has been recorded for that pool —
 * the position `evaluate_schedule_feasibility` has taken since 2026-08-11
 * ("capacity is deliberately not inferred from headcount"), carried into the
 * portfolio view rather than replaced by a zero that would read as a total
 * shortfall.
 */
export const RESOURCE_BALANCE_STATES = [
  "within_capacity",
  "at_capacity",
  "over_committed",
  "not_assessable",
] as const;

export type ResourceBalanceState = (typeof RESOURCE_BALANCE_STATES)[number];

export function resourceBalanceState(
  demandHours: number,
  capacityHours: number | null,
): ResourceBalanceState {
  if (capacityHours === null || !Number.isFinite(capacityHours)) {
    return "not_assessable";
  }
  if (!Number.isFinite(demandHours)) return "not_assessable";
  if (demandHours > capacityHours) return "over_committed";
  // Within a tenth of an hour of the ceiling is AT capacity, not under it: a
  // pool booked to 99.97% of its hours has no room for the first thing that
  // goes wrong, and rendering that as "within capacity" is the reassurance
  // this slice exists to withhold.
  if (capacityHours - demandHours <= 0.1) return "at_capacity";
  return "within_capacity";
}

export function balanceTone(state: ResourceBalanceState): string {
  switch (state) {
    case "over_committed":
      return "border-red-400/30 bg-red-400/10 text-red-200";
    case "at_capacity":
      return "border-amber-400/30 bg-amber-400/10 text-amber-200";
    case "within_capacity":
      return "border-emerald-400/30 bg-emerald-400/10 text-emerald-200";
    default:
      // NOT ASSESSABLE IS NOT GREEN and it is not red. It is the third answer,
      // and it wears its own neutral register so a reader cannot mistake it
      // for either a pass or a fail.
      return "border-white/10 bg-white/[0.02] text-slate-300";
  }
}

/* ──────────────────── parsing what a person typed in ────────────────────── */

export interface ParsedNumber {
  ok: boolean;
  value?: number;
  error?: string;
}

/**
 * The form-field door. Empty is a distinct answer from zero, and a blank box
 * that silently becomes 0 hours is how an unstated demand becomes a stated
 * one.
 */
export function parseHours(raw: string, label: string): ParsedNumber {
  const text = raw.trim();
  if (text === "") {
    return {
      ok: false,
      error: `${label} is required — leave nothing implied.`,
    };
  }
  const value = Number(text);
  if (!Number.isFinite(value)) {
    return {
      ok: false,
      error: `${label} must be a finite number of hours. "${text}" is not one.`,
    };
  }
  if (value <= 0) {
    return {
      ok: false,
      error: `${label} must be greater than zero. A demand or capacity line of zero hours is an absent line, and it should be absent rather than recorded.`,
    };
  }
  return { ok: true, value };
}

/**
 * Horizons. Shares the 1..1825 day bound `get_package_constraint_burndown`
 * already enforces, expressed in weeks so the two cannot disagree about what
 * a five-year window is.
 */
export const MAX_HORIZON_WEEKS = 260;

export function parseHorizonWeeks(raw: string): ParsedNumber {
  const text = raw.trim();
  if (text === "") return { ok: true, value: 12 };
  const value = Number(text);
  if (!Number.isInteger(value)) {
    return { ok: false, error: "The horizon must be a whole number of weeks." };
  }
  if (value < 1 || value > MAX_HORIZON_WEEKS) {
    return {
      ok: false,
      error: `The horizon must be between 1 and ${MAX_HORIZON_WEEKS} weeks. A horizon of zero weeks projects nothing and a negative one projects into the past.`,
    };
  }
  return { ok: true, value };
}

/* ─────────────────────── the metric keys, pinned once ───────────────────── */

/**
 * The lineage keys this slice records under (D11.29). Pinned here so the
 * migration test can assert that every key the SQL records is a key the SQL
 * has a code version for, and that this slice added exactly these three.
 *
 * `constraint_free_work_index` is ONE key for TWO register rows. D7.08 (spec
 * I.28, "forward constraint-free work") and D7.20 (spec III.§49, the
 * Constraint-Free Work Index) are the same calculation named twice by the
 * specification, and the register says so in D7.20's own gap statement:
 * "Duplicate spec reference of the I.28 forward metric — one calc." Building
 * two would put two answers behind one question, which is the defect this
 * programme has found in seven of the last eight chunks.
 */
/**
 * The states `get_competency_readiness` gives a requirement.
 *
 * `craft_not_staffed` and `roster_not_recorded` are BOTH "not assessable" and
 * they are still two different facts a reader acts on differently: nobody of
 * that craft is recorded at all, versus they are recorded and none of them is
 * rostered in this window. The first draft had only the second, computed
 * organisation-wide, so a requirement against a craft with no members reported
 * `short` — "we looked and nobody qualifies" about a craft nobody has entered.
 */
export const COMPETENCY_REQUIREMENT_STATES = [
  "met",
  "qualified_but_not_rostered",
  "short",
  "roster_not_recorded",
  "craft_not_staffed",
] as const;

export type CompetencyRequirementState =
  (typeof COMPETENCY_REQUIREMENT_STATES)[number];

/** The two states that mean nothing was assessed, as opposed to assessed and short. */
export function isCompetencyNotAssessable(
  state: CompetencyRequirementState,
): boolean {
  return state === "roster_not_recorded" || state === "craft_not_staffed";
}

export const SLICE7C_CALCULATION_KEYS = [
  "case_resource_balance",
  "competency_readiness",
  "constraint_free_work_index",
  "workface_execution_metrics",
] as const;

export type Slice7cCalculationKey = (typeof SLICE7C_CALCULATION_KEYS)[number];
