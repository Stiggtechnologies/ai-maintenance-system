export const MARKETPLACE_API_VERSION = "2018-08-31";
export const MARKETPLACE_API_ORIGIN = "https://marketplaceapi.microsoft.com";
export const MARKETPLACE_TOKEN_SCOPE =
  "20e940b3-4c77-4b0b-9a53-9e16a1b010a7/.default";

export type MarketplaceStatus =
  "PendingFulfillmentStart" | "Subscribed" | "Suspended" | "Unsubscribed";

export interface MarketplaceParty {
  tenantId: string;
  objectId?: string;
}

export interface ResolvedMarketplaceSubscription {
  subscriptionId: string;
  subscriptionName: string;
  publisherId: string;
  offerId: string;
  planId: string;
  quantity: number | null;
  termUnit: string | null;
  status: MarketplaceStatus;
  beneficiary: MarketplaceParty;
  purchaser: MarketplaceParty;
}

export type MarketplaceRequest =
  | { action: "resolve"; token: string }
  | {
      action: "activate" | "status";
      resolutionId: string;
      activationToken: string;
    };

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUSES = new Set<MarketplaceStatus>([
  "PendingFulfillmentStart",
  "Subscribed",
  "Suspended",
  "Unsubscribed",
]);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonBlank(value: unknown, maximum = 500): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= maximum ? trimmed : null;
}

function uuid(value: unknown): string | null {
  const parsed = nonBlank(value, 64);
  return parsed && UUID.test(parsed) ? parsed.toLowerCase() : null;
}

export function parseMarketplaceRequest(
  value: unknown,
): MarketplaceRequest | null {
  const body = record(value);
  if (!body) return null;
  if (body.action === "resolve") {
    const token = nonBlank(body.token, 16_384);
    if (!token || token.length < 16 || /\s/.test(token)) return null;
    return { action: "resolve", token };
  }
  if (body.action === "activate" || body.action === "status") {
    const resolutionId = uuid(body.resolutionId);
    const activationToken = nonBlank(body.activationToken, 512);
    if (!resolutionId || !activationToken || activationToken.length < 32)
      return null;
    return { action: body.action, resolutionId, activationToken };
  }
  return null;
}

export function normalizeMarketplaceSubscription(
  value: unknown,
): ResolvedMarketplaceSubscription | null {
  const top = record(value);
  if (!top) return null;
  const subscription = record(top.subscription) ?? top;
  const beneficiary = record(subscription.beneficiary);
  const purchaser = record(subscription.purchaser);
  if (!beneficiary || !purchaser) return null;

  const subscriptionId = uuid(subscription.id ?? top.id);
  const subscriptionName = nonBlank(subscription.name ?? top.subscriptionName);
  const publisherId = nonBlank(
    subscription.publisherId ?? top.publisherId,
    200,
  );
  const offerId = nonBlank(subscription.offerId ?? top.offerId, 200);
  const planId = nonBlank(subscription.planId ?? top.planId, 200);
  const beneficiaryTenantId = uuid(beneficiary.tenantId);
  const purchaserTenantId = uuid(purchaser.tenantId);
  const rawStatus = nonBlank(
    subscription.saasSubscriptionStatus ?? top.saasSubscriptionStatus,
    64,
  ) as MarketplaceStatus | null;
  const rawQuantity = subscription.quantity ?? top.quantity;
  const quantity =
    rawQuantity == null
      ? null
      : typeof rawQuantity === "number" &&
          Number.isSafeInteger(rawQuantity) &&
          rawQuantity > 0
        ? rawQuantity
        : NaN;
  if (
    !subscriptionId ||
    !subscriptionName ||
    !publisherId ||
    !offerId ||
    !planId ||
    !beneficiaryTenantId ||
    !purchaserTenantId ||
    !rawStatus ||
    !STATUSES.has(rawStatus) ||
    Number.isNaN(quantity)
  ) {
    return null;
  }
  const term = record(subscription.term);
  return {
    subscriptionId,
    subscriptionName,
    publisherId,
    offerId,
    planId,
    quantity,
    termUnit: nonBlank(term?.termUnit, 32),
    status: rawStatus,
    beneficiary: {
      tenantId: beneficiaryTenantId,
      objectId: uuid(beneficiary.objectId) ?? undefined,
    },
    purchaser: {
      tenantId: purchaserTenantId,
      objectId: uuid(purchaser.objectId) ?? undefined,
    },
  };
}

