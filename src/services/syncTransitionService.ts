import { supabase } from "../lib/supabase";
import type { OperatingModelReadiness } from "./operatingModelReadinessService";
import type { OperationalDebtRegister } from "./operationalDebtService";
import type { TechnicalDebtRegister } from "./technicalDebtService";

export interface TransitionFailure {
  id: number;
  assetId: string;
  assetName: string;
  assetTag: string | null;
  occurredAt: string;
  monthsSinceHandover: number;
  failureMode: string | null;
  attributedTo: string | null;
  preventableBy: string | null;
  fedBackToDesign: boolean;
  workOrderId: string | null;
  sourceReference: string | null;
  evidenceClass: string | null;
  assessmentBasis: string | null;
  recordedBy: string | null;
}

export interface EarlyLifeFeedbackWorkspace {
  answered: boolean;
  refusal?: string;
  boundary: string;
  requirements: Array<{
    id: number;
    requirementRef: string;
    requirement: string;
    verificationStatus: "open" | "verified" | "waived" | "failed";
  }>;
  evidence: Array<{ id: string; description: string }>;
  links: Array<{
    id: number;
    failureId: number;
    requirementId: number;
    requirementRef: string;
    verificationStatus: "open" | "verified" | "waived" | "failed";
    eliminationStatus:
      "feedback_linked" | "verified_eliminated" | "ineffective";
    basis: string;
    evidenceItemId: string;
    linkedBy: string;
    linkedAt: string;
  }>;
}

export interface SyncTransitionReadModel {
  caseId: string;
  caseTitle: string;
  stageKey: string | null;
  capitalProjectId: number | null;
  generatedAt: string;
  transitionPosture:
    "NOT_READY" | "ATTENTION_REQUIRED" | "HUMAN_REVIEW_REQUIRED";
  operatingModel: OperatingModelReadiness;
  operationalReadiness: {
    assetCount: number;
    assets: Array<{ assetId: string; name: string; tag: string | null }>;
    overall: {
      hardBlockerCount: number;
      safetyOpenCount: number;
      pct: number;
    } | null;
    hardBlockers: Array<{ asset: string; item: string; kind: string }>;
  };
  technicalDebt: TechnicalDebtRegister;
  operationalDebt: OperationalDebtRegister;
  stabilization: {
    windowDays: number;
    windowBasis: string;
    scopeAssetCount: number;
    recordedInWindow: number;
    unclassifiedTimingCount: number;
    notFedBackCount: number;
    notDeterminedCount: number;
    status:
      | "NO_FAILURES_RECORDED"
      | "TIMING_EVIDENCE_INCOMPLETE"
      | "ACTION_REQUIRED"
      | "RECORDED_ACTIONS_CLOSED";
    events: TransitionFailure[];
    note: string;
  };
  decisionBoundary: string;
}

export async function getCaseSyncTransition(
  caseId: string,
  stabilizationDays: number,
) {
  const { data, error } = await supabase.rpc("get_case_sync_transition", {
    p_case_id: caseId,
    p_stabilization_days: stabilizationDays,
  });
  if (error) throw new Error(error.message);
  return data as SyncTransitionReadModel;
}

export async function recordCaseEarlyLifeFailure(
  caseId: string,
  input: {
    assetId: string;
    occurredAt: string;
    monthsSinceHandover: number | null;
    failureMode: string;
    attributedTo: string;
    preventableBy: string | null;
    sourceReference: string;
    evidenceClass: string;
    assessmentBasis: string;
  },
) {
  const { data, error } = await supabase.rpc("record_case_early_life_failure", {
    p_case_id: caseId,
    p_asset_id: input.assetId,
    p_occurred_at: input.occurredAt,
    p_months_since_handover: input.monthsSinceHandover,
    p_failure_mode: input.failureMode,
    p_attributed_to: input.attributedTo,
    p_preventable_by: input.preventableBy,
    p_source_reference: input.sourceReference,
    p_evidence_class: input.evidenceClass,
    p_assessment_basis: input.assessmentBasis,
  });
  if (error) throw new Error(error.message);
  return data as {
    id: number;
    caseId: string;
    assetId: string;
    status: "recorded";
  };
}

export async function getCaseEarlyLifeFeedbackWorkspace(
  caseId: string,
): Promise<EarlyLifeFeedbackWorkspace> {
  const { data, error } = await supabase.rpc(
    "get_case_early_life_feedback_workspace",
    { p_case_id: caseId },
  );
  if (error) throw new Error(error.message);
  const payload = data as EarlyLifeFeedbackWorkspace;
  if (!payload?.answered) {
    throw new Error(payload?.refusal ?? "Early-life feedback is unavailable");
  }
  return payload;
}

export async function linkCaseEarlyLifeFailure(input: {
  caseId: string;
  failureId: number;
  requirementId: number;
  evidenceItemId: string;
  basis: string;
}): Promise<{
  answered: true;
  linkId: number;
  failureId: number;
  requirementId: number;
  requirementRef: string;
  eliminationStatus: string;
  note: string;
}> {
  const { data, error } = await supabase.rpc("link_case_early_life_failure", {
    p_case_id: input.caseId,
    p_failure_id: input.failureId,
    p_requirement_id: input.requirementId,
    p_evidence_item_id: input.evidenceItemId,
    p_basis: input.basis,
  });
  if (error) throw new Error(error.message);
  const payload = data as { answered?: boolean; refusal?: string } & Record<
    string,
    unknown
  >;
  if (!payload?.answered) {
    throw new Error(payload?.refusal ?? "Early-life feedback link was refused");
  }
  return payload as {
    answered: true;
    linkId: number;
    failureId: number;
    requirementId: number;
    requirementRef: string;
    eliminationStatus: string;
    note: string;
  };
}
