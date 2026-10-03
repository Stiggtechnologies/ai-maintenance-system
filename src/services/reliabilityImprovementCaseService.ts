import { supabase } from "../lib/supabase";

export interface ReliabilityImprovementPack {
  packId: string;
  workOrderId: string;
  workOrderNumber: string | null;
  createdAt: string;
  assignedTo: string | null;
  ownerName: string | null;
  dueDate: string | null;
  caseId: string | null;
  caseStatus: string | null;
}

export interface ReliabilityImprovementAsset {
  rank: number;
  assetId: string;
  assetTag: string;
  name: string;
  criticality: string | null;
  correctiveEvents: number;
  downtimeHours: number;
  codedEvents: number;
  uncodedEvents: number;
  latestFailureAt: string;
  fracasPacks: ReliabilityImprovementPack[];
}

export interface ReliabilityImprovementFramework {
  id: string;
  name: string;
  version: number;
  sourceAuthority: string;
}

export interface ReliabilityImprovementWorkspace {
  windowDays: number;
  windowStart: string | null;
  dataThrough: string | null;
  rankedAssets: ReliabilityImprovementAsset[];
  frameworks: ReliabilityImprovementFramework[];
  rankingBasis: string;
  nextStep: string;
  humanApprovalRequired: true;
  mayApproveStrategy: false;
  mayAuthorizeWork: false;
  maySanctionCase: false;
}

export interface ReliabilityImprovementCaseResult {
  linkId: string;
  caseId: string;
  assetId: string;
  existing: boolean;
  route: string;
  nextStep?: string;
  humanApprovalRequired: true;
  mayApproveStrategy: false;
  mayAuthorizeWork: false;
  maySanctionCase: false;
}

function unwrap<T>(data: unknown, error: { message: string } | null): T {
  if (error) throw new Error(error.message);
  if (data && typeof data === "object" && "error" in data) {
    throw new Error(String((data as { error: unknown }).error));
  }
  return data as T;
}

export async function loadReliabilityImprovementWorkspace(
  windowDays = 365,
): Promise<ReliabilityImprovementWorkspace> {
  const { data, error } = await supabase.rpc(
    "get_reliability_improvement_workspace",
    { p_window_days: windowDays },
  );
  return unwrap(data, error);
}

export async function startReliabilityImprovementCase(input: {
  fracasPackId: string;
  title: string;
  problemStatement: string;
  opportunityStatement?: string | null;
  frameworkId?: string | null;
}): Promise<ReliabilityImprovementCaseResult> {
  const { data, error } = await supabase.rpc(
    "start_reliability_improvement_case",
    {
      p_fracas_pack_id: input.fracasPackId,
      p_title: input.title,
      p_problem_statement: input.problemStatement,
      p_opportunity_statement: input.opportunityStatement ?? null,
      p_framework_id: input.frameworkId ?? null,
    },
  );
  return unwrap(data, error);
}
