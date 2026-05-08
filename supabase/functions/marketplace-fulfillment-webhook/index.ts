/**
 * marketplace-fulfillment-webhook Edge Function
 * =============================================
 * Implements Microsoft SaaS Fulfillment API v2 — both halves:
 *
 *  1. POST /resolve  — exchange a Marketplace token (received as
 *     ?token=<...> on the activation landing URL) for the full
 *     subscription record. Persists to marketplace_subscriptions.
 *
 *  2. POST /webhook  — receive lifecycle events (ChangeQuantity,
 *     ChangePlan, Suspend, Reinstate, Unsubscribe, Renew) and apply
 *     them idempotently to marketplace_subscriptions.
 *
 * Microsoft API reference:
 *   https://learn.microsoft.com/azure/marketplace/partner-center-portal/pc-saas-fulfillment-api-v2
 *
 * Required env (set via `supabase secrets set ...`):
 *   MARKETPLACE_AAD_TENANT_ID         - Stigg Technologies AAD tenant
 *   MARKETPLACE_AAD_CLIENT_ID         - Single-tenant app registration for the offer
 *   MARKETPLACE_AAD_CLIENT_SECRET     - secret (used to acquire AAD token)
 *
 * Schema dependency: 015_marketplace_microsoft.sql
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const SAAS_API_VERSION = "2018-08-31";
const SAAS_RESOURCE = "62d94f6c-d599-489b-a797-3e10e42fbe22"; // Microsoft Marketplace API resource id

interface ResolveBody {
  action: "resolve";
  marketplace_token: string;
}

interface WebhookBody {
  action: "webhook";
  event: MarketplaceWebhookEvent;
}

interface MarketplaceWebhookEvent {
  id: string;                    // event uuid
  activityId: string;
  subscriptionId: string;
  publisherId?: string;
  offerId?: string;
  planId?: string;
  quantity?: number;
  timeStamp: string;
  action: "ChangeQuantity" | "ChangePlan" | "Suspend" | "Reinstate" | "Unsubscribe" | "Renew";
  status: string;
}

interface ResolvedSubscription {
  id: string;
  subscriptionName: string;
  offerId: string;
  planId: string;
  quantity: number;
  subscription: {
    id: string;
    publisherId: string;
    offerId: string;
    name: string;
    saasSubscriptionStatus: string;
    beneficiary: { emailId: string; objectId: string; tenantId: string };
    purchaser: { emailId: string; objectId: string; tenantId: string };
    planId: string;
    quantity: number;
    sessionId?: string;
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  try {
    const body = (await req.json().catch(() => ({}))) as ResolveBody | WebhookBody;
    if (!("action" in body)) return json({ ok: false, error: "action is required (resolve|webhook)" }, 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return json({ ok: false, error: "Server misconfigured" }, 500);

    const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    if (body.action === "resolve") return await handleResolve(supabase, body.marketplace_token);
    if (body.action === "webhook") return await handleWebhook(supabase, body.event);

    return json({ ok: false, error: `Unknown action: ${(body as { action: string }).action}` }, 400);
  } catch (err) {
    console.error("[marketplace-fulfillment-webhook] uncaught", err);
    return json({ ok: false, error: String((err as Error)?.message ?? err) }, 500);
  }
});

async function acquireAadToken(): Promise<string> {
  const tenantId = Deno.env.get("MARKETPLACE_AAD_TENANT_ID");
  const clientId = Deno.env.get("MARKETPLACE_AAD_CLIENT_ID");
  const clientSecret = Deno.env.get("MARKETPLACE_AAD_CLIENT_SECRET");
  if (!tenantId || !clientId || !clientSecret) {
    throw new Error("MARKETPLACE_AAD_TENANT_ID/CLIENT_ID/CLIENT_SECRET not set");
  }

  const url = `https://login.microsoftonline.com/${tenantId}/oauth2/token`;
  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    resource: `https://${SAAS_RESOURCE}/`,
  });
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  if (!res.ok) throw new Error(`AAD token acquisition failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.access_token;
}

async function handleResolve(
  supabase: ReturnType<typeof createClient>,
  token: string,
): Promise<Response> {
  if (!token) return json({ ok: false, error: "marketplace_token is required" }, 400);

  const aadToken = await acquireAadToken();
  const res = await fetch(
    `https://marketplaceapi.microsoft.com/api/saas/subscriptions/resolve?api-version=${SAAS_API_VERSION}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${aadToken}`,
        "Content-Type": "application/json",
        "x-ms-marketplace-token": token,
      },
    },
  );
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    return json({ ok: false, error: `Resolve failed: ${res.status} ${errBody.slice(0, 300)}` }, 502);
  }
  const resolved = (await res.json()) as ResolvedSubscription;
  const sub = resolved.subscription;

  const { data: subId, error } = await supabase.rpc("marketplace_upsert_subscription_from_resolve", {
    p_marketplace: "microsoft",
    p_subscription_id: sub.id,
    p_offer_id: sub.offerId,
    p_plan_id: sub.planId,
    p_quantity: sub.quantity ?? 1,
    p_purchaser_email: sub.purchaser?.emailId ?? null,
    p_purchaser_object_id: sub.purchaser?.objectId ?? null,
    p_purchaser_tenant_id: sub.purchaser?.tenantId ?? null,
    p_beneficiary_email: sub.beneficiary?.emailId ?? null,
    p_beneficiary_object_id: sub.beneficiary?.objectId ?? null,
    p_beneficiary_tenant_id: sub.beneficiary?.tenantId ?? null,
    p_status: sub.saasSubscriptionStatus ?? "PendingFulfillmentStart",
    p_session_id: sub.sessionId ?? null,
    p_raw_payload: resolved as unknown as Record<string, unknown>,
  });
  if (error) return json({ ok: false, error: `Persist failed: ${error.message}` }, 500);

  return json({
    ok: true,
    subscription_id: subId,
    marketplace_subscription_id: sub.id,
    offer_id: sub.offerId,
    plan_id: sub.planId,
    quantity: sub.quantity ?? 1,
    purchaser_email: sub.purchaser?.emailId,
    status: sub.saasSubscriptionStatus,
  });
}

async function handleWebhook(
  supabase: ReturnType<typeof createClient>,
  event: MarketplaceWebhookEvent,
): Promise<Response> {
  if (!event?.id || !event?.subscriptionId || !event?.action) {
    return json({ ok: false, error: "event.id, event.subscriptionId, event.action required" }, 400);
  }

  const { data: eventUuid, error } = await supabase.rpc("marketplace_apply_webhook_event", {
    p_event_id: event.id,
    p_subscription_id: event.subscriptionId,
    p_action: event.action,
    p_payload: event as unknown as Record<string, unknown>,
  });
  if (error) return json({ ok: false, error: `Apply failed: ${error.message}` }, 500);

  // Acknowledge to Microsoft so they don't retry
  return json({ ok: true, event_uuid: eventUuid, action: event.action, applied: true });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
