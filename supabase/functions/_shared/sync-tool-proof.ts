function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

export function canonicalProposalPayload(
  proposalId: string,
  toolId: string,
  params: Record<string, unknown>,
): string {
  return JSON.stringify(
    canonicalize({
      proposalId,
      toolId,
      params,
    }),
  );
}

export async function proposalParamsHash(
  proposalId: string,
  toolId: string,
  params: Record<string, unknown>,
): Promise<string> {
  const encoded = new TextEncoder().encode(
    canonicalProposalPayload(proposalId, toolId, params),
  );
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function hasCanonicalIdempotencyKey(
  proposalId: string,
  idempotencyKey: string,
): boolean {
  return proposalId.length > 0 && proposalId === idempotencyKey;
}

export function proposalIsUnexpired(
  expiresAt: unknown,
  nowMs = Date.now(),
): boolean {
  if (typeof expiresAt !== "string") return false;
  const expiresMs = Date.parse(expiresAt);
  return Number.isFinite(expiresMs) && expiresMs > nowMs;
}

export const SYNC_TOOL_EXECUTION_ENTITY = "sync_tool_execution";
export const SYNC_TOOL_EXECUTION_RESULT_ENTITY = "sync_tool_execution_result";

export type ToolReservationDecision =
  | { action: "proceed" }
  | { action: "replay"; reservationId: string; result: unknown }
  | { action: "in_progress" };

function asEventRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

export function isTerminalToolExecutionStatus(
  status: unknown,
): status is "completed" | "refused" {
  return status === "completed" || status === "refused";
}

/**
 * Append-only audit_events cannot be updated from running → completed.
 * Reservation and result are therefore two inserts; replay prefers the
 * terminal result, and only then a legacy terminal reservation row.
 */
export function decideToolReservation(input: {
  reservation?: { id: string; eventData?: unknown } | null;
  result?: { id: string; eventData?: unknown } | null;
}): ToolReservationDecision {
  const resultData = asEventRecord(input.result?.eventData);
  if (input.result?.id && isTerminalToolExecutionStatus(resultData.status)) {
    return {
      action: "replay",
      reservationId: String(resultData.reservation_id ?? input.result.id),
      result: resultData.result ?? null,
    };
  }

  const reservationData = asEventRecord(input.reservation?.eventData);
  if (
    input.reservation?.id &&
    isTerminalToolExecutionStatus(reservationData.status)
  ) {
    return {
      action: "replay",
      reservationId: input.reservation.id,
      result: reservationData.result ?? null,
    };
  }

  if (input.reservation?.id) return { action: "in_progress" };
  return { action: "proceed" };
}

export function toolReservationEventData(input: {
  idempotencyKey: string;
  proposalId: string;
  toolId: string;
}): Record<string, unknown> {
  return {
    status: "running",
    idempotency_key: input.idempotencyKey,
    proposal_id: input.proposalId,
    tool_id: input.toolId,
  };
}

export function toolExecutionResultEventData(input: {
  status: "completed" | "refused";
  idempotencyKey: string;
  proposalId: string;
  toolId: string;
  reservationId: string;
  result: unknown;
}): Record<string, unknown> {
  return {
    status: input.status,
    idempotency_key: input.idempotencyKey,
    proposal_id: input.proposalId,
    tool_id: input.toolId,
    reservation_id: input.reservationId,
    result: input.result,
  };
}
