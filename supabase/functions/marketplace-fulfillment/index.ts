import { createClient } from "npm:@supabase/supabase-js@2";
import {
  MARKETPLACE_TOKEN_SCOPE,
  marketplaceActivateUrl,
  marketplaceResolveUrl,
  marketplaceSubscriptionUrl,
  normalizeMarketplaceSubscription,
  parseMarketplaceRequest,
  publicSubscription,
  shouldActivateMarketplaceSubscription,
  verifiedAzureTenantId,
  type ResolvedMarketplaceSubscription,
} from "./core.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ALLOWED_ORIGIN =
  Deno.env.get("ALLOWED_ORIGIN") ?? "https://app.syncai.ca";
const MAX_BODY_BYTES = 32 * 1024;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
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
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function serverReady(): boolean {
  return Boolean(SUPABASE_URL && ANON_KEY && SERVICE_ROLE_KEY);
}

function marketplaceConfig(): {
  clientId: string;
  clientSecret: string;
  tenantId: string;
  publisherId: string;
  offerId: string;
} | null {
  const values = {
    clientId: Deno.env.get("AZURE_MARKETPLACE_CLIENT_ID") ?? "",
    clientSecret: Deno.env.get("AZURE_MARKETPLACE_CLIENT_SECRET") ?? "",
    tenantId: Deno.env.get("AZURE_MARKETPLACE_TENANT_ID") ?? "",
    publisherId: Deno.env.get("AZURE_MARKETPLACE_PUBLISHER_ID") ?? "",
    offerId: Deno.env.get("AZURE_MARKETPLACE_OFFER_ID") ?? "",
  };
  return Object.values(values).every((value) => value.trim()) ? values : null;
}

class MarketplaceApiError extends Error {
  constructor(
    readonly code: string,
    readonly httpStatus = 502,
  ) {
    super(code);
  }
}

let cachedPublisherToken: { value: string; expiresAt: number } | null = null;

async function publisherToken(
  config: NonNullable<ReturnType<typeof marketplaceConfig>>,
): Promise<string> {
  if (
    cachedPublisherToken &&
    cachedPublisherToken.expiresAt > Date.now() + 60_000
  )
    return cachedPublisherToken.value;
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
    console.error("Marketplace publisher token request failed", {
      status: response.status,
    });
    throw new MarketplaceApiError("publisher_auth_failed");
  }
  const body = (await response.json()) as Record<string, unknown>;
  if (typeof body.access_token !== "string" || body.access_token.length < 32)
    throw new MarketplaceApiError("publisher_auth_invalid_response");
  const expiresIn =
    typeof body.expires_in === "number" && Number.isFinite(body.expires_in)
      ? Math.max(60, Math.min(body.expires_in, 3600))
      : 300;
  cachedPublisherToken = {
    value: body.access_token,
    expiresAt: Date.now() + expiresIn * 1000,
  };
  return body.access_token;
}

