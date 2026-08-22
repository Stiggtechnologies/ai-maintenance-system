import { supabase } from "../lib/supabase";

export type RecoveryContextSurface =
  | "mission"
  | "work_order"
  | "materials"
  | "scheduling"
  | "handover"
  | "reliability"
  | "learning"
  | "value"
  | "sync";

export interface RecoveryPlatformEvent {
  event_id: string;
  event_code: string;
  status: string;
  event_type: string;
  asset_id: string;
  asset: string;
  tag: string | null;
  criticality: string | null;
  opened_at: string;
  baseline_return_at: string | null;
  forecast_return_at: string | null;
  forecast_p80_return_at: string | null;
  open_blockers: number;
  critical_open_blockers: number;
  latest_plan_version: number | null;
  latest_plan_status: string | null;
  critical_path_hours: number | null;
  p80_critical_path_hours: number | null;
  projected_hours_recovered: number | null;
  projected_downtime_value_usd: number | null;
  value_basis: string | null;
}

export interface RecoveryWorkOrderContext {
  event_id: string;
  event_code: string;
  event_status: string;
  asset_id: string;
  work_order_id: string;
  wo_number: string | null;
  title: string;
  work_order_status: string;
  plan_state: string;
  disposition: string;
  sequence_no: number;
  concurrency_rule: string;
  parallel_group: string | null;
  execution_status: string;
  forecast_return_at: string | null;
  forecast_p80_return_at: string | null;
  latest_plan_version: number | null;
  latest_plan_status: string | null;
}

export interface RecoveryMaterialImpact {
  event_id: string;
  event_code: string;
  asset_id: string;
  asset: string;
  work_order_id: string;
  wo_number: string | null;
  title: string;
  short_lines: number;
  requested_lines: number;
  recorded_rts_impact_hours: number | null;
}

export interface RecoveryHandoverImpact {
  event_id: string;
  event_code: string;
  asset_id: string;
  asset: string;
  release_id: string;
  release_status: "released" | "returned";
  released_at: string;
  returned_at: string | null;
  isolation_confirmed: boolean;
  awaiting_operations_acceptance: boolean;
}

export interface RecoveryScheduleCommitment {
  event_id: string;
  event_code: string;
  asset_id: string;
  asset: string;
  work_order_id: string;
  wo_number: string | null;
  title: string;
  priority: string;
  sequence_no: number;
  concurrency_rule: string;
  parallel_group: string | null;
  execution_status: string;
  planned_hours: number | null;
  estimated_hours: number | null;
  duration_basis:
    | "work_order_planned_hours"
    | "work_order_estimated_hours"
    | "not_sized";
}

export interface RecoveryClosedEvent {
  event_id: string;
  event_code: string;
  asset_id: string;
  asset: string;
  opened_at: string;
  actual_return_at: string | null;
  baseline_return_at: string | null;
  counterfactual_hours_recovered: number | null;
  projected_downtime_value_usd: number | null;
  value_status: "not_computable" | "projected_pending_value_verification";
}

export interface RecoveryPlatformContext {
  surface: RecoveryContextSurface;
  generated_at: string;
  active_events: RecoveryPlatformEvent[];
  work_order_context: RecoveryWorkOrderContext | null;
  material_impacts: RecoveryMaterialImpact[];
  handover_impacts: RecoveryHandoverImpact[];
  schedule_commitments: RecoveryScheduleCommitment[];
  recent_closed_events: RecoveryClosedEvent[];
  authority: Record<string, string>;
}

export async function getRecoveryPlatformContext(
  surface: RecoveryContextSurface,
  options: { workOrderId?: string | null; assetId?: string | null } = {},
): Promise<RecoveryPlatformContext> {
  const { data, error } = await supabase.rpc("get_recovery_platform_context", {
    p_surface: surface,
    p_work_order_id: options.workOrderId ?? null,
    p_asset_id: options.assetId ?? null,
  });
  if (error) throw new Error(error.message);
  const payload = data as (RecoveryPlatformContext & { error?: string }) | null;
  if (payload?.error) throw new Error(payload.error);
  if (!payload) throw new Error("Recovery context returned no payload.");
  return payload;
}
