import { supabase } from "../lib/supabase";

export type MaintenanceInducedVerdict =
  "confirmed" | "rejected" | "inconclusive";

export type MaintenanceInducedCause =
  | "workmanship"
  | "reassembly"
  | "foreign_material"
  | "incorrect_part"
  | "incorrect_setting"
  | "maintenance_procedure"
  | "other_maintenance_origin";

export interface MaintenanceInducedReview {
  id: string;
  verdict: MaintenanceInducedVerdict;
  causeCode: MaintenanceInducedCause | null;
  basis: string;
  revision: number;
  reviewedBy: string;
  reviewedAt: string;
  exposureWindowHours: number;
  windowBasisEvidenceItemId: string;
  supportingEvidenceItemIds: string[];
}

export interface MaintenanceInducedCandidate {
  failureWorkOrderId: string;
  failureWorkOrderNumber: string;
  failureTitle: string;
  assetId: string;
  assetTag: string;
  assetName: string;
  mechanismKey: string;
  mechanismName: string;
  failureRecordedAt: string;
  failureCompletedAt: string;
  precedingWorkOrderId: string;
  precedingWorkOrderNumber: string;
  precedingTitle: string;
  precedingWorkType: string;
  precedingCompletedAt: string;
  observedGapHours: number;
  fracasInvestigationPackId: string | null;
  readyForReview: boolean;
  currentReview: MaintenanceInducedReview | null;
}

export interface MaintenanceInducedWorkspace {
  available: boolean;
  exposureWindowHours: number;
  candidateCount: number;
  reviewedCount: number;
  confirmedCount: number;
  rejectedCount: number;
  inconclusiveCount: number;
  basis: string;
  verifiedEvidence: Array<{
    id: string;
    description: string;
    evidenceClass: string | null;
    assetId: string | null;
    verifiedAt: string;
    verifiedBy: string;
    independentlyVerified: boolean;
    verificationMethod: string;
  }>;
  candidates: MaintenanceInducedCandidate[];
}

function resultError(value: unknown): string | null {
  if (!value || typeof value !== "object" || !("error" in value)) return null;
  const message = (value as { error?: unknown }).error;
  return typeof message === "string"
    ? message
    : "The governed classification failed.";
}

export async function loadMaintenanceInducedWorkspace(
  exposureWindowHours = 168,
): Promise<MaintenanceInducedWorkspace> {
  const { data, error } = await supabase.rpc(
    "get_maintenance_induced_failure_candidates",
    {
      p_exposure_window_hours: exposureWindowHours,
      p_limit: 50,
    },
  );
  if (error) throw new Error(error.message);
  const message = resultError(data);
  if (message) throw new Error(message);
  return data as MaintenanceInducedWorkspace;
}

export async function reviewMaintenanceInducedFailure(input: {
  candidate: MaintenanceInducedCandidate;
  verdict: MaintenanceInducedVerdict;
  causeCode: MaintenanceInducedCause | null;
  exposureWindowHours: number;
  windowBasisEvidenceItemId: string;
  supportingEvidenceItemIds: string[];
  basis: string;
}): Promise<void> {
  if (!input.candidate.fracasInvestigationPackId) {
    throw new Error(
      "Build and retain the FRACAS investigation before classifying this candidate.",
    );
  }
  const { data, error } = await supabase.rpc(
    "review_maintenance_induced_failure",
    {
      p_failure_work_order_id: input.candidate.failureWorkOrderId,
      p_preceding_work_order_id: input.candidate.precedingWorkOrderId,
      p_fracas_investigation_pack_id: input.candidate.fracasInvestigationPackId,
      p_verdict: input.verdict,
      p_cause_code: input.verdict === "confirmed" ? input.causeCode : null,
      p_exposure_window_hours: input.exposureWindowHours,
      p_window_basis_evidence_item_id: input.windowBasisEvidenceItemId,
      p_supporting_evidence_item_ids: input.supportingEvidenceItemIds,
      p_basis: input.basis,
    },
  );
  if (error) throw new Error(error.message);
  const message = resultError(data);
  if (message) throw new Error(message);
}
