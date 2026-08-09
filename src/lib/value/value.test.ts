/**
 * Validation for value-management arithmetic.
 *
 * Discounting has exact closed forms, so every figure below is hand-computed.
 * The case that matters most is the different-lives comparison: a 20-year
 * option beats a 10-year one on raw NPV simply by lasting longer, and the test
 * pins a fixture where NPV and equivalent annual cost pick different winners.
 */
import { describe, expect, it } from "vitest";
import {
  npv,
  capitalRecoveryFactor,
  equivalentAnnual,
  compareOptions,
  prioritiseUnderBudget,
  findBreakEven,
  costOfRisk,
} from "./index";

describe("npv", () => {
  it("leaves period 0 undiscounted", () => {
    expect(npv([{ period: 0, amount: -1000 }], 0.1)).toBe(-1000);
  });

  it("matches hand-computed discounting", () => {
    // 100/1.1 + 100/1.21 + 100/1.331
    //  = 90.909091 + 82.644628 + 75.131480 = 248.685199
    const cf = [1, 2, 3].map((period) => ({ period, amount: 100 }));
    expect(npv(cf, 0.1)).toBeCloseTo(248.685199, 6);
  });

  it("is the plain sum at a zero discount rate", () => {
    const cf = [0, 1, 2].map((period) => ({ period, amount: 50 }));
    expect(npv(cf, 0)).toBe(150);
  });

  it("treats costs as negative and nets them off", () => {
    const r = npv(
      [
        { period: 0, amount: -1000 },
        { period: 1, amount: 600 },
        { period: 2, amount: 600 },
      ],
      0.1,
    );
    // -1000 + 545.4545 + 495.8678 = 41.3223
    expect(r).toBeCloseTo(41.322314, 6);
  });
});

describe("capitalRecoveryFactor", () => {
  it("matches the closed form", () => {
    // 0.1 x 1.1^10 / (1.1^10 - 1) = 0.1 x 2.5937425 / 1.5937425
    expect(capitalRecoveryFactor(0.1, 10)).toBeCloseTo(0.1627454, 7);
  });

  it("is 1/n at a zero rate", () => {
    expect(capitalRecoveryFactor(0, 20)).toBeCloseTo(0.05, 12);
  });

  it("round-trips: annualising a present value and discounting it back", () => {
    const pv = 1000;
    const annual = equivalentAnnual(pv, 10, 0.1);
    const back = npv(
      Array.from({ length: 10 }, (_, i) => ({
        period: i + 1,
        amount: annual,
      })),
      0.1,
    );
    expect(back).toBeCloseTo(pv, 8);
  });
});

describe("compareOptions — the error it exists to prevent", () => {
  it("uses NPV when every option shares a life", () => {
    const r = compareOptions(
      [
        {
          label: "A",
          lifePeriods: 10,
          cashFlows: [{ period: 1, amount: 100 }],
        },
        {
          label: "B",
          lifePeriods: 10,
          cashFlows: [{ period: 1, amount: 200 }],
        },
      ],
      0.1,
    );
    expect(r.basis).toBe("npv");
    expect(r.best).toBe("B");
    expect(r.reason).toMatch(/NPV is a fair comparison/);
  });

  it("REFUSES to rank on NPV when lives differ, and switches to EAC", () => {
    // Short: 500/yr for 5 years.  NPV = 500 x 3.790787 = 1895.39,
    //        EAC = 1895.39 x CRF(0.1,5) = 1895.39 x 0.2637975 = 500.
    // Long:  300/yr for 20 years. NPV = 300 x 8.513564 = 2554.07,
    //        EAC = 2554.07 x CRF(0.1,20) = 2554.07 x 0.1174596 = 300.
    // Raw NPV says Long wins. Per year, Short is worth far more.
    const short = {
      label: "Short",
      lifePeriods: 5,
      cashFlows: Array.from({ length: 5 }, (_, i) => ({
        period: i + 1,
        amount: 500,
      })),
    };
    const long = {
      label: "Long",
      lifePeriods: 20,
      cashFlows: Array.from({ length: 20 }, (_, i) => ({
        period: i + 1,
        amount: 300,
      })),
    };
    const r = compareOptions([short, long], 0.1);

    expect(r.basis).toBe("equivalent_annual");
    const s = r.ranked.find((x) => x.label === "Short");
    const l = r.ranked.find((x) => x.label === "Long");
    expect(s?.npv).toBeCloseTo(1895.393, 3);
    expect(l?.npv).toBeCloseTo(2554.069, 3);
    expect(s?.equivalentAnnual).toBeCloseTo(500, 6);
    expect(l?.equivalentAnnual).toBeCloseTo(300, 6);

    // Raw NPV would have chosen Long; the correct basis chooses Short.
    expect(r.best).toBe("Short");
    expect(r.npvWouldMislead).toBe(true);
    expect(r.reason).toMatch(/simply by lasting longer/);
    expect(r.reason).toMatch(/the error this comparison exists to prevent/);
  });

  it("calls agreement between the two bases luck, not vindication", () => {
    const r = compareOptions(
      [
        {
          label: "A",
          lifePeriods: 5,
          cashFlows: [{ period: 1, amount: 1000 }],
        },
        { label: "B", lifePeriods: 10, cashFlows: [{ period: 1, amount: 10 }] },
      ],
      0.1,
    );
    expect(r.npvWouldMislead).toBe(false);
    expect(r.reason).toMatch(
      /luck rather than a reason to trust NPV next time/,
    );
  });
});

