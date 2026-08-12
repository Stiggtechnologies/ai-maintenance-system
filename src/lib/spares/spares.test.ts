/**
 * Validation for spares optimisation.
 *
 * Poisson has exact closed forms, so most of these are pinned against hand
 * arithmetic rather than against whatever the code happened to emit. The
 * remainder cover the refusals and the properties any correct answer must
 * have — service rising with stock, shortage falling, the optimum moving the
 * right way when a stockout gets more expensive.
 */
import { describe, expect, it } from "vitest";
import {
  poissonPmf,
  poissonCdf,
  expectedShortage,
  optimiseSpares,
} from "./index";

describe("Poisson primitives, against exact values", () => {
  it("matches hand-computed PMF values", () => {
    // P(0; 1) = e^-1
    expect(poissonPmf(0, 1)).toBeCloseTo(Math.exp(-1), 12);
    // P(1; 1) = e^-1
    expect(poissonPmf(1, 1)).toBeCloseTo(Math.exp(-1), 12);
    // P(2; 3) = 9/2 · e^-3
    expect(poissonPmf(2, 3)).toBeCloseTo(4.5 * Math.exp(-3), 12);
    // P(3; 2) = 8/6 · e^-2
    expect(poissonPmf(3, 2)).toBeCloseTo((8 / 6) * Math.exp(-2), 12);
  });

  it("sums to one over its support", () => {
    for (const lambda of [0.2, 1, 5, 25]) {
      let s = 0;
      for (let k = 0; k <= 200; k++) s += poissonPmf(k, lambda);
      expect(s).toBeCloseTo(1, 10);
    }
  });

  it("stays accurate at a large mean, where a factorial would overflow", () => {
    // 170! is near the double limit; computing in log space must survive.
    expect(Number.isFinite(poissonPmf(180, 175))).toBe(true);
    expect(poissonPmf(180, 175)).toBeGreaterThan(0);
    expect(poissonCdf(400, 175)).toBeCloseTo(1, 6);
  });

  it("gives the exact CDF for small cases", () => {
    // P(X<=1; 2) = e^-2(1 + 2) = 3e^-2
    expect(poissonCdf(1, 2)).toBeCloseTo(3 * Math.exp(-2), 12);
    expect(poissonCdf(0, 0.5)).toBeCloseTo(Math.exp(-0.5), 12);
  });

  it("treats zero demand as certain zero consumption", () => {
    expect(poissonCdf(0, 0)).toBe(1);
  });
});

describe("expected shortage", () => {
  it("equals the mean when holding nothing", () => {
    // E[max(D-0,0)] = E[D] = lambda
    for (const lambda of [0.3, 2, 7]) {
      expect(expectedShortage(0, lambda)).toBeCloseTo(lambda, 6);
    }
  });

  it("falls monotonically as stock rises, toward zero", () => {
    const vals = [0, 1, 2, 3, 4, 5].map((s) => expectedShortage(s, 2));
    expect(vals).toEqual([...vals].sort((a, b) => b - a));
    expect(expectedShortage(30, 2)).toBeCloseTo(0, 8);
  });
});

describe("sizing a slow-moving critical spare", () => {
  // The template seal kit: 45-day lead, roughly one a year across the fleet.
  const seal = { annualDemand: 1, leadTimeDays: 45 };

  it("computes demand over the lead time, not over a year", () => {
    const r = optimiseSpares(seal);
    expect(r.demandDuringLeadTime).toBeCloseTo(45 / 365, 3);
  });

  it("reaches the target service and says what the residual means", () => {
    const r = optimiseSpares(seal, 0.95);
    expect(r.levelForTargetService).toBe(1);
    expect(r.reason).toMatch(/not never/);
    expect(r.reason).toMatch(/one stockout every/);
  });

  it("needs more stock for a long lead time than a short one", () => {
    const slow = optimiseSpares({ annualDemand: 6, leadTimeDays: 120 }, 0.95);
    const fast = optimiseSpares({ annualDemand: 6, leadTimeDays: 7 }, 0.95);
    expect(slow.levelForTargetService as number).toBeGreaterThan(
      fast.levelForTargetService as number,
    );
  });

  it("service rises with every extra unit held", () => {
    const r = optimiseSpares({ annualDemand: 12, leadTimeDays: 60 });
    const svc = r.ladder.map((l) => l.serviceLevel);
    expect(svc).toEqual([...svc].sort((a, b) => a - b));
  });
});

describe("the cost arm", () => {
  const base = {
    annualDemand: 6,
    leadTimeDays: 60,
    unitCost: 4_000,
    holdingRate: 0.25,
    stockoutCost: 40_000,
  };

  it("picks a level and reports its annual cost", () => {
    const r = optimiseSpares(base);
    expect(r.optimalLevel).not.toBeNull();
    expect(r.optimalAnnualCost).toBeGreaterThan(0);
    expect(r.missingInputs).toEqual([]);
  });

  it("holds more when a stockout gets more expensive", () => {
    const cheap = optimiseSpares({ ...base, stockoutCost: 2_000 });
    const dear = optimiseSpares({ ...base, stockoutCost: 500_000 });
    expect(dear.optimalLevel as number).toBeGreaterThan(
      cheap.optimalLevel as number,
    );
  });

  it("holds less when the part is expensive to keep", () => {
    const cheapToHold = optimiseSpares({ ...base, unitCost: 500 });
    const dearToHold = optimiseSpares({ ...base, unitCost: 250_000 });
    expect(dearToHold.optimalLevel as number).toBeLessThanOrEqual(
      cheapToHold.optimalLevel as number,
    );
  });

  it("is a true minimum of holding plus shortage cost", () => {
    const r = optimiseSpares(base);
    const s = r.optimalLevel as number;
    const cost = (lvl: number) =>
      lvl * base.unitCost * base.holdingRate +
      expectedShortage(lvl, (base.annualDemand * base.leadTimeDays) / 365) *
        base.stockoutCost *
        (365 / base.leadTimeDays);
    if (s > 0) expect(cost(s - 1)).toBeGreaterThanOrEqual(cost(s));
    expect(cost(s + 1)).toBeGreaterThanOrEqual(cost(s));
  });
});

describe("the refusals", () => {
  it("refuses without a demand rate", () => {
    const r = optimiseSpares({ annualDemand: 0, leadTimeDays: 45 });
    expect(r.levelForTargetService).toBeNull();
    expect(r.missingInputs).toContain("an annual demand or failure rate");
    expect(r.reason).toMatch(/guess wearing a number/i);
  });

  it("refuses without a lead time", () => {
    const r = optimiseSpares({ annualDemand: 4, leadTimeDays: 0 });
    expect(r.levelForTargetService).toBeNull();
    expect(r.missingInputs).toContain("a replenishment lead time");
  });

  it("still gives the service ladder when only the costs are missing", () => {
    const r = optimiseSpares({ annualDemand: 6, leadTimeDays: 60 });
    expect(r.levelForTargetService).not.toBeNull();
    expect(r.optimalLevel).toBeNull();
    expect(r.reason).toMatch(/service ladder above needs none of them/i);
  });

  it("says so when demand is too high for stock to be the answer", () => {
    const r = optimiseSpares(
      { annualDemand: 5_000, leadTimeDays: 200 },
      0.95,
      5,
    );
    expect(r.levelForTargetService).toBeNull();
    expect(r.reason).toMatch(
      /too high for a spares holding to be the right answer/i,
    );
  });
});
