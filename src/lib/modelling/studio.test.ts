import { describe, expect, it } from "vitest";
import { analyseModellingStudio, type ModellingStudioSource } from "./studio";

function fixture(): ModellingStudioSource {
  return {
    trees: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        treeKey: "loss-of-service",
        title: "Loss of service",
        topEvent: "Service unavailable",
        basis: "Approved engineering review",
        reviewed: true,
        nodes: [
          {
            id: "TOP",
            label: "Service unavailable",
            gate: "OR",
            voteThreshold: null,
            parent: null,
            probability: null,
          },
          {
            id: "A",
            label: "Feed A fails",
            gate: null,
            voteThreshold: null,
            parent: "TOP",
            probability: 0.1,
          },
          {
            id: "B",
            label: "Feed B fails",
            gate: null,
            voteThreshold: null,
            parent: "TOP",
            probability: 0.2,
          },
        ],
      },
    ],
    schedules: [
      {
        id: "22222222-2222-4222-8222-222222222222",
        eventKey: "outage-2027",
        title: "Outage 2027",
        status: "planning",
        tasks: [
          {
            id: "isolate",
            label: "Isolate",
            duration: 10,
            optimistic: 8,
            pessimistic: 14,
            predecessors: [],
          },
          {
            id: "repair",
            label: "Repair",
            duration: 20,
            optimistic: 16,
            pessimistic: 30,
            predecessors: ["isolate"],
          },
        ],
      },
    ],
    cost: [
      { period: "2026-01", plannedCost: 10, unplannedCost: 5, failureCount: 1 },
      { period: "2026-02", plannedCost: 11, unplannedCost: 7, failureCount: 1 },
      { period: "2026-03", plannedCost: 12, unplannedCost: 6, failureCount: 1 },
      { period: "2026-04", plannedCost: 13, unplannedCost: 8, failureCount: 1 },
    ],
    posture: { basis: "Downtime-cost proxy, not maintenance spend." },
    graph: {
      nodes: [
        { id: "asset-a", tag: "A-1", name: "Asset A" },
        { id: "asset-b", tag: "B-1", name: "Asset B" },
      ],
      edges: [
        {
          id: "edge-1",
          dependent: "asset-b",
          supplier: "asset-a",
          redundancyGroup: null,
          minRequired: 1,
        },
      ],
    },
    history: [
      {
        id: "wo-1",
        asset_id: "asset-a",
        tag: "A-1",
        name: "Asset A",
        completed_at: "2026-01-01T00:00:00Z",
        downtime_hours: 2,
      },
      {
        id: "wo-2",
        asset_id: "asset-a",
        tag: "A-1",
        name: "Asset A",
        completed_at: "2026-02-01T00:00:00Z",
        downtime_hours: 3,
      },
      {
        id: "wo-3",
        asset_id: "asset-a",
        tag: "A-1",
        name: "Asset A",
        completed_at: "2026-04-01T00:00:00Z",
        downtime_hours: 4,
      },
    ],
  };
}

describe("analyseModellingStudio", () => {
  it("composes all five model families deterministically", () => {
    const first = analyseModellingStudio(fixture());
    const second = analyseModellingStudio(fixture());

    expect(first).toEqual(second);
    expect(first.trees[0].result.topEventProbability).toBeCloseTo(0.28, 10);
    expect(first.schedules[0].result.simulated).toBe(true);
    expect(first.rbd.result.computable).toBe(true);
    expect(first.simulation.simulable).toBe(true);
    expect(first.forecast.forecastable).toBe(true);
  });

  it("retains refusals rather than filling evidence gaps", () => {
    const source = fixture();
    source.trees[0].nodes[1].probability = null;
    source.history = [];
    source.cost = [];

    const result = analyseModellingStudio(source);

    expect(result.trees[0].result.computable).toBe(false);
    expect(result.rbd.result.computable).toBe(false);
    expect(result.simulation.simulable).toBe(false);
    expect(result.forecast.forecastable).toBe(false);
  });

  it("carries recorded common cause into the RBD as an unquantified upper bound", () => {
    const source = fixture();
    source.graph!.nodes!.push({ id: "asset-c", tag: "C-1", name: "Asset C" });
    source.graph!.edges = [
      {
        id: "edge-1",
        dependent: "asset-b",
        supplier: "asset-a",
        redundancyGroup: "feeds",
        minRequired: 1,
      },
      {
        id: "edge-2",
        dependent: "asset-b",
        supplier: "asset-c",
        redundancyGroup: "feeds",
        minRequired: 1,
      },
    ];
    source.graph!.commonCauseGroups = [
      {
        id: 9,
        name: "Shared feeder",
        causeKind: "shared_supply",
        members: ["asset-a", "asset-c"],
      },
    ];
    source.history.push(
      {
        id: "wo-c1",
        asset_id: "asset-c",
        tag: "C-1",
        name: "Asset C",
        completed_at: "2026-01-03T00:00:00Z",
        downtime_hours: 1,
      },
      {
        id: "wo-c2",
        asset_id: "asset-c",
        tag: "C-1",
        name: "Asset C",
        completed_at: "2026-02-05T00:00:00Z",
        downtime_hours: 2,
      },
      {
        id: "wo-c3",
        asset_id: "asset-c",
        tag: "C-1",
        name: "Asset C",
        completed_at: "2026-04-09T00:00:00Z",
        downtime_hours: 2,
      },
    );

    const result = analyseModellingStudio(source);

    expect(result.rbd.result.computable).toBe(true);
    expect(result.rbd.result.groupsWithUnquantifiedCommonCause).toEqual([
      "feeds",
    ]);
    expect(result.rbd.result.reason).toContain("upper bound");
  });
});
