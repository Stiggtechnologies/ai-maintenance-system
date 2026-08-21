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
  /**
   * Commercial conversion provenance. These remain null until the invariant
   * lane's activate_ria_from_intake contract records an accepted engagement.
   */
  ria_assessment_id: string | null;
  activated_organization_id: string | null;
  activated_by: string | null;
  activated_at: string | null;
  commercial_acceptance_reference: string | null;
};

export type RiaActivationOrganization = {
  id: string;
  name: string;
};

export type RiaActivationOrganizationDirectory = {
  available: boolean;
  organizations: RiaActivationOrganization[];
};

export type ActivateRiaFromIntakeInput = {
  leadId: string;
  organizationId: string;
  scopeLabel: string;
  targetEndOn: string | null;
  acceptanceReference: string;
};

/** Columns that exist no matter which migration head the project is on. */
const BASE_LEAD_COLUMNS =
  "id, created_at, status, name, email, company, role, industry, asset_scope, primary_pain, notification_status, source_path";

/** Everything 20260914090000 added. Requested first; dropped if it is absent. */
const SLA_LEAD_COLUMNS = `${BASE_LEAD_COLUMNS}, first_response_due, first_responded_at`;

/**
 * The commercial-activation columns are deliberately read optimistically.
 * Frontend deploys can precede database deploys, so an older project must keep
 * the lead-response surface working until the invariant migration lands.
 */
const ACTIVATION_LEAD_COLUMNS = `${SLA_LEAD_COLUMNS}, ria_assessment_id, activated_organization_id, activated_by, activated_at, commercial_acceptance_reference`;

/** PostgREST surfaces Postgres' undefined_column as-is. */
const UNDEFINED_COLUMN = "42703";
const UNDEFINED_FUNCTION = "42883";
const POSTGREST_MISSING_FUNCTION = "PGRST202";

function isMissingFunction(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === UNDEFINED_FUNCTION ||
    error.code === POSTGREST_MISSING_FUNCTION ||
    /could not find the function|does not exist/i.test(error.message ?? "")
  );
}

function normalizeLead(
  row: Partial<PilotIntakeLead>,
): PilotIntakeLead {
  return {
    ...(row as PilotIntakeLead),
    first_response_due: row.first_response_due ?? null,
    first_responded_at: row.first_responded_at ?? null,
    ria_assessment_id: row.ria_assessment_id ?? null,
    activated_organization_id: row.activated_organization_id ?? null,
    activated_by: row.activated_by ?? null,
    activated_at: row.activated_at ?? null,
    commercial_acceptance_reference:
      row.commercial_acceptance_reference ?? null,
  };
}

/**
 * Admin-scoped list of pilot-intake leads, newest first. The admin gate is the
 * table's RLS policy, not this function — a non-admin session simply reads zero
 * rows. Bounded so a busy pipeline never streams unbounded rows to the client.
 *
 * DEGRADES RATHER THAN BREAKS. Vercel ships this frontend on push to main;
 * deploy-migrations.yml applies the schema on an entirely separate path. The
 * newest conversion/SLA columns are therefore tried first and peeled back only
 * when Postgres proves that deployment has not reached them yet.
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

  let { data, error } = await read(ACTIVATION_LEAD_COLUMNS);

  if (error?.code === UNDEFINED_COLUMN) {
    ({ data, error } = await read(SLA_LEAD_COLUMNS));
  }

  if (error?.code === UNDEFINED_COLUMN) {
    ({ data, error } = await read(BASE_LEAD_COLUMNS));
  }

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as unknown as Array<Partial<PilotIntakeLead>>).map(
    normalizeLead,
  );
}

/**
 * Records that a human answered this lead. This is the ONLY legacy write the
 * product has against pilot_intake_requests; commercial conversion is a
 * separate, privileged server contract because it creates state in a target
 * customer organization.
 */
export async function markPilotLeadResponded(leadId: string): Promise<void> {
  const { error } = await supabase.rpc("mark_pilot_lead_responded", {
    p_lead_id: leadId,
  });
  if (error) {
    throw new Error(error.message);
  }
}

/**
 * The normal organizations table is correctly member-scoped, so a browser must
 * never bypass it to discover customer tenants. The invariant lane may expose
 * this deliberately narrow admin directory (id + name only). Until it lands,
 * the Feature UI falls back to an explicit organization UUID supplied by the
 * operator instead of weakening organizations_member_read.
 */
export async function listRiaActivationOrganizations(): Promise<RiaActivationOrganizationDirectory> {
  const { data, error } = await supabase.rpc(
    "list_ria_activation_organizations",
  );

  if (isMissingFunction(error)) {
    return { available: false, organizations: [] };
  }
  if (error) throw new Error(error.message);

  const organizations = (Array.isArray(data) ? data : [])
    .map((row: unknown) => {
      const value = row as Record<string, unknown>;
      return {
        id: String(value.id ?? value.organization_id ?? ""),
        name: String(value.name ?? value.organization_name ?? ""),
      };
    })
    .filter((row) => row.id && row.name)
    .sort((a, b) => a.name.localeCompare(b.name));

  return { available: true, organizations };
}

/**
 * Convert an accepted lead into the canonical US$35K Reliability Intelligence
 * Assessment. The browser supplies intent only. Authorization, target-org
 * validation, idempotency and conversion provenance belong to the invariant
 * lane's SECURITY DEFINER RPC; this client deliberately does not write either
 * pilot_intake_requests or ria_assessments directly.
 */
export async function activateRiaFromIntake(
  input: ActivateRiaFromIntakeInput,
): Promise<{ assessmentId: string }> {
  const { data, error } = await supabase.rpc("activate_ria_from_intake", {
    p_lead_id: input.leadId,
    p_organization_id: input.organizationId,
    p_scope_label: input.scopeLabel,
    p_target_end_on: input.targetEndOn,
    p_acceptance_reference: input.acceptanceReference,
  });

  if (isMissingFunction(error)) {
    throw new Error(
      "RIA activation is not deployed yet. The commercial activation contract is still awaiting its governed server release.",
    );
  }
  if (error) throw new Error(error.message);

  const first = Array.isArray(data) ? data[0] : data;
  const assessmentId =
    typeof first === "string"
      ? first
      : first && typeof first === "object"
        ? String(
            (first as Record<string, unknown>).assessment_id ??
              (first as Record<string, unknown>).id ??
              "",
          )
        : "";

  if (!assessmentId) {
    throw new Error("RIA activation completed without an assessment identifier.");
  }

  return { assessmentId };
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
