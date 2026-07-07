/**
 * Autonomous asset onboarding service — typed layer over the RAM-checklist
 * engine (migration 11):
 *
 *   run_onboarding_autofill()  → deterministic autonomous pass
 *   onboarding-enrich edge fn  → AI deduction pass (cron every 15 min,
 *                                request_onboarding_ai_pass() on demand)
 *   provide_onboarding_item()  → human-in-the-loop for what can't be found
 *   approve_asset_golive()     → Section-21 gate + SME sign-off
 *
 * All reads are org-scoped by RLS; all writes go through security-definer
 * RPCs that re-check the caller's org.
 */
import { supabase } from "../lib/supabase";

function fail(message: string, error: { message: string } | null): never {
  throw new Error(error ? `${message}: ${error.message}` : message);
}

export type OnboardingItemStatus =
  | "pending"
  | "auto_filled"
  | "deduced"
  | "pending_ai"
  | "human_required"
  | "human_provided"
  | "not_applicable";

export interface OnboardingRequirement {
  key: string;
  section_number: number;
  section_title: string;
  item_label: string;
  hint: string | null;
  fill_strategy: "record" | "derived" | "library" | "ai" | "human";
  required_for_golive: boolean;
  sort_order: number;
}

export interface OnboardingItem {
  id: string;
  asset_id: string;
  requirement_key: string;
  status: OnboardingItemStatus;
  value: Record<string, unknown> | string | null;
  source: string | null;
  confidence: "high" | "medium" | "low" | null;
  note: string | null;
  filled_at: string | null;
  requirement: OnboardingRequirement;
}

export interface OnboardingAssetOverview {
  asset_id: string;
  status: "in_progress" | "ready_for_golive" | "live";
  completion_pct: number;
  human_required_count: number;
  approved_by_label: string | null;
  approved_at: string | null;
  updated_at: string;
  asset: {
    id: string;
    name: string;
    tag: string | null;
    asset_class: string | null;
    criticality: string | null;
  };
}

export interface GoliveReadiness {
  required: number;
  satisfied: number;
  ready: boolean;
  missing: Array<{
    key: string;
    label: string;
    section: string;
    status: OnboardingItemStatus;
  }>;
}

