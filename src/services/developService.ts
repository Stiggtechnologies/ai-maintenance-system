/**
 * Sync Develop service — Slice 1 (D1.04/D1.05, D3.24/D3.06, D3.25).
 *
 * Every write goes through an org-scoped SECURITY DEFINER RPC; this module
 * never writes a table directly. Reads ride RLS (development_cases,
 * project_frameworks are SELECT-only to authenticated) or the
 * get_development_case aggregate. RPC results carry {error} on refusal —
 * unwrapped here into thrown Errors so pages surface the SERVER's refusal
 * text, never a client guess.
 */
import { supabase } from "../lib/supabase";
import type { CaseWorkspace } from "../lib/develop";

export interface DevelopmentCaseSummary {
  id: string;
  title: string;
  status: string;
  lifecycle_type: string;
  current_stage_key: string | null;
  framework_id: string | null;
  estimated_capex: number | null;
  expected_value: number | null;
  problem_statement: string;
  created_at: string;
}

export interface FrameworkOption {
  id: string;
  name: string;
  version: number;
  source_authority: string;
  status: string;
}

export interface OrgMember {
  id: string;
  full_name: string | null;
  email: string | null;
}

export interface CreateDevelopmentCaseInput {
  title: string;
  problemStatement: string;
  lifecycleType: string;
  opportunityStatement?: string | null;
  frameworkId?: string | null;
  businessUnit?: string | null;
  estimatedCapex?: number | null;
  expectedValue?: number | null;
}

export interface GateFindingInput {
  criterion_id?: number | null;
  criterion_text: string;
  status: "met" | "not_met" | "not_assessed";
  evidence?: string | null;
}

export interface GateConditionInput {
  description: string;
  owner_id: string;
  due_date: string;
  evidence_requirement: string;
  consequence_if_missed: string;
}

type RpcPayload = Record<string, unknown> | null;

function unwrap<T>(data: unknown, error: { message: string } | null): T {
  if (error) throw new Error(error.message);
  const payload = data as RpcPayload;
  if (payload && typeof payload === "object" && "error" in payload) {
    throw new Error(String((payload as { error: unknown }).error));
  }
  return data as T;
}

export async function listDevelopmentCases(): Promise<
  DevelopmentCaseSummary[]
> {
  const { data, error } = await supabase
    .from("development_cases")
    .select(
      "id, title, status, lifecycle_type, current_stage_key, framework_id, estimated_capex, expected_value, problem_statement, created_at",
    )
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as DevelopmentCaseSummary[];
}

export async function listAdoptedFrameworks(): Promise<FrameworkOption[]> {
  const { data, error } = await supabase
    .from("project_frameworks")
    .select("id, name, version, source_authority, status")
    .eq("status", "adopted")
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as FrameworkOption[];
}

export async function listOrgMembers(): Promise<OrgMember[]> {
  const { data, error } = await supabase
    .from("user_profiles")
    .select("id, full_name, email")
    .order("full_name");
  if (error) throw new Error(error.message);
  return (data ?? []) as OrgMember[];
}

export async function createDevelopmentCase(
  input: CreateDevelopmentCaseInput,
): Promise<{ case_id: string; current_stage_key: string }> {
  const { data, error } = await supabase.rpc("create_development_case", {
    p_title: input.title,
    p_problem_statement: input.problemStatement,
    p_lifecycle_type: input.lifecycleType,
    p_opportunity_statement: input.opportunityStatement ?? null,
    p_framework_id: input.frameworkId ?? null,
    p_site_id: null,
    p_business_unit: input.businessUnit ?? null,
    p_estimated_capex: input.estimatedCapex ?? null,
    p_expected_value: input.expectedValue ?? null,
    p_objective_id: null,
    p_sponsor_id: null,
  });
  return unwrap(data, error);
}

export async function getDevelopmentCase(
  caseId: string,
): Promise<CaseWorkspace | null> {
  const { data, error } = await supabase.rpc("get_development_case", {
    p_case_id: caseId,
  });
  if (error) throw new Error(error.message);
  return (data as CaseWorkspace | null) ?? null;
}

export async function recordCaseGateReview(input: {
  caseId: string;
  gateId: number;
  outcome: string;
  note: string;
  findings: GateFindingInput[];
  conditions: GateConditionInput[];
}): Promise<{ review_id: number; outcome: string }> {
  const { data, error } = await supabase.rpc("record_case_gate_review", {
    p_case_id: input.caseId,
    p_gate_id: input.gateId,
    p_outcome: input.outcome,
    p_note: input.note,
    p_findings: input.findings,
    p_conditions: input.conditions,
  });
  return unwrap(data, error);
}

export async function advanceCaseStage(input: {
  caseId: string;
  toStageKey: string;
  reason?: string | null;
}): Promise<{ case_id: string; current_stage_key: string }> {
  const { data, error } = await supabase.rpc("advance_development_case_stage", {
    p_case_id: input.caseId,
    p_to_stage_key: input.toStageKey,
    p_reason: input.reason ?? null,
  });
  return unwrap(data, error);
}

export async function sanctionDevelopmentCase(input: {
  caseId: string;
  note: string;
  sanctionedValue?: number | null;
}): Promise<{ case_id: string; status: string; sanctioned_value: number }> {
  const { data, error } = await supabase.rpc("sanction_development_case", {
    p_case_id: input.caseId,
    p_note: input.note,
    p_sanctioned_value: input.sanctionedValue ?? null,
  });
  return unwrap(data, error);
}
