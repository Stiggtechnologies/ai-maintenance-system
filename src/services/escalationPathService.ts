import { supabase } from "../lib/supabase";

export interface EscalationRule {
  id: string;
  ruleKey: string;
  version: number;
  subjectKind: "decision" | "work_order" | "condition_alert";
  conditionKind: "overdue" | "blocked";
  incidentPath: boolean;
  responseWindowHours: number | null;
  escalatesToRole: string;
  basis: string;
  status: "draft" | "adopted" | "retired";
  proposedBy: string;
  isOwnDraft: boolean;
}

export interface OnCallDuty {
  id: string;
  roleKey: string;
  userId: string;
  startsAt: string;
  endsAt: string;
  basis: string;
  endedEarlyAt: string | null;
  covering: boolean;
}

export interface EscalationRecord {
  id: string;
  ruleId: string;
  subjectKind: string;
  subjectId: string;
  conditionKind: string;
  incidentPath: boolean;
  escalatesToRole: string;
  onCallUserId: string | null;
  stateBasis: string;
  raiseNote: string;
  status: "open" | "acknowledged" | "withdrawn";
  isOwnRaise: boolean;
}

export interface EscalationCandidate {
  ruleId: string;
  subjectKind: string;
  subjectId: string;
  conditionKind: string;
  incidentPath: boolean;
  stateBasis: string;
}

export interface EscalationMember {
  userId: string;
  role: string;
  name: string;
}

export interface EscalationPaths {
  callerRole: string;
  canAuthor: boolean;
  control: string;
  ladderRoles: string[];
  members: EscalationMember[];
  rules: EscalationRule[];
  duties: OnCallDuty[];
  escalations: EscalationRecord[];
  candidates: EscalationCandidate[];
}

function unwrap<T>(data: unknown, error: { message: string } | null): T {
  if (error) throw new Error(error.message);
  const result = data as T & { error?: string };
  if (
    result &&
    typeof result === "object" &&
    "error" in result &&
    result.error
  ) {
    throw new Error(result.error);
  }
  return result;
}

export async function getEscalationPaths(): Promise<EscalationPaths> {
  const { data, error } = await supabase.rpc("get_escalation_paths");
  return unwrap(data, error);
}

export async function proposeEscalationRule(input: {
  ruleKey: string;
  subjectKind: string;
  conditionKind: string;
  incidentPath: boolean;
  responseWindowHours: number | null;
  escalatesToRole: string;
  basis: string;
}): Promise<{ ruleId: string; status: string; version: number }> {
  const { data, error } = await supabase.rpc("propose_escalation_rule", {
    p_rule_key: input.ruleKey,
    p_subject_kind: input.subjectKind,
    p_condition_kind: input.conditionKind,
    p_incident_path: input.incidentPath,
    p_response_window_hours: input.responseWindowHours,
    p_escalates_to_role: input.escalatesToRole,
    p_basis: input.basis,
  });
  return unwrap(data, error);
}

export async function adoptEscalationRule(input: {
  ruleId: string;
  note: string;
}): Promise<{ ruleId: string; status: string }> {
  const { data, error } = await supabase.rpc("adopt_escalation_rule", {
    p_rule_id: input.ruleId,
    p_note: input.note,
  });
  return unwrap(data, error);
}

export async function retireEscalationRule(input: {
  ruleId: string;
  note: string;
}): Promise<{ ruleId: string; status: string }> {
  const { data, error } = await supabase.rpc("retire_escalation_rule", {
    p_rule_id: input.ruleId,
    p_note: input.note,
  });
  return unwrap(data, error);
}

export async function recordOnCallDuty(input: {
  roleKey: string;
  userId: string;
  startsAt: string;
  endsAt: string;
  basis: string;
}): Promise<{ dutyId: string }> {
  const { data, error } = await supabase.rpc("record_on_call_duty", {
    p_role_key: input.roleKey,
    p_user_id: input.userId,
    p_starts_at: input.startsAt,
    p_ends_at: input.endsAt,
    p_basis: input.basis,
  });
  return unwrap(data, error);
}

export async function endOnCallDuty(input: {
  dutyId: string;
  note: string;
}): Promise<{ dutyId: string }> {
  const { data, error } = await supabase.rpc("end_on_call_duty", {
    p_duty_id: input.dutyId,
    p_note: input.note,
  });
  return unwrap(data, error);
}

export async function raiseSubjectEscalation(input: {
  ruleId: string;
  subjectId: string;
  note: string;
}): Promise<{ escalationId: string; status: string; idempotent: boolean }> {
  const { data, error } = await supabase.rpc("raise_subject_escalation", {
    p_rule_id: input.ruleId,
    p_subject_id: input.subjectId,
    p_note: input.note,
  });
  return unwrap(data, error);
}

export async function acknowledgeSubjectEscalation(input: {
  escalationId: string;
  note: string;
}): Promise<{
  escalationId: string;
  status: string;
  grantsAuthority: boolean;
}> {
  const { data, error } = await supabase.rpc("acknowledge_subject_escalation", {
    p_escalation_id: input.escalationId,
    p_note: input.note,
  });
  return unwrap(data, error);
}

export async function withdrawSubjectEscalation(input: {
  escalationId: string;
  note: string;
}): Promise<{ escalationId: string; status: string }> {
  const { data, error } = await supabase.rpc("withdraw_subject_escalation", {
    p_escalation_id: input.escalationId,
    p_note: input.note,
  });
  return unwrap(data, error);
}
