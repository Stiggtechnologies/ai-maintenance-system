import { supabase } from "../lib/supabase";

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
}

function rpcResult(data: unknown) {
  const value = data as Record<string, unknown> & { error?: string };
  if (value?.error) throw new Error(value.error);
  return value;
}

export async function listServiceLevelAssets(): Promise<ServiceLevelAsset[]> {
  const { data, error } = await supabase
    .from("assets")
    .select("id,tag,name")
    .order("name")
    .limit(500);
  if (error) throw new Error(error.message);
  return (data ?? []) as ServiceLevelAsset[];
}

export async function listAssetServiceLevels(): Promise<AssetServiceLevel[]> {
  const { data, error } = await supabase
    .from("asset_service_levels")
    .select(
      "asset_id,service_name,beneficiary,tolerable_downtime_hours,consequence_class,restoration_rank,notes,basis,evidence_item_id,status,version,recorded_by,reviewed_by,reviewed_at,review_note,updated_at",
    )
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as AssetServiceLevel[];
}

export async function listServiceLevelEvidence(
  assetId: string,
): Promise<ServiceLevelEvidence[]> {
  const { data, error } = await supabase
    .from("evidence_items")
    .select("id,asset_id,description,source_system,evidence_class")
    .eq("verification_status", "verified")
    .in("evidence_class", [
      "MEASURED",
      "INSPECTED",
      "CALCULATED",
      "TESTED",
      "DOCUMENTED",
      "HISTORICAL",
      "EXPERT_JUDGEMENT",
    ])
    .or(`asset_id.is.null,asset_id.eq.${assetId}`)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []) as ServiceLevelEvidence[];
}

export async function recordAssetServiceLevel(
  input: RecordAssetServiceLevelInput,
) {
  const { data, error } = await supabase.rpc("record_asset_service_level", {
    p_asset_id: input.assetId,
    p_service_name: input.serviceName,
    p_beneficiary: input.beneficiary,
    p_tolerable_downtime_hours: input.tolerableDowntimeHours,
    p_consequence_class: input.consequenceClass,
    p_restoration_rank: input.restorationRank,
    p_notes: input.notes,
    p_basis: input.basis,
    p_evidence_item_id: input.evidenceItemId,
    p_expected_version: input.expectedVersion,
  });
  if (error) throw new Error(error.message);
  return rpcResult(data);
}

export async function verifyAssetServiceLevel(
  assetId: string,
  expectedVersion: number,
  reviewNote: string,
) {
  const { data, error } = await supabase.rpc("verify_asset_service_level", {
    p_asset_id: assetId,
    p_expected_version: expectedVersion,
    p_review_note: reviewNote,
  });
  if (error) throw new Error(error.message);
  return rpcResult(data);
}
