/**
 * Maintenance-budget forecast arithmetic (capability register E9.04).
 *
 * This is the forecast-at-completion of recorded monthly actuals. It is not
 * the modelling-studio maintenance-cost kernel: that kernel values downtime,
 * and the cost-capture posture already says that proxy cannot be reconciled
 * to a maintenance budget. Callers must pass months they have already summed
 * from recorded spend. This module does not invent a rate, a currency or a
 * missing month.
 *
 * The SQL copy lives in `maintenance_budget_forecast_math` and must keep the
 * same limits and the same reason phrases. `budgetForecast.test.ts` pins both.
 */

export const MIN_PERIODS_FOR_FORECAST = 3;
export const MIN_PERIODS_FOR_TREND = 4;
/** Inclusive window ending at the latest recorded month. */
export const HISTORY_WINDOW_MONTHS = 18;

export const FORECAST_PHRASES = {
  noMonths: "No costed months are recorded",
  absence: "Absence is not zero",
  tooFar: "more than one year past the latest recorded month",
  belowForecast: "below the 3 months required to extrapolate",
  belowTrend: "below the 4 required to fit a trend",
  closed: "Forecast at completion equals the summed recorded actual",
  nextYear: "extrapolates the next 12 months",
} as const;

export interface BudgetMonth {
  /** Calendar month, YYYY-MM. */
  period: string;
  actual: number;
}

export interface BudgetForecastMath {
  forecastable: boolean;
  forecast: number | null;
  actualInYear: number | null;
  actualMeasured: boolean;
  monthsUsed: number;
  trendFitted: boolean;
  slopePerMonth: number | null;
  remainingMonths: number;
  anchorPeriod: string | null;
  closedYear: boolean;
  extrapolatedYear: boolean;
  reason: string;
}

const PERIOD = /^(\d{4})-(\d{2})$/;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function periodParts(period: string): { year: number; month: number } | null {
  const match = PERIOD.exec(period);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

function periodIndex(period: string): number | null {
  const parts = periodParts(period);
  if (!parts) return null;
  return parts.year * 12 + (parts.month - 1);
}

function leastSquaresSlope(values: number[]): number {
  const n = values.length;
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((sum, value) => sum + value, 0) / n;
  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i += 1) {
    numerator += (i - meanX) * (values[i] - meanY);
    denominator += (i - meanX) ** 2;
  }
  return denominator === 0 ? 0 : numerator / denominator;
}

function project(
  values: number[],
  remaining: number,
): {
  sum: number;
  slope: number | null;
  trendFitted: boolean;
} {
  const n = values.length;
  const trendFitted = n >= MIN_PERIODS_FOR_TREND;
  const meanY = values.reduce((sum, value) => sum + value, 0) / n;
  const meanX = (n - 1) / 2;
  const slope = trendFitted ? leastSquaresSlope(values) : null;
  let sum = 0;
  for (let k = 1; k <= remaining; k += 1) {
    const raw = slope === null ? meanY : meanY + slope * (meanX + k);
    sum += Math.max(0, raw);
  }
  return { sum, slope, trendFitted };
}

function empty(
  reason: string,
  extra: Partial<BudgetForecastMath> = {},
): BudgetForecastMath {
  return {
    forecastable: false,
    forecast: null,
    actualInYear: null,
    actualMeasured: false,
    monthsUsed: 0,
    trendFitted: false,
    slopePerMonth: null,
    remainingMonths: 0,
    anchorPeriod: null,
    closedYear: false,
    extrapolatedYear: false,
    reason,
    ...extra,
  };
}

/**
 * Forecast one budget year from monthly actuals.
 *
 * Months outside the trailing 18-month window still count toward a closed
 * year's actual. They do not enter the trend. A year with no recorded month
 * is not stored as zero.
 */
