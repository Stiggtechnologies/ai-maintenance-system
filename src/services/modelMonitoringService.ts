import { supabase } from "../lib/supabase";

export interface ModelMonitoringModel {
  id: number;
  modelKey: string;
  version: string;
  name: string;
  lifecycleState: string;
  productionEligible: boolean;
}

export interface ModelInputSnapshot {
  id: number;
  modelRegisterId: number;
  feature: string;
  label: string;
  windowStart: string;
  windowEnd: string;
  distribution: Record<string, number>;
  reference: boolean;
  checksum: string;
  evidenceItemId: string;
  capturedBy: string;
  capturedAt: string;
}

export interface ModelMonitoringReview {
  id: string;
  decision: "accepted_no_change" | "require_revalidation" | "retire";
  note: string;
  evidenceItemId: string;
  reviewedBy: string;
  reviewedAt: string;
}

export interface ModelMonitoringAssessment {
  id: string;
  modelRegisterId: number;
  feature: string;
  referenceSnapshotId: number;
  currentSnapshotId: number;
  psi: number | null;
  driftStatus: "not_measurable" | "none" | "moderate" | "significant";
  brierScore: number | null;
  skillScore: number | null;
  calibrationStatus:
    | "not_measurable"
    | "insufficient_outcomes"
    | "degenerate_outcomes"
    | "underperforming"
    | "monitored";
  predictionCount: number;
  outcomeCount: number;
  cohortCount: number;
  cohortMetrics: Array<{
    cohort: string;
    outcomes: number;
    brierScore: number;
    outcomeRate: number;
  }>;
  maximumCohortBrierGap: number | null;
  maximumCohortOutcomeRateGap: number | null;
  biasScreenStatus:
    | "not_measurable"
    | "no_material_disparity"
    | "review_required";
  alertStatus: "no_alert" | "insufficient_evidence" | "review_required";
  thresholds: Record<string, unknown>;
  assessmentBasis: string;
  assessedBy: string;
  assessedAt: string;
  review: ModelMonitoringReview | null;
}

export interface ModelOutcomeCandidate {
  calculationRunId: string;
  modelRegisterId: number;
  modelKey: string;
  modelVersion: string;
  assetId: string | null;
  computedAt: string;
  predictedProbability: number | null;
  horizonDays: number | null;
}

export interface MonitoringEvidenceOption {
  id: string;
  description: string;
  sourceSystem: string | null;
  qualityGrade: string | null;
}

export interface ModelMonitoringWorkspace {
  boundary: string;
  models: ModelMonitoringModel[];
  snapshots: ModelInputSnapshot[];
  assessments: ModelMonitoringAssessment[];
  openOutcomes: ModelOutcomeCandidate[];
  evidence: MonitoringEvidenceOption[];
}

interface RpcResult {
  error?: string;
  [key: string]: unknown;
}

function requireRpc<T>(data: unknown, fallback: string): T {
  const value = (data ?? {}) as RpcResult;
  if (value.error) throw new Error(value.error);
  if (!data) throw new Error(fallback);
  return data as T;
}

export async function getModelMonitoringWorkspace(): Promise<ModelMonitoringWorkspace> {
  const { data, error } = await supabase.rpc("get_model_monitoring_workspace");
  if (error) throw new Error(error.message);
  return requireRpc<ModelMonitoringWorkspace>(
    data,
    "Model monitoring workspace returned no data.",
  );
}

export async function captureModelInputSnapshot(input: {
  modelRegisterId: number;
  feature: string;
  label: string;
  windowStart: string;
  windowEnd: string;
  distribution: Record<string, number>;
  reference: boolean;
  evidenceItemId: string;
}): Promise<RpcResult> {
  const { data, error } = await supabase.rpc("capture_model_input_snapshot", {
    p_model_register_id: input.modelRegisterId,
    p_feature: input.feature,
    p_snapshot_label: input.label,
    p_window_start: input.windowStart,
    p_window_end: input.windowEnd,
    p_distribution: input.distribution,
    p_is_reference: input.reference,
    p_evidence_item_id: input.evidenceItemId,
  });
  if (error) throw new Error(error.message);
  return requireRpc<RpcResult>(data, "Model input snapshot returned no data.");
}

export async function runModelPerformanceAssessment(input: {
  modelRegisterId: number;
  referenceSnapshotId: number;
  currentSnapshotId: number;
  assessmentBasis: string;
}): Promise<RpcResult> {
  const { data, error } = await supabase.rpc(
    "run_model_performance_assessment",
    {
      p_model_register_id: input.modelRegisterId,
      p_reference_snapshot_id: input.referenceSnapshotId,
      p_current_snapshot_id: input.currentSnapshotId,
      p_assessment_basis: input.assessmentBasis,
    },
  );
  if (error) throw new Error(error.message);
  return requireRpc<RpcResult>(
    data,
    "Model performance assessment returned no data.",
  );
}

export async function reviewModelPerformanceAssessment(input: {
  assessmentId: string;
  decision: "accepted_no_change" | "require_revalidation" | "retire";
  reviewNote: string;
  evidenceItemId: string;
}): Promise<RpcResult> {
  const { data, error } = await supabase.rpc(
    "review_model_performance_assessment",
    {
      p_assessment_id: input.assessmentId,
      p_decision: input.decision,
      p_review_note: input.reviewNote,
      p_evidence_item_id: input.evidenceItemId,
    },
  );
  if (error) throw new Error(error.message);
  return requireRpc<RpcResult>(
    data,
    "Model monitoring review returned no data.",
  );
}
