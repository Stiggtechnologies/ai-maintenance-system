/** Server-only registry checks. Call after authenticated tenant source discovery.
 * No token, binding, host, or registry content is included in errors.
 */
export function resolveAdapterCredential(
  registryJson: string,
  binding: string,
  organizationId: string,
  host: string,
  type: "oauth_bearer" | "azure_service_principal",
): Record<string, unknown> {
  const invalid = () =>
    new Error(
      "Adapter credential binding is invalid for this tenant and host.",
    );
  let registry: unknown;
  try {
    registry = JSON.parse(registryJson);
  } catch {
    throw invalid();
  }
  if (
    !registry ||
    typeof registry !== "object" ||
    Array.isArray(registry) ||
    !Object.hasOwn(registry, binding)
  )
    throw invalid();
  const entry = (registry as Record<string, unknown>)[binding];
  if (!entry || typeof entry !== "object" || Array.isArray(entry))
    throw invalid();
  const value = entry as Record<string, unknown>;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      organizationId,
    ) ||
    !host ||
    host !== host.toLowerCase() ||
    !/^[a-z0-9.-]+$/.test(host) ||
    value.type !== type ||
    value.organization_id !== organizationId ||
    value.host !== host
  )
    throw invalid();
  return value;
}

/** Provisioned bearer only; refresh is an external identity-owner operation. */
export function resolveAdapterBearer(
  registryJson: string,
  binding: string,
  organizationId: string,
  host: string,
  now = Date.now(),
): string {
  const entry = resolveAdapterCredential(
    registryJson,
    binding,
    organizationId,
    host,
    "oauth_bearer",
  );
  const token = entry.access_token;
  const expiry = entry.expires_at;
  if (
    typeof token !== "string" ||
    token.length < 32 ||
    /\s/.test(token) ||
    typeof expiry !== "string" ||
    !/(?:Z|[+-]\d{2}:\d{2})$/.test(expiry) ||
    !Number.isFinite(Date.parse(expiry)) ||
    !Number.isFinite(now) ||
    Date.parse(expiry) <= now + 60_000
  ) {
    throw new Error(
      "Adapter bearer is invalid, expired, or too close to expiry.",
    );
  }
  return token;
}
