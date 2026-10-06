import { supabase } from "../lib/supabase";
import type { MethodSelection } from "../lib/reliability/method-selection";

export interface LifeDataGroup {
  component: string;
  units: number;
  failureHours: number[];
  censoredHours: number[];
  otherHours: number[];
  plannedIntervalHours: number | null;
  censoredShare: number;
  basis: string;
}

export interface LifeDataAsset {
  id: string;
  name: string;
  asset_tag: string | null;
}

export interface LifeDataReport {
  id: string;
  component: string;
  kernelVersion: string;
  sourceEventIds: number[];
  methodSelection: MethodSelection;
  limitations: string[];
  agentRunId: string;
  createdBy: string;
  createdAt: string;
}

export interface ReliabilityLifeDataWorkspace {
  groups: LifeDataGroup[];
  assets: LifeDataAsset[];
  reports: LifeDataReport[];
}

export interface LifeEventInput {
  assetId: string;
  component: string;
  hoursAtChangeOut: number;
  eventKind: "failure" | "scheduled" | "other";
  eventDate: string;
  plannedIntervalHours?: number | null;
  symptom?: string;
  workOrderRef?: string;
  sourceReference: string;
  evidenceBasis: string;
}

/** The legacy key cannot distinguish an exact retry from a different life.
 * Do not manufacture exposure, a successful event ID or a retry workaround.
 * This error is a client explanation, not a new canonical gap/approval record.
 */
export class LifeEventIdentityCollisionError extends Error {
  readonly code = "legacy_physical_life_collision";

  constructor() {
    super(
      "Life event was not recorded: the existing asset/component/removal-hours/event-kind key already exists. This may be a retry or a different physical life; the legacy capture identity cannot distinguish them. Reconcile the original source and physical-life identity with the engineering/data steward. Do not alter measured hours, dates or asset identity to bypass this refusal. Do not omit the unresolved life and claim the remaining population is complete.",
    );
    this.name = "LifeEventIdentityCollisionError";
  }
}

export interface LifeDataRunReceipt {
  report_id: string;
  run_id: string;
  component: string;
  kernel_version: string;
  method_selection: MethodSelection;
  source_event_ids: number[];
  advisory: true;
  may_change_pm_interval: false;
  may_create_work: false;
  may_approve_strategy: false;
  may_accept_risk: false;
  may_commit_spend: false;
  may_return_to_service: false;
}

function numbers(value: unknown): number[] {
  return Array.isArray(value)
    ? value.map(Number).filter((entry) => Number.isFinite(entry))
    : [];
}

export async function loadReliabilityLifeData(): Promise<ReliabilityLifeDataWorkspace> {
  const [groupsResult, assetsResult, reportsResult] = await Promise.all([
    supabase.rpc("get_reliability_life_data_groups"),
    supabase
      .from("assets")
      .select("id,name,asset_tag")
      .order("name")
      .limit(500),
    supabase.rpc("get_reliability_life_data_reports", {
      p_component: null,
      p_limit: 100,
    }),
  ]);
  if (groupsResult.error) throw new Error(groupsResult.error.message);
  if (assetsResult.error) throw new Error(assetsResult.error.message);
  if (reportsResult.error) throw new Error(reportsResult.error.message);

  const groups = ((groupsResult.data ?? []) as Record<string, unknown>[]).map(
    (row) => ({
      component: String(row.component ?? ""),
      units: Number(row.units ?? 0),
      failureHours: numbers(row.failureHours),
      censoredHours: numbers(row.censoredHours),
      otherHours: numbers(row.otherHours),
      plannedIntervalHours:
        row.plannedIntervalHours == null
          ? null
          : Number(row.plannedIntervalHours),
      censoredShare: Number(row.censoredShare ?? 0),
      basis: String(row.basis ?? "No evidence basis returned."),
    }),
  );
  return {
    groups,
    assets: (assetsResult.data ?? []) as LifeDataAsset[],
    reports: (Array.isArray(reportsResult.data)
      ? reportsResult.data
      : []) as LifeDataReport[],
  };
}

export async function recordComponentLifeEvent(
  input: LifeEventInput,
): Promise<number> {
  if (!Number.isFinite(input.hoursAtChangeOut) || input.hoursAtChangeOut <= 0)
    throw new Error("Operating hours must be a positive number.");
  const { data, error } = await supabase.rpc("record_component_life_event", {
    p_asset_id: input.assetId,
    p_component: input.component,
    p_hours_at_change_out: input.hoursAtChangeOut,
    p_event_kind: input.eventKind,
    p_event_date: input.eventDate,
    p_planned_interval_hours: input.plannedIntervalHours ?? null,
    p_symptom: input.symptom ?? null,
    p_work_order_ref: input.workOrderRef ?? null,
    p_source_file: input.sourceReference,
    p_source_basis: input.evidenceBasis,
  });
  if (error) throw new Error(error.message);
  const result = data as { error?: string; event_id?: number } | null;
  if (result?.error === "this component life event is already recorded")
    throw new LifeEventIdentityCollisionError();
  if (result?.error) throw new Error(result.error);
  if (!result?.event_id)
    throw new Error("No life-event identity was returned.");
  return result.event_id;
}

export async function runReliabilityLifeDataAgent(
  component: string,
): Promise<LifeDataRunReceipt> {
  const { data, error } = await supabase.functions.invoke(
    "calculation-service",
    { body: { action: "reliability_life_data", component } },
  );
  if (error) throw new Error(error.message);
  const result = data as (LifeDataRunReceipt & { error?: string }) | null;
  if (!result) throw new Error("Calculation service returned no receipt.");
  if (result.error) throw new Error(result.error);
  return result;
}
