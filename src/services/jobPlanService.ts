/**
 * Job-plan authoring callers (C8.07, C4.05).
 *
 * The schema and SECURITY DEFINER RPCs shipped in 20260811090000 and sat
 * uncalled: upsert_job_plan, adopt_job_plan and apply_job_plan had zero
 * product callers, so /job-plans could list an empty library and nothing
 * could write a plan. This module is the write path.
 *
 * Rules enforced in the database and only surfaced here:
 *   - authoring and adoption require a planning or engineering role;
 *   - a plan cannot be adopted without at least one step and one quality
 *     check that carries an acceptance criterion;
 *   - only an ADOPTED plan may be applied to real work;
 *   - adoption records auth.uid() — it is a named-human act.
 *
 * Known residual: upsert_job_plan silently drops material lines whose
 * material_code does not resolve. Callers must only send catalogue codes
 * and must tell the operator when the catalogue is empty.
 */
import { supabase } from "../lib/supabase";

export const JOB_PLAN_AUTHOR_ROLES = [
  "planner",
  "reliability_engineer",
  "maintenance_manager",
  "admin",
  "ai_admin",
] as const;

export function canAuthorJobPlans(role: string | null | undefined): boolean {
  return (
    role != null &&
    (JOB_PLAN_AUTHOR_ROLES as readonly string[]).includes(role)
  );
}

export interface JobPlanSummary {
  id: string;
  plan_key: string;
  title: string;
  scope: string;
  applies_to: string;
  status: "draft" | "adopted";
  version: number;
  steps: number;
  estimated_hours: number;
  materials: number;
  tools: number;
  permits: number;
  checks: number;
  applied_to_work_orders: number;
}

export interface PlanningAccuracy {
  available: boolean;
  sample: number;
  mean_absolute_error_pct: number | null;
  bias_pct: number | null;
  within_10_pct: number | null;
  bias_reading: string | null;
  basis: string;
}

export interface JobPlanStep {
  step_number: number;
  description: string;
  craft: string;
  crew_size: number;
  estimated_hours: number;
}

export interface JobPlanMaterialLine {
  material_code: string;
  description: string;
  qty: number;
}

export interface JobPlanTool {
  tool: string;
  note: string;
}

export interface JobPlanPermit {
  permit_type: string;
  isolation_required: string;
  verification_note: string;
}

export interface JobPlanCheck {
  check_description: string;
  acceptance_criterion: string;
  is_hold_point: boolean;
}

export interface JobPlanDetail {
  id: string;
  plan_key: string;
  title: string;
  scope: string;
  applies_to_asset_class: string;
  applies_to_system_group: string;
  basis: string;
  status: "draft" | "adopted" | "superseded";
  version: number;
  steps: JobPlanStep[];
  materials: JobPlanMaterialLine[];
  tools: JobPlanTool[];
  permits: JobPlanPermit[];
  checks: JobPlanCheck[];
}

export interface JobPlanDraft {
  plan_key: string;
  title: string;
  scope: string;
  applies_to_asset_class: string;
  applies_to_system_group: string;
  basis: string;
  steps: JobPlanStep[];
  materials: JobPlanMaterialLine[];
  tools: JobPlanTool[];
  permits: JobPlanPermit[];
  checks: JobPlanCheck[];
}

export interface MaterialOption {
  id: string;
  material_code: string;
  description: string;
  unit_of_measure: string;
}

export interface WorkOrderOption {
  id: string;
  wo_number: string | null;
  title: string;
  status: string;
  job_plan_id: string | null;
}

export interface JobPlanList {
  plans: JobPlanSummary[];
  note: string;
}

export interface UpsertJobPlanResult {
  job_plan_id: string;
  plan_key: string;
  steps: number;
  status: string;
}

export interface AdoptJobPlanResult {
  adopted: string;
  steps: number;
  checks: number;
}

