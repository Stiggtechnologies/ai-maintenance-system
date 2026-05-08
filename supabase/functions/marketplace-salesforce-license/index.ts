/**
 * marketplace-salesforce-license Edge Function
 *
 * Salesforce AppExchange / License Management App (LMA) license-event
 * receiver. The customer's Salesforce Flow on the License object POSTs
 * here every time a license record changes state (Active / Trial /
 * Suspended / Uninstalled / Expired). Authenticates via a shared secret.
 *
 * Request body:
 *   {
 *     "action": "license_event",
 *     "license_id": "a0X...",
 *     "organization_id": "00D...",
 *     "package_version_id": "04t...",
 *     "seats": 25,
 *     "status": "Active" | "Trial" | "Suspended" | "Uninstalled" | "Expired",
 *     "expires_at": "2026-12-31T00:00:00Z" | null
 *   }
 *
 * Required env: SF_LMA_SHARED_SECRET (long random string set on the
 * customer's Named Credential inside the managed package).
 *
 * Schema dependency: 20260513000000_aws_salesforce_marketplace_integration.sql
 */
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") || "https://app.syncai.ca",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

interface LicenseEventBody {
  action: "license_event";
  license_id: string;
  organization_id: string;
  package_version_id: string;
  seats: number;
  status: "Active" | "Trial" | "Suspended" | "Uninstalled" | "Expired";
  expires_at: string | null;
}

const STATUS_MAP: Record<LicenseEventBody["status"], string> = {
  Active: "sf_active",
  Trial: "sf_trial",
  Suspended: "sf_suspended",
  Uninstalled: "sf_uninstalled",
  Expired: "sf_expired",
};

const ACTION_MAP: Record<LicenseEventBody["status"], string> = {
  Active: "license_active",
  Trial: "license_trial",
  Suspended: "license_suspended",
  Uninstalled: "license_uninstalled",
  Expired: "license_expired",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  try {
    // Authenticate via shared secret (Salesforce Named Credential bearer token)
    const expectedSecret = Deno.env.get("SF_LMA_SHARED_SECRET");
    if (!expectedSecret) return json({ ok: false, error: "Server misconfigured (SF_LMA_SHARED_SECRET unset)" }, 500);
    const authHeader = req.headers.get("Authorization") ?? "";
    const provided = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
    if (provided !== expectedSecret) return json({ ok: false, error: "Forbidden" }, 403);

    const body = (await req.json().catch(() => ({}))) as LicenseEventBody;
    const v = validate(body);
    if (v.error) return json({ ok: false, error: v.error }, 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return json({ ok: false, error: "Server misconfigured" }, 500);
    const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const newStatus = STATUS_MAP[body.status];
    const action = ACTION_MAP[body.status];

    // 1. Idempotent log
    const eventId = `${body.license_id}_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    const { error: logErr } = await supabase.from("salesforce_license_events").insert({
      sf_license_id: body.license_id,
      event_id: eventId,
      sf_organization_id: body.organization_id,
      action,
      seats: body.seats,
      status: "pending",
      payload: body as unknown as Record<string, unknown>,
    });
    if (logErr) return json({ ok: false, error: `Event log failed: ${logErr.message}` }, 500);

    // 2. Upsert subscription via RPC
    const { data: subId, error: rpcErr } = await supabase.rpc("upsert_salesforce_license_subscription", {
      p_sf_license_id: body.license_id,
      p_sf_organization_id: body.organization_id,
      p_sf_package_version_id: body.package_version_id,
      p_seats: body.seats,
      p_sf_status: newStatus,
      p_expires_at: body.expires_at,
      p_payload: body as unknown as Record<string, unknown>,
    });
    if (rpcErr) {
      await supabase
        .from("salesforce_license_events")
        .update({ status: "failure", error_message: rpcErr.message })
        .eq("event_id", eventId);
      return json({ ok: false, error: `Persist failed: ${rpcErr.message}` }, 500);
    }

    // 3. Mark event processed
    await supabase
      .from("salesforce_license_events")
      .update({ status: "success", processed_at: new Date().toISOString() })
      .eq("event_id", eventId);

    return json({
      ok: true,
      subscription_id: subId,
      license_id: body.license_id,
      status: newStatus,
      seats: body.seats,
    });
  } catch (err) {
    console.error("[marketplace-salesforce-license] uncaught", err);
    return json({ ok: false, error: String((err as Error)?.message ?? err) }, 500);
  }
});

function validate(body: LicenseEventBody): { error?: string } {
  if (!body || typeof body !== "object") return { error: "Missing JSON body" };
  if (body.action !== "license_event") return { error: "action must be 'license_event'" };
  if (!body.license_id) return { error: "license_id is required" };
  if (!body.organization_id) return { error: "organization_id is required" };
  if (!body.package_version_id) return { error: "package_version_id is required" };
  if (typeof body.seats !== "number" || body.seats < 0) return { error: "seats must be a non-negative integer" };
  if (!body.status) return { error: "status is required" };
  if (!STATUS_MAP[body.status]) return { error: `unknown status: ${body.status}` };
  return {};
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
