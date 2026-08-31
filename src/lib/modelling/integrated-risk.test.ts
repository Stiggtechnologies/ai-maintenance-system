/**
 * Sync Develop Slice 4C — the integrated risk-cost-schedule kernel.
 *
 * Two things are under test and they are the two the slice must not get
 * wrong:
 *
 *   1. EVERY REFUSAL. A distribution that should not exist must not exist.
 *      One test per way of manufacturing one — a failing quality gate, a
 *      schedule where nothing varies, a risk whose "range" is a point, a
 *      cyclic network, a missing seed.
 *
 *   2. DETERMINISM. Same inputs, same seed, same answer — asserted on the
 *      percentiles AND on the per-risk attribution, because an attribution
 *      that moved between runs would rank drivers by sampling noise. A
 *      different seed must give a DIFFERENT answer, or the "seed" is
 *      decorative and reproducibility means nothing.
 */
import { describe, expect, it } from "vitest";
import {
  INTEGRATED_RISK_KERNEL_VERSION,
  simulateIntegratedRisk,
  type IntegratedRiskInput,
  type RiskImpact,
  type ScheduleQualityGate,
} from "./integrated-risk";
import type { ScheduleTask } from "./schedule-risk";

const PASSING_GATE: ScheduleQualityGate = {
  permitted: true,
  failingClasses: [],
  notDiagnosableClasses: [],
  minimumScore: 60,
  refusal: null,
};

const FAILING_GATE: ScheduleQualityGate = {
  permitted: false,
  failingClasses: ["missing_logic", "negative_float"],
  notDiagnosableClasses: ["unrealistic_lags"],
  minimumScore: 60,
  refusal:
    "A Monte Carlo will not run on this schedule. 2 defect class(es) are over their published threshold: missing_logic, negative_float.",
};

/** A small, honest network: a chain plus a parallel branch. */
function chain(): ScheduleTask[] {
  return [
    {
      id: "A",
      label: "Mobilise",
      duration: 100,
      optimistic: 80,
      pessimistic: 160,
      predecessors: [],
    },
    {
      id: "B",
      label: "Fabricate",
      duration: 200,
      optimistic: 160,
      pessimistic: 320,
      predecessors: ["A"],
    },
    {
      id: "C",
      label: "Install",
      duration: 150,
      optimistic: 120,
      pessimistic: 240,
      predecessors: ["B"],
    },
    {
      id: "D",
      label: "Cable pull",
      duration: 90,
      optimistic: 70,
      pessimistic: 140,
      predecessors: ["A"],
    },
    {
      id: "E",
      label: "Commission",
      duration: 60,
      optimistic: 50,
      pessimistic: 110,
      predecessors: ["C", "D"],
    },
  ];
}

/** Every activity fixed: the case where a spread would have to be invented. */
function fixedChain(): ScheduleTask[] {
  return chain().map((t) => ({ ...t, optimistic: null, pessimistic: null }));
}

const compressor: RiskImpact = {
  riskId: "11111111-1111-1111-1111-111111111111",
  riskTitle: "Compressor delivery slips",
  activityId: "B",
  probability: 0.4,
  delayDaysOptimistic: 5,
  delayDaysLikely: 12,
  delayDaysPessimistic: 30,
  costOptimistic: 100_000,
  costLikely: 400_000,
  costPessimistic: 1_200_000,
};

const permit: RiskImpact = {
  riskId: "22222222-2222-2222-2222-222222222222",
  riskTitle: "Environmental permit late",
  activityId: "A",
  probability: 0.25,
  delayDaysOptimistic: 2,
  delayDaysLikely: 6,
  delayDaysPessimistic: 20,
  costOptimistic: null,
  costLikely: null,
  costPessimistic: null,
};

function input(over: Partial<IntegratedRiskInput> = {}): IntegratedRiskInput {
  return {
    activities: chain(),
    risks: [compressor, permit],
    gate: PASSING_GATE,
    iterations: 1200,
    seed: 20261202,
    delayCostPerDay: 45_000,
    costBase: 340_000_000,
    currency: "USD",
    ...over,
  };
}

/* ───────────────────────────── the refusals ──────────────────────────── */

