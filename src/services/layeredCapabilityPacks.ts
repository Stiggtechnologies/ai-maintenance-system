import { supabase } from "../lib/supabase";

export type CapabilityPackLayerKind =
  | "universal_core"
  | "sector"
  | "jurisdiction"
  | "enterprise"
  | "business_unit"
  | "site"
  | "asset";

export interface CapabilityPackLayer {
  id: string;
  layer_kind: CapabilityPackLayerKind;
  scope_key: string;
  title: string;
  configuration: Record<string, unknown>;
  evidence_basis: string;
  override_diff: Array<{ key: string; inherited: unknown; proposed: unknown }>;
  override_approval_id: string | null;
  approval_status: "required" | "pending" | "approved" | "rejected" | null;
  status: "draft" | "adopted" | "superseded" | "rejected";
  version: number;
  created_by: string;
  adopted_by: string | null;
  adopted_at: string | null;
}

export interface CapabilityPackWorkspace {
  layers: CapabilityPackLayer[];
  sites: Array<{
    id: string;
    name: string;
    organization_node_id: string | null;
  }>;
  assets: Array<{
    id: string;
    name: string;
    site_id: string | null;
    asset_class: string | null;
  }>;
  organization_nodes: Array<{
    id: string;
    name: string;
    org_level: string;
    jurisdiction: string | null;
  }>;
  controls: { precedence: string; override: string; execution: string };
}

export interface ResolvedCapabilityPackStack {
  context: {
    industry_code: string | null;
    jurisdiction: string | null;
    organization_node_id: string | null;
    site_id: string | null;
    asset_id: string | null;
  };
  stack: Array<{
    id: string;
    layer: CapabilityPackLayerKind;
    scope_key: string;
    title: string;
    version: number;
    configuration: Record<string, unknown>;
    evidence_basis: string;
    override_count: number;
    adopted_at: string;
  }>;
  effective_configuration: Record<string, unknown>;
  value_sources: Record<
    string,
    { layer_id: string; layer: CapabilityPackLayerKind; title: string; value: unknown }
  >;
  missing_layers: CapabilityPackLayerKind[];
  authority: string;
}

async function rpc<T>(name: string, args: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  const result = data as T & { error?: string };
  if (result?.error) throw new Error(result.error);
  return result;
}

export function getCapabilityPackWorkspace() {
  return rpc<CapabilityPackWorkspace>("get_capability_pack_workspace", {});
}

export interface CapabilityPackLayerDraft {
  layerKind: CapabilityPackLayerKind;
  title: string;
  industryCode?: string;
  jurisdiction?: string;
  organizationNodeId?: string;
  siteId?: string;
  assetId?: string;
  configuration: Record<string, unknown>;
  evidenceBasis: string;
}

export function authorCapabilityPackLayer(input: CapabilityPackLayerDraft) {
  return rpc<{
    layer_id: string;
    status: "draft";
    version: number;
    override_diff: CapabilityPackLayer["override_diff"];
    approval_id: string | null;
  }>("author_capability_pack_layer", {
    p_layer: {
      layer_kind: input.layerKind,
      title: input.title,
      industry_code: input.industryCode ?? null,
      jurisdiction: input.jurisdiction ?? null,
      organization_node_id: input.organizationNodeId ?? null,
      site_id: input.siteId ?? null,
      asset_id: input.assetId ?? null,
      configuration: input.configuration,
      evidence_basis: input.evidenceBasis,
    },
  });
}

export function decideCapabilityPackOverride(
  layerId: string,
  outcome: "approved" | "rejected",
  note: string,
) {
  return rpc<{ layer_id: string; approval_id: string; status: string }>(
    "decide_capability_pack_override",
    { p_layer_id: layerId, p_outcome: outcome, p_note: note },
  );
}

export function adoptCapabilityPackLayer(layerId: string, note: string) {
  return rpc<{ layer_id: string; status: "adopted" }>(
    "adopt_capability_pack_layer",
    { p_layer_id: layerId, p_note: note },
  );
}

export function resolveCapabilityPackStack(input: {
  assetId?: string;
  siteId?: string;
  organizationNodeId?: string;
  jurisdiction?: string;
  industryCode?: string;
}) {
  return rpc<ResolvedCapabilityPackStack>("resolve_capability_pack_stack", {
    p_asset_id: input.assetId ?? null,
    p_site_id: input.siteId ?? null,
    p_node_id: input.organizationNodeId ?? null,
    p_jurisdiction: input.jurisdiction ?? null,
    p_industry_code: input.industryCode ?? null,
  });
}

export const PACK_AUTHOR_ROLES = [
  "reliability_engineer",
  "maintenance_manager",
  "executive",
  "admin",
] as const;
export const PACK_OVERRIDE_APPROVER_ROLES = ["executive", "admin"] as const;

export function canAuthorPack(role: string | null | undefined) {
  return !!role && (PACK_AUTHOR_ROLES as readonly string[]).includes(role);
}

export function canApprovePackOverride(role: string | null | undefined) {
  return (
    !!role && (PACK_OVERRIDE_APPROVER_ROLES as readonly string[]).includes(role)
  );
}
