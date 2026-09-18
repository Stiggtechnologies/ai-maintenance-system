import { describe, expect, it } from "vitest";
import {
  analyzeBenefits,
  type BenefitAgentScreen,
} from "./develop-benefits-core";

const screen: BenefitAgentScreen = {
  caseId: "case-1",
  benefits: [
    {
      id: "benefit-1",
      label: "Throughput",
      expected: 90,
      unit: "CADm",
      owner: "Finance owner",
      currentForecast: 64,
      forecastStatus: "verified",
      forecastMetricId: "checkpoint-1",
      actual: 64,
      actualMetricId: "checkpoint-1",
      variance: -26,
    },
  ],
  valueLeakage: {
    leakageEvaluable: true,
    unit: "CADm",
    approvedValue: 90,
    realizedValue: 64,
    approvedToRealizedLeakage: 26,
    trajectoryComplete: true,
    missingPoints: [],
    attributions: [
      {
        id: "attribution-1",
        bucket: "scope",
        kind: "causal",
        value: 20,
        basis: "Approved scope removal record",
        evidenceItemId: "evidence-1",
      },
    ],
    unattributedResidual: 6,
    attributionValid: true,
    missingActualBenefits: 0,
  },
};

describe("Benefits Agent governed analysis", () => {
  it("reports verified shortfall with record references", () => {
    const result = analyzeBenefits(screen);
    expect(result.verdict).toBe("shortfall");
    expect(result.verifiedActualCount).toBe(1);
    expect(result.shortfallCount).toBe(1);
    expect(result.leakage.shortfall).toBe(26);
    expect(result.leakage.unattributedResidual).toBe(6);
    expect(result.evidenceRefs).toEqual([
      "value_metrics:benefit-1",
      "value_metrics:checkpoint-1",
      "value_metrics:attribution-1",
      "evidence_items:evidence-1",
    ]);
    expect(result.limitations).toEqual([
      "6 CADm remains explicitly unattributed.",
    ]);
  });

  it("refuses a complete answer when actuals are missing", () => {
    const result = analyzeBenefits({
      ...screen,
      benefits: [
        {
          ...screen.benefits[0],
          actual: null,
          actualMetricId: null,
          variance: null,
        },
      ],
      valueLeakage: {
        leakageEvaluable: false,
        reason: "No approved BENEFITS baseline",
      },
    });
    expect(result.verdict).toBe("incomplete");
    expect(result.verifiedActualCount).toBe(0);
    expect(result.findings[0].status).toBe("actual_missing");
    expect(result.limitations).toEqual([
      "1 benefit actuals are not human-verified.",
      "No approved BENEFITS baseline",
    ]);
  });

  it("labels value gain without inventing leakage attribution", () => {
    const result = analyzeBenefits({
      ...screen,
      benefits: [{ ...screen.benefits[0], actual: 95, variance: 5 }],
      valueLeakage: {
        ...screen.valueLeakage,
        realizedValue: 95,
        approvedToRealizedLeakage: -5,
        attributions: [],
        unattributedResidual: -5,
      },
    });
    expect(result.verdict).toBe("value_gain");
    expect(result.leakage.recordedAttributions).toEqual([]);
  });
});
