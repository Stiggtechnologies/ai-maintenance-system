/**
 * The customer lifecycle comparison must delegate to the BOK-07 kernel and
 * refuse every input the kernel is not allowed to invent.
 */
import { describe, expect, it } from "vitest";
import { capitalRecoveryFactor, presentValue } from "./discounted-lcc";
import {
  buildDiscountedLifecycleComparison,
  type DiscountedLifecycleRequest,
} from "./discounted-evaluation";
import type { AssetEconomics, DeferralRisk } from "./index";

const policy = {
  rate: 0.07,
  owner: "Treasury committee",
  basis: "Treasury policy TP-12 real WACC 2026",
};

const fit = { failures: 12, converged: true };

function economics(overrides: Partial<AssetEconomics> = {}): AssetEconomics {
  return {
    replacementValueUsd: null,
    annualMaintenanceCostUsd: null,
    downtimeCostPerHourUsd: null,
    expectedRepairCostUsd: null,
    expectedRepairHours: null,
    expectedRemainingLifeYears: null,
    ...overrides,
  };
}

function risk(overrides: Partial<DeferralRisk> = {}): DeferralRisk {
  return {
    probability: 0.1,
    windowDays: 3650,
    expectedCostUsd: null,
    missingInputs: ["downtime cost per hour"],
    ...overrides,
  };
}

function request(
  overrides: Partial<DiscountedLifecycleRequest> = {},
): DiscountedLifecycleRequest {
  return {
    economics: economics(),
    risk: risk(),
    redesignCostUsd: null,
    redesignMaintenanceReductionPct: null,
    policy,
    fit,
    ...overrides,
  };
}

describe("buildDiscountedLifecycleComparison", () => {
  it("matches a hand-computed present value and prefers the late cost once discounted", () => {
    const result = buildDiscountedLifecycleComparison(
      request({
        economics: economics({
          replacementValueUsd: 1000,
          expectedRemainingLifeYears: 10,
        }),
        risk: risk({
          windowDays: 3650,
          expectedCostUsd: 1050,
          missingInputs: [],
        }),
      }),
    );

    const npvDefer = presentValue([{ year: 10, amount: 1050 }], 0.07);
    const crf = capitalRecoveryFactor(0.07, 10);
    const defer = result.options.find((option) => option.option === "defer");
    const replace = result.options.find(
      (option) => option.option === "replace",
    );

    expect(npvDefer).toBeCloseTo(1050 / Math.pow(1.07, 10), 8);
    expect(defer?.npv).toBeCloseTo(npvDefer, 8);
    expect(defer?.annualCostUsd).toBeCloseTo(npvDefer * crf, 8);
    expect(replace?.npv).toBeCloseTo(1000, 8);
    expect(replace?.annualCostUsd).toBeCloseTo(1000 * crf, 8);
    expect(result.recommended).toBe("defer");
    expect(result.comparison?.undiscountedWouldMislead).toBe(true);
    expect(result.comparison?.sensitivity).toEqual([]);
    expect(result.comparison?.rankingSensitiveToRate).toBe(false);
    expect(result.refusal).toBeNull();
  });

  it("keeps an end-of-year annuity's equivalent annual cost equal to the annual amount", () => {
    const result = buildDiscountedLifecycleComparison(
      request({
        economics: economics({
          annualMaintenanceCostUsd: 100,
          replacementValueUsd: 150,
          expectedRemainingLifeYears: 2,
        }),
        risk: risk(),
        policy: { ...policy, rate: 0.1 },
      }),
    );
    const repair = result.options.find((option) => option.option === "repair");
    expect(repair?.annualCostUsd).toBeCloseTo(100, 8);
    expect(result.recommended).toBe("replace");
  });

  it("names redesign as unpriced and does not clamp an out-of-range reduction", () => {
    const result = buildDiscountedLifecycleComparison(
      request({
        economics: economics({
          annualMaintenanceCostUsd: 100,
          replacementValueUsd: 150,
          expectedRemainingLifeYears: 2,
        }),
        redesignCostUsd: 40,
        redesignMaintenanceReductionPct: 140,
        risk: risk(),
      }),
    );
    const redesign = result.options.find(
      (option) => option.option === "redesign",
    );
    expect(redesign?.annualCostUsd).toBeNull();
    expect(redesign?.missingInputs.join(" ")).toMatch(/0 to 100 percent/);
    expect(
      result.comparison?.options.map((option) => option.name),
    ).not.toContain("redesign");
  });

  it("refuses to rank when the finance-owned rate is absent", () => {
    const result = buildDiscountedLifecycleComparison(
      request({
        policy: null,
        economics: economics({
          annualMaintenanceCostUsd: 100,
          replacementValueUsd: 150,
          expectedRemainingLifeYears: 2,
        }),
      }),
    );
    expect(result.recommended).toBeNull();
    expect(result.comparison).toBeNull();
    expect(result.refusal).toMatch(/not assumed/);
    expect(result.options.every((option) => option.annualCostUsd == null)).toBe(
      true,
    );
  });

  it("refuses a single priced option and a negative consequence", () => {
    const single = buildDiscountedLifecycleComparison(
      request({
        economics: economics({
          replacementValueUsd: 150,
          expectedRemainingLifeYears: 2,
        }),
      }),
    );
    expect(single.recommended).toBeNull();
    expect(single.refusal).toMatch(/Fewer than two options/);

    const negative = buildDiscountedLifecycleComparison(
      request({
        economics: economics({
          replacementValueUsd: 150,
          expectedRemainingLifeYears: 2,
        }),
        risk: risk({ expectedCostUsd: -10, missingInputs: [] }),
      }),
    );
    const defer = negative.options.find((option) => option.option === "defer");
    expect(defer?.annualCostUsd).toBeNull();
    expect(defer?.missingInputs.join(" ")).toMatch(/negative cost is refused/);
  });
});
