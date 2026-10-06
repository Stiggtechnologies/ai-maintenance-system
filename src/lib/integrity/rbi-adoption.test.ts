import { describe, expect, it } from "vitest";
import { planRiskBasedInspection } from "./rbi";
import type { RbiInput } from "./rbi";
import { buildRbiAdoption, describeRbiInputs } from "./rbi-adoption";

const input: RbiInput = {
  componentId: "circuit 7",
  genericFailureFrequency: {
    perYear: 3e-5,
    basis: "Licensed API 581 Part 2 Table 3.1",
  },
  mechanisms: [
    {
      mechanism: "Internal thinning",
      basis: "CML trend 2018–2025 owner assessment",
      curve: [
        { years: 0, df: 1 },
        { years: 10, df: 101 },
      ],
    },
  ],
  combination: "additive",
  combinationBasis: "Integrity procedure IP-4 §3",
  managementSystemFactor: { value: 1, basis: "2025 PSM audit score" },
  consequence: { value: 100, unit: "m2", basis: "Consequence study CA-22" },
  riskTarget: { value: 0.05, basis: "Integrity risk target IRT-1" },
};
const today = new Date(Date.UTC(2026, 9, 6));

describe("BOK-05 RBI adoption proposal", () => {
  it("rounds the interval down to whole months and dates the next inspection", () => {
    const r = planRiskBasedInspection(input);
    const a = buildRbiAdoption(input, r, today);
    // 1.5667 years = 18.8 months → 18
    expect(a.adoptable).toBe(true);
    expect(a.intervalMonths).toBe(18);
    expect(a.nextDue).toBe("2028-04-06");
    expect(a.intervalBasis).toContain("Licensed API 581 Part 2 Table 3.1");
    expect(a.intervalBasis).toContain("API 580-aligned");
    expect(a.intervalBasis.length).toBeGreaterThan(20);
  });
  it("clamps month-end dates", () => {
    const r = planRiskBasedInspection(input);
    expect(
      buildRbiAdoption(input, r, new Date(Date.UTC(2026, 7, 31))).nextDue,
    ).toBe("2028-02-29");
  });
  it("refuses an interval when risk is already over target", () => {
    const over = {
      ...input,
      riskTarget: { value: 1e-3, basis: "Integrity risk target IRT-1" },
    };
    const a = buildRbiAdoption(over, planRiskBasedInspection(over), today);
    expect(a.adoptable).toBe(false);
    expect(a.intervalMonths).toBeNull();
    expect(a.reason).toMatch(/inspect or mitigate now/);
  });
  it("refuses when the damage curve never reaches the target", () => {
    const far = {
      ...input,
      riskTarget: { value: 1, basis: "Integrity risk target IRT-1" },
    };
    expect(
      buildRbiAdoption(far, planRiskBasedInspection(far), today).reason,
    ).toMatch(/extend the owner's damage assessment/);
  });
  it("refuses intervals shorter than one month", () => {
    const fast = {
      ...input,
      riskTarget: { value: 3.1e-3, basis: "Integrity risk target IRT-1" },
    };
    const a = buildRbiAdoption(fast, planRiskBasedInspection(fast), today);
    expect(a.adoptable).toBe(false);
    expect(a.reason).toMatch(/inspect now/);
  });
  it("records every input with its source", () => {
    const d = describeRbiInputs(input);
    for (const s of [
      "0.00003/yr",
      "Internal thinning",
      "0y=1",
      "10y=101",
      "additive",
      "F_MS 1",
      "CoF 100 m2",
      "risk target 0.05",
    ])
      expect(d).toContain(s);
  });
});
