import { createClient } from "npm:@supabase/supabase-js@2";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@5.9.6";
import {
  MARKETPLACE_TOKEN_SCOPE,
  normalizeMarketplaceSubscription,
  type ResolvedMarketplaceSubscription,
} from "../marketplace-fulfillment/core.ts";
import {
  marketplaceOperationUrl,
  marketplaceSubscriptionUrl,
  normalizeMarketplaceOperation,
  parseMarketplaceWebhook,
  requiresOperationAcknowledgement,
  validateMarketplaceWebhookClaims,
  webhookMatchesOperation,
  type MarketplaceOperation,
  type MarketplaceWebhookEnvelope,
} from "./core.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const MAX_BODY_BYTES = 64 * 1024;

interface MarketplaceConfig {
  clientId: string;
  clientSecret: string;
  tenantId: string;
  publisherId: string;
  offerId: string;
}

interface MarketplaceEvidence<T> {
  body: T;
  requestId: string;
  correlationId: string;
}

interface SubscriptionTerm {
  start: string | null;
  end: string | null;
}

class WebhookError extends Error {
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

function marketplaceConfig(): MarketplaceConfig | null {
  const config = {
    clientId: Deno.env.get("AZURE_MARKETPLACE_CLIENT_ID")?.trim() ?? "",
    clientSecret: Deno.env.get("AZURE_MARKETPLACE_CLIENT_SECRET")?.trim() ?? "",
    tenantId: Deno.env.get("AZURE_MARKETPLACE_TENANT_ID")?.trim() ?? "",
    publisherId: Deno.env.get("AZURE_MARKETPLACE_PUBLISHER_ID")?.trim() ?? "",
    offerId: Deno.env.get("AZURE_MARKETPLACE_OFFER_ID")?.trim() ?? "",
  };
  return Object.values(config).every(Boolean) ? config : null;
}

function requireConfig(): MarketplaceConfig {
  const config = marketplaceConfig();
  if (!config) throw new WebhookError("marketplace_not_configured", 503);
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
    console.error("Marketplace webhook publisher authentication failed", {
      status: response.status,
    });
    throw new WebhookError("publisher_auth_failed", 503);
  }
  const body = record(await response.json());
  const token = typeof body?.access_token === "string" ? body.access_token : "";
  if (token.length < 32)
    throw new WebhookError("publisher_auth_invalid_response", 503);
  const rawExpiry = body?.expires_in;
  const expiry =
    typeof rawExpiry === "number" && Number.isFinite(rawExpiry)
      ? Math.max(60, Math.min(rawExpiry, 3600))
      : 300;
  cachedPublisherToken = {
    value: token,
    expiresAt: Date.now() + expiry * 1000,
  };
  return token;
}

async function marketplaceCall(
  config: MarketplaceConfig,
  request: {
    method: "GET" | "PATCH";
    url: string;
    body?: Record<string, unknown>;
  },
): Promise<MarketplaceEvidence<unknown>> {
  const requestId = crypto.randomUUID();
  const correlationId = crypto.randomUUID();
  const response = await fetch(request.url, {
    method: request.method,
    headers: {
      Authorization: `Bearer ${await publisherToken(config)}`,
      "Content-Type": "application/json",
      "x-ms-requestid": requestId,
      "x-ms-correlationid": correlationId,
    },
    body: request.body ? JSON.stringify(request.body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    console.error("Marketplace lifecycle API request failed", {
      method: request.method,
      status: response.status,
      requestId,
      correlationId,
    });
    throw new WebhookError(`marketplace_http_${response.status}`, 503);
  }
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new WebhookError("marketplace_invalid_json", 503);
    }
  }
  return { body, requestId, correlationId };
}

const jwksByTenant = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

async function verifyWebhookToken(
  request: Request,
  config: MarketplaceConfig,
): Promise<void> {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) {
    throw new WebhookError("marketplace_webhook_token_required", 401);
  }
  const token = authorization.slice(7).trim();
  if (!token) throw new WebhookError("marketplace_webhook_token_required", 401);
  let jwks = jwksByTenant.get(config.tenantId);
  if (!jwks) {
    jwks = createRemoteJWKSet(
      new URL(
        `https://login.microsoftonline.com/${config.tenantId}/discovery/v2.0/keys`,
      ),
    );
    jwksByTenant.set(config.tenantId, jwks);
  }
  try {
    const verified = await jwtVerify(token, jwks, {
      audience: config.clientId,
      algorithms: ["RS256"],
    });
    if (
      !validateMarketplaceWebhookClaims(verified.payload, {
        clientId: config.clientId,
        tenantId: config.tenantId,
      })
    ) {
      throw new WebhookError("marketplace_webhook_claims_invalid", 403);
    }
  } catch (error) {
    if (error instanceof WebhookError) throw error;
    console.error("Marketplace webhook signature verification failed", {
      error: error instanceof Error ? error.name : "unknown",
    });
    throw new WebhookError("marketplace_webhook_token_invalid", 401);
  }
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

