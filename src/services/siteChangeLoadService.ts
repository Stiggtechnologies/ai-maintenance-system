import { supabase } from "../lib/supabase";

export interface SiteChangeLoad {
  siteId: string;
  asOf: string;
  horizonWeeks: number;
  horizonEnd: string;
  changeLoadIndex: number;
  indexKind: "unweighted_concurrent_record_count";
  dimensions: {
    activeProjects: number;
    outageWindows: number;
    temporaryModifications: number;
    activeTrainingPlans: number;
    releasedScheduleOptions: number;
    maintenanceBacklog: number;
    capacityDeductions: number;
  };
  forecastComputable: boolean;
  forecastState: string;
  quantifiedLoadHours: number;
  netWeeklyCapacityHours: number;
  horizonCapacityHours: number;
  horizonUtilizationPct: number | null;
  weeksToAbsorb: number | null;
  evidenceGaps: Record<string, number | boolean>;
  capacity: Array<{ category: string; pool: string; weeklyHours: number; basis: string }>;
  capacityDeductionContext: { rows: number; weeklyHoursRecorded: number; treatment: string };
  basis: string;
  decisionBoundary: string;
}

export async function getSiteChangeLoad(siteId: string, horizonWeeks = 13): Promise<SiteChangeLoad> {
  const { data, error } = await supabase.rpc("get_site_change_load", {
    p_site_id: siteId,
    p_horizon_weeks: horizonWeeks,
    p_as_of: null,
  });
  if (error) throw new Error(error.message);
  const result = data as (SiteChangeLoad & { error?: string }) | null;
  if (!result) throw new Error("Site change-load response was empty");
  if (result.error) throw new Error(result.error);
  return result;
}

export async function listSiteChangeLoadInputs(siteId: string) {
  const [members, competencies] = await Promise.all([
    supabase.from("workforce_members").select("id,display_name").eq("site_id", siteId).eq("active", true).order("display_name"),
    supabase.from("competencies").select("id,title").order("title"),
  ]);
  if (members.error) throw new Error(members.error.message);
  if (competencies.error) throw new Error(competencies.error.message);
  return {
    members: (members.data ?? []).map((row) => ({ id: Number(row.id), label: row.display_name as string })),
    competencies: (competencies.data ?? []).map((row) => ({ id: Number(row.id), label: row.title as string })),
  };
}

function unwrapWrite(data: unknown, error: { message: string } | null) {
  if (error) throw new Error(error.message);
  const result = data as { error?: string } | null;
  if (!result) throw new Error("The planning write returned no result");
  if (result.error) throw new Error(result.error);
  return result;
}

export async function recordSiteOutageWindow(input: {
  siteId: string; windowKey: string; title: string; kind: string;
  startsAt: string; endsAt: string; scope?: string;
}) {
  const { data, error } = await supabase.rpc("record_site_outage_window", {
    p_site_id: input.siteId,
    p_window_key: input.windowKey,
    p_title: input.title,
    p_kind: input.kind,
    p_starts_at: input.startsAt,
    p_ends_at: input.endsAt,
    p_scope: input.scope ?? null,
  });
  return unwrapWrite(data, error);
}

export async function recordSiteTrainingPlan(input: {
  siteId: string; memberId: number; competencyId: number; planKind: string;
  targetDate: string; driver: string;
}) {
  const { data, error } = await supabase.rpc("record_site_training_plan", {
    p_site_id: input.siteId,
    p_member_id: input.memberId,
    p_competency_id: input.competencyId,
    p_plan_kind: input.planKind,
    p_target_date: input.targetDate,
    p_driver: input.driver,
  });
  return unwrapWrite(data, error);
}
