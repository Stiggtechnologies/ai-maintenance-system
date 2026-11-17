import { supabase } from "../lib/supabase";
import type {
  AgeReplacementResult,
  InspectionResult,
} from "../lib/optimization";
import type { MethodSelection } from "../lib/reliability/method-selection";

export type StrategyKind =
  "time_based_pm" | "condition_based" | "failure_finding" | "run_to_failure";

export interface AssetStrategyPlan {
  id: string;
  assetId: string | null;
  assetName: string | null;
  assetTag: string | null;
  assetClass: string | null;
  taskCode: string | null;
  taskLabel: string;
  intervalBasis: "calendar_days" | "run_hours";
  intervalValue: number;
  active: boolean;
  source: string | null;
  componentScope: string | null;
  failureMode: string | null;
  strategyKind: StrategyKind | null;
  plannedTaskCostUsd: number | null;
  failureConsequenceCostUsd: number | null;
  costBasis: string | null;
  safetyCritical: boolean | null;
  regulatoryRequired: boolean | null;
  lifecycleObjective: string | null;
  version: number;
  updatedAt: string;
}

export type AssetStrategyRecommendationKind =
  | "interval_change"
  | "inspection_interval"
  | "run_to_failure_review"
  | "retain_current"
  | "evidence_gap"
  | "strategy_review";

export interface AssetStrategyRecommendation {
  kind: AssetStrategyRecommendationKind;
  proposedStrategyKind: StrategyKind | null;
  proposedIntervalBasis: "calendar_days" | "run_hours" | null;
  proposedIntervalValue: number | null;
  currentIntervalBasis?: "calendar_days" | "run_hours";
  currentIntervalValue?: number;
  savingsPct?: number | null;
  reason: string;
  humanApprovalRequired: true;
}

export interface AssetStrategyAnalysis {
  methodSelection: MethodSelection;
  ageReplacement: AgeReplacementResult;
  inspection: InspectionResult & {
    pfIntervalId?: string | null;
    detectionTechnique?: string | null;
    basis?: string | null;
  };
  recommendation: AssetStrategyRecommendation;
  fieldExperience?: StrategyFieldExperience;
  refusals: string[];
  lifecyclePlan: {
    objective: string | null;
    actions: Array<Record<string, unknown>>;
  };
}

export interface StrategyFieldExperience {
  eventIds: string[];
  effectiveCount: number;
  ineffectiveCount: number;
  currentEffectiveCount: number;
  currentIneffectiveCount: number;
  refreshRequired: boolean;
  revisionRequired: boolean;
  latestEvaluatedAt: string | null;
  currentPlanVersion: number;
  basis: string;
}

export interface AssetStrategyLearningState {
  planId: string;
  assetId: string | null;
  taskLabel: string;
  state: StrategyFieldExperience & {
    events: Array<{
      learningEventId: string;
      caVerificationId: string;
      lifecyclePlanId: string;
      lifecyclePlanVersion: number;
      appliedPlanVersion: number;
      effectiveness: "effective" | "ineffective";
      evaluatedAt: string;
      observationDays: number;
      failureMode: string | null;
      recurrenceWorkOrderId: string | null;
      appliesToCurrentPlanVersion: boolean;
      unconsumed: boolean;
    }>;
  };
}

export interface StrategyReviewAssignment {
  id: string;
  assignedTo: string;
  reviewerName: string | null;
  reviewerEmail: string | null;
  dueDate: string;
  note: string;
  assignedAt: string;
}

export interface AssetStrategyAssessment {
  id: string;
  planId: string;
  assetId: string;
  assetName: string;
  taskLabel: string;
  planVersion: number;
  kernelVersion: string;
  sourceEventIds: number[];
  analysis: AssetStrategyAnalysis;
  recommendation: AssetStrategyRecommendation;
  limitations: string[];
  createdBy: string;
  createdAt: string;
  assignments: StrategyReviewAssignment[];
}

export interface AssetLifecyclePlan {
  id: string;
  assetId: string;
  assetName: string;
  maintenancePlanId: string;
  sourceAssessmentId: string;
  version: number;
  horizonYears: number;
  objective: string;
  adoptedAction: "apply_recommended" | "retain_current" | "defer";
  adoptedStrategy: Record<string, unknown>;
  adoptionNote: string;
  adoptedBy: string;
  adoptedAt: string;
}

