/**
 * Validation for interval optimisation.
 *
 * Held to the standard the register section names — "validated code, not
 * plausible equations". Interval optimisation always returns a number, so the
 * tests that matter most are the ones proving it returns the RIGHT number
 * against a case with an exact answer, and proving it REFUSES when the model
 * says preventive replacement cannot help.
 */
import { describe, expect, it } from "vitest";
import {
  reliabilityAt,
  expectedCycleLength,
  ageReplacementCostRate,
  runToFailureCostRate,
  optimalAgeReplacement,
  inspectionInterval,
  gamma,
} from "./index";

const COST = { plannedCost: 1_000, failureCost: 10_000 };

describe("gamma", () => {
  it("matches exact values", () => {
    expect(gamma(1)).toBeCloseTo(1, 10);
    expect(gamma(2)).toBeCloseTo(1, 10);
    expect(gamma(5)).toBeCloseTo(24, 8); // 4!
    expect(gamma(0.5)).toBeCloseTo(Math.sqrt(Math.PI), 10);
    expect(gamma(1.5)).toBeCloseTo(Math.sqrt(Math.PI) / 2, 10);
  });
});

describe("expectedCycleLength — numerical integration pinned to an exact case", () => {
  it("matches the analytic exponential integral when beta = 1", () => {
    // beta = 1: ∫₀ᵀ e^(−t/η) dt = η(1 − e^(−T/η)), exactly.
    const fit = { beta: 1, eta: 500 };
    for (const T of [50, 250, 500, 1500]) {
      const exact = 500 * (1 - Math.exp(-T / 500));
      expect(expectedCycleLength(fit, T)).toBeCloseTo(exact, 6);
    }
  });

  it("approaches the Weibull mean as T grows, for beta > 1", () => {
    const fit = { beta: 2.5, eta: 1000 };
    const mttf = 1000 * gamma(1 + 1 / 2.5);
    // At 3x eta the survivor function is ~0, so the integral is the mean.
    expect(expectedCycleLength(fit, 3000)).toBeCloseTo(mttf, 1);
  });

  it("is zero at T = 0 and increases monotonically", () => {
    const fit = { beta: 2, eta: 400 };
    expect(expectedCycleLength(fit, 0)).toBe(0);
    const vals = [100, 200, 400, 800].map((T) => expectedCycleLength(fit, T));
    expect(vals).toEqual([...vals].sort((a, b) => a - b));
  });
});

describe("cost rate", () => {
  it("equals Cf/MTTF in the limit of never replacing", () => {
    const fit = { beta: 2, eta: 1000 };
    const rtf = runToFailureCostRate(fit, COST);
    // At a very long T the policy IS run-to-failure.
    expect(ageReplacementCostRate(fit, 100_000, COST)).toBeCloseTo(rtf, 6);
  });

  it("rises without bound as the interval shrinks toward zero", () => {
    const fit = { beta: 2, eta: 1000 };
    // Replacing constantly costs Cp per near-zero cycle.
    expect(ageReplacementCostRate(fit, 0.1, COST)).toBeGreaterThan(
      ageReplacementCostRate(fit, 100, COST) * 10,
    );
  });
});

describe("the refusals — the point of this module", () => {
  it("REFUSES age replacement for a constant failure rate (beta = 1)", () => {
    const r = optimalAgeReplacement({ beta: 1, eta: 1000, failures: 50 }, COST);
    expect(r.recommended).toBe(false);
    expect(r.optimalAge).toBeNull();
    expect(r.reason).toMatch(/CONSTANT \(random\)/);
    expect(r.reason).toMatch(/spend without benefit/i);
  });

  it("REFUSES for infant mortality (beta < 1) and names the real problem", () => {
    // The auxiliary fleet's worst actor fitted beta = 0.89.
    const r = optimalAgeReplacement(
      { beta: 0.89, eta: 1000, failures: 270 },
      COST,
    );
    expect(r.recommended).toBe(false);
    expect(r.reason).toMatch(/DECREASING \(infant mortality\)/);
    expect(r.reason).toMatch(
      /installation, commissioning and early-life quality/i,
    );
  });

  it("refuses when a failure costs no more than a planned replacement", () => {
    const r = optimalAgeReplacement(
      { beta: 3, eta: 1000, failures: 40 },
      { plannedCost: 5_000, failureCost: 5_000 },
    );
    expect(r.recommended).toBe(false);
    expect(r.reason).toMatch(/nothing to buy/i);
  });

  it("refuses without both costs rather than assuming one", () => {
    const r = optimalAgeReplacement(
      { beta: 3, eta: 1000, failures: 40 },
      { plannedCost: 0, failureCost: 10_000 },
    );
    expect(r.recommended).toBe(false);
    expect(r.reason).toMatch(/neither is assumed/i);
  });
});

