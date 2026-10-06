import { supabase } from "../lib/supabase";
import type { CoxResult } from "../lib/reliability/cox";
import type {
  SurvivalOverlay,
  SurvivalSourceEvent,
  SurvivalScenarioSelection,
} from "../lib/reliability/survival-source";

export interface SurvivalCovariate {
  name: string;
  unit: string;
}
export interface SurvivalEvidence {
  id: string;
  asset_id: string | null;
  ts: string;
  description: string | null;
  evidence_class: string | null;
  verified_by: string | null;
}
export interface SurvivalCalculation {
  id: string;
  computed_at: string;
  status: string;
  code_version: string;
  inputs: { covariates: SurvivalCovariate[]; source: { component: string } };
  outputs: CoxResult | null;
  refusals: string[];
}
export interface SurvivalWorkspace {
  component: string;
  events: SurvivalSourceEvent[];
  evidence: SurvivalEvidence[];
  calculations: SurvivalCalculation[];
}
export interface SurvivalReceipt {
  calculationRunId: string;
  agentRunId: string;
  result: CoxResult;
  refusals: string[];
  advisory: true;
  may_change_pm_interval: false;
  may_create_work: false;
  may_accept_risk: false;
  may_return_to_service: false;
}

function unwrap<T>(
  data: (T & { error?: string }) | null,
  error: { message: string } | null,
): T {
  if (error) throw new Error(error.message);
  if (!data) throw new Error("No governed survival response returned.");
  if (data.error) throw new Error(data.error);
  return data;
}

export async function loadSurvivalWorkspace(
  component: string,
): Promise<SurvivalWorkspace> {
  const response = await supabase.rpc("get_survival_covariate_workspace", {
    p_component: component,
  });
  const source = unwrap(
    response.data as Omit<SurvivalWorkspace, "evidence" | "calculations"> & {
      error?: string;
    },
    response.error,
  );
  // Client RLS remains active, including sensitive-evidence restrictions.
  // A visible verified row is NOT asserted to be source-eligible: the capture
  // RPC independently checks its exact asset, timestamp and source controls.
  const [evidence, history] = await Promise.all([
    supabase
      .from("evidence_items")
      .select("id,asset_id,ts,description,evidence_class,verified_by")
      .eq("verification_status", "verified")
      .order("ts", { ascending: false })
      .limit(500),
    supabase
      .from("calculation_runs")
      .select("id,computed_at,status,code_version,inputs,outputs,refusals")
      .eq("calculation_key", "component_covariate_survival")
      .eq("inputs->source->>component", component.trim())
      .order("computed_at", { ascending: false })
      .limit(20),
  ]);
  if (evidence.error) throw new Error(evidence.error.message);
  if (history.error) throw new Error(history.error.message);
  return {
    ...source,
    evidence: (evidence.data ?? []) as SurvivalEvidence[],
    calculations: (history.data ?? []) as SurvivalCalculation[],
  };
}

export async function captureSurvivalOverlay(
  event: SurvivalSourceEvent,
  overlay: SurvivalOverlay,
): Promise<void> {
  const response = await supabase.rpc("record_survival_covariate_overlay", {
    p_event_id: event.id,
    p_expected_version: event.overlayVersion,
    p_overlay: overlay,
  });
  unwrap(response.data, response.error);
}

export async function reviewSurvivalOverlay(
  event: SurvivalSourceEvent,
  decision: "validated" | "rejected",
  basis: string,
): Promise<void> {
  const response = await supabase.rpc("review_survival_covariate_overlay", {
    p_event_id: event.id,
    p_expected_version: event.overlayVersion,
    p_decision: decision,
    p_basis: basis,
  });
  unwrap(response.data, response.error);
}

export async function runSurvivalAnalysis(
  component: string,
  covariates: SurvivalCovariate[],
  scenario?: SurvivalScenarioSelection,
): Promise<SurvivalReceipt> {
  const response = await supabase.functions.invoke("calculation-service", {
    body: {
      action: "reliability_survival",
      component,
      covariates,
      ...(scenario === undefined
        ? {}
        : {
            scenario: {
              eventId: scenario.eventId,
              intervalIndex: scenario.intervalIndex,
              originHours: scenario.originHours,
              horizonHours: scenario.horizonHours,
            },
          }),
    },
  });
  return unwrap(
    response.data as SurvivalReceipt & { error?: string },
    response.error,
  );
}
