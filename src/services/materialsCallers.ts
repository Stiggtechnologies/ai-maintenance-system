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
