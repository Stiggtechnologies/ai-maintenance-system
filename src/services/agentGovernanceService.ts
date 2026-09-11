import { supabase } from "../lib/supabase";

export interface AgentControlProfile {
  id: string;
  agent_id: string;
  authority_mode: "advisory_only" | "propose_with_approval";
  required_human_approver_role: string;
  proposal_risk_ceiling: "Low" | "Medium" | "High" | "Critical";
  proposal_cost_ceiling_usd: number;
  proposal_downtime_ceiling_hours: number;
  may_approve: false;
  basis: string;
  version: number;
  adopted_at: string;
}

export interface AgentControlState {
  profile: AgentControlProfile | null;
  decisionRights: string[];
  tools: string[];
}

export interface AgentControlOptions {
  decisionRights: Array<{
    right_key: string;
    title: string;
    tier: "auto" | "approval" | "never";
  }>;
  tools: Array<{ tool_key: string; title: string; access_kind: string }>;
}

export interface ConfigureAgentControlsInput {
  agentId: string;
  approverRole: string;
  riskCeiling: "Low" | "Medium" | "High" | "Critical";
  costCeilingUsd: number;
  downtimeCeilingHours: number;
  decisionRightKeys: string[];
  toolKeys: string[];
  basis: string;
}

function raise(label: string, error: { message: string } | null): never {
  throw new Error(error ? `${label}: ${error.message}` : label);
}

export async function getAgentControlState(
  agentId: string,
): Promise<AgentControlState> {
  const { data: profile, error: profileError } = await supabase
    .from("agent_control_profiles")
    .select("*")
    .eq("agent_id", agentId)
    .eq("status", "adopted")
    .maybeSingle<AgentControlProfile>();
  if (profileError) raise("Could not load agent controls", profileError);
  if (!profile) return { profile: null, decisionRights: [], tools: [] };

  const [rightsResult, toolsResult] = await Promise.all([
    supabase
      .from("agent_decision_right_bindings")
      .select("decision_rights(right_key)")
      .eq("profile_id", profile.id),
    supabase
      .from("agent_tool_bindings")
      .select("agent_software_tools(tool_key)")
      .eq("profile_id", profile.id),
  ]);
  if (rightsResult.error)
    raise("Could not load agent decision rights", rightsResult.error);
  if (toolsResult.error)
    raise("Could not load agent tools", toolsResult.error);

  const decisionRights = (rightsResult.data ?? []).flatMap((row) => {
    const value = row.decision_rights as unknown as
      | { right_key: string }
      | { right_key: string }[]
      | null;
    return Array.isArray(value)
      ? value.map((item) => item.right_key)
      : value?.right_key
        ? [value.right_key]
        : [];
  });
  const tools = (toolsResult.data ?? []).flatMap((row) => {
    const value = row.agent_software_tools as unknown as
      | { tool_key: string }
      | { tool_key: string }[]
      | null;
    return Array.isArray(value)
      ? value.map((item) => item.tool_key)
      : value?.tool_key
        ? [value.tool_key]
        : [];
  });
  return { profile, decisionRights, tools };
}

export async function getAgentControlOptions(): Promise<AgentControlOptions> {
  const [rightsResult, toolsResult] = await Promise.all([
    supabase
      .from("decision_rights")
      .select("right_key,title,tier")
      .neq("tier", "never")
      .order("title"),
    supabase
      .from("agent_software_tools")
      .select("tool_key,title,access_kind")
      .order("title"),
  ]);
  if (rightsResult.error)
    raise("Could not load decision-right options", rightsResult.error);
  if (toolsResult.error) raise("Could not load tool options", toolsResult.error);
  return {
    decisionRights: (rightsResult.data ?? []) as AgentControlOptions["decisionRights"],
    tools: (toolsResult.data ?? []) as AgentControlOptions["tools"],
  };
}

export async function configureAgentControls(
  input: ConfigureAgentControlsInput,
): Promise<{ profile_id: string; version: number; may_approve: false }> {
  const { data, error } = await supabase.rpc("configure_agent_controls", {
    p_agent_id: input.agentId,
    p_required_human_approver_role: input.approverRole,
    p_proposal_risk_ceiling: input.riskCeiling,
    p_proposal_cost_ceiling_usd: input.costCeilingUsd,
    p_proposal_downtime_ceiling_hours: input.downtimeCeilingHours,
    p_decision_right_keys: input.decisionRightKeys,
    p_tool_keys: input.toolKeys,
    p_basis: input.basis,
  });
  if (error) raise("Could not adopt agent controls", error);
  const result = data as {
    error?: string;
    profile_id: string;
    version: number;
    may_approve: false;
  };
  if (result.error) throw new Error(result.error);
  return result;
}

export async function evaluateAgentControl(
  agentId: string,
  decisionRightKey: string,
  toolKey: string,
): Promise<{ allowed: boolean; reason: string }> {
  const { data, error } = await supabase.rpc("evaluate_agent_control", {
    p_agent_id: agentId,
    p_decision_right_key: decisionRightKey,
    p_tool_key: toolKey,
  });
  if (error) raise("Could not evaluate agent controls", error);
  return data as { allowed: boolean; reason: string };
}
