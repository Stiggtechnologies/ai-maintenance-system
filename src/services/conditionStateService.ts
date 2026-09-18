import { supabase } from "../lib/supabase";

export type ConditionKnowledgeState =
  "known" | "estimated" | "predicted" | "unknown" | "conflicting";

export interface AssetConditionAssessment {
  id: string;
  asset_id: string;
  asset: string;
  knowledge_state: ConditionKnowledgeState;
  assessed_value: number | null;
  value_unit: string | null;
  basis: string;
  evidence_item_ids: string[];
  observed_at: string | null;
  valid_through: string | null;
  status: "draft" | "verified";
  assessed_by: string;
  assessed_at: string;
  verified_by: string | null;
  verified_at: string | null;
  verification_note: string | null;
}

export interface ConditionStateWorkspace {
  states: ConditionKnowledgeState[];
  assessments: AssetConditionAssessment[];
  basis: string;
}

export interface ConditionAssetOption {
  id: string;
  name: string;
  tag: string | null;
}

export interface ConditionEvidenceOption {
  id: string;
  asset_id: string | null;
  description: string;
  verification_status: string;
  ts: string;
}

type RpcResult = Record<string, unknown> & { error?: string };

function assertResult<T extends RpcResult>(
  data: T | null,
  error: { message: string } | null,
  action: string,
): T {
  if (error) throw new Error(`${action}: ${error.message}`);
  if (!data) throw new Error(`${action}: no response`);
  if (typeof data.error === "string" && data.error) {
    throw new Error(`${action}: ${data.error}`);
  }
  return data;
}

export async function getConditionStateWorkspace(): Promise<ConditionStateWorkspace> {
  const { data, error } = await supabase.rpc("get_asset_condition_states");
  return assertResult(
    data as ConditionStateWorkspace & RpcResult,
    error,
    "Could not load condition knowledge states",
  );
}

export async function listConditionAssets(): Promise<ConditionAssetOption[]> {
  const { data, error } = await supabase
    .from("assets")
    .select("id,name,tag")
    .order("name")
    .returns<ConditionAssetOption[]>();
  if (error) throw new Error(`Could not load assets: ${error.message}`);
  return data ?? [];
}

export async function listConditionEvidence(
  assetId: string,
): Promise<ConditionEvidenceOption[]> {
  const { data, error } = await supabase
    .from("evidence_items")
    .select("id,asset_id,description,verification_status,ts")
    .or(`asset_id.eq.${assetId},asset_id.is.null`)
    .order("ts", { ascending: false })
    .limit(50)
    .returns<ConditionEvidenceOption[]>();
  if (error) throw new Error(`Could not load evidence: ${error.message}`);
  return data ?? [];
}

export async function recordAssetConditionState(input: {
  assetId: string;
  knowledgeState: ConditionKnowledgeState;
  basis: string;
  assessedValue: number | null;
  valueUnit: string | null;
  evidenceItemIds: string[];
  observedAt: string | null;
  validThrough: string | null;
}): Promise<RpcResult> {
  const { data, error } = await supabase.rpc("record_asset_condition_state", {
    p_asset_id: input.assetId,
    p_knowledge_state: input.knowledgeState,
    p_basis: input.basis,
    p_assessed_value: input.assessedValue,
    p_value_unit: input.valueUnit,
    p_evidence_item_ids: input.evidenceItemIds,
    p_observed_at: input.observedAt,
    p_valid_through: input.validThrough,
  });
  return assertResult(
    data as RpcResult | null,
    error,
    "Could not record condition state",
  );
}

export async function verifyAssetConditionState(
  assessmentId: string,
  decision: "verified" | "superseded",
  note: string,
): Promise<RpcResult> {
  const { data, error } = await supabase.rpc("verify_asset_condition_state", {
    p_assessment_id: assessmentId,
    p_decision: decision,
    p_note: note,
  });
  return assertResult(
    data as RpcResult | null,
    error,
    "Could not review condition state",
  );
}
