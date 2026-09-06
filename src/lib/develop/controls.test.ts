/**
 * Slice 4A controls helpers — the honesty properties, not the formatting.
 *
 * Every case here is a sentence that must NOT be produced: an empty case
 * reading as a complete chain, a missing baseline reading as zero growth, a
 * refused calculation reading as a blank number, an un-costed addition being
 * folded into a total. Those are the failures this module exists to prevent,
 * so they are what it is tested on.
 */
import { describe, expect, it } from "vitest";
import {
  CONTROLS_CALC_VERSION,
  CONTROLS_STRUCTURES,
  SCOPE_CHAIN_LINKS,
  capturableStructures,
  costReconciliationFingerprint,
  costReconciliationHeadline,
  driftedStructures,
  emptyGapSentence,
  formatMoney,
  hasDisplayableOutputs,
  runIsStale,
  scopeGrowthFingerprint,
  scopeGrowthHeadline,
  traceabilityHeadline,
  uncodedActivitiesByOrigin,
  type CalculationRun,
  type ControlsBaseline,
  type CostReconciliation,
  type ScopeGrowth,
  type ScopeTraceability,
} from "./controls";

/** A recorded run, the only thing a money figure may be rendered from. */
const growthRun = (
  outputs: Record<string, unknown> | null,
  over: Partial<CalculationRun> = {},
): CalculationRun => ({
  id: "r",
  calculationKey: "case_scope_growth",
  method: "sum of cost_effect",
  codeVersion: CONTROLS_CALC_VERSION,
  inputs: {},
  inputRefs: [],
  outputs,
  refusals: outputs == null ? ["no baseline"] : [],
  status: outputs == null ? "refused" : "computed",
  computedAt: "2026-11-24T00:00:00Z",
  computedBy: null,
  ...over,
});

const emptyTrace = (
  over: Partial<ScopeTraceability> = {},
): ScopeTraceability => ({
  caseId: "c",
  chain: [],
  forwardGaps: {
    needsWithoutRequirement: [],
    requirementsWithoutWbs: [],
    wbsElementsWithoutControlAccount: [],
  },
  orphans: {
    requirementsWithoutNeed: [],
    wbsElementsWithoutRequirement: [],
    scheduleActivitiesWithoutScope: [],
    costItemsOutsideAControlAccount: [],
  },
  totals: {
    needs: 0,
    requirements: 0,
    wbsElements: 0,
    scheduleActivities: 0,
    costItems: 0,
  },
  brokenLinkCount: 0,
  requirementsTracedPct: null,
  activitiesWithScopePct: null,
  ...over,
});

describe("the vocabularies", () => {
  it("carries the spec I.8 eleven, in the spec's order", () => {
    expect(CONTROLS_STRUCTURES).toHaveLength(11);
    expect(CONTROLS_STRUCTURES.map((s) => s.value)).toEqual([
      "wbs",
      "cbs",
      "obs",
      "schedule",
      "cost_baseline",
      "progress",
      "commitments",
      "actuals",
      "forecast",
      "changes",
      "contingency",
    ]);
  });

  it("carries the spec I.6 chain including the two links this slice defers", () => {
    expect(SCOPE_CHAIN_LINKS).toContain("work package");
    expect(SCOPE_CHAIN_LINKS).toContain("contract");
    // WBS sits where the spec puts it — after system, before work package.
    expect(SCOPE_CHAIN_LINKS.indexOf("WBS")).toBeGreaterThan(
      SCOPE_CHAIN_LINKS.indexOf("system"),
    );
    expect(SCOPE_CHAIN_LINKS.indexOf("WBS")).toBeLessThan(
      SCOPE_CHAIN_LINKS.indexOf("work package"),
    );
  });
});

