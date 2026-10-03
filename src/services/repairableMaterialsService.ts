import { supabase } from "../lib/supabase";

type RpcEnvelope = { error?: unknown };

async function callRpc<T>(
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  const body = data as (T & RpcEnvelope) | null;
  if (body && typeof body.error === "string") throw new Error(body.error);
  if (body == null) throw new Error(`${name} returned nothing`);
  return body;
}

export type RepairableClassification =
  "unknown" | "consumable" | "repairable" | "rotable";
export type MaterialCriticality = "critical" | "essential" | "routine";

export interface CatalogueMaterial {
  id: string;
  material_code: string;
  description: string;
  category: string | null;
  unit_of_measure: string;
  unit_cost_usd: number | null;
  lead_time_days: number | null;
  min_qty: number | null;
  max_qty: number | null;
  repairable_classification: RepairableClassification;
  criticality: MaterialCriticality | null;
  source_system: string | null;
  basis: string | null;
  master_version: number;
}

export interface CatalogueMaterialInput {
  materialId?: string | null;
  materialCode: string;
  description: string;
  category?: string | null;
  unitOfMeasure: string;
  unitCostUsd?: number | null;
  leadTimeDays?: number | null;
  minimumQuantity?: number | null;
  maximumQuantity?: number | null;
  repairableClassification: RepairableClassification;
  criticality?: MaterialCriticality | null;
  sourceSystem: string;
  basis: string;
  expectedVersion?: number | null;
}

export async function listCatalogueMaterials(): Promise<CatalogueMaterial[]> {
  const rows: CatalogueMaterial[] = [];
  let cursor: string | null = null;
  for (;;) {
    let query = supabase
      .from("materials")
      .select(
        "id, material_code, description, category, unit_of_measure, unit_cost_usd, lead_time_days, min_qty, max_qty, repairable_classification, criticality, source_system, basis, master_version",
      )
      .eq("is_template", false)
      .order("id")
      .limit(500);
    if (cursor) query = query.gt("id", cursor);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const page = (data ?? []) as CatalogueMaterial[];
    if (!page.length) break;
    rows.push(...page);
    const next = page[page.length - 1].id;
    if (next === cursor)
      throw new Error("Material catalogue pagination stalled.");
    cursor = next;
  }
  return rows.sort((a, b) => a.material_code.localeCompare(b.material_code));
}

export async function upsertCatalogueMaterial(
  input: CatalogueMaterialInput,
): Promise<{
  materialId: string;
  materialCode: string;
  masterVersion: number;
  repairableClassification: RepairableClassification;
  operationalAuthorization: false;
}> {
  return callRpc("upsert_catalogue_material", {
    p_material_id: input.materialId ?? null,
    p_material_code: input.materialCode.trim(),
    p_description: input.description.trim(),
    p_category: input.category?.trim() || null,
    p_unit_of_measure: input.unitOfMeasure.trim(),
    p_unit_cost_usd: input.unitCostUsd ?? null,
    p_lead_time_days: input.leadTimeDays ?? null,
    p_min_qty: input.minimumQuantity ?? null,
    p_max_qty: input.maximumQuantity ?? null,
    p_repairable_classification: input.repairableClassification,
    p_criticality: input.criticality ?? null,
    p_source_system: input.sourceSystem.trim(),
    p_basis: input.basis.trim(),
    p_expected_version: input.expectedVersion ?? null,
  });
}

export type RepairableUnitState =
  | "available"
  | "installed"
  | "removed"
  | "in_repair"
  | "quarantined"
  | "scrapped";

export type RepairableUnitEventType =
  | "registered"
  | "installed"
  | "removed"
  | "sent_for_repair"
  | "received_from_repair"
  | "quarantined"
  | "released_from_quarantine"
  | "scrapped";

export interface RepairableUnitEvent {
  id: number;
  sequence: number;
  eventType: RepairableUnitEventType;
  fromState: RepairableUnitState | null;
  toState: RepairableUnitState;
  occurredAt: string;
  componentInstanceId: string | null;
  workOrderId: string | null;
  supplierId: number | null;
  meterHours: number | null;
  repairCostUsd: number | null;
  repairOrderRef: string | null;
  evidenceRef: string | null;
  sourceSystem: string;
  basis: string;
  actor: string | null;
}

export interface RepairableUnit {
  id: string;
  materialId: string;
  materialCode: string;
  description: string;
  classification: "repairable" | "rotable";
  serialNumber: string;
  currentState: RepairableUnitState;
  version: number;
  sourceSystem: string;
  sourceRef: string | null;
  basis: string;
  registeredAt: string;
  currentComponentInstanceId: string | null;
  currentAssetId: string | null;
  currentAsset: string | null;
  currentComponent: string | null;
  currentPosition: string | null;
  repairTurnaroundHours: number | null;
  turnaroundBasis: string;
  events: RepairableUnitEvent[];
}

export interface RepairableUnitRegisterPayload {
  units: RepairableUnit[];
  materials: Array<{
    id: string;
    materialCode: string;
    description: string;
    classification: "repairable" | "rotable";
    masterVersion: number;
    leadTimeDays: number | null;
    criticality: MaterialCriticality | null;
    stockRows: number;
    bomRows: number;
  }>;
  assets: Array<{ id: string; tag: string | null; name: string }>;
  suppliers: Array<{ id: number; code: string; name: string }>;
  authority: string;
}

export async function getRepairableUnitRegister() {
  return callRpc<RepairableUnitRegisterPayload>("get_repairable_unit_register");
}

export async function registerRepairableUnit(input: {
  materialId: string;
  serialNumber: string;
  sourceSystem: string;
  sourceRef?: string | null;
  basis: string;
}) {
  return callRpc<{
    repairableUnitId: string;
    version: number;
    currentState: "available";
    operationalAuthorization: false;
  }>("register_repairable_unit", {
    p_material_id: input.materialId,
    p_serial_number: input.serialNumber.trim(),
    p_source_system: input.sourceSystem.trim(),
    p_basis: input.basis.trim(),
    p_source_ref: input.sourceRef?.trim() || null,
  });
}

export async function recordRepairableUnitEvent(input: {
  repairableUnitId: string;
  eventType: Exclude<RepairableUnitEventType, "registered">;
  occurredAt: string;
  basis: string;
  expectedVersion: number;
  sourceSystem: string;
  assetId?: string | null;
  component?: string | null;
  position?: string | null;
  meterHours?: number | null;
  workOrderId?: string | null;
  supplierId?: number | null;
  repairCostUsd?: number | null;
  repairOrderRef?: string | null;
  evidenceRef?: string | null;
}) {
  return callRpc<{
    repairableUnitId: string;
    eventType: RepairableUnitEventType;
    currentState: RepairableUnitState;
    version: number;
    sequence: number;
    operationalAuthorization: false;
  }>("record_repairable_unit_event", {
    p_repairable_unit_id: input.repairableUnitId,
    p_event_type: input.eventType,
    p_occurred_at: input.occurredAt,
    p_basis: input.basis.trim(),
    p_expected_version: input.expectedVersion,
    p_source_system: input.sourceSystem.trim(),
    p_asset_id: input.assetId ?? null,
    p_component: input.component?.trim() || null,
    p_position: input.position?.trim() || null,
    p_meter_hours: input.meterHours ?? null,
    p_work_order_id: input.workOrderId?.trim() || null,
    p_supplier_id: input.supplierId ?? null,
    p_repair_cost_usd: input.repairCostUsd ?? null,
    p_repair_order_ref: input.repairOrderRef?.trim() || null,
    p_evidence_ref: input.evidenceRef?.trim() || null,
  });
}
