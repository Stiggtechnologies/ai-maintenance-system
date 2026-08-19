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
   * (20260914090000_lead_notify_trigger.sql). Null when this build is running
   * against a project that has not applied that migration yet.
   */
  first_response_due: string | null;
  /**
   * When a human actually answered, set by mark_pilot_lead_responded(). The
   * only thing that clears the overdue flag — nothing else in the product can
   * write to this table.
   */
  first_responded_at: string | null;
};

/** Columns that exist no matter which migration head the project is on. */
const BASE_LEAD_COLUMNS =
  "id, created_at, status, name, email, company, role, industry, asset_scope, primary_pain, notification_status, source_path";

/** Everything 20260914090000 added. Requested first; dropped if it is absent. */
const SLA_LEAD_COLUMNS = `${BASE_LEAD_COLUMNS}, first_response_due, first_responded_at`;

/** PostgREST surfaces Postgres' undefined_column as-is. */
const UNDEFINED_COLUMN = "42703";

/**
 * Admin-scoped list of pilot-intake leads, newest first. The admin gate is the
 * table's RLS policy, not this function — a non-admin session simply reads zero
 * rows. Bounded so a busy pipeline never streams unbounded rows to the client.
 *
 * DEGRADES RATHER THAN BREAKS. Vercel ships this frontend on push to main;
 * deploy-migrations.yml applies the schema on an entirely separate path, and
 * that workflow's own history records it failing for three weeks while CI
 * stayed green and frontends kept shipping. If this select names a column the
 * deployed schema does not have yet, PostgREST rejects the whole query and
 * /pilot-leads renders nothing but an error — the page that exists as the
 * human fallback for a lead going cold would be the first casualty. So the SLA
 * columns are requested, and on 42703 the query is retried without them.
 */
export async function listPilotIntakeRequests(
  limit = 300,
): Promise<PilotIntakeLead[]> {
  const read = (columns: string) =>
    supabase
      .from("pilot_intake_requests")
      .select(columns)
      .order("created_at", { ascending: false })
      .limit(limit);

  let { data, error } = await read(SLA_LEAD_COLUMNS);

  if (error?.code === UNDEFINED_COLUMN) {
    ({ data, error } = await read(BASE_LEAD_COLUMNS));
  }

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as unknown as Array<Partial<PilotIntakeLead>>).map(
    (row) => ({
      ...row,
      first_response_due: row.first_response_due ?? null,
      first_responded_at: row.first_responded_at ?? null,
    }),
  ) as PilotIntakeLead[];
}

/**
 * Records that a human answered this lead. This is the ONLY write the product
 * has against pilot_intake_requests: the table has a single RLS policy
 * (SELECT, admin/ai_admin) and no write policy at all, so it goes through a
 * SECURITY DEFINER RPC that repeats the same admin role test. Without it the
 * overdue flag could never clear and every lead would sit red forever.
 */
export async function markPilotLeadResponded(leadId: string): Promise<void> {
  const { error } = await supabase.rpc("mark_pilot_lead_responded", {
    p_lead_id: leadId,
  });
  if (error) {
    throw new Error(error.message);
  }
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
