import { supabase } from "../lib/supabase";

export type DefectEliminationDisposition =
  "pursue_elimination" | "retain_and_monitor" | "defer_for_evidence";

export interface DefectEliminationBoundaries {
  mayCreateWork: false;
  mayChangePmInterval: false;
  mayApproveStrategy: false;
  mayAcceptRisk: false;
  mayCommitSpend: false;
  mayReturnToService: false;
}

export interface DefectEliminationCandidate {
  assetId: string;
  assetTag: string;
  ready: boolean;
  gaps: string[];
  fracasPackId: string | null;
  workOrderNumber: string | null;
  assignmentId: string | null;
  investigatorName: string | null;
  callerIsInvestigator: boolean;
  strategyAssessmentId: string | null;
  recommendationKind: string | null;
  pmKernelVersion: string | null;
  lifeReportId: string | null;
  weibullMethod: string | null;
  beta: number | null;
  eta: number | null;
  component: string | null;
  lifeKernelVersion: string | null;
}

export interface DefectEliminationDecision {
  id: string;
  assetId: string;
  assetTag: string;
  disposition: DefectEliminationDisposition;
  basisNote: string;
  governedAt: string;
  recommendationKind: string | null;
  weibullMethod: string | null;
  component: string | null;
  boundaries: DefectEliminationBoundaries;
}

export interface OrganizationEliminationMetric {
  available: boolean;
  eliminationRatePct: number | null;
  basis: string;
}

export interface DefectEliminationWorkspace {
  basis: string;
  boundaries: DefectEliminationBoundaries;
  reuse: {
    fracas: string;
    pmOptimization: string;
    weibull: string;
    elimination: string;
  };
  elimination: OrganizationEliminationMetric;
  candidates: DefectEliminationCandidate[];
  decisions: DefectEliminationDecision[];
}

function rpcError(value: unknown): string | null {
  if (value && typeof value === "object" && "error" in value) {
    const error = (value as { error?: unknown }).error;
    return typeof error === "string" ? error : "The governed action failed.";
  }
  return null;
}

export async function loadDefectEliminationGovernance(): Promise<DefectEliminationWorkspace> {
  const { data, error } = await supabase.rpc(
    "get_defect_elimination_governance",
  );
  if (error) throw new Error(error.message);
  const message = rpcError(data);
  if (message) throw new Error(message);
  return data as DefectEliminationWorkspace;
}

export async function recordDefectEliminationGovernance(input: {
  assetId: string;
  fracasPackId: string;
  strategyAssessmentId: string;
  lifeReportId: string;
  disposition: DefectEliminationDisposition;
  basis: string;
}): Promise<void> {
  const { data, error } = await supabase.rpc(
    "record_defect_elimination_governance",
    {
      p_asset_id: input.assetId,
      p_fracas_pack_id: input.fracasPackId,
      p_strategy_assessment_id: input.strategyAssessmentId,
      p_life_report_id: input.lifeReportId,
      p_disposition: input.disposition,
      p_basis: input.basis,
    },
  );
  if (error) throw new Error(error.message);
  const message = rpcError(data);
  if (message) throw new Error(message);
}
