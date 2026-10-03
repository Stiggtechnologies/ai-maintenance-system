import {
  MARKETPLACE_API_ORIGIN,
  MARKETPLACE_API_VERSION,
} from "../marketplace-fulfillment/core.ts";

export const MARKETPLACE_RESOURCE_ID = "20e940b3-4c77-4b0b-9a53-9e16a1b010a7";

export type MarketplaceWebhookAction =
  | "Subscribe"
  | "ChangePlan"
  | "ChangeQuantity"
  | "Renew"
  | "Suspend"
  | "Unsubscribe"
  | "Reinstate";

export type MarketplaceOperationStatus =
  "NotStarted" | "InProgress" | "Failed" | "Succeeded" | "Conflict";

export interface MarketplaceWebhookEnvelope {
  operationId: string;
  activityId: string | null;
  subscriptionId: string;
  publisherId: string;
  offerId: string;
  planId: string;
  quantity: number | null;
  action: MarketplaceWebhookAction;
  status: MarketplaceOperationStatus;
  timestamp: string | null;
}

export interface MarketplaceOperation {
  operationId: string;
  subscriptionId: string;
  publisherId: string;
  offerId: string;
  planId: string;
  quantity: number | null;
  action: MarketplaceWebhookAction;
  status: MarketplaceOperationStatus;
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIONS = new Set<MarketplaceWebhookAction>([
  "Subscribe",
  "ChangePlan",
  "ChangeQuantity",
  "Renew",
  "Suspend",
  "Unsubscribe",
  "Reinstate",
]);
const OPERATION_STATUSES = new Set<MarketplaceOperationStatus>([
  "NotStarted",
  "InProgress",
  "Failed",
  "Succeeded",
  "Conflict",
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

function quantity(value: unknown): number | null | undefined {
  if (value == null) return null;
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined;
}

function action(value: unknown): MarketplaceWebhookAction | null {
  const parsed = nonBlank(value, 64) as MarketplaceWebhookAction | null;
  return parsed && ACTIONS.has(parsed) ? parsed : null;
}

function operationStatus(value: unknown): MarketplaceOperationStatus | null {
  const parsed = nonBlank(value, 64) as MarketplaceOperationStatus | null;
  return parsed && OPERATION_STATUSES.has(parsed) ? parsed : null;
}

export function parseMarketplaceWebhook(
  value: unknown,
): MarketplaceWebhookEnvelope | null {
  const body = record(value);
  if (!body) return null;
  const operationId = uuid(body.id ?? body.operationId);
  const subscriptionId = uuid(body.subscriptionId);
  const publisherId = nonBlank(body.publisherId, 200);
  const offerId = nonBlank(body.offerId, 200);
  const planId = nonBlank(body.planId, 200);
  const parsedQuantity = quantity(body.quantity);
  const parsedAction = action(body.action);
  const status = operationStatus(body.status);
  if (
    !operationId ||
    !subscriptionId ||
    !publisherId ||
    !offerId ||
    !planId ||
    parsedQuantity === undefined ||
    !parsedAction ||
    !status
  ) {
    return null;
  }
  return {
    operationId,
    activityId: uuid(body.activityId),
    subscriptionId,
    publisherId,
    offerId,
    planId,
    quantity: parsedQuantity,
    action: parsedAction,
    status,
    timestamp: nonBlank(body.timeStamp ?? body.timestamp, 100),
  };
}

export function normalizeMarketplaceOperation(
  value: unknown,
): MarketplaceOperation | null {
  const body = record(value);
  if (!body) return null;
  const operationId = uuid(body.id ?? body.operationId);
  const subscriptionId = uuid(body.subscriptionId);
  const publisherId = nonBlank(body.publisherId, 200);
  const offerId = nonBlank(body.offerId, 200);
  const planId = nonBlank(body.planId, 200);
  const parsedQuantity = quantity(body.quantity);
  const parsedAction = action(body.action);
  const status = operationStatus(body.status);
  if (
    !operationId ||
    !subscriptionId ||
    !publisherId ||
    !offerId ||
    !planId ||
    parsedQuantity === undefined ||
    !parsedAction ||
    !status
  ) {
    return null;
  }
  return {
    operationId,
    subscriptionId,
    publisherId,
    offerId,
    planId,
    quantity: parsedQuantity,
    action: parsedAction,
    status,
  };
}

export function webhookMatchesOperation(
  webhook: MarketplaceWebhookEnvelope,
  operation: MarketplaceOperation,
): boolean {
  return (
    webhook.operationId === operation.operationId &&
    webhook.subscriptionId === operation.subscriptionId &&
    webhook.publisherId === operation.publisherId &&
    webhook.offerId === operation.offerId &&
    webhook.planId === operation.planId &&
    webhook.quantity === operation.quantity &&
    webhook.action === operation.action
  );
}

export function requiresOperationAcknowledgement(
  value: MarketplaceWebhookAction,
): boolean {
  return ["ChangePlan", "ChangeQuantity", "Reinstate"].includes(value);
}

export function validateMarketplaceWebhookClaims(
  claims: Record<string, unknown>,
  expected: { clientId: string; tenantId: string },
): boolean {
  const tenantId = uuid(claims.tid);
  const audience = Array.isArray(claims.aud)
    ? claims.aud
    : typeof claims.aud === "string"
      ? [claims.aud]
      : [];
  const caller = nonBlank(claims.azp ?? claims.appid, 200);
  const issuer = nonBlank(claims.iss, 300);
  if (
    tenantId !== expected.tenantId.toLowerCase() ||
    !audience.includes(expected.clientId) ||
    caller !== MARKETPLACE_RESOURCE_ID ||
    !issuer
  ) {
    return false;
  }
  return (
    issuer === `https://login.microsoftonline.com/${tenantId}/v2.0` ||
    issuer === `https://sts.windows.net/${tenantId}/`
  );
}

export function marketplaceOperationUrl(
  subscriptionId: string,
  operationId: string,
): string {
  if (!UUID.test(subscriptionId) || !UUID.test(operationId))
    throw new Error("invalid marketplace operation identity");
  return `${MARKETPLACE_API_ORIGIN}/api/saas/subscriptions/${subscriptionId}/operations/${operationId}?api-version=${MARKETPLACE_API_VERSION}`;
}

export function marketplaceSubscriptionUrl(subscriptionId: string): string {
  if (!UUID.test(subscriptionId))
    throw new Error("invalid marketplace subscription identity");
  return `${MARKETPLACE_API_ORIGIN}/api/saas/subscriptions/${subscriptionId}?api-version=${MARKETPLACE_API_VERSION}`;
}
