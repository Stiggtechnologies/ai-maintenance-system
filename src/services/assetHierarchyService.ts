import { supabase } from "../lib/supabase";

export type PhysicalHierarchyLevel =
  "assembly" | "maintainable_item" | "component";

export interface AssetHierarchyComponent {
  id: string;
  name: string;
  type: string | null;
  level: PhysicalHierarchyLevel;
  parentComponentId: string | null;
  basis: string | null;
  evidenceItemId: string | null;
  recordedAt: string | null;
}

export interface AssetHierarchyFailureMode {
  id: string;
  failureMode: string;
  mechanism: string | null;
  componentId: string | null;
  basis: string | null;
  evidenceItemId: string | null;
  recordedAt: string | null;
}

export interface AssetHierarchyAsset {
  id: string;
  tag: string | null;
  name: string;
  enterprise: string;
  service: string | null;
  serviceStatus: string | null;
  system: string | null;
  location: string | null;
  functionalLocation: string | null;
  complete: boolean;
  gaps: string[];
  components: AssetHierarchyComponent[];
  failureModes: AssetHierarchyFailureMode[];
}

export interface AssetHierarchyEvidence {
  id: string;
  assetId: string | null;
  description: string;
  evidenceClass: string | null;
  sourceSystem: string | null;
}

export interface AssetHierarchyWorkspace {
  summary: {
    assets: number;
    completePaths: number;
    boundedAt: number;
    basis: string;
  };
  assets: AssetHierarchyAsset[];
  evidence: AssetHierarchyEvidence[];
  authority: string;
}

type RpcResult = Record<string, unknown> & { error?: string };

function resultOrThrow(data: unknown, label: string): RpcResult {
  const result = data as RpcResult | null;
  if (!result) throw new Error(`${label}: no response`);
  if (typeof result.error === "string" && result.error) {
    throw new Error(`${label}: ${result.error}`);
  }
  return result;
}

export async function getAssetHierarchyWorkspace(): Promise<AssetHierarchyWorkspace> {
  const { data, error } = await supabase.rpc(
    "get_canonical_asset_hierarchy_workspace",
  );
  if (error)
    throw new Error(`Could not load asset hierarchy: ${error.message}`);
  return resultOrThrow(
    data,
    "Could not load asset hierarchy",
  ) as unknown as AssetHierarchyWorkspace;
}

export async function recordComponentHierarchyNode(input: {
  assetId: string;
  componentId?: string | null;
  name: string;
  type?: string | null;
  hierarchyLevel: PhysicalHierarchyLevel;
  parentComponentId?: string | null;
  basis: string;
  evidenceItemId: string;
}): Promise<RpcResult> {
  const { data, error } = await supabase.rpc(
    "record_component_hierarchy_node",
    {
      p_asset_id: input.assetId,
      p_component_id: input.componentId ?? null,
      p_name: input.name,
      p_type: input.type ?? null,
      p_hierarchy_level: input.hierarchyLevel,
      p_parent_component_id: input.parentComponentId ?? null,
      p_basis: input.basis,
      p_evidence_item_id: input.evidenceItemId,
    },
  );
  if (error)
    throw new Error(`Could not record hierarchy node: ${error.message}`);
  return resultOrThrow(data, "Could not record hierarchy node");
}

export async function bindFailureModeToComponent(input: {
  failureModeId: string;
  componentId: string;
  basis: string;
  evidenceItemId: string;
}): Promise<RpcResult> {
  const { data, error } = await supabase.rpc("bind_failure_mode_to_component", {
    p_failure_mode_id: input.failureModeId,
    p_component_id: input.componentId,
    p_basis: input.basis,
    p_evidence_item_id: input.evidenceItemId,
  });
  if (error) {
    throw new Error(`Could not bind failure mode: ${error.message}`);
  }
  return resultOrThrow(data, "Could not bind failure mode");
}
