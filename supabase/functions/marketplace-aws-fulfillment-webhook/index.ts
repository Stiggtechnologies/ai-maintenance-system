/**
 * marketplace-aws-fulfillment-webhook Edge Function
 * =================================================
 * AWS Marketplace SaaS Listing fulfillment endpoint.
 *
 * Two halves:
 *
 *  1. POST  /resolve  — exchange the AWS Marketplace registration token
 *     (received as ?x-amzn-marketplace-token=<…> on the activation
 *     redirect URL) for a customer identifier via the
 *     ResolveCustomer API. Persists to marketplace_subscriptions.
 *
 *  2. POST  /event    — receive lifecycle notifications relayed from
 *     AWS SNS → SQS → your relay (typically a Lambda function that
 *     forwards SQS messages to this endpoint). Applies the action
 *     idempotently keyed by the SQS message id.
 *
 * AWS API references:
 *   - ResolveCustomer:     POST https://metering.marketplace.<region>.amazonaws.com/customer
 *   - GetEntitlements:     POST https://entitlement.marketplace.<region>.amazonaws.com/
 *
 * Required env (set via `supabase secrets set ...`):
 *   AWS_REGION
 *   AWS_ACCESS_KEY_ID
 *   AWS_SECRET_ACCESS_KEY
 *   AWS_PRODUCT_CODE              - your Marketplace product code
 *   AWS_OFFER_CODE   (default: syncai_industrial_aws)
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

interface ResolveBody {
  action: "resolve";
  marketplace_token: string;
}

interface EventBody {
  action: "event";
  message_id: string;            // SQS message id (for idempotency)
  event: AwsLifecycleEvent;
}

interface AwsLifecycleEvent {
  action: "subscribe-success" | "unsubscribe-pending" | "unsubscribe-success" | "subscribe-fail";
  "customer-identifier": string;
  "product-code": string;
  "offer-identifier"?: string;
  timestamp?: string;
  isFreeTrialTermPresent?: boolean;
}

interface ResolveCustomerResponse {
  CustomerIdentifier: string;
  CustomerAWSAccountId?: string;
  ProductCode: string;
}

const STATUS_MAP: Record<AwsLifecycleEvent["action"], string> = {
  "subscribe-success": "aws_subscribed",
  "unsubscribe-pending": "aws_unsubscribe_pending",
  "unsubscribe-success": "aws_unsubscribed",
  "subscribe-fail": "aws_expired",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  try {
    const body = (await req.json().catch(() => ({}))) as ResolveBody | EventBody;
    if (!("action" in body)) return json({ ok: false, error: "action is required (resolve|event)" }, 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return json({ ok: false, error: "Server misconfigured" }, 500);

    const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    if (body.action === "resolve") return await handleResolve(supabase, body.marketplace_token);
    if (body.action === "event") return await handleEvent(supabase, body.message_id, body.event);
    return json({ ok: false, error: "Unknown action" }, 400);
  } catch (err) {
    console.error("[marketplace-aws-fulfillment-webhook] uncaught", err);
    return json({ ok: false, error: String((err as Error)?.message ?? err) }, 500);
  }
});

async function handleResolve(
  supabase: ReturnType<typeof createClient>,
  token: string,
): Promise<Response> {
  if (!token) return json({ ok: false, error: "marketplace_token is required" }, 400);

  const region = Deno.env.get("AWS_REGION") ?? "us-east-1";
  const accessKey = Deno.env.get("AWS_ACCESS_KEY_ID");
  const secretKey = Deno.env.get("AWS_SECRET_ACCESS_KEY");
  if (!accessKey || !secretKey) {
    return json({ ok: false, error: "AWS credentials not configured (AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY)" }, 500);
  }

  const offerCode = Deno.env.get("AWS_OFFER_CODE") ?? "syncai_industrial_aws";

  // ResolveCustomer is a SigV4-signed POST. Rather than pull in the AWS SDK
  // (large Deno cold-start), call the metering service via direct fetch with
  // SigV4 signing. We use a minimal SigV4 signer below.
  const url = `https://metering.marketplace.${region}.amazonaws.com/customer`;
  const payload = JSON.stringify({ RegistrationToken: token });
  const signed = await sigV4SignRequest({
    method: "POST",
    url,
    region,
    service: "aws-marketplace",
    body: payload,
    accessKey,
    secretKey,
    headers: {
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Target": "AWSMPMeteringService.ResolveCustomer",
    },
  });

  const res = await fetch(url, { method: "POST", headers: signed, body: payload });
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    return json({ ok: false, error: `ResolveCustomer ${res.status}: ${errBody.slice(0, 300)}` }, 502);
  }
  const resolved = (await res.json()) as ResolveCustomerResponse;

  const { data: subId, error } = await supabase.rpc("marketplace_aws_upsert_from_resolve", {
    p_customer_identifier: resolved.CustomerIdentifier,
    p_customer_aws_account_id: resolved.CustomerAWSAccountId ?? null,
    p_product_code: resolved.ProductCode,
    p_offer_code: offerCode,
    p_plan_code: "pro",  // AWS doesn't return plan in resolve; default; refined when first event arrives
    p_status: "aws_pending_subscription",
    p_raw_payload: resolved as unknown as Record<string, unknown>,
  });
  if (error) return json({ ok: false, error: `Persist failed: ${error.message}` }, 500);

  return json({
    ok: true,
    subscription_id: subId,
    customer_identifier: resolved.CustomerIdentifier,
    aws_account_id: resolved.CustomerAWSAccountId,
    product_code: resolved.ProductCode,
    status: "aws_pending_subscription",
  });
}

async function handleEvent(
  supabase: ReturnType<typeof createClient>,
  messageId: string,
  event: AwsLifecycleEvent,
): Promise<Response> {
  if (!messageId) return json({ ok: false, error: "message_id required for idempotency" }, 400);
  if (!event?.action || !event?.["customer-identifier"]) {
    return json({ ok: false, error: "event.action and event['customer-identifier'] required" }, 400);
  }

  // Use the existing marketplace_apply_webhook_event with a synthetic payload
  // (mapped into the shape the RPC expects, plus AWS context).
  const newStatus = STATUS_MAP[event.action];
  if (!newStatus) return json({ ok: false, error: `Unknown action: ${event.action}` }, 400);

  // Idempotent log
  const { error: logErr } = await supabase.from("marketplace_webhook_events").upsert({
    marketplace: "aws",
    event_id: messageId,
    subscription_id: event["customer-identifier"],
    action: event.action,
    status: "received",
    payload: event as unknown as Record<string, unknown>,
  }, { onConflict: "marketplace,event_id" });
  if (logErr) return json({ ok: false, error: `Event log failed: ${logErr.message}` }, 500);

  // Apply to subscription row
  const { error: updErr } = await supabase
    .from("marketplace_subscriptions")
    .update({
      status: newStatus,
      last_event_id: messageId,
      last_event_action: event.action,
      canceled_at: event.action === "unsubscribe-success" ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("marketplace_subscription_id", event["customer-identifier"]);
  if (updErr) return json({ ok: false, error: `Status update failed: ${updErr.message}` }, 500);

  // Mark event processed
  await supabase
    .from("marketplace_webhook_events")
    .update({ status: "processed", processed_at: new Date().toISOString() })
    .eq("event_id", messageId);

  return json({ ok: true, message_id: messageId, action: event.action, new_status: newStatus });
}

/**
 * Minimal AWS SigV4 signer.
 *
 * Implements just enough of the AWS Signature Version 4 signing process
 * to call ResolveCustomer. Not a full SDK — but no extra cold-start cost.
 * Produces a `Authorization` header + `X-Amz-Date` + `Host` + the
 * request-specific headers (Content-Type, X-Amz-Target).
 */
