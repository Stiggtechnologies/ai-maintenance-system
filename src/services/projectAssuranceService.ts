import { supabase } from "../lib/supabase";

export interface ProjectAssuranceRun {
  calculationRunId: string;
  status: "computed" | "computed_with_refusals" | "refused";
  sampleSize: number;
  minimumSample: number;
  refusals: string[];
  referenceClass?: { lifecycleType: string; currency: string };
  normalizedBenchmark?: {
    teamForecastCostPercentile: number;
    teamForecastDurationPercentile: number;
    medianStartupDelayDays: number;
    medianCommissioningDefects: number;
    medianSafetyIncidentRate: number;
    medianStartupReliabilityPct: number;
    medianEngineeringHoursPerMillionBaseline: number;
    normalization: string;
  };
  referenceForecast?: {
    teamCostGrowthPct: number;
    teamDurationGrowthPct: number;
    costP50: number;
    costP80: number;
    durationDaysP50: number;
    durationDaysP80: number;
  };
  assurancePatterns?: Array<{
    signal: string;
    [key: string]: string | number | boolean;
  }>;
  patternRefusals?: string[];
  recommendationOnly?: true;
  operationalAuthorization: false;
  method?: string;
}

export interface ProjectAssuranceWorkspace {
  cases: Array<{
    id: string;
    title: string;
    status: string;
    lifecycleType: string;
    outcomeRecorded: boolean;
  }>;
  verifiedEvidence: Array<{
    id: string;
    description: string;
    verifiedAt: string;
  }>;
  minimumSample: 5;
  decisionBoundary: string;
}

function result<T>(data: unknown, error: { message: string } | null): T {
  if (error) throw new Error(error.message);
  const value = data as T & { error?: string };
  if (value?.error) throw new Error(value.error);
  return value;
}

export async function recordVerifiedProjectOutcome(input: {
  caseId: string;
  evidenceItemId: string;
  baselineCost: number;
  actualCost: number;
  baselineDurationDays: number;
  actualDurationDays: number;
  currency: string;
  complexityRating: number;
  geography: string;
  technologyNoveltyRating: number;
  executionStrategy: string;
  engineeringMaturityAtExecutionPct: number;
  unresolvedVendorDataAtGate: number;
  commissioningDefects: number;
  startupDelayDays: number;
  safetyIncidentRate: number;
  startupReliabilityPct: number;
  engineeringHours: number;
}): Promise<{ learningEventId: string; status: string }> {
  const { caseId, evidenceItemId, ...outcome } = input;
  const { data, error } = await supabase.rpc(
    "record_verified_project_outcome",
    {
      p_case_id: caseId,
      p_evidence_item_id: evidenceItemId,
      p_outcome: outcome,
    },
  );
  return result(data, error);
}

export async function getProjectAssuranceWorkspace(): Promise<ProjectAssuranceWorkspace> {
  const { data, error } = await supabase.rpc("get_project_assurance_workspace");
  return result(data, error);
}

export async function runProjectAssurance(input: {
  caseId: string;
  forecastCost: number;
  forecastDurationDays: number;
  currency: string;
  evidenceItemId: string;
  baselineCost: number;
  baselineDurationDays: number;
  complexityRating: number;
  geography: string;
  technologyNoveltyRating: number;
  executionStrategy: string;
}): Promise<ProjectAssuranceRun> {
  const { data, error } = await supabase.rpc(
    "run_project_assurance_reference_class",
    {
      p_case_id: input.caseId,
      p_forecast_cost: input.forecastCost,
      p_forecast_duration_days: input.forecastDurationDays,
      p_currency: input.currency,
      p_evidence_item_id: input.evidenceItemId,
      p_profile: {
        baselineCost: input.baselineCost,
        baselineDurationDays: input.baselineDurationDays,
        complexityRating: input.complexityRating,
        geography: input.geography,
        technologyNoveltyRating: input.technologyNoveltyRating,
        executionStrategy: input.executionStrategy,
      },
      p_minimum_sample: 5,
    },
  );
  return result(data, error);
}
