/**
 * Plan-level production-loss forecast.
 *
 * Event-level recovery already projects hours and downtime value. This module
 * is the plan-level question: of a recorded production commitment, how much is
 * at risk given the unplanned share the asset has already demonstrated.
 *
 * The point forecast is planned quantity × unplanned hours / covered hours.
 * That equals (planned quantity ÷ demonstrated rate) × unplanned share ×
 * demonstrated rate, so the rate cancels. The rate is still required: a zero
 * or missing rate cannot convert the plan into running time, and a mismatched
 * unit is never converted. No equipment rating is consulted.
 *
 * Coverage, production-record and unplanned-event gates are the ones already
 * enforced by `generate_maintenance_optimization_run`. P50/P80 stay withheld
 * below five observations, the same sample rule Sync Recovery uses for
 * comparable jobs. These are not new engineering limits.
 *
 * Historical-event P50/P80 describe the empirical size of past unplanned
 * losses. They are not a plan-horizon confidence interval and are not summed
 * into the plan.
 */

export const COVERAGE_FLOOR = 0.25;
export const MIN_PRODUCTION_RECORDS = 2;
export const MIN_UNPLANNED_EVENTS = 2;
export const MIN_PERCENTILE_SAMPLE = 5;
export const HISTORY_DAY_MIN = 30;
export const HISTORY_DAY_MAX = 730;

export const REFUSAL = {
  noState: "No operating-state history is available.",
  thinCoverage:
    "Operating-state coverage is below 25%; extrapolation is refused.",
  noRunning: "No demonstrated running hours exist.",
  thinProduction: "Fewer than two production records exist.",
  mixedUnits: "Production units conflict and cannot be combined.",
  thinUnplanned:
    "Fewer than two unplanned-down observations exist; a repeat rate is not established.",
  unitMismatch:
    "Plan unit does not match the demonstrated production unit; no conversion is applied.",
  zeroProduction:
    "Demonstrated production during running hours is zero, so the plan quantity cannot be converted into expected running time.",
  quantity: "Plan quantity must be positive.",
} as const;

export const POINT_BASIS =
  "Point forecast is planned quantity times the unplanned share of covered time. That equals planned running time at the demonstrated rate times that share times the rate. A zero demonstrated rate is refused rather than treated as a number. No equipment rating is used.";

export const PLAN_ROLLUP_BASIS =
  "Each forecasted line is summed only within the same unit. Overlapping lines are not deduplicated. Unlike units are never added.";

export const FORECAST_AUTHORITY =
  "Advisory draft only. This forecast does not change the production plan, release work, book a monetary loss, accept risk, or authorize return to service.";

export const VERIFICATION_REFUSAL = {
  horizonOpen:
    "The plan horizon has not ended; the forecast stays counterfactual.",
  nothingForecast: "No forecasted line exists, so there is nothing to verify.",
  actualsMissing:
    "Actual production records do not cover every forecasted line; the forecast stays counterfactual.",
  alreadyVerified: "This forecast already has a verification record.",
  generatorCannotVerify:
    "The person who generated the forecast cannot verify it.",
  generatorCannotReview:
    "The person who generated the forecast cannot review it.",
} as const;

export const AI_ADMIN_REFUSAL =
  "ai_admin cannot record, forecast, review or verify a production plan";

export const ROLE_REFUSAL =
  "a named operations, planning or maintenance role is required";

export interface PlanLineEvidence {
  plannedQuantity: number;
  planUnit: string;
  historyHours: number;
  coveredHours: number;
  runningHours: number;
  unplannedHours: number;
  /** Clipped hours of each unplanned-down observation. Length is the sample. */
  unplannedEventHours: number[];
  productionRecordCount: number;
  productionUnits: number | null;
  productionUnit: string | null;
  distinctProductionUnits: number;
}

export interface PlanLineForecast {
  status: "forecast" | "not_assessable";
  refusal: string | null;
  demonstratedRate: number | null;
  unplannedShare: number | null;
  expectedUnitsAtRisk: number | null;
  expectedAttainableUnits: number | null;
  historicalEventLossP50: number | null;
  historicalEventLossP80: number | null;
  percentileSample: number;
  basis: string;
}

export interface PlanLineRollupInput {
  unitOfMeasure: string;
  status: "forecast" | "not_assessable";
  plannedQuantity: number;
  expectedUnitsAtRisk: number | null;
}

export interface UnitRollup {
  unitOfMeasure: string;
  forecastedLines: number;
  refusedLines: number;
  plannedQuantityForecast: number | null;
  expectedUnitsAtRisk: number | null;
  complete: boolean;
}

export interface PlanRollup {
  planStatus: "forecast" | "partial" | "not_assessable";
  byUnit: UnitRollup[];
  basis: string;
}

/**
 * PostgreSQL `percentile_disc`: 1-based position `ceil(fraction * N)`,
 * clamped to the ordered sample. `sortedAscending` must already be sorted.
 */
export function percentileDisc(
  sortedAscending: readonly number[],
  fraction: number,
): number {
  const n = sortedAscending.length;
  if (n === 0) {
    throw new Error("percentile_disc requires at least one observation");
  }
  let row = Math.ceil(fraction * n);
  if (row < 1) row = 1;
  if (row > n) row = n;
  return sortedAscending[row - 1];
}

