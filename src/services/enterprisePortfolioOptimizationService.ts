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

export const PORTFOLIO_DIMENSIONS = [
  "regulatory_necessity",
  "safety_risk",
  "production_benefit",
  "reliability",
  "npv",
  "asset_life",
  "sustainability",
  "resource_demand",
  "execution_risk",
] as const;

export type PortfolioDimensionKey = (typeof PORTFOLIO_DIMENSIONS)[number];
export type PortfolioDimensions = Record<
  PortfolioDimensionKey,
  { score: number; basis: string }
>;

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
  portfolioDimensions?: PortfolioDimensions | null;
  dimensionCalibrationNote?: string | null;
}

export interface PortfolioFrontierAlternative {
  portfolioId: string;
  objective: string;
  selected: Array<{
    caseId: string;
    title: string;
    category: PortfolioCategory;
    cost: number;
    mandatory: boolean;
    evidenceItemId: string;
    dimensions: PortfolioDimensions;
  }>;
  deferred: Array<{
    caseId: string;
    title: string;
    category: PortfolioCategory;
    reason: string;
  }>;
  selectedCount: number;
  cost: { low: number; base: number; high: number };
  riskAdjustedValue: { low: number; base: number; high: number };
  dimensions: {
    regulatoryNecessity: number;
    safetyRisk: number;
    productionBenefit: number;
    reliability: number;
    npv: number;
    assetLife: number;
    sustainability: number;
    resourceDemand: number;
    executionRisk: number;
  };
}

export interface PortfolioFrontierRun {
  calculationRunId: string;
  planYear: number;
  currency: string;
  budget: number;
  candidateCount: number;
  feasiblePortfolioCount: number;
  frontierCount: number;
  frontier: PortfolioFrontierAlternative[];
  dimensions: PortfolioDimensionKey[];
  globallyOptimal: false;
  frontierExhaustive: false;
  operationalAuthorization: false;
  method: string;
  refusals: string[];
}

export interface LatestPortfolioFrontier {
  id: string;
  outputs: Omit<PortfolioFrontierRun, "calculationRunId" | "refusals">;
  refusals: string[];
  status: string;
  computedAt: string;
  recommendationId: string | null;
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

export async function configurePortfolioCandidateDimensions(input: {
  developmentCaseId: string;
  planYear: number;
  dimensions: PortfolioDimensions;
  calibrationNote: string;
}): Promise<{ capitalPlanItemId: number; status: string }> {
  const { data, error } = await supabase.rpc(
    "configure_portfolio_candidate_dimensions",
    {
      p_development_case_id: input.developmentCaseId,
      p_plan_year: input.planYear,
      p_dimensions: input.dimensions,
      p_calibration_note: input.calibrationNote,
    },
  );
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

export async function runEnterprisePortfolioFrontier(input: {
  planYear: number;
  budget: number;
  currency: string;
}): Promise<PortfolioFrontierRun> {
  const { data, error } = await supabase.rpc(
    "run_enterprise_portfolio_frontier",
    {
      p_plan_year: input.planYear,
      p_budget: input.budget,
      p_currency: input.currency,
    },
  );
  return assertResult(data, error);
}

export async function getEnterprisePortfolioFrontier(
  planYear?: number,
): Promise<LatestPortfolioFrontier | null> {
  const { data, error } = await supabase.rpc(
    "get_enterprise_portfolio_frontier",
    { p_plan_year: planYear ?? undefined },
  );
  if (error) throw new Error(error.message);
  const value = data as { error?: string } | null;
  if (value?.error) throw new Error(value.error);
  return data as LatestPortfolioFrontier | null;
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

export async function proposeEnterprisePortfolioFrontier(
  calculationRunId: string,
  portfolioId: string,
  rationale: string,
): Promise<{
  recommendationId: string;
  approvalId: string;
  portfolioId: string;
  status: "pending_human_review";
  fundsCommitted: false;
  projectsSanctioned: false;
}> {
  const { data, error } = await supabase.rpc(
    "propose_enterprise_portfolio_frontier",
    {
      p_calculation_run_id: calculationRunId,
      p_portfolio_id: portfolioId,
      p_rationale: rationale,
    },
  );
  return assertResult(data, error);
}
