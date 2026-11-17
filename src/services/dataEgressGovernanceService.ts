import { supabase } from "../lib/supabase";

export type DataClass =
  | "operational"
  | "personal"
  | "commercial"
  | "safety_critical"
  | "security_sensitive";
export type DestinationKind =
  | "llm_gateway"
  | "analytics"
  | "vendor_support"
  | "regulator"
  | "corporate_it"
  | "other";
export type EgressPurpose =
  | "model_inference"
  | "embedding"
  | "document_extraction"
  | "realtime_voice"
  | "speech_synthesis"
  | "onboarding_enrichment"
  | "agent_enrichment";

export interface DataEgressRule {
  id: number;
  version: number;
  destination: string;
  destinationKind: DestinationKind;
  dataClass: DataClass;
  allowedPurposes: EgressPurpose[];
  permitted: boolean;
  redactionRequired: boolean;
  basis: string;
  status:
    "legacy_unverified" | "proposed" | "adopted" | "rejected" | "superseded";
  proposedBy: string | null;
  proposedByLabel: string | null;
  proposedAt: string | null;
  decidedByLabel: string | null;
  supersedesRuleId: number | null;
  supersededByRuleId: number | null;
}

interface RpcResult {
  error?: string;
  [key: string]: unknown;
}

function requireResult(data: unknown, error: { message: string } | null) {
  if (error) throw new Error(error.message);
  const value = (data ?? {}) as RpcResult;
  if (value.error) throw new Error(value.error);
  return value;
}

export async function getDataEgressRules(): Promise<{
  rules: DataEgressRule[];
  boundary: string;
}> {
  const { data, error } = await supabase.rpc("get_data_egress_rules");
  const value = requireResult(data, error);
  return {
    rules: (value.rules ?? []) as DataEgressRule[],
    boundary: String(value.boundary ?? ""),
  };
}

export async function proposeDataEgressRule(input: {
  destination: string;
  destinationKind: DestinationKind;
  dataClass: DataClass;
  allowedPurposes: EgressPurpose[];
  permitted: boolean;
  redactionRequired: boolean;
  basis: string;
  supersedesRuleId?: number | null;
}) {
  const { data, error } = await supabase.rpc("propose_data_egress_rule", {
    p_destination: input.destination,
    p_destination_kind: input.destinationKind,
    p_data_class: input.dataClass,
    p_allowed_purposes: input.allowedPurposes,
    p_permitted: input.permitted,
    p_redaction_required: input.redactionRequired,
    p_basis: input.basis,
    p_supersedes_rule_id: input.supersedesRuleId ?? null,
  });
  return requireResult(data, error);
}

export async function decideDataEgressRule(input: {
  ruleId: number;
  decision: "adopt" | "reject";
  reason: string;
}) {
  const { data, error } = await supabase.rpc("decide_data_egress_rule", {
    p_rule_id: input.ruleId,
    p_decision: input.decision,
    p_reason: input.reason,
  });
  return requireResult(data, error);
}
