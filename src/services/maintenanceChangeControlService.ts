import { supabase } from "../lib/supabase";

export type MaintenanceControlAction =
  | "defer_critical_work"
  | "create_safety_critical_work"
  | "reschedule_safety_critical_work";

export interface MaintenanceControlWorkOrder {
  id: string;
  number: string | null;
  title: string;
  assetId: string | null;
  assetName: string | null;
  status: string;
  priority: string;
  safetyFlag: boolean;
  scheduledDate: string | null;
  dueDate: string | null;
  riskId: string | null;
  controlRevision: number;
  deferredUntil: string | null;
}

export interface MaintenanceControlAsset {
  id: string;
  name: string;
  tag: string | null;
}

export interface MaintenanceControlRequest {
  id: string;
  action: MaintenanceControlAction;
  status: "required" | "pending" | "approved" | "rejected";
  workOrderId: string;
  workOrderTitle: string;
  requestedBy: string | null;
  requestedAt: string;
  proposedEffectiveAt: string;
  reason: string;
  consequenceOfWrong: string;
  requiredValidation: string;
  riskAcceptanceReady: boolean;
  isOwnRequest: boolean;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
}

export interface MaintenanceChangeControlWorkspace {
  callerRole: string;
  canRequest: boolean;
  canDecide: boolean;
  control: string;
  workOrders: MaintenanceControlWorkOrder[];
  assets: MaintenanceControlAsset[];
  requests: MaintenanceControlRequest[];
}

function unwrap<T>(data: unknown, error: { message: string } | null): T {
  if (error) throw new Error(error.message);
  const result = data as T & { error?: string };
  if (result?.error) throw new Error(result.error);
  return result;
}

export async function getMaintenanceChangeControlWorkspace(): Promise<MaintenanceChangeControlWorkspace> {
  const { data, error } = await supabase.rpc(
    "get_maintenance_change_control_workspace",
  );
  return unwrap(data, error);
}

export async function requestCriticalWorkDeferral(input: {
  workOrderId: string;
  proposedDate: string;
  reason: string;
  consequenceOfWrong: string;
  requiredValidation: string;
}) {
  const { data, error } = await supabase.rpc("request_critical_work_deferral", {
    p_work_order_id: input.workOrderId,
    p_deferred_until: input.proposedDate,
    p_reason: input.reason,
    p_consequence_of_wrong: input.consequenceOfWrong,
    p_required_validation: input.requiredValidation,
  });
  return unwrap<{ approval_id: string; work_order_id: string; status: string }>(
    data,
    error,
  );
}

export async function requestSafetyCriticalWork(input: {
  assetId: string;
  title: string;
  description: string;
  proposedDate: string;
  reason: string;
  consequenceOfWrong: string;
  requiredValidation: string;
}) {
  const { data, error } = await supabase.rpc("request_safety_critical_work", {
    p_request: {
      assetId: input.assetId,
      title: input.title,
      description: input.description,
      proposedDate: input.proposedDate,
      reason: input.reason,
      consequenceOfWrong: input.consequenceOfWrong,
      requiredValidation: input.requiredValidation,
    },
  });
  return unwrap<{ approval_id: string; work_order_id: string; status: string }>(
    data,
    error,
  );
}

export async function requestSafetyCriticalReschedule(input: {
  workOrderId: string;
  proposedDate: string;
  reason: string;
  consequenceOfWrong: string;
  requiredValidation: string;
}) {
  const { data, error } = await supabase.rpc(
    "request_safety_critical_reschedule",
    {
      p_work_order_id: input.workOrderId,
      p_proposed_date: input.proposedDate,
      p_reason: input.reason,
      p_consequence_of_wrong: input.consequenceOfWrong,
      p_required_validation: input.requiredValidation,
    },
  );
  return unwrap<{ approval_id: string; work_order_id: string; status: string }>(
    data,
    error,
  );
}

export async function decideMaintenanceChangeControl(input: {
  approvalId: string;
  outcome: "approved" | "rejected";
  note: string;
}) {
  const { data, error } = await supabase.rpc(
    "decide_maintenance_change_control",
    {
      p_approval_id: input.approvalId,
      p_outcome: input.outcome,
      p_note: input.note,
    },
  );
  return unwrap<{
    approval_id: string;
    work_order_id: string;
    action: MaintenanceControlAction;
    status: string;
  }>(data, error);
}
