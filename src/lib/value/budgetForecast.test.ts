import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FORECAST_PHRASES,
  HISTORY_WINDOW_MONTHS,
  MIN_PERIODS_FOR_FORECAST,
  MIN_PERIODS_FOR_TREND,
  forecastBudgetAtCompletion,
} from "./budgetForecast";

const migration = readFileSync(
  "supabase/migrations/20271107120000_maintenance_budget_forecast.sql",
  "utf8",
);

describe("forecastBudgetAtCompletion", () => {
  it("fits a four-month trend and adds the remaining months of the year", () => {
    const result = forecastBudgetAtCompletion(2026, [
      { period: "2026-07", actual: 100 },
      { period: "2026-08", actual: 110 },
      { period: "2026-09", actual: 120 },
      { period: "2026-10", actual: 130 },
    ]);
    expect(result.forecastable).toBe(true);
    expect(result.slopePerMonth).toBe(10);
    expect(result.trendFitted).toBe(true);
    expect(result.actualInYear).toBe(460);
    expect(result.remainingMonths).toBe(2);
    expect(result.forecast).toBe(750);
    expect(result.reason).toContain("A trend was fitted.");
  });

  it("uses the mean below four months and does not claim a direction", () => {
    const result = forecastBudgetAtCompletion(2026, [
      { period: "2026-07", actual: 100 },
      { period: "2026-08", actual: 110 },
      { period: "2026-09", actual: 120 },
    ]);
    expect(result.trendFitted).toBe(false);
    expect(result.slopePerMonth).toBeNull();
    expect(result.forecast).toBe(660);
    expect(result.reason).toContain(FORECAST_PHRASES.belowTrend);
  });

  it("floors a falling projection at zero spend", () => {
    const result = forecastBudgetAtCompletion(2026, [
      { period: "2026-07", actual: 100 },
      { period: "2026-08", actual: 80 },
      { period: "2026-09", actual: 60 },
      { period: "2026-10", actual: 40 },
    ]);
    expect(result.slopePerMonth).toBe(-20);
    expect(result.remainingMonths).toBe(2);
    expect(result.forecast).toBe(300);
  });

  it("treats a closed prior year as the summed actual", () => {
    const result = forecastBudgetAtCompletion(2025, [
      { period: "2025-11", actual: 40 },
      { period: "2025-12", actual: 60 },
      { period: "2026-01", actual: 80 },
    ]);
    expect(result.closedYear).toBe(true);
    expect(result.forecast).toBe(100);
    expect(result.actualInYear).toBe(100);
    expect(result.reason).toContain(FORECAST_PHRASES.closed);
  });

  it("does not store a missing closed year as zero", () => {
    const result = forecastBudgetAtCompletion(2024, [
      { period: "2026-01", actual: 10 },
      { period: "2026-02", actual: 10 },
      { period: "2026-03", actual: 10 },
    ]);
    expect(result.forecastable).toBe(false);
    expect(result.actualMeasured).toBe(false);
    expect(result.actualInYear).toBeNull();
    expect(result.forecast).toBeNull();
    expect(result.reason).toContain(FORECAST_PHRASES.absence);
  });

  it("refuses to extrapolate from fewer than three months", () => {
    const result = forecastBudgetAtCompletion(2026, [
      { period: "2026-10", actual: 50 },
      { period: "2026-11", actual: 70 },
    ]);
    expect(result.forecast).toBeNull();
    expect(result.actualInYear).toBe(120);
    expect(result.reason).toContain(FORECAST_PHRASES.belowForecast);
  });

  it("completes December from the recorded actual without a trend", () => {
    const result = forecastBudgetAtCompletion(2026, [
      { period: "2026-12", actual: 50 },
    ]);
    expect(result.closedYear).toBe(true);
    expect(result.forecast).toBe(50);
    expect(result.monthsUsed).toBe(1);
  });

  it("projects the next year and does not call that an actual", () => {
    const result = forecastBudgetAtCompletion(2027, [
      { period: "2026-07", actual: 100 },
      { period: "2026-08", actual: 110 },
      { period: "2026-09", actual: 120 },
      { period: "2026-10", actual: 130 },
    ]);
    expect(result.extrapolatedYear).toBe(true);
    expect(result.actualMeasured).toBe(false);
    expect(result.actualInYear).toBeNull();
    expect(result.forecast).toBe(2340);
    expect(result.reason).toContain(FORECAST_PHRASES.nextYear);
  });

  it("refuses a year more than one year past the latest month", () => {
    const result = forecastBudgetAtCompletion(2028, [
      { period: "2026-10", actual: 10 },
      { period: "2026-11", actual: 10 },
      { period: "2026-12", actual: 10 },
    ]);
    expect(result.forecastable).toBe(false);
    expect(result.reason).toContain(FORECAST_PHRASES.tooFar);
  });

  it("refuses a repeated month instead of double-counting it", () => {
    const result = forecastBudgetAtCompletion(2026, [
      { period: "2026-10", actual: 10 },
      { period: "2026-10", actual: 10 },
      { period: "2026-11", actual: 10 },
    ]);
    expect(result.forecastable).toBe(false);
    expect(result.reason).toContain("repeated");
  });

  it("limits the trend window to the trailing 18 recorded months", () => {
    const months = Array.from({ length: 24 }, (_, index) => {
      const month = (index % 12) + 1;
      const year = 2024 + Math.floor(index / 12);
      return {
        period: `${year}-${String(month).padStart(2, "0")}`,
        actual: index + 1,
      };
    });
    const result = forecastBudgetAtCompletion(2025, months);
    expect(HISTORY_WINDOW_MONTHS).toBe(18);
    expect(result.monthsUsed).toBe(18);
    expect(result.anchorPeriod).toBe("2025-12");
  });
});

describe("the database forecast keeps the same rule text", () => {
  it("copies the limits and the reason phrases into the migration", () => {
    expect(MIN_PERIODS_FOR_FORECAST).toBe(3);
    expect(MIN_PERIODS_FOR_TREND).toBe(4);
    expect(migration).toContain("interval '17 months'");
    for (const phrase of Object.values(FORECAST_PHRASES)) {
      expect(migration).toContain(phrase);
    }
  });
});
