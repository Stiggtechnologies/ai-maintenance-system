import { supabase } from "../lib/supabase";

export type FailureBasisKind =
  | "failure_mode"
  | "risk_scenario"
  | "not_applicable";

export interface FailureBasisOption {
  id: string;
  label: string;
  assetId: string | null;
  functionalFailure?: string | null;
  event?: string | null;
  status?: string | null;
}

export interface RecommendationFailureBasis {
  recommendationId: string;
  recommendationTitle: string;
  kind: FailureBasisKind | null;
  note: string | null;
  recordedBy: string | null;
  recordedAt: string | null;
  valid: boolean;
  failureMode: FailureBasisOption | null;
  riskScenario: FailureBasisOption | null;
  eligibleFailureModes: FailureBasisOption[];
  eligibleRiskScenarios: FailureBasisOption[];
  boundary: string;
  operationalAuthorization: false;
}

function fail(message: string, error: unknown): never {
  throw new Error(
    `${message}: ${error instanceof Error ? error.message : String(error)}`,
  );
}

export async function getRecommendationFailureBasis(
  recommendationId: string,
): Promise<RecommendationFailureBasis | null> {
  const { data, error } = await supabase.rpc(
    "get_recommendation_failure_basis",
    { p_recommendation_id: recommendationId },
  );
  if (error) fail("Could not load recommendation failure basis", error);
  return (data as RecommendationFailureBasis | null) ?? null;
}

export async function recordRecommendationFailureBasis(input: {
  recommendationId: string;
  kind: FailureBasisKind;
  subjectId: string | null;
  note: string;
}): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc(
    "record_recommendation_failure_basis",
    {
      p_recommendation_id: input.recommendationId,
      p_kind: input.kind,
      p_subject_id: input.subjectId,
      p_note: input.note,
    },
  );
  if (error) fail("Could not record recommendation failure basis", error);
  const result = (data ?? {}) as Record<string, unknown>;
  if (result.error) throw new Error(String(result.error));
  return result;
}
