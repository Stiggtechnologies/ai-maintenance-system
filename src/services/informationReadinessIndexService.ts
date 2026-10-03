import { supabase } from "../lib/supabase";
export interface InformationHardBlocker {
  systemId: number;
  systemRef: string;
  itemId: string;
  assetId: string;
  asset: string;
  requirementKey: string;
  item: string;
  class: "safety_critical" | "regulatory" | "safety_and_regulatory";
  status: string;
  evidenceReady: boolean;
}
export interface InformationReadinessIndexResult {
  caseId: string;
  systemCount: number;
  project: {
    required: number;
    accepted: number;
    index: number | null;
    hardBlockerCount: number;
    unassessedSystemCount: number;
    status: "READY" | "NOT_READY" | "NOT_ASSESSED" | "BLOCKED";
  };
  systems: Array<{
    systemId: number;
    systemRef: string;
    title: string;
    required: number;
    accepted: number;
    index: number | null;
    hardBlockerCount: number;
    hardBlockers: InformationHardBlocker[];
    status: string;
  }>;
  hardBlockers: InformationHardBlocker[];
  formula: string;
  hardBlockerRule: string;
  decisionBoundary: string;
}
export async function getCaseInformationReadinessIndex(caseId: string) {
  const { data, error } = await supabase.rpc(
    "get_case_information_readiness_index",
    { p_case_id: caseId },
  );
  if (error) throw new Error(error.message);
  return data as InformationReadinessIndexResult;
}
