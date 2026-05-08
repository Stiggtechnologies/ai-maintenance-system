/**
 * marketplace-salesforce-license Edge Function
 * ============================================
 * Salesforce AppExchange / License Management App (LMA) license event
 * receiver.
 *
 * Salesforce's LMA doesn't have a hard webhook standard the way Microsoft
 * and AWS do — most ISVs implement a Salesforce Flow or Apex trigger on
 * the License object that POSTs to an external endpoint when license
 * records change. This function is the receiving end of that flow.
 *
 * Expected request body (sent by the customer's Salesforce flow):
 *   {
 *     "action": "license_event",
 *     "license_id": "a0X...",                 // sfdc:License ID (18-char)
 *     "organization_id": "00D...",            // customer's SF org id
 *     "package_version_id": "04t...",         // managed package version
 *     "offer_code": "syncai_industrial_sf",   // our offer
 *     "plan_code": "pro" | "starter" | "enterprise",
 *     "seats": 25,
 *     "status": "Active" | "Trial" | "Suspended" | "Uninstalled" | "Expired",
 *     "expires_at": "2026-12-31T00:00:00Z" | null
 *   }
 *
 * Authenticates via a shared secret in the Authorization header so only
 * the customer's Salesforce flow (or our own integration code) can post.
 *
 * Schema dependency: 016_marketplace_aws_salesforce.sql
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface LicenseEventBody {
  action: "license_event";
  license_id: string;
  organization_id: string;
  package_version_id: string;
  offer_code: string;
  plan_code: string;
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  try {
    // Authenticate via shared secret
    const expectedSecret = Deno.env.get("SF_LMA_SHARED_SECRET");
    if (!expectedSecret) return json({ ok: false, error: "Server misconfigured (SF_LMA_SHARED_SECRET not set)" }, 500);
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
    if (!newStatus) return json({ ok: false, error: `Unknown status: ${body.status}` }, 400);

    // Audit-log the event (idempotent on license_id+timestamp)
    const eventId = `${body.license_id}_${Date.now()}`;
    await supabase.from("marketplace_webhook_events").insert({
      marketplace: "salesforce",
      event_id: eventId,
      subscription_id: body.license_id,
      action: `license_${body.status.toLowerCase()}`,
      status: "received",
      payload: body as unknown as Record<string, unknown>,
    });

    // Upsert subscription
    const { data: subId, error } = await supabase.rpc("marketplace_sf_upsert_from_license", {
      p_sf_organization_id: body.organization_id,
      p_sf_package_version_id: body.package_version_id,
      p_sf_license_id: body.license_id,
      p_offer_code: body.offer_code,
      p_plan_code: body.plan_code,
      p_seats: body.seats,
      p_status: newStatus,
      p_expires_at: body.expires_at,
      p_raw_payload: body as unknown as Record<string, unknown>,
    });
    if (error) return json({ ok: false, error: `Persist failed: ${error.message}` }, 500);

    // Mark event processed
    await supabase
      .from("marketplace_webhook_events")
      .update({ status: "processed", processed_at: new Date().toISOString() })
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
  if (!body.offer_code) return { error: "offer_code is required" };
  if (!body.plan_code) return { error: "plan_code is required" };
  if (typeof body.seats !== "number" || body.seats < 0) return { error: "seats must be a non-negative integer" };
  if (!body.status) return { error: "status is required" };
  return {};
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