export interface ApplyJobPlanResult {
  work_order_id: string;
  plan: string;
  tasks_created: number;
  planned_hours: number;
  materials_requested: number;
  permits_required: number;
  safety_flagged: boolean;
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

export async function listJobPlans(): Promise<JobPlanList> {
  const data = await callRpc<JobPlanList>("get_job_plans", {});
  return {
    plans: data.plans ?? [],
    note:
      data.note ??
      "A plan cannot be adopted without at least one step and at least one acceptance criterion, and only an ADOPTED plan may be applied to real work.",
  };
}

export async function getPlanningAccuracy(): Promise<PlanningAccuracy> {
  return callRpc<PlanningAccuracy>("get_planning_accuracy", {});
}

export async function listMaterials(): Promise<MaterialOption[]> {
  const { data, error } = await supabase
    .from("materials")
    .select("id,material_code,description,unit_of_measure")
    .order("material_code");
  if (error) throw new Error(error.message);
  return (data ?? []) as MaterialOption[];
}

export async function listOpenWorkOrders(): Promise<WorkOrderOption[]> {
  const { data, error } = await supabase
    .from("work_orders")
    .select("id,wo_number,title,status,job_plan_id")
    .order("created_at", { ascending: false })
    .limit(80);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as WorkOrderOption[];
  return rows.filter(
    (wo) => wo.status !== "completed" && wo.status !== "cancelled",
  );
}

export async function getJobPlanDetail(id: string): Promise<JobPlanDetail> {
  const [planRes, stepsRes, materialsRes, toolsRes, permitsRes, checksRes] =
    await Promise.all([
      supabase
        .from("job_plans")
        .select(
          "id,plan_key,title,scope,applies_to_asset_class,applies_to_system_group,basis,status,version",
        )
        .eq("id", id)
        .maybeSingle(),
      supabase
        .from("job_plan_steps")
        .select("step_number,description,craft,crew_size,estimated_hours")
        .eq("job_plan_id", id)
        .order("step_number"),
      supabase
        .from("job_plan_materials")
        .select("qty,materials(material_code,description)")
        .eq("job_plan_id", id),
      supabase
        .from("job_plan_tools")
        .select("tool,note")
        .eq("job_plan_id", id),
      supabase
        .from("job_plan_permits")
        .select("permit_type,isolation_required,verification_note")
        .eq("job_plan_id", id),
      supabase
        .from("job_plan_checks")
        .select("check_description,acceptance_criterion,is_hold_point")
        .eq("job_plan_id", id),
    ]);

  for (const res of [
    planRes,
    stepsRes,
    materialsRes,
    toolsRes,
    permitsRes,
    checksRes,
  ]) {
    if (res.error) throw new Error(res.error.message);
  }
  if (!planRes.data) throw new Error("job plan not found");

  const p = planRes.data as {
    id: string;
    plan_key: string;
    title: string;
    scope: string;
    applies_to_asset_class: string | null;
    applies_to_system_group: string | null;
    basis: string | null;
    status: JobPlanDetail["status"];
    version: number;
  };

  const materialRows = (materialsRes.data ?? []) as Array<{
    qty: number;
    materials:
      | { material_code: string; description: string | null }
      | { material_code: string; description: string | null }[]
      | null;
  }>;

  return {
    id: p.id,
    plan_key: p.plan_key,
    title: p.title,
    scope: p.scope,
    applies_to_asset_class: p.applies_to_asset_class ?? "",
    applies_to_system_group: p.applies_to_system_group ?? "",
    basis: p.basis ?? "",
    status: p.status,
    version: p.version,
    steps: ((stepsRes.data ?? []) as JobPlanStep[]).map((s) => ({
      step_number: s.step_number,
      description: s.description ?? "",
      craft: s.craft ?? "",
      crew_size: s.crew_size ?? 1,
      estimated_hours: Number(s.estimated_hours),
    })),
    materials: materialRows.flatMap((row) => {
      const mat = Array.isArray(row.materials)
        ? row.materials[0]
        : row.materials;
      if (!mat?.material_code) return [];
      return [
        {
          material_code: mat.material_code,
          description: mat.description ?? "",
          qty: Number(row.qty),
        },
      ];
    }),
    tools: ((toolsRes.data ?? []) as JobPlanTool[]).map((t) => ({
      tool: t.tool ?? "",
      note: t.note ?? "",
    })),
    permits: ((permitsRes.data ?? []) as JobPlanPermit[]).map((perm) => ({
      permit_type: perm.permit_type ?? "",
      isolation_required: perm.isolation_required ?? "",
      verification_note: perm.verification_note ?? "",
    })),
    checks: ((checksRes.data ?? []) as JobPlanCheck[]).map((c) => ({
      check_description: c.check_description ?? "",
      acceptance_criterion: c.acceptance_criterion ?? "",
      is_hold_point: Boolean(c.is_hold_point),
    })),
  };
}

function compactText(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Build the jsonb payload upsert_job_plan expects. Empty rows are dropped
 * rather than sent as blanks. Materials whose code is not in `catalogue`
 * are omitted — the RPC would drop them silently, and a silent drop is
 * not a save.
 */
export function buildUpsertPayload(
  draft: JobPlanDraft,
  catalogue: MaterialOption[],
): { plan: Record<string, unknown>; droppedMaterialCodes: string[] } {
  const known = new Set(catalogue.map((m) => m.material_code));
  const droppedMaterialCodes: string[] = [];
  const materials: Array<{ material_code: string; qty: number }> = [];

  for (const line of draft.materials) {
    const code = line.material_code.trim();
    if (!code) continue;
    if (!known.has(code)) {
      droppedMaterialCodes.push(code);
      continue;
    }
    const qty = Number(line.qty);
    materials.push({
      material_code: code,
      qty: Number.isFinite(qty) && qty > 0 ? qty : 1,
    });
  }

  const steps = draft.steps
    .filter((s) => s.description.trim().length > 0)
    .map((s, i) => ({
      step_number: s.step_number || i + 1,
      description: s.description.trim(),
      craft: compactText(s.craft),
      crew_size: Number.isFinite(s.crew_size) && s.crew_size > 0 ? s.crew_size : 1,
      estimated_hours: Number(s.estimated_hours),
    }));

  const plan = {
    plan_key: draft.plan_key.trim(),
    title: draft.title.trim(),
    scope: draft.scope.trim(),
    applies_to_asset_class: compactText(draft.applies_to_asset_class),
    applies_to_system_group: compactText(draft.applies_to_system_group),
    basis: compactText(draft.basis),
    steps,
    materials,
    tools: draft.tools
      .filter((t) => t.tool.trim().length > 0)
      .map((t) => ({ tool: t.tool.trim(), note: compactText(t.note) })),
    permits: draft.permits
      .filter((p) => p.permit_type.trim().length > 0)
      .map((p) => ({
        permit_type: p.permit_type.trim(),
        isolation_required: compactText(p.isolation_required),
        verification_note: compactText(p.verification_note),
      })),
    checks: draft.checks
      .filter(
        (c) =>
          c.check_description.trim().length > 0 &&
          c.acceptance_criterion.trim().length > 0,
      )
      .map((c) => ({
        check_description: c.check_description.trim(),
        acceptance_criterion: c.acceptance_criterion.trim(),
        is_hold_point: Boolean(c.is_hold_point),
      })),
  };

  return { plan, droppedMaterialCodes };
}

export async function upsertJobPlan(
  draft: JobPlanDraft,
  catalogue: MaterialOption[],
): Promise<UpsertJobPlanResult & { droppedMaterialCodes: string[] }> {
  const { plan, droppedMaterialCodes } = buildUpsertPayload(draft, catalogue);
  const result = await callRpc<UpsertJobPlanResult>("upsert_job_plan", {
    p_plan: plan,
  });
  return { ...result, droppedMaterialCodes };
}

export async function adoptJobPlan(
  id: string,
  note: string,
): Promise<AdoptJobPlanResult> {
  return callRpc<AdoptJobPlanResult>("adopt_job_plan", {
    p_id: id,
    p_note: note,
  });
}

export async function applyJobPlan(
  workOrderId: string,
  planKey: string,
): Promise<ApplyJobPlanResult> {
  return callRpc<ApplyJobPlanResult>("apply_job_plan", {
    p_work_order_id: workOrderId,
    p_plan_key: planKey,
  });
}

export function draftFromDetail(detail: JobPlanDetail): JobPlanDraft {
  return {
    plan_key: detail.plan_key,
    title: detail.title,
    scope: detail.scope,
    applies_to_asset_class: detail.applies_to_asset_class,
    applies_to_system_group: detail.applies_to_system_group,
    basis: detail.basis,
    steps: detail.steps.length > 0 ? detail.steps : [emptyStep(1)],
    materials: detail.materials,
    tools: detail.tools,
    permits: detail.permits,
    checks: detail.checks.length > 0 ? detail.checks : [emptyCheck()],
  };
}

export function emptyDraft(): JobPlanDraft {
  return {
    plan_key: "",
    title: "",
    scope: "",
    applies_to_asset_class: "",
    applies_to_system_group: "",
    basis: "",
    steps: [emptyStep(1)],
    materials: [],
    tools: [],
    permits: [],
    checks: [emptyCheck()],
  };
}

export function emptyStep(step_number: number): JobPlanStep {
  return {
    step_number,
    description: "",
    craft: "",
    crew_size: 1,
    estimated_hours: 1,
  };
}

export function emptyCheck(): JobPlanCheck {
  return {
    check_description: "",
    acceptance_criterion: "",
    is_hold_point: false,
  };
}

export function emptyTool(): JobPlanTool {
  return { tool: "", note: "" };
}

export function emptyPermit(): JobPlanPermit {
  return {
    permit_type: "",
    isolation_required: "",
    verification_note: "",
  };
}

export function emptyMaterial(): JobPlanMaterialLine {
  return { material_code: "", description: "", qty: 1 };
}
