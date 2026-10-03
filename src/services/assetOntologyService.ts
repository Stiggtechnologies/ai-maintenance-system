import { supabase } from "../lib/supabase";

export interface OntologyAssetOption {
  id: string;
  name: string;
  tag: string | null;
  asset_class: string | null;
  assignment: {
    class_key: string;
    basis: string | null;
    evidence_item_id: string | null;
    assigned_at: string;
  } | null;
}

export interface OntologyEvidenceOption {
  id: string;
  asset_id: string | null;
  description: string;
  evidence_class: string | null;
  source_system: string | null;
  ts: string;
}

interface AssetRow {
  id: string;
  name: string;
  tag: string | null;
  asset_class: string | null;
}

interface AssignmentRow {
  asset_id: string;
  class_key: string;
  basis: string | null;
  evidence_item_id: string | null;
  assigned_at: string;
}

type RpcResult = Record<string, unknown> & { error?: string };

export async function listOntologyAssets(): Promise<OntologyAssetOption[]> {
  const [assetsResult, assignmentsResult] = await Promise.all([
    supabase
      .from("assets")
      .select("id,name,tag,asset_class")
      .order("name")
      .returns<AssetRow[]>(),
    supabase
      .from("asset_class_assignments")
      .select("asset_id,class_key,basis,evidence_item_id,assigned_at")
      .returns<AssignmentRow[]>(),
  ]);

  if (assetsResult.error) {
    throw new Error(
      `Could not load ontology assets: ${assetsResult.error.message}`,
    );
  }
  if (assignmentsResult.error) {
    throw new Error(
      `Could not load asset classifications: ${assignmentsResult.error.message}`,
    );
  }

  const assignments = new Map(
    (assignmentsResult.data ?? []).map((row) => [row.asset_id, row]),
  );
  return (assetsResult.data ?? []).map((asset) => ({
    ...asset,
    assignment: assignments.get(asset.id) ?? null,
  }));
}

export async function listOntologyEvidence(
  assetId: string,
): Promise<OntologyEvidenceOption[]> {
  const { data, error } = await supabase
    .from("evidence_items")
    .select(
      "id,asset_id,description,evidence_class,source_system,ts,verification_status",
    )
    .eq("verification_status", "verified")
    .in("evidence_class", [
      "MEASURED",
      "INSPECTED",
      "DOCUMENTED",
      "EXPERT_JUDGEMENT",
    ])
    .or(`asset_id.eq.${assetId},asset_id.is.null`)
    .order("ts", { ascending: false })
    .limit(50)
    .returns<
      (OntologyEvidenceOption & { verification_status: "verified" })[]
    >();
  if (error) {
    throw new Error(`Could not load classification evidence: ${error.message}`);
  }
  return (data ?? []) as OntologyEvidenceOption[];
}

export async function assignAssetClassProfile(input: {
  assetId: string;
  classKey: string;
  basis: string;
  evidenceItemId: string;
}): Promise<RpcResult> {
  const { data, error } = await supabase.rpc("assign_asset_class_profile", {
    p_asset_id: input.assetId,
    p_class_key: input.classKey,
    p_basis: input.basis,
    p_evidence_item_id: input.evidenceItemId,
  });
  if (error) {
    throw new Error(`Could not assign asset class: ${error.message}`);
  }
  const result = data as RpcResult | null;
  if (!result) throw new Error("Could not assign asset class: no response");
  if (typeof result.error === "string" && result.error) {
    throw new Error(`Could not assign asset class: ${result.error}`);
  }
  return result;
}
