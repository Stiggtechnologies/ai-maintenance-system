/**
 * Validation for whole-life stage gates.
 *
 * The failure mode being guarded against is a gate that passes because nobody
 * looked. So the tests below are mostly about the three ways a mandatory
 * criterion can fail to be met — assessed and not met, recorded as not
 * assessed, and no finding at all — and about the difference between an asset
 * that passed a gate and one that was simply placed in a stage.
 */
import { describe, expect, it } from "vitest";
import {
  assessGate,
  wholeLifeCoverage,
  type GateCriterion,
  type StageRef,
} from "./stages";

const CRITERIA: GateCriterion[] = [
  { criterion: "Handover dossier exists", isMandatory: true },
  { criterion: "Initial maintenance strategy in place", isMandatory: true },
  { criterion: "As-built baseline recorded", isMandatory: true },
  { criterion: "Sensitivity to key assumptions tested", isMandatory: false },
];

describe("assessGate", () => {
  it("passes only when every mandatory criterion is explicitly met", () => {
    const r = assessGate(CRITERIA, [
      { criterion: "Handover dossier exists", status: "met" },
      { criterion: "Initial maintenance strategy in place", status: "met" },
      { criterion: "As-built baseline recorded", status: "met" },
    ]);
    expect(r.ready).toBe(true);
    expect(r.metCount).toBe(3);
    expect(r.reason).toMatch(/All 3 mandatory criteria are met/);
  });

  it("reports an outstanding advisory criterion without blocking on it", () => {
    const r = assessGate(CRITERIA, [
      { criterion: "Handover dossier exists", status: "met" },
      { criterion: "Initial maintenance strategy in place", status: "met" },
      { criterion: "As-built baseline recorded", status: "met" },
    ]);
    expect(r.ready).toBe(true);
    expect(r.advisoryOutstanding).toEqual([
      "Sensitivity to key assumptions tested",
    ]);
    expect(r.reason).toMatch(/do not block/);
  });

  it("blocks on a criterion assessed and not met", () => {
    const r = assessGate(CRITERIA, [
      { criterion: "Handover dossier exists", status: "met" },
      { criterion: "Initial maintenance strategy in place", status: "not_met" },
      { criterion: "As-built baseline recorded", status: "met" },
    ]);
    expect(r.ready).toBe(false);
    expect(r.notMet).toEqual(["Initial maintenance strategy in place"]);
  });

  it("treats NOT ASSESSED as blocking, and says why in those words", () => {
    const r = assessGate(CRITERIA, [
      { criterion: "Handover dossier exists", status: "met" },
      {
        criterion: "Initial maintenance strategy in place",
        status: "not_assessed",
      },
      { criterion: "As-built baseline recorded", status: "met" },
    ]);
    expect(r.ready).toBe(false);
    expect(r.notAssessed).toEqual(["Initial maintenance strategy in place"]);
    expect(r.reason).toMatch(/not a softer form of met/i);
  });

  it("treats a criterion with NO finding as unmet, not as absent", () => {
    // The dangerous case: submit a review that simply omits the hard one.
    const r = assessGate(CRITERIA, [
      { criterion: "Handover dossier exists", status: "met" },
      { criterion: "Initial maintenance strategy in place", status: "met" },
    ]);
    expect(r.ready).toBe(false);
    expect(r.missingFindings).toEqual(["As-built baseline recorded"]);
    expect(r.reason).toMatch(/silence is treated as unmet/i);
    expect(r.reason).toMatch(/nobody having looked/i);
  });

  it("REFUSES to call a gate with no criteria ready", () => {
    const r = assessGate([], []);
    expect(r.ready).toBe(false);
    expect(r.reason).toMatch(
      /blocks nothing, which looks like control and is not/i,
    );
  });

  it("ignores findings for criteria that are not on the gate", () => {
    const r = assessGate(CRITERIA, [
      { criterion: "Handover dossier exists", status: "met" },
      { criterion: "Initial maintenance strategy in place", status: "met" },
      { criterion: "As-built baseline recorded", status: "met" },
      { criterion: "Something nobody asked for", status: "met" },
    ]);
    expect(r.ready).toBe(true);
    expect(r.metCount).toBe(3);
  });
});

const STAGES: StageRef[] = [
  {
    stageKey: "need_identification",
    label: "Need identification",
    phase: "pre_service",
    stageOrder: 10,
  },
  { stageKey: "design", label: "Design", phase: "pre_service", stageOrder: 40 },
  {
    stageKey: "commissioning",
    label: "Commissioning",
    phase: "pre_service",
    stageOrder: 70,
  },
  {
    stageKey: "operation",
    label: "Operation",
    phase: "in_service",
    stageOrder: 80,
  },
  {
    stageKey: "maintenance",
    label: "Maintenance",
    phase: "in_service",
    stageOrder: 81,
  },
  {
    stageKey: "replacement",
    label: "Replacement",
    phase: "end_of_life",
    stageOrder: 91,
  },
  {
    stageKey: "disposal",
    label: "Disposal",
    phase: "end_of_life",
    stageOrder: 93,
  },
];