describe("prioritiseUnderBudget", () => {
  const CANDIDATES = [
    { label: "Big", cost: 100, benefit: 130 },
    { label: "Small-1", cost: 50, benefit: 90 },
    { label: "Small-2", cost: 50, benefit: 85 },
  ];

  it("beats ranking by raw benefit and quantifies the difference", () => {
    // Budget 100. By benefit: Big (130). By ratio: Small-1 + Small-2 = 175.
    const r = prioritiseUnderBudget(CANDIDATES, 100);
    expect(r.selected.sort()).toEqual(["Small-1", "Small-2"]);
    expect(r.totalBenefit).toBe(175);
    expect(r.benefitLostToNaiveRanking).toBe(45);
    expect(r.reason).toMatch(/45 less from the same budget/);
    expect(r.reason).toMatch(/a capital list ordered by size costs/);
  });

  it("says so when both orderings agree", () => {
    const r = prioritiseUnderBudget(
      [
        { label: "A", cost: 50, benefit: 100 },
        { label: "B", cost: 50, benefit: 90 },
      ],
      100,
    );
    expect(r.benefitLostToNaiveRanking).toBe(0);
    expect(r.reason).toMatch(/would have produced the same result/);
  });

  it("REFUSES to prioritise without a budget constraint", () => {
    const r = prioritiseUnderBudget(CANDIDATES, 0);
    expect(r.selected).toEqual([]);
    expect(r.reason).toMatch(
      /no prioritisation problem to solve — only a list/,
    );
    expect(r.reason).toMatch(/what a constraint forces/);
  });
});

describe("findBreakEven", () => {
  it("finds the value at which the decision reverses", () => {
    // Outcome = 1000 - 100x. Crosses zero at x = 10.
    const r = findBreakEven("unit cost", 6, (x) => 1000 - 100 * x, 0, 50);
    expect(r.breakEven).toBeCloseTo(10, 8);
    expect(r.headroomPct).toBeCloseTo(4 / 6, 6);
    expect(r.reason).toMatch(/reverses when unit cost reaches 10/);
  });

  it("warns when the answer rests on the assumption being right", () => {
    // Base 9.5, break-even 10: only 5% of headroom.
    const r = findBreakEven("unit cost", 9.5, (x) => 1000 - 100 * x, 0, 50);
    expect(r.reason).toMatch(/rests on this number being right/);
  });

  it("reassures when the assumption is not what the decision turns on", () => {
    const r = findBreakEven("unit cost", 1, (x) => 1000 - 100 * x, 0, 50);
    expect(r.reason).toMatch(/not what the decision turns on/);
  });

  it("says the answer is robust when no reversal exists in range", () => {
    const r = findBreakEven("discount rate", 0.1, () => 500, 0, 0.3);
    expect(r.breakEven).toBeNull();
    expect(r.reason).toMatch(/does not reverse anywhere/);
    expect(r.reason).toMatch(/not the argument to have/);
  });
});

describe("costOfRisk", () => {
  it("computes the expectation and the return period", () => {
    const r = costOfRisk(0.02, 5_000_000);
    expect(r.expectedAnnualCost).toBeCloseTo(100_000, 6);
    expect(r.reason).toMatch(/one event every 50 years/);
  });

  it("always states that expected value is not risk", () => {
    const r = costOfRisk(0.5, 1000);
    expect(r.reason).toMatch(/Expected value is not risk/);
  });

  it("adds the tail warning for a low-probability, high-consequence case", () => {
    const r = costOfRisk(0.001, 50_000_000);
    expect(r.reason).toMatch(
      /experiences the event or it does not — never the average/,
    );
  });

  it("rejects an impossible probability", () => {
    expect(costOfRisk(1.4, 100).reason).toMatch(/between 0 and 1/);
  });
});