describe("traceabilityHeadline — 'nothing recorded' never reads as 'nothing broken'", () => {
  it("says the chain has not been built when nothing is recorded", () => {
    const text = traceabilityHeadline(emptyTrace());
    expect(text).toMatch(/no scope architecture is recorded/i);
    expect(text).not.toMatch(/complete|every recorded link joins/i);
  });

  it("reports a clean chain only when something exists AND nothing is broken", () => {
    const text = traceabilityHeadline(
      emptyTrace({
        totals: {
          needs: 2,
          requirements: 3,
          wbsElements: 4,
          scheduleActivities: 0,
          costItems: 0,
        },
      }),
    );
    expect(text).toMatch(/every recorded link joins/i);
  });

  it("leads with the count of breaks when there are any", () => {
    const text = traceabilityHeadline(
      emptyTrace({
        brokenLinkCount: 3,
        totals: {
          needs: 1,
          requirements: 1,
          wbsElements: 1,
          scheduleActivities: 0,
          costItems: 0,
        },
      }),
    );
    expect(text).toMatch(/^3 break\(s\)/);
  });
});

describe("scopeGrowthHeadline — a refusal is the answer, not an error", () => {
  it("returns the server's refusal verbatim when there is no baseline", () => {
    const growth: ScopeGrowth = {
      caseId: "c",
      evaluable: false,
      refusal: "This case has no approved SCOPE baseline.",
    };
    expect(scopeGrowthHeadline(growth)).toBe(
      "This case has no approved SCOPE baseline.",
    );
  });

  it("distinguishes 'zero recorded additions' from 'growth cost nothing'", () => {
    const text = scopeGrowthHeadline(
      { caseId: "c", evaluable: true, additionCount: 0, costTotal: null },
      growthRun({ additionCount: 0, costTotal: null, currency: null }),
    );
    expect(text).toMatch(/zero recorded additions, not a measured zero/i);
  });

  it("refuses to state a figure when every addition is un-costed", () => {
    const text = scopeGrowthHeadline(
      {
        caseId: "c",
        evaluable: true,
        additionCount: 3,
        uncostedCount: 3,
        costTotal: null,
        costTotalRefusal:
          "3 scope addition(s) since the baseline, none of them costed — so there is a count, not a figure.",
      },
      growthRun({
        additionCount: 3,
        uncostedCount: 3,
        costTotal: null,
        currency: null,
      }),
    );
    expect(text).toMatch(/none of them costed/i);
    expect(text).not.toMatch(/\$?0\b/);
  });

  it("states the un-costed remainder beside a figure that excludes it", () => {
    const text = scopeGrowthHeadline(
      { caseId: "c", evaluable: true, additionCount: 4, uncostedCount: 1 },
      growthRun({
        additionCount: 4,
        uncostedCount: 1,
        costTotal: 2_300_000,
        currency: "CAD",
      }),
    );
    expect(text).toContain("2,300,000");
    expect(text).toContain("CAD");
    expect(text).toMatch(/1 further addition\(s\) not yet costed/);
  });

  // ── the repair: a figure with no recorded run behind it ───────────────
  it("shows NO figure when no run has been recorded, however good the read", () => {
    const text = scopeGrowthHeadline({
      caseId: "c",
      evaluable: true,
      additionCount: 4,
      uncostedCount: 0,
      costTotal: 2_300_000,
      currency: "CAD",
    });
    // The live read has a perfectly good number. It has no lineage, so the
    // page must not print it — this is the failure the surface shipped with.
    expect(text).not.toContain("2,300,000");
    expect(text).toMatch(/no scope-growth calculation has been recorded/i);
  });

  it("shows no figure when the only run REFUSED", () => {
    const text = scopeGrowthHeadline(
      { caseId: "c", evaluable: true, additionCount: 4, costTotal: 2_300_000 },
      growthRun(null),
    );
    expect(text).not.toContain("2,300,000");
    expect(text).toMatch(/no scope-growth calculation has been recorded/i);
  });

  it("renders the run's OWN figure, not the read's, when the two differ", () => {
    const text = scopeGrowthHeadline(
      { caseId: "c", evaluable: true, additionCount: 5, costTotal: 2_800_000 },
      growthRun({ additionCount: 4, costTotal: 2_300_000, currency: "CAD" }),
    );
    expect(text).toContain("2,300,000");
    expect(text).not.toContain("2,800,000");
  });

  it("never renders a bare number when the currency is not established", () => {
    const text = scopeGrowthHeadline(
      { caseId: "c", evaluable: true, additionCount: 2 },
      growthRun({ additionCount: 2, costTotal: 2_000_000, currency: null }),
    );
    expect(text).toMatch(/currency not established/i);
  });
});

