/**
 * marketplace-aws-resolve Edge Function
 *
 * Mirrors the role of `marketplace-resolve` for Microsoft Azure, but for the
 * AWS Marketplace SaaS Listing API. Exchanges the AWS Marketplace
 * registration token (received as `?x-amzn-marketplace-token=` on the
 * activation redirect) for a CustomerIdentifier via the ResolveCustomer
 * API, then persists the subscription to billing_subscriptions.
 *
 * Required env (`supabase secrets set`):
 *   AWS_REGION                  e.g. us-east-1
 *   AWS_ACCESS_KEY_ID
 *   AWS_SECRET_ACCESS_KEY
 *
 * AWS API: POST https://metering.marketplace.<region>.amazonaws.com/customer
 *   X-Amz-Target: AWSMPMeteringService.ResolveCustomer
 *   Body: { "RegistrationToken": "<token>" }
 *
 * Schema dependency: 20260513000000_aws_salesforce_marketplace_integration.sql
 */
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") || "https://app.syncai.ca",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

interface ResolveBody {
  marketplace_token: string;
}

interface ResolveCustomerResponse {
  CustomerIdentifier: string;
  CustomerAWSAccountId?: string;
  ProductCode: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  try {
    const body = (await req.json().catch(() => ({}))) as ResolveBody;
    if (!body?.marketplace_token) return json({ ok: false, error: "marketplace_token is required" }, 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return json({ ok: false, error: "Server misconfigured" }, 500);

    const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const region = Deno.env.get("AWS_REGION") ?? "us-east-1";
    const accessKey = Deno.env.get("AWS_ACCESS_KEY_ID");
    const secretKey = Deno.env.get("AWS_SECRET_ACCESS_KEY");
    if (!accessKey || !secretKey) {
      return json({ ok: false, error: "AWS credentials not configured" }, 500);
    }

    // 1. Sign + call ResolveCustomer
    const url = `https://metering.marketplace.${region}.amazonaws.com/customer`;
    const payload = JSON.stringify({ RegistrationToken: body.marketplace_token });

    const headers = await sigV4SignRequest({
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

    const t0 = Date.now();
    const res = await fetch(url, { method: "POST", headers, body: payload });
    const latency = Date.now() - t0;

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      // Audit-log the failure
      await supabase.from("aws_marketplace_events").insert({
        aws_customer_identifier: "unknown",
        message_id: `resolve_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
        action: "resolve",
        status: "failure",
        request_payload: { token_prefix: body.marketplace_token.slice(0, 16) },
        response_payload: { http_status: res.status, latency_ms: latency },
        error_message: errBody.slice(0, 500),
      });
      return json({ ok: false, error: `ResolveCustomer ${res.status}: ${errBody.slice(0, 300)}` }, 502);
    }

    const resolved = (await res.json()) as ResolveCustomerResponse;

    // 2. Persist via RPC
    const { data: subId, error: rpcErr } = await supabase.rpc("upsert_aws_marketplace_subscription", {
      p_customer_identifier: resolved.CustomerIdentifier,
      p_aws_account_id: resolved.CustomerAWSAccountId ?? null,
      p_product_code: resolved.ProductCode,
      p_offer_identifier: null,
      p_status: "aws_pending_subscription",
      p_resolve_payload: resolved as unknown as Record<string, unknown>,
    });
    if (rpcErr) return json({ ok: false, error: `Persist failed: ${rpcErr.message}` }, 500);

    // 3. Audit-log the success
    await supabase.from("aws_marketplace_events").insert({
      aws_customer_identifier: resolved.CustomerIdentifier,
      message_id: `resolve_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
      action: "resolve",
      status: "success",
      request_payload: { token_prefix: body.marketplace_token.slice(0, 16) },
      response_payload: { ...resolved, latency_ms: latency },
      processed_at: new Date().toISOString(),
    });

    return json({
      ok: true,
      subscription_id: subId,
      customer_identifier: resolved.CustomerIdentifier,
      aws_account_id: resolved.CustomerAWSAccountId,
      product_code: resolved.ProductCode,
      status: "aws_pending_subscription",
    });
  } catch (err) {
    console.error("[marketplace-aws-resolve] uncaught", err);
    return json({ ok: false, error: String((err as Error)?.message ?? err) }, 500);
  }
});

// ---------------------------------------------------------------------------
// Inline AWS SigV4 signer — avoids pulling in the AWS SDK (large cold start).
// Same signer pattern is reusable for any AWS Marketplace API call.
// ---------------------------------------------------------------------------

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
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);

  const canonicalUri = u.pathname || "/";
  const canonicalQueryString = u.searchParams.toString();
  const payloadHash = await sha256Hex(req.body);

  const allHeaders: Record<string, string> = {
    ...req.headers,
    Host: u.host,
    "X-Amz-Date": amzDate,
  };

  const sortedHeaderKeys = Object.keys(allHeaders).map((k) => k.toLowerCase()).sort();
  const canonicalHeaders = sortedHeaderKeys
    .map((k) => `${k}:${(allHeaders[Object.keys(allHeaders).find((orig) => orig.toLowerCase() === k)!]).trim()}\n`)
    .join("");
  const signedHeaders = sortedHeaderKeys.join(";");

  const canonicalRequest = [
    req.method,
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
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

  return {
    ...allHeaders,
    Authorization: `AWS4-HMAC-SHA256 Credential=${req.accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
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
  return Array.from(buf).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
