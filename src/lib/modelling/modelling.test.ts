/**
 * Validation suite for the modelling engines.
 *
 * The standard here is agreement with a CLOSED-FORM answer wherever one exists,
 * not internal self-consistency. A simulation that agrees with itself proves
 * nothing; one that reproduces 1-(1-R)^n to four decimals is doing the
 * arithmetic right.
 */
import { describe, expect, it } from "vitest";
import {
  blockImportance,
  evaluateRbd,
  type RbdBlock,
  type RbdGroupSpec,
} from "./rbd";
import {
  analyseEventTree,
  analyseFaultTree,
  eventImportance,
  type FaultTreeNode,
} from "./fault-tree";
import { simulateProduction, type SimUnit } from "./monte-carlo";
import { criticalPath, scheduleRisk, type ScheduleTask } from "./schedule-risk";
import { forecastMaintenanceCost, type CostPeriod } from "./cost-forecast";
import { mulberry32, percentile, sampleWeibull } from "./random";

const block = (
  id: string,
  reliability: number | null,
  group: string,
  cc?: string,
): RbdBlock => ({ id, label: id, reliability, group, commonCauseGroup: cc });

describe("RBD — validated against closed form", () => {
  it("reproduces the series product exactly", () => {
    // Three blocks, each its own group => pure series. R = 0.9*0.95*0.99.
    const r = evaluateRbd(
      [block("a", 0.9, "g1"), block("b", 0.95, "g2"), block("c", 0.99, "g3")],
      [
        { group: "g1", minRequired: 1 },
        { group: "g2", minRequired: 1 },
        { group: "g3", minRequired: 1 },
      ],
    );
    expect(r.computable).toBe(true);
    expect(r.systemReliability).toBeCloseTo(0.9 * 0.95 * 0.99, 12);
  });

  it("reproduces 1-(1-R)^n for pure parallel", () => {
    // Three identical blocks in one group, 1 required. R = 1 - 0.2^3 = 0.992.
    const r = evaluateRbd(
      [block("a", 0.8, "g"), block("b", 0.8, "g"), block("c", 0.8, "g")],
      [{ group: "g", minRequired: 1 }],
    );
    expect(r.systemReliability).toBeCloseTo(1 - Math.pow(0.2, 3), 12);
  });

  it("reproduces the binomial sum for 2-out-of-3 identical blocks", () => {
    // C(3,2)R^2(1-R) + R^3 with R = 0.9 => 3*0.81*0.1 + 0.729 = 0.972.
    const r = evaluateRbd(
      [block("a", 0.9, "g"), block("b", 0.9, "g"), block("c", 0.9, "g")],
      [{ group: "g", minRequired: 2 }],
    );
    expect(r.systemReliability).toBeCloseTo(0.972, 12);
  });

  it("handles a k-out-of-n group of NON-identical blocks", () => {
    // The binomial formula does not apply. Exact: P(≥2 of 0.9,0.8,0.7).
    // = .9*.8*.3 + .9*.2*.7 + .1*.8*.7 + .9*.8*.7 = .216+.126+.056+.504 = .902
    const r = evaluateRbd(
      [block("a", 0.9, "g"), block("b", 0.8, "g"), block("c", 0.7, "g")],
      [{ group: "g", minRequired: 2 }],
    );
    expect(r.systemReliability).toBeCloseTo(0.902, 12);
  });

  it("never treats a missing reliability as 1.0", () => {
    const r = evaluateRbd(
      [block("a", 0.9, "g1"), block("b", null, "g2")],
      [
        { group: "g1", minRequired: 1 },
        { group: "g2", minRequired: 1 },
      ],
    );
    expect(r.computable).toBe(false);
    expect(r.systemReliability).toBeNull();
    expect(r.reason).toMatch(/better the less is known/);
  });

  it("makes common cause cost something, and shows what", () => {
    const blocks = [
      block("a", 0.99, "g", "shared-psu"),
      block("b", 0.99, "g", "shared-psu"),
    ];
    const independent = evaluateRbd(blocks, [{ group: "g", minRequired: 1 }]);
    const withCc = evaluateRbd(blocks, [
      { group: "g", minRequired: 1, betaFactor: 0.1 },
    ]);
    // Independent parallel: 1 - 0.01^2 = 0.9999.
    expect(independent.systemReliability).toBeCloseTo(0.9999, 12);
    // Beta model must be strictly worse — that is the entire point of it.
    expect(withCc.systemReliability!).toBeLessThan(
      independent.systemReliability!,
    );
    expect(withCc.groups[0].reason).toMatch(/what common cause costs/);
  });

  it("calls an unquantified common-cause group an upper bound", () => {
    const r = evaluateRbd(
      [
        block("a", 0.99, "g", "shared-psu"),
        block("b", 0.99, "g", "shared-psu"),
      ],
      [{ group: "g", minRequired: 1 }],
    );
    expect(r.groupsWithUnquantifiedCommonCause).toEqual(["g"]);
    expect(r.reason).toMatch(/upper bound/);
  });

  it("ranks a series block above a deeply redundant one, not by reliability", () => {
    // The redundant blocks are individually WORSE (0.8) than the series block
    // (0.95), so a naive "least reliable first" ranking gets this backwards.
    const specs: RbdGroupSpec[] = [
      { group: "series", minRequired: 1 },
      { group: "redundant", minRequired: 1 },
    ];
    const imp = blockImportance(
      [
        block("lonely", 0.95, "series"),
        block("r1", 0.8, "redundant"),
        block("r2", 0.8, "redundant"),
        block("r3", 0.8, "redundant"),
      ],
      specs,
    );
    expect(imp[0].blockId).toBe("lonely");
    expect(imp[0].birnbaum).toBeGreaterThan(imp[1].birnbaum);
  });
});

