import { supabase } from "../lib/supabase";

export type ModelKind =
  | "statistical"
  | "rule_based"
  | "machine_learning"
  | "llm"
  | "hybrid"
  | "deterministic_physics"
  | "empirical_reliability"
  | "oem_curve"
  | "standards_method";

export interface ModelVersionSubmission {
  modelKey: string;
  version: string;
  modelKind: ModelKind;
  purpose: string;
  trainingData: Record<string, unknown>;
  validation: Record<string, unknown>;
  applicability: Record<string, unknown>;
  limitations: string;
  decisionRelevant: boolean;
  supersedesModelId?: number | null;
}

interface RpcResult {
  error?: string;
  [key: string]: unknown;
}

function result(data: unknown, error: { message: string } | null): RpcResult {
  if (error) throw new Error(error.message);
  const value = (data ?? {}) as RpcResult;
  if (value.error) throw new Error(value.error);
  return value;
}

export async function submitModelRegistryVersion(
  input: ModelVersionSubmission,
) {
  const { data, error } = await supabase.rpc("submit_model_registry_version", {
    p_model_key: input.modelKey,
    p_version: input.version,
    p_model_kind: input.modelKind,
    p_purpose: input.purpose,
    p_training_data: input.trainingData,
    p_validation: input.validation,
    p_applicability: input.applicability,
    p_limitations: input.limitations,
    p_decision_relevant: input.decisionRelevant,
    p_supersedes_model_id: input.supersedesModelId ?? null,
  });
  return result(data, error);
}

export async function reviewModelRegistryVersion(input: {
  modelRegisterId: number;
  decision: "approved" | "rejected";
  evidenceItemId: string;
  reviewBasis: string;
}) {
  const { data, error } = await supabase.rpc("review_model_registry_version", {
    p_model_register_id: input.modelRegisterId,
    p_decision: input.decision,
    p_evidence_item_id: input.evidenceItemId,
    p_review_basis: input.reviewBasis,
  });
  const reviewed = result(data, error);
  if (input.decision === "approved") {
    const models = await supabase.rpc("get_model_register");
    if (models.error) throw new Error(models.error.message);
    const approved = (
      models.data as Array<{ id: number; modelKey: string; version: string }>
    ).find((model) => model.id === input.modelRegisterId);
    if (!approved)
      throw new Error("Reviewed model version could not be reloaded.");
    const gate = await supabase.rpc("require_current_model_version", {
      p_model_key: approved.modelKey,
      p_version: approved.version,
    });
    const checked = result(gate.data, gate.error) as {
      allowed?: boolean;
      refusal?: string;
    };
    if (!checked.allowed)
      throw new Error(
        checked.refusal ?? "Approved version did not become current.",
      );
  }
  return reviewed;
}
