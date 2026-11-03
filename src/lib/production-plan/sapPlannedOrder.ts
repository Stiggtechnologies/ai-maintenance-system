/**
 * Local reader for a mocked SAP S/4HANA Planned Order document.
 *
 * The shape is the OData entity `A_PlannedOrder` from `API_PLANNED_ORDERS`:
 * PlannedOrder, Material, ProductionPlant, TotalQuantity, BaseUnit,
 * PlndOrderPlannedStartDate / EndDate, and the optional time fields.
 * A date without a time is stored as UTC midnight. A time that is present
 * but not `HH:MM:SS` is refused — it is not dropped.
 *
 * This module never calls a network. The human maps each planned order onto
 * a canonical asset; the parser does not invent that binding.
 */

export interface ParsedSapPlannedOrder {
  plannedOrder: string;
  material: string;
  productionPlant: string;
  totalQuantity: number;
  baseUnit: string;
  windowStart: string;
  windowEnd: string;
}

export type SapParseResult =
  | { ok: true; orders: ParsedSapPlannedOrder[]; canonical: string }
  | { ok: false; error: string };

const IDENTIFIER = /^[A-Za-z0-9._/-]+$/;
const ODATA_DATE = /^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/;
const DATE_ONLY = /^(\d{4}-\d{2}-\d{2})$/;
const CLOCK_TIME = /^([01]\d|2[0-3]):([0-5]\d):([0-5]\d)$/;

export const SAP_PLANNED_ORDER_FIXTURE = {
  d: {
    results: [
      {
        PlannedOrder: "000001234567",
        PlannedOrderType: "LA",
        Material: "FG-100",
        MaterialName: "Finished good 100",
        ProductionPlant: "1000",
        TotalQuantity: "1250.500",
        BaseUnit: "TO",
        PlndOrderPlannedStartDate: "2026-12-01",
        PlndOrderPlannedEndDate: "2026-12-15",
      },
      {
        PlannedOrder: "000001234568",
        Material: "FG-110",
        ProductionPlant: "1000",
        TotalQuantity: "800",
        BaseUnit: "TO",
        PlndOrderPlannedStartDate: "2026-12-05",
        PlndOrderPlannedStartTime: "06:00:00",
        PlndOrderPlannedEndDate: "2026-12-20",
        PlndOrderPlannedEndTime: "18:00:00",
      },
    ],
  },
} as const;

function fail(error: string): SapParseResult {
  return { ok: false, error };
}

function readText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length > 0 ? text : null;
}

function readIdentifier(
  value: unknown,
  label: string,
  max: number,
): { ok: true; value: string } | { ok: false; error: string } {
  const text = readText(value);
  if (text == null || text.length > max || !IDENTIFIER.test(text)) {
    return {
      ok: false,
      error: `${label} must be an explicit SAP identifier of at most ${max} characters`,
    };
  }
  return { ok: true, value: text };
}

function readQuantity(
  value: unknown,
): { ok: true; value: number } | { ok: false; error: string } {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value.trim())
        : Number.NaN;
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return {
      ok: false,
      error: "TotalQuantity must be a positive number; a blank is not zero",
    };
  }
  return { ok: true, value: numeric };
}

function datePart(
  value: unknown,
  field: string,
):
  | { ok: true; date: string; instant: string | null }
  | { ok: false; error: string } {
  const text = readText(value);
  if (text == null) return { ok: false, error: `${field} is required` };
  const odata = ODATA_DATE.exec(text);
  if (odata) {
    const ms = Number(odata[1]);
    if (!Number.isFinite(ms)) {
      return { ok: false, error: `${field} is not a readable SAP date` };
    }
    return { ok: true, date: "", instant: new Date(ms).toISOString() };
  }
  const dateOnly = DATE_ONLY.exec(text);
  if (dateOnly) return { ok: true, date: dateOnly[1], instant: null };
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    return { ok: false, error: `${field} is not a readable SAP date` };
  }
  return { ok: true, date: "", instant: parsed.toISOString() };
}