describe("the recommendation, when it is warranted", () => {
  const fit = { beta: 3, eta: 1000, failures: 40 };

  it("finds an interior optimum for a strong wear-out item", () => {
    const r = optimalAgeReplacement(fit, COST);
    expect(r.recommended).toBe(true);
    expect(r.optimalAge).toBeGreaterThan(0);
    expect(r.optimalAge).toBeLessThan(1000); // before the characteristic life
    expect(r.savingsPct).toBeGreaterThan(0);
  });

  it("is a true minimum — the cost rate is higher on both sides", () => {
    const r = optimalAgeReplacement(fit, COST);
    const T = r.optimalAge as number;
    const at = ageReplacementCostRate(fit, T, COST);
    expect(ageReplacementCostRate(fit, T * 0.7, COST)).toBeGreaterThan(at);
    expect(ageReplacementCostRate(fit, T * 1.4, COST)).toBeGreaterThan(at);
  });

  it("replaces earlier as failure becomes more expensive", () => {
    const cheap = optimalAgeReplacement(fit, {
      plannedCost: 1_000,
      failureCost: 3_000,
    });
    const dear = optimalAgeReplacement(fit, {
      plannedCost: 1_000,
      failureCost: 50_000,
    });
    expect(dear.optimalAge as number).toBeLessThan(cheap.optimalAge as number);
  });

  it("replaces later as the item lasts longer, all else equal", () => {
    const short = optimalAgeReplacement(
      { beta: 3, eta: 500, failures: 40 },
      COST,
    );
    const long = optimalAgeReplacement(
      { beta: 3, eta: 2000, failures: 40 },
      COST,
    );
    expect(long.optimalAge as number).toBeGreaterThan(
      short.optimalAge as number,
    );
  });

  it("beats run-to-failure by the margin it claims", () => {
    const r = optimalAgeReplacement(fit, COST);
    const claimed = r.savingsPct as number;
    const actual =
      (((r.runToFailureCostRate as number) - (r.costRateAtOptimum as number)) /
        (r.runToFailureCostRate as number)) *
      100;
    expect(claimed).toBeCloseTo(actual, 1);
  });
});

describe("inspection interval", () => {
  it("halves the P-F interval for two opportunities", () => {
    const r = inspectionInterval(60, 0.9, 2);
    expect(r.intervalDays).toBe(30);
    expect(r.opportunities).toBe(2);
  });

  it("states the detection probability rather than implying certainty", () => {
    const r = inspectionInterval(60, 0.9, 2);
    // 1 - 0.1^2 = 0.99, not 1.0
    expect(r.detectionProbability).toBeCloseTo(0.99, 6);
    expect(r.reason).toMatch(/not certainty/i);
    expect(r.reason).toMatch(/residual is the risk being accepted/i);
  });

  it("raises detection with more opportunities and shortens the interval", () => {
    const two = inspectionInterval(60, 0.8, 2);
    const four = inspectionInterval(60, 0.8, 4);
    expect(four.detectionProbability).toBeGreaterThan(two.detectionProbability);
    expect(four.intervalDays as number).toBeLessThan(
      two.intervalDays as number,
    );
    expect(four.detectionProbability).toBeCloseTo(1 - Math.pow(0.2, 4), 6);
  });

  it("refuses a non-positive P-F interval rather than defaulting one", () => {
    const r = inspectionInterval(0);
    expect(r.intervalDays).toBeNull();
    expect(r.reason).toMatch(/engineering determination, not a default/i);
  });

  it("refuses an impossible detection probability", () => {
    expect(inspectionInterval(60, 0).intervalDays).toBeNull();
    expect(inspectionInterval(60, 1.5).intervalDays).toBeNull();
  });
});

describe("reliabilityAt", () => {
  it("is 1 at t=0 and 1/e at the characteristic life for any beta", () => {
    for (const beta of [0.7, 1, 2, 3.5]) {
      expect(reliabilityAt({ beta, eta: 800 }, 0)).toBe(1);
      expect(reliabilityAt({ beta, eta: 800 }, 800)).toBeCloseTo(
        Math.exp(-1),
        12,
      );
    }
  });
});
