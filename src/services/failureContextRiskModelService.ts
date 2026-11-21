import {
  checkDifferentiation,
  type DifferentiationCheck,
} from "../lib/industry-profiles";
import { supabase } from "../lib/supabase";

export interface FailureContextAsset {
  id: string;
  name: string;
  tag: string | null;
}

export interface FailureContextBinding {
  id: string;
  asset_id: string;
  context_key: string;
  comparison_context_key: string;
  workflow: string;
  comparison_workflow: string;
  engines: string[];
  shared_engines: string[];
  distinct_subject_engines: string[];
  distinct_comparison_engines: string[];
  different_workflow: boolean;
  differentiation_reason: string;
  required_data: string[];
  basis: string;
  recorded_at: string;
  work_authorized: false;
  risk_accepted: false;
}

export interface RecordFailureContextBindingResult {
  recorded: boolean;
  error?: string;
  bindingId?: string;
  reason?: string;
  workflow?: string;
  comparisonWorkflow?: string;
  workAuthorized?: false;
  riskAccepted?: false;
}

export function differentiateFailureContexts(
  contextKeyA: string,
  contextKeyB: string,
): DifferentiationCheck {
  return checkDifferentiation(contextKeyA, contextKeyB);
}

export async function listFailureContextAssets(): Promise<
  FailureContextAsset[]
> {
  const { data, error } = await supabase
    .from("assets")
    .select("id,name,tag")
    .order("name")
    .limit(500);
  if (error) throw new Error(error.message);
  return (data ?? []) as FailureContextAsset[];
}

export async function listFailureContextBindings(
  assetId: string,
): Promise<FailureContextBinding[]> {
  const { data, error } = await supabase
    .from("failure_context_bindings")
    .select(
      "id,asset_id,context_key,comparison_context_key,workflow,comparison_workflow,engines,shared_engines,distinct_subject_engines,distinct_comparison_engines,different_workflow,differentiation_reason,required_data,basis,recorded_at,work_authorized,risk_accepted",
    )
    .eq("asset_id", assetId)
    .order("recorded_at", { ascending: false })
    .limit(20);
  if (error) throw new Error(error.message);
  return (data ?? []) as FailureContextBinding[];
}

export async function recordFailureContextBinding(input: {
  assetId: string;
  contextKey: string;
  comparisonKey: string;
  basis: string;
}): Promise<RecordFailureContextBindingResult> {
  const { data, error } = await supabase.rpc("record_failure_context_binding", {
    p_asset_id: input.assetId,
    p_context_key: input.contextKey,
    p_comparison_key: input.comparisonKey,
    p_basis: input.basis,
  });
  if (error) throw new Error(error.message);
  const payload = (data ?? null) as RecordFailureContextBindingResult | null;
  if (!payload?.recorded) {
    throw new Error(
      payload?.error ?? "The failure-context binding was refused.",
    );
  }
  return payload;
}
