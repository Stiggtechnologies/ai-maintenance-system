import { supabase } from "../lib/supabase";

export const HOP_CATEGORIES = [
  ["task_complexity", "Task complexity"],
  ["conflicting_procedures", "Conflicting procedures"],
  ["excessive_handoffs", "Excessive handoffs"],
  ["decision_delays", "Decision delays"],
  ["workarounds", "Workarounds"],
  ["repeat_deviations", "Repeat deviations"],
  ["overloaded_roles", "Overloaded roles"],
  ["unclear_authority", "Unclear authority"],
  ["error_provoking_conditions", "Error-provoking conditions"],
] as const;
export type HopCategory = (typeof HOP_CATEGORIES)[number][0];

export interface HopAgentResult {
  advisory: true;
  asOf: string;
  analysis: {
    headline: string;
    findings: Array<{
      id: string;
      category: HopCategory;
      headline: string;
      detail: string;
      sourceRefs: string[];
      humanAction: string;
      observedAt: string | null;
    }>;
    categoryCounts: Array<{ key: HopCategory; label: string; count: number }>;
    coverage: {
      lookbackDays: number;
      eventCount: number;
      eventLimit: number;
      eventsTruncated: boolean;
      unclassifiedEventCount: number;
      caseCount: number;
      caseLimit: number;
      casesTruncated: boolean;
    };
    basis: string;
    limitations: string[];
  };
  narrativeSource: "deterministic_governed_records";
  disclaimer: string;
}
export interface HopObservation {
  conditionCategories: HopCategory[];
  errorType: string;
  outcomeSeverity?: string;
  contributingConditions: string;
  correctiveAction?: string;
  observationBasis: string;
  evidenceRefs: string[];
}

export async function runHopAgent(lookbackDays = 90): Promise<HopAgentResult> {
  const { data, error } = await supabase.functions.invoke("develop-hop-agent", {
    body: { lookback_days: lookbackDays },
  });
  if (error) throw new Error(error.message);
  const payload = data as HopAgentResult | { error?: string; reason?: string };
  if (payload && typeof payload === "object" && "error" in payload)
    throw new Error(
      payload.reason || payload.error || "HOP screening unavailable",
    );
  return payload as HopAgentResult;
}
export async function recordHopSystemCondition(
  record: HopObservation,
): Promise<{ id: number; status: string }> {
  const { data, error } = await supabase.rpc("record_hop_system_condition", {
    p_record: record,
  });
  if (error) throw new Error(error.message);
  return data as { id: number; status: string };
}
