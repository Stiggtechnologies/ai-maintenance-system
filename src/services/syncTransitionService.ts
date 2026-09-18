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

export interface SyncTransitionReadModel {
  caseId: string;
  caseTitle: string;
  stageKey: string | null;
  capitalProjectId: number | null;
  generatedAt: string;
  transitionPosture: "NOT_READY" | "ATTENTION_REQUIRED" | "HUMAN_REVIEW_REQUIRED";
  operatingModel: OperatingModelReadiness;
  operationalReadiness: {
    assetCount: number;
    assets: Array<{ assetId: string; name: string; tag: string | null }>;
    overall: { hardBlockerCount: number; safetyOpenCount: number; pct: number } | null;
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
    status: "NO_FAILURES_RECORDED" | "TIMING_EVIDENCE_INCOMPLETE" | "ACTION_REQUIRED" | "RECORDED_ACTIONS_CLOSED";
    events: TransitionFailure[];
    note: string;
  };
  decisionBoundary: string;
}

export async function getCaseSyncTransition(caseId: string, stabilizationDays: number) {
  const { data, error } = await supabase.rpc("get_case_sync_transition", {
    p_case_id: caseId,
    p_stabilization_days: stabilizationDays,
  });
  if (error) throw new Error(error.message);
  return data as SyncTransitionReadModel;
}

export async function recordCaseEarlyLifeFailure(caseId: string, input: {
  assetId: string;
  occurredAt: string;
  monthsSinceHandover: number | null;
  failureMode: string;
  attributedTo: string;
  preventableBy: string | null;
  sourceReference: string;
  evidenceClass: string;
  assessmentBasis: string;
}) {
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
  return data as { id: number; caseId: string; assetId: string; status: "recorded" };
}
