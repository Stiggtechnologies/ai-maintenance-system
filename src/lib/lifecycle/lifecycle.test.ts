/**
 * Validation for the lifecycle decision mathematics.
 *
 * Held to the same standard as the reliability engine it sits on: hand-computed
 * identities rather than snapshots of whatever the code happened to produce,
 * and explicit coverage of every refusal path — because the refusals are the
 * part that keeps an unpriced option from being ranked as if it were free.
 */
import { describe, expect, it } from "vitest";
import {
  conditionalFailureProbability,
  deferralRisk,
  compareOptions,
  assessUncertainty,
  recommendOption,
  type AssetEconomics,
} from "./index";

const FULL: AssetEconomics = {
  replacementValueUsd: 1_200_000,
  annualMaintenanceCostUsd: 180_000,
  downtimeCostPerHourUsd: 9_000,
  expectedRepairCostUsd: 40_000,
  expectedRepairHours: 20,
  expectedRemainingLifeYears: 10,
};

describe("conditionalFailureProbability", () => {
  it("reduces to the plain CDF from age zero", () => {
    // R(t) = exp(-(t/eta)^beta); from age 0, P = 1 - exp(-(t/eta)^beta)
    const p = conditionalFailureProbability({ beta: 2, eta: 1000 }, 0, 1000);
    expect(p).toBeCloseTo(1 - Math.exp(-1), 12);
  });

  it("is memoryless when beta = 1, and only then", () => {
    const early = conditionalFailureProbability({ beta: 1, eta: 500 }, 0, 100);
    const late = conditionalFailureProbability(
      { beta: 1, eta: 500 },
      9000,
      100,
    );
    expect(late).toBeCloseTo(early, 12);

    const wearEarly = conditionalFailureProbability(
      { beta: 3, eta: 500 },
      0,
      100,
    );
    const wearLate = conditionalFailureProbability(
      { beta: 3, eta: 500 },
      900,
      100,
    );
    expect(wearLate).toBeGreaterThan(wearEarly * 100);
  });

  it("rises with age for wear-out and falls for infant mortality", () => {
    const wear = [0, 500, 1000, 2000].map((a) =>
      conditionalFailureProbability({ beta: 2.5, eta: 1500 }, a, 200),
    );
    expect(wear).toEqual([...wear].sort((x, y) => x - y));

    const infant = [0, 500, 1000, 2000].map((a) =>
      conditionalFailureProbability({ beta: 0.6, eta: 1500 }, a, 200),
    );
    expect(infant).toEqual([...infant].sort((x, y) => y - x));
  });

  it("stays in (0,1) and keeps precision at extreme hazard", () => {
    // A ratio-of-exponentials formulation returns NaN here; expm1 does not.
    const p = conditionalFailureProbability(
      { beta: 4, eta: 100 },
      50_000,
      5_000,
    );
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThanOrEqual(1);
    expect(Number.isFinite(p)).toBe(true);
  });

  it("refuses invalid parameters rather than returning a number", () => {
    expect(() =>
      conditionalFailureProbability({ beta: 0, eta: 100 }, 0, 10),
    ).toThrow();
    expect(() =>
      conditionalFailureProbability({ beta: 2, eta: 0 }, 0, 10),
    ).toThrow();
    expect(() =>
      conditionalFailureProbability({ beta: 2, eta: 100 }, 0, 0),
    ).toThrow();
    expect(() =>
      conditionalFailureProbability({ beta: 2, eta: 100 }, -1, 10),
    ).toThrow();
  });
});

describe("deferralRisk", () => {
  it("prices the risk as probability × downtime cost × repair hours", () => {
    const fit = { beta: 2, eta: 10_000 };
    const r = deferralRisk(fit, 5_000, 30, FULL);
    const p = conditionalFailureProbability(fit, 5_000, 720);
    expect(r.probability).toBeCloseTo(p, 12);
    expect(r.expectedCostUsd).toBeCloseTo(p * 9_000 * 20, 6);
    expect(r.missingInputs).toEqual([]);
  });

  it("returns no cost and names what is missing, rather than assuming zero", () => {
    const r = deferralRisk({ beta: 2, eta: 10_000 }, 5_000, 30, {
      downtimeCostPerHourUsd: null,
      expectedRepairHours: 20,
    });
    expect(r.probability).toBeGreaterThan(0);
    expect(r.expectedCostUsd).toBeNull();
    expect(r.missingInputs).toEqual(["downtime cost per hour"]);
  });
});