async function marketplaceCall(
  config: NonNullable<ReturnType<typeof marketplaceConfig>>,
  request: { method: "GET" | "POST"; url: string; purchaseToken?: string },
): Promise<{ body: unknown; requestId: string; correlationId: string }> {
  const requestId = crypto.randomUUID();
  const correlationId = crypto.randomUUID();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${await publisherToken(config)}`,
    "Content-Type": "application/json",
    "x-ms-requestid": requestId,
    "x-ms-correlationid": correlationId,
  };
  if (request.purchaseToken)
    headers["x-ms-marketplace-token"] = request.purchaseToken;
  const response = await fetch(request.url, {
    method: request.method,
    headers,
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    console.error("Marketplace fulfillment request failed", {
      status: response.status,
      requestId,
      correlationId,
    });
    throw new MarketplaceApiError(`marketplace_http_${response.status}`);
  }
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new MarketplaceApiError("marketplace_invalid_json");
    }
  }
  return { body, requestId, correlationId };
}

function assertConfiguredOffer(
  subscription: ResolvedMarketplaceSubscription | null,
  config: NonNullable<ReturnType<typeof marketplaceConfig>>,
): ResolvedMarketplaceSubscription {
  if (!subscription)
    throw new MarketplaceApiError("marketplace_invalid_subscription");
  if (
    subscription.publisherId !== config.publisherId ||
    subscription.offerId !== config.offerId
  ) {
    throw new MarketplaceApiError("marketplace_offer_mismatch", 403);
  }
  return subscription;
}

function randomSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function verifiedUser(authorization: string): Promise<{
  id: string;
  tenantId: string;
} | null> {
  if (!authorization.startsWith("Bearer ")) return null;
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return null;
  const tenantId = verifiedAzureTenantId(data.user);
  return tenantId ? { id: data.user.id, tenantId } : null;
}

async function rpc(
  service: ReturnType<typeof createClient>,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { data, error } = await service.rpc(name, args);
  if (error) {
    console.error("Marketplace fulfillment persistence failed", {
      operation: name,
      code: error.code,
    });
    throw new MarketplaceApiError("persistence_failed", 500);
  }
  const result = (data ?? {}) as Record<string, unknown>;
  if (typeof result.error === "string")
    throw new MarketplaceApiError(
      result.error
        .replace(/[^a-z0-9]+/gi, "_")
        .toLowerCase()
        .slice(0, 100),
      /requires|does not match|invalid|expired/i.test(result.error) ? 403 : 409,
    );
  return result;
}

async function consumeResolveAllowance(
  service: ReturnType<typeof createClient>,
  request: Request,
): Promise<boolean> {
  const forwardedChain = request.headers.get("x-forwarded-for");
  const clientAddress =
    request.headers.get("cf-connecting-ip")?.trim() ||
    forwardedChain?.split(",").pop()?.trim() ||
    "unknown";
  const now = new Date();
  const windowStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  ).toISOString();
  const { data, error } = await service.rpc(
    "consume_public_reliability_ip_allowance",
    {
      p_fingerprint_hash: await sha256(
        `azure-marketplace-resolve|${clientAddress}`,
      ),
      p_window_start: windowStart,
      p_limit: 50,
    },
  );
  if (error) throw new MarketplaceApiError("rate_limit_unavailable", 503);
  return data === true;
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("origin");
  if (origin && origin !== ALLOWED_ORIGIN)
    return json({ error: "origin_not_allowed" }, 403);
  if (request.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST")
    return json({ error: "method_not_allowed" }, 405);
  if (!serverReady()) return json({ error: "service_unavailable" }, 503);

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES)
    return json({ error: "request_too_large" }, 413);
  let parsed: unknown;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES)
      return json({ error: "request_too_large" }, 413);
    parsed = JSON.parse(raw);
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const body = parseMarketplaceRequest(parsed);
  if (!body) return json({ error: "invalid_request" }, 400);

  const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    if (body.action === "resolve") {
      const config = marketplaceConfig();
      if (!config) return json({ error: "marketplace_not_configured" }, 503);
      if (!(await consumeResolveAllowance(service, request)))
        return json({ error: "resolve_rate_limit_reached" }, 429);
      const resolved = await marketplaceCall(config, {
        method: "POST",
        url: marketplaceResolveUrl(),
        purchaseToken: body.token,
      });
      const subscription = assertConfiguredOffer(
        normalizeMarketplaceSubscription(resolved.body),
        config,
      );
      const activationToken = randomSecret();
      const expiresAt = new Date(
        Date.now() + 23 * 60 * 60 * 1000,
      ).toISOString();
      const recorded = await rpc(
        service,
        "record_marketplace_fulfillment_resolution",
        {
          p_marketplace_subscription_id: subscription.subscriptionId,
          p_publisher_id: subscription.publisherId,
          p_offer_id: subscription.offerId,
          p_plan_id: subscription.planId,
          p_subscription_name: subscription.subscriptionName,
          p_quantity: subscription.quantity,
          p_beneficiary_tenant_id: subscription.beneficiary.tenantId,
          p_beneficiary_object_id: subscription.beneficiary.objectId ?? null,
          p_purchaser_tenant_id: subscription.purchaser.tenantId,
          p_purchaser_object_id: subscription.purchaser.objectId ?? null,
          p_marketplace_status: subscription.status,
          p_token_fingerprint: await sha256(body.token),
          p_activation_secret_hash: await sha256(activationToken),
          p_expires_at: expiresAt,
        },
      );
      return json({
        resolutionId: recorded.resolutionId,
        activationToken,
        state: recorded.internalStatus,
        bound: recorded.bound === true,
        subscription: publicSubscription(subscription),
      });
    }

    const user = await verifiedUser(request.headers.get("authorization") ?? "");
    if (!user) return json({ error: "verified_azure_session_required" }, 401);
    const config = marketplaceConfig();
    if (!config) return json({ error: "marketplace_not_configured" }, 503);
    const proofHash = await sha256(body.activationToken);
    const authorization = await rpc(
      service,
      body.action === "activate"
        ? "claim_marketplace_fulfillment_activation"
        : "authorize_marketplace_fulfillment_status",
      {
        p_resolution_id: body.resolutionId,
        p_activation_secret_hash: proofHash,
        p_actor_id: user.id,
        p_identity_tenant_id: user.tenantId,
      },
    );
    const subscriptionId = String(
      authorization.marketplaceSubscriptionId ?? "",
    );
    if (!UUID.test(subscriptionId))
      throw new MarketplaceApiError("invalid_persisted_subscription", 500);

    // Read before activating so a retry after an ambiguous network failure can
    // observe Microsoft's committed state and avoid a second activation call.
    let current = await marketplaceCall(config, {
      method: "GET",
      url: marketplaceSubscriptionUrl(subscriptionId),
    });
    let subscription = assertConfiguredOffer(
      normalizeMarketplaceSubscription(current.body),
      config,
    );
    if (subscription.subscriptionId !== subscriptionId)
      throw new MarketplaceApiError("marketplace_subscription_mismatch", 409);
    if (
      shouldActivateMarketplaceSubscription(
        body.action,
        authorization.activationRequired === true,
        subscription.status,
      )
    ) {
      await marketplaceCall(config, {
        method: "POST",
        url: marketplaceActivateUrl(subscriptionId),
      });
      current = await marketplaceCall(config, {
        method: "GET",
        url: marketplaceSubscriptionUrl(subscriptionId),
      });
      subscription = assertConfiguredOffer(
        normalizeMarketplaceSubscription(current.body),
        config,
      );
      if (subscription.subscriptionId !== subscriptionId)
        throw new MarketplaceApiError("marketplace_subscription_mismatch", 409);
    }
    const status = await rpc(service, "record_marketplace_fulfillment_status", {
      p_resolution_id: body.resolutionId,
      p_marketplace_status: subscription.status,
      p_actor_id: user.id,
      p_request_id: current.requestId,
      p_correlation_id: current.correlationId,
    });
    return json({
      resolutionId: body.resolutionId,
      state: status.internalStatus,
      subscription: publicSubscription(subscription),
    });
  } catch (error) {
    const apiError =
      error instanceof MarketplaceApiError
        ? error
        : new MarketplaceApiError("marketplace_request_failed");
    if (body.action !== "resolve") {
      try {
        const user = await verifiedUser(
          request.headers.get("authorization") ?? "",
        );
        await service.rpc("record_marketplace_fulfillment_failure", {
          p_resolution_id: body.resolutionId,
          p_actor_id: user?.id ?? null,
          p_error_code: apiError.code,
        });
      } catch {
        console.error("Marketplace failure evidence could not be recorded");
      }
    }
    return json({ error: apiError.code }, apiError.httpStatus);
  }
});
