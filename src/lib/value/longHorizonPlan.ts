/**
 * Labels for the A1.05 long-horizon value plan.
 *
 * The database composes the numbers. These words only stop a missing year
 * from being read as zero.
 */

export interface LongHorizonYear {
  year: number;
  capitalStatus: "recorded" | "not_recorded" | "currency_unsafe";
  capitalAmount: number | null;
  unknownCurrencyCount: number;
  otherCurrencyCount: number;
  maintenanceLineCount: number;
  maintenanceForecastCount: number;
  capitalBudgetLineCount: number;
  maintenanceCurrency: null;
  statedMaintenance: number | null;
  yearTotal: number | null;
  yearTotalBasis: string;
}

export function describeLongHorizonYear(year: LongHorizonYear): string {
  if (year.capitalStatus === "not_recorded") {
    return `${year.year}: no currency-matched capital was recorded; the year is not treated as zero.`;
  }
  if (year.capitalStatus === "currency_unsafe") {
    return `${year.year}: capital is withheld because the year mixes missing or foreign currency.`;
  }
  if (year.yearTotal == null) {
    return `${year.year}: recorded capital is ${year.capitalAmount}; the year total is withheld.`;
  }
  return `${year.year}: ${year.yearTotalBasis.split("_").join(" ")}.`;
}