describe("compareOptions", () => {
  const fit = { beta: 2, eta: 10_000 };

  it("computes equivalent annual cost for each priced option", () => {
    const risk = deferralRisk(fit, 5_000, 30, FULL);
    const opts = compareOptions(FULL, risk, 300_000, 40);

    const repair = opts.find((o) => o.option === "repair");
    expect(repair?.annualCostUsd).toBe(180_000);

    const replace = opts.find((o) => o.option === "replace");
    expect(replace?.annualCostUsd).toBeCloseTo(1_200_000 / 10, 9);

    // 300k over 10 years + 180k reduced by 40%
    const redesign = opts.find((o) => o.option === "redesign");
    expect(redesign?.annualCostUsd).toBeCloseTo(30_000 + 108_000, 9);

    const defer = opts.find((o) => o.option === "defer");
    expect(defer?.annualCostUsd).toBeCloseTo(
      (risk.expectedCostUsd as number) * (365 / 30),
      6,
    );
  });

  it("leaves an option unpriced and names its gaps when inputs are absent", () => {
    const bare: AssetEconomics = {
      replacementValueUsd: null,
      annualMaintenanceCostUsd: 180_000,
      downtimeCostPerHourUsd: null,
      expectedRepairCostUsd: null,
      expectedRepairHours: null,
      expectedRemainingLifeYears: null,
    };
    const risk = deferralRisk(fit, 5_000, 30, bare);
    const opts = compareOptions(bare, risk, null, null);

    expect(opts.find((o) => o.option === "replace")?.annualCostUsd).toBeNull();
    expect(opts.find((o) => o.option === "replace")?.missingInputs).toContain(
      "replacement value",
    );
    expect(opts.find((o) => o.option === "defer")?.annualCostUsd).toBeNull();
    // The one option that IS priced stays priced.
    expect(opts.find((o) => o.option === "repair")?.annualCostUsd).toBe(
      180_000,
    );
  });
});

describe("uncertainty and recommendation", () => {
  const fit = { beta: 2, eta: 10_000 };

  it("declines to rank when fewer than two options can be priced", () => {
    const bare: AssetEconomics = {
      replacementValueUsd: null,
      annualMaintenanceCostUsd: 180_000,
      downtimeCostPerHourUsd: null,
      expectedRepairCostUsd: null,
      expectedRepairHours: null,
      expectedRemainingLifeYears: null,
    };
    const risk = deferralRisk(fit, 5_000, 30, bare);
    const opts = compareOptions(bare, risk, null, null);
    const v = recommendOption(
      opts,
      assessUncertainty({ failures: 20, converged: true }, opts),
    );
    expect(v.recommended).toBeNull();
    expect(v.rationale).toContain("Not enough options can be priced");
  });

  it("flags a near-tie rather than presenting it as a winner", () => {
    const econ: AssetEconomics = { ...FULL, annualMaintenanceCostUsd: 121_000 };
    const risk = deferralRisk(fit, 5_000, 30, econ);
    // Redesign priced high on purpose so the near-tie under test is between
    // replace and repair rather than being undercut by a third option.
    const opts = compareOptions(econ, risk, 3_000_000, 40);
    const u = assessUncertainty({ failures: 30, converged: true }, opts);
    const v = recommendOption(opts, u);
    // replace = 120,000 vs repair = 121,000 — under 1% apart
    expect(v.recommended).toBe("replace");
    expect(v.rationale).toContain("too close to call");
    expect(u.reasons.some((r) => r.includes("inside the error"))).toBe(true);
  });

  it("escalates uncertainty on a thin failure sample", () => {
    const risk = deferralRisk(fit, 5_000, 30, FULL);
    const opts = compareOptions(FULL, risk, 300_000, 40);
    const thin = assessUncertainty({ failures: 3, converged: true }, opts);
    expect(thin.level).not.toBe("low");
    expect(thin.reasons.some((r) => r.includes("3 failures"))).toBe(true);

    const solid = assessUncertainty({ failures: 40, converged: true }, opts);
    expect(solid.level).toBe("low");
    expect(solid.reasons).toEqual([]);
  });

  it("treats a non-converged fit as a reason for doubt", () => {
    const risk = deferralRisk(fit, 5_000, 30, FULL);
    const opts = compareOptions(FULL, risk, 300_000, 40);
    const u = assessUncertainty({ failures: 40, converged: false }, opts);
    expect(u.reasons).toContain("the Weibull fit did not converge");
  });
});