interface AuthIdentity {
  provider?: unknown;
  identity_data?: unknown;
}

export interface VerifiedUserShape {
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
  identities?: AuthIdentity[] | null;
}

function microsoftIssuerTenant(value: unknown): string | null {
  const issuer = nonBlank(value, 300);
  if (!issuer) return null;
  try {
    const url = new URL(issuer);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "login.microsoftonline.com"
    )
      return null;
    const segments = url.pathname.split("/").filter(Boolean);
    return segments.length >= 1 ? uuid(segments[0]) : null;
  } catch {
    return null;
  }
}

/** Derive one unambiguous tenant only from the Auth-server-verified Azure identity. */
export function verifiedAzureTenantId(user: VerifiedUserShape): string | null {
  const providers = user.app_metadata?.providers;
  const azureBacked =
    user.app_metadata?.provider === "azure" ||
    (Array.isArray(providers) && providers.includes("azure")) ||
    Boolean(user.identities?.some((identity) => identity.provider === "azure"));
  if (!azureBacked) return null;

  const candidates = new Set<string>();
  const appTenant = uuid(
    user.app_metadata?.tenant_id ?? user.app_metadata?.tid,
  );
  if (appTenant) candidates.add(appTenant);
  const metadataTenant = uuid(
    user.user_metadata?.tenant_id ?? user.user_metadata?.tid,
  );
  if (metadataTenant) candidates.add(metadataTenant);
  const metadataIssuerTenant = microsoftIssuerTenant(user.user_metadata?.iss);
  if (metadataIssuerTenant) candidates.add(metadataIssuerTenant);
  for (const identity of user.identities ?? []) {
    if (identity.provider !== "azure") continue;
    const data = record(identity.identity_data);
    const tenant = uuid(data?.tenant_id ?? data?.tid);
    if (tenant) candidates.add(tenant);
    const issuerTenant = microsoftIssuerTenant(data?.iss);
    if (issuerTenant) candidates.add(issuerTenant);
  }
  return candidates.size === 1 ? [...candidates][0] : null;
}

export function marketplaceResolveUrl(): string {
  return `${MARKETPLACE_API_ORIGIN}/api/saas/subscriptions/resolve?api-version=${MARKETPLACE_API_VERSION}`;
}

export function marketplaceActivateUrl(subscriptionId: string): string {
  if (!UUID.test(subscriptionId)) throw new Error("invalid subscription id");
  return `${MARKETPLACE_API_ORIGIN}/api/saas/subscriptions/${subscriptionId}/activate?api-version=${MARKETPLACE_API_VERSION}`;
}

export function marketplaceSubscriptionUrl(subscriptionId: string): string {
  if (!UUID.test(subscriptionId)) throw new Error("invalid subscription id");
  return `${MARKETPLACE_API_ORIGIN}/api/saas/subscriptions/${subscriptionId}?api-version=${MARKETPLACE_API_VERSION}`;
}

export function shouldActivateMarketplaceSubscription(
  action: MarketplaceRequest["action"],
  activationRequired: boolean,
  status: MarketplaceStatus,
): boolean {
  return (
    action === "activate" &&
    activationRequired &&
    status === "PendingFulfillmentStart"
  );
}

export function publicSubscription(
  subscription: ResolvedMarketplaceSubscription,
): Record<string, unknown> {
  return {
    id: subscription.subscriptionId,
    name: subscription.subscriptionName,
    publisherId: subscription.publisherId,
    offerId: subscription.offerId,
    planId: subscription.planId,
    quantity: subscription.quantity,
    termUnit: subscription.termUnit,
    status: subscription.status,
  };
}
