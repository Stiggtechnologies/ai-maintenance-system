/**
 * Product callers for Reliability RPCs that shipped without a surface
 * (C2.04, C2.05, C3.12, E3.02, E4.01, E4.04).
 *
 * The schema and SECURITY DEFINER functions already exist:
 *   get_operating_context / get_operating_regime
 *   adopt_pf_interval
 *   link_alert_to_work / derive_observed_pf
 *   propose_taxonomy_revision
 *   request_standard_variance / decide_standard_variance
 *   accept_risk (six-argument form)
 *
 * This module is the write/read path a customer can walk. It does not
 * invent a twin, approval store, or audit log. In-band RPC refusals
 * (role, length, SoD, expiry) surface as errors in the database's words.
 *
 * Honesty bars held here:
 *   - a recommended P-F interval is not an authorized inspection frequency;
 *   - a taxonomy proposal is a draft and does not replace adopted truth;
 *   - the AI-operator identity is not offered P-F adopt, taxonomy adopt,
 *     variance decide, or accept-risk. Propose may remain as a draft-only act.
 */
import { supabase } from "../lib/supabase";

export const PF_ADOPT_ROLES = ["reliability_engineer", "admin"] as const;

export const TAXONOMY_ADOPT_ROLES = [
  "admin",
  "reliability_engineer",
  "maintenance_manager",
] as const;

export const TAXONOMY_PROPOSE_ROLES = [
  ...TAXONOMY_ADOPT_ROLES,
  "ai_admin",
] as const;

export function canAdoptPfInterval(role: string | null | undefined): boolean {
  return role != null && (PF_ADOPT_ROLES as readonly string[]).includes(role);
}

/** Named-human adopt only. The AI-operator identity is not offered this act. */
export function canAdoptTaxonomy(role: string | null | undefined): boolean {
  return (
    role != null && (TAXONOMY_ADOPT_ROLES as readonly string[]).includes(role)
  );
}

/**
 * A proposal writes a draft. It does not replace adopted truth.
 * Kept for `ai_admin` because the RPC is a draft writer, not an authorizer.
 */
export function canProposeTaxonomy(role: string | null | undefined): boolean {
  return (
    role != null && (TAXONOMY_PROPOSE_ROLES as readonly string[]).includes(role)
  );
}

export function canGovernTaxonomy(role: string | null | undefined): boolean {
  return canAdoptTaxonomy(role);
}

export function canDecideVariance(role: string | null | undefined): boolean {
  // decide_standard_variance refuses ai_admin by name (§70).
  return role != null && role !== "ai_admin";
}

export function canAcceptRisk(role: string | null | undefined): boolean {
  // accept_risk (both signatures) refuses ai_admin by name (§70).
  return role != null && role !== "ai_admin";
}

interface RpcErrorShape {
  error?: unknown;
}

async function callRpc<T>(
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  const body = data as (T & RpcErrorShape) | null;
  if (body && typeof body.error === "string") {
    throw new Error(body.error);
  }
  if (body == null) throw new Error(`${name} returned nothing`);
  return body;
}

export interface AssetOption {
  id: string;
  name: string;
  asset_tag: string | null;
}

export interface SiteOption {
  id: string;
  name: string;
}

export interface OperatingStateRow {
  state: string;
  hours: number;
  pct_of_covered: number | null;
}

export interface OperatingContextResult {
  asset_id: string;
  window_days: number;
  states: OperatingStateRow[];
  starts_in_window: number;
  hours_covered: number;
  coverage_pct: number;
  records_total: number;
  data_span_from: string | null;
  data_span_to: string | null;
  basis: string;
}

export interface OperatingRegimeResult {
  asset_id: string;
  at: string;
  regime: string | null;
  basis: string;
}

export async function listAssetsForContext(): Promise<AssetOption[]> {
  const { data, error } = await supabase
    .from("assets")
    .select("id, name, asset_tag")
    .order("name")
    .limit(400);
  if (error) throw new Error(error.message);
  return (data ?? []) as AssetOption[];
}

