import { supabase } from "../lib/supabase";

export interface ProjectFlowWorkOrder {
  workOrderId: string;
  workOrderNumber: string | null;
  title: string;
  status: string;
  activeHours: number;
  waitingHours: number;
  totalElapsedHours: number;
  flowEfficiencyPct: number | null;
  transitionCount: number;
  evidenceStart: string;
  evidenceEnd: string;
}

export interface ProjectFlowExclusion {
  workOrderId: string;
  workOrderNumber: string | null;
  reason: string;
}

export interface ProjectFlowEfficiency {
  caseId: string;
  asOf: string;
  computable: boolean;
  partial: boolean;
  flowEfficiencyPct: number | null;
  activeHours: number;
  waitingHours: number;
  totalElapsedHours: number;
  eligibleWorkOrders: number;
  measuredWorkOrders: number;
  excludedWorkOrders: number;
  basis: string;
  provenance: {
    scope: string;
    timing: string;
    calculatedAt: string;
  };
  workOrders: ProjectFlowWorkOrder[];
  exclusions: ProjectFlowExclusion[];
}

export async function getProjectFlowEfficiency(
  caseId: string,
): Promise<ProjectFlowEfficiency> {
  const { data, error } = await supabase.rpc("get_project_flow_efficiency", {
    p_case_id: caseId,
    p_as_of: null,
  });
  if (error) throw new Error(error.message);
  const result = data as (ProjectFlowEfficiency & { error?: string }) | null;
  if (!result) throw new Error("Project flow response was empty");
  if (result.error) throw new Error(result.error);
  return result;
}
