import { describe, expect, it } from "vitest";
import { QUALITY_METRIC_DEFINITIONS, computeQualityScorecard } from ".";

describe("quality management scorecard", () => {
  it("publishes exactly seven formula-defined metrics", () => {
    expect(QUALITY_METRIC_DEFINITIONS).toHaveLength(7);
    expect(
      new Set(QUALITY_METRIC_DEFINITIONS.map((metric) => metric.key)).size,
    ).toBe(7);
    expect(
      QUALITY_METRIC_DEFINITIONS.every((metric) => metric.formula.length > 20),
    ).toBe(true);
  });

  it("derives quantities, NCR aging and COPQ without mixing currencies", () => {
    const result = computeQualityScorecard({
      asOf: new Date("2026-09-05T00:00:00Z"),
      defects: [
        {
          inspectedQuantity: 100,
          defectiveQuantity: 10,
          firstPassAcceptedQuantity: 90,
          reworkedQuantity: 7,
          scrappedQuantity: 3,
          scrapCost: 300,
          currency: "cad",
        },
      ],
      acceptanceTests: [
        { outcome: "pass", testedSamples: 20, passedSamples: 18 },
      ],
      ncrs: [
        {
          detectedAt: "2026-08-01T00:00:00Z",
          dueAt: "2026-08-20T00:00:00Z",
          status: "open",
        },
        {
          detectedAt: "2026-08-10T00:00:00Z",
          dueAt: "2026-09-20T00:00:00Z",
          status: "closed",
          closedAt: "2026-08-30T00:00:00Z",
        },
      ],
      reworkCosts: [
        {
          currency: "CAD",
          labourCost: 100,
          materialCost: 50,
          equipmentCost: 25,
          downtimeCost: 200,
          externalCost: 0,
        },
      ],
      costEntries: [
        { currency: "CAD", category: "external_failure", amount: 500 },
        { currency: "CAD", category: "prevention", amount: 40 },
        { currency: "USD", category: "internal_failure", amount: 25 },
      ],
    });

    expect(result.metrics.map((metric) => metric.value)).toEqual([
      90, 10, 7, 3, 90, 50, 100,
    ]);
    expect(result.ncrAging).toEqual({
      open: 1,
      overdue: 1,
      averageOpenAgeDays: 35,
      oldestOpenAgeDays: 35,
    });
    expect(result.costByCurrency).toEqual([
      {
        currency: "CAD",
        prevention: 40,
        appraisal: 0,
        internalFailure: 675,
        externalFailure: 500,
        costOfPoorQuality: 1175,
        totalCostOfQuality: 1215,
      },
      {
        currency: "USD",
        prevention: 0,
        appraisal: 0,
        internalFailure: 25,
        externalFailure: 0,
        costOfPoorQuality: 25,
        totalCostOfQuality: 25,
      },
    ]);
  });

  it("refuses impossible quantities and ambiguous cost currency", () => {
    expect(() =>
      computeQualityScorecard({
        defects: [
          {
            inspectedQuantity: 5,
            defectiveQuantity: 6,
            firstPassAcceptedQuantity: 0,
            reworkedQuantity: 0,
            scrappedQuantity: 0,
          },
        ],
        acceptanceTests: [],
        ncrs: [],
        reworkCosts: [],
        costEntries: [],
      }),
    ).toThrow(/cannot exceed inspected/);

    expect(() =>
      computeQualityScorecard({
        defects: [],
        acceptanceTests: [],
        ncrs: [],
        reworkCosts: [],
        costEntries: [
          { currency: "dollars", category: "external_failure", amount: 5 },
        ],
      }),
    ).toThrow(/three-letter/);
  });
});