export async function listSites(): Promise<SiteOption[]> {
  const { data, error } = await supabase
    .from("sites")
    .select("id, name")
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as SiteOption[];
}

export async function getOperatingContext(
  assetId: string,
  windowDays = 90,
): Promise<OperatingContextResult> {
  return callRpc<OperatingContextResult>("get_operating_context", {
    p_asset_id: assetId,
    p_window_days: windowDays,
  });
}

export async function getOperatingRegime(
  assetId: string,
  at: Date = new Date(),
): Promise<OperatingRegimeResult> {
  const atIso = at.toISOString();
  const { data, error } = await supabase.rpc("get_operating_regime", {
    p_asset_id: assetId,
    p_at: atIso,
  });
  if (error) throw new Error(error.message);
  const regime = typeof data === "string" && data.length > 0 ? data : null;
  return {
    asset_id: assetId,
    at: atIso,
    regime,
    basis: regime
      ? regime === "Unknown duty"
        ? "A state record covers this moment but load_pct was not recorded. Unknown duty is a real answer — it is not folded into high, moderate, or low duty."
        : `Duty class from the state record covering this moment: ${regime}.`
      : "No operating-state record covers this moment. The platform does not assume an asset with no state was running.",
  };
}

export function suggestedWindowDays(
  context: OperatingContextResult,
  now: Date = new Date(),
): number | null {
  if (context.records_total <= 0 || context.hours_covered > 0) return null;
  if (!context.data_span_from) return null;
  const from = new Date(context.data_span_from).getTime();
  if (Number.isNaN(from)) return null;
  const days = Math.ceil((now.getTime() - from) / 86_400_000) + 1;
  return days > 0 ? days : null;
}

export interface PfIntervalRow {
  id: string;
  failure_mode: string;
  detection_technique: string;
  pf_interval_days: number;
  recommended_inspection_days: number;
  status: "draft" | "adopted" | "superseded";
  basis: string;
  asset_class: string | null;
}

export async function listPfIntervals(): Promise<PfIntervalRow[]> {
  const { data, error } = await supabase
    .from("pf_intervals")
    .select(
      "id, failure_mode, detection_technique, pf_interval_days, recommended_inspection_days, status, basis, asset_class",
    )
    .neq("status", "superseded")
    .order("pf_interval_days");
  if (error) throw new Error(error.message);
  return (data ?? []) as PfIntervalRow[];
}

export interface AdoptPfIntervalResult {
  adopted: string;
  pf_interval_days: number;
  recommended_inspection_days: number;
}

export interface OpenWorkOrderOption {
  id: string;
  wo_number: string | null;
  title: string;
  status: string;
  asset_id: string | null;
}

export async function listOpenWorkOrders(): Promise<OpenWorkOrderOption[]> {
  const { data, error } = await supabase
    .from("work_orders")
    .select("id, wo_number, title, status, asset_id")
    .is("completed_at", null)
    .order("created_at", { ascending: false })
    .limit(80);
  if (error) throw new Error(error.message);
  return (data ?? []) as OpenWorkOrderOption[];
}

export interface LinkAlertToWorkResult {
  linked: string;
  work_order_id: string;
}

export async function linkAlertToWork(
  alertId: string,
  workOrderId: string,
): Promise<LinkAlertToWorkResult> {
  return callRpc<LinkAlertToWorkResult>("link_alert_to_work", {
    p_alert_id: alertId,
    p_work_order_id: workOrderId,
  });
}

export interface ObservedPfRow {
  technique: string;
  samples: number;
  observed_pf_days_mean: number;
  observed_pf_days_min: number;
  implied_inspection_days: number;
}

export interface ObservedPfResult {
  observed: ObservedPfRow[];
  available: boolean;
  min_samples: number;
  basis: string;
}

