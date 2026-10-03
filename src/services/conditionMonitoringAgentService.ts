import { supabase } from "../lib/supabase";

export interface ConditionAgentSensor {
  sensorId: string;
  name: string;
  signalType: string | null;
  unit: string | null;
  detectionTechnique: string | null;
  warningLimit: number | null;
  alarmLimit: number | null;
  limitDirection: "above" | "below";
  assetTag: string;
  latestAt: string | null;
  readingCount: number;
}

export interface ConditionAgentMember {
  id: string;
  name: string;
  role: string;
}

export interface ConditionEvidenceGap {
  code: string;
  severity: "blocker" | "attention" | "disclosure";
  detail: string;
}

export interface ConditionEvidencePlanStep {
  sequence: number;
  question: string;
  owner: string;
  completion: string;
}

export interface ConditionAgentAssessment {
  modality:
    | "vibration"
    | "oil_analysis"
    | "thermography"
    | "motor_current"
    | "process_anomaly";
  signalState:
    | "insufficient_evidence"
    | "alarm_exceedance"
    | "warning_exceedance"
    | "within_configured_limits";
  trend:
    "insufficient_evidence" | "no_material_24h_change" | "rising" | "falling";
  latest: { value: number; unit: string | null; takenAt: string } | null;
  slopePerHour: number | null;
  population: {
    retained: number;
    good: number;
    nonGood: number;
    contextKnown: number;
    connectorBacked: number;
  };
  evidenceGaps: ConditionEvidenceGap[];
  evidencePlan: ConditionEvidencePlanStep[];
  interpretation: string;
  limitations: string[];
  humanReviewRequired: true;
  mayDiagnoseFailure: false;
  mayChangeLimits: false;
  mayCreateOrReleaseWork: false;
  mayChangeMaintenanceInterval: false;
  mayAcceptRisk: false;
  mayReturnToService: false;
}

export interface ConditionReviewAssignment {
  assignmentId: string;
  assignedTo: string;
  ownerName: string;
  dueDate: string;
  note: string;
}

export interface ConditionAgentPack {
  packId: string;
  sensorId: string;
  sensorName: string;
  signalType: string | null;
  unit: string | null;
  assetTag: string;
  agentRunId: string;
  windowDays: number;
  assessment: ConditionAgentAssessment;
  createdAt: string;
  assignment: ConditionReviewAssignment | null;
}

export interface ConditionAgentWorkspace {
  sensors: ConditionAgentSensor[];
  packs: ConditionAgentPack[];
  members: ConditionAgentMember[];
  basis: string;
}

function rpcError(value: unknown): string | null {
  if (value && typeof value === "object" && "error" in value) {
    const error = (value as { error?: unknown }).error;
    return typeof error === "string"
      ? error
      : "The governed condition action failed.";
  }
  return null;
}

export async function loadConditionAgentWorkspace(): Promise<ConditionAgentWorkspace> {
  const { data, error } = await supabase.rpc(
    "get_condition_monitoring_agent_workspace",
    { p_limit: 50 },
  );
  if (error) throw new Error(error.message);
  const message = rpcError(data);
  if (message) throw new Error(message);
  const value =
    data && typeof data === "object"
      ? (data as Partial<ConditionAgentWorkspace>)
      : {};
  return {
    sensors: Array.isArray(value.sensors) ? value.sensors : [],
    packs: Array.isArray(value.packs) ? value.packs : [],
    members: Array.isArray(value.members) ? value.members : [],
    basis:
      typeof value.basis === "string"
        ? value.basis
        : "No governed condition-agent workspace is available.",
  };
}

export async function runConditionMonitoringAgent(input: {
  sensorId: string;
  windowDays: number;
}): Promise<void> {
  const { data, error } = await supabase.rpc("run_condition_monitoring_agent", {
    p_sensor_id: input.sensorId,
    p_window_days: input.windowDays,
    p_limit: 120,
  });
  if (error) throw new Error(error.message);
  const message = rpcError(data);
  if (message) throw new Error(message);
}

export async function assignConditionMonitoringReview(input: {
  packId: string;
  assignedTo: string;
  dueDate: string;
  note: string;
}): Promise<void> {
  const { data, error } = await supabase.rpc(
    "assign_condition_monitoring_review",
    {
      p_pack_id: input.packId,
      p_assigned_to: input.assignedTo,
      p_due_date: input.dueDate,
      p_note: input.note,
    },
  );
  if (error) throw new Error(error.message);
  const message = rpcError(data);
  if (message) throw new Error(message);
}
