/**
 * Validation for interdependency analysis.
 *
 * Graph code is easy to write and easy to get subtly wrong, and the wrong
 * answers here are the dangerous kind: a cascade that stops one hop short, or
 * a redundancy that the model believes in and the plant does not. So the
 * fixture below is a small plant worked out by hand, and each expectation is
 * the answer a person tracing the diagram would give.
 *
 *   sub ──┬─> mcc-a ──> pump-1 ─┐
 *         └─> mcc-b ──> pump-2 ─┴─[group "pumps", 100% each]─> header ──> crusher*
 *
 *   feeder-1 ─┐
 *   feeder-2 ─┴─[group "feeders", 50% each]─> conveyor ──[100%]──> stacker
 *
 *   mill <── lube (60% declared, and nothing else: an incomplete model)
 *
 *   * crusher carries the only declared service level.
 *   Common cause "Pump house": pump-1 and pump-2 share a bund and a fire area.
 */
import { describe, expect, it } from "vitest";
import {
  propagateLoss,
  singlePointsOfFailure,
  commonCauseExposure,
  restorationOrder,
  capacityGaps,
  type DependencyGraph,
} from "./index";

const PLANT: DependencyGraph = {
  nodes: [
    { id: "sub", name: "Substation 1", criticality: "critical" },
    { id: "mcc-a", name: "MCC A", criticality: "low" },
    { id: "mcc-b", name: "MCC B", criticality: "low" },
    { id: "pump-1", name: "Pump 1", criticality: "high" },
    { id: "pump-2", name: "Pump 2", criticality: "high" },
    { id: "header", name: "Slurry header", criticality: "medium" },
    {
      id: "crusher",
      name: "Primary crusher",
      criticality: "critical",
      serviceName: "Ore throughput",
      consequenceClass: "production",
      restorationRank: 1,
    },
    { id: "feeder-1", name: "Feeder 1", criticality: "medium" },
    { id: "feeder-2", name: "Feeder 2", criticality: "medium" },
    { id: "conveyor", name: "Conveyor CV-01", criticality: "high" },
    { id: "stacker", name: "Stacker", criticality: "medium" },
    { id: "mill", name: "Ball mill", criticality: "high" },
    { id: "lube", name: "Mill lube skid", criticality: "medium" },
  ],
  edges: [
    { dependent: "mcc-a", supplier: "sub", kind: "utility" },
    { dependent: "mcc-b", supplier: "sub", kind: "utility" },
    { dependent: "pump-1", supplier: "mcc-a", kind: "utility" },
    { dependent: "pump-2", supplier: "mcc-b", kind: "utility" },
    {
      dependent: "header",
      supplier: "pump-1",
      kind: "functional",
      redundancyGroup: "pumps",
      capacitySharePct: 100,
    },
    {
      dependent: "header",
      supplier: "pump-2",
      kind: "functional",
      redundancyGroup: "pumps",
      capacitySharePct: 100,
    },
    { dependent: "crusher", supplier: "header", kind: "functional" },
    {
      dependent: "conveyor",
      supplier: "feeder-1",
      kind: "topological",
      redundancyGroup: "feeders",
      capacitySharePct: 50,
    },
    {
      dependent: "conveyor",
      supplier: "feeder-2",
      kind: "topological",
      redundancyGroup: "feeders",
      capacitySharePct: 50,
    },
    {
      dependent: "stacker",
      supplier: "conveyor",
      kind: "topological",
      capacitySharePct: 100,
    },
    {
      dependent: "mill",
      supplier: "lube",
      kind: "functional",
      capacitySharePct: 60,
    },
  ],
  commonCauseGroups: [
    {
      id: 1,
      name: "Pump house",
      causeKind: "shared_location",
      members: ["pump-1", "pump-2"],
    },
  ],
};

const ids = (r: { impacted: { id: string }[] }) =>
  r.impacted.map((i) => i.id).sort();

