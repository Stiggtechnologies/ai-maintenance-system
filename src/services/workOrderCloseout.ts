/**
 * Work-order closeout — FRACAS-quality completion via close_work_order()
 * (migration 12). The RPC enforces the mandatory closeout fields (failure
 * mode, cause, corrective action, labour, downtime) and writes the
 * learning events, including the "was the SyncAI alert useful?" model
 * feedback for AI-generated work.
 */
import { supabase } from "../lib/supabase";

export interface CloseoutInput {
  actualFailureMode: string;
  actualCause: string;
  correctiveAction: string;
  laborHours: number;
  downtimeHours: number;
  partsUsed?: string;
  technicianComments?: string;
  aiAlertUseful?: boolean | null;
}

export async function closeWorkOrder(
  workOrderId: string,
  input: CloseoutInput,
): Promise<{ closed: boolean; workOrder?: string }> {
  const { data, error } = await supabase.rpc("close_work_order", {
    p_work_order_id: workOrderId,
    p_actual_failure_mode: input.actualFailureMode,
    p_actual_cause: input.actualCause,
    p_corrective_action: input.correctiveAction,
    p_labor_hours: input.laborHours,
    p_downtime_hours: input.downtimeHours,
    p_parts_used: input.partsUsed ?? null,
    p_technician_comments: input.technicianComments ?? null,
    p_ai_alert_useful: input.aiAlertUseful ?? null,
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
    };
    throw new Error(
      messages[result.error] ?? `Closeout failed: ${result.error}`,
    );
  }
  return { closed: true, workOrder: result.workOrder };
}
