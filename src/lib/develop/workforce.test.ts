/**
 * Slice 7C's pure half, and every way it refuses.
 *
 * The refusals are the tests that matter here. A percentage that answers is
 * one arithmetic operation and one rounding rule; a percentage that should
 * NOT answer is five separate conditions, each of which has shipped as a
 * silent zero somewhere in this industry. So `ratio` gets a case per refusal
 * kind, in the order the guard evaluates them, plus the boundary between two
 * of them that is the whole reason the order is what it is.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  COMPETENCY_WHEN_NEEDED_STATES,
  MAX_HORIZON_WEEKS,
  RATIO_REFUSALS,
  RESOURCE_CATEGORIES,
  RESOURCE_CATEGORY_LABELS,
  RESOURCE_DEMAND_SOURCES,
  SLICE7C_CALCULATION_KEYS,
  balanceTone,
  competencyWhenNeeded,
  COMPETENCY_REQUIREMENT_STATES,
  isCompetencyNotAssessable,
  isFiniteNonNegative,
  isFinitePositive,
  isQualifiedWhenNeeded,
  isResourceCategory,
  parseHorizonWeeks,
  parseHours,
  ratio,
  resourceBalanceState,
  weeksInWindow,
} from "./workforce";

describe("the nine resource categories (spec I.22)", () => {
  it("carries exactly nine, in the specification's own order", () => {
    expect(RESOURCE_CATEGORIES).toHaveLength(9);
    expect([...RESOURCE_CATEGORIES]).toEqual([
      "engineering",
      "project_management",
      "skilled_trades",
      "inspectors",
      "commissioning",
      "cranes",
      "specialty_tools",
      "facilities",
      "suppliers",
    ]);
  });

  it("labels every one of them, so no screen falls back to a raw key", () => {
    for (const c of RESOURCE_CATEGORIES) {
      expect(RESOURCE_CATEGORY_LABELS[c]).toBeTruthy();
    }
    expect(Object.keys(RESOURCE_CATEGORY_LABELS)).toHaveLength(9);
  });

  it("validates rather than defaulting", () => {
    expect(isResourceCategory("cranes")).toBe(true);
    expect(isResourceCategory("warp_drive")).toBe(false);
    expect(isResourceCategory(null)).toBe(false);
    expect(isResourceCategory(3)).toBe(false);
  });

  it("keeps the four demand sources", () => {
    expect([...RESOURCE_DEMAND_SOURCES]).toEqual([
      "job_plan",
      "estimate",
      "vendor_quote",
      "manual",
    ]);
  });
});

describe("finite numbers", () => {
  it("rejects NaN and both infinities, which a range check admits", () => {
    for (const bad of [Number.NaN, Infinity, -Infinity, "5", null, undefined]) {
      expect(isFinitePositive(bad)).toBe(false);
      expect(isFiniteNonNegative(bad)).toBe(false);
    }
  });

  it("separates zero from positive, because they are different answers", () => {
    expect(isFinitePositive(0)).toBe(false);
    expect(isFiniteNonNegative(0)).toBe(true);
    expect(isFinitePositive(0.1)).toBe(true);
  });
});

describe("ratio — the only division in this slice", () => {
  it("names all five refusal kinds", () => {
    expect([...RATIO_REFUSALS].sort()).toEqual([
      "empty_denominator",
      "negative",
      "not_assessed",
      "not_finite",
      "numerator_exceeds",
    ]);
  });

  it("answers, to one decimal place", () => {
    const r = ratio(1, 3, "planned packages");
    expect(r.answered).toBe(true);
    if (!r.answered) throw new Error("unreachable");
    expect(r.pct).toBe(33.3);
    expect(r.numerator).toBe(1);
    expect(r.denominator).toBe(3);
  });

  it("REFUSES an empty denominator rather than returning 0% or 100%", () => {
    const r = ratio(0, 0, "planned work orders");
    expect(r.answered).toBe(false);
    if (r.answered) throw new Error("unreachable");
    expect(r.kind).toBe("empty_denominator");
    // Both readings are named, because a reader who sees only one of them
    // will supply the other themselves.
    expect(r.refusal).toContain("NOT 0%");
    expect(r.refusal).toContain("NOT 100%");
    expect(r).not.toHaveProperty("pct");
  });

  it("REFUSES an unassessed set, and says which fact it is refusing to state", () => {
    const r = ratio(0, 0, "the index", 0, 9);
    expect(r.answered).toBe(false);
    if (r.answered) throw new Error("unreachable");
    expect(r.kind).toBe("not_assessed");
    // The count of what EXISTS, not the empty denominator, because "0 exist
    // and none was assessed" is not the sentence this case is about.
    expect(r.refusal).toContain("9 exist in the window");
    expect(r.refusal).toContain("opposite facts");
  });

  it("diagnoses NOT ASSESSED before EMPTY DENOMINATOR — the order is the point", () => {
    // The denominator IS the assessed count in every caller, so a wholly
    // unassessed set arrives with both at zero and the generic sentence would
    // be the less true of two true things.
    const unassessed = ratio(0, 0, "the index", 0, 4);
    const genuinelyEmpty = ratio(0, 0, "the index");
    expect(unassessed.answered).toBe(false);
    expect(genuinelyEmpty.answered).toBe(false);
    if (unassessed.answered || genuinelyEmpty.answered) {
      throw new Error("unreachable");
    }
    expect(unassessed.kind).toBe("not_assessed");
    expect(genuinelyEmpty.kind).toBe("empty_denominator");
    expect(unassessed.refusal).not.toEqual(genuinelyEmpty.refusal);
  });

  it("falls back to the denominator when no existing count is supplied", () => {
    const r = ratio(0, 7, "planned jobs", 0);
    expect(r.answered).toBe(false);
    if (r.answered) throw new Error("unreachable");
    expect(r.refusal).toContain("7 exist in the window");
  });

  it("REFUSES a non-finite input rather than propagating NaN to a screen", () => {
    for (const [n, d] of [
      [Number.NaN, 4],
      [1, Number.NaN],
      [Infinity, 4],
      [1, Infinity],
      [1, -Infinity],
    ] as const) {
      const r = ratio(n, d, "anything");
      expect(r.answered).toBe(false);
      if (r.answered) throw new Error("unreachable");
      expect(r.kind).toBe("not_finite");
      expect(r.numerator).toBeNull();
      expect(r.denominator).toBeNull();
    }
    const viaAssessed = ratio(1, 4, "anything", Number.NaN);
    expect(viaAssessed.answered).toBe(false);
  });

  it("REFUSES a negative count as a fault rather than reporting it", () => {
    for (const args of [[-1, 4] as const, [1, -4] as const]) {
      const r = ratio(args[0], args[1], "anything");
      expect(r.answered).toBe(false);
      if (r.answered) throw new Error("unreachable");
      expect(r.kind).toBe("negative");
    }
    const viaAssessed = ratio(1, 4, "anything", -1);
    expect(viaAssessed.answered).toBe(false);
    if (viaAssessed.answered) throw new Error("unreachable");
    expect(viaAssessed.kind).toBe("negative");
  });

  it("REFUSES a numerator larger than its denominator", () => {
    const r = ratio(5, 4, "ready packages");
    expect(r.answered).toBe(false);
    if (r.answered) throw new Error("unreachable");
    expect(r.kind).toBe("numerator_exceeds");
    expect(r.refusal).toContain("counting fault");
  });

  it("answers 0% over a NON-empty assessed set — a real, reportable position", () => {
    // This is the case the empty-denominator refusal must not swallow.
    // Four jobs were assessed and none is ready: that is 0%, and it is a
    // finding rather than a gap.
    const r = ratio(0, 4, "planned-work-ready", 4);
    expect(r.answered).toBe(true);
    if (!r.answered) throw new Error("unreachable");
    expect(r.pct).toBe(0);
  });

  it("answers 100% without treating it as suspicious", () => {
    const r = ratio(4, 4, "planned-work-ready", 4);
    expect(r.answered).toBe(true);
    if (!r.answered) throw new Error("unreachable");
    expect(r.pct).toBe(100);
  });

  it("puts the subject into every refusal, so a reader knows what refused", () => {
    for (const r of [
      ratio(0, 0, "the widget index"),
      ratio(0, 0, "the widget index", 0, 3),
      ratio(Number.NaN, 1, "the widget index"),
      ratio(-1, 1, "the widget index"),
      ratio(2, 1, "the widget index"),
    ]) {
      expect(r.answered).toBe(false);
      if (r.answered) throw new Error("unreachable");
      expect(r.refusal).toContain("the widget index");
    }
  });
});

describe("the not-assessed sentence never contradicts itself", () => {
  it("does not print '0 exist in the window' when no total was supplied", () => {
    // The denominator IS the assessed count, so it is zero in exactly this
    // branch. `existing ?? denominator` therefore rendered "0 exist in the
    // window and NONE of them has been assessed", which is self-contradictory
    // and which the SQL mirror never printed.
    const r = ratio(0, 0, "the probe set", 0);
    expect(r.answered).toBe(false);
    expect(r.answered === false && r.kind).toBe("not_assessed");
    expect(r.answered === false && r.refusal).toContain(
      "members of the set exist and NONE of them has been assessed",
    );
    expect(r.answered === false && r.refusal).not.toContain("0 exist");
    // And the SQL mirror says the same thing, clause for clause, which is the
    // claim this file makes about itself.
    const sql = readFileSync(
      "supabase/migrations/20261212090300_develop_workface_metrics.sql",
      "utf8",
    );
    expect(sql).toContain("else 'members of the set exist' end));");
    expect(sql).toContain("case when coalesce(p_existing, p_denominator) > 0");
  });

  it("names the real total when the caller supplies one", () => {
    const r = ratio(0, 0, "the probe set", 0, 9);
    expect(r.answered === false && r.refusal).toContain(
      "9 exist in the window and NONE of them has been assessed",
    );
  });
});

describe("competency requirement states", () => {
  it("keeps 'nobody of that craft exists' apart from 'none is rostered'", () => {
    // Both are NOT ASSESSABLE and they are two different facts a reader acts
    // on differently. The first draft had only the second, computed
    // ORGANISATION-WIDE, so a requirement against a craft with no workforce
    // members at all reported `short` — "we looked and nobody qualifies"
    // about a craft nobody has entered into the system.
    expect(COMPETENCY_REQUIREMENT_STATES).toContain("craft_not_staffed");
    expect(COMPETENCY_REQUIREMENT_STATES).toContain("roster_not_recorded");
    expect(isCompetencyNotAssessable("craft_not_staffed")).toBe(true);
    expect(isCompetencyNotAssessable("roster_not_recorded")).toBe(true);
    expect(isCompetencyNotAssessable("short")).toBe(false);
    expect(isCompetencyNotAssessable("met")).toBe(false);
  });
});

describe("qualified WHEN NEEDED (spec I.23)", () => {
  it("names FOUR states — exactly what the SQL predicate can return", () => {
    // A fifth that nothing produces is a state a reader can filter on and
    // always get nothing back. The SQL returns these four and no others.
    expect([...COMPETENCY_WHEN_NEEDED_STATES]).toEqual([
      "qualified_through",
      "expires_during_window",
      "already_expired",
      "not_held",
    ]);
  });

  it("reports a ticket that lapses INSIDE the window as not qualified", () => {
    // Valid today, gone before the last shift. Every check that asks about
    // today reports this person as available; this one does not.
    expect(
      competencyWhenNeeded(true, "2026-09-20", "2026-09-01", "2026-10-01"),
    ).toBe("expires_during_window");
    expect(isQualifiedWhenNeeded("expires_during_window")).toBe(false);
  });

  it("covers a ticket that outlasts the window", () => {
    expect(
      competencyWhenNeeded(true, "2026-12-31", "2026-09-01", "2026-10-01"),
    ).toBe("qualified_through");
    expect(isQualifiedWhenNeeded("qualified_through")).toBe(true);
  });

  it("pins the INCLUSIVE expiry convention on every boundary date", () => {
    // `expires_on` is the LAST DAY a certificate is valid — valid through the
    // end of that date, which is how a ticket, a medical and a statutory
    // authorisation are written.
    //
    // THIS TEST'S TITLE USED TO SAY THE OPPOSITE of what it asserted ("treats
    // a ticket lapsing ON the last day as not covering that day", above an
    // assertion of `qualified_through`), and both code comments said the
    // opposite too — they named `<`, the operator that ships, as the way to
    // get it wrong. The code was right and every word around it was wrong, on
    // the one boundary D7.04 exists for. All three boundaries are pinned here
    // so the convention cannot drift back into ambiguity.
    const start = "2026-09-01";
    const end = "2026-10-01";

    // ON the last day: covers the last day.
    expect(competencyWhenNeeded(true, end, start, end)).toBe(
      "qualified_through",
    );
    // One day BEFORE the last day: lapses while the work is still running.
    expect(competencyWhenNeeded(true, "2026-09-30", start, end)).toBe(
      "expires_during_window",
    );
    // ON the FIRST day: covers that day and nothing after it, so it lapses
    // during the window — it is NOT "already expired".
    expect(competencyWhenNeeded(true, start, start, end)).toBe(
      "expires_during_window",
    );
    // One day BEFORE the first day: gone before the work begins.
    expect(competencyWhenNeeded(true, "2026-08-31", start, end)).toBe(
      "already_expired",
    );
    // AFTER the last day: covers the whole window.
    expect(competencyWhenNeeded(true, "2026-10-02", start, end)).toBe(
      "qualified_through",
    );
  });

  it("separates already expired from never held", () => {
    expect(
      competencyWhenNeeded(true, "2026-08-01", "2026-09-01", "2026-10-01"),
    ).toBe("already_expired");
    expect(competencyWhenNeeded(false, null, "2026-09-01", "2026-10-01")).toBe(
      "not_held",
    );
    expect(isQualifiedWhenNeeded("already_expired")).toBe(false);
    expect(isQualifiedWhenNeeded("not_held")).toBe(false);
  });

  it("treats a null expiry as a competency that does not expire", () => {
    expect(competencyWhenNeeded(true, null, "2026-09-01", "2026-10-01")).toBe(
      "qualified_through",
    );
  });
});

describe("time phasing", () => {
  it("measures a window in weeks", () => {
    const w = weeksInWindow("2026-09-01", "2026-09-29");
    expect(w.answered).toBe(true);
    if (!w.answered) throw new Error("unreachable");
    expect(w.weeks).toBe(4);
  });

  it("REFUSES a zero-length window rather than reporting zero capacity", () => {
    const w = weeksInWindow("2026-09-01", "2026-09-01");
    expect(w.answered).toBe(false);
    if (w.answered) throw new Error("unreachable");
    expect(w.refusal).toContain("would read as a shortage");
  });

  it("REFUSES an inverted window", () => {
    expect(weeksInWindow("2026-09-29", "2026-09-01").answered).toBe(false);
  });

  it("REFUSES something that is not a pair of dates", () => {
    const w = weeksInWindow("not a date", "2026-09-01");
    expect(w.answered).toBe(false);
    if (w.answered) throw new Error("unreachable");
    expect(w.refusal).toContain("not a pair of calendar dates");
  });
});

describe("the resource balance state", () => {
  it("reports NOT ASSESSABLE where no capacity is recorded — never zero", () => {
    expect(resourceBalanceState(120, null)).toBe("not_assessable");
    expect(resourceBalanceState(120, Number.NaN)).toBe("not_assessable");
    expect(resourceBalanceState(Number.NaN, 120)).toBe("not_assessable");
  });

  it("calls a fully committed pool AT capacity rather than within it", () => {
    expect(resourceBalanceState(120, 120)).toBe("at_capacity");
    expect(resourceBalanceState(119.95, 120)).toBe("at_capacity");
    expect(resourceBalanceState(100, 120)).toBe("within_capacity");
    expect(resourceBalanceState(121, 120)).toBe("over_committed");
  });

  it("gives not-assessable a register that is neither a pass nor a fail", () => {
    const notAssessable = balanceTone("not_assessable");
    expect(notAssessable).not.toContain("emerald");
    expect(notAssessable).not.toContain("red");
    expect(balanceTone("over_committed")).toContain("red");
    expect(balanceTone("within_capacity")).toContain("emerald");
    expect(balanceTone("at_capacity")).toContain("amber");
  });
});

describe("what a person typed in", () => {
  it("REFUSES an empty hours box rather than reading it as zero", () => {
    const r = parseHours("   ", "Demand hours");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("leave nothing implied");
  });

  it("REFUSES NaN, infinity and text", () => {
    for (const raw of ["NaN", "Infinity", "-Infinity", "seven", "1,2"]) {
      const r = parseHours(raw, "Demand hours");
      expect(r.ok).toBe(false);
      expect(r.error).toContain("finite number");
    }
  });

  it("REFUSES zero and negative hours, and says why zero is not a line", () => {
    for (const raw of ["0", "-4"]) {
      const r = parseHours(raw, "Demand hours");
      expect(r.ok).toBe(false);
      expect(r.error).toContain("greater than zero");
    }
  });

  it("accepts a real figure", () => {
    const r = parseHours(" 120.5 ", "Demand hours");
    expect(r.ok).toBe(true);
    expect(r.value).toBe(120.5);
  });

  it("defaults an empty horizon and refuses an impossible one", () => {
    expect(parseHorizonWeeks("")).toEqual({ ok: true, value: 12 });
    expect(parseHorizonWeeks("8")).toEqual({ ok: true, value: 8 });
    for (const raw of ["0", "-1", String(MAX_HORIZON_WEEKS + 1)]) {
      const r = parseHorizonWeeks(raw);
      expect(r.ok).toBe(false);
      expect(r.error).toContain("between 1 and");
    }
    const fractional = parseHorizonWeeks("1.5");
    expect(fractional.ok).toBe(false);
    expect(fractional.error).toContain("whole number of weeks");
  });
});

describe("the lineage keys", () => {
  it("declares FOUR keys, and exactly one of them for the two metric rows", () => {
    expect([...SLICE7C_CALCULATION_KEYS]).toEqual([
      "case_resource_balance",
      "competency_readiness",
      "constraint_free_work_index",
      "workface_execution_metrics",
    ]);
    // D7.08 (spec I.28) and D7.20 (spec III.§49) are the same calculation
    // named twice by the specification. One key, one run, two register rows.
    expect(
      SLICE7C_CALCULATION_KEYS.filter((k) => k.includes("constraint_free")),
    ).toHaveLength(1);
  });
});