async function lifecycleFingerprint(
  webhook: MarketplaceWebhookEnvelope,
): Promise<string> {
  // Microsoft may serialize an otherwise identical retry differently or add
  // future fields. Fingerprint only the normalized business identity that Get
  // Operation independently verifies, in a fixed key order.
  return await sha256(
    JSON.stringify({
      operationId: webhook.operationId,
      subscriptionId: webhook.subscriptionId,
      publisherId: webhook.publisherId,
      offerId: webhook.offerId,
      planId: webhook.planId,
      quantity: webhook.quantity,
      action: webhook.action,
    }),
  );
}

function parseDate(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds)
    ? new Date(milliseconds).toISOString()
    : null;
}

function subscriptionTerm(value: unknown): SubscriptionTerm {
  const top = record(value);
  const subscription = record(top?.subscription) ?? top;
  const term = record(subscription?.term);
  return {
    start: parseDate(term?.startDate ?? term?.start),
    end: parseDate(term?.endDate ?? term?.end),
  };
}

function assertOperation(
  value: unknown,
  webhook: MarketplaceWebhookEnvelope,
): MarketplaceOperation {
  const operation = normalizeMarketplaceOperation(value);
  if (!operation) throw new WebhookError("marketplace_operation_invalid", 503);
  if (!webhookMatchesOperation(webhook, operation))
    throw new WebhookError("marketplace_operation_mismatch", 403);
  return operation;
}

function assertSubscription(
  value: unknown,
  webhook: MarketplaceWebhookEnvelope,
  config: MarketplaceConfig,
): ResolvedMarketplaceSubscription {
  const subscription = normalizeMarketplaceSubscription(value);
  if (!subscription)
    throw new WebhookError("marketplace_subscription_invalid", 503);
  if (
    subscription.subscriptionId !== webhook.subscriptionId ||
    subscription.publisherId !== config.publisherId ||
    subscription.offerId !== config.offerId
  ) {
    throw new WebhookError("marketplace_subscription_mismatch", 403);
  }
  return subscription;
}

async function rpc(
  service: ReturnType<typeof createClient>,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { data, error } = await service.rpc(name, args);
  if (error) {
    console.error("Marketplace lifecycle persistence failed", {
      operation: name,
      code: error.code,
    });
    throw new WebhookError("marketplace_persistence_failed", 500);
  }
  const result = record(data) ?? {};
  if (typeof result.error === "string") {
    console.error("Marketplace lifecycle transition refused", {
      operation: name,
    });
    throw new WebhookError("marketplace_transition_refused", 409);
  }
  return result;
}

function subscriptionArgs(
  subscription: ResolvedMarketplaceSubscription,
  term: SubscriptionTerm,
  evidence: MarketplaceEvidence<unknown>,
): Record<string, unknown> {
  return {
    p_marketplace_status: subscription.status,
    p_authoritative_plan_id: subscription.planId,
    p_authoritative_quantity: subscription.quantity,
    p_term_start: term.start,
    p_term_end: term.end,
    p_request_id: evidence.requestId,
    p_correlation_id: evidence.correlationId,
  };
}

async function authoritativeSubscription(
  config: MarketplaceConfig,
  webhook: MarketplaceWebhookEnvelope,
): Promise<{
  evidence: MarketplaceEvidence<unknown>;
  subscription: ResolvedMarketplaceSubscription;
  term: SubscriptionTerm;
}> {
  const evidence = await marketplaceCall(config, {
    method: "GET",
    url: marketplaceSubscriptionUrl(webhook.subscriptionId),
  });
  return {
    evidence,
    subscription: assertSubscription(evidence.body, webhook, config),
    term: subscriptionTerm(evidence.body),
  };
}

