import { supabase } from "../lib/supabase";

export const ADOPTION_MANAGEMENT_CATEGORIES = [
  "stakeholder_mapping", "role_design", "process_ownership", "training",
  "field_trials", "change_impact", "feedback", "adoption_metrics",
  "procedure_updates", "incentives", "communications", "champions",
  "benefits_tracking",
] as const;

export type AdoptionCategory = (typeof ADOPTION_MANAGEMENT_CATEGORIES)[number];
export type AdoptionStatus = "planned" | "in_progress" | "blocked" | "complete" | "cancelled";

export interface AdoptionPerson { id: string; name: string; role: string }
export interface AdoptionValuePoint {
  id: string; point: "baseline" | "target" | "actual"; value: number;
  unit: string; status: string; basis: string; recordedAt: string;
}
export interface AdoptionItem {
  id: string; category: AdoptionCategory; title: string; affectedGroup: string | null;
  ownerId: string; owner: string; ownerRole: string; plan: string;
  successMeasure: string; sourceReference: string | null; impactLevel: string | null;
  safetyGuardrail: string | null; dueOn: string; status: AdoptionStatus;
  evidenceItemId: string | null; evidenceBasis: string | null; valuePoints: AdoptionValuePoint[];
}
export interface AdoptionProgram {
  id: string; title: string; objective: string; scope: string; maturityAssessmentId: string | null;
  sponsorId: string; sponsor: string; processOwnerId: string; processOwner: string;
  startsOn: string; targetOn: string; status: "draft" | "active" | "review_pending" | "completed";
  createdBy: string; submittedBy: string | null; reviewedBy: string | null;
  reviewedAt: string | null; reviewNote: string | null;
  progress: { plannedCategories: number; completedCategories: number; openItems: number };
  items: AdoptionItem[];
}
export interface AdoptionWorkspace {
  categories: AdoptionCategory[]; people: AdoptionPerson[];
  maturityAssessments: Array<{ id: string; title: string; overallLevel: number; approvedAt: string }>;
  programs: AdoptionProgram[]; basis: string;
}

interface RpcResult { error?: string; [key: string]: unknown }
function assertRpc<T>(data: unknown, fallback: string): T {
  const value = (data ?? {}) as RpcResult;
  if (value.error) throw new Error(value.error);
  if (!data) throw new Error(fallback);
  return data as T;
}
async function rpc<T>(name: string, params: Record<string, unknown> = {}, fallback: string): Promise<T> {
  const { data, error } = await supabase.rpc(name, params);
  if (error) throw new Error(error.message);
  return assertRpc<T>(data, fallback);
}

export const getAdoptionManagementWorkspace = () =>
  rpc<AdoptionWorkspace>("get_adoption_management_workspace", {}, "Adoption workspace returned no data.");
export const createAdoptionProgram = (program: Record<string, unknown>) =>
  rpc<RpcResult>("create_adoption_program", { p_program: program }, "Adoption program was not created.");
export const upsertAdoptionItem = (programId: string, item: Record<string, unknown>) =>
  rpc<RpcResult>("upsert_adoption_item", { p_program_id: programId, p_item: item }, "Adoption item was not saved.");
export const activateAdoptionProgram = (programId: string, basis: string) =>
  rpc<RpcResult>("activate_adoption_program", { p_program_id: programId, p_basis: basis }, "Program was not activated.");
export const setAdoptionItemStatus = (itemId: string, status: AdoptionStatus, note: string, evidenceItemId?: string) =>
  rpc<RpcResult>("set_adoption_item_status", { p_item_id: itemId, p_status: status, p_note: note, p_evidence_item_id: evidenceItemId ?? null }, "Item status was not changed.");
export const recordAdoptionValuePoint = (input: { itemId: string; point: "baseline" | "target" | "actual"; value: number; unit: string; basis: string; evidenceItemId: string }) =>
  rpc<RpcResult>("record_adoption_value_point", { p_item_id: input.itemId, p_point: input.point, p_value: input.value, p_unit: input.unit, p_basis: input.basis, p_evidence_item_id: input.evidenceItemId }, "Value point was not recorded.");
export const submitAdoptionProgram = (programId: string, basis: string) =>
  rpc<RpcResult>("submit_adoption_program", { p_program_id: programId, p_basis: basis }, "Program was not submitted.");
export const reviewAdoptionProgram = (programId: string, decision: "approved" | "rejected", reviewNote: string) =>
  rpc<RpcResult>("review_adoption_program", { p_program_id: programId, p_decision: decision, p_review_note: reviewNote }, "Review was not recorded.");
