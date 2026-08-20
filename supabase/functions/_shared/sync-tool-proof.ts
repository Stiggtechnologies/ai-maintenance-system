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
