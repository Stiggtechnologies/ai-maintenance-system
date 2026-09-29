import { supabase } from "./supabase";
import { supabasePublicKey, supabaseUrl } from "./supabase-config";

export const MARKETPLACE_FULFILLMENT_STORAGE_KEY =
  "marketplace_fulfillment_resolution";

export type MarketplaceStatus =
  "PendingFulfillmentStart" | "Subscribed" | "Suspended" | "Unsubscribed";

export interface MarketplaceSubscription {
  id: string;
  name: string;
  publisherId: string;
  offerId: string;
  planId: string;
  quantity: number | null;
  termUnit: string | null;
  status: MarketplaceStatus;
}

export interface MarketplaceResolution {
  resolutionId: string;
  activationToken: string;
  state: string;
  bound: boolean;
  subscription: MarketplaceSubscription;
}

export interface MarketplaceFulfillmentResult {
  resolutionId: string;
  state: string;
  subscription: MarketplaceSubscription;
}

export interface MarketplaceFulfillmentContext {
  version: 1;
  resolutionId: string;
  activationToken: string;
  subscription: MarketplaceSubscription;
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MARKETPLACE_STATUSES = new Set<MarketplaceStatus>([
  "PendingFulfillmentStart",
  "Subscribed",
  "Suspended",
  "Unsubscribed",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isSubscription(value: unknown): value is MarketplaceSubscription {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    UUID.test(value.id) &&
    typeof value.name === "string" &&
    typeof value.publisherId === "string" &&
    typeof value.offerId === "string" &&
    typeof value.planId === "string" &&
    (value.quantity === null ||
      (typeof value.quantity === "number" &&
        Number.isSafeInteger(value.quantity) &&
        value.quantity > 0)) &&
    (value.termUnit === null || typeof value.termUnit === "string") &&
    typeof value.status === "string" &&
    MARKETPLACE_STATUSES.has(value.status as MarketplaceStatus)
  );
}

export function marketplaceContext(
  resolution: MarketplaceResolution,
): MarketplaceFulfillmentContext {
  return {
    version: 1,
    resolutionId: resolution.resolutionId,
    activationToken: resolution.activationToken,
    subscription: resolution.subscription,
  };
}

export function parseMarketplaceContext(
  value: string | null,
): MarketplaceFulfillmentContext | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      !isRecord(parsed) ||
      parsed.version !== 1 ||
      typeof parsed.resolutionId !== "string" ||
      !UUID.test(parsed.resolutionId) ||
      typeof parsed.activationToken !== "string" ||
      parsed.activationToken.length < 32 ||
      !isSubscription(parsed.subscription)
    ) {
      return null;
    }
    return parsed as unknown as MarketplaceFulfillmentContext;
  } catch {
    return null;
  }
}

function userFacingError(code: string, status: number): Error {
  const messages: Record<string, string> = {
    marketplace_not_configured:
      "Azure Marketplace activation is not configured yet. Contact SyncAI support.",
    verified_azure_session_required:
      "Sign in with the Microsoft tenant associated with this purchase.",
    marketplace_offer_mismatch:
      "This purchase does not belong to the configured SyncAI Marketplace offer.",
    marketplace_activation_requires_an_existing_organization_administrator:
      "Activation requires an existing SyncAI organization administrator.",
    verified_microsoft_tenant_does_not_match_the_purchase:
      "Your verified Microsoft tenant does not match this Marketplace purchase.",
    marketplace_resolution_has_expired:
      "This activation link has expired. Return to Azure Marketplace to restart activation.",
    resolve_rate_limit_reached:
      "Too many Marketplace activation attempts were received from this network today. Contact SyncAI support if a valid purchase needs immediate activation.",
  };
  return new Error(
    messages[code] ??
      (status >= 500
        ? "Azure Marketplace activation is temporarily unavailable. Try again or contact SyncAI support."
        : "The Marketplace request could not be completed. Verify the purchase and Microsoft account, then try again."),
  );
}

async function invokeMarketplace<T>(
  body: Record<string, unknown>,
  accessToken: string,
): Promise<T> {
  const response = await fetch(
    `${supabaseUrl}/functions/v1/marketplace-fulfillment`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: supabasePublicKey,
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(25_000),
    },
  );
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const code =
      isRecord(payload) && typeof payload.error === "string"
        ? payload.error
        : "marketplace_request_failed";
    throw userFacingError(code, response.status);
  }
  return payload as T;
}

async function verifiedSessionToken(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) {
    throw new Error(
      "Your Microsoft session is unavailable. Sign in again to continue activation.",
    );
  }
  return data.session.access_token;
}

export async function resolveMarketplaceToken(
  token: string,
): Promise<MarketplaceResolution> {
  const result = await invokeMarketplace<MarketplaceResolution>(
    { action: "resolve", token },
    supabasePublicKey,
  );
  if (
    !UUID.test(result.resolutionId) ||
    typeof result.activationToken !== "string" ||
    result.activationToken.length < 32 ||
    !isSubscription(result.subscription)
  ) {
    throw new Error(
      "Azure Marketplace returned an invalid activation response.",
    );
  }
  return result;
}

async function continueFulfillment(
  action: "activate" | "status",
  context: MarketplaceFulfillmentContext,
): Promise<MarketplaceFulfillmentResult> {
  const result = await invokeMarketplace<MarketplaceFulfillmentResult>(
    {
      action,
      resolutionId: context.resolutionId,
      activationToken: context.activationToken,
    },
    await verifiedSessionToken(),
  );
  if (
    result.resolutionId !== context.resolutionId ||
    typeof result.state !== "string" ||
    !isSubscription(result.subscription)
  ) {
    throw new Error("Azure Marketplace returned an invalid status response.");
  }
  return result;
}

export function activateMarketplaceSubscription(
  context: MarketplaceFulfillmentContext,
): Promise<MarketplaceFulfillmentResult> {
  return continueFulfillment("activate", context);
}

export function getMarketplaceSubscriptionStatus(
  context: MarketplaceFulfillmentContext,
): Promise<MarketplaceFulfillmentResult> {
  return continueFulfillment("status", context);
}