describe("Fault tree — validated against closed form", () => {
  const tree = (extra: Partial<FaultTreeNode>[] = []): FaultTreeNode[] => [
    { id: "TOP", label: "Loss of cooling", gate: "OR", children: ["G1", "e3"] },
    { id: "G1", label: "Both pumps out", gate: "AND", children: ["e1", "e2"] },
    { id: "e1", label: "Pump A fails", probability: 0.1 },
    { id: "e2", label: "Pump B fails", probability: 0.1 },
    { id: "e3", label: "Header blocked", probability: 0.01 },
    ...(extra as FaultTreeNode[]),
  ];

  it("finds the minimal cut sets", () => {
    const r = analyseFaultTree(tree(), "TOP");
    // {e3} and {e1,e2}.
    expect(r.cutSets.map((c) => c.events.join("+")).sort()).toEqual([
      "e1+e2",
      "e3",
    ]);
  });

  it("computes the top event exactly, not by summing cut sets", () => {
    const r = analyseFaultTree(tree(), "TOP");
    // P(e3 OR (e1 AND e2)) = 0.01 + 0.01 - 0.0001 = 0.0199.
    // The rare-event sum would give 0.02 — this must be the exact 0.0199.
    expect(r.method).toBe("exact");
    expect(r.topEventProbability).toBeCloseTo(0.0199, 12);
  });

  it("reports single points of failure before any probability", () => {
    const r = analyseFaultTree(tree(), "TOP");
    expect(r.singlePointsOfFailure.map((s) => s.labels[0])).toEqual([
      "Header blocked",
    ]);
    // The SPOF sentence must come first in the narrative.
    expect(r.reason.indexOf("SINGLE POINT")).toBeLessThan(
      r.reason.indexOf("Top-event probability"),
    );
  });

  it("refuses to treat a missing basic-event probability as zero", () => {
    const nodes = tree();
    nodes[4] = { id: "e3", label: "Header blocked", probability: null };
    const r = analyseFaultTree(nodes, "TOP");
    expect(r.computable).toBe(false);
    expect(r.topEventProbability).toBeNull();
    expect(r.reason).toMatch(/delete a failure path/);
  });

  it("expands a VOTE gate into its k-subsets", () => {
    const nodes: FaultTreeNode[] = [
      {
        id: "TOP",
        label: "2oo3 trip fails",
        gate: "VOTE",
        voteThreshold: 2,
        children: ["a", "b", "c"],
      },
      { id: "a", label: "Sensor A", probability: 0.05 },
      { id: "b", label: "Sensor B", probability: 0.05 },
      { id: "c", label: "Sensor C", probability: 0.05 },
    ];
    const r = analyseFaultTree(nodes, "TOP");
    // Three cut sets of order 2: {a,b},{a,c},{b,c}. No SPOF.
    expect(r.cutSets).toHaveLength(3);
    expect(r.cutSets.every((c) => c.order === 2)).toBe(true);
    expect(r.singlePointsOfFailure).toHaveLength(0);
    // Exact: 3*p^2 - 2*p^3 with p=0.05 => 0.0075 - 0.00025 = 0.00725.
    expect(r.topEventProbability).toBeCloseTo(3 * 0.0025 - 2 * 0.000125, 12);
  });

  it("does not hang on a cyclic tree", () => {
    const nodes: FaultTreeNode[] = [
      { id: "TOP", label: "T", gate: "OR", children: ["A"] },
      { id: "A", label: "A", gate: "OR", children: ["TOP", "b"] },
      { id: "b", label: "b", probability: 0.1 },
    ];
    const r = analyseFaultTree(nodes, "TOP");
    expect(r.cutSets.length).toBeGreaterThan(0);
  });

  it("breaks a Fussell-Vesely tie in favour of the single point of failure", () => {
    const imp = eventImportance(tree(), "TOP");
    // {e3} and {e1,e2} both carry probability 0.01, so all three events have
    // an IDENTICAL risk share of 0.01/0.0199. The tie is not incidental — it
    // is what happens whenever a SPOF and a redundant pair are equally likely.
    expect(imp[0].fussellVesely).toBeCloseTo(imp[1].fussellVesely, 12);
    // The order-1 cut set must win it: same share, different kind of problem.
    expect(imp[0].eventId).toBe("e3");
    expect(imp[0].minimumOrder).toBe(1);
    expect(imp[0].fussellVesely).toBeCloseTo(0.01 / 0.0199, 6);
    expect(imp[0].reason).toMatch(
      /Redundancy, not a better inspection interval/,
    );
  });
});