export interface OnboardingSection {
  sectionNumber: number;
  sectionTitle: string;
  items: OnboardingItem[];
  satisfied: number;
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

export async function getOnboardingOverview(): Promise<
  OnboardingAssetOverview[]
> {
  const { data, error } = await supabase
    .from("asset_onboarding_state")
    .select(
      "asset_id, status, completion_pct, human_required_count, approved_by_label, approved_at, updated_at, asset:assets(id,name,tag,asset_class,criticality)",
    )
    .order("completion_pct", { ascending: false })
    .returns<OnboardingAssetOverview[]>();
  if (error) fail("Could not load onboarding overview", error);
  return data ?? [];
}

export async function getOnboardingChecklist(
  assetId: string,
): Promise<OnboardingItem[]> {
  const { data, error } = await supabase
    .from("asset_onboarding_items")
    .select(
      "id, asset_id, requirement_key, status, value, source, confidence, note, filled_at, requirement:onboarding_requirements(*)",
    )
    .eq("asset_id", assetId)
    .returns<OnboardingItem[]>();
  if (error) fail("Could not load onboarding checklist", error);
  return data ?? [];
}

export async function getGoliveReadiness(
  assetId: string,
): Promise<GoliveReadiness> {
  const { data, error } = await supabase.rpc("get_golive_readiness", {
    p_asset_id: assetId,
  });
  if (error) fail("Could not check go-live readiness", error);
  return data as GoliveReadiness;
}

/* -------------------------------------------------------------------------- */
/* Autonomous passes                                                          */
/* -------------------------------------------------------------------------- */

export interface AutofillResult {
  asset_id: string;
  asset: string;
  auto_filled: number;
  pending_ai: number;
  human_required: number;
  completion_pct: number;
  error?: string;
}

export async function runOnboardingAutofill(
  assetId: string,
): Promise<AutofillResult> {
  const { data, error } = await supabase.rpc("run_onboarding_autofill", {
    p_asset_id: assetId,
  });
  if (error) fail("Autonomous onboarding pass failed", error);
  const result = data as AutofillResult;
  if (result.error)
    fail(`Autonomous onboarding pass failed: ${result.error}`, null);
  return result;
}

export async function requestAiDeductionPass(): Promise<{
  requested?: boolean;
  skipped?: string;
}> {
  const { data, error } = await supabase.rpc("request_onboarding_ai_pass");
  if (error) fail("Could not request AI deduction pass", error);
  return data as { requested?: boolean; skipped?: string };
}

/* -------------------------------------------------------------------------- */
/* Human-in-the-loop                                                          */
/* -------------------------------------------------------------------------- */

export async function provideOnboardingItem(
  itemId: string,
  summary: string,
  options?: { note?: string; notApplicable?: boolean },
): Promise<{ updated: boolean; completion_pct: number }> {
  const { data, error } = await supabase.rpc("provide_onboarding_item", {
    p_item_id: itemId,
    p_value: { summary },
    p_note: options?.note ?? null,
    p_not_applicable: options?.notApplicable ?? false,
  });
  if (error) fail("Could not save onboarding answer", error);
  const result = data as {
    updated?: boolean;
    completion_pct?: number;
    error?: string;
  };
  if (result.error)
    fail(`Could not save onboarding answer: ${result.error}`, null);
  return { updated: true, completion_pct: result.completion_pct ?? 0 };
}

export async function approveAssetGolive(assetId: string): Promise<{
  approved: boolean;
  asset?: string;
  approved_by?: string;
  missing?: GoliveReadiness["missing"];
}> {
  const { data, error } = await supabase.rpc("approve_asset_golive", {
    p_asset_id: assetId,
  });
  if (error) fail("Go-live approval failed", error);
  const result = data as {
    approved?: boolean;
    asset?: string;
    approved_by?: string;
    missing?: GoliveReadiness["missing"];
    error?: string;
  };
  if (result.error) fail(`Go-live approval failed: ${result.error}`, null);
  return {
    approved: result.approved ?? false,
    asset: result.asset,
    approved_by: result.approved_by,
    missing: result.missing,
  };
}

/* -------------------------------------------------------------------------- */
/* Pure helpers (unit-tested)                                                 */
/* -------------------------------------------------------------------------- */

const SATISFIED_STATUSES: OnboardingItemStatus[] = [
  "auto_filled",
  "deduced",
  "human_provided",
  "not_applicable",
];

export function isItemSatisfied(status: OnboardingItemStatus): boolean {
  return SATISFIED_STATUSES.includes(status);
}

export function isItemHumanQueue(status: OnboardingItemStatus): boolean {
  return status === "human_required" || status === "pending_ai";
}

/** Group checklist items into ordered sections with satisfaction counts. */
export function groupChecklistBySection(
  items: OnboardingItem[],
): OnboardingSection[] {
  const sections = new Map<number, OnboardingSection>();
  for (const item of items) {
    const req = item.requirement;
    if (!req) continue;
    let section = sections.get(req.section_number);
    if (!section) {
      section = {
        sectionNumber: req.section_number,
        sectionTitle: req.section_title,
        items: [],
        satisfied: 0,
      };
      sections.set(req.section_number, section);
    }
    section.items.push(item);
    if (isItemSatisfied(item.status)) section.satisfied += 1;
  }
  const ordered = [...sections.values()].sort(
    (a, b) => a.sectionNumber - b.sectionNumber,
  );
  for (const section of ordered) {
    section.items.sort(
      (a, b) =>
        (a.requirement?.sort_order ?? 0) - (b.requirement?.sort_order ?? 0),
    );
  }
  return ordered;
}

/** Render an item's stored jsonb value as a short human-readable string. */
export function formatItemValue(
  value: OnboardingItem["value"],
  maxLength = 160,
): string {
  if (value == null) return "";
  let text: string;
  if (typeof value === "string") {
    text = value;
  } else if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.summary === "string") {
      text = record.summary;
    } else if (typeof record.strategy === "string") {
      text = record.strategy;
    } else if (typeof record.level === "string") {
      text = String(record.level) + (record.basis ? ` — ${record.basis}` : "");
    } else if (typeof record.path === "string") {
      text = record.path;
    } else {
      text = Object.entries(record)
        .filter(([, v]) => typeof v !== "object")
        .map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`)
        .join(" · ");
      if (!text) text = JSON.stringify(record);
    }
  } else {
    text = String(value);
  }
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

export const ITEM_STATUS_META: Record<
  OnboardingItemStatus,
  { label: string; tone: "auto" | "ai" | "human" | "muted" }
> = {
  auto_filled: { label: "Auto-filled", tone: "auto" },
  deduced: { label: "AI deduced", tone: "ai" },
  pending_ai: { label: "AI queued", tone: "ai" },
  human_required: { label: "Needs human input", tone: "human" },
  human_provided: { label: "Provided by human", tone: "auto" },
  not_applicable: { label: "Not applicable", tone: "muted" },
  pending: { label: "Pending", tone: "muted" },
};