describe("formatMoney — a figure carries its unit or is not money", () => {
  it("never invents a currency", () => {
    expect(formatMoney(1000, null)).toMatch(/currency not established/i);
    expect(formatMoney(1000, "")).toMatch(/currency not established/i);
    expect(formatMoney(1000, "USD")).toBe("1,000 USD");
  });

  it("absence is 'not stated', never zero", () => {
    expect(formatMoney(null, "CAD")).toBe("not stated");
    expect(formatMoney(undefined, "CAD")).toBe("not stated");
  });
});

describe("costReconciliationHeadline — the sentence needs a run", () => {
  const reconRun = (outputs: Record<string, unknown>): CalculationRun => ({
    ...growthRun(outputs),
    calculationKey: "case_cost_reconciliation",
  });

  it("is null with no run, so the surface says why instead of printing one", () => {
    expect(costReconciliationHeadline(undefined)).toBeNull();
  });

  it("is null when the recorded run had no answer", () => {
    expect(
      costReconciliationHeadline(
        reconRun({ reconciles: null, lineBaselineTotal: 250_000 }),
      ),
    ).toBeNull();
  });

  it("names both sides, the option and the unit when it agrees", () => {
    const text = costReconciliationHeadline(
      reconRun({
        lineBaselineTotal: 250_000,
        businessCaseCapital: 250_000,
        currency: "CAD",
        businessCaseRef: "BC-1",
        optionLabel: "Upgrade the liner set",
        variance: 0,
        reconciles: true,
      }),
    );
    expect(text).toContain("250,000 CAD");
    expect(text).toContain("BC-1");
    expect(text).toContain("Upgrade the liner set");
    expect(text).toContain("they agree");
  });
});

describe("runIsStale — a recorded figure that is no longer current says so", () => {
  const run = growthRun(
    { costTotal: 1 },
    { inputs: { additionCount: 2, uncostedCount: 0, brokenScopeLinks: 3 } },
  );

  it("is false while the fingerprint matches", () => {
    expect(
      runIsStale(run, {
        additionCount: 2,
        uncostedCount: 0,
        brokenScopeLinks: 3,
      }),
    ).toBe(false);
  });

  it("is true the moment an input moves", () => {
    expect(
      runIsStale(run, {
        additionCount: 3,
        uncostedCount: 0,
        brokenScopeLinks: 3,
      }),
    ).toBe(true);
  });

  it("ignores keys the run never recorded rather than crying stale", () => {
    expect(runIsStale(run, { somethingNew: 9 })).toBe(false);
  });

  it("is false with no run at all — that is 'not computed', not 'stale'", () => {
    expect(runIsStale(undefined, { additionCount: 9 })).toBe(false);
  });

  it("builds its fingerprint from the same keys the run records", () => {
    const growth: ScopeGrowth = {
      caseId: "c",
      evaluable: true,
      baseline: {
        id: "b",
        version: 2,
        approvedAt: "x",
        approvedBy: null,
        description: "d",
      },
      additionCount: 2,
      uncostedCount: 0,
    };
    expect(
      Object.keys(scopeGrowthFingerprint(growth, emptyTrace())).sort(),
    ).toEqual([
      "additionCount",
      "baselineId",
      "baselineVersion",
      "brokenScopeLinks",
      "uncostedCount",
    ]);
    const recon: CostReconciliation = {
      caseId: "c",
      lineCount: 3,
      baselinedLineCount: 1,
      lineBaselineTotal: 1,
      linesOutsideAControlAccount: 0,
      businessCaseRef: "BC-1",
      businessCaseCapital: 1,
      optionId: null,
      optionLabel: null,
      currency: "CAD",
      variance: null,
      reconciles: null,
      refusals: [],
    };
    expect(Object.keys(costReconciliationFingerprint(recon)).sort()).toEqual([
      "baselinedLineCount",
      "businessCaseRef",
      "lineCount",
      "linesOutsideAControlAccount",
    ]);
  });
});

describe("emptyGapSentence — nothing recorded is not nothing wrong", () => {
  it("says the set is empty rather than that the set is clean", () => {
    expect(emptyGapSentence(0, "nothing recorded", "nothing wrong")).toBe(
      "nothing recorded",
    );
  });

  it("says the set is clean only when there is a set", () => {
    expect(emptyGapSentence(7, "nothing recorded", "nothing wrong")).toBe(
      "nothing wrong",
    );
  });
});