export function forecastBudgetAtCompletion(
  budgetYear: number,
  months: BudgetMonth[],
): BudgetForecastMath {
  if (!Number.isInteger(budgetYear)) {
    return empty("The budget year must be a calendar year.");
  }

  const parsed: Array<{ period: string; actual: number; index: number }> = [];
  const seen = new Set<string>();
  for (const month of months) {
    const index = periodIndex(month.period);
    if (index === null || !Number.isFinite(month.actual)) {
      return empty(
        "Every history month needs a YYYY-MM period and a finite actual.",
      );
    }
    if (seen.has(month.period)) {
      return empty(
        `Month ${month.period} is repeated. Duplicate months would double the actual, so the forecast is refused.`,
      );
    }
    seen.add(month.period);
    parsed.push({ period: month.period, actual: month.actual, index });
  }
  parsed.sort((a, b) => a.index - b.index);

  if (parsed.length === 0) {
    return empty(
      `${FORECAST_PHRASES.noMonths}. There is nothing to sum and nothing to extrapolate.`,
    );
  }

  const anchor = parsed[parsed.length - 1];
  const anchorParts = periodParts(anchor.period);
  if (!anchorParts) {
    return empty("The latest recorded month is not a calendar month.");
  }
  const windowStart = anchor.index - (HISTORY_WINDOW_MONTHS - 1);
  const history = parsed.filter((month) => month.index >= windowStart);
  const inYear = parsed.filter(
    (month) => periodParts(month.period)?.year === budgetYear,
  );
  const actualMeasured = inYear.length > 0;
  const rawActual = inYear.reduce((sum, month) => sum + month.actual, 0);
  const actualInYear = actualMeasured ? round2(rawActual) : null;
  const base = {
    monthsUsed: history.length,
    anchorPeriod: anchor.period,
    actualMeasured,
    actualInYear,
  };

  if (
    budgetYear < anchorParts.year ||
    (budgetYear === anchorParts.year && anchorParts.month === 12)
  ) {
    if (!actualMeasured) {
      return empty(
        `${FORECAST_PHRASES.absence}. No costed month was recorded in ${budgetYear}, and a missing year is not stored as a zero actual.`,
        base,
      );
    }
    return {
      ...empty(`${FORECAST_PHRASES.closed}. No extrapolation.`, base),
      forecastable: true,
      forecast: actualInYear,
      closedYear: true,
    };
  }

  if (budgetYear > anchorParts.year + 1) {
    return empty(
      `The latest recorded month is ${anchor.period}. A forecast for ${budgetYear} is ${FORECAST_PHRASES.tooFar} and is refused.`,
      base,
    );
  }

  if (history.length < MIN_PERIODS_FOR_FORECAST) {
    return empty(
      `${history.length} costed month(s) are ${FORECAST_PHRASES.belowForecast}. The recorded actual is reported and the forecast is refused.`,
      base,
    );
  }

  const remaining =
    budgetYear === anchorParts.year ? 12 - anchorParts.month : 12;
  const projected = project(
    history.map((month) => month.actual),
    remaining,
  );
  const forecast = round2((actualMeasured ? rawActual : 0) + projected.sum);
  const trendNote = projected.trendFitted
    ? "A trend was fitted."
    : `${history.length} months is ${FORECAST_PHRASES.belowTrend}, so each remaining month is the mean and no direction is claimed.`;

  if (budgetYear === anchorParts.year + 1) {
    return {
      forecastable: true,
      forecast,
      actualInYear: null,
      actualMeasured: false,
      monthsUsed: history.length,
      trendFitted: projected.trendFitted,
      slopePerMonth: projected.slope,
      remainingMonths: 12,
      anchorPeriod: anchor.period,
      closedYear: false,
      extrapolatedYear: true,
      reason: `No recorded actual in ${budgetYear}. The figure ${FORECAST_PHRASES.nextYear} from ${history.length} recorded month(s) and is not a forecast at completion of spend already recorded in that year. ${trendNote}`,
    };
  }

  return {
    forecastable: true,
    forecast,
    actualInYear,
    actualMeasured,
    monthsUsed: history.length,
    trendFitted: projected.trendFitted,
    slopePerMonth: projected.slope,
    remainingMonths: remaining,
    anchorPeriod: anchor.period,
    closedYear: false,
    extrapolatedYear: false,
    reason: `Forecast at completion adds ${remaining} remaining month(s) to the recorded actual. ${trendNote}`,
  };
}
