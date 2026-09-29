import { supabase } from "../lib/supabase";
import type {
  CashFlow,
  OptionComparison,
  PrioritisationResult,
} from "../lib/value";

export interface ValuePosture {
  cases_total: number;
  cases_mixed_lives: number;
  plan_items: number;
  budget_lines: number;
  basis: string;
}

export interface ValueBusinessCase {
  caseRef: string;
  title: string;
  driver: string;
  discountRate: number;
  discountRateSource: string | null;
  status: string;
  options: {
    label: string;
    lifePeriods: number;
    cashFlows: CashFlow[];
    benefitProbability: number | null;
    isDoNothing: boolean;
    notes: string | null;
  }[];
}

export interface ValuePlanItem {
  id: number;
  label: string;
  cost: number;
  benefit: number;
  benefitRecorded: boolean;
  mandatory: boolean;
  mandatoryBasis: string | null;
}

export interface ValueCalculationPayload {
  posture: ValuePosture | null;
  businessCase: ValueBusinessCase | null;
  comparison: OptionComparison | null;
  planYear: number | null;
  plan: ValuePlanItem[];
  prioritisation: {
    mandatory: ValuePlanItem[];
    mandatoryCost: number;
    result: PrioritisationResult;
  } | null;
  refusals: {
    optionComparison: string[];
    capitalPlan: string[];
  };
  lineage: {
    optionComparisonRunId: string;
    capitalPlanRunId: string;
  };
  governance: {
    advisory: true;
    operationalAuthorization: false;
    humanApprovalRequired: true;
    note: string;
  };
}

export async function runValueCalculations(
  budget: number,
): Promise<ValueCalculationPayload> {
  if (
    !Number.isFinite(budget) ||
    budget < 0 ||
    budget > 1_000_000_000_000_000
  ) {
    throw new Error("Budget must be a finite, non-negative, bounded number.");
  }
  const { data, error } = await supabase.functions.invoke(
    "calculation-service",
    {
      body: { action: "value_management", budget },
    },
  );
  if (error) throw new Error(error.message);
  const payload = data as (ValueCalculationPayload & { error?: string }) | null;
  if (!payload) throw new Error("Calculation service returned no payload.");
  if (payload.error) throw new Error(payload.error);
  return payload;
}