export async function deriveObservedPf(
  minSamples = 3,
): Promise<ObservedPfResult> {
  return callRpc<ObservedPfResult>("derive_observed_pf", {
    p_min_samples: minSamples,
  });
}

export async function adoptPfInterval(
  id: string,
  days: number,
  note: string,
): Promise<AdoptPfIntervalResult> {
  if (!(days > 0)) {
    throw new Error("the interval must be greater than zero days");
  }
  if (note.trim().length < 20) {
    throw new Error(
      "state the engineering basis for this interval (20 characters minimum)",
    );
  }
  return callRpc<AdoptPfIntervalResult>("adopt_pf_interval", {
    p_id: id,
    p_days: days,
    p_note: note.trim(),
  });
}

export interface ProposeTaxonomyRevisionResult {
  ok: boolean;
  id: string;
  version: number;
}

export async function proposeTaxonomyRevision(
  defKey: string,
  definition: string,
  basis: string,
): Promise<ProposeTaxonomyRevisionResult> {
  if (definition.trim().length < 20) {
    throw new Error("a substantive definition text is required");
  }
  return callRpc<ProposeTaxonomyRevisionResult>("propose_taxonomy_revision", {
    p_def_key: defKey,
    p_definition: definition.trim(),
    p_basis: basis.trim() || null,
  });
}

export interface RequestVarianceResult {
  variance_id: string;
  status: string;
  approver_role: string;
}

export async function requestStandardVariance(input: {
  standardId: string;
  siteId: string;
  justification: string;
  compensatingControls: string;
  expiresAt: string;
}): Promise<RequestVarianceResult> {
  if (input.justification.trim().length < 20) {
    throw new Error(
      "a variance request must state why the standard cannot be met (20 characters minimum)",
    );
  }
  if (input.compensatingControls.trim().length < 20) {
    throw new Error(
      "state the compensating controls. A variance without them is not a variance, it is a gap",
    );
  }
  return callRpc<RequestVarianceResult>("request_standard_variance", {
    p_standard_id: input.standardId,
    p_site_id: input.siteId,
    p_justification: input.justification.trim(),
    p_compensating_controls: input.compensatingControls.trim(),
    p_expires_at: input.expiresAt,
  });
}

export interface DecideVarianceResult {
  variance_id: string;
  status: string;
}

export async function decideStandardVariance(
  varianceId: string,
  approve: boolean,
  note: string,
): Promise<DecideVarianceResult> {
  if (note.trim().length < 10) {
    throw new Error("record the reasoning for this decision");
  }
  return callRpc<DecideVarianceResult>("decide_standard_variance", {
    p_variance_id: varianceId,
    p_approve: approve,
    p_note: note.trim(),
  });
}

export type RiskLevel = "Low" | "Medium" | "High" | "Critical";
export type RiskSubjectType = "recommendation" | "asset" | "site" | "standard";

export interface AcceptRiskResult {
  acceptance_id: string;
  expires_at: string;
  ceiling_checked: boolean;
}

export async function acceptRisk(input: {
  subjectType: RiskSubjectType;
  subjectId: string;
  riskLevel: RiskLevel;
  rationale: string;
  compensatingControls: string;
  expiresAt: string;
}): Promise<AcceptRiskResult> {
  if (input.rationale.trim().length < 20) {
    throw new Error(
      "state why this residual risk is acceptable (20 characters minimum)",
    );
  }
  if (input.compensatingControls.trim().length < 20) {
    throw new Error(
      "state the compensating controls that make the residual risk tolerable",
    );
  }
  return callRpc<AcceptRiskResult>("accept_risk", {
    p_subject_type: input.subjectType,
    p_subject_id: input.subjectId,
    p_risk_level: input.riskLevel,
    p_rationale: input.rationale.trim(),
    p_compensating_controls: input.compensatingControls.trim(),
    p_expires_at: input.expiresAt,
  });
}
