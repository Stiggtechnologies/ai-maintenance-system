import { supabase } from "../lib/supabase";

export const OPERATING_MODEL_DIMENSIONS = [
  "organization_structure", "staffing", "competencies", "shift_model",
  "maintenance_strategy", "supply_chain", "contractors", "warehouse",
  "engineering_support", "operations_procedures", "emergency_response",
  "it_ot_support", "budget",
] as const;

export const EVIDENCE_CLASSES = [
  "MEASURED", "INSPECTED", "CALCULATED", "TESTED", "DOCUMENTED",
  "HISTORICAL", "EXPERT_JUDGEMENT", "AI_INFERENCE",
] as const;

export interface OperatingModelDimension {
  dimension: string;
  sequence: number;
  status: "not_assessed" | "not_ready" | "at_risk" | "ready";
  version: number | null;
  ownerId: string | null;
  ownerName: string | null;
  evidenceReference: string | null;
  evidenceClass: string | null;
  basis: string | null;
  recordedBy: string | null;
  recordedAt: string | null;
}

export interface OperatingModelReadiness {
  dimensions: OperatingModelDimension[];
  dimensionCount: 13;
  readyCount: number;
  atRiskCount: number;
  notReadyCount: number;
  notAssessedCount: number;
  verdict: "READY" | "NOT_READY";
  decisionBoundary: string;
}

export async function getCaseOperatingModelReadiness(caseId: string) {
  const { data, error } = await supabase.rpc("get_case_operating_model_readiness", {
    p_case_id: caseId,
  });
  if (error) throw new Error(error.message);
  return data as OperatingModelReadiness;
}

export async function recordOperatingModelReadiness(caseId: string, input: {
  dimension: string;
  status: "not_ready" | "at_risk" | "ready";
  ownerId: string;
  evidenceReference: string;
  evidenceClass: string;
  basis: string;
}) {
  const { data, error } = await supabase.rpc("record_operating_model_readiness", {
    p_case_id: caseId,
    p_dimension: input.dimension,
    p_status: input.status,
    p_owner_id: input.ownerId,
    p_evidence_reference: input.evidenceReference,
    p_evidence_class: input.evidenceClass,
    p_basis: input.basis,
  });
  if (error) throw new Error(error.message);
  return data as { caseId: string; dimension: string; version: number; status: string };
}