function combineDateTime(
  dateValue: unknown,
  timeValue: unknown,
  dateField: string,
  timeField: string,
): { ok: true; iso: string } | { ok: false; error: string } {
  const date = datePart(dateValue, dateField);
  if (!date.ok) return date;
  if (date.instant) {
    if (readText(timeValue) != null) {
      return {
        ok: false,
        error: `${timeField} was supplied with a timestamp ${dateField}; SyncAI will not choose which one wins`,
      };
    }
    return { ok: true, iso: date.instant };
  }
  const time = readText(timeValue);
  if (time == null) return { ok: true, iso: `${date.date}T00:00:00.000Z` };
  if (!CLOCK_TIME.test(time)) {
    return {
      ok: false,
      error: `${timeField} is present but is not HH:MM:SS; SyncAI will not drop it`,
    };
  }
  return { ok: true, iso: `${date.date}T${time}.000Z` };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function extractRows(payload: unknown): unknown[] | null {
  if (Array.isArray(payload)) return payload;
  const root = asRecord(payload);
  if (!root) return null;
  const data = asRecord(root.d);
  if (data && Array.isArray(data.results)) return data.results;
  if (data && "PlannedOrder" in data) return [data];
  if ("PlannedOrder" in root) return [root];
  return null;
}

function canonicalDocument(orders: ParsedSapPlannedOrder[]): string {
  return JSON.stringify(
    [...orders]
      .sort((a, b) => a.plannedOrder.localeCompare(b.plannedOrder))
      .map((order) => ({
        BaseUnit: order.baseUnit,
        Material: order.material,
        PlannedOrder: order.plannedOrder,
        PlndOrderPlannedEndDate: order.windowEnd,
        PlndOrderPlannedStartDate: order.windowStart,
        ProductionPlant: order.productionPlant,
        TotalQuantity: order.totalQuantity,
      })),
  );
}

export function parseSapPlannedOrderPayload(payload: unknown): SapParseResult {
  const rows = extractRows(payload);
  if (rows == null) {
    return fail(
      "The document is not an A_PlannedOrder payload. SyncAI does not call SAP to fetch one.",
    );
  }
  if (rows.length === 0) {
    return fail("The SAP planned-order document contains no orders.");
  }
  if (rows.length > 100) {
    return fail("A production plan accepts at most 100 planned orders.");
  }

  const orders: ParsedSapPlannedOrder[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const record = asRecord(row);
    if (!record) return fail("A planned-order row is not an object.");
    const plannedOrder = readIdentifier(
      record.PlannedOrder,
      "PlannedOrder",
      20,
    );
    if (!plannedOrder.ok) return plannedOrder;
    if (seen.has(plannedOrder.value)) {
      return fail(
        `Planned order ${plannedOrder.value} appears more than once; the document was not recorded.`,
      );
    }
    seen.add(plannedOrder.value);
    const material = readIdentifier(record.Material, "Material", 40);
    if (!material.ok) return material;
    const plant = readIdentifier(record.ProductionPlant, "ProductionPlant", 20);
    if (!plant.ok) return plant;
    const quantity = readQuantity(record.TotalQuantity);
    if (!quantity.ok) {
      return fail(`Planned order ${plannedOrder.value}: ${quantity.error}`);
    }
    const unit = readText(record.BaseUnit);
    if (unit == null || unit.length > 3 || /\s/.test(unit)) {
      return fail(
        `Planned order ${plannedOrder.value}: BaseUnit must be the SAP unit of at most 3 characters`,
      );
    }
    const start = combineDateTime(
      record.PlndOrderPlannedStartDate,
      record.PlndOrderPlannedStartTime,
      "PlndOrderPlannedStartDate",
      "PlndOrderPlannedStartTime",
    );
    if (!start.ok) {
      return fail(`Planned order ${plannedOrder.value}: ${start.error}`);
    }
    const end = combineDateTime(
      record.PlndOrderPlannedEndDate,
      record.PlndOrderPlannedEndTime,
      "PlndOrderPlannedEndDate",
      "PlndOrderPlannedEndTime",
    );
    if (!end.ok)
      return fail(`Planned order ${plannedOrder.value}: ${end.error}`);
    if (Date.parse(end.iso) <= Date.parse(start.iso)) {
      return fail(
        `Planned order ${plannedOrder.value}: the end is not after the start. SyncAI will not invent a shift length.`,
      );
    }
    orders.push({
      plannedOrder: plannedOrder.value,
      material: material.value,
      productionPlant: plant.value,
      totalQuantity: quantity.value,
      baseUnit: unit,
      windowStart: start.iso,
      windowEnd: end.iso,
    });
  }

  return { ok: true, orders, canonical: canonicalDocument(orders) };
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