describe("wholeLifeCoverage", () => {
  it("names an entirely inherited register for what it is", () => {
    // The real starting state: everything in service, nothing gated.
    const r = wholeLifeCoverage(STAGES, [
      { stageKey: "operation", assetCount: 178, gatedCount: 0 },
      { stageKey: "commissioning", assetCount: 3, gatedCount: 0 },
    ]);
    expect(r.totalAssets).toBe(181);
    expect(r.totalGated).toBe(0);
    expect(r.reason).toMatch(/by inheriting an existing register/i);
    expect(r.reason).toMatch(
      /describes where things are, not how they got there/i,
    );
    // And it must not read as an accusation.
    expect(r.reason).toMatch(/normal starting point, not a failing/i);
  });

  it("adds the pre-service warning only when no asset is in that phase", () => {
    const none = wholeLifeCoverage(STAGES, [
      { stageKey: "operation", assetCount: 10, gatedCount: 0 },
    ]);
    expect(none.reason).toMatch(/outside what this platform has seen/i);

    const some = wholeLifeCoverage(STAGES, [
      { stageKey: "operation", assetCount: 10, gatedCount: 2 },
      { stageKey: "design", assetCount: 1, gatedCount: 1 },
    ]);
    expect(some.reason).not.toMatch(/outside what this platform has seen/i);
  });

  it("splits gated from inherited once assets start moving through gates", () => {
    const r = wholeLifeCoverage(STAGES, [
      { stageKey: "operation", assetCount: 10, gatedCount: 4 },
      { stageKey: "design", assetCount: 2, gatedCount: 2 },
    ]);
    expect(r.totalGated).toBe(6);
    expect(r.reason).toMatch(
      /6 of 12 staged assets reached their current stage/,
    );
    expect(r.reason).toMatch(/remaining 6 inherited it/);
  });

  it("totals each phase separately", () => {
    const r = wholeLifeCoverage(STAGES, [
      { stageKey: "design", assetCount: 2, gatedCount: 2 },
      { stageKey: "operation", assetCount: 10, gatedCount: 1 },
      { stageKey: "maintenance", assetCount: 5, gatedCount: 0 },
      { stageKey: "disposal", assetCount: 1, gatedCount: 1 },
    ]);
    expect(r.byPhase).toEqual([
      { phase: "pre_service", stages: 3, assetsHere: 2, gatedHere: 2 },
      { phase: "in_service", stages: 2, assetsHere: 15, gatedHere: 1 },
      { phase: "end_of_life", stages: 2, assetsHere: 1, gatedHere: 1 },
    ]);
  });

  it("lists the stages the organisation has never used", () => {
    const r = wholeLifeCoverage(STAGES, [
      { stageKey: "operation", assetCount: 10, gatedCount: 0 },
    ]);
    expect(r.unusedStages).toContain("Need identification");
    expect(r.unusedStages).toContain("Disposal");
    expect(r.unusedStages).not.toContain("Operation");
  });

  it("says so plainly when nothing is staged at all", () => {
    const r = wholeLifeCoverage(STAGES, []);
    expect(r.totalAssets).toBe(0);
    expect(r.reason).toBe("No asset carries a lifecycle stage.");
  });
});

// ---------------------------------------------------------------------------
// gateReadiness (D3.35, spec §45) — the weighted extension of assessGate.
// ---------------------------------------------------------------------------
import { gateReadiness } from "./stages";

const WEIGHTED: GateCriterion[] = [
  {
    criterion: "Scope defined",
    isMandatory: true,
    weight: 3,
    category: "technical",
  },
  {
    criterion: "Estimate basis stated",
    isMandatory: true,
    weight: 2,
    category: "cost_schedule",
  },
  {
    criterion: "Operations reviewed the design",
    isMandatory: false,
    weight: 1,
    category: "operations",
  },
  // Deliberately uncategorized and unweighted: defaults to 1.0 and rolls up
  // visibly as 'uncategorized'.
  { criterion: "Constructability review scheduled", isMandatory: false },
];

