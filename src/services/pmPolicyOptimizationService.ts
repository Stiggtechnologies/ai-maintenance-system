import type { PmPolicyResult } from "../lib/optimization/pm-policies";
import { supabase } from "../lib/supabase";

export interface PmPolicyPlan {
  id: string;
  taskLabel: string;
  componentScope: string | null;
  version: number;
  plannedItemCost: number | null;
  failureCost: number | null;
  costBasis: string | null;
  safetyCritical: boolean | null;
  regulatoryRequired: boolean | null;
  intervalBasis: "calendar_days" | "run_hours";
  intervalValue: number;
  failureEvents: number;
  suspensionEvents: number;
}

export interface PmGroupingBasis {
  id: string;
  version: number;
  sharedAccessCostUsd: number;
  accessExcludedFromTaskCosts: boolean;
  basis: string;
  recordedAt: string;
}

export interface PmPolicyAsset {
  id: string;
  name: string;
  tag: string | null;
  groupingBasis: PmGroupingBasis | null;
  plans: PmPolicyPlan[];
}

export interface PmPolicyAssignment {
  id: string;
  assignedTo: string;
  reviewerName: string | null;
  reviewerEmail: string | null;
  dueDate: string;
  note: string;
  assignedAt: string;
}

export interface PmPolicyAdoption {
  action: "record_policy" | "apply_standing_intervals";
  programmeChanged: boolean;
  appliedPlanIds: string[];
  note: string;
  adoptedBy: string;
  adoptedAt: string;
}

export interface PmPolicyAssessment {
  id: string;
  assetId: string;
  assetName: string;
  kernelVersion: string;
  selected: PmPolicyResult["selected"];
  analysis: PmPolicyResult;
  recommendation: PmPolicyResult["recommendation"];
  limitations: string[];
  createdBy: string;
  createdAt: string;
  groupingBasisId: string | null;
  groupingBasisVersion: number | null;
  assignments: PmPolicyAssignment[];
  adoption: PmPolicyAdoption | null;
}

export interface PmPolicyReviewer {
  id: string;
  name: string | null;
  email: string | null;
  role: string;
}

export interface PmPolicyWorkspace {
  assets: PmPolicyAsset[];
  assessments: PmPolicyAssessment[];
  reviewers: PmPolicyReviewer[];
  basis: string;
}

function rpcError(payload: unknown): string | null {
  if (payload && typeof payload === "object" && "error" in payload) {
    const error = (payload as { error?: unknown }).error;
    return typeof error === "string" ? error : "PM policy request failed.";
  }
  return null;
}

export async function loadPmPolicyWorkspace(): Promise<PmPolicyWorkspace> {
  const { data, error } = await supabase.rpc("get_pm_policy_workspace");
  if (error) throw new Error(error.message);
  const issue = rpcError(data);
  if (issue) throw new Error(issue);
  return data as PmPolicyWorkspace;
}

export async function recordPmGroupingBasis(input: {
  assetId: string;
  sharedAccessCostUsd: number;
  accessExcludedFromTaskCosts: boolean;
  basis: string;
}): Promise<{ id: string; version: number }> {
  const { data, error } = await supabase.rpc("record_pm_grouping_basis", {
    p_asset_id: input.assetId,
    p_shared_access_cost_usd: input.sharedAccessCostUsd,
    p_access_excluded_from_task_costs: input.accessExcludedFromTaskCosts,
    p_basis: input.basis,
  });
  if (error) throw new Error(error.message);
  const issue = rpcError(data);
  if (issue) throw new Error(issue);
  return data as { id: string; version: number };
}

export async function runPmPolicyOptimization(assetId: string): Promise<{
  assessment_id: string;
  analysis: PmPolicyResult;
  advisory: true;
  may_change_pm_interval: false;
}> {
  const { data, error } = await supabase.functions.invoke(
    "calculation-service",
    {
      body: { action: "pm_policy", assetId },
    },
  );
  if (error) throw new Error(error.message);
  const issue = rpcError(data);
  if (issue) throw new Error(issue);
  return data as {
    assessment_id: string;
    analysis: PmPolicyResult;
    advisory: true;
    may_change_pm_interval: false;
  };
}

export async function assignPmPolicyReview(input: {
  assessmentId: string;
  assignedTo: string;
  dueDate: string;
  note: string;
}) {
  const { data, error } = await supabase.rpc("assign_pm_policy_review", {
    p_assessment_id: input.assessmentId,
    p_assigned_to: input.assignedTo,
    p_due_date: input.dueDate,
    p_note: input.note,
  });
  if (error) throw new Error(error.message);
  const issue = rpcError(data);
  if (issue) throw new Error(issue);
  return data as { assignmentId: string };
}

export async function adoptPmPolicyAssessment(input: {
  assessmentId: string;
  action: "record_policy" | "apply_standing_intervals";
  note: string;
}) {
  const { data, error } = await supabase.rpc("adopt_pm_policy_assessment", {
    p_assessment_id: input.assessmentId,
    p_action: input.action,
    p_note: input.note,
  });
  if (error) throw new Error(error.message);
  const issue = rpcError(data);
  if (issue) throw new Error(issue);
  return data as { programmeChanged: boolean; action: string };
}
