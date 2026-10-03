/**
 * Azure Container Apps managed-identity token acquisition.
 *
 * The platform injects IDENTITY_ENDPOINT and a rotating IDENTITY_HEADER. The
 * latter is deliberately never logged or returned. Endpoint validation keeps
 * a misconfigured environment from forwarding that header to an arbitrary
 * host, and the in-memory cache avoids a token request for every model call.
 *
 * Deliberately Deno-free: the caller supplies fetch and environment values so
 * Vitest exercises the exact module deployed in the Azure container.
 */

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface ManagedIdentityTokenInput {
  identityEndpoint: string;
  identityHeader: string;
  clientId: string;
  resource?: string;
  nowMs?: number;
}

interface CachedToken {
  key: string;
  token: string;
  expiresAtMs: number;
}

let cached: CachedToken | null = null;

export function resetAzureManagedIdentityTokenCache(): void {
  cached = null;
}

function safeIdentityEndpoint(value: string): URL | null {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const localHost =
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host === "[::1]" ||
      host === "169.254.169.254";
    if (!localHost || !["http:", "https:"].includes(url.protocol)) return null;
    if (url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

function expiresAtMs(value: unknown, nowMs: number): number {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    // Azure returns Unix seconds for expires_on. Be tolerant of milliseconds
    // in test doubles and future compatible endpoints.
    return numeric > 10_000_000_000 ? numeric : numeric * 1000;
  }
  return nowMs + 5 * 60_000;
}

export async function getAzureManagedIdentityAccessToken(
  fetchLike: FetchLike,
  input: ManagedIdentityTokenInput,
): Promise<string> {
  const endpoint = safeIdentityEndpoint(input.identityEndpoint);
  if (!endpoint || !input.identityHeader || !input.clientId) {
    throw new Error("azure_managed_identity_not_configured");
  }

  const nowMs = input.nowMs ?? Date.now();
  const resource = input.resource ?? "https://cognitiveservices.azure.com";
  const cacheKey = `${endpoint.origin}${endpoint.pathname}|${input.clientId}|${resource}`;
  if (
    cached &&
    cached.key === cacheKey &&
    cached.expiresAtMs - nowMs > 60_000
  ) {
    return cached.token;
  }

  endpoint.searchParams.set("api-version", "2019-08-01");
  endpoint.searchParams.set("resource", resource);
  endpoint.searchParams.set("client_id", input.clientId);
  const response = await fetchLike(endpoint.toString(), {
    method: "GET",
    headers: { "X-IDENTITY-HEADER": input.identityHeader },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`azure_managed_identity_token_failed_${response.status}`);
  }
  const payload = (await response.json()) as Record<string, unknown>;
  const token =
    typeof payload.access_token === "string" ? payload.access_token : "";
  if (!token) throw new Error("azure_managed_identity_token_missing");

  cached = {
    key: cacheKey,
    token,
    expiresAtMs: expiresAtMs(payload.expires_on, nowMs),
  };
  return token;
}
