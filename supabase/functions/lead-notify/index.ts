// lead-notify — the always-on half of "a lead must never go cold".
//
// Invoked by pg_net from trg_pilot_intake_notify (migration 20260914090000)
// the instant a row lands in pilot_intake_requests, with {"lead_id": "<uuid>"}.
// It acknowledges the lead, alerts the owner by email and (once Twilio exists)
// by SMS, and stamps the row so the admin page stops showing amber.
//
// This file is a thin shell on purpose. Every template, every predicate and
// every piece of time arithmetic lives in ../_shared/lead-notify.ts, which is
// Deno-free and unit-tested by vitest — Deno is installed neither locally nor
// in CI, so logic that lives here ships unverified.
//
// PLATFORM JWT VERIFICATION STAYS ON. pg_net sends the configured service key
// as a bearer token, which the platform accepts, so there is no reason to
// widen the boundary with --no-verify-jwt.

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  buildLeadAcknowledgement,
  buildOwnerAlert,
  buildOwnerSms,
  buildResendPayload,
  buildResendRequest,
  buildTwilioRequest,
  DEFAULT_ACK_FROM,
  DEFAULT_ACK_REPLY_TO,
  DEFAULT_APP_BASE_URL,
  DEFAULT_OWNER_ALERT_EMAIL,
  DEFAULT_OWNER_ALERT_FROM,
  isAlreadyNotified,
  isTwilioConfigured,
  missingTwilioSettings,
  NOTIFICATION_STATUS,
  resolveFirstResponseDue,
  resolveNotificationStatus,
  resolveSender,
  type ChannelOutcome,
  type EmailContent,
  type PilotIntakeLead,
  type TemplateContext,
  type TwilioConfig,
} from "../_shared/lead-notify.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
// Set this when the key pg_net calls with is not the same string the platform
// injects as SUPABASE_SERVICE_ROLE_KEY (this project's edge functions accept
// the sb_secret_ key, not the legacy service_role JWT).
const LEAD_NOTIFY_SHARED_SECRET =
  Deno.env.get("LEAD_NOTIFY_SHARED_SECRET") ?? "";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const ACK_FROM = resolveSender(Deno.env.get("LEAD_ACK_FROM"), DEFAULT_ACK_FROM);
const ACK_REPLY_TO = Deno.env.get("LEAD_ACK_REPLY_TO") ?? DEFAULT_ACK_REPLY_TO;
const OWNER_ALERT_FROM = resolveSender(
  Deno.env.get("OWNER_ALERT_FROM"),
  DEFAULT_OWNER_ALERT_FROM,
);
const OWNER_ALERT_EMAIL =
  Deno.env.get("OWNER_ALERT_EMAIL") ?? DEFAULT_OWNER_ALERT_EMAIL;
const APP_BASE_URL = Deno.env.get("APP_BASE_URL") ?? DEFAULT_APP_BASE_URL;

const TWILIO: Partial<TwilioConfig> = {
  accountSid: Deno.env.get("TWILIO_ACCOUNT_SID") ?? "",
  authToken: Deno.env.get("TWILIO_AUTH_TOKEN") ?? "",
  fromNumber: Deno.env.get("TWILIO_FROM_NUMBER") ?? "",
  toNumber: Deno.env.get("OWNER_SMS_TO") ?? "",
};

const SEND_TIMEOUT_MS = 15_000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://app.syncai.ca",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  Vary: "Origin",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/** One line of structured JSON per event — never a secret, never a full body. */
function log(event: string, detail: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ fn: "lead-notify", event, ...detail }));
}

function logError(event: string, detail: Record<string, unknown> = {}): void {
  console.error(JSON.stringify({ fn: "lead-notify", event, ...detail }));
}

function safeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i += 1) mismatch |= left[i] ^ right[i];
  return mismatch === 0;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function withTimeout(request: {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: string;
}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    return await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Sends one Resend message. Returns whether it landed; a throw here would
 * abandon the other channel, so nothing escapes.
 */
async function sendEmail(
  channel: string,
  from: string,
  to: string,
  content: EmailContent,
  replyTo: string | null,
): Promise<boolean> {
  const payload = buildResendPayload({ from, to, content, replyTo });
  if (payload.to.length === 0) {
    logError("email_no_recipient", { channel });
    return false;
  }

  try {
    const response = await withTimeout(
      buildResendRequest(RESEND_API_KEY, payload),
    );
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 400);
      logError("email_rejected", { channel, status: response.status, detail });
      return false;
    }
    log("email_sent", { channel, to: payload.to, subject: content.subject });
    return true;
  } catch (error) {
    logError("email_failed", { channel, error: String(error) });
    return false;
  }
}

/** Inert until all four Twilio settings exist. A skip is never a failure. */
async function sendSms(ctx: TemplateContext): Promise<boolean | null> {
  if (!isTwilioConfigured(TWILIO)) {
    log("sms_skipped", { missing: missingTwilioSettings(TWILIO) });
    return null;
  }

  try {
    const request = buildTwilioRequest(TWILIO, buildOwnerSms(ctx), btoa);
    const response = await withTimeout(request);
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 400);
      logError("sms_rejected", { status: response.status, detail });
      return false;
    }
    log("sms_sent", {});
    return true;
  } catch (error) {
    logError("sms_failed", { error: String(error) });
    return false;
  }
}

