/**
 * Work-order closeout — FRACAS-quality completion via close_work_order()
 * (migration 12). The RPC enforces the mandatory closeout fields (failure
 * mode, cause, corrective action, labour, downtime) and writes the
 * learning events, including the "was the SyncAI alert useful?" model
 * feedback for AI-generated work.
 */
import { supabase } from "../lib/supabase";

export interface CloseoutInput {
  actualFailureMode?: string;
  actualCause?: string;
  correctiveAction?: string;
  laborHours: number;
  downtimeHours: number;
  partsUsed?: string;
  technicianComments?: string;
  aiAlertUseful?: boolean | null;
  findingOutcome?: "no_finding" | "degradation_found" | "defect_found";
  findingDetail?: string;
}

export interface PmMechanismOption { mechanismKey: string; name: string }

export async function getPmTargetMechanism(workOrderId:string): Promise<PmMechanismOption | null> {
  const {data,error}=await supabase.rpc("get_pm_closeout_options",{p_work_order_id:workOrderId});
  if(error) throw new Error(error.message);
  const result=data as {targetMechanism?:PmMechanismOption|null;error?:string};
  if(result.error) throw new Error(result.error);
  return result.targetMechanism ?? null;
}

export async function closeWorkOrder(
  workOrderId: string,
  input: CloseoutInput,
): Promise<{ closed: boolean; workOrder?: string }> {
  const { data, error } = await supabase.rpc("close_work_order_v2", {
    p_work_order_id: workOrderId,
    p_closeout: input,
  });
  if (error) throw new Error(`Closeout failed: ${error.message}`);
  const result = data as {
    closed?: boolean;
    error?: string;
    workOrder?: string;
  };
  if (result.error) {
    const messages: Record<string, string> = {
      missing_required_closeout_fields:
        "Failure mode, cause, corrective action, labour and downtime hours are all required to close a work order.",
      already_closed: "This work order is already closed.",
      forbidden: "You do not have access to this work order.",
      invalid_hours: "Labour and downtime must be valid non-negative hours.",
      pm_finding_outcome_required: "Record whether the PM found degradation, a defect, or no finding.",
      pm_finding_detail_required: "Provide at least 10 characters of PM inspection evidence.",
      pm_prospective_target_not_configured: "This PM cannot be closed until its adopted job plan defines the failure mechanism it was intended to detect or prevent.",
      completion_note_required: "Provide at least 10 characters of completion evidence.",
    };
    throw new Error(
      messages[result.error] ?? `Closeout failed: ${result.error}`,
    );
  }
  return { closed: true, workOrder: result.workOrder };
}
