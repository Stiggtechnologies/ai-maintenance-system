import { supabase } from "../lib/supabase";

export interface ReadinessDimension {
  status: "READY" | "NOT_READY" | "NOT_ASSESSED";
  satisfied: number;
  total: number;
  percent: number | null;
  unassessedSystemCount?: number;
  source: string;
  gaps?: Array<Record<string, unknown>>;
}
export interface PhysicalInformationReadiness {
  caseId: string;
  systemCount: number;
  project: { physical: ReadinessDimension; information: ReadinessDimension };
  systems: Array<{
    systemId: number;
    systemRef: string;
    title: string;
    commissioningState: string;
    physical: ReadinessDimension;
    information: ReadinessDimension & { categories: string[] };
  }>;
  composition: string;
  decisionBoundary: string;
}
export async function getCasePhysicalInformationReadiness(caseId: string) {
  const { data, error } = await supabase.rpc(
    "get_case_physical_information_readiness",
    { p_case_id: caseId },
  );
  if (error) throw new Error(error.message);
  return data as PhysicalInformationReadiness;
}
