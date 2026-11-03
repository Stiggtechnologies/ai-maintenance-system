import { supabase } from "../lib/supabase";

/**
 * E9.07 production-loss valuation on the canonical financial-assumption series.
 *
 * The rate is a new dated version of `financial_assumptions`, written only
 * through `upsert_financial_assumption`. Measured loss stays in the C2.06
 * reconciliation. This module prices one with the other and refuses when
 * either side is missing. It does not invent a price, a throughput rate, or
 * a combined total across units that were not all priced.
 */

export const PRODUCTION_LOSS_VALUE_PREFIX = "production_loss_unit_value:";

const UNIT_OF_MEASURE = /^[A-Za-z][A-Za-z0-9._-]{0,31}$/;
const CURRENCY = /^[A-Z]{3}$/;

export interface ProductionLossUnitValue {
  id: number;
  assumptionKey: string;
  unitOfMeasure: string;
  currency: string;
  valuePerUnit: number;
  unit: string;
  source: string;
  effectiveFrom: string;
  reviewDue: string | null;
  label: string;
}

export interface ProductionLossValueInput {
  unitOfMeasure: string;
  currency: string;
  valuePerUnit: number;
  source: string;
  label?: string | null;
  effectiveFrom?: string | null;
  reviewDue?: string | null;
}

export interface MeasuredProductionLoss {
  unitOfMeasure: string;
  estimatedUnitsLost: number | null;
  events: number;
}

export type ProductionLossValuation =
  | {
      status: "valued";
      unitOfMeasure: string;
      events: number;
      estimatedUnitsLost: number;
      amount: number;
      currency: string;
      source: string;
      effectiveFrom: string;
      assumptionKey: string;
      reason: string;
    }
  | {
      status: "unvalued";
      unitOfMeasure: string;
      events: number;
      reason: string;
    };

interface AssumptionRow {
  id: number;
  assumption_key: string;
  label: string;
  value: number | string;
  unit: string | null;
  source: string;
  effective_from: string;
  review_due: string | null;
}

export function productionLossValueKey(unitOfMeasure: string): string {
  return `${PRODUCTION_LOSS_VALUE_PREFIX}${unitOfMeasure}`;
}

export function validateProductionLossUnitValue(
  input: ProductionLossValueInput,
):
  | {
      ok: true;
      key: string;
      unit: string;
      label: string;
      currency: string;
      unitOfMeasure: string;
    }
  | { ok: false; reason: string } {
  const unitOfMeasure = input.unitOfMeasure.trim();
  if (!UNIT_OF_MEASURE.test(unitOfMeasure)) {
    return {
      ok: false,
      reason:
        "Name the measured production unit (letters, digits, '.', '_' or '-'). The rate is stored against that unit and is not applied to a different one.",
    };
  }
  const currency = input.currency.trim().toUpperCase();
  if (!CURRENCY.test(currency)) {
    return {
      ok: false,
      reason: "State the currency as a 3-letter code. No currency is assumed.",
    };
  }
  if (!Number.isFinite(input.valuePerUnit) || input.valuePerUnit <= 0) {
    return {
      ok: false,
      reason:
        "A production-loss unit value is a finite amount greater than zero. A missing price is left unrecorded rather than stored as zero.",
    };
  }
  const source = input.source.trim();
  if (source.length < 5) {
    return {
      ok: false,
      reason:
        "State where this unit value comes from (5 characters minimum). An unsourced price is not recorded.",
    };
  }
  const label = (input.label ?? "").trim();
  return {
    ok: true,
    key: productionLossValueKey(unitOfMeasure),
    unit: `${currency}/${unitOfMeasure}`,
    label:
      label.length >= 3 ? label : `Lost production value per ${unitOfMeasure}`,
    currency,
    unitOfMeasure,
  };
}

function parseProductionLossValue(
  row: AssumptionRow,
): ProductionLossUnitValue | null {
  if (!row.assumption_key.startsWith(PRODUCTION_LOSS_VALUE_PREFIX)) return null;
  const unitOfMeasure = row.assumption_key.slice(
    PRODUCTION_LOSS_VALUE_PREFIX.length,
  );
  const unit = row.unit ?? "";
  const slash = unit.indexOf("/");
  if (slash <= 0) return null;
  const currency = unit.slice(0, slash);
  const statedUnit = unit.slice(slash + 1);
  if (statedUnit !== unitOfMeasure || !CURRENCY.test(currency)) return null;
  const valuePerUnit = Number(row.value);
  if (!Number.isFinite(valuePerUnit) || valuePerUnit <= 0) return null;
  if (!row.source || row.source.trim().length < 5) return null;
  return {
    id: row.id,
    assumptionKey: row.assumption_key,
    unitOfMeasure,
    currency,
    valuePerUnit,
    unit,
    source: row.source,
    effectiveFrom: row.effective_from,
    reviewDue: row.review_due,
    label: row.label,
  };
}

