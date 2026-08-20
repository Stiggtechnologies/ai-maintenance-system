const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function normalizeHttpUrl(value: string): URL | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url;
  } catch {
    return null;
  }
}

/**
 * Resolve the canonical browser app origin used by auth callbacks.
 *
 * Production must prefer the explicitly configured VITE_APP_URL. Runtime
 * origin is only a fallback for local development and ephemeral previews.
 */
export function resolveAuthAppOrigin(
  configuredAppUrl: string,
  runtimeOrigin: string,
): string {
  const configured = normalizeHttpUrl(configuredAppUrl);
  if (configured) return configured.origin;

  const runtime = normalizeHttpUrl(runtimeOrigin);
  if (runtime) return runtime.origin;

  throw new Error("No valid SyncAI application URL is configured for authentication callbacks.");
}

export function buildPasswordRecoveryRedirect(
  configuredAppUrl: string,
  runtimeOrigin: string,
): string {
  const origin = resolveAuthAppOrigin(configuredAppUrl, runtimeOrigin);
  return `${origin}/signin?mode=recovery`;
}

/**
 * A production bundle pointing auth callbacks at localhost is always a release
 * defect. Keep this as a reusable invariant for tests and deployment checks.
 */
export function isLocalAuthRedirect(url: string): boolean {
  const parsed = normalizeHttpUrl(url);
  return parsed ? LOCAL_HOSTS.has(parsed.hostname) : false;
}