/**
 * Everything after the protocol and auth checks. Split out so the single
 * catch in Deno.serve below can promise that nothing throws out of this
 * function — an unhandled rejection becomes a platform 500, and a 500 is an
 * invitation to redeliver, which would mail the visitor twice.
 */
async function processLead(req: Request): Promise<Response> {
  const auth = req.headers.get("Authorization") ?? "";
  const serviceToken = `Bearer ${SERVICE_ROLE_KEY}`;
  const sharedToken = LEAD_NOTIFY_SHARED_SECRET
    ? `Bearer ${LEAD_NOTIFY_SHARED_SECRET}`
    : "";
  const authorized =
    safeEqual(auth, serviceToken) ||
    (sharedToken !== "" && safeEqual(auth, sharedToken));
  if (!authorized) return json({ error: "unauthorized" }, 401);

  // Everything past this point answers 2xx. pg_net has already committed the
  // lead; a non-2xx here buys nothing and invites a redelivery that would send
  // the visitor a second acknowledgement.
  let leadId = "";
  try {
    const body = (await req.json()) as { lead_id?: unknown };
    leadId = typeof body?.lead_id === "string" ? body.lead_id.trim() : "";
  } catch {
    leadId = "";
  }
  if (!UUID.test(leadId)) {
    logError("invalid_request", { reason: "lead_id missing or not a uuid" });
    return json({ ok: false, skipped: "invalid_request" });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase
    .from("pilot_intake_requests")
    .select("*")
    .eq("id", leadId)
    .maybeSingle();

  if (error) {
    logError("lead_lookup_failed", { leadId, error: error.message });
    return json({ ok: false, skipped: "lead_lookup_failed" });
  }
  if (!data) {
    logError("lead_not_found", { leadId });
    return json({ ok: false, skipped: "lead_not_found" });
  }

  const lead = data as PilotIntakeLead;

  // pg_net can deliver more than once and a person can re-run this by hand.
  // Neither may send a second acknowledgement.
  if (isAlreadyNotified(lead)) {
    log("already_notified", { leadId });
    return json({ ok: true, skipped: "already_notified" });
  }

  const dueAt = resolveFirstResponseDue(lead);
  const ctx: TemplateContext = { lead, dueAt, appBaseUrl: APP_BASE_URL };

  // Returns whether the stamp landed. A notification that sent but did not
  // persist would look unsent to a redelivery, so the caller reports it.
  async function stamp(status: string): Promise<boolean> {
    const patch: Record<string, unknown> = { notification_status: status };
    if (status === NOTIFICATION_STATUS.notified) {
      patch.notified_at = new Date().toISOString();
    }
    const { error: updateError } = await supabase
      .from("pilot_intake_requests")
      .update(patch)
      .eq("id", leadId);
    if (updateError) {
      logError("status_write_failed", {
        leadId,
        status,
        error: updateError.message,
      });
      return false;
    }
    return true;
  }

  // No transport, no notification. Mark it failed so the leads page shows red
  // and a person picks the lead up — silence is the failure mode being fixed.
  if (!RESEND_API_KEY) {
    logError("email_not_configured", { leadId });
    await stamp(NOTIFICATION_STATUS.failed);
    return json({
      ok: false,
      skipped: "email_not_configured",
      notification_status: NOTIFICATION_STATUS.failed,
    });
  }

  const acknowledgementSent = await sendEmail(
    "lead_acknowledgement",
    ACK_FROM,
    lead.email,
    buildLeadAcknowledgement(ctx),
    ACK_REPLY_TO,
  );

  const ownerEmailSent = await sendEmail(
    "owner_alert",
    OWNER_ALERT_FROM,
    OWNER_ALERT_EMAIL,
    buildOwnerAlert(ctx),
    ACK_REPLY_TO,
  );

  const smsSent = await sendSms(ctx);

  const outcome: ChannelOutcome = {
    acknowledgementSent,
    ownerEmailSent,
    smsSent,
  };
  const status = resolveNotificationStatus(outcome);
  const statusPersisted = await stamp(status);

  log("completed", {
    leadId,
    status,
    statusPersisted,
    acknowledgementSent,
    ownerEmailSent,
    smsSent,
    firstResponseDue: dueAt ? dueAt.toISOString() : null,
  });

  return json({
    ok: status === NOTIFICATION_STATUS.notified,
    notification_status: status,
    status_persisted: statusPersisted,
    acknowledgement_sent: acknowledgementSent,
    owner_email_sent: ownerEmailSent,
    sms_sent: smsSent,
    first_response_due: dueAt ? dueAt.toISOString() : null,
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    logError("unconfigured", { reason: "missing_platform_configuration" });
    return json({ error: "service_unavailable" }, 503);
  }

  try {
    return await processLead(req);
  } catch (error) {
    // Nothing is allowed to reach the platform as a 500.
    logError("unhandled_error", { error: String(error) });
    return json({ ok: false, skipped: "unhandled_error" });
  }
});
