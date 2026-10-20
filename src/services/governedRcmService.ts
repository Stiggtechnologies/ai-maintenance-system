import { supabase } from "../lib/supabase";

export type RcmConsequence =
  "hidden" | "safety" | "environmental" | "operational" | "non_operational";

export type RcmProactiveTask =
  | "none"
  | "condition_based"
  | "failure_finding"
  | "time_based_restoration"
  | "time_based_replacement";

export type RcmDefaultAction =
  "" | "failure_finding" | "run_to_failure" | "redesign" | "one_time_change";

export interface RcmAsset {
  id: string;
  tag: string | null;
  name: string;
  assetClass: string | null;
  criticality: string | null;
}

export interface RcmReviewer {
  id: string;
  name: string;
  role: string;
}

export interface RcmEvidence {
  id: string;
  assetId: string | null;
  type: string | null;
  class: string | null;
  description: string | null;
  sourceSystem: string | null;
  verifiedBy: string;
  verifiedAt: string;
  verificationMethod: string;
}

export interface RcmAnalysis {
  failureModeId: string;
  assetId: string;
  functionStatement: string;
  functionalFailure: string;
  failureMode: string;
  effect: string;
  consequenceCategory: RcmConsequence;
  hiddenFailure: boolean;
  status: "submitted" | "reviewed" | "rejected" | "superseded";
  version: number;
  recordedBy: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  evidenceItemIds: string[];
  strategy: {
    id: string;
    type: string;
    taskApplicable: boolean | null;
    taskEffective: boolean | null;
    defaultAction: string | null;
    recommendation: string;
    rcmAnswers: RcmAnswers;
    status: "submitted" | "approved" | "rejected" | "superseded";
    reviewerId: string;
    reviewStatus: string;
  };
}

export interface RcmWorkspace {
  assets: RcmAsset[];
  reviewers: RcmReviewer[];
  evidence: RcmEvidence[];
  analyses: RcmAnalysis[];
  decisionBoundary: {
    recordsEngineeringDisposition: true;
    changesMaintenancePlan: false;
    createsWork: false;
    acceptsRisk: false;
    commitsSpend: false;
    changesOperatingLimits: false;
    returnsToService: false;
    approvalRequiresAal: "aal2";
    segregationOfDuties: true;
  };
}

export interface RcmAnswers {
  functionStatement: string;
  functionalFailure: string;
  failureMode: string;
  failureEffect: string;
  consequenceCategory: RcmConsequence;
  consequenceRationale: string;
  hiddenFailure: boolean;
  proposedTask: RcmProactiveTask;
  taskApplicable: boolean | null;
  applicabilityBasis: string;
  taskEffective: boolean | null;
  effectivenessBasis: string;
  defaultAction: RcmDefaultAction;
  severityRank?: string;
  occurrenceRank?: string;
  detectabilityRank?: string;
  criticalityScaleReference?: string;
  criticalityBasis?: string;
}

function rpcError(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const error = (value as { error?: unknown }).error;
  return typeof error === "string" && error ? error : null;
}

export async function loadGovernedRcmWorkspace(): Promise<RcmWorkspace> {
  const { data, error } = await supabase.rpc("get_governed_rcm_workspace");
  if (error) throw new Error(error.message);
  const refused = rpcError(data);
  if (refused) throw new Error(refused);
  return data as RcmWorkspace;
}

export async function submitGovernedRcmAnalysis(input: {
  assetId: string;
  answers: RcmAnswers;
  evidenceItemIds: string[];
  reviewerId: string;
  supersedesFailureModeId?: string | null;
}): Promise<{ failureModeId: string; strategyId: string }> {
  const { data, error } = await supabase.rpc("submit_governed_rcm_analysis", {
    p_asset_id: input.assetId,
    p_answers: input.answers,
    p_evidence_item_ids: input.evidenceItemIds,
    p_reviewer_id: input.reviewerId,
    p_supersedes_failure_mode_id: input.supersedesFailureModeId ?? null,
  });
  if (error) throw new Error(error.message);
  const refused = rpcError(data);
  if (refused) throw new Error(refused);
  const result = data as { failureModeId?: string; strategyId?: string };
  if (!result.failureModeId || !result.strategyId)
    throw new Error("The governed RCM workflow returned no record identity.");
  return result as { failureModeId: string; strategyId: string };
}

export async function reviewGovernedRcmAnalysis(input: {
  strategyId: string;
  disposition: "approved" | "rejected";
  note: string;
}): Promise<void> {
  const { data, error } = await supabase.rpc("review_governed_rcm_analysis", {
    p_strategy_id: input.strategyId,
    p_disposition: input.disposition,
    p_note: input.note,
  });
  if (error) throw new Error(error.message);
  const refused = rpcError(data);
  if (refused) throw new Error(refused);
}