export function forecastPlanLine(evidence: PlanLineEvidence): PlanLineForecast {
  const sample = evidence.unplannedEventHours.length;
  const empty = {
    demonstratedRate: null,
    unplannedShare: null,
    expectedUnitsAtRisk: null,
    expectedAttainableUnits: null,
    historicalEventLossP50: null,
    historicalEventLossP80: null,
    percentileSample: sample,
    basis: POINT_BASIS,
  };
  const refuse = (refusal: string): PlanLineForecast => ({
    status: "not_assessable",
    refusal,
    ...empty,
  });

  if (!(evidence.coveredHours > 0) || !(evidence.historyHours > 0)) {
    return refuse(REFUSAL.noState);
  }
  if (evidence.coveredHours / evidence.historyHours < COVERAGE_FLOOR) {
    return refuse(REFUSAL.thinCoverage);
  }
  if (!(evidence.runningHours > 0)) return refuse(REFUSAL.noRunning);
  if (evidence.productionRecordCount < MIN_PRODUCTION_RECORDS) {
    return refuse(REFUSAL.thinProduction);
  }
  if (
    evidence.distinctProductionUnits !== 1 ||
    evidence.productionUnit == null
  ) {
    return refuse(REFUSAL.mixedUnits);
  }
  if (sample < MIN_UNPLANNED_EVENTS) return refuse(REFUSAL.thinUnplanned);
  if (evidence.productionUnit !== evidence.planUnit) {
    return refuse(REFUSAL.unitMismatch);
  }
  if (
    !(evidence.plannedQuantity > 0) ||
    !Number.isFinite(evidence.plannedQuantity)
  ) {
    return refuse(REFUSAL.quantity);
  }
  if (!(evidence.productionUnits != null && evidence.productionUnits > 0)) {
    return refuse(REFUSAL.zeroProduction);
  }

  const rate = evidence.productionUnits / evidence.runningHours;
  const share = evidence.unplannedHours / evidence.coveredHours;
  const expected = evidence.plannedQuantity * share;
  const attainable = evidence.plannedQuantity - expected;
  let p50: number | null = null;
  let p80: number | null = null;
  if (sample >= MIN_PERCENTILE_SAMPLE) {
    const losses = evidence.unplannedEventHours
      .map((hours) => hours * rate)
      .sort((a, b) => a - b);
    p50 = percentileDisc(losses, 0.5);
    p80 = percentileDisc(losses, 0.8);
  }

  return {
    status: "forecast",
    refusal: null,
    demonstratedRate: rate,
    unplannedShare: share,
    expectedUnitsAtRisk: expected,
    expectedAttainableUnits: attainable,
    historicalEventLossP50: p50,
    historicalEventLossP80: p80,
    percentileSample: sample,
    basis: POINT_BASIS,
  };
}

export function rollupPlanForecast(lines: PlanLineRollupInput[]): PlanRollup {
  const units = new Map<string, UnitRollup>();
  let forecasted = 0;
  let refused = 0;
  for (const line of lines) {
    const bucket = units.get(line.unitOfMeasure) ?? {
      unitOfMeasure: line.unitOfMeasure,
      forecastedLines: 0,
      refusedLines: 0,
      plannedQuantityForecast: null,
      expectedUnitsAtRisk: null,
      complete: false,
    };
    if (line.status === "forecast" && line.expectedUnitsAtRisk != null) {
      bucket.forecastedLines += 1;
      bucket.plannedQuantityForecast =
        (bucket.plannedQuantityForecast ?? 0) + line.plannedQuantity;
      bucket.expectedUnitsAtRisk =
        (bucket.expectedUnitsAtRisk ?? 0) + line.expectedUnitsAtRisk;
      forecasted += 1;
    } else {
      bucket.refusedLines += 1;
      refused += 1;
    }
    units.set(line.unitOfMeasure, bucket);
  }
  const byUnit = [...units.values()]
    .map((bucket) => ({
      ...bucket,
      complete: bucket.refusedLines === 0 && bucket.forecastedLines > 0,
    }))
    .sort((a, b) => a.unitOfMeasure.localeCompare(b.unitOfMeasure));
  const planStatus =
    forecasted === 0 ? "not_assessable" : refused > 0 ? "partial" : "forecast";
  return { planStatus, byUnit, basis: PLAN_ROLLUP_BASIS };
}

export function verificationDecision(input: {
  horizonEndMs: number;
  nowMs: number;
  forecastedLineCount: number;
  linesWithActuals: number;
}): { state: "counterfactual" | "verified"; refusal: string | null } {
  if (input.forecastedLineCount <= 0) {
    return {
      state: "counterfactual",
      refusal: VERIFICATION_REFUSAL.nothingForecast,
    };
  }
  if (input.nowMs < input.horizonEndMs) {
    return {
      state: "counterfactual",
      refusal: VERIFICATION_REFUSAL.horizonOpen,
    };
  }
  if (input.linesWithActuals < input.forecastedLineCount) {
    return {
      state: "counterfactual",
      refusal: VERIFICATION_REFUSAL.actualsMissing,
    };
  }
  return { state: "verified", refusal: null };
}
