import { supabase } from "../lib/supabase";
import type { SystemKpiEffect } from "../lib/optimization/system-kpis";

export interface SystemKpiCatalogRow {
  kpiKey: string;
  name: string;
  page: string;
}

export interface SystemKpiEffectRecord {
  kpiKey: string;
  page: string;
  effect: SystemKpiEffect;
  basis: string;
}

export interface SystemKpiAssessment {
  id: string;
  status: "proposed" | "accepted" | "rejected";
  focalKpiKey: string;
  focalPage: string;
  intent: string;
  requiredPages: string[];
  safetyKpiWorsens: boolean;
  recommendationId: string | null;
  proposedAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
  escalationNote: string | null;
  operationalAuthorization: false;
  effects: SystemKpiEffectRecord[];
}

export interface SystemKpiOptimizationWorkspace {
  boundary: string;
  catalog: SystemKpiCatalogRow[];
  pages: string[];
  assessments: SystemKpiAssessment[];
}

export interface SystemKpiOptimizationResult {
  optimizationId: string;
  status: "proposed" | "accepted" | "rejected";
  safetyKpiWorsens: boolean;
  operationalAuthorization: false;
}

function unwrap<T>(
  data: T | { error?: string } | null,
  error: { message: string } | null,
  fallback: string,
): T {
  if (error) throw new Error(`${fallback}: ${error.message}`);
  if (data && typeof data === "object" && "error" in data && data.error) {
    throw new Error(String(data.error));
  }
  if (!data) throw new Error(fallback);
  return data as T;
}

export async function getSystemKpiOptimizationWorkspace(): Promise<SystemKpiOptimizationWorkspace> {
  const { data, error } = await supabase.rpc(
    "get_system_kpi_optimization_workspace",
  );
  return unwrap(
    data as SystemKpiOptimizationWorkspace | { error?: string } | null,
    error,
    "Could not load the system KPI optimization workspace",
  );
}

export async function proposeSystemKpiOptimization(input: {
  focalKpiKey: string;
  intent: string;
  effects: SystemKpiEffectRecord[];
  recommendationId?: string | null;
}): Promise<SystemKpiOptimizationResult> {
  const { data, error } = await supabase.rpc(
    "propose_system_kpi_optimization",
    {
      p_focal_kpi_key: input.focalKpiKey,
      p_intent: input.intent,
      p_effects: input.effects,
      p_recommendation_id: input.recommendationId ?? null,
    },
  );
  return unwrap(
    data as SystemKpiOptimizationResult | { error?: string } | null,
    error,
    "Could not propose the system KPI optimization",
  );
}

export async function decideSystemKpiOptimization(input: {
  optimizationId: string;
  decision: "accepted" | "rejected";
  note: string;
  escalationNote?: string | null;
}): Promise<SystemKpiOptimizationResult> {
  const { data, error } = await supabase.rpc("decide_system_kpi_optimization", {
    p_optimization_id: input.optimizationId,
    p_decision: input.decision,
    p_note: input.note,
    p_escalation_note: input.escalationNote ?? null,
  });
  return unwrap(
    data as SystemKpiOptimizationResult | { error?: string } | null,
    error,
    "Could not decide the system KPI optimization",
  );
}
