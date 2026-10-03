import { supabase } from "../lib/supabase";

export interface TrainingPlanLifecycleRow {
  planId: number;
  memberId: number;
  memberName: string;
  competencyId: number;
  competencyTitle: string;
  planKind: string;
  targetDate: string | null;
  status:
    | "planned"
    | "in_progress"
    | "complete"
    | "abandoned"
    | "cancelled"
    | "superseded";
  driver: string | null;
  version: number;
  lifecycleBasis: string | null;
  completionEvidenceReference: string | null;
  supersedesPlanId: number | null;
  supersededByPlanId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface LabourRuleLifecycleRow {
  ruleId: number;
  ruleKey: string;
  title: string;
  source:
    "statutory" | "labour_agreement" | "company_standard" | "fatigue_science";
  limitKind:
    | "max_consecutive_days"
    | "max_hours_per_shift"
    | "min_rest_hours_between_shifts"
    | "max_hours_per_7_days"
    | "max_hours_per_14_days"
    | "max_consecutive_nights";
  limitValue: number;
  appliesToCraft: string | null;
  reference: string | null;
  status: "draft" | "adopted" | "retired" | "superseded";
  version: number;
  basis: string | null;
  evidenceReference: string | null;
  effectiveFrom: string | null;
  effectiveUntil: string | null;
  recordedBy: string | null;
  adoptedBy: string | null;
  adoptedAt: string | null;
  retiredAt: string | null;
  decisionBasis: string | null;
  supersedesRuleId: number | null;
}

export interface WorkforceGovernanceWorkspace {
  answered: boolean;
  refusal?: string;
  trainingPlans: TrainingPlanLifecycleRow[];
  labourRules: LabourRuleLifecycleRow[];
  effectiveRuleCount: number;
  boundary: string;
}

export interface WorkforceGovernanceAction {
  answered: boolean;
  refusal?: string;
  note?: string;
  trainingPlanId?: number;
  labourRuleId?: number;
  status?: string;
  version?: number;
  replacementPlanId?: number | null;
  competencyGranted?: boolean;
}

function unwrap<T extends { answered?: boolean; refusal?: string }>(
  data: unknown,
  error: { message: string } | null,
): T {
  if (error) throw new Error(error.message);
  const result = data as T | null;
  if (!result)
    throw new Error("The workforce governance service returned no result.");
  if (result.answered === false)
    throw new Error(
      result.refusal ?? "The workforce governance action was refused.",
    );
  return result;
}

export async function getWorkforceGovernanceWorkspace(): Promise<WorkforceGovernanceWorkspace> {
  const { data, error } = await supabase.rpc(
    "get_workforce_governance_workspace",
  );
  return unwrap<WorkforceGovernanceWorkspace>(data, error);
}

export async function transitionTrainingPlan(input: {
  planId: number;
  action: "start" | "complete" | "cancel" | "supersede";
  basis: string;
  evidenceReference?: string;
  replacementTargetDate?: string;
  replacementDriver?: string;
  expectedVersion: number;
}): Promise<WorkforceGovernanceAction> {
  const { data, error } = await supabase.rpc("transition_training_plan", {
    p_plan_id: input.planId,
    p_action: input.action,
    p_basis: input.basis,
    p_evidence_reference: input.evidenceReference ?? null,
    p_replacement_target_date: input.replacementTargetDate ?? null,
    p_replacement_driver: input.replacementDriver ?? null,
    p_expected_version: input.expectedVersion,
  });
  return unwrap<WorkforceGovernanceAction>(data, error);
}

export async function recordLabourRule(input: {
  ruleKey: string;
  title: string;
  source: LabourRuleLifecycleRow["source"];
  limitKind: LabourRuleLifecycleRow["limitKind"];
  limitValue: string;
  appliesToCraft?: string;
  reference?: string;
  basis: string;
  evidenceReference: string;
  effectiveFrom: string;
  effectiveUntil?: string;
}): Promise<WorkforceGovernanceAction> {
  const { data, error } = await supabase.rpc("record_labour_rule", {
    p_payload: input,
  });
  return unwrap<WorkforceGovernanceAction>(data, error);
}

export async function decideLabourRule(input: {
  ruleId: number;
  decision: "adopt" | "retire";
  note: string;
}): Promise<WorkforceGovernanceAction> {
  const { data, error } = await supabase.rpc("decide_labour_rule", {
    p_rule_id: input.ruleId,
    p_decision: input.decision,
    p_note: input.note,
  });
  return unwrap<WorkforceGovernanceAction>(data, error);
}
