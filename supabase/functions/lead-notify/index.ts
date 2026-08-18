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
  idempotencyKeyFor,
  DEFAULT_ACK_REPLY_TO,
  DEFAULT_APP_BASE_URL,
  DEFAULT_OWNER_ALERT_EMAIL,
  DEFAULT_OWNER_ALERT_FROM,
  hasAcknowledged,
  hasAlertedOwner,
  isAlreadyNotified,
  isNotificationComplete,
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
// Domain-guarded like the From addresses. A reply-to is where the customer's
// answer actually goes; letting it fall to gmail through an unchecked env var
// reaches the exact outcome the @syncai.ca rule exists to prevent.
const ACK_REPLY_TO = resolveSender(
  Deno.env.get("LEAD_ACK_REPLY_TO"),
  DEFAULT_ACK_REPLY_TO,
);
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

// Three outbound calls at worst (owner alert, acknowledgement, SMS) against
// the 45s pg_net timeout in dispatch_lead_notification. Keeping the total
// under that means pg_net never records a timeout for a run that is still
// legitimately working — and never leaves a delivered email un-recorded.
const SEND_TIMEOUT_MS = 8_000;

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
  leadId: string,
  from: string,
  to: string,
  content: EmailContent,
  replyTo: string | null,
): Promise<boolean> {
  const payload = buildResendPayload({ from, to, content, replyTo });
  if (payload.to.length === 0) {
    logError("email_no_recipient", { channel, leadId });
    return false;
  }

  try {
    const response = await withTimeout(
      buildResendRequest(
        RESEND_API_KEY,
        payload,
        idempotencyKeyFor(leadId, channel),
      ),
    );
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 400);
      logError("email_rejected", {
        channel,
        leadId,
        status: response.status,
        detail,
      });
      return false;
    }
    // leadId, never the address or the subject: the subject carries the
    // company name and the address is the lead's work email. Platform logs are
    // readable by anyone with dashboard access and are not the place for the
    // PII that 20260913090000 locked behind an admin-only policy.
    log("email_sent", { channel, leadId, recipients: payload.to.length });
    return true;
  } catch (error) {
    logError("email_failed", { channel, leadId, error: String(error) });
    return false;
  }
}

