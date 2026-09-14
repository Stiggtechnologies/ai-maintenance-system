import { supabase } from "../lib/supabase";

export type AssetRelationshipType =
  | "owned"
  | "leased"
  | "rented"
  | "concession"
  | "oem_maintained"
  | "third_party"
  | "shared"
  | "ppp"
  | "customer_owned"
  | "supplier_managed";

export type AssetPartyRole =
  | "owner"
  | "operator"
  | "maintainer"
  | "engineering_authority"
  | "risk_owner"
  | "regulator"
  | "insurer"
  | "warranty_provider"
  | "payer";

export interface AssetRelationshipRow {
  asset_id: string;
  asset: string;
  tenure: AssetRelationshipType;
  counterparty_stakeholder_id: string | null;
  counterparty: string | null;
  agreement_reference: string | null;
  maintenance_responsibility: "site" | "counterparty" | "shared" | null;
  history_visible_to_site: boolean;
  strategy_constraint: string | null;
  starts_on: string | null;
  ends_on: string | null;
  evidence_item_ids: string[];
  basis: string | null;
  status: "draft" | "verified";
  recorded_by: string | null;
  recorded_at: string;
  verified_by: string | null;
  verified_at: string | null;
  verification_note: string | null;
}

export interface AssetPartyRoleRow {
  id: string;
  asset_id: string;
  asset: string;
  stakeholder_id: string;
  stakeholder: string;
  party_role: AssetPartyRole;
  responsibility_scope: string;
  agreement_reference: string | null;
  evidence_item_ids: string[];
  effective_from: string;
  effective_to: string | null;
  status: "draft" | "verified";
  assigned_by: string;
  assigned_at: string;
  verified_by: string | null;
  verified_at: string | null;
  verification_note: string | null;
}

export interface AssetRelationshipWorkspace {
  relationship_types: AssetRelationshipType[];
  party_roles: AssetPartyRole[];
  relationships: AssetRelationshipRow[];
  assignments: AssetPartyRoleRow[];
  basis: string;
}

export interface RelationshipStakeholder {
  id: string;
  name: string;
  stakeholder_type: "internal" | "external";
  external_organization: string | null;
  role_or_relationship: string;
}

export async function getAssetRelationshipWorkspace(): Promise<AssetRelationshipWorkspace> {
  const { data, error } = await supabase.rpc(
    "get_asset_relationship_workspace",
  );
  if (error) throw new Error(error.message);
  const payload = data as AssetRelationshipWorkspace & { error?: string };
  if (payload?.error) throw new Error(payload.error);
  return payload;
}

export async function listRelationshipStakeholders(): Promise<
  RelationshipStakeholder[]
> {
  const { data, error } = await supabase
    .from("risk_stakeholders")
    .select(
      "id,name,stakeholder_type,external_organization,role_or_relationship",
    )
    .eq("active", true)
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as RelationshipStakeholder[];
}

function assertRpcResult(
  payload: unknown,
): Record<string, string | boolean | number | null> {
  const result = payload as Record<string, string | boolean | number | null>;
  if (typeof result?.error === "string") throw new Error(result.error);
  return result;
}

export async function recordAssetRelationship(input: {
  assetId: string;
  tenure: AssetRelationshipType;
  relationshipBasis: string;
  counterpartyStakeholderId: string | null;
  agreementReference: string | null;
  maintenanceResponsibility: "site" | "counterparty" | "shared" | null;
  historyVisibleToSite: boolean;
  strategyConstraint: string | null;
  startsOn: string | null;
  endsOn: string | null;
  evidenceItemIds: string[];
}) {
  const { data, error } = await supabase.rpc("record_asset_relationship", {
    p_asset_id: input.assetId,
    p_tenure: input.tenure,
    p_relationship_basis: input.relationshipBasis,
    p_counterparty_stakeholder_id: input.counterpartyStakeholderId,
    p_agreement_reference: input.agreementReference,
    p_maintenance_responsibility: input.maintenanceResponsibility,
    p_history_visible_to_site: input.historyVisibleToSite,
    p_strategy_constraint: input.strategyConstraint,
    p_starts_on: input.startsOn,
    p_ends_on: input.endsOn,
    p_evidence_item_ids: input.evidenceItemIds,
  });
  if (error) throw new Error(error.message);
  return assertRpcResult(data);
}

export async function verifyAssetRelationship(assetId: string, note: string) {
  const { data, error } = await supabase.rpc("verify_asset_relationship", {
    p_asset_id: assetId,
    p_decision: "verified",
    p_note: note,
  });
  if (error) throw new Error(error.message);
  return assertRpcResult(data);
}

export async function recordAssetPartyRole(input: {
  assetId: string;
  stakeholderId: string;
  partyRole: AssetPartyRole;
  responsibilityScope: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  agreementReference: string | null;
  evidenceItemIds: string[];
}) {
  const { data, error } = await supabase.rpc("record_asset_party_role", {
    p_asset_id: input.assetId,
    p_stakeholder_id: input.stakeholderId,
    p_party_role: input.partyRole,
    p_responsibility_scope: input.responsibilityScope,
    p_effective_from: input.effectiveFrom,
    p_effective_to: input.effectiveTo,
    p_agreement_reference: input.agreementReference,
    p_evidence_item_ids: input.evidenceItemIds,
  });
  if (error) throw new Error(error.message);
  return assertRpcResult(data);
}

export async function verifyAssetPartyRole(
  assignmentId: string,
  decision: "verified" | "superseded",
  note: string,
) {
  const { data, error } = await supabase.rpc("verify_asset_party_role", {
    p_assignment_id: assignmentId,
    p_decision: decision,
    p_note: note,
  });
  if (error) throw new Error(error.message);
  return assertRpcResult(data);
}
