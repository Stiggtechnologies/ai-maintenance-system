import { supabase } from "../lib/supabase";

export type AssetLocationKind =
  "area" | "unit" | "system" | "functional_location";
export type FoundationDecision = "verified" | "rejected";

export interface FoundationEvidence {
  id: string;
  description: string;
  evidenceClass: string | null;
  assetId: string | null;
  verifiedBy: string;
  verifiedAt: string;
  verificationMethod: string;
}

export interface FoundationLocation {
  id: string;
  siteId: string;
  parentLocationId: string | null;
  kind: AssetLocationKind;
  code: string;
  name: string;
  description: string;
  evidenceItemId: string;
  status: "proposed" | FoundationDecision;
  createdBy: string;
  verifiedBy: string | null;
  verifiedAt: string | null;
  reviewNote: string | null;
}

export interface FoundationAsset {
  id: string;
  siteId: string | null;
  tag: string | null;
  name: string;
  criticality: string | null;
  locationId: string | null;
  area: string | null;
  system: string | null;
  functionalLocation: string | null;
  foundationVerificationId: string | null;
  foundationVerifiedBy: string | null;
  foundationVerifiedAt: string | null;
}

export interface FoundationScores {
  safety: number;
  environmental: number;
  production: number;
  financial: number;
  regulatory: number;
}

export interface FoundationBoundary {
  name: string;
  includedEquipment: string[];
  excludedEquipment: string[];
  upstreamInterface: string;
  downstreamInterface: string;
  isolationPoints: string[];
  basis: string;
}

export interface FoundationProposal {
  id: string;
  assetId: string;
  hierarchyLocationId: string;
  scores: FoundationScores;
  criticalityClass: "critical" | "high" | "medium" | "low";
  criticalityBasis: string;
  boundary: FoundationBoundary;
  hierarchyEvidenceItemId: string;
  criticalityEvidenceItemId: string;
  boundaryEvidenceItemId: string;
  status: "proposed" | FoundationDecision;
  revision: number;
  supersedesId: string | null;
  proposedBy: string;
  proposedAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
}

export interface AssetFoundationWorkspace {
  model: {
    dimensions: string[];
    scale: string;
    rule: string;
  };
  sites: Array<{ id: string; name: string }>;
  locations: FoundationLocation[];
  assets: FoundationAsset[];
  proposals: FoundationProposal[];
  verifiedEvidence: FoundationEvidence[];
  authority: {
    namedHumanVerification: boolean;
    segregationOfDuties: boolean;
    mayChangeWork: boolean;
    mayApprove: boolean;
    mayAcceptRisk: boolean;
    mayCommitSpend: boolean;
    mayChangeOperatingLimits: boolean;
    mayReturnToService: boolean;
  };
}

function resultError(value: unknown): string | null {
  if (!value || typeof value !== "object" || !("error" in value)) return null;
  const message = (value as { error?: unknown }).error;
  return typeof message === "string"
    ? message
    : "The governed asset-foundation action failed.";
}

async function governedRpc<T>(
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  const message = resultError(data);
  if (message) throw new Error(message);
  return data as T;
}

export function loadAssetFoundationWorkspace(): Promise<AssetFoundationWorkspace> {
  return governedRpc<AssetFoundationWorkspace>(
    "get_asset_foundation_workspace",
  );
}

export function proposeAssetHierarchyNode(input: {
  siteId: string;
  parentLocationId: string | null;
  kind: AssetLocationKind;
  code: string;
  name: string;
  description: string;
  evidenceItemId: string;
}): Promise<{ locationId: string; status: "proposed" }> {
  return governedRpc("propose_asset_hierarchy_node", {
    p_site_id: input.siteId,
    p_parent_location_id: input.parentLocationId,
    p_location_kind: input.kind,
    p_location_code: input.code,
    p_name: input.name,
    p_description: input.description,
    p_evidence_item_id: input.evidenceItemId,
  });
}

export function reviewAssetHierarchyNode(input: {
  locationId: string;
  decision: FoundationDecision;
  reviewNote: string;
}): Promise<{ locationId: string; status: FoundationDecision }> {
  return governedRpc("review_asset_hierarchy_node", {
    p_location_id: input.locationId,
    p_decision: input.decision,
    p_review_note: input.reviewNote,
  });
}

export function proposeAssetFoundation(input: {
  assetId: string;
  hierarchyLocationId: string;
  scores: FoundationScores;
  criticalityBasis: string;
  boundary: FoundationBoundary;
  hierarchyEvidenceItemId: string;
  criticalityEvidenceItemId: string;
  boundaryEvidenceItemId: string;
}): Promise<{
  verificationId: string;
  status: "proposed";
  revision: number;
  criticalityClass: string;
}> {
  return governedRpc("propose_asset_foundation_verification", {
    p_asset_id: input.assetId,
    p_hierarchy_location_id: input.hierarchyLocationId,
    p_scores: input.scores,
    p_criticality_basis: input.criticalityBasis,
    p_boundary: input.boundary,
    p_hierarchy_evidence_item_id: input.hierarchyEvidenceItemId,
    p_criticality_evidence_item_id: input.criticalityEvidenceItemId,
    p_boundary_evidence_item_id: input.boundaryEvidenceItemId,
  });
}

export function reviewAssetFoundation(input: {
  verificationId: string;
  decision: FoundationDecision;
  reviewNote: string;
}): Promise<{
  verificationId: string;
  status: FoundationDecision;
  assetId: string;
  criticalityClass: string;
  mayChangeWork: false;
  mayApprove: false;
  mayAcceptRisk: false;
  mayCommitSpend: false;
  mayChangeOperatingLimits: false;
  mayReturnToService: false;
}> {
  return governedRpc("review_asset_foundation_verification", {
    p_verification_id: input.verificationId,
    p_decision: input.decision,
    p_review_note: input.reviewNote,
  });
}
