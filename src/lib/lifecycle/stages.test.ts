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
