import { supabase } from "../lib/supabase";
import type { LongHorizonYear } from "../lib/value/longHorizonPlan";

type RpcEnvelope = { error?: unknown };

async function callRpc<T>(name: string, args: Record<string, unknown> = {}) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  const body = data as (T & RpcEnvelope) | null;
  if (body && typeof body.error === "string") throw new Error(body.error);
  if (body == null) throw new Error(`${name} returned nothing`);
  return body;
}

export interface LongHorizonPlanSummary {
  id: string;
  planCode: string;
  version: number;
  status: "draft" | "adopted" | "superseded";
  startYear: number;
  endYear: number;
  currency: string;
  forecastMethod: "recorded_only" | "human_stated_annual_maintenance";
  createdBy: string;
  adoptedBy: string | null;
}

export interface LongHorizonComposition {
  planId: string;
  planCode: string;
  version: number;
  status: "draft" | "adopted" | "superseded";
  startYear: number;
  endYear: number;
  currency: string;
  forecastMethod: "recorded_only" | "human_stated_annual_maintenance";
  statedAnnualMaintenance: number | null;
  statedAnnualBasis: string | null;
  evidenceItemId: string;
  basis: string;
  calculationRunId: string | null;
  createdBy: string;
  adoptedBy: string | null;
  expenditureAuthorized: false;
  projectSanctioned: false;
  workAuthorized: false;
  riskAccepted: false;
  returnToServiceAuthorized: false;
  lifecycleCost: {
    currency: "USD";
    evaluationCount: number;
    economicsSnapshotCount: number;
    snapshotsWithAnnualMaintenance: number;
    recordedAnnualMaintenanceUsd: number | null;
    horizonMultiplication: false;
    note: string;
  };
  risk: {
    openCount: number;
    highOrCriticalCount: number;
    currency: string | null;
    recordedValueAtRisk: number | null;
    valueWithheldReason: string | null;
  };
  performance: {
    recordCount: number;
    unit: string | null;
    observedUnits: number | null;
    withheldReason: string | null;
    label: string;
  };
  resilience: {
    threatScenarioCount: number;
    climateAssessmentCount: number;
    score: null;
    note: string;
  };
  capitalAllocation: {
    currency: string;
    years: LongHorizonYear[];
    maintenanceAssumptionTotal: number | null;
    capitalHorizonTotal: number | null;
    combinedHorizonTotal: number | null;
    horizonTotalStatus: "recorded" | "withheld";
    withheldReason: string | null;
    budgetLineNote: string;
  };
}

export interface LongHorizonWorkspace {
  plans: LongHorizonPlanSummary[];
  selected: LongHorizonComposition | null;
  decisionBoundary: string;
}

export interface LongHorizonDraftInput {
  planCode: string;
  startYear: number;
  endYear: number;
  currency: string;
  forecastMethod: "recorded_only" | "human_stated_annual_maintenance";
  statedAnnualMaintenance: number | null;
  statedAnnualBasis: string | null;
  evidenceItemId: string;
  basis: string;
}

export function getLongHorizonValuePlan(planId?: string) {
  return callRpc<LongHorizonWorkspace>("get_long_horizon_value_plan", {
    p_plan_id: planId ?? null,
  });
}

export function recordLongHorizonPlan(plan: LongHorizonDraftInput) {
  return callRpc<{
    planId: string;
    planCode: string;
    version: number;
    status: "draft";
    expenditureAuthorized: false;
  }>("record_long_horizon_plan", { p_plan: plan });
}

export function adoptLongHorizonPlan(planId: string, note: string) {
  return callRpc<{
    planId: string;
    status: "adopted";
    calculationRunId: string;
    expenditureAuthorized: false;
  }>("adopt_long_horizon_plan", { p_plan_id: planId, p_note: note });
}
