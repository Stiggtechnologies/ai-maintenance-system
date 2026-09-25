/**
 * Product callers for MRO reserve / kit / issue (C6.11, C6.15).
 *
 * reserve_wo_materials and record_material_event shipped in 20260809180000
 * with zero product callers, so ready backlog stayed permanently 0% and
 * waiting-on-material never matched a satisfaction event. This module is
 * the write path a planner or stores person can walk.
 *
 * Human owns the act. A reservation is not authorization to start work.
 * No stock record is unassessable — not a shortage, not ready.
 */
import { supabase } from "../lib/supabase";

interface RpcErrorShape {
  error?: unknown;
}

async function callRpc<T>(
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  const body = data as (T & RpcErrorShape) | null;
  if (body && typeof body.error === "string") {
    throw new Error(body.error);
  }
  if (body == null) throw new Error(`${name} returned nothing`);
  return body;
}

export type MaterialLineStatus =
  "requested" | "reserved" | "kitted" | "issued" | "short" | "cancelled";

export interface MaterialDemandLine {
  id: string;
  work_order_id: string;
  material_id: string;
  qty_required: number;
  qty_reserved: number;
  qty_issued: number;
  status: MaterialLineStatus;
  needed_by: string | null;
  material_code: string | null;
  description: string | null;
  wo_number: string | null;
  wo_title: string | null;
}

interface EmbeddedRef {
  material_code?: string;
  description?: string;
  wo_number?: string | null;
  title?: string | null;
}

function embedOne<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function flattenLine(row: {
  id: string;
  work_order_id: string;
  material_id: string;
  qty_required: number;
  qty_reserved: number;
  qty_issued: number;
  status: MaterialLineStatus;
  needed_by: string | null;
  materials?: EmbeddedRef | EmbeddedRef[] | null;
  work_orders?: EmbeddedRef | EmbeddedRef[] | null;
}): MaterialDemandLine {
  const material = embedOne(row.materials);
  const workOrder = embedOne(row.work_orders);
  return {
    id: row.id,
    work_order_id: row.work_order_id,
    material_id: row.material_id,
    qty_required: row.qty_required,
    qty_reserved: row.qty_reserved,
    qty_issued: row.qty_issued,
    status: row.status,
    needed_by: row.needed_by,
    material_code: material?.material_code ?? null,
    description: material?.description ?? null,
    wo_number: workOrder?.wo_number ?? null,
    wo_title: workOrder?.title ?? null,
  };
}

const LINE_SELECT =
  "id, work_order_id, material_id, qty_required, qty_reserved, qty_issued, status, needed_by, materials(material_code, description), work_orders(wo_number, title)";

export async function listMaterialDemand(
  workOrderId?: string,
): Promise<MaterialDemandLine[]> {
  let query = supabase.from("work_order_materials").select(LINE_SELECT);
  query = workOrderId
    ? query.eq("work_order_id", workOrderId)
    : query.in("status", ["requested", "reserved", "short", "kitted"]);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return ((data ?? []) as Parameters<typeof flattenLine>[0][]).map(flattenLine);
}

export interface ReserveMaterialsResult {
  reserved_lines: number;
  short_lines: number;
  lines_without_stock_records: number;
}

export async function reserveWoMaterials(
  workOrderId: string,
): Promise<ReserveMaterialsResult> {
  return callRpc<ReserveMaterialsResult>("reserve_wo_materials", {
    p_work_order_id: workOrderId,
  });
}

export type MaterialEventType =
  "kitted" | "issued" | "cancelled" | "ordered" | "received" | "returned";

export interface RecordMaterialEventResult {
  recorded: string;
  line: string;
}

export async function recordMaterialEvent(
  workOrderMaterialId: string,
  eventType: MaterialEventType,
  qty?: number | null,
  note?: string | null,
): Promise<RecordMaterialEventResult> {
  return callRpc<RecordMaterialEventResult>("record_material_event", {
    p_work_order_material_id: workOrderMaterialId,
    p_event_type: eventType,
    p_qty: qty ?? null,
    p_note: note ?? null,
  });
}

export function describeReserveResult(result: ReserveMaterialsResult): string {
  return (
    `Reserved ${result.reserved_lines} line(s). ${result.short_lines} short. ` +
    `${result.lines_without_stock_records} without a stock record — not a shortage, not ready.`
  );
}

export function canKit(status: MaterialLineStatus): boolean {
  return status === "reserved";
}

export function canIssue(status: MaterialLineStatus): boolean {
  return status === "reserved" || status === "kitted";
}

export function canReserve(status: MaterialLineStatus): boolean {
  return status === "requested" || status === "short";
}

/** Enums enforced by upsert_material_stock_lot. Not engineering limits. */
export const MATERIAL_LOT_CONDITIONS = [
  "serviceable",
  "inspection_required",
  "unserviceable",
  "unknown",
] as const;

