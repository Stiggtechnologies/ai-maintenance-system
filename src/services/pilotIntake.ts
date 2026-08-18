import { supabase } from "../lib/supabase";

export type PilotIntakeSubmission = {
  name: string;
  email: string;
  company: string;
  role: string;
  industry: string;
  assetScope: string;
  systemOfRecord: string;
  historyAvailable: string;
  primaryPain: string;
  dataReadiness: string;
  securityNeed: string;
  commercialModel: string;
  notes: string;
};

/**
 * A pilot-intake lead as read back by an admin. Only the columns the table
 * actually stores are surfaced — no derived or invented fields. Access is
 * gated entirely by RLS: pilot_intake_requests_admin_read
 * (20260913090000_pilot_leads_admin_only.sql) returns rows only to admin /
 * ai_admin, so a non-admin authed caller gets an empty list, not an error.
 */
export type PilotIntakeLead = {
  id: string;
  created_at: string;
  status: string;
  name: string;
  email: string;
  company: string;
  role: string | null;
  industry: string | null;
  asset_scope: string;
  primary_pain: string;
  notification_status: string;
  source_path: string;
  /**
   * One business hour after created_at (Mon-Fri 08:00-17:00 America/Edmonton),
   * written by trg_pilot_intake_first_response_due
   * (20260914090000_lead_notify_trigger.sql). Nullable only for the window
   * between a row landing and that migration's backfill.
   */
  first_response_due: string | null;
};

const LEAD_COLUMNS =
  "id, created_at, status, name, email, company, role, industry, asset_scope, primary_pain, notification_status, source_path, first_response_due";

/**
 * Admin-scoped list of pilot-intake leads, newest first. The admin gate is the
 * table's RLS policy, not this function — a non-admin session simply reads zero
 * rows. Bounded so a busy pipeline never streams unbounded rows to the client.
 */
export async function listPilotIntakeRequests(
  limit = 300,
): Promise<PilotIntakeLead[]> {
  const { data, error } = await supabase
    .from("pilot_intake_requests")
    .select(LEAD_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as PilotIntakeLead[];
}

export async function submitPilotIntake(input: PilotIntakeSubmission) {
  const { data, error } = await supabase.rpc("submit_pilot_intake_request", {
    request: {
      name: input.name,
      email: input.email,
      company: input.company,
      role: input.role,
      industry: input.industry,
      asset_scope: input.assetScope,
      system_of_record: input.systemOfRecord,
      history_available: input.historyAvailable,
      primary_pain: input.primaryPain,
      data_readiness: input.dataReadiness,
      security_need: input.securityNeed,
      commercial_model: input.commercialModel,
      notes: input.notes,
      notification_status: "queued",
      source_path:
        typeof window === "undefined"
          ? "/pilot/reliability"
          : window.location.pathname,
    },
  });

  if (error) {
    throw error;
  }

  return { id: String(data) };
}

export async function createPilotOnboardingPackage(
  intakeRequestId: string | null,
  input: PilotIntakeSubmission,
) {
  const packageItems = [
    "workspace_shell",
    "data_request_checklist",
    "role_invites",
    "governance_gates",
    "first_analysis_queue",
    "commercial_path",
  ];

  const { data, error } = await supabase.rpc(
    "create_pilot_onboarding_package",
    {
      request: {
        intake_request_id: intakeRequestId,
        company: input.company,
        asset_scope: input.assetScope,
        system_of_record: input.systemOfRecord,
        primary_pain: input.primaryPain,
        data_readiness: input.dataReadiness,
        security_need: input.securityNeed,
        commercial_model: input.commercialModel,
        package_items: packageItems,
        status: "generated",
        source_path:
          typeof window === "undefined"
            ? "/pilot/reliability"
            : window.location.pathname,
      },
    },
  );

  if (error) {
    throw error;
  }

  return { id: String(data) };
}