describe("Event tree", () => {
  it("conserves frequency across all outcomes", () => {
    const r = analyseEventTree(0.1, [
      {
        id: "b1",
        label: "Relief valve",
        pfd: 0.01,
        outcomeIfFailed: "Overpressure",
      },
      {
        id: "b2",
        label: "Bund",
        pfd: 0.05,
        outcomeIfFailed: "Spill to ground",
      },
    ]);
    expect(r.computable).toBe(true);
    const total = r.outcomes.reduce((s, o) => s + (o.frequencyPerYear ?? 0), 0);
    // Every path is mutually exclusive and exhaustive, so they must sum back
    // to the initiating frequency. This is the arithmetic check on the tree.
    expect(total).toBeCloseTo(0.1, 12);
  });

  it("refuses to assume an unassessed barrier works", () => {
    const r = analyseEventTree(0.1, [
      {
        id: "b1",
        label: "Relief valve",
        pfd: null,
        outcomeIfFailed: "Overpressure",
      },
    ]);
    expect(r.computable).toBe(false);
    expect(r.outcomes[0].frequencyPerYear).toBeNull();
    expect(r.outcomes[0].reason).toMatch(
      /An unassessed barrier is not a working one/,
    );
  });
});

describe("Monte Carlo", () => {
  const unit = (o: Partial<SimUnit>): SimUnit => ({
    id: "u",
    label: "Unit",
    beta: 1.5,
    eta: 2000,
    medianRepairHours: 24,
    repairSigma: 0.5,
    capacityPerHour: 100,
    ...o,
  });

  it("is reproducible for a given seed and different for another", () => {
    const input = {
      units: [unit({ id: "a", label: "A" }), unit({ id: "b", label: "B" })],
      horizonHours: 2000,
      iterations: 60,
      seed: 42,
      targetCapacityPerHour: 150,
    };
    const a = simulateProduction(input);
    const b = simulateProduction(input);
    const c = simulateProduction({ ...input, seed: 43 });
    expect(a.productionP50).toBe(b.productionP50);
    expect(c.productionP50).not.toBe(a.productionP50);
  });

  it("refuses rather than assuming parameters for an unfitted unit", () => {
    const r = simulateProduction({
      units: [
        unit({ id: "a", label: "A" }),
        unit({ id: "b", label: "B", beta: null, eta: null }),
      ],
      horizonHours: 1000,
      iterations: 20,
      seed: 1,
      targetCapacityPerHour: 100,
    });
    expect(r.simulable).toBe(false);
    expect(r.unitsRefused).toEqual(["B"]);
    // Crucially it does NOT silently simulate the one good unit.
    expect(r.reason).toMatch(
      /would model a smaller plant than the one that exists/,
    );
  });

  it("recovers the analytic availability of a single unit", () => {
    // beta=1 is exponential with MTBF = eta. Steady-state availability
    // = MTBF/(MTBF+MTTR). With eta=1000 and a repair median of 50 at sigma 0
    // the mean repair is exactly 50, so A = 1000/1050 ≈ 0.95238.
    const r = simulateProduction({
      units: [
        unit({
          id: "a",
          label: "A",
          beta: 1,
          eta: 1000,
          medianRepairHours: 50,
          repairSigma: 0,
        }),
      ],
      horizonHours: 200_000,
      iterations: 12,
      seed: 7,
      targetCapacityPerHour: 100,
    });
    expect(r.simulable).toBe(true);
    // Hourly-grid rounding is conservative (repairs round up), so the simulated
    // figure sits at or just below the analytic one.
    expect(r.productionP50!).toBeGreaterThan(0.93);
    expect(r.productionP50!).toBeLessThanOrEqual(1000 / 1050 + 0.005);
  });

  it("does not let spare capacity bank against a future outage", () => {
    // Two units of 100 each against a target of 100: an hour with both running
    // delivers 100, not 200, so surplus cannot repay a later shortfall.
    const r = simulateProduction({
      units: [unit({ id: "a", label: "A" }), unit({ id: "b", label: "B" })],
      horizonHours: 5000,
      iterations: 30,
      seed: 3,
      targetCapacityPerHour: 100,
    });
    expect(r.productionP50!).toBeLessThanOrEqual(1);
    expect(r.productionP90!).toBeLessThanOrEqual(1);
  });

  it("names an unreachable target as a capacity problem, not a maintenance one", () => {
    const r = simulateProduction({
      units: [unit({ id: "a", label: "A", capacityPerHour: 50 })],
      horizonHours: 1000,
      iterations: 10,
      seed: 5,
      targetCapacityPerHour: 100,
    });
    expect(r.reason).toMatch(/capacity problem, not a maintenance one/);
  });
});

