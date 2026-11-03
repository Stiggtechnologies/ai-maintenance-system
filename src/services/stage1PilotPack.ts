/**
 * Stage-1 pilot pack live-ops callers.
 *
 * Import of plans + work-order history rides the existing ingest door
 * (ContractImport → begin_manual_import / ingest_rows) and the read-only
 * CMMS adapter (#366). DoA adoption rides adopt_authority_limit /
 * state_authority_ceiling. KPI named owners ride raci_assignments via
 * name_kpi_owner. No parallel CMMS, historian, authority, or RACI store.
 */
import { supabase } from "../lib/supabase";

type RpcPayload = { error?: string } | null;

function unwrap<T>(data: unknown, error: { message: string } | null): T {
  if (error) throw new Error(error.message);
  const payload = data as RpcPayload;
  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    payload.error
  ) {
    throw new Error(payload.error);
  }
  return data as T;
}

export interface Stage1ImportCounts {
  maintenancePlans: number;
  workOrders: number;
  jobPlans: number;
  adoptedJobPlans: number;
  completedWorkOrders: number;
}

export interface Stage1ImportStatus extends Stage1ImportCounts {
  hasPlanHistory: boolean;
  hasWorkHistory: boolean;
  honesty: string;
}

export async function getStage1ImportStatus(): Promise<Stage1ImportStatus> {
  const [plans, work, completed, jobs, adopted] = await Promise.all([
    supabase
      .from("maintenance_plans")
      .select("id", { count: "exact", head: true }),
    supabase.from("work_orders").select("id", { count: "exact", head: true }),
    supabase
      .from("work_orders")
      .select("id", { count: "exact", head: true })
      .eq("status", "completed"),
    supabase.from("job_plans").select("id", { count: "exact", head: true }),
    supabase
      .from("job_plans")
      .select("id", { count: "exact", head: true })
      .eq("status", "adopted"),
  ]);
  for (const r of [plans, work, completed, jobs, adopted]) {
    if (r.error) throw new Error(r.error.message);
  }
  const maintenancePlans = plans.count ?? 0;
  const workOrders = work.count ?? 0;
  const completedWorkOrders = completed.count ?? 0;
  const jobPlans = jobs.count ?? 0;
  const adoptedJobPlans = adopted.count ?? 0;
  const hasPlanHistory = maintenancePlans > 0 || adoptedJobPlans > 0;
  const hasWorkHistory = workOrders > 0;
  return {
    maintenancePlans,
    workOrders,
    jobPlans,
    adoptedJobPlans,
    completedWorkOrders,
    hasPlanHistory,
    hasWorkHistory,
    honesty: hasWorkHistory
      ? `${workOrders} work orders are in this tenant (${completedWorkOrders} completed). Counts are live rows, not a case study.`
      : "No work-order history in this tenant yet. Import through the ingest door or pull the read-only CMMS adapter — do not treat seed/demo fleets as this site.",
  };
}

export async function adoptAuthorityLimit(input: {
  limitId: string;
  note: string;
}): Promise<{ adopted: string; role_key: string }> {
  const { data, error } = await supabase.rpc("adopt_authority_limit", {
    p_id: input.limitId,
    p_note: input.note,
  });
  return unwrap(data, error);
}

export async function stateAuthorityCeiling(input: {
  limitId: string;
  maxCommitment: string;
  currency: string;
  basis: string;
  maxRiskLevel?: string;
}): Promise<{ limit_id: string; next: string }> {
  const ceiling: Record<string, string> = {
    max_commitment: input.maxCommitment,
    currency: input.currency,
    basis: input.basis,
  };
  if (input.maxRiskLevel) ceiling.max_risk_level = input.maxRiskLevel;
  const { data, error } = await supabase.rpc("state_authority_ceiling", {
    p_id: input.limitId,
    p_ceiling: ceiling,
  });
  return unwrap(data, error);
}

export type KpiOwnerSlot = "accountable" | "responsible";

export interface KpiNamedOwnerRow {
  kpi_key: string;
  name: string;
  page: string;
  catalog_accountable: string;
  catalog_responsible: string;
  catalog_consulted: string | null;
  catalog_informed: string | null;
  named_accountable: string | null;
  named_responsible: string | null;
  named_at: string | null;
  named_by: string | null;
  basis: string | null;
}

export interface KpiNamedOwners {
  role: string;
  owners: KpiNamedOwnerRow[];
}