describe("gateReadiness", () => {
  it("computes GR = Σ(w·r)/Σw with met=1 and everything else 0", () => {
    const r = gateReadiness(WEIGHTED, [
      { criterion: "Scope defined", status: "met" },
      { criterion: "Estimate basis stated", status: "not_met" },
      { criterion: "Operations reviewed the design", status: "met" },
    ]);
    // met weight = 3 + 1 of Σw = 7 → 57.1%
    expect(r.readinessPct).toBe(57.1);
    expect(r.weightSum).toBe(7);
  });

  it("one failed mandatory forces BLOCKED at any percentage — 97% cannot hide it", () => {
    // 32 advisory criteria met + 1 mandatory not met → ~97% and still blocked.
    const many: GateCriterion[] = [
      { criterion: "The one mandatory safety issue", isMandatory: true },
      ...Array.from({ length: 32 }, (_, i) => ({
        criterion: `Advisory item ${i}`,
        isMandatory: false,
      })),
    ];
    const findings = [
      { criterion: "The one mandatory safety issue", status: "not_met" as const },
      ...Array.from({ length: 32 }, (_, i) => ({
        criterion: `Advisory item ${i}`,
        status: "met" as const,
      })),
    ];
    const r = gateReadiness(many, findings);
    expect(r.readinessPct).toBe(97);
    expect(r.blocked).toBe(true);
    expect(r.assessment.notMet).toContain("The one mandatory safety issue");
  });

  it("a mandatory criterion never assessed at all blocks — absence is not a pass", () => {
    const r = gateReadiness(WEIGHTED, [
      { criterion: "Estimate basis stated", status: "met" },
      { criterion: "Operations reviewed the design", status: "met" },
    ]);
    expect(r.blocked).toBe(true);
    expect(r.assessment.missingFindings).toContain("Scope defined");
  });

  it("blocked is exactly assessGate's verdict — the extension cannot drift from the evaluator", () => {
    const findings = [{ criterion: "Scope defined", status: "met" as const }];
    const r = gateReadiness(WEIGHTED, findings);
    expect(r.blocked).toBe(!assessGate(WEIGHTED, findings).ready);
  });

  it("rolls up per category, spec-§44 order, uncategorized visible and last", () => {
    const r = gateReadiness(WEIGHTED, [
      { criterion: "Scope defined", status: "met" },
      { criterion: "Constructability review scheduled", status: "met" },
    ]);
    expect(r.categories.map((c) => c.category)).toEqual([
      "technical",
      "cost_schedule",
      "operations",
      "uncategorized",
    ]);
    const uncategorized = r.categories.find(
      (c) => c.category === "uncategorized",
    );
    expect(uncategorized?.criteriaTotal).toBe(1);
    expect(uncategorized?.readinessPct).toBe(100);
    const technical = r.categories.find((c) => c.category === "technical");
    expect(technical?.readinessPct).toBe(100);
    const cost = r.categories.find((c) => c.category === "cost_schedule");
    expect(cost?.readinessPct).toBe(0);
    expect(cost?.unmetMandatory).toBe(1);
  });

  it("an empty gate has NULL readiness — 0/0 is not a number — and blocks", () => {
    const r = gateReadiness([], []);
    expect(r.readinessPct).toBeNull();
    expect(r.blocked).toBe(true);
    expect(r.categories).toEqual([]);
  });

  it("weights shape the percentage only — a heavy advisory miss never unblocks a mandatory pass", () => {
    const criteria: GateCriterion[] = [
      { criterion: "Mandatory thing", isMandatory: true, weight: 1 },
      { criterion: "Heavy advisory", isMandatory: false, weight: 99 },
    ];
    const r = gateReadiness(criteria, [
      { criterion: "Mandatory thing", status: "met" },
    ]);
    expect(r.blocked).toBe(false);
    expect(r.readinessPct).toBe(1); // 1/100
  });

  it("duplicate findings for one criterion never fan out counts — the LAST finding wins, the congruence rule the DB repeats", () => {
    // record_case_gate_review (20261110090400) refuses duplicates outright,
    // so via the sanctioned path this state cannot exist; this pins how the
    // client evaluator treats rows the admitted-and-audited service path (or
    // pre-refusal history) could still hold. The rule: one finding per
    // criterion, LAST entry wins — and the feed is id-ordered
    // (get_development_case orders findings by id), so "last" is the LATEST
    // finding, the same winner get_gate_readiness's LATERAL
    // (order by id desc limit 1) picks. Counts must reflect the CRITERIA,
    // never the finding multiplicity.
    const criteria: GateCriterion[] = [
      { criterion: "Contested criterion", isMandatory: true, weight: 1 },
      { criterion: "Quiet advisory", isMandatory: false, weight: 1 },
    ];
    const contested = gateReadiness(criteria, [
      { criterion: "Contested criterion", status: "met" },
      { criterion: "Contested criterion", status: "not_met" },
    ]);
    // Last wins: not_met. Denominators stay the real criterion set.
    expect(contested.blocked).toBe(true);
    expect(contested.assessment.notMet).toContain("Contested criterion");
    expect(contested.readinessPct).toBe(0);
    expect(contested.weightSum).toBe(2);
    expect(
      contested.categories.reduce((n, c) => n + c.criteriaTotal, 0),
    ).toBe(2);

    const reversed = gateReadiness(criteria, [
      { criterion: "Contested criterion", status: "not_met" },
      { criterion: "Contested criterion", status: "met" },
    ]);
    expect(reversed.blocked).toBe(false);
    expect(reversed.readinessPct).toBe(50);
    expect(reversed.weightSum).toBe(2);
  });
});