describe("Schedule risk", () => {
  //  A(10) -> C(5)
  //  B(4)  -> C
  //  Critical path is A->C = 15; B has 6 hours of float.
  const tasks: ScheduleTask[] = [
    {
      id: "A",
      label: "Strip",
      duration: 10,
      predecessors: [],
      optimistic: 8,
      pessimistic: 14,
    },
    {
      id: "B",
      label: "Scaffold",
      duration: 4,
      predecessors: [],
      optimistic: 2,
      pessimistic: 20,
    },
    {
      id: "C",
      label: "Rebuild",
      duration: 5,
      predecessors: ["A", "B"],
      optimistic: 4,
      pessimistic: 7,
    },
  ];

  it("computes the critical path and float by hand-checkable arithmetic", () => {
    const r = criticalPath(tasks);
    expect(r.valid).toBe(true);
    expect(r.durationHours).toBe(15);
    expect(r.criticalPath.sort()).toEqual(["A", "C"]);
    expect(r.tasks.find((t) => t.id === "B")!.totalFloat).toBe(6);
  });

  it("refuses a cyclic network instead of producing a duration", () => {
    const r = criticalPath([
      { id: "A", label: "A", duration: 1, predecessors: ["B"] },
      { id: "B", label: "B", duration: 1, predecessors: ["A"] },
    ]);
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/its own predecessor/);
  });

  it("finds the float that is not protection", () => {
    // B has 6 hours of float but ranges from 2 to 20 — it should be critical
    // in a meaningful share of runs, which the bar chart never shows.
    const r = scheduleRisk(tasks, 3000, 99);
    expect(r.simulated).toBe(true);
    const b = r.criticality.find((c) => c.id === "B")!;
    expect(b.deterministicallyCritical).toBe(false);
    expect(b.criticalityIndex).toBeGreaterThan(0.2);
    expect(r.hiddenRisks.map((h) => h.id)).toContain("B");
    expect(b.reason).toMatch(
      /Float computed from a single-point estimate is not protection/,
    );
  });

  it("produces a P90 at or beyond the deterministic duration", () => {
    const r = scheduleRisk(tasks, 3000, 99);
    // Merge bias: with two parallel chains feeding C, the simulated duration is
    // driven by the max of both, so it cannot be better than deterministic at
    // the upper quantile.
    expect(r.p90!).toBeGreaterThanOrEqual(r.deterministicDuration);
    expect(r.probabilityOnPlan!).toBeLessThan(1);
  });

  it("is reproducible for a seed", () => {
    expect(scheduleRisk(tasks, 500, 7).p90).toBe(
      scheduleRisk(tasks, 500, 7).p90,
    );
  });

  it("declines to simulate when no task carries a range", () => {
    const r = scheduleRisk(
      tasks.map((t) => ({ ...t, optimistic: null, pessimistic: null })),
      100,
      1,
    );
    expect(r.simulated).toBe(false);
    expect(r.reason).toMatch(/confidence interval of zero width/);
  });
});