export interface StrategyReviewer {
  id: string;
  name: string | null;
  email: string | null;
  role: "reliability_engineer" | "admin";
}

export interface AssetStrategyWorkspace {
  plans: AssetStrategyPlan[];
  assessments: AssetStrategyAssessment[];
  lifecyclePlans: AssetLifecyclePlan[];
  reviewers: StrategyReviewer[];
  learning: AssetStrategyLearningState[];
  learningBoundary: {
    refreshesAssessment: true;
    changesMaintenancePlan: false;
    createsWork: false;
    acceptsRisk: false;
    commitsSpend: false;
    changesOperatingLimits: false;
    returnsToService: false;
    requiresIndependentReviewAndHumanAdoption: true;
  };
  basis: string;
}

function rpcError(data: unknown): string | null {
  if (data && typeof data === "object" && "error" in data) {
    const value = (data as { error?: unknown }).error;
    return typeof value === "string" ? value : "Asset-strategy request failed.";
  }
  return null;
}

export async function loadAssetStrategyWorkspace(): Promise<AssetStrategyWorkspace> {
  const { data, error } = await supabase.rpc("get_asset_strategy_workspace_v2");
  if (error) throw new Error(error.message);
  const issue = rpcError(data);
  if (issue) throw new Error(issue);
  return data as AssetStrategyWorkspace;
}

export async function recordAssetStrategyContext(input: {
  planId: string;
  componentScope: string;
  failureMode: string;
  strategyKind: StrategyKind;
  plannedTaskCostUsd: number | null;
  failureConsequenceCostUsd: number | null;
  costBasis: string;
  safetyCritical: boolean;
  regulatoryRequired: boolean;
  lifecycleObjective: string;
}): Promise<{ planId: string; version: number; status: string }> {
  const { data, error } = await supabase.rpc("record_asset_strategy_context", {
    p_plan_id: input.planId,
    p_component_scope: input.componentScope,
    p_failure_mode: input.failureMode,
    p_strategy_kind: input.strategyKind,
    p_planned_task_cost_usd: input.plannedTaskCostUsd,
    p_failure_consequence_cost_usd: input.failureConsequenceCostUsd,
    p_cost_basis: input.costBasis,
    p_safety_critical: input.safetyCritical,
    p_regulatory_required: input.regulatoryRequired,
    p_lifecycle_objective: input.lifecycleObjective,
  });
  if (error) throw new Error(error.message);
  const issue = rpcError(data);
  if (issue) throw new Error(issue);
  return data as { planId: string; version: number; status: string };
}

export async function runAssetStrategyAgent(planId: string): Promise<{
  assessment_id: string;
  run_id: string;
  analysis: AssetStrategyAnalysis;
  advisory: true;
  may_change_pm_interval: false;
  may_deactivate_task: false;
  may_approve_strategy: false;
}> {
  const { data, error } = await supabase.functions.invoke(
    "calculation-service",
    {
      body: { action: "asset_strategy", planId },
    },
  );
  if (error) throw new Error(error.message);
  const issue = rpcError(data);
  if (issue) throw new Error(issue);
  return data as {
    assessment_id: string;
    run_id: string;
    analysis: AssetStrategyAnalysis;
    advisory: true;
    may_change_pm_interval: false;
    may_deactivate_task: false;
    may_approve_strategy: false;
  };
}

export async function assignAssetStrategyReview(input: {
  assessmentId: string;
  assignedTo: string;
  dueDate: string;
  note: string;
}) {
  const { data, error } = await supabase.rpc("assign_asset_strategy_review", {
    p_assessment_id: input.assessmentId,
    p_assigned_to: input.assignedTo,
    p_due_date: input.dueDate,
    p_note: input.note,
  });
  if (error) throw new Error(error.message);
  const issue = rpcError(data);
  if (issue) throw new Error(issue);
  return data;
}

export async function adoptAssetStrategyAssessment(input: {
  assessmentId: string;
  action: "apply_recommended" | "retain_current" | "defer";
  horizonYears: number;
  objective: string;
  note: string;
}) {
  const { data, error } = await supabase.rpc(
    "adopt_asset_strategy_assessment",
    {
      p_assessment_id: input.assessmentId,
      p_action: input.action,
      p_horizon_years: input.horizonYears,
      p_objective: input.objective,
      p_note: input.note,
    },
  );
  if (error) throw new Error(error.message);
  const issue = rpcError(data);
  if (issue) throw new Error(issue);
  return data;
}
