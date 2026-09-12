import { supabase } from "../lib/supabase";

export const OT_CYBER_ARTIFACT_TYPES = [
  "cyber_requirement",
  "architecture_review",
  "segmentation",
  "remote_access",
  "vendor_access",
  "firmware",
  "patchability",
  "backup",
  "recovery",
  "cyber_acceptance_test",
] as const;

export type OtCyberArtifactType = (typeof OT_CYBER_ARTIFACT_TYPES)[number];

export interface OtCyberLifecycleItem {
  artifactType: OtCyberArtifactType;
  requirementId: number | null;
  requirementRef: string | null;
  requirement: string | null;
  ownerId: string | null;
  acceptanceCriteria: string | null;
  verificationMethod: string | null;
  verificationStatus: string | null;
  evidenceVerified: boolean;
  basis: string | null;
  commissioningTestId: number | null;
  testRef: string | null;
  testOutcome: string | null;
  testReleaseStatus: string | null;
  state: "MISSING" | "FAILED" | "AWAITING_EVIDENCE" | "TEST_NOT_ACCEPTED" | "SATISFIED";
  verifications: { obligationId: string; status: string; result: string | null; evidenceId: string | null }[];
}

export interface OtCyberLifecycle {
  caseId: string;
  applicability: "applicable" | "not_applicable" | null;
  applicabilityBasis: string | null;
  assessedBy: string | null;
  assessedAt: string | null;
  satisfiedCount: number | null;
  requiredCount: number | null;
  status: "NOT_ASSESSED" | "NOT_APPLICABLE" | "BLOCKED" | "READY";
  refusal?: string | null;
  items: OtCyberLifecycleItem[];
  blockers: { type: string; id: string; name: string; artifactType: OtCyberArtifactType; state: string }[];
  decisionBoundary: string;
}

function unwrap<T>(data: unknown, error: { message: string } | null, fallback: string): T {
  if (error) throw new Error(error.message);
  const value = data as (T & { error?: string }) | null;
  if (value?.error) throw new Error(value.error);
  if (value == null) throw new Error(fallback);
  return value;
}

export async function getCaseOtCyberLifecycle(caseId: string): Promise<OtCyberLifecycle> {
  const { data, error } = await supabase.rpc("get_case_ot_cyber_lifecycle", { p_case_id: caseId });
  return unwrap(data, error, "Could not load the OT-cyber lifecycle");
}

export async function setCaseOtCyberApplicability(input: {
  caseId: string;
  applicability: "applicable" | "not_applicable";
  basis: string;
}): Promise<{ caseId: string; applicability: string }> {
  const { data, error } = await supabase.rpc("set_case_ot_cyber_applicability", {
    p_case_id: input.caseId,
    p_applicability: input.applicability,
    p_basis: input.basis,
  });
  return unwrap(data, error, "Could not record OT-cyber applicability");
}

export async function recordCaseOtCyberArtifact(input: {
  caseId: string;
  artifactType: OtCyberArtifactType;
  requirementRef: string;
  requirement: string;
  ownerId: string;
  acceptanceCriteria: string;
  verificationMethod: string;
  basis: string;
  commissioningTestId?: number | null;
}): Promise<{ caseId: string; requirementId: number; artifactType: OtCyberArtifactType }> {
  const { data, error } = await supabase.rpc("record_case_ot_cyber_artifact", {
    p_case_id: input.caseId,
    p_artifact: {
      artifact_type: input.artifactType,
      requirement_ref: input.requirementRef,
      requirement: input.requirement,
      owner_id: input.ownerId,
      acceptance_criteria: input.acceptanceCriteria,
      verification_method: input.verificationMethod,
      basis: input.basis,
      commissioning_test_id: input.commissioningTestId ?? null,
      source: "engineering",
    },
  });
  return unwrap(data, error, "Could not record the OT-cyber artifact");
}
