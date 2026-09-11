import { supabase } from "../lib/supabase";

export type DevelopmentApproach =
  | "predictive"
  | "adaptive"
  | "iterative"
  | "hybrid";

export interface DevelopmentWorkstream {
  id: string;
  workstreamCode: string;
  title: string;
  developmentApproach: DevelopmentApproach;
  approachRationale: string;
  ownerId: string | null;
  owner: string | null;
  planningHorizonDays: number | null;
  reviewCadenceDays: number | null;
  version: number;
  adoptedBy: string | null;
  adoptedAt: string;
}

export interface HybridDevelopmentState {
  workstreams: DevelopmentWorkstream[];
  distinctApproaches: number;
  isHybridCase: boolean;
}

function unwrap<T>(data: unknown, error: { message: string } | null): T {
  if (error) throw new Error(error.message);
  const result = data as (T & { error?: string }) | null;
  if (result?.error) throw new Error(result.error);
  return result as T;
}

export async function getCaseDevelopmentWorkstreams(
  caseId: string,
): Promise<HybridDevelopmentState> {
  const { data, error } = await supabase.rpc(
    "get_case_development_workstreams",
    { p_case_id: caseId },
  );
  return unwrap<HybridDevelopmentState>(data, error);
}

export async function recordDevelopmentWorkstream(input: {
  caseId: string;
  workstreamCode: string;
  title: string;
  developmentApproach: DevelopmentApproach;
  approachRationale: string;
  ownerId?: string | null;
  planningHorizonDays?: number | null;
  reviewCadenceDays?: number | null;
}): Promise<{
  workstream_id: string;
  workstream_code: string;
  development_approach: DevelopmentApproach;
  version: number;
}> {
  const { data, error } = await supabase.rpc("record_development_workstream", {
    p_case_id: input.caseId,
    p_workstream_code: input.workstreamCode,
    p_title: input.title,
    p_development_approach: input.developmentApproach,
    p_approach_rationale: input.approachRationale,
    p_owner_id: input.ownerId ?? null,
    p_planning_horizon_days: input.planningHorizonDays ?? null,
    p_review_cadence_days: input.reviewCadenceDays ?? null,
  });
  return unwrap(data, error);
}