/** Latest operative version of each unit-value series. Future dates wait. */
export function operativeProductionLossValues(
  rows: AssumptionRow[],
  asOf: string,
): ProductionLossUnitValue[] {
  const operative = new Map<string, AssumptionRow>();
  const ordered = [...rows].sort((a, b) => {
    if (a.effective_from !== b.effective_from) {
      return a.effective_from < b.effective_from ? 1 : -1;
    }
    return b.id - a.id;
  });
  for (const row of ordered) {
    if (row.effective_from > asOf) continue;
    if (!operative.has(row.assumption_key))
      operative.set(row.assumption_key, row);
  }
  return [...operative.values()].flatMap((row) => {
    const parsed = parseProductionLossValue(row);
    return parsed ? [parsed] : [];
  });
}

export function valueMeasuredProductionLoss(
  loss: MeasuredProductionLoss,
  rate: ProductionLossUnitValue | null,
): ProductionLossValuation {
  if (
    loss.estimatedUnitsLost == null ||
    !Number.isFinite(loss.estimatedUnitsLost) ||
    loss.estimatedUnitsLost < 0
  ) {
    return {
      status: "unvalued",
      unitOfMeasure: loss.unitOfMeasure,
      events: loss.events,
      reason: `Measured loss for ${loss.unitOfMeasure} is not a finite non-negative quantity, so it is not priced.`,
    };
  }
  if (!rate || rate.unitOfMeasure !== loss.unitOfMeasure) {
    return {
      status: "unvalued",
      unitOfMeasure: loss.unitOfMeasure,
      events: loss.events,
      reason: `No sourced unit value is recorded for ${loss.unitOfMeasure}. Measured loss stays unvalued.`,
    };
  }
  const amount = loss.estimatedUnitsLost * rate.valuePerUnit;
  return {
    status: "valued",
    unitOfMeasure: loss.unitOfMeasure,
    events: loss.events,
    estimatedUnitsLost: loss.estimatedUnitsLost,
    amount,
    currency: rate.currency,
    source: rate.source,
    effectiveFrom: rate.effectiveFrom,
    assumptionKey: rate.assumptionKey,
    reason:
      `${loss.estimatedUnitsLost} ${loss.unitOfMeasure} × ${rate.valuePerUnit} ${rate.unit} ` +
      `(source: ${rate.source}, effective ${rate.effectiveFrom}) = ${amount} ${rate.currency}. ` +
      "This prices measured loss only.",
  };
}

export async function listProductionLossUnitValues(
  asOf: string = new Date().toISOString().slice(0, 10),
): Promise<ProductionLossUnitValue[]> {
  const { data, error } = await supabase
    .from("financial_assumptions")
    .select(
      "id, assumption_key, label, value, unit, source, effective_from, review_due",
    )
    .like("assumption_key", `${PRODUCTION_LOSS_VALUE_PREFIX}%`)
    .order("effective_from", { ascending: false })
    .order("id", { ascending: false })
    .returns<AssumptionRow[]>();
  if (error) throw new Error(error.message);
  return operativeProductionLossValues(data ?? [], asOf);
}

export async function recordProductionLossUnitValue(
  input: ProductionLossValueInput,
): Promise<{ version_id: number; assumption_key: string }> {
  const validated = validateProductionLossUnitValue(input);
  if (!validated.ok) throw new Error(validated.reason);
  const { data, error } = await supabase.rpc("upsert_financial_assumption", {
    p_key: validated.key,
    p_label: validated.label,
    p_value: input.valuePerUnit,
    p_unit: validated.unit,
    p_source: input.source.trim(),
    p_kind: "general",
    p_effective_from: input.effectiveFrom?.trim() || null,
    p_review_due: input.reviewDue?.trim() || null,
  });
  if (error) throw new Error(error.message);
  const record = (data ?? {}) as { error?: string; version_id?: number };
  if (typeof record.error === "string") throw new Error(record.error);
  if (typeof record.version_id !== "number") {
    throw new Error("The financial-assumption write returned no version.");
  }
  return { version_id: record.version_id, assumption_key: validated.key };
}
