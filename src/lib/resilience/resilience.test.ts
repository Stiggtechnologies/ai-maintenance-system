/**
 * Validation for resilience scenarios.
 *
 * The cascade itself is already tested in src/lib/interdependency, so these
 * tests deliberately do NOT re-test it. What they cover is the part this
 * module adds: whether an impact figure may be called an estimate or must be
 * called a floor, and whether an operating mode is actually operable.
 */
import { describe, expect, it } from "vitest";
import {
  assessScenario,
  exerciseStatus,
  assessOperatingModes,
  type Scenario,
  type OperatingMode,
} from "./index";
import type { DependencyGraph } from "../interdependency";

const NOW = new Date("2026-08-19T00:00:00Z");

/** sub -> mcc -> pump -> header; plus an isolated asset with no edges. */
const GRAPH: DependencyGraph = {
  nodes: [
    { id: "sub", name: "Substation" },
    { id: "mcc", name: "MCC" },
    { id: "pump", name: "Pump" },
    { id: "header", name: "Header", serviceName: "Cooling" },
    { id: "lonely", name: "Unmapped asset" },
  ],
  edges: [
    { dependent: "mcc", supplier: "sub", kind: "utility" },
    { dependent: "pump", supplier: "mcc", kind: "utility" },
    { dependent: "header", supplier: "pump", kind: "functional" },
  ],
  commonCauseGroups: [],
};

describe("assessScenario", () => {
  it("carries a grid loss through the graph and names the service", () => {
    const s: Scenario = {
      scenarioKey: "grid",
      title: "Grid interruption",
      threatKind: "grid_interruption",
      directlyAffected: ["sub"],
    };
    const r = assessScenario(s, GRAPH);
    expect(r.totalLost).toBe(4); // sub, mcc, pump, header
    expect(r.servicesLost).toEqual(["Cooling"]);
    // Pinned: an earlier version read directCount off the INPUT, where it does
    // not exist, and rendered "directly removes undefined asset(s)".
    expect(r.reason).toMatch(/directly removes 1 asset\(s\)/);
    expect(r.boundedEstimate).toBe(true);
    expect(r.reason).not.toMatch(/FLOOR/);
  });

  it("calls the figure a FLOOR when an affected asset is not in the graph", () => {
    const s: Scenario = {
      scenarioKey: "fire",
      title: "Wildfire",
      threatKind: "wildfire",
      // 'ghost' is nowhere in the graph at all.
      directlyAffected: ["sub", "ghost"],
    };
    const r = assessScenario(s, GRAPH);
    expect(r.uncoveredCount).toBe(1);
    expect(r.uncovered).toEqual(["ghost"]);
    expect(r.boundedEstimate).toBe(false);
    expect(r.reason).toMatch(/directly removes 2 asset\(s\)/);
    expect(r.reason).toMatch(/NO recorded dependencies/);
    expect(r.reason).toMatch(/as a FLOOR, not an estimate/);
  });

  it("counts an in-graph asset with no edges as covered, not missing", () => {
    // 'lonely' IS a node; it simply has nothing downstream. That is a fact
    // about the plant, not a gap in the data.
    const r = assessScenario(
      {
        scenarioKey: "x",
        title: "Equipment loss",
        threatKind: "major_equipment_loss",
        directlyAffected: ["lonely"],
      },
      GRAPH,
    );
    expect(r.uncoveredCount).toBe(0);
    expect(r.boundedEstimate).toBe(true);
    expect(r.totalLost).toBe(1);
  });

  it("refuses to treat an empty graph as a bounded result", () => {
    const empty: DependencyGraph = {
      nodes: [{ id: "sub", name: "Substation" }],
      edges: [],
      commonCauseGroups: [],
    };
    const r = assessScenario(
      {
        scenarioKey: "grid",
        title: "Grid interruption",
        threatKind: "grid_interruption",
        directlyAffected: ["sub"],
      },
      empty,
    );
    expect(r.boundedEstimate).toBe(false);
    expect(r.reason).toMatch(/dependency graph is empty/);
    expect(r.reason).toMatch(/FLOOR/);
  });

  it("calls a scenario with no mapped exposure a title", () => {
    const r = assessScenario(
      {
        scenarioKey: "cyber",
        title: "Cyber incident",
        threatKind: "cyber_incident",
        directlyAffected: [],
      },
      GRAPH,
    );
    expect(r.reason).toMatch(/A scenario with no exposure mapped is a title/);
  });
});

describe("exerciseStatus", () => {
  const base: Scenario = {
    scenarioKey: "evac",
    title: "Site evacuation",
    threatKind: "site_evacuation",
    directlyAffected: [],
  };

  it("treats an unexercised plan as untested capability", () => {
    const r = exerciseStatus({ ...base, planReference: "EP-001" }, NOW);
    expect(r.exercised).toBe(false);
    expect(r.stale).toBe(true);
    expect(r.reason).toMatch(/Every plan works on paper/);
  });

  it("distinguishes no plan at all from an unexercised plan", () => {
    const r = exerciseStatus(base, NOW);
    expect(r.reason).toMatch(/Neither a plan nor an exercise is recorded/);
  });

  it("counts the days since an exercise exactly", () => {
    const r = exerciseStatus(
      { ...base, lastExercisedOn: "2026-06-20", exerciseOutcome: "partial" },
      NOW,
    );
    expect(r.daysSince).toBe(60);
    expect(r.stale).toBe(false);
    expect(r.reason).toMatch(/\(partial\)/);
  });

  it("calls an old exercise stale and says why that matters", () => {
    const r = exerciseStatus({ ...base, lastExercisedOn: "2022-01-01" }, NOW);
    expect(r.stale).toBe(true);
    expect(r.reason).toMatch(/people who ran it have probably moved on/);
  });
});

describe("assessOperatingModes", () => {
  const full = (mode: OperatingMode["mode"]): OperatingMode => ({
    mode,
    entryCriteria: "stated",
    exitCriteria: "stated",
    declaredByRole: "Site manager",
    authorityChanges: "stated",
  });

  it("accepts four fully specified modes", () => {
    const r = assessOperatingModes([
      full("normal"),
      full("degraded"),
      full("emergency"),
      full("recovery"),
    ]);
    expect(r.usable).toBe(4);
    expect(r.gaps).toEqual([]);
  });

  it("names a mode that is not defined at all", () => {
    const r = assessOperatingModes([full("normal"), full("degraded")]);
    expect(r.usable).toBe(2);
    expect(r.gaps.map((g) => g.mode).sort()).toEqual(["emergency", "recovery"]);
    expect(r.gaps[0].missing).toEqual(["not defined at all"]);
  });

  it("names exactly which parts of a mode are missing", () => {
    const r = assessOperatingModes([
      full("normal"),
      full("degraded"),
      full("recovery"),
      { mode: "emergency", entryCriteria: "gas detection confirmed" },
    ]);
    const gap = r.gaps.find((g) => g.mode === "emergency");
    expect(gap?.missing).toEqual([
      "exit criteria",
      "who declares it",
      "what authority changes",
    ]);
    expect(r.reason).toMatch(/a word on a dashboard/);
  });

  it("does not count whitespace as a definition", () => {
    const r = assessOperatingModes([
      { ...full("normal"), declaredByRole: "   " },
      full("degraded"),
      full("emergency"),
      full("recovery"),
    ]);
    expect(r.usable).toBe(3);
    expect(r.gaps[0].missing).toEqual(["who declares it"]);
  });
});
