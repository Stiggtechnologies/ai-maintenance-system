import { supabase } from "../lib/supabase";

export interface Spec34RelationshipWorkspace {
  caseId: string;
  objective: { id: string; description: string; status: string } | null;
  assets: Array<{ id: string; name: string; tag: string | null }>;
  contracts: Array<{
    id: number;
    packageCode: string;
    title: string;
    awarded: boolean;
  }>;
  contractProvidesAsset: Array<{
    id: string;
    contractPackageId: number;
    packageCode: string;
    assetId: string;
    asset: string;
    evidenceItemId: string;
    basis: string;
  }>;
  assetSupportsObjective: Array<{
    id: string;
    assetId: string;
    asset: string;
    objectiveId: string;
    objective: string;
    evidenceItemId: string;
    basis: string;
  }>;
  decisionBoundary: string;
}

function unwrap<T>(data: T | null, error: { message: string } | null): T {
  if (error) throw new Error(error.message);
  const payload = data as T & { error?: string };
  if (payload?.error) throw new Error(payload.error);
  if (!data) throw new Error("The core graph relationship read returned no result");
  return data;
}

export async function getCaseSpec34Relationships(caseId: string) {
  const { data, error } = await supabase.rpc("get_case_spec34_relationships", {
    p_case_id: caseId,
  });
  return unwrap<Spec34RelationshipWorkspace>(data, error);
}

export async function linkContractToAsset(input: {
  caseId: string;
  contractPackageId: number;
  assetId: string;
  evidenceItemId: string;
  basis: string;
}) {
  const { data, error } = await supabase.rpc("link_contract_to_asset", {
    p_case_id: input.caseId,
    p_contract_package_id: input.contractPackageId,
    p_asset_id: input.assetId,
    p_evidence_item_id: input.evidenceItemId,
    p_basis: input.basis,
  });
  return unwrap<{ linkId: string; edge: string }>(data, error);
}

export async function linkAssetToObjective(input: {
  caseId: string;
  assetId: string;
  objectiveId: string;
  evidenceItemId: string;
  basis: string;
}) {
  const { data, error } = await supabase.rpc("link_asset_to_objective", {
    p_case_id: input.caseId,
    p_asset_id: input.assetId,
    p_objective_id: input.objectiveId,
    p_evidence_item_id: input.evidenceItemId,
    p_basis: input.basis,
  });
  return unwrap<{ linkId: string; edge: string }>(data, error);
}
