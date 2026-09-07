import { supabase } from "../lib/supabase";
import {
  evaluateDomainSpecialist,
  type DomainSpecialistRequest,
  type DomainSpecialistResult,
} from "../lib/domain-specialists";

export interface DomainSpecialistRunRow {
  id: string;
  risk_id: string;
  asset_id: string | null;
  module_key: string;
  method_key: string;
  model_key: string;
  model_version: string;
  required_reviewer_role_key: string;
  result_envelope: DomainSpecialistResult;
  evidence_item_ids: string[];
  run_status: "blocked" | "draft" | "reviewed" | "needs_changes" | "rejected";
  authoritative: false;
  human_approval_required: true;
  created_at: string;
  reviewed_at: string | null;
  review_note: string | null;
  review_outcome: string | null;
}

interface RecordedRunResponse {
  result: DomainSpecialistResult;
  persisted: {
    run_id: string;
    status: string;
    model_key: string;
    authoritative: false;
    human_approval_required: true;
  };
}

export function previewDomainSpecialist(
  request: DomainSpecialistRequest,
): DomainSpecialistResult {
  return evaluateDomainSpecialist(request);
}

export async function recordDomainSpecialistRun(
  riskId: string,
  request: DomainSpecialistRequest,
): Promise<RecordedRunResponse> {
  const { data, error } = await supabase.functions.invoke(
    "domain-specialist-run",
    {
      body: { riskId, request },
    },
  );
  if (error) throw new Error(`Could not execute specialist: ${error.message}`);
  const payload = data as (RecordedRunResponse & { error?: string }) | null;
  if (!payload) throw new Error("Could not execute specialist: no response");
  if (payload.error)
    throw new Error(`Could not execute specialist: ${payload.error}`);
  return payload;
}

export async function getDomainSpecialistRuns(
  riskId: string,
): Promise<DomainSpecialistRunRow[]> {
  const { data, error } = await supabase
    .from("domain_specialist_runs")
    .select(
      "id,risk_id,asset_id,module_key,method_key,model_key,model_version,required_reviewer_role_key,result_envelope,evidence_item_ids,run_status,authoritative,human_approval_required,created_at,reviewed_at,review_note,review_outcome",
    )
    .eq("risk_id", riskId)
    .order("created_at", { ascending: false })
    .limit(50)
    .returns<DomainSpecialistRunRow[]>();
  if (error)
    throw new Error(`Could not load specialist runs: ${error.message}`);
  return data ?? [];
}

export async function reviewDomainSpecialistRun(
  runId: string,
  outcome: "reviewed" | "needs_changes" | "rejected",
  note: string,
): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc("review_domain_specialist_run", {
    p_run_id: runId,
    p_outcome: outcome,
    p_note: note,
  });
  if (error)
    throw new Error(`Could not review specialist run: ${error.message}`);
  const payload = data as Record<string, unknown> & { error?: string };
  if (payload?.error)
    throw new Error(`Could not review specialist run: ${payload.error}`);
  return payload;
}