export const MATERIAL_LOT_CERTIFICATIONS = [
  "not_required",
  "valid",
  "missing",
  "expired",
  "unknown",
] as const;

export const MATERIAL_SUBSTITUTION_TYPES = [
  "approved_alternate",
  "repairable_exchange",
  "temporary_engineering_substitution",
] as const;

export const MATERIAL_SUBSTITUTION_STATUSES = [
  "pending",
  "approved",
  "rejected",
] as const;

export type MaterialLotCondition = (typeof MATERIAL_LOT_CONDITIONS)[number];
export type MaterialLotCertification =
  (typeof MATERIAL_LOT_CERTIFICATIONS)[number];
export type MaterialSubstitutionType =
  (typeof MATERIAL_SUBSTITUTION_TYPES)[number];
export type MaterialSubstitutionStatus =
  (typeof MATERIAL_SUBSTITUTION_STATUSES)[number];

export interface MaterialLotRow {
  id: string;
  lot_ref: string;
  qty: number;
  condition: string;
  certification_status: string;
  source_system: string;
  basis: string;
  material_code: string | null;
  description: string | null;
}

export interface LotFormOptions {
  materials: Array<{ id: string; material_code: string; description: string }>;
  sites: Array<{ id: string; name: string }>;
}

/**
 * Lot condition and certification already stored for this tenant.
 * Writes stay on upsert_material_stock_lot; this is the read the kitting
 * desk was missing while recovery parts-risk already joined the table.
 */
export async function listMaterialStockLots(): Promise<MaterialLotRow[]> {
  const { data, error } = await supabase
    .from("material_stock_lots")
    .select(
      "id, lot_ref, qty, condition, certification_status, source_system, basis, materials(material_code, description)",
    )
    .order("updated_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<{
    id: string;
    lot_ref: string;
    qty: number;
    condition: string;
    certification_status: string;
    source_system: string;
    basis: string;
    materials?:
      | { material_code?: string; description?: string }
      | { material_code?: string; description?: string }[]
      | null;
  }>).map((row) => {
    const material = embedOne(row.materials);
    return {
      id: row.id,
      lot_ref: row.lot_ref,
      qty: row.qty,
      condition: row.condition,
      certification_status: row.certification_status,
      source_system: row.source_system,
      basis: row.basis,
      material_code: material?.material_code ?? null,
      description: material?.description ?? null,
    };
  });
}

export async function listLotFormOptions(): Promise<LotFormOptions> {
  const [materials, sites] = await Promise.all([
    supabase
      .from("materials")
      .select("id, material_code, description")
      .eq("is_template", false)
      .order("material_code")
      .limit(200),
    supabase.from("sites").select("id, name").order("name").limit(100),
  ]);
  if (materials.error) throw new Error(materials.error.message);
  if (sites.error) throw new Error(sites.error.message);
  return {
    materials: (materials.data ?? []) as LotFormOptions["materials"],
    sites: (sites.data ?? []) as LotFormOptions["sites"],
  };
}

export async function recordMaterialStockLot(input: {
  materialId: string;
  siteId: string | null;
  lotRef: string;
  qty: number;
  condition: MaterialLotCondition;
  certificationStatus: MaterialLotCertification;
  sourceSystem: string;
  basis: string;
  certificationRef?: string | null;
  location?: string | null;
}): Promise<{ ok?: boolean; stock_lot_id?: string }> {
  return callRpc("upsert_material_stock_lot", {
    p_material_id: input.materialId,
    p_site_id: input.siteId,
    p_lot_ref: input.lotRef,
    p_qty: input.qty,
    p_condition: input.condition,
    p_certification_status: input.certificationStatus,
    p_source_system: input.sourceSystem,
    p_basis: input.basis,
    p_certification_ref: input.certificationRef ?? null,
    p_staged_for_work_order_id: null,
    p_location: input.location ?? null,
    p_expires_at: null,
  });
}

/**
 * Records a substitution proposal. Default the caller to pending: an approved
 * row is a named-role act inside the existing RPC, not an automatic fitment.
 */
export async function recordMaterialSubstitution(input: {
  materialId: string;
  substituteMaterialId: string;
  type: MaterialSubstitutionType;
  status: MaterialSubstitutionStatus;
  basis: string;
  validUntil?: string | null;
}): Promise<{ ok?: boolean; substitution_id?: string; status?: string }> {
  return callRpc("set_material_substitution", {
    p_material_id: input.materialId,
    p_substitute_material_id: input.substituteMaterialId,
    p_type: input.type,
    p_status: input.status,
    p_basis: input.basis,
    p_valid_until: input.validUntil ?? null,
  });
}