describe("a distribution that should not exist does not exist", () => {
  it("REFUSES when the schedule failed its quality gate, and names the classes", () => {
    const r = simulateIntegratedRisk(input({ gate: FAILING_GATE }));
    expect(r.simulated).toBe(false);
    expect(r.p50Hours).toBeNull();
    expect(r.p80Hours).toBeNull();
    expect(r.sampleCount).toBe(0);
    expect(r.reason).toContain("defect class");
    // The failing classes are NAMED, not counted.
    expect(r.refusals.join(" ")).toContain("missing_logic");
    expect(r.refusals.join(" ")).toContain("negative_float");
    // And there is no "run anyway with a caveat" arm.
    expect(r.refusals.join(" ")).toContain(
      "refused rather than run with a caveat",
    );
  });

  it("REFUSES when nothing varies — no ranges and no risks", () => {
    const r = simulateIntegratedRisk(
      input({ activities: fixedChain(), risks: [] }),
    );
    expect(r.simulated).toBe(false);
    expect(r.p80Hours).toBeNull();
    expect(r.reason).toContain("confidence interval of zero width");
  });

  it("STILL SIMULATES fixed activities when a real risk supplies the variation", () => {
    // The variation has to come from somewhere real. A risk with a genuine
    // three-point delay is somewhere real; a default variance is not.
    const r = simulateIntegratedRisk(
      input({ activities: fixedChain(), risks: [compressor] }),
    );
    expect(r.simulated).toBe(true);
    expect(r.p80Hours!).toBeGreaterThan(r.p10Hours!);
    // Every activity held fixed is REPORTED, never silently given a spread.
    expect(r.activitiesWithoutRanges).toHaveLength(5);
    expect(r.refusals.join(" ")).toContain("held FIXED");
  });

  it("drops a risk whose three-point delay is a single point, and says so", () => {
    const pointRisk: RiskImpact = {
      ...permit,
      delayDaysOptimistic: 7,
      delayDaysLikely: 7,
      delayDaysPessimistic: 7,
    };
    const r = simulateIntegratedRisk(input({ risks: [compressor, pointRisk] }));
    expect(r.simulated).toBe(true);
    expect(r.attribution.map((a) => a.riskId)).not.toContain(pointRisk.riskId);
    expect(r.refusals.join(" ")).toContain("a distribution nobody estimated");
  });

  it("drops a risk whose probability is out of (0,1]", () => {
    for (const p of [0, 1.4, Number.NaN]) {
      const r = simulateIntegratedRisk(
        input({ risks: [{ ...permit, probability: p }] }),
      );
      expect(r.attribution).toHaveLength(0);
    }
  });

  it("REFUSES a cyclic network — the kernel's own CPM refusal, carried", () => {
    const cyclic = chain();
    cyclic[0].predecessors = ["E"];
    const r = simulateIntegratedRisk(input({ activities: cyclic }));
    expect(r.simulated).toBe(false);
    expect(r.reason).toContain("cycle");
  });

  it("REFUSES a seed that is not a reproducible 32-bit whole number", () => {
    for (const seed of [-1, 1.5, 4294967296, Number.NaN]) {
      const r = simulateIntegratedRisk(input({ seed }));
      expect(r.simulated, `seed ${seed} was accepted`).toBe(false);
      expect(r.reason).toContain("reproduce");
    }
  });

  it("REFUSES a non-positive iteration count", () => {
    for (const iterations of [0, -5, 2.5]) {
      const r = simulateIntegratedRisk(input({ iterations }));
      expect(r.simulated).toBe(false);
    }
  });

  it("never produces a cost total when there is no deterministic cost base", () => {
    const r = simulateIntegratedRisk(input({ costBase: null }));
    expect(r.simulated).toBe(true);
    // The EXPOSURE is real and is reported as exposure.
    expect(r.costExposureP80).not.toBeNull();
    expect(r.costBase).toBeNull();
    expect(r.refusals.join(" ")).toContain("a forecast missing the project");
  });

  it("reports no cost exposure at all when nothing costed was simulated", () => {
    const r = simulateIntegratedRisk(
      input({ risks: [permit], delayCostPerDay: null }),
    );
    expect(r.costExposureP50).toBeNull();
    expect(r.costExposureP80).toBeNull();
    expect(r.refusals.join(" ")).toContain("stops at the schedule");
  });
});

/* ─────────────────────────── the distribution ────────────────────────── */