async function sigV4SignRequest(req: {
  method: string;
  url: string;
  region: string;
  service: string;
  body: string;
  accessKey: string;
  secretKey: string;
  headers: Record<string, string>;
}): Promise<Record<string, string>> {
  const u = new URL(req.url);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");  // 20260508T000000Z
  const dateStamp = amzDate.slice(0, 8);

  const canonicalUri = u.pathname || "/";
  const canonicalQueryString = u.searchParams.toString();
  const payloadHash = await sha256Hex(req.body);

  const allHeaders: Record<string, string> = {
    ...req.headers,
    Host: u.host,
    "X-Amz-Date": amzDate,
  };

  const sortedHeaderKeys = Object.keys(allHeaders).map(k => k.toLowerCase()).sort();
  const canonicalHeaders = sortedHeaderKeys
    .map(k => `${k}:${(allHeaders[Object.keys(allHeaders).find(orig => orig.toLowerCase() === k)!]).trim()}\n`)
    .join("");
  const signedHeaders = sortedHeaderKeys.join(";");

  const canonicalRequest = [
    req.method, canonicalUri, canonicalQueryString,
    canonicalHeaders, signedHeaders, payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${req.region}/${req.service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  const kDate = await hmacSha256(`AWS4${req.secretKey}`, dateStamp);
  const kRegion = await hmacSha256(kDate, req.region);
  const kService = await hmacSha256(kRegion, req.service);
  const kSigning = await hmacSha256(kService, "aws4_request");
  const signature = bufToHex(await hmacSha256(kSigning, stringToSign));

  const authHeader = `AWS4-HMAC-SHA256 Credential=${req.accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return { ...allHeaders, Authorization: authHeader };
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return bufToHex(new Uint8Array(buf));
}

async function hmacSha256(key: string | Uint8Array, msg: string): Promise<Uint8Array> {
  const keyBuf = typeof key === "string" ? new TextEncoder().encode(key) : key;
  const cryptoKey = await crypto.subtle.importKey(
    "raw", keyBuf, { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(msg));
  return new Uint8Array(sig);
}

function bufToHex(buf: Uint8Array): string {
  return Array.from(buf).map(b => b.toString(16).padStart(2, "0")).join("");
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
