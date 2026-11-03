import { describe, expect, it } from "vitest";
import { analyseBusinessCaseSensitivity } from "./sensitivity";
import type { Option } from "./index";

const invest: Option = {
  label: "Invest",
  lifePeriods: 1,
  cashFlows: [
    { period: 0, amount: -100 },
    { period: 1, amount: 110 },
  ],
};
const nothing: Option = {
  label: "Do nothing",
  lifePeriods: 1,
  cashFlows: [
    { period: 0, amount: 0 },
    { period: 1, amount: 0 },
  ],
};

describe("analyseBusinessCaseSensitivity", () => {
  it("finds the discount rate where a one-period case reverses against do-nothing", () => {
    // NPV = -100 + 110/(1+r) is zero at r = 0.10.
    const result = analyseBusinessCaseSensitivity({
      options: [invest, nothing],
      discountRate: 0.05,
      discountRateSource: "recorded finance policy",
    });
    expect(result.status).toBe("computed");
    expect(result.basis).toBe("npv");
    expect(result.baseBest).toBe("Invest");
    expect(result.baseAlternative).toBe("Do nothing");
    expect(result.breakEven).toBeCloseTo(0.1, 6);
    expect(result.headroomPct).toBeCloseTo(1, 5);
    expect(result.reason).toMatch(/discount rate reaches 0\.1/);
    expect(result.sapActualsUsed).toBe(false);
    expect(result.uncertainty).toMatch(/not a confidence interval/);
    expect(result.uncertainty).toMatch(
      /SAP actuals are not read or substituted/,
    );
    expect(result.uncertainty).toMatch(/benefit probabilities are not applied/);
  });

  it("says the ranking is robust when the margin never changes sign", () => {
    const result = analyseBusinessCaseSensitivity({
      options: [
        {
          label: "Larger benefit",
          lifePeriods: 1,
          cashFlows: [
            { period: 0, amount: -100 },
            { period: 1, amount: 200 },
          ],
        },
        {
          label: "Smaller benefit",
          lifePeriods: 1,
          cashFlows: [
            { period: 0, amount: -100 },
            { period: 1, amount: 110 },
          ],
        },
      ],
      discountRate: 0.08,
      discountRateSource: null,
    });
    expect(result.status).toBe("computed");
    expect(result.baseBest).toBe("Larger benefit");
    expect(result.breakEven).toBeNull();
    expect(result.reason).toMatch(/does not reverse anywhere/);
    expect(result.refusal).toBeNull();
  });

  it("refuses a single break-even when the margin changes sign twice", () => {
    // NPV numerator is proportional to (r-0.2)(r-0.8), so the only option
    // crosses zero twice inside the stored discount-rate domain.
    const result = analyseBusinessCaseSensitivity({
      options: [
        {
          label: "Two crossings",
          lifePeriods: 2,
          cashFlows: [
            { period: 0, amount: 100 },
            { period: 1, amount: -300 },
            { period: 2, amount: 216 },
          ],
        },
      ],
      discountRate: 0.05,
      discountRateSource: "recorded rate",
    });
    expect(result.status).toBe("refused");
    expect(result.breakEven).toBeNull();
    expect(result.refusal).toMatch(/changes sign 2 times/);
    expect(result.refusal).toMatch(/single break-even would overclaim/);
    expect(result.baseBest).toBe("Two crossings");
    expect(result.sampledLeadLow).toBeNull();
    expect(result.sapActualsUsed).toBe(false);
  });

  it("pins the demo conveyor case as two crossings, not one invented break-even", () => {
    const result = analyseBusinessCaseSensitivity({
      discountRate: 0.08,
      discountRateSource: "DEMO — group finance policy 2026",
      options: [
        {
          label: "Do nothing",
          lifePeriods: 7,
          cashFlows: [
            { period: 0, amount: 0 },
            { period: 1, amount: -850000 },
            { period: 2, amount: -900000 },
            { period: 3, amount: -950000 },
            { period: 4, amount: -1050000 },
            { period: 5, amount: -1150000 },
            { period: 6, amount: -1300000 },
            { period: 7, amount: -1500000 },
          ],
        },
        {
          label: "Refurbish",
          lifePeriods: 7,
          cashFlows: [
            { period: 0, amount: -2400000 },
            { period: 1, amount: -300000 },
            { period: 2, amount: -310000 },
            { period: 3, amount: -330000 },
            { period: 4, amount: -360000 },
            { period: 5, amount: -400000 },
            { period: 6, amount: -460000 },
            { period: 7, amount: -540000 },
          ],
        },
        {
          label: "Replace",
          lifePeriods: 20,
          cashFlows: [
            { period: 0, amount: -7800000 },
            { period: 1, amount: -180000 },
            { period: 2, amount: -185000 },
            { period: 3, amount: -190000 },
            { period: 4, amount: -195000 },
            { period: 5, amount: -200000 },
            { period: 6, amount: -210000 },
            { period: 7, amount: -215000 },
            { period: 8, amount: -225000 },
            { period: 9, amount: -235000 },
            { period: 10, amount: -245000 },
            { period: 11, amount: -255000 },
            { period: 12, amount: -265000 },
            { period: 13, amount: -280000 },
            { period: 14, amount: -295000 },
            { period: 15, amount: -310000 },
            { period: 16, amount: -330000 },
            { period: 17, amount: -350000 },
            { period: 18, amount: -370000 },
            { period: 19, amount: -395000 },
            { period: 20, amount: -420000 },
          ],
        },
      ],
    });
    expect(result).toMatchObject({
      status: "refused",
      basis: "equivalent_annual",
      baseBest: "Refurbish",
      baseAlternative: "Replace",
      breakEven: null,
      sapActualsUsed: false,
    });
    expect(result.sampledLeadLow).toBeCloseTo(0.03124996875, 8);
    expect(result.sampledLeadHigh).toBeCloseTo(0.1874998125, 8);
    expect(result.reason).toMatch(/sample points, not solved roots/);
  });

  it("uses equivalent annual value when recorded lives differ", () => {
    const result = analyseBusinessCaseSensitivity({
      options: [
        {
          label: "Short",
          lifePeriods: 1,
          cashFlows: [
            { period: 0, amount: -100 },
            { period: 1, amount: 150 },
          ],
        },
        {
          label: "Long",
          lifePeriods: 5,
          cashFlows: [
            { period: 0, amount: -100 },
            { period: 1, amount: 40 },
            { period: 2, amount: 40 },
            { period: 3, amount: 40 },
            { period: 4, amount: 40 },
            { period: 5, amount: 40 },
          ],
        },
      ],
      discountRate: 0.08,
      discountRateSource: "recorded rate",
    });
    expect(result.basis).toBe("equivalent_annual");
    expect(result.decision).toMatch(/equivalent annual value/);
    expect(result.status === "computed" || result.status === "refused").toBe(
      true,
    );
  });

  it("refuses an unusable rate, empty options, duplicate labels, and malformed flows", () => {
    expect(
      analyseBusinessCaseSensitivity({
        options: [invest],
        discountRate: 1,
        discountRateSource: "x",
      }).refusal,
    ).toMatch(/\[0, 1\)/);
    expect(
      analyseBusinessCaseSensitivity({
        options: [],
        discountRate: 0.08,
        discountRateSource: null,
      }).refusal,
    ).toMatch(/No business-case options/);
    expect(
      analyseBusinessCaseSensitivity({
        options: [invest, { ...invest }],
        discountRate: 0.08,
        discountRateSource: null,
      }).refusal,
    ).toMatch(/not unique/);
    expect(
      analyseBusinessCaseSensitivity({
        options: [
          {
            label: "Broken",
            lifePeriods: 1,
            cashFlows: [{ period: -1, amount: 10 }],
          },
        ],
        discountRate: 0.08,
        discountRateSource: null,
      }).refusal,
    ).toMatch(/Broken:/);
    expect(
      analyseBusinessCaseSensitivity({
        options: [{ label: "Empty", lifePeriods: 3, cashFlows: [] }],
        discountRate: 0.08,
        discountRateSource: "  ",
      }),
    ).toMatchObject({
      refusal: expect.stringMatching(/no cash flows are recorded/),
      discountRateSource: null,
    });
  });

  it("does not accept a benefit probability or a SAP actual as an input", () => {
    const result = analyseBusinessCaseSensitivity({
      options: [invest, nothing],
      discountRate: 0.05,
      discountRateSource: "recorded finance policy",
    });
    expect(result).not.toHaveProperty("benefitProbability");
    expect(result.sapActualsUsed).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/sap\.com|SAP_S4|odata/i);
  });
});
