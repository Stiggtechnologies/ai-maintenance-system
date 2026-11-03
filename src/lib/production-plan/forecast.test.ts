import { describe, expect, it } from "vitest";
import {
  COVERAGE_FLOOR,
  FORECAST_AUTHORITY,
  MIN_PERCENTILE_SAMPLE,
  POINT_BASIS,
  REFUSAL,
  forecastPlanLine,
  percentileDisc,
  rollupPlanForecast,
  verificationDecision,
  type PlanLineEvidence,
} from "./forecast";

function evidence(overrides: Partial<PlanLineEvidence> = {}): PlanLineEvidence {
  return {
    plannedQuantity: 1000,
    planUnit: "TO",
    historyHours: 1000,
    coveredHours: 800,
    runningHours: 600,
    unplannedHours: 80,
    unplannedEventHours: [20, 20, 40],
    productionRecordCount: 4,
    productionUnits: 3000,
    productionUnit: "TO",
    distinctProductionUnits: 1,
    ...overrides,
  };
}

describe("plan-level production-loss forecast", () => {
  it("applies the demonstrated unplanned share to the plan quantity", () => {
    const result = forecastPlanLine(evidence());
    expect(result.status).toBe("forecast");
    expect(result.refusal).toBeNull();
    expect(result.expectedUnitsAtRisk).toBe(100);
    expect(result.expectedAttainableUnits).toBe(900);
    expect(result.demonstratedRate).toBe(5);
    expect(result.unplannedShare).toBe(0.1);
    expect(result.basis).toBe(POINT_BASIS);
    expect(result).not.toHaveProperty("usd");
    expect(JSON.stringify(result)).not.toMatch(/nameplate|usd/i);
  });

  it("matches planned-hours-at-the-demonstrated-rate when the rate cancels", () => {
    const result = forecastPlanLine(evidence());
    const rate = 3000 / 600;
    const impliedHours = 1000 / rate;
    const viaHours = impliedHours * (80 / 800) * rate;
    expect(result.expectedUnitsAtRisk).toBe(viaHours);
  });

  it("refuses thin coverage at the existing 25% gate and accepts the boundary", () => {
    expect(
      forecastPlanLine(evidence({ coveredHours: 249, historyHours: 1000 }))
        .refusal,
    ).toBe(REFUSAL.thinCoverage);
    const boundary = forecastPlanLine(
      evidence({
        coveredHours: COVERAGE_FLOOR * 1000,
        historyHours: 1000,
        runningHours: 200,
        unplannedHours: 20,
        unplannedEventHours: [10, 10],
        productionUnits: 400,
      }),
    );
    expect(boundary.status).toBe("forecast");
    expect(boundary.expectedUnitsAtRisk).toBe(80);
  });

  it("refuses missing state, running time, production, mixed units, a short sample, a unit change and zero output", () => {
    expect(forecastPlanLine(evidence({ coveredHours: 0 })).refusal).toBe(
      REFUSAL.noState,
    );
    expect(forecastPlanLine(evidence({ runningHours: 0 })).refusal).toBe(
      REFUSAL.noRunning,
    );
    expect(
      forecastPlanLine(evidence({ productionRecordCount: 1 })).refusal,
    ).toBe(REFUSAL.thinProduction);
    expect(
      forecastPlanLine(
        evidence({ distinctProductionUnits: 2, productionUnit: "TO" }),
      ).refusal,
    ).toBe(REFUSAL.mixedUnits);
    expect(
      forecastPlanLine(evidence({ unplannedEventHours: [80] })).refusal,
    ).toBe(REFUSAL.thinUnplanned);
    expect(forecastPlanLine(evidence({ planUnit: "EA" })).refusal).toBe(
      REFUSAL.unitMismatch,
    );
    expect(forecastPlanLine(evidence({ productionUnits: 0 })).refusal).toBe(
      REFUSAL.zeroProduction,
    );
    expect(forecastPlanLine(evidence({ plannedQuantity: 0 })).refusal).toBe(
      REFUSAL.quantity,
    );
  });

  it("does not clamp a share above the plan, and withholds percentiles below five events", () => {
    const over = forecastPlanLine(
      evidence({ unplannedHours: 1600, unplannedEventHours: [800, 800] }),
    );
    expect(over.expectedUnitsAtRisk).toBe(2000);
    expect(over.expectedAttainableUnits).toBe(-1000);
    expect(over.historicalEventLossP50).toBeNull();
    expect(over.percentileSample).toBe(2);
  });

  it("uses PostgreSQL percentile_disc once five unplanned events exist", () => {
    expect(MIN_PERCENTILE_SAMPLE).toBe(5);
    const hours = [1, 2, 3, 4, 5];
    expect(percentileDisc(hours, 0.5)).toBe(3);
    expect(percentileDisc(hours, 0.8)).toBe(4);
    const result = forecastPlanLine(
      evidence({
        unplannedEventHours: hours,
        unplannedHours: 15,
        runningHours: 100,
        productionUnits: 1000,
      }),
    );
    expect(result.historicalEventLossP50).toBe(30);
    expect(result.historicalEventLossP80).toBe(40);
    expect(result.expectedUnitsAtRisk).toBeCloseTo(18.75);
  });

  it("rolls a plan up inside one unit and never adds unlike units", () => {
    const rollup = rollupPlanForecast([
      {
        unitOfMeasure: "TO",
        status: "forecast",
        plannedQuantity: 1000,
        expectedUnitsAtRisk: 100,
      },
      {
        unitOfMeasure: "TO",
        status: "not_assessable",
        plannedQuantity: 400,
        expectedUnitsAtRisk: null,
      },
      {
        unitOfMeasure: "EA",
        status: "forecast",
        plannedQuantity: 10,
        expectedUnitsAtRisk: 2,
      },
    ]);
    expect(rollup.planStatus).toBe("partial");
    expect(rollup.byUnit).toEqual([
      {
        unitOfMeasure: "EA",
        forecastedLines: 1,
        refusedLines: 0,
        plannedQuantityForecast: 10,
        expectedUnitsAtRisk: 2,
        complete: true,
      },
      {
        unitOfMeasure: "TO",
        forecastedLines: 1,
        refusedLines: 1,
        plannedQuantityForecast: 1000,
        expectedUnitsAtRisk: 100,
        complete: false,
      },
    ]);
    expect(rollup.byUnit[1].expectedUnitsAtRisk).not.toBe(500);
  });

  it("stays counterfactual until the horizon has ended and every forecasted line has actuals", () => {
    expect(
      verificationDecision({
        horizonEndMs: 200,
        nowMs: 100,
        forecastedLineCount: 1,
        linesWithActuals: 1,
      }),
    ).toMatchObject({ state: "counterfactual" });
    expect(
      verificationDecision({
        horizonEndMs: 100,
        nowMs: 100,
        forecastedLineCount: 2,
        linesWithActuals: 1,
      }).refusal,
    ).toMatch(/every forecasted line/);
    expect(
      verificationDecision({
        horizonEndMs: 100,
        nowMs: 100,
        forecastedLineCount: 2,
        linesWithActuals: 2,
      }),
    ).toEqual({ state: "verified", refusal: null });
    expect(FORECAST_AUTHORITY).toMatch(/does not change the production plan/);
  });
});
