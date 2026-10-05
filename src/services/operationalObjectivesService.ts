import { supabase } from "../lib/supabase";

export type RamObjectiveDecision = "verified" | "rejected";
export type RamObjectiveStatus =
  "proposed" | RamObjectiveDecision | "superseded";

export interface OperationalRequirementOption {
  id: number;
  reference: string;
  requirement: string;
  category: string;
  projectId: number | null;
  assetId: string | null;
  assetName: string | null;
  ownerId: string | null;
  acceptanceCriteria: string | null;
  verificationMethod: string | null;
  objectiveId: string | null;
  objectiveDescription: string | null;
  objectiveTarget: string | null;
  objectiveMeasurement: string | null;
  objectiveTimeframe: string | null;
  objectiveTolerance: string | null;
  operatingKpiKey: string | null;
  operatingKpiName: string | null;
  eligible: boolean;
  gaps: string[];
}

export interface LifecyclePlanOption {
  id: string;
  assetId: string;
  assetName: string;
  version: number;
  horizonYears: number;
  objective: string;
  adoptedAt: string;
}

export interface OperationalObjectiveEvidence {
  id: string;
  assetId: string;
  description: string;
  evidenceClass: string | null;
  verifiedAt: string;
}

export interface OperationalRamTranslation {
  id: number;
  requirementId: number;
  requirementRef: string;
  assetName: string;
  systemLabel: string;
  status: RamObjectiveStatus;
  revision: number;
  objectiveTarget: string;
  operatingKpiKey: string;
  lifecycleObjective: string;
  lifecycleHorizonYears: number;
  availabilityTarget: number;
  reliabilityTarget: number;
  reliabilityUnit: string;
  maintainabilityTarget: number;
  maintainabilityUnit: string;
  maintainabilityMeasure: string;
  basis: string;
  proposedBy: string;
  proposedAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
}

export interface OperationalObjectiveWorkspace {
  requirements: OperationalRequirementOption[];
  lifecyclePlans: LifecyclePlanOption[];
  verifiedEvidence: OperationalObjectiveEvidence[];
  translations: OperationalRamTranslation[];
  authority: {
    namedHumanProposal: boolean;
    independentReview: boolean;
    mayChangeWork: boolean;
    mayApprove: boolean;
    mayAcceptRisk: boolean;
    mayCommitSpend: boolean;
    mayChangeOperatingLimits: boolean;
    mayReturnToService: boolean;
  };
}

function responseError(value: unknown): string | null {
  if (!value || typeof value !== "object" || !("error" in value)) return null;
  const message = (value as { error?: unknown }).error;
  return typeof message === "string"
    ? message
    : "The governed RAM-objective action failed.";
}

async function governedRpc<T>(
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  const message = responseError(data);
  if (message) throw new Error(message);
  return data as T;
}

export function loadOperationalObjectiveWorkspace(): Promise<OperationalObjectiveWorkspace> {
  return governedRpc("get_operational_requirement_objective_workspace");
}

export function proposeOperationalRamObjective(input: {
  requirementId: number;
  lifecyclePlanId: string;
  evidenceItemId: string;
  systemLabel: string;
  availabilityTarget: number;
  reliabilityTarget: number;
  reliabilityUnit: string;
  maintainabilityTarget: number;
  maintainabilityUnit: string;
  maintainabilityMeasure: string;
  configuration: "series" | "parallel" | "mixed";
  basis: string;
}): Promise<{
  ramTargetId: number;
  status: "proposed";
  revision: number;
}> {
  return governedRpc("propose_operational_ram_objective", {
    p_requirement_id: input.requirementId,
    p_lifecycle_plan_id: input.lifecyclePlanId,
    p_evidence_item_id: input.evidenceItemId,
    p_system_label: input.systemLabel,
    p_availability_target: input.availabilityTarget,
    p_reliability_target: input.reliabilityTarget,
    p_reliability_unit: input.reliabilityUnit,
    p_maintainability_target: input.maintainabilityTarget,
    p_maintainability_unit: input.maintainabilityUnit,
    p_maintainability_measure: input.maintainabilityMeasure,
    p_configuration: input.configuration,
    p_basis: input.basis,
  });
}

export function reviewOperationalRamObjective(input: {
  ramTargetId: number;
  decision: RamObjectiveDecision;
  reviewNote: string;
}): Promise<{ ramTargetId: number; status: RamObjectiveDecision }> {
  return governedRpc("review_operational_ram_objective", {
    p_ram_target_id: input.ramTargetId,
    p_decision: input.decision,
    p_review_note: input.reviewNote,
  });
}
