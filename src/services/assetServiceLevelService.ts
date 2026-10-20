import { supabase } from "../lib/supabase";
import { recordServiceLevelCommandTarget, verifyServiceLevelCommandTarget, type ServiceLevelCommandTarget } from "./assetServiceLevelCommands";
export type { ServiceLevelCommandTarget } from "./assetServiceLevelCommands";

export type ServiceConsequenceClass =
  | "safety"
  | "environmental"
  | "regulatory"
  | "customer"
  | "production"
  | "financial";

export interface ServiceLevelAsset {
  id: string;
  tag: string | null;
  name: string;
}

export interface ServiceLevelEvidence {
  id: string;
  asset_id: string | null;
  description: string;
  source_system: string;
  evidence_class: string;
}

export interface ServiceLevelHistory {
  id: string;
  created_at: string;
  entity_type: string;
  actor: string;
  previous_state: Record<string, unknown> | null;
  new_state: Record<string, unknown>;
  event_data: Record<string, unknown>;
  approval_reference: string | null;
}

export interface AssetServiceLevel {
  asset_id: string;
  service_name: string;
  beneficiary: string | null;
  tolerable_downtime_hours: number | null;
  consequence_class: ServiceConsequenceClass | null;
  restoration_rank: number | null;
  notes: string | null;
  basis: string | null;
  evidence_item_id: string | null;
  status: "draft" | "verified" | "superseded";
  version: number;
  recorded_by: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  updated_at: string;
  analysis_eligible: boolean;
}

export interface RecordAssetServiceLevelInput {
  assetId: string;
  serviceName: string;
  beneficiary: string;
  tolerableDowntimeHours: number | null;
  consequenceClass: ServiceConsequenceClass;
  restorationRank: number | null;
  notes: string;
  basis: string;
  evidenceItemId: string;
  expectedVersion: number | null;
  commandId: string;
  observedActorId: string;
  observedOrganizationId: string;
}

/** A controlled server refusal is different from an uncertain transport result. */
export class ServiceLevelRefusal extends Error {}

export interface ServiceLevelScope { actorId: string; organizationId: string }

function rpcResult(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Missing or malformed acknowledgement");
  const value = data as Record<string, unknown>;
  return value;
}

function boundReceipt(data: unknown, commandId: string, scope: ServiceLevelScope, target: ServiceLevelCommandTarget, allowUnknown = false) {
  const value = rpcResult(data);
  if (value.command_id !== commandId || value.actor_id !== scope.actorId || value.organization_id !== scope.organizationId) throw new Error("Uncertain acknowledgement: command or observed context mismatch");
  if (value.outcome === "refused" && Object.keys(value).length === 5 && typeof value.error === "string" && value.error.trim()) throw new ServiceLevelRefusal(value.error);
  if (allowUnknown && value.outcome === "unknown" && Object.keys(value).length === 4) return value;
  if (value.outcome !== "committed" || value.asset_id !== target.assetId || value.operation !== target.operation || value.status !== target.status || !Number.isSafeInteger(value.version) || value.version !== target.version) throw new Error("Uncertain acknowledgement: incomplete or mismatched committed receipt");
  const request = value.request;
  if (!request || typeof request !== "object" || Array.isArray(request) || Object.keys(request).length !== Object.keys(target.request).length || Object.entries(target.request).some(([key, expected]) => (request as Record<string, unknown>)[key] !== expected)) throw new Error("Uncertain acknowledgement: original request identity mismatch");
  return value;
}

async function editorRows(scope: ServiceLevelScope, section: "assets" | "levels" | "evidence" | "history", assetId: string | null = null): Promise<unknown[]> {
  const { data, error } = await supabase.rpc("get_asset_service_level_editor", {
    p_observed_actor_id: scope.actorId,
    p_observed_organization_id: scope.organizationId,
    p_section: section,
    p_asset_id: assetId,
  });
  if (error) throw new Error(error.message);
  const value = rpcResult(data);
  if (Object.keys(value).length === 1 && typeof value.error === "string" && value.error.trim()) throw new ServiceLevelRefusal(value.error);
  if (value.actor_id !== scope.actorId || value.organization_id !== scope.organizationId || value.section !== section || !Array.isArray(value.rows)) throw new Error("Read acknowledgement does not match observed context");
  return value.rows;
}

export async function listServiceLevelAssets(scope: ServiceLevelScope): Promise<ServiceLevelAsset[]> {
  return await editorRows(scope, "assets") as ServiceLevelAsset[];
}

export async function listAssetServiceLevels(scope: ServiceLevelScope): Promise<AssetServiceLevel[]> {
  return await editorRows(scope, "levels") as AssetServiceLevel[];
}

export async function listServiceLevelEvidence(
  assetId: string,
  scope: ServiceLevelScope,
): Promise<ServiceLevelEvidence[]> {
  return await editorRows(scope, "evidence", assetId) as ServiceLevelEvidence[];
}

export async function listServiceLevelHistory(assetId: string, scope: ServiceLevelScope): Promise<ServiceLevelHistory[]> {
  return await editorRows(scope, "history", assetId) as ServiceLevelHistory[];
}

export async function recordAssetServiceLevel(
  input: RecordAssetServiceLevelInput,
) {
  const target = recordServiceLevelCommandTarget(input);
  const { data, error } = await supabase.rpc("record_asset_service_level", target.request);
  if (error) throw new Error(error.message);
  return boundReceipt(data, input.commandId, { actorId: input.observedActorId, organizationId: input.observedOrganizationId }, target);
}

export async function verifyAssetServiceLevel(
  assetId: string,
  expectedVersion: number,
  reviewNote: string,
  commandId: string,
  scope: ServiceLevelScope,
) {
  const target = verifyServiceLevelCommandTarget(assetId, expectedVersion, reviewNote, commandId, scope);
  const { data, error } = await supabase.rpc("verify_asset_service_level", target.request);
  if (error) throw new Error(error.message);
  return boundReceipt(data, commandId, scope, target);
}

/** Read the ONE canonical audit receipt; never repeat the command. Absence is not proof of rollback. */
export async function reconcileAssetServiceLevelCommand(commandId: string, scope: ServiceLevelScope, target: ServiceLevelCommandTarget) {
  const { data, error } = await supabase.rpc("get_asset_service_level_command", {
    p_command_id: commandId,
    p_observed_actor_id: scope.actorId,
    p_observed_organization_id: scope.organizationId,
  });
  if (error) throw new Error(error.message);
  return boundReceipt(data, commandId, scope, target, true);
}