describe("cascade propagation", () => {
  it("carries the loss of the substation all the way to the crusher", () => {
    const r = propagateLoss(PLANT, ["sub"]);
    // Traced by hand: sub → both MCCs → both pumps → header (no survivors in
    // its redundancy group) → crusher.
    expect(ids(r)).toEqual(
      ["crusher", "header", "mcc-a", "mcc-b", "pump-1", "pump-2", "sub"].sort(),
    );
    expect(r.lostCount).toBe(7);
    expect(r.servicesLost).toEqual(["Ore throughput"]);
  });

  it("stops at the redundant pair when only one leg is lost", () => {
    const r = propagateLoss(PLANT, ["mcc-a"]);
    expect(ids(r)).toEqual(["mcc-a", "pump-1"]);
    expect(r.lostCount).toBe(2);
    expect(r.degradedCount).toBe(0);
  });

  it("degrades rather than stops when the survivors carry part of the load", () => {
    const r = propagateLoss(PLANT, ["feeder-1"]);
    const conveyor = r.impacted.find((i) => i.id === "conveyor");
    expect(conveyor?.state).toBe("degraded");
    expect(conveyor?.capacityPct).toBe(50);
    expect(conveyor?.capacityModelled).toBe(true);
  });

  it("propagates the degradation proportionally, not just the outage", () => {
    // Stacker takes 100% of its supply from a conveyor now running at 50%.
    const r = propagateLoss(PLANT, ["feeder-1"]);
    const stacker = r.impacted.find((i) => i.id === "stacker");
    expect(stacker?.state).toBe("degraded");
    expect(stacker?.capacityPct).toBe(50);
  });

  it("treats separate supply groups as conjunctive — the worst one limits", () => {
    // A machine needing power AND cooling runs at the worse of the two.
    const g: DependencyGraph = {
      nodes: [{ id: "m", name: "Machine" }],
      edges: [
        {
          dependent: "m",
          supplier: "pwr-a",
          kind: "utility",
          redundancyGroup: "power",
          capacitySharePct: 50,
        },
        {
          dependent: "m",
          supplier: "pwr-b",
          kind: "utility",
          redundancyGroup: "power",
          capacitySharePct: 50,
        },
        {
          dependent: "m",
          supplier: "cool",
          kind: "utility",
          capacitySharePct: 100,
        },
      ],
      commonCauseGroups: [],
    };
    const r = propagateLoss(g, ["pwr-a"]);
    // Power at 50, cooling at 100 → the machine is at 50, not 150 and not 75.
    expect(r.impacted.find((i) => i.id === "m")?.capacityPct).toBe(50);
  });

  it("honours minSuppliersRequired for N+2 arrangements", () => {
    const g: DependencyGraph = {
      nodes: [{ id: "d", name: "Dependent" }],
      edges: ["a", "b", "c"].map((s) => ({
        dependent: "d",
        supplier: s,
        kind: "utility" as const,
        redundancyGroup: "trio",
        minRequired: 2,
      })),
      commonCauseGroups: [],
    };
    expect(propagateLoss(g, ["a"]).impacted.some((i) => i.id === "d")).toBe(
      false,
    );
    const two = propagateLoss(g, ["a", "b"]);
    expect(two.impacted.find((i) => i.id === "d")?.state).toBe("lost");
    expect(two.impacted.find((i) => i.id === "d")?.cause).toMatch(
      /needs 2 of 3 and has 1/,
    );
  });

  it("refuses to call an empty graph resilient", () => {
    const r = propagateLoss(
      { nodes: [{ id: "a", name: "A" }], edges: [], commonCauseGroups: [] },
      ["a"],
    );
    expect(r.reliable).toBe(false);
    expect(r.reason).toMatch(/empty graph, not a resilient plant/i);
  });

  it("keeps a supplier that the node list forgot", () => {
    // An edge naming an asset absent from nodes must not silently vanish.
    const g: DependencyGraph = {
      nodes: [{ id: "d", name: "Dependent" }],
      edges: [{ dependent: "d", supplier: "ghost", kind: "utility" }],
      commonCauseGroups: [],
    };
    expect(propagateLoss(g, ["ghost"]).lostCount).toBe(2);
  });
});

describe("single points of failure", () => {
  const r = singlePointsOfFailure(PLANT);

  it("does not name a genuinely redundant pump", () => {
    // Pump 1 alone strands nothing: Pump 2 carries the full header load.
    expect(r.points.map((p) => p.id)).not.toContain("pump-1");
    expect(r.points.map((p) => p.id)).not.toContain("pump-2");
  });

  it("ranks the substation first and names the header", () => {
    expect(r.points[0].id).toBe("sub");
    expect(r.points[0].assetsLost).toBe(6);
    expect(r.points.map((p) => p.id)).toContain("header");
  });

  it("counts an asset that only degrades others", () => {
    const f1 = r.points.find((p) => p.id === "feeder-1");
    expect(f1?.assetsLost).toBe(0);
    expect(f1?.assetsDegraded).toBe(2); // conveyor and stacker
  });

  it("flags a medium-rated asset that strands a service as underrated", () => {
    expect(r.points.find((p) => p.id === "header")?.underrated).toBe(true);
    expect(r.points.find((p) => p.id === "sub")?.underrated).toBe(false);
    expect(r.reason).toMatch(/rating error the asset record cannot see/i);
  });

  it("REFUSES to report a clean result from an empty graph", () => {
    const empty = singlePointsOfFailure({
      nodes: PLANT.nodes,
      edges: [],
      commonCauseGroups: [],
    });
    expect(empty.reliable).toBe(false);
    expect(empty.points).toEqual([]);
    expect(empty.reason).toMatch(/says nothing about the plant/i);
  });
});