describe("when it does run, it runs on real inputs", () => {
  const r = simulateIntegratedRisk(input());

  it("percentiles come off one sorted sample and cannot cross", () => {
    expect(r.simulated).toBe(true);
    expect(r.sampleCount).toBe(1200);
    expect(r.p10Hours!).toBeLessThanOrEqual(r.p50Hours!);
    expect(r.p50Hours!).toBeLessThanOrEqual(r.p80Hours!);
    expect(r.p80Hours!).toBeLessThanOrEqual(r.p90Hours!);
    expect(r.p90Hours!).toBeGreaterThan(r.p10Hours!);
  });

  it("the P80 sits at or beyond the deterministic duration", () => {
    // Risks only ever ADD time here, and the triangular mode is the plan, so
    // a P80 below the plan would mean the sampler was not sampling the plan.
    expect(r.p80Hours!).toBeGreaterThanOrEqual(r.deterministicHours);
  });

  it("records the kernel identity and the seed it ran under", () => {
    expect(r.kernelVersion).toBe(INTEGRATED_RISK_KERNEL_VERSION);
    expect(r.seed).toBe(20261202);
    expect(r.iterations).toBe(1200);
  });

  it("the criticality index is a fraction of the run, per activity", () => {
    expect(r.criticality).toHaveLength(5);
    for (const c of r.criticality) {
      expect(c.criticalityIndex).toBeGreaterThanOrEqual(0);
      expect(c.criticalityIndex).toBeLessThanOrEqual(1);
    }
  });

  it("an occurrence rate is close to the probability that produced it", () => {
    const row = r.attribution.find((a) => a.riskId === compressor.riskId)!;
    expect(Math.abs(row.occurrenceRate - 0.4)).toBeLessThan(0.05);
  });
});

/* ──────────────────────── attribution comes OUT ──────────────────────── */

describe("attribution is measured, not assumed (D5.09)", () => {
  it("ranks the risk on the critical chain above one with float", () => {
    // B is on the deterministic critical path (A→B→C→E). A is on it too, but
    // the compressor risk is both more likely and far larger, so it must come
    // out on top of a ranking that measures rather than sorts by title.
    const r = simulateIntegratedRisk(input());
    expect(r.attribution[0].riskId).toBe(compressor.riskId);
    expect(r.attribution[0].p80DaysContribution).toBeGreaterThan(0);
  });

  it("a risk on a non-critical activity with plenty of float contributes ~nothing", () => {
    const trivial: RiskImpact = {
      riskId: "33333333-3333-3333-3333-333333333333",
      riskTitle: "Minor cable-pull hold",
      // D has ~260 hours of float against the B→C chain; a 1-2 day risk
      // cannot reach the finish date through it.
      activityId: "D",
      probability: 0.3,
      delayDaysOptimistic: 1,
      delayDaysLikely: 1.5,
      delayDaysPessimistic: 2,
      costOptimistic: null,
      costLikely: null,
      costPessimistic: null,
    };
    const r = simulateIntegratedRisk(input({ risks: [compressor, trivial] }));
    const row = r.attribution.find((a) => a.riskId === trivial.riskId)!;
    expect(Math.abs(row.p80DaysContribution)).toBeLessThan(1);
    expect(row.reason).toContain("float");
  });

  it("states the I.10 sentence in days AND money when both exist", () => {
    const r = simulateIntegratedRisk(input());
    const row = r.attribution.find((a) => a.riskId === compressor.riskId)!;
    expect(row.meanCostContribution).not.toBeNull();
    expect(row.reason).toContain("P80 schedule exposure");
  });

  it("leaves the money half NULL rather than zero when nothing prices it", () => {
    const r = simulateIntegratedRisk(
      input({ risks: [permit], delayCostPerDay: null }),
    );
    const row = r.attribution.find((a) => a.riskId === permit.riskId)!;
    expect(row.meanCostContribution).toBeNull();
    expect(row.p80CostContribution).toBeNull();
  });
});

/* ───────────────────────────── determinism ───────────────────────────── */

describe("a result nobody can reproduce is not evidence", () => {
  it("the same inputs and seed produce byte-identical percentiles", () => {
    const a = simulateIntegratedRisk(input());
    const b = simulateIntegratedRisk(input());
    expect(b.p10Hours).toBe(a.p10Hours);
    expect(b.p50Hours).toBe(a.p50Hours);
    expect(b.p80Hours).toBe(a.p80Hours);
    expect(b.p90Hours).toBe(a.p90Hours);
    expect(b.costExposureP50).toBe(a.costExposureP50);
    expect(b.costExposureP80).toBe(a.costExposureP80);
    expect(b.probabilityOnPlan).toBe(a.probabilityOnPlan);
  });

  it("the ATTRIBUTION is reproducible too, or drivers are ranked by noise", () => {
    const a = simulateIntegratedRisk(input());
    const b = simulateIntegratedRisk(input());
    expect(b.attribution.map((x) => x.riskId)).toEqual(
      a.attribution.map((x) => x.riskId),
    );
    expect(b.attribution.map((x) => x.p80HoursContribution)).toEqual(
      a.attribution.map((x) => x.p80HoursContribution),
    );
    expect(b.attribution.map((x) => x.occurrenceRate)).toEqual(
      a.attribution.map((x) => x.occurrenceRate),
    );
  });

  it("a DIFFERENT seed gives a different answer — the seed is not decorative", () => {
    const a = simulateIntegratedRisk(input());
    const b = simulateIntegratedRisk(input({ seed: 987654321 }));
    expect(b.p80Hours).not.toBe(a.p80Hours);
  });

  it("the same seed at a different iteration count is a DIFFERENT run", () => {
    // Reproducibility is (inputs, seed, iterations) — recording the seed and
    // not the iteration count would make a recorded run unrepeatable.
    const a = simulateIntegratedRisk(input());
    const b = simulateIntegratedRisk(input({ iterations: 2400 }));
    expect(b.sampleCount).toBe(2400);
    expect(b.p80Hours).not.toBe(a.p80Hours);
  });

  it("suppressing a risk is the ONLY difference in a marginal pass", () => {
    // The marginal pass re-seeds from the same seed, so a risk that never
    // occurs must leave the percentiles exactly where they were.
    const never: RiskImpact = { ...permit, probability: 1e-12 };
    const withIt = simulateIntegratedRisk(input({ risks: [never] }));
    const withoutIt = simulateIntegratedRisk(input({ risks: [] }));
    expect(withIt.attribution[0].occurrenceRate).toBe(0);
    expect(withIt.p80Hours).toBe(withoutIt.p80Hours);
  });
});