async function completeOperation(
  service: ReturnType<typeof createClient>,
  webhook: MarketplaceWebhookEnvelope,
  operation: MarketplaceOperation,
  authoritative: Awaited<ReturnType<typeof authoritativeSubscription>>,
): Promise<Record<string, unknown>> {
  return await rpc(service, "complete_marketplace_lifecycle_operation", {
    p_marketplace_subscription_id: webhook.subscriptionId,
    p_microsoft_operation_id: webhook.operationId,
    p_microsoft_operation_status: operation.status,
    ...subscriptionArgs(
      authoritative.subscription,
      authoritative.term,
      authoritative.evidence,
    ),
  });
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST")
    return json({ error: "method_not_allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY)
    return json({ error: "service_unavailable" }, 503);

  try {
    const authorization = request.headers.get("authorization") ?? "";
    if (!authorization.startsWith("Bearer ")) {
      throw new WebhookError("marketplace_webhook_token_required", 401);
    }
    const config = requireConfig();
    await verifyWebhookToken(request, config);

    const declaredLength = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES)
      throw new WebhookError("request_too_large", 413);
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES)
      throw new WebhookError("request_too_large", 413);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new WebhookError("invalid_json", 400);
    }
    const webhook = parseMarketplaceWebhook(parsed);
    if (!webhook) throw new WebhookError("invalid_webhook", 400);
    if (
      webhook.publisherId !== config.publisherId ||
      webhook.offerId !== config.offerId
    ) {
      throw new WebhookError("marketplace_offer_mismatch", 403);
    }

    const operationEvidence = await marketplaceCall(config, {
      method: "GET",
      url: marketplaceOperationUrl(webhook.subscriptionId, webhook.operationId),
    });
    let operation = assertOperation(operationEvidence.body, webhook);
    let authoritative = await authoritativeSubscription(config, webhook);
    const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const claim = await rpc(service, "claim_marketplace_lifecycle_operation", {
      p_marketplace_subscription_id: webhook.subscriptionId,
      p_microsoft_operation_id: webhook.operationId,
      p_action: operation.action,
      p_microsoft_status: operation.status,
      p_publisher_id: operation.publisherId,
      p_offer_id: operation.offerId,
      p_plan_id: operation.planId,
      p_quantity: operation.quantity,
      p_payload_fingerprint: await lifecycleFingerprint(webhook),
      p_request_id: operationEvidence.requestId,
      p_correlation_id: operationEvidence.correlationId,
    });

    if (claim.processingState === "quarantined") {
      if (requiresOperationAcknowledgement(operation.action)) {
        await marketplaceCall(config, {
          method: "PATCH",
          url: marketplaceOperationUrl(
            webhook.subscriptionId,
            webhook.operationId,
          ),
          body: { status: "Failure" },
        });
      }
      return json({
        accepted: true,
        state: "quarantined",
        reason: "manual_activation_binding_required",
      });
    }

    if (
      ["completed", "failed", "conflict"].includes(
        String(claim.processingState),
      )
    ) {
      return json({ accepted: true, state: claim.processingState });
    }

    if (["Succeeded", "Failed", "Conflict"].includes(operation.status)) {
      const completed = await completeOperation(
        service,
        webhook,
        operation,
        authoritative,
      );
      return json({ accepted: true, state: completed.processingState });
    }

    const applied = await rpc(
      service,
      "apply_marketplace_lifecycle_operation",
      {
        p_marketplace_subscription_id: webhook.subscriptionId,
        p_microsoft_operation_id: webhook.operationId,
        ...subscriptionArgs(
          authoritative.subscription,
          authoritative.term,
          authoritative.evidence,
        ),
      },
    );

    if (!requiresOperationAcknowledgement(operation.action)) {
      return json({ accepted: true, state: applied.processingState });
    }

    await marketplaceCall(config, {
      method: "PATCH",
      url: marketplaceOperationUrl(webhook.subscriptionId, webhook.operationId),
      body: { status: "Success" },
    });
    const finalOperationEvidence = await marketplaceCall(config, {
      method: "GET",
      url: marketplaceOperationUrl(webhook.subscriptionId, webhook.operationId),
    });
    operation = assertOperation(finalOperationEvidence.body, webhook);
    if (!["Succeeded", "Failed", "Conflict"].includes(operation.status)) {
      throw new WebhookError("marketplace_operation_not_terminal", 503);
    }
    authoritative = await authoritativeSubscription(config, webhook);
    const completed = await completeOperation(
      service,
      webhook,
      operation,
      authoritative,
    );
    return json({ accepted: true, state: completed.processingState });
  } catch (error) {
    if (error instanceof WebhookError)
      return json({ error: error.code }, error.status);
    console.error("Marketplace webhook failed", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return json({ error: "marketplace_webhook_failed" }, 500);
  }
});