describe("common cause — the point of the module", () => {
  const r = commonCauseExposure(PLANT);

  it("finds the redundancy that a shared cause defeats", () => {
    expect(r.defeatedRedundancies).toHaveLength(1);
    const d = r.defeatedRedundancies[0];
    expect(d.dependent).toBe("header");
    expect(d.redundancyGroup).toBe("pumps");
    expect(d.commonCauseGroup).toBe("Pump house");
    expect(d.reason).toMatch(/defends nothing against that cause/i);
  });

  it("measures how much worse the shared cause is than any one member", () => {
    const f = r.findings[0];
    // Both pumps together: pumps + header + crusher = 4 lost.
    expect(f.assetsLost).toBe(4);
    // Either pump alone loses only itself, so the group costs 3 extra.
    expect(f.amplification).toBe(3);
    expect(f.servicesLost).toEqual(["Ore throughput"]);
  });

  it("does not flag a redundancy whose members are independent", () => {
    const independent = commonCauseExposure({
      ...PLANT,
      commonCauseGroups: [
        {
          id: 2,
          name: "Feeder pit",
          causeKind: "shared_location",
          members: ["feeder-1"],
        },
      ],
    });
    expect(independent.defeatedRedundancies).toEqual([]);
    expect(independent.reason).toMatch(
      /survives the causes that are recorded/i,
    );
  });

  it("REFUSES to imply independence when no groups are defined", () => {
    const none = commonCauseExposure({ ...PLANT, commonCauseGroups: [] });
    expect(none.reliable).toBe(false);
    expect(none.reason).toMatch(/assumed to fail independently/i);
    expect(none.reason).toMatch(/most often turns out to be false/i);
  });
});

describe("restoration sequencing", () => {
  it("never restores an asset before what it depends on", () => {
    const r = restorationOrder(PLANT, [
      "crusher",
      "header",
      "pump-1",
      "mcc-a",
      "sub",
    ]);
    expect(r.steps.map((s) => s.id)).toEqual([
      "sub",
      "mcc-a",
      "pump-1",
      "header",
      "crusher",
    ]);
    expect(r.cycles).toEqual([]);
    expect(r.steps[0].reason).toMatch(/can start immediately/i);
    expect(r.steps[4].waitsOn).toEqual(["Slurry header"]);
  });

  it("puts the more consequential first when both are ready at once", () => {
    const r = restorationOrder(PLANT, ["crusher", "mill"]);
    // Neither waits on the other; the crusher carries a declared service with
    // restoration rank 1, the mill carries none.
    expect(r.steps[0].id).toBe("crusher");
  });

  it("REFUSES to invent an order for a dependency cycle", () => {
    const ring: DependencyGraph = {
      nodes: [
        { id: "a", name: "A" },
        { id: "b", name: "B" },
      ],
      edges: [
        { dependent: "a", supplier: "b", kind: "control" },
        { dependent: "b", supplier: "a", kind: "control" },
      ],
      commonCauseGroups: [],
    };
    const r = restorationOrder(ring, ["a", "b"]);
    expect(r.steps).toEqual([]);
    expect(r.cycles[0]).toEqual(["a", "b"]);
    expect(r.reason).toMatch(/blackstart source or a temporary supply/i);
  });

  it("says an order over an empty graph reflects consequence only", () => {
    const r = restorationOrder(
      { nodes: PLANT.nodes, edges: [], commonCauseGroups: [] },
      ["crusher", "mill"],
    );
    expect(r.reliable).toBe(false);
    expect(r.reason).toMatch(/this order is arbitrary/i);
  });
});

describe("capacity modelling gaps", () => {
  const gaps = capacityGaps(PLANT);

  it("flags a supply that does not add up to the whole", () => {
    const mill = gaps.find((g) => g.id === "mill");
    expect(mill?.declaredPct).toBe(60);
    expect(mill?.reason).toMatch(/understated either way/i);
  });

  it("does not flag an N+1 pair that each carry the full load", () => {
    // 100 + 100 = 200 is what redundancy looks like, not a modelling error.
    expect(gaps.some((g) => g.id === "header")).toBe(false);
  });

  it("does not flag two halves that add to a whole", () => {
    expect(gaps.some((g) => g.id === "conveyor")).toBe(false);
  });

  it("flags a shortfall inside a redundancy group, not just a solo edge", () => {
    const short = capacityGaps({
      nodes: [{ id: "x", name: "X" }],
      edges: ["y", "z"].map((s) => ({
        dependent: "x",
        supplier: s,
        kind: "utility" as const,
        redundancyGroup: "pair",
        capacitySharePct: 30,
      })),
      commonCauseGroups: [],
    });
    // 30 + 30 = 60: even with both alive the group cannot supply the asset.
    expect(short).toHaveLength(1);
    expect(short[0].declaredPct).toBe(60);
    expect(short[0].redundancyGroup).toBe("pair");
  });

  it("says nothing about assets whose shares were never declared", () => {
    // Silence on an unmodelled asset, not a false all-clear.
    expect(gaps.some((g) => g.id === "crusher")).toBe(false);
  });
});