describe("hasDisplayableOutputs — a refused run never renders as a blank number", () => {
  const run = (over: Partial<CalculationRun>): CalculationRun => ({
    id: "r",
    calculationKey: "case_scope_growth",
    method: "m",
    codeVersion: CONTROLS_CALC_VERSION,
    inputs: {},
    inputRefs: [],
    outputs: { costTotal: 1 },
    refusals: [],
    status: "computed",
    computedAt: "2026-11-24T00:00:00Z",
    computedBy: null,
    ...over,
  });

  it("accepts a computed run", () => {
    expect(hasDisplayableOutputs(run({}))).toBe(true);
  });

  it("accepts a computed-with-refusals run — the caveats travel with it", () => {
    expect(
      hasDisplayableOutputs(
        run({ status: "computed_with_refusals", refusals: ["partial"] }),
      ),
    ).toBe(true);
  });

  it("rejects a refused run and an absent one", () => {
    expect(
      hasDisplayableOutputs(run({ status: "refused", outputs: null })),
    ).toBe(false);
    expect(hasDisplayableOutputs(undefined)).toBe(false);
  });
});

describe("uncodedActivitiesByOrigin — two different conversations", () => {
  it("splits imported from locally authored", () => {
    const trace = emptyTrace({
      orphans: {
        requirementsWithoutNeed: [],
        wbsElementsWithoutRequirement: [],
        scheduleActivitiesWithoutScope: [
          {
            activityId: 1,
            activityKey: "A1000",
            label: "x",
            origin: "imported",
            sourceSystem: "p6",
            wbsPath: "PROJ.1",
            schedule: "s",
            durationHours: 8,
          },
          {
            activityId: 2,
            activityKey: "L-1",
            label: "y",
            origin: "local",
            sourceSystem: null,
            wbsPath: null,
            schedule: "s",
            durationHours: 4,
          },
          {
            activityId: 3,
            activityKey: "L-2",
            label: "z",
            origin: "local",
            sourceSystem: null,
            wbsPath: null,
            schedule: "s",
            durationHours: 4,
          },
        ],
        costItemsOutsideAControlAccount: [],
      },
    });
    expect(uncodedActivitiesByOrigin(trace)).toEqual({
      imported: 1,
      local: 2,
    });
  });
});

describe("capturableStructures / driftedStructures", () => {
  const baseline: ControlsBaseline = {
    caseId: "c",
    structureCount: 11,
    capturedCount: 1,
    driftedCount: 1,
    baselineComplete: false,
    structures: [
      {
        structure: "wbs",
        home: "project_wbs_elements",
        currentCount: 4,
        refusal: null,
        baselined: true,
        baseline: {
          baselineId: "b",
          baselineType: "SCOPE",
          version: 1,
          approvedAt: "2026-11-24T00:00:00Z",
          capturedAt: "2026-11-24T00:00:00Z",
          capturedBy: "A Human",
          structureLastChangedAt: "2026-11-23T00:00:00Z",
          elementCount: 3,
        },
        drifted: true,
        driftDetail: "now holds 4",
      },
      {
        structure: "cbs",
        home: "project_cbs_codes",
        currentCount: 2,
        refusal: null,
        baselined: false,
        baseline: null,
        drifted: null,
        driftDetail: null,
      },
      {
        structure: "progress",
        home: "none yet",
        currentCount: null,
        refusal: "Progress has no home in this repository yet",
        baselined: false,
        baseline: null,
        drifted: null,
        driftDetail: null,
      },
      {
        structure: "actuals",
        home: "project_cost_items.actual",
        currentCount: 0,
        refusal: "Nothing is recorded",
        baselined: false,
        baseline: null,
        drifted: null,
        driftDetail: null,
      },
    ],
  };

  it("offers the capture act only where it would succeed", () => {
    expect(capturableStructures(baseline).map((s) => s.structure)).toEqual([
      "cbs",
    ]);
  });

  it("reports drift only where something was actually captured", () => {
    expect(driftedStructures(baseline).map((s) => s.structure)).toEqual([
      "wbs",
    ]);
  });
});
