/**
 * Tenant disaster-recovery governance.
 *
 * RPO and RTO are stated by a named human. This module does not supply a
 * duration, and it does not decide whether a restore passed: the database
 * recomputes that from the measurements and the checks.
 */
import { supabase } from "../lib/supabase";

type RpcPayload = { error?: string } | null;

function unwrap<T>(data: unknown, error: { message: string } | null): T {
  if (error) throw new Error(error.message);
  const payload = data as RpcPayload;
  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    payload.error
  ) {
    throw new Error(payload.error);
  }
  return data as T;
}

export interface RecoveryCandidate {
  id: string;
  full_name: string;
  role: string;
}

export interface RecoveryObjective {
  id: string;
  version: number;
  status: "draft" | "adopted" | "superseded";
  rpo_seconds: number;
  rto_seconds: number;
  recovery_owner_id: string;
  recovery_owner_name: string;
  procedure_reference: string;
  basis: string;
  stated_by: string;
  stated_by_name: string;
  stated_at: string;
  adopted_by: string | null;
  adopted_at: string | null;
}

export type VerificationOutcome =
  "within_objectives" | "outside_objectives" | "checks_not_run";

export interface RecoveryVerification {
  id: string;
  objective_id: string;
  backup_label: string;
  restore_target: string;
  evidence_reference: string;
  measured_data_loss_seconds: number;
  measured_restore_seconds: number;
  rpo_seconds_applied: number;
  rto_seconds_applied: number;
  canonical_row_check: "matched" | "mismatched" | "not_run";
  tenant_isolation_witness: "passed" | "failed" | "not_run";
  within_rpo: boolean;
  within_rto: boolean;
  verification_outcome: VerificationOutcome;
  recorded_by_name: string;
  recorded_at: string;
}

export interface RecoveryDocumentation {
  database_drill: string;
  runbook: string;
  policy_template: string;
  local_drill_is_not_an_approved_rto: boolean;
  production_pitr_proven: boolean;
  storage_object_bytes_proven: boolean;
  vault_root_key_proven: boolean;
  edge_secrets_proven: boolean;
  boundary: string;
}

export interface RecoveryPosture {
  role: string;
  viewer_id: string | null;
  viewer_name: string | null;
  draft: RecoveryObjective | null;
  adopted: RecoveryObjective | null;
  verifications: RecoveryVerification[];
  candidates: RecoveryCandidate[];
  documentation: RecoveryDocumentation;
}

export async function getRecoveryPosture(): Promise<RecoveryPosture> {
  const { data, error } = await supabase.rpc("get_recovery_posture");
  const result = unwrap<RecoveryPosture>(data, error);
  return {
    role: result.role ?? "",
    viewer_id: result.viewer_id ?? null,
    viewer_name: result.viewer_name ?? null,
    draft: result.draft ?? null,
    adopted: result.adopted ?? null,
    verifications: result.verifications ?? [],
    candidates: result.candidates ?? [],
    documentation: result.documentation,
  };
}

export async function stateRecoveryObjective(input: {
  rpoSeconds: string;
  rtoSeconds: string;
  recoveryOwnerId: string;
  procedureReference: string;
  basis: string;
}): Promise<{ objective_id: string; status: string }> {
  const { data, error } = await supabase.rpc("state_recovery_objective", {
    p_objective: {
      rpo_seconds: input.rpoSeconds,
      rto_seconds: input.rtoSeconds,
      recovery_owner_id: input.recoveryOwnerId,
      procedure_reference: input.procedureReference,
      basis: input.basis,
    },
  });
  return unwrap(data, error);
}

export async function withdrawRecoveryObjectiveDraft(input: {
  objectiveId: string;
  note: string;
}): Promise<{ withdrawn: string }> {
  const { data, error } = await supabase.rpc(
    "withdraw_recovery_objective_draft",
    { p_id: input.objectiveId, p_note: input.note },
  );
  return unwrap(data, error);
}

export async function adoptRecoveryObjective(input: {
  objectiveId: string;
  note: string;
}): Promise<{ objective_id: string; status: string }> {
  const { data, error } = await supabase.rpc("adopt_recovery_objective", {
    p_id: input.objectiveId,
    p_note: input.note,
  });
  return unwrap(data, error);
}

export async function recordRestoreVerification(input: {
  objectiveId: string;
  backupLabel: string;
  restoreTarget: string;
  evidenceReference: string;
  measuredDataLossSeconds: string;
  measuredRestoreSeconds: string;
  canonicalRowCheck: "matched" | "mismatched" | "not_run";
  tenantIsolationWitness: "passed" | "failed" | "not_run";
}): Promise<{
  verification_id: string;
  verification_outcome: VerificationOutcome;
}> {
  const { data, error } = await supabase.rpc("record_restore_verification", {
    p_verification: {
      objective_id: input.objectiveId,
      backup_label: input.backupLabel,
      restore_target: input.restoreTarget,
      evidence_reference: input.evidenceReference,
      measured_data_loss_seconds: input.measuredDataLossSeconds,
      measured_restore_seconds: input.measuredRestoreSeconds,
      canonical_row_check: input.canonicalRowCheck,
      tenant_isolation_witness: input.tenantIsolationWitness,
    },
  });
  return unwrap(data, error);
}
