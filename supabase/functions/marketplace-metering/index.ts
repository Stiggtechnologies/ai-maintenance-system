import { createClient } from "npm:@supabase/supabase-js@2";
import {
  buildMeteringBatchRequest,
  isRetryableMeteringHttpStatus,
  marketplaceMeteringBatchUrl,
  MARKETPLACE_TOKEN_SCOPE,
  normalizeMeteringBatchResponse,
  normalizeMeteringClaim,
  type MeteringClaim,
} from "./core.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const MAX_RESPONSE_BYTES = 128 * 1024;

interface MarketplaceConfig {
  clientId: string;
  clientSecret: string;
  tenantId: string;
}

class MeteringError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function constantTimeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  const length = Math.max(a.length, b.length);
  let difference = a.length ^ b.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0;
}

function authorize(request: Request): void {
  const authorization = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${SERVICE_ROLE_KEY}`;
  if (
    SERVICE_ROLE_KEY.length < 32 ||
    !constantTimeEqual(authorization, expected)
  ) {
    throw new MeteringError("marketplace_metering_unauthorized", 401);
  }
}

function marketplaceConfig(): MarketplaceConfig {
  const config = {
    clientId: Deno.env.get("AZURE_MARKETPLACE_CLIENT_ID")?.trim() ?? "",
    clientSecret: Deno.env.get("AZURE_MARKETPLACE_CLIENT_SECRET")?.trim() ?? "",
    tenantId: Deno.env.get("AZURE_MARKETPLACE_TENANT_ID")?.trim() ?? "",
  };
  if (!Object.values(config).every(Boolean))
    throw new MeteringError("marketplace_not_configured", 503);
  return config;
}

let cachedPublisherToken: { value: string; expiresAt: number } | null = null;

async function publisherToken(config: MarketplaceConfig): Promise<string> {
  if (
    cachedPublisherToken &&
    cachedPublisherToken.expiresAt > Date.now() + 60_000
  ) {
    return cachedPublisherToken.value;
  }
  const response = await fetch(
    `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        scope: MARKETPLACE_TOKEN_SCOPE,
        grant_type: "client_credentials",
      }),
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!response.ok) {
    console.error("Marketplace metering publisher authentication failed", {
      status: response.status,
    });
    throw new MeteringError("publisher_auth_failed", 503);
  }
  const body = record(await response.json());
  const token = typeof body?.access_token === "string" ? body.access_token : "";
  if (token.length < 32)
    throw new MeteringError("publisher_auth_invalid_response", 503);
  const seconds =
    typeof body?.expires_in === "number" && Number.isFinite(body.expires_in)
      ? Math.max(60, Math.min(body.expires_in, 3600))
      : 300;
  cachedPublisherToken = {
    value: token,
    expiresAt: Date.now() + seconds * 1000,
  };
  return token;
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function rpc(name: string, args: Record<string, unknown> = {}) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) {
    console.error("Marketplace metering RPC failed", {
      rpc: name,
      code: error.code,
    });
    throw new MeteringError("marketplace_metering_persistence_failed", 503);
  }
  return data;
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES)
    throw new MeteringError("marketplace_metering_response_too_large", 503);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new MeteringError("marketplace_metering_invalid_json", 503);
  }
}

async function failClaim(
  claim: MeteringClaim,
  code: string,
  retryable: boolean,
  httpStatus: number | null,
  response: unknown = null,
): Promise<void> {
  await rpc("fail_marketplace_metering_batch", {
    p_claim_token: claim.claimToken,
    p_error_code: code.slice(0, 100),
    p_retryable: retryable,
    p_http_status: httpStatus,
    p_response: record(response),
  });
}

async function runMetering(): Promise<Record<string, unknown>> {
  // Validate publisher configuration before creating a durable claim. A missing
  // secret must not strand otherwise deliverable usage until the stale-claim
  // recovery window elapses.
  const config = marketplaceConfig();
  const prepared = await rpc("prepare_marketplace_metering", {});
  const rawClaim = await rpc("claim_marketplace_metering_batch", {
    p_limit: 25,
  });
  const claim = normalizeMeteringClaim(rawClaim);
  if (record(rawClaim)?.empty === true) {
    return { prepared, submitted: 0 };
  }
  if (!claim)
    throw new MeteringError("marketplace_metering_invalid_claim", 503);

  const requestId = crypto.randomUUID();
  const correlationId = crypto.randomUUID();
  let response: Response;
  try {
    response = await fetch(marketplaceMeteringBatchUrl(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await publisherToken(config)}`,
        "Content-Type": "application/json",
        "x-ms-requestid": requestId,
        "x-ms-correlationid": correlationId,
      },
      body: JSON.stringify(buildMeteringBatchRequest(claim)),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    console.error("Marketplace metering transport failed", {
      type: error instanceof Error ? error.name : "unknown",
    });
    await failClaim(claim, "transport_error", true, null);
    throw new MeteringError("marketplace_metering_transport_failed", 503);
  }

  let body: unknown;
  try {
    body = await readBoundedJson(response);
  } catch (error) {
    await failClaim(
      claim,
      error instanceof MeteringError
        ? error.code
        : "invalid_marketplace_response",
      true,
      response.status,
    );
    throw error;
  }
  if (!response.ok) {
    const retryable = isRetryableMeteringHttpStatus(response.status);
    await failClaim(
      claim,
      `marketplace_http_${response.status}`,
      retryable,
      response.status,
      body,
    );
    console.error("Marketplace metering batch rejected", {
      status: response.status,
      retryable,
      requestId,
      correlationId,
    });
    throw new MeteringError(
      retryable
        ? "marketplace_metering_temporarily_unavailable"
        : "marketplace_metering_rejected",
      retryable ? 503 : 502,
    );
  }

  const results = normalizeMeteringBatchResponse(body, claim);
  if (!results) {
    await failClaim(claim, "invalid_marketplace_response", true, 200, body);
    throw new MeteringError("marketplace_metering_invalid_response", 503);
  }
  const completed = await rpc("complete_marketplace_metering_batch", {
    p_claim_token: claim.claimToken,
    p_request_id: requestId,
    p_correlation_id: correlationId,
    p_results: results,
  });
  return { prepared, submitted: claim.events.length, completed };
}

Deno.serve(async (request: Request) => {
  try {
    if (request.method !== "POST")
      return json({ error: "method_not_allowed" }, 405);
    authorize(request);
    const contentLength = request.headers.get("content-length");
    if (contentLength) {
      const length = Number(contentLength);
      if (!Number.isFinite(length) || length > 1024)
        return json({ error: "request_too_large" }, 413);
    }
    return json({ ok: true, ...(await runMetering()) });
  } catch (error) {
    if (error instanceof MeteringError)
      return json({ error: error.code }, error.status);
    console.error("Marketplace metering handler failed", {
      type: error instanceof Error ? error.name : "unknown",
    });
    return json({ error: "marketplace_metering_failed" }, 500);
  }
});
