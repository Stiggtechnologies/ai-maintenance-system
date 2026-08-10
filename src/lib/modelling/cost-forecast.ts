/**
 * Maintenance-cost forecasting (capability register C7.12).
 *
 * Splits the forecast in two, because the halves behave differently and
 * averaging them together hides the only part that is manageable:
 *
 *   PLANNED work is close to deterministic. It is scheduled, its scope is
 *   known, and its variance is execution variance.
 *
 *   UNPLANNED work is a stochastic process. Its cost is the number of failures
 *   times the cost of each, and both are random. This is where the risk lives
 *   and where a single mean number is most misleading.
 *
 * The forecast therefore reports a planned figure, an unplanned distribution,
 * and a combined interval — never a single number with an implied precision it
 * does not have.
 *
 * WHAT IT REFUSES.
 *
 * A trend fitted to fewer than four periods. Two points always fit a line
 * perfectly and three barely constrain it; extrapolating either produces a
 * confident forecast from noise. Below the threshold it reports the mean and
 * says explicitly that no trend was fitted.
 */
import { percentile } from "./random";

export interface CostPeriod {
  /** Period label, e.g. "2026-03". */
  period: string;
  plannedCost: number;
  unplannedCost: number;
  /** Failures in the period, used for the unplanned frequency model. */
  failureCount: number;
}

export interface CostForecast {
  periodsUsed: number;
  /** Least-squares slope in currency per period. Null when not fitted. */
  trendPerPeriod: number | null;
  trendFitted: boolean;
  plannedForecast: number | null;
  unplannedP50: number | null;
  unplannedP90: number | null;
  combinedP50: number | null;
  combinedP90: number | null;
  /** Share of total spend that is unplanned — the manageable share. */
  unplannedShare: number | null;
  forecastable: boolean;
  reason: string;
}

/** Below this a trend is noise-fitting, not estimation. */
const MIN_PERIODS_FOR_TREND = 4;
/** Below this there is no distribution to speak of. */
const MIN_PERIODS_FOR_FORECAST = 3;

function leastSquaresSlope(values: number[]): number {
  const n = values.length;
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - meanX) * (values[i] - meanY);
    den += (i - meanX) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

export function forecastMaintenanceCost(
  history: CostPeriod[],
  horizonPeriods = 1,
): CostForecast {
  const n = history.length;

  const empty: CostForecast = {
    periodsUsed: n,
    trendPerPeriod: null,
    trendFitted: false,
    plannedForecast: null,
    unplannedP50: null,
    unplannedP90: null,
    combinedP50: null,
    combinedP90: null,
    unplannedShare: null,
    forecastable: false,
    reason: "",
  };

  if (n < MIN_PERIODS_FOR_FORECAST) {
    return {
      ...empty,
      reason: `${n} period(s) of history. A forecast needs at least ${MIN_PERIODS_FOR_FORECAST} to say anything about spread, and a number produced from fewer would carry a confidence it has not earned.`,
    };
  }
  if (!(horizonPeriods > 0)) {
    return { ...empty, reason: "Forecast horizon must be at least 1 period." };
  }

  const planned = history.map((h) => h.plannedCost);
  const unplanned = history.map((h) => h.unplannedCost);

  const trendFitted = n >= MIN_PERIODS_FOR_TREND;
  const slope = trendFitted ? leastSquaresSlope(planned) : null;
  const meanPlanned = planned.reduce((s, v) => s + v, 0) / n;

  // Planned: trend-extrapolated where a trend is defensible, mean otherwise.
  const plannedForecast =
    trendFitted && slope !== null
      ? Math.max(0, meanPlanned + slope * ((n - 1) / 2 + horizonPeriods))
      : meanPlanned;

  // Unplanned: empirical distribution of the observed per-period costs, scaled
  // to the horizon. An empirical quantile is used rather than a fitted
  // distribution because with a handful of periods any fitted shape is a
  // stronger claim than the data supports.
  const sortedUnplanned = [...unplanned].sort((a, b) => a - b);
  const uP50 = percentile(sortedUnplanned, 0.5) * horizonPeriods;
  const uP90 = percentile(sortedUnplanned, 0.9) * horizonPeriods;

  const plannedHorizon = plannedForecast * horizonPeriods;
  const totalSpend =
    planned.reduce((s, v) => s + v, 0) + unplanned.reduce((s, v) => s + v, 0);
  const share =
    totalSpend > 0 ? unplanned.reduce((s, v) => s + v, 0) / totalSpend : null;

  const failures = history.reduce((s, h) => s + h.failureCount, 0);
  const failureNote =
    failures === 0
      ? " No failures are recorded in this history, so the unplanned figure is built entirely from cost rows that no failure explains — worth checking before relying on it."
      : ` ${failures} failure(s) across the history, averaging ${(unplanned.reduce((s, v) => s + v, 0) / Math.max(1, failures)).toFixed(0)} per failure.`;

  return {
    periodsUsed: n,
    trendPerPeriod: slope,
    trendFitted,
    plannedForecast: plannedHorizon,
    unplannedP50: uP50,
    unplannedP90: uP90,
    combinedP50: plannedHorizon + uP50,
    combinedP90: plannedHorizon + uP90,
    unplannedShare: share,
    forecastable: true,
    reason:
      `Over ${horizonPeriods} period(s): planned ${plannedHorizon.toFixed(0)}, unplanned between ${uP50.toFixed(0)} (P50) and ${uP90.toFixed(0)} (P90). ` +
      `Budget the P90, not the P50 — half of all outcomes exceed the median by definition. ` +
      (trendFitted
        ? `Planned spend is ${slope! > 0 ? "rising" : slope! < 0 ? "falling" : "flat"} at ${Math.abs(slope!).toFixed(0)} per period across ${n} periods.`
        : `${n} periods is below the ${MIN_PERIODS_FOR_TREND} needed to fit a trend, so the planned figure is a mean and no direction is claimed.`) +
      (share !== null
        ? ` Unplanned work is ${(share * 100).toFixed(0)}% of spend — that share is the part a reliability programme can actually move.`
        : "") +
      failureNote,
  };
}
