import { supabase } from "../lib/supabase";

export type MfaEnforcementScope = "privileged_roles" | "all_members";

export interface SecurityPosture {
  authenticated: boolean;
  workspaceMember: boolean;
  required: boolean;
  verifiedFactorCount: number;
  currentAal: "aal1" | "aal2";
  satisfied: boolean;
  reason: string;
  boundary: string;
}

export interface OrganizationMfaPolicy {
  id: string;
  version: number;
  scope: MfaEnforcementScope;
  privilegedRoles: string[];
  effectiveAt: string;
  status: "proposed" | "adopted" | "rejected" | "superseded";
  proposedBy: string;
  proposedByLabel?: string;
  proposedAt: string;
  proposalReason: string;
  decidedBy?: string;
  decidedByLabel?: string;
  decidedAt?: string;
  decisionReason?: string;
}

export interface OrganizationMfaPolicyWorkspace {
  adopted: OrganizationMfaPolicy | null;
  scheduled: OrganizationMfaPolicy | null;
  proposed: OrganizationMfaPolicy | null;
  boundary: string;
}

interface RpcEnvelope {
  error?: unknown;
  [key: string]: unknown;
}

function requireEnvelope<T>(data: unknown, fallback: string): T {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(fallback);
  }
  const envelope = data as RpcEnvelope;
  if (typeof envelope.error === "string" && envelope.error.trim()) {
    throw new Error(envelope.error);
  }
  return data as T;
}

export async function getCurrentSecurityPosture(): Promise<SecurityPosture> {
  const { data, error } = await supabase.rpc("get_current_security_posture");
  if (error) throw new Error(error.message);
  return requireEnvelope<SecurityPosture>(
    data,
    "Security posture returned no data.",
  );
}

export async function getOrganizationMfaPolicy(): Promise<OrganizationMfaPolicyWorkspace> {
  const { data, error } = await supabase.rpc("get_organization_mfa_policy");
  if (error) throw new Error(error.message);
  return requireEnvelope<OrganizationMfaPolicyWorkspace>(
    data,
    "Organization MFA policy returned no data.",
  );
}

export async function proposeOrganizationMfaPolicy(input: {
  scope: MfaEnforcementScope;
  privilegedRoles: string[];
  effectiveAt: string;
  reason: string;
}): Promise<RpcEnvelope> {
  const { data, error } = await supabase.rpc(
    "propose_organization_mfa_policy",
    {
      p_enforcement_scope: input.scope,
      p_privileged_roles: input.privilegedRoles,
      p_effective_at: input.effectiveAt,
      p_reason: input.reason,
    },
  );
  if (error) throw new Error(error.message);
  return requireEnvelope<RpcEnvelope>(
    data,
    "MFA policy proposal returned no data.",
  );
}

export async function decideOrganizationMfaPolicy(input: {
  policyId: string;
  decision: "adopt" | "reject";
  reason: string;
}): Promise<RpcEnvelope> {
  const { data, error } = await supabase.rpc("decide_organization_mfa_policy", {
    p_policy_id: input.policyId,
    p_decision: input.decision,
    p_reason: input.reason,
  });
  if (error) throw new Error(error.message);
  return requireEnvelope<RpcEnvelope>(
    data,
    "MFA policy decision returned no data.",
  );
}
