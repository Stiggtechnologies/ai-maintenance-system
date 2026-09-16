import { supabase } from "../lib/supabase";

export const PORTFOLIO_CATEGORIES = [
  "sustaining_capital",
  "growth_capital",
  "regulatory_capital",
  "reliability",
  "obsolescence",
  "decarbonization",
  "safety_risk",
  "life_extension",
  "modernization",
  "capacity",
  "decommissioning",
] as const;

export type PortfolioCategory = (typeof PORTFOLIO_CATEGORIES)[number];

export interface PortfolioCandidate {
  id: number | null;
  developmentCaseId: string;
  title: string;
  status: string;
  category: PortfolioCategory | null;
  currency: string | null;
  cost: number | null;
  costLow: number | null;
  costHigh: number | null;
  benefit: number | null;
  benefitLow: number | null;
  benefitHigh: number | null;
  benefitProbability: number | null;
  riskReductionValue: number | null;
  mandatory: boolean | null;
  mandatoryBasis: string | null;
  earliestStart: string | null;
  latestStart: string | null;
  durationMonths: number | null;
  evidenceItemId: string | null;
  constraintNote: string | null;
}

export interface PortfolioSelection {
  caseId: string;
  title: string;
  category: PortfolioCategory;
  cost: number;
  riskAdjustedValue: number;
  mandatory: boolean;
  evidenceItemId: string;
  earliestStart: string;
  latestStart: string;
  durationMonths: number;
}

export interface PortfolioRun {
  calculationRunId: string;
  planYear: number;
  currency: string;
  budget: number;
  selected: PortfolioSelection[];
  deferred: Array<{
    caseId: string;
    title: string;
    category: PortfolioCategory;
    reason: string;
  }>;
  selectedCount: number;
  candidateCount: number;
  cost: { low: number; base: number; high: number };
  riskAdjustedValue: { low: number; base: number; high: number };
  remainingBudget: number;
  globallyOptimal: false;
  operationalAuthorization: false;
  method: string;
  refusals: string[];
}

export interface PortfolioWorkspace {
  planYear: number;
  categories: PortfolioCategory[];
  candidates: PortfolioCandidate[];
  latestRun: {
    id: string;
    outputs: Omit<PortfolioRun, "calculationRunId" | "refusals">;
    refusals: string[];
    status: string;
    computedAt: string;
    recommendationId: string | null;
  } | null;
  decisionBoundary: string;
}

function assertResult<T>(data: unknown, error: { message: string } | null): T {
  if (error) throw new Error(error.message);
  const value = data as T & { error?: string };
  if (value?.error) throw new Error(value.error);
  return value;
}

export async function getEnterprisePortfolioWorkspace(
  planYear?: number,
): Promise<PortfolioWorkspace> {
  const { data, error } = await supabase.rpc(
    "get_enterprise_portfolio_workspace",
    { p_plan_year: planYear ?? undefined },
  );
  return assertResult<PortfolioWorkspace>(data, error);
}

export async function configurePortfolioCandidate(
  candidate: Record<string, unknown>,
): Promise<{ capitalPlanItemId: number; status: string }> {
  const { data, error } = await supabase.rpc("configure_portfolio_candidate", {
    p_candidate: candidate,
  });
  return assertResult(data, error);
}

export async function runEnterprisePortfolioOptimization(input: {
  planYear: number;
  budget: number;
  currency: string;
}): Promise<PortfolioRun> {
  const { data, error } = await supabase.rpc(
    "run_enterprise_portfolio_optimization",
    {
      p_plan_year: input.planYear,
      p_budget: input.budget,
      p_currency: input.currency,
    },
  );
  return assertResult(data, error);
}

export async function proposeEnterprisePortfolioPlan(
  calculationRunId: string,
  rationale: string,
): Promise<{
  recommendationId: string;
  approvalId: string;
  status: "pending_human_review";
  fundsCommitted: false;
  projectsSanctioned: false;
}> {
  const { data, error } = await supabase.rpc(
    "propose_enterprise_portfolio_plan",
    { p_calculation_run_id: calculationRunId, p_rationale: rationale },
  );
  return assertResult(data, error);
}