/** Inert until all four Twilio settings exist. A skip is never a failure. */
async function sendSms(
  ctx: TemplateContext,
  leadId: string,
): Promise<boolean | null> {
  if (!isTwilioConfigured(TWILIO)) {
    log("sms_skipped", { leadId, missing: missingTwilioSettings(TWILIO) });
    return null;
  }

  try {
    const request = buildTwilioRequest(TWILIO, buildOwnerSms(ctx), btoa);
    const response = await withTimeout(request);
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 400);
      logError("sms_rejected", { leadId, status: response.status, detail });
      return false;
    }
    log("sms_sent", { leadId });
    return true;
  } catch (error) {
    logError("sms_failed", { leadId, error: String(error) });
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
  if (!authorized) {
    // Logged, not silent. Whether pg_net's configured key is the one the
    // platform injects as SUPABASE_SERVICE_ROLE_KEY is exactly the sort of
    // deploy-time mismatch that otherwise looks identical to "no leads
    // arrived" — the failure mode this whole path exists to end. Never the
    // token, and never its length.
    logError("unauthorized", { presented: auth === "" ? "none" : "bearer" });
    return json({ error: "unauthorized" }, 401);
  }

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

  // pg_net can deliver more than once, the retry sweeper re-POSTs anything
  // unfinished, and a person can re-run this by hand. None of them may send a
  // channel that already landed — which is why the check is per channel and
  // not on the aggregate status.
  if (isNotificationComplete(lead) || isAlreadyNotified(lead)) {
    log("already_notified", { leadId });
    return json({ ok: true, skipped: "already_notified" });
  }

  // Single-statement claim in SQL: two concurrent deliveries cannot both win,
  // and a claim left behind by a torn-down isolate goes stale and is reusable.
  const { data: claimed, error: claimError } = await supabase.rpc(
    "claim_lead_notification",
    { p_lead_id: leadId, p_stale_seconds: 300 },
  );
  if (claimError) {
    logError("claim_failed", { leadId, error: claimError.message });
    return json({ ok: false, skipped: "claim_failed" });
  }
  if (claimed !== true) {
    log("already_in_flight", { leadId });
    return json({ ok: true, skipped: "already_in_flight" });
  }

  const dueAt = resolveFirstResponseDue(lead);
  const appBaseUrl = APP_BASE_URL;

  // Cumulative, not per-run: a channel that landed on an earlier attempt is
  // still landed, and re-sending it is the bug this replaced.
  let ownerEmailSent = hasAlertedOwner(lead);
  let acknowledgementSent = hasAcknowledged(lead);

  /**
   * Writes the per-channel stamps and lets SQL derive the aggregate status
   * from them. Returns the status the row now carries, or null if the write
   * did not land.
   */
  async function record(): Promise<string | null> {
    // Retried, because this write is the ONLY record that an email left
    // Resend. Lose it and the sweeper sees an unsent lead and sends again.
    // (Resend's Idempotency-Key covers the remainder of that window; this
    // makes it rare rather than merely survivable.)
    let lastError = "";
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const { data: recorded, error: recordError } = await supabase.rpc(
        "record_lead_notification",
        {
          p_lead_id: leadId,
          p_ack_sent: acknowledgementSent,
          p_owner_alerted: ownerEmailSent,
        },
      );
      if (!recordError) {
        const row = recorded as { notification_status?: unknown } | null;
        return typeof row?.notification_status === "string"
          ? row.notification_status
          : null;
      }
      lastError = recordError.message;
      if (attempt < 2) await new Promise((done) => setTimeout(done, 250));
    }
    logError("status_write_failed", { leadId, error: lastError });
    return null;
  }

  // THE OWNER ALERT GOES FIRST, deliberately. The acknowledgement tells the
  // customer they have been heard and names a deadline; it must not be able to
  // make that promise before anybody on this side knows the lead exists.
  if (RESEND_API_KEY && !ownerEmailSent) {
    ownerEmailSent = await sendEmail(
      "owner_alert",
      leadId,
      OWNER_ALERT_FROM,
      OWNER_ALERT_EMAIL,
      buildOwnerAlert({ lead, dueAt, appBaseUrl }),
      ACK_REPLY_TO,
    );
  }

  if (RESEND_API_KEY && !acknowledgementSent) {
    acknowledgementSent = await sendEmail(
      "lead_acknowledgement",
      leadId,
      ACK_FROM,
      lead.email,
      buildLeadAcknowledgement({ lead, dueAt, appBaseUrl, ownerAlerted: ownerEmailSent }),
      ACK_REPLY_TO,
    );
  }

  if (!RESEND_API_KEY) {
    // No transport, no email. The lead is still marked so the leads page shows
    // red and a person picks it up — silence is the failure mode being fixed —
    // and the SMS below is still attempted, because it is an independent
    // channel and a broken Resend is exactly when it matters most.
    logError("email_not_configured", { leadId });
  }

  const smsSent = await sendSms({ lead, dueAt, appBaseUrl }, leadId);

  const outcome: ChannelOutcome = {
    acknowledgementSent,
    ownerEmailSent,
    smsSent,
  };
  const expected = resolveNotificationStatus(outcome);
  const persisted = await record();
  const status = persisted ?? expected;

  log("completed", {
    leadId,
    status,
    statusPersisted: persisted !== null,
    acknowledgementSent,
    ownerEmailSent,
    smsSent,
    firstResponseDue: dueAt ? dueAt.toISOString() : null,
  });

  return json({
    ok: status === NOTIFICATION_STATUS.notified,
    notification_status: status,
    status_persisted: persisted !== null,
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