export async function getKpiNamedOwners(): Promise<KpiNamedOwners> {
  const { data, error } = await supabase.rpc("get_kpi_named_owners");
  const result = unwrap<KpiNamedOwners>(data, error);
  return { role: result.role ?? "", owners: result.owners ?? [] };
}

export async function nameKpiOwner(input: {
  kpiKey: string;
  slot: KpiOwnerSlot;
  ownerName: string;
  basis: string;
}): Promise<{ kpi_key: string; slot: KpiOwnerSlot; owner_name: string }> {
  const { data, error } = await supabase.rpc("name_kpi_owner", {
    p_kpi_key: input.kpiKey,
    p_slot: input.slot,
    p_owner_name: input.ownerName,
    p_basis: input.basis,
  });
  return unwrap(data, error);
}

export type PilotMeasureStatus = "measured" | "not_measurable" | "partial";

export interface PilotMeasure {
  status: PilotMeasureStatus;
  value: number | null;
  unit: string | null;
  basis: string;
}

export interface Stage1MeasuredPilotProof {
  historical_fleet_studies_used: false;
  authority: string;
  population: {
    work_orders: number;
    work_orders_without_source_system: number;
    operating_state_rows: number;
    production_rows: number;
  };
  emergency_work: PilotMeasure & {
    classified: number;
    work_orders: number;
  };
  repeat_failures: PilotMeasure & {
    coded_events: number;
    repeat_events: number;
    repeat_pairs: number;
    uncoded_excluded: number;
    incomplete_excluded: number;
  };
  availability: PilotMeasure & {
    running_hours: number | null;
    down_hours: number | null;
    other_hours: number | null;
    conflict_assets: number;
    window_source: string | null;
  };
  backlog_quality: {
    status: PilotMeasureStatus;
    open_work_orders: number;
    planning_complete: number;
    planning_complete_pct: number | null;
    materials_status: "measured" | "not_measurable";
    materials_ready: number | null;
    materials_with_demand: number;
    materials_ready_pct: number | null;
    basis: string;
  };
  production_loss: {
    status: "measured" | "not_measurable";
    units_lost: number | null;
    unit_of_measure: string | null;
    sum_refused: boolean;
    assets_measurable: number;
    assets_excluded_mixed_units: number;
    assets_excluded_no_rate: number;
    by_asset: Array<{
      asset: string;
      units_lost: number;
      unit_of_measure: string;
      down_hours: number;
      demonstrated_rate: number;
    }>;
    basis: string;
  };
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function measureStatus(value: unknown): PilotMeasureStatus {
  return value === "measured" || value === "partial"
    ? value
    : "not_measurable";
}

export async function getStage1MeasuredPilotProof(): Promise<Stage1MeasuredPilotProof> {
  const { data, error } = await supabase.rpc("get_stage1_measured_pilot_proof", {
    p_window_days: null,
  });
  const raw = unwrap<Record<string, unknown>>(data, error);
  if (raw.historical_fleet_studies_used !== false) {
    throw new Error(
      "Pilot proof refused: the readout was not marked as this tenant's live rows.",
    );
  }
  const emergency = (raw.emergency_work ?? {}) as Record<string, unknown>;
  const repeats = (raw.repeat_failures ?? {}) as Record<string, unknown>;
  const availability = (raw.availability ?? {}) as Record<string, unknown>;
  const backlog = (raw.backlog_quality ?? {}) as Record<string, unknown>;
  const loss = (raw.production_loss ?? {}) as Record<string, unknown>;
  const population = (raw.population ?? {}) as Record<string, unknown>;
  const emergencyStatus = measureStatus(emergency.status);
  const repeatStatus = measureStatus(repeats.status);
  const availabilityStatus = measureStatus(availability.status);
  const lossStatus = loss.status === "measured" ? "measured" : "not_measurable";
  const materialsStatus =
    backlog.materials_status === "measured" ? "measured" : "not_measurable";
  return {
    historical_fleet_studies_used: false,
    authority:
      typeof raw.authority === "string"
        ? raw.authority
        : "read only",
    population: {
      work_orders: num(population.work_orders) ?? 0,
      work_orders_without_source_system:
        num(population.work_orders_without_source_system) ?? 0,
      operating_state_rows: num(population.operating_state_rows) ?? 0,
      production_rows: num(population.production_rows) ?? 0,
    },
    emergency_work: {
      status: emergencyStatus,
      value: emergencyStatus === "measured" ? num(emergency.value) : null,
      unit: "%",
      basis: typeof emergency.basis === "string" ? emergency.basis : "",
      classified: num(emergency.classified) ?? 0,
      work_orders: num(emergency.work_orders) ?? 0,
    },
    repeat_failures: {
      status: repeatStatus,
      value: repeatStatus === "measured" ? num(repeats.value) : null,
      unit: "%",
      basis: typeof repeats.basis === "string" ? repeats.basis : "",
      coded_events: num(repeats.coded_events) ?? 0,
      repeat_events: num(repeats.repeat_events) ?? 0,
      repeat_pairs: num(repeats.repeat_pairs) ?? 0,
      uncoded_excluded: num(repeats.uncoded_excluded) ?? 0,
      incomplete_excluded: num(repeats.incomplete_excluded) ?? 0,
    },
    availability: {
      status: availabilityStatus,
      value: availabilityStatus === "measured" ? num(availability.value) : null,
      unit: "%",
      basis: typeof availability.basis === "string" ? availability.basis : "",
      running_hours: num(availability.running_hours),
      down_hours: num(availability.down_hours),
      other_hours: num(availability.other_hours),
      conflict_assets: num(availability.conflict_assets) ?? 0,
      window_source:
        typeof availability.window_source === "string"
          ? availability.window_source
          : null,
    },
    backlog_quality: {
      status: measureStatus(backlog.status),
      open_work_orders: num(backlog.open_work_orders) ?? 0,
      planning_complete: num(backlog.planning_complete) ?? 0,
      planning_complete_pct: num(backlog.planning_complete_pct),
      materials_status: materialsStatus,
      materials_ready:
        materialsStatus === "measured" ? num(backlog.materials_ready) : null,
      materials_with_demand: num(backlog.materials_with_demand) ?? 0,
      materials_ready_pct:
        materialsStatus === "measured"
          ? num(backlog.materials_ready_pct)
          : null,
      basis: typeof backlog.basis === "string" ? backlog.basis : "",
    },
    production_loss: {
      status: lossStatus,
      units_lost:
        lossStatus === "measured" && loss.sum_refused !== true
          ? num(loss.units_lost)
          : null,
      unit_of_measure:
        lossStatus === "measured" && typeof loss.unit_of_measure === "string"
          ? loss.unit_of_measure
          : null,
      sum_refused: loss.sum_refused === true,
      assets_measurable: num(loss.assets_measurable) ?? 0,
      assets_excluded_mixed_units: num(loss.assets_excluded_mixed_units) ?? 0,
      assets_excluded_no_rate: num(loss.assets_excluded_no_rate) ?? 0,
      by_asset: Array.isArray(loss.by_asset)
        ? loss.by_asset.flatMap((row) => {
            const item = row as Record<string, unknown>;
            const units = num(item.units_lost);
            const rate = num(item.demonstrated_rate);
            const down = num(item.down_hours);
            if (
              typeof item.asset !== "string" ||
              units === null ||
              rate === null ||
              down === null ||
              typeof item.unit_of_measure !== "string"
            ) {
              return [];
            }
            return [
              {
                asset: item.asset,
                units_lost: units,
                unit_of_measure: item.unit_of_measure,
                down_hours: down,
                demonstrated_rate: rate,
              },
            ];
          })
        : [],
      basis: typeof loss.basis === "string" ? loss.basis : "",
    },
  };
}

export interface ImportedResponseClassResult {
  applied: number;
  blank: number;
  invalid: number;
  conflicts: number;
  unmatched: number;
}

export async function applyImportedWorkOrderResponseClass(
  runId: string,
): Promise<ImportedResponseClassResult> {
  const { data, error } = await supabase.rpc(
    "apply_imported_work_order_response_class",
    { p_run_id: runId },
  );
  const raw = unwrap<ImportedResponseClassResult>(data, error);
  return {
    applied: raw.applied ?? 0,
    blank: raw.blank ?? 0,
    invalid: raw.invalid ?? 0,
    conflicts: raw.conflicts ?? 0,
    unmatched: raw.unmatched ?? 0,
  };
}

export function describeImportedResponseClass(
  result: ImportedResponseClassResult,
): string {
  const kept =
    "Blank classes stay unclassified. Priority is left as priority.";
  if (result.invalid > 0 || result.conflicts > 0 || result.unmatched > 0) {
    return `Response class: ${result.applied} copied from the file, ${result.invalid} invalid, ${result.conflicts} already classified differently, ${result.unmatched} unmatched. ${kept}`;
  }
  if (result.applied > 0) {
    return `${result.applied} response class value(s) copied from the file. ${kept}`;
  }
  return `No response class was present on the accepted rows. ${kept}`;
}
