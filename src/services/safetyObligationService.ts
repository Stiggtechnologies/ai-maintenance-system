import { supabase } from "../lib/supabase";

export interface SafetyElement {
  id: number;
  ref: string;
  label: string;
  barrier_kind: string;
  barrier_role: string;
  performance_standard: string | null;
  asset_id: string | null;
  asset_name: string | null;
}
export interface RegulatoryRequirement {
  id: number;
  ref: string;
  regulator: string;
  jurisdiction: string;
  instrument: string;
  permit_type: string;
  description: string;
  status: string;
  case_id: string;
  case_title: string;
}
export interface SafetyObligationLink {
  sce_id: number;
  requirement_id: number;
  applicability_status: string;
  basis: string;
  evidence_item_ids: string[];
  missing_evidence: string[];
  updated_at: string;
}
export interface SafetyObligationWorkspace {
  elements: SafetyElement[];
  requirements: RegulatoryRequirement[];
  links: SafetyObligationLink[];
  evidence: Array<{
    id: string;
    description: string;
    verification_status: string;
  }>;
  authority_boundary: string;
}
function checked<T>(value: unknown): T {
  const result = value as { error?: string };
  if (result?.error) throw new Error(result.error);
  return value as T;
}
export async function getSafetyObligationRegister() {
  const { data, error } = await supabase.rpc("get_safety_obligation_register");
  if (error) throw new Error(error.message);
  return checked<SafetyObligationWorkspace>(data);
}
export async function saveSafetyCriticalObligation(input: {
  sceId: number;
  requirementId: number;
  applicabilityStatus: string;
  basis: string;
  evidenceItemIds: string[];
  missingEvidence: string[];
}) {
  const { data, error } = await supabase.rpc(
    "save_safety_critical_obligation",
    {
      p_sce_id: input.sceId,
      p_requirement_id: input.requirementId,
      p_applicability_status: input.applicabilityStatus,
      p_basis: input.basis,
      p_evidence_item_ids: input.evidenceItemIds,
      p_missing_evidence: input.missingEvidence,
    },
  );
  if (error) throw new Error(error.message);
  return checked<Record<string, unknown>>(data);
}
