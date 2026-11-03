import { describe, expect, it } from "vitest";
import {
  describeLongHorizonYear,
  type LongHorizonYear,
} from "./longHorizonPlan";

const year = (overrides: Partial<LongHorizonYear>): LongHorizonYear => ({
  year: 2027,
  capitalStatus: "not_recorded",
  capitalAmount: null,
  unknownCurrencyCount: 0,
  otherCurrencyCount: 0,
  maintenanceLineCount: 0,
  maintenanceForecastCount: 0,
  capitalBudgetLineCount: 0,
  maintenanceCurrency: null,
  statedMaintenance: null,
  yearTotal: null,
  yearTotalBasis: "not_recorded",
  ...overrides,
});

describe("describeLongHorizonYear", () => {
  it("does not read a missing year as zero", () => {
    expect(describeLongHorizonYear(year({}))).toMatch(/not treated as zero/);
  });

  it("names mixed or unknown currency as withheld", () => {
    expect(
      describeLongHorizonYear(
        year({
          capitalStatus: "currency_unsafe",
          yearTotalBasis: "withheld_currency",
          unknownCurrencyCount: 1,
        }),
      ),
    ).toMatch(/withheld/);
  });

  it("names a recorded year by its server basis", () => {
    expect(
      describeLongHorizonYear(
        year({
          capitalStatus: "recorded",
          capitalAmount: 125000,
          yearTotal: 125000,
          yearTotalBasis: "recorded_capital",
        }),
      ),
    ).toBe("2027: recorded capital.");
  });
});
