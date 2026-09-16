import type { DevelopmentPortfolioRow } from "../lib/develop/developmentPortfolio";
import {
  analyzeProgramSchedule,
  type ProgramScheduleAnalysis,
} from "../lib/develop/programPortfolio";
import { supabase } from "../lib/supabase";

export type ProgramDependencyKind =
  | "finish_to_start"
  | "shared_resource"
  | "shared_interface"
  | "shared_shutdown"
  | "regulatory_sequence";

export interface DevelopmentProgramWorkspace {
  programs: Array<{ id: string; code: string; title: string; status: string }>;
  program: null | {
    id: string;
    code: string;
    title: string;
    status: string;
    sharedObjectiveId: string;
    sharedOutcomeLabel: string;
    sharedOutcomeTarget: number;
    sharedOutcomeUnit: string;
    outcomeCapacityLimit: number | null;
    outcomeBasis: string;
    evidenceItemId: string;
    ownerId: string;
    targetStart: string | null;
    targetFinish: string | null;
  };
  projects: Array<{
    caseId: string;
    capitalProjectId: number | null;
    title: string;
    status: string;
    contributionBasis: string;
    durationMonths: number | null;
    earliestStart: string | null;
    latestStart: string | null;
    durationSource: string | null;
    claimedOutcome: number;
    verifiedClaimedOutcome: number;
    mismatchedBenefitCount: number;
  }>;
  dependencies: Array<{
    id: string;
    predecessorCaseId: string;
    successorCaseId: string;
    kind: ProgramDependencyKind;
    basis: string;
    evidenceItemId: string;
  }>;
  benefitIntegrity: null | {
    claimedOutcome: number;
    verifiedClaimedOutcome: number;
    target: number;
    capacityLimit: number | null;
    unit: string;
    mismatchedBenefitCount: number;
    assessable: boolean;
    potentialDoubleCount: number | null;
    constraintAdjustedClaim: number | null;
    programOutcomeAtRisk: boolean | null;
    interpretation: string;
  };
  availableCases: Array<{ id: string; title: string; status: string }>;
  adoptedObjectives: Array<{
    id: string;
    label: string;
    target: string;
    measurement: string;
  }>;
  members: Array<{ id: string; name: string; role: string }>;
  verifiedEvidence: Array<{
    id: string;
    label: string;
    type: string | null;
    verifiedAt: string | null;
  }>;
  decisionBoundary: string;
}

function assertResult<T>(data: unknown, error: { message: string } | null): T {
  if (error) throw new Error(error.message);
  const value = data as T & { error?: string };
  if (value?.error) throw new Error(value.error);
  return value;
}

export async function getDevelopmentProgramWorkspace(
  programId?: string,
): Promise<DevelopmentProgramWorkspace> {
  const { data, error } = await supabase.rpc(
    "get_development_program_workspace",
    { p_program_id: programId ?? null },
  );
  return assertResult(data, error);
}

export async function createDevelopmentProgram(input: {
  programCode: string;
  title: string;
  sharedObjectiveId: string;
  ownerId: string;
  sharedOutcomeLabel: string;
  sharedOutcomeTarget: number;
  sharedOutcomeUnit: string;
  outcomeCapacityLimit: number | null;
  outcomeBasis: string;
  evidenceItemId: string;
  targetStart: string | null;
  targetFinish: string | null;
}): Promise<{ programId: string; status: "draft" }> {
  const { data, error } = await supabase.rpc("create_development_program", {
    p_program: input,
  });
  return assertResult(data, error);
}

export async function addProjectToDevelopmentProgram(input: {
  programId: string;
  caseId: string;
  contributionBasis: string;
}): Promise<void> {
  const { data, error } = await supabase.rpc(
    "add_project_to_development_program",
    {
      p_program_id: input.programId,
      p_case_id: input.caseId,
      p_contribution_basis: input.contributionBasis,
    },
  );
  assertResult(data, error);
}

export async function recordDevelopmentProjectDependency(input: {
  programId: string;
  predecessorCaseId: string;
  successorCaseId: string;
  dependencyKind: ProgramDependencyKind;
  basis: string;
  evidenceItemId: string;
}): Promise<void> {
  const { data, error } = await supabase.rpc(
    "record_development_project_dependency",
    {
      p_program_id: input.programId,
      p_predecessor_case_id: input.predecessorCaseId,
      p_successor_case_id: input.successorCaseId,
      p_dependency_kind: input.dependencyKind,
      p_basis: input.basis,
      p_evidence_item_id: input.evidenceItemId,
    },
  );
  assertResult(data, error);
}

export function analyzeDevelopmentProgramSchedule(
  workspace: DevelopmentProgramWorkspace,
  portfolioRows: DevelopmentPortfolioRow[],
): ProgramScheduleAnalysis {
  const rows = new Map(portfolioRows.map((row) => [row.caseId, row]));
  return analyzeProgramSchedule(
    workspace.projects.map((project) => ({
      caseId: project.caseId,
      title: project.title,
      durationMonths: project.durationMonths,
      earliestStart: project.earliestStart,
      standaloneFinish:
        rows.get(project.caseId)?.scheduleForecast.p80Finish ??
        rows.get(project.caseId)?.scheduleForecast.deterministicFinish ??
        null,
    })),
    workspace.dependencies.map((dependency) => ({
      predecessorCaseId: dependency.predecessorCaseId,
      successorCaseId: dependency.successorCaseId,
    })),
  );
}
