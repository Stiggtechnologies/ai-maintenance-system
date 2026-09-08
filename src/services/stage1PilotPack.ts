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
  if (payload && typeof payload === "object" && "error" in payload && payload.error) {
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
    supabase.from("maintenance_plans").select("id", { count: "exact", head: true }),
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