describe("Cost forecast", () => {
  const history: CostPeriod[] = [
    { period: "1", plannedCost: 100, unplannedCost: 40, failureCount: 2 },
    { period: "2", plannedCost: 110, unplannedCost: 90, failureCount: 4 },
    { period: "3", plannedCost: 120, unplannedCost: 30, failureCount: 1 },
    { period: "4", plannedCost: 130, unplannedCost: 200, failureCount: 7 },
    { period: "5", plannedCost: 140, unplannedCost: 50, failureCount: 2 },
  ];

  it("recovers an exact linear trend", () => {
    const r = forecastMaintenanceCost(history, 1);
    expect(r.trendFitted).toBe(true);
    expect(r.trendPerPeriod).toBeCloseTo(10, 12);
  });

  it("refuses to fit a trend to too little history", () => {
    const r = forecastMaintenanceCost(history.slice(0, 3), 1);
    expect(r.forecastable).toBe(true);
    expect(r.trendFitted).toBe(false);
    expect(r.trendPerPeriod).toBeNull();
    expect(r.reason).toMatch(/no direction is claimed/);
  });

  it("declines entirely below three periods", () => {
    const r = forecastMaintenanceCost(history.slice(0, 2), 1);
    expect(r.forecastable).toBe(false);
    expect(r.reason).toMatch(/confidence it has not earned/);
  });

  it("puts P90 above P50 and tells the user to budget the P90", () => {
    const r = forecastMaintenanceCost(history, 1);
    expect(r.unplannedP90!).toBeGreaterThan(r.unplannedP50!);
    expect(r.combinedP90!).toBeGreaterThan(r.combinedP50!);
    expect(r.reason).toMatch(/Budget the P90/);
  });

  it("flags unplanned cost with no failures behind it", () => {
    const r = forecastMaintenanceCost(
      history.map((h) => ({ ...h, failureCount: 0 })),
      1,
    );
    expect(r.reason).toMatch(/no failure explains/);
  });
});

describe("random primitives", () => {
  it("mulberry32 is deterministic and in range", () => {
    const a = mulberry32(1);
    const b = mulberry32(1);
    for (let i = 0; i < 50; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("Weibull sampling recovers its own mean", () => {
    // For beta=2, mean = eta * gamma(1.5) = eta * 0.8862.
    const rng = mulberry32(11);
    const n = 60_000;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += sampleWeibull(rng, 2, 1000);
    expect(sum / n).toBeGreaterThan(860);
    expect(sum / n).toBeLessThan(915);
  });

  it("percentile interpolates rather than picking a neighbour", () => {
    expect(percentile([0, 10], 0.5)).toBe(5);
    expect(percentile([0, 10, 20, 30], 0.5)).toBe(15);
  });
});

describe("RBD counting when one asset supplies two dependents", () => {
  // The dependency graph legitimately produces two blocks for one machine: it
  // supplies two different dependents. Both the missing-figure list and the
  // importance ranking must speak in distinct assets, or the panel reports one
  // physical problem as two and implies a healthy block that does not exist.
  const shared: RbdBlock[] = [
    { id: "HX-08", label: "HX-08", reliability: null, group: "g1" },
    { id: "HX-08", label: "HX-08", reliability: null, group: "g2" },
    { id: "P-101", label: "P-101", reliability: null, group: "g1" },
  ];
  const specs: RbdGroupSpec[] = [
    { group: "g1", minRequired: 1 },
    { group: "g2", minRequired: 1 },
  ];

  it("lists a shared asset once, not once per block", () => {
    const r = evaluateRbd(shared, specs);
    expect(r.blocksMissingReliability).toEqual(["HX-08", "P-101"]);
  });

  it("does not imply a healthy block by mixing unique and block counts", () => {
    const r = evaluateRbd(shared, specs);
    // "2 of 3 blocks" would be wrong twice over: there are 2 distinct assets,
    // and NONE of them has a figure.
    expect(r.reason).toMatch(
      /2 of 2 distinct asset\(s\) have no reliability figure/,
    );
  });

  it("ranks each physical asset once", () => {
    const healthy: RbdBlock[] = shared.map((b) => ({ ...b, reliability: 0.9 }));
    const imp = blockImportance(healthy, specs);
    expect(imp.map((i) => i.blockId).sort()).toEqual(["HX-08", "P-101"]);
  });
});