/* ─────────── the repair: logic the kernel cannot read, and the cap ─────── */

describe("a network this kernel cannot read is refused, never approximated", () => {
  const unsupported = {
    supported: false,
    nonFinishToStartCount: 1,
    laggedCount: 1,
    unstatedLinkTypeCount: 0,
    refusal:
      "This case's logic carries 1 relationship(s) with a link type other than finish-to-start and 1 with a non-zero lag.",
    assumptionNote: null,
  };

  it("refuses a schedule using non-FS links or lags, before sampling anything", () => {
    // `criticalPath` reads every edge as finish-to-start with zero lag, while
    // the server's input digest hashes the link type and the lag. Before this,
    // changing one relationship from FS/0h to SS/120h left the percentiles
    // BYTE-IDENTICAL under a different digest — a distribution over a network
    // that was not the recorded one, indistinguishable from a correct one.
    const r = simulateIntegratedRisk(input({ logicSupport: unsupported }));
    expect(r.simulated).toBe(false);
    expect(r.p50Hours).toBeNull();
    expect(r.p80Hours).toBeNull();
    expect(r.reason).toContain("finish-to-start");
    expect(r.refusals.join(" ")).toContain("finish-to-start");
  });

  it("runs when the logic IS finish-to-start, and says so about unstated types", () => {
    const r = simulateIntegratedRisk(
      input({
        logicSupport: {
          supported: true,
          nonFinishToStartCount: 0,
          laggedCount: 0,
          unstatedLinkTypeCount: 3,
          refusal: null,
          assumptionNote:
            "3 of this case's 5 relationship(s) state NO link type.",
        },
      }),
    );
    expect(r.simulated).toBe(true);
    expect(r.refusals.join(" ")).toContain("state NO link type");
  });

  it("a schedule with no logicSupport verdict still simulates (the field is optional)", () => {
    const r = simulateIntegratedRisk(input());
    expect(r.simulated).toBe(true);
  });
});

describe("the attributed-risk cap is applied BEFORE the browser pays for it", () => {
  it("refuses a register wider than the published cap instead of running it", () => {
    // The marginal attribution costs one full extra pass per risk. With the
    // cap enforced only at the door, 200 edges at 2000 iterations ran 202 full
    // simulations in the tab and only THEN had the result refused.
    const many: RiskImpact[] = Array.from({ length: 12 }, (_, i) => ({
      ...compressor,
      riskId: `0000000${i}-1111-1111-1111-111111111111`,
      riskTitle: `Risk ${i}`,
    }));
    const r = simulateIntegratedRisk(
      input({ risks: many, maximumAttributedRisks: 5 }),
    );
    expect(r.simulated).toBe(false);
    expect(r.attribution).toEqual([]);
    expect(r.reason).toContain("published maximum");
    expect(r.reason).toContain("full simulations in one browser tab");
  });

  it("runs at exactly the cap", () => {
    const many: RiskImpact[] = Array.from({ length: 5 }, (_, i) => ({
      ...compressor,
      riskId: `0000000${i}-1111-1111-1111-111111111111`,
      riskTitle: `Risk ${i}`,
    }));
    const r = simulateIntegratedRisk(
      input({ risks: many, maximumAttributedRisks: 5 }),
    );
    expect(r.simulated).toBe(true);
    expect(r.attribution.length).toBe(5);
  });
});
