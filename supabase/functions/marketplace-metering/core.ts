import { MARKETPLACE_TOKEN_SCOPE } from "../marketplace-fulfillment/core.ts";

export { MARKETPLACE_TOKEN_SCOPE };

export const MARKETPLACE_METERING_API_VERSION = "2018-08-31";
export const MARKETPLACE_METERING_BATCH_LIMIT = 25;

export type MeteringTerminalStatus =
  | "Accepted"
  | "Duplicate"
  | "Expired"
  | "Error"
  | "ResourceNotFound"
  | "ResourceNotAuthorized"
  | "ResourceNotActive"
  | "InvalidDimension"
  | "InvalidQuantity"
  | "BadArgument";

export interface ClaimedMeteringEvent {
  recordId: string;
  resourceId: string;
  dimension: string;
  quantity: number;
  effectiveStartTime: string;
  planId: string;
}

export interface MeteringClaim {
  claimToken: string;
  events: ClaimedMeteringEvent[];
}

export interface NormalizedMeteringResult {
  recordId: string;
  status: MeteringTerminalStatus;
  usageEventId: string | null;
  messageTime: string | null;
  acceptedQuantity: number | null;
  exactDuplicate: boolean;
  response: Record<string, unknown>;
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUSES = new Set<MeteringTerminalStatus>([
  "Accepted",
  "Duplicate",
  "Expired",
  "Error",
  "ResourceNotFound",
  "ResourceNotAuthorized",
  "ResourceNotActive",
  "InvalidDimension",
  "InvalidQuantity",
  "BadArgument",
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

function positiveFinite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function sameHour(left: string, right: string): boolean {
  const a = new Date(left);
  const b = new Date(right);
  return (
    Number.isFinite(a.getTime()) &&
    Number.isFinite(b.getTime()) &&
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate() &&
    a.getUTCHours() === b.getUTCHours()
  );
}

function normalizedIdentity(value: unknown): {
  resourceId: string;
  dimension: string;
  quantity: number;
  effectiveStartTime: string;
  planId: string;
} | null {
  const body = record(value);
  if (!body) return null;
  const resourceId = nonBlank(body.resourceId, 100);
  const dimension = nonBlank(body.dimension, 100);
  const quantity = positiveFinite(body.quantity);
  const effectiveStartTime = nonBlank(body.effectiveStartTime, 100);
  const planId = nonBlank(body.planId, 200);
  if (!resourceId || !dimension || !quantity || !effectiveStartTime || !planId)
    return null;
  return { resourceId, dimension, quantity, effectiveStartTime, planId };
}

function matchesClaimedIdentity(
  value: unknown,
  expected: ClaimedMeteringEvent,
): boolean {
  const actual = normalizedIdentity(value);
  return Boolean(
    actual &&
    actual.resourceId.toLowerCase() === expected.resourceId.toLowerCase() &&
    actual.dimension === expected.dimension &&
    actual.quantity === expected.quantity &&
    sameHour(actual.effectiveStartTime, expected.effectiveStartTime) &&
    actual.planId === expected.planId,
  );
}

export function marketplaceMeteringBatchUrl(): string {
  return `https://marketplaceapi.microsoft.com/api/batchUsageEvent?api-version=${MARKETPLACE_METERING_API_VERSION}`;
}

export function normalizeMeteringClaim(value: unknown): MeteringClaim | null {
  const body = record(value);
  const claimToken = nonBlank(body?.claimToken, 64);
  if (!claimToken || !UUID.test(claimToken) || !Array.isArray(body?.events))
    return null;
  if (
    body.events.length === 0 ||
    body.events.length > MARKETPLACE_METERING_BATCH_LIMIT
  )
    return null;
  const events: ClaimedMeteringEvent[] = [];
  const seen = new Set<string>();
  for (const raw of body.events) {
    const event = record(raw);
    const recordId = nonBlank(event?.recordId, 64);
    const identity = normalizedIdentity(event);
    if (!recordId || !UUID.test(recordId) || !identity || seen.has(recordId))
      return null;
    seen.add(recordId);
    events.push({ recordId: recordId.toLowerCase(), ...identity });
  }
  return { claimToken: claimToken.toLowerCase(), events };
}

export function buildMeteringBatchRequest(claim: MeteringClaim): {
  request: Array<{
    resourceId: string;
    quantity: number;
    dimension: string;
    effectiveStartTime: string;
    planId: string;
  }>;
} {
  return {
    request: claim.events.map((event) => ({
      resourceId: event.resourceId,
      quantity: event.quantity,
      dimension: event.dimension,
      effectiveStartTime: event.effectiveStartTime,
      planId: event.planId,
    })),
  };
}

export function normalizeMeteringBatchResponse(
  value: unknown,
  claim: MeteringClaim,
): NormalizedMeteringResult[] | null {
  const body = record(value);
  const rawResults = Array.isArray(body?.result) ? body.result : null;
  if (!rawResults || rawResults.length !== claim.events.length) return null;
  const unmatched = new Map(
    claim.events.map((event) => [
      `${event.resourceId.toLowerCase()}\u0000${event.dimension}\u0000${new Date(event.effectiveStartTime).getUTCHours()}\u0000${new Date(event.effectiveStartTime).toISOString().slice(0, 10)}`,
      event,
    ]),
  );
  const normalized: NormalizedMeteringResult[] = [];
  for (const raw of rawResults) {
    const response = record(raw);
    if (!response) return null;
    const identity = normalizedIdentity(response);
    if (!identity) return null;
    const date = new Date(identity.effectiveStartTime);
    if (!Number.isFinite(date.getTime())) return null;
    const key = `${identity.resourceId.toLowerCase()}\u0000${identity.dimension}\u0000${date.getUTCHours()}\u0000${date.toISOString().slice(0, 10)}`;
    const expected = unmatched.get(key);
    if (!expected) return null;
    unmatched.delete(key);
    const status = nonBlank(
      response.status,
      64,
    ) as MeteringTerminalStatus | null;
    if (!status || !STATUSES.has(status)) return null;
    const error = record(response.error);
    const additionalInfo = record(error?.additionalInfo);
    const acceptedMessage = record(additionalInfo?.acceptedMessage);
    const exactDuplicate =
      status === "Duplicate" &&
      matchesClaimedIdentity(acceptedMessage, expected);
    if (status === "Accepted" && !matchesClaimedIdentity(response, expected))
      return null;
    normalized.push({
      recordId: expected.recordId,
      status,
      usageEventId: nonBlank(
        response.usageEventId ?? acceptedMessage?.usageEventId,
        100,
      ),
      messageTime: nonBlank(
        response.messageTime ?? acceptedMessage?.messageTime,
        100,
      ),
      acceptedQuantity:
        positiveFinite(response.quantity ?? acceptedMessage?.quantity) ?? null,
      exactDuplicate,
      response,
    });
  }
  return unmatched.size === 0 ? normalized : null;
}

export function isRetryableMeteringHttpStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}
