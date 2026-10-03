import { supabase } from "../lib/supabase";

export const ORGANIZATION_LEVELS = [
  "enterprise",
  "business_unit",
  "site",
  "area",
  "system",
] as const;

export type OrganizationLevel = (typeof ORGANIZATION_LEVELS)[number];

export interface GovernanceProfileSummary {
  id: string;
  name: string;
  version: number;
  status?: string;
  sourceAuthority?: string;
  sourceNodeId?: string;
  sourceNodeName?: string;
  sourceDepth?: number;
}

export interface OrganizationGovernanceNode {
  id: string;
  name: string;
  orgLevel: OrganizationLevel;
  parentId: string | null;
  jurisdiction: string | null;
  depth: number;
  attachedProfile: GovernanceProfileSummary | null;
  resolvedProfile: GovernanceProfileSummary | null;
}

export interface AdoptedGovernanceFramework {
  id: string;
  name: string;
  version: number;
  sourceAuthority: string;
  organizationId: string;
  organizationName: string;
  eligibleNodeIds: string[];
}

export interface OrganizationGovernanceWorkspace {
  root: {
    id: string;
    name: string;
    industry: string | null;
    orgLevel: OrganizationLevel;
    jurisdiction: string | null;
  };
  nodes: OrganizationGovernanceNode[];
  frameworks: AdoptedGovernanceFramework[];
  actorRole: string | null;
  canManage: boolean;
  governance: {
    writes: string;
    inheritance: string;
    automation: string;
  };
}

interface RpcPayload {
  error?: unknown;
  [key: string]: unknown;
}

function unwrap<T>(
  data: unknown,
  error: { message: string } | null,
  fallback: string,
): T {
  if (error) throw new Error(error.message);
  const payload = data as RpcPayload | null;
  if (payload && payload.error) throw new Error(String(payload.error));
  if (!payload) throw new Error(fallback);
  return payload as T;
}

export async function getOrganizationGovernanceWorkspace(): Promise<OrganizationGovernanceWorkspace> {
  const { data, error } = await supabase.rpc(
    "get_organization_governance_workspace",
  );
  return unwrap<OrganizationGovernanceWorkspace>(
    data,
    error,
    "Organization governance workspace returned no data.",
  );
}

export async function createSubOrganization(input: {
  name: string;
  orgLevel: OrganizationLevel;
  parentId: string;
  jurisdiction?: string | null;
}): Promise<{
  node_id: string;
  org_level: OrganizationLevel;
  parent_id: string;
}> {
  const { data, error } = await supabase.rpc("create_sub_organization", {
    p_name: input.name,
    p_node_level: input.orgLevel,
    p_parent_node_id: input.parentId,
    p_jurisdiction: input.jurisdiction ?? null,
  });
  return unwrap(data, error, "Organization node was not created.");
}

export async function updateOrganizationNode(input: {
  nodeId: string;
  orgLevel?: OrganizationLevel | null;
  jurisdiction?: string | null;
}): Promise<{ node_id: string; org_level: OrganizationLevel }> {
  const { data, error } = await supabase.rpc("set_organization_node", {
    p_node_id: input.nodeId,
    p_node_level: input.orgLevel ?? null,
    p_jurisdiction: input.jurisdiction ?? null,
  });
  return unwrap(data, error, "Organization node was not updated.");
}

export async function setOrganizationGovernanceProfile(input: {
  nodeId: string;
  frameworkId: string | null;
  note: string;
}): Promise<{ node_id: string; governance_profile_id: string | null }> {
  const { data, error } = await supabase.rpc("set_org_governance_profile", {
    p_node_id: input.nodeId,
    p_framework_id: input.frameworkId,
    p_note: input.note,
  });
  return unwrap(data, error, "Governance profile was not changed.");
}
