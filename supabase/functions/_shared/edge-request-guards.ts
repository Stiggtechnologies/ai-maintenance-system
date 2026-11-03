/**
 * Shared request guards for edge functions that previously trusted any
 * Authorization header, any Stripe-Signature header, or any file URL.
 *
 * Membership is the caller's user_profiles row (organization_id), the same
 * source the governed functions already use. Stripe signatures follow the v1
 * scheme constructEventAsync checks: HMAC-SHA256 of `${timestamp}.${payload}`
 * with the webhook secret. This module does not import the Stripe SDK.
 */

export type Caller = {
  userId: string;
  organizationId: string;
  role: string;
  email: string | null;
};

export type CallerResult =
  | { ok: true; caller: Caller }
  | { ok: false; response: Response };

type ProfileRow = {
  organization_id?: string | null;
  role?: string | null;
  email?: string | null;
};

export type CallerClient = {
  auth: {
    getUser: (jwt: string) => Promise<{
      data: { user: { id: string; email?: string | null } | null };
      error: { message: string } | null;
    }>;
  };
  from: (table: string) => {
    select: (columns: string) => {
      eq: (
        column: string,
        value: string,
      ) => {
        maybeSingle: () => PromiseLike<{
          data: ProfileRow | null;
          error: { message: string } | null;
        }>;
      };
    };
  };
};

function authJson(
  body: unknown,
  status: number,
  cors: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

export async function requireCaller(
  req: Request,
  supabase: CallerClient,
  cors: Record<string, string>,
): Promise<CallerResult> {
  const header = req.headers.get("Authorization") ?? "";
  const token = header.startsWith("Bearer ")
    ? header.slice("Bearer ".length).trim()
    : "";
  if (!token) {
    return {
      ok: false,
      response: authJson({ error: "Missing authorization header" }, 401, cors),
    };
  }

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user?.id) {
    return {
      ok: false,
      response: authJson({ error: "Invalid authorization token" }, 401, cors),
    };
  }

  const { data: profile, error: profileError } = await supabase
    .from("user_profiles")
    .select("organization_id, role, email")
    .eq("id", data.user.id)
    .maybeSingle();
  if (profileError || !profile?.organization_id) {
    return {
      ok: false,
      response: authJson(
        { error: "organization_membership_required" },
        403,
        cors,
      ),
    };
  }

  return {
    ok: true,
    caller: {
      userId: data.user.id,
      organizationId: profile.organization_id,
      role: String(profile.role ?? "user"),
      email: profile.email ?? data.user.email ?? null,
    },
  };
}

/** A body tenant that names someone else is refused. A missing tenant is not. */
export function tenantForbidden(
  requested: unknown,
  organizationId: string,
): boolean {
  return (
    typeof requested === "string" &&
    requested.length > 0 &&
    requested !== organizationId
  );
}

/**
 * Path after the function name, for both `/fn/route` and `/functions/v1/fn/route`.
 */
export function functionRoutePath(
  pathname: string,
  functionName: string,
): string {
  const marker = `/${functionName}`;
  const index = pathname.lastIndexOf(marker);
  if (index < 0) return pathname;
  const rest = pathname.slice(index + marker.length);
  if (rest === "" || rest === "/") return "/";
  return rest.startsWith("/") ? rest : `/${rest}`;
}

export function timingSafeEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  const length = Math.max(a.length, b.length);
  let mismatch = a.length === b.length ? 0 : 1;
  for (let i = 0; i < length; i += 1) {
    mismatch |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return mismatch === 0;
}

export async function hmacSha256Hex(
  secret: string,
  payload: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  return [...new Uint8Array(mac)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function verifyStripeSignature(
  payload: string,
  header: string,
  secret: string,
  toleranceSeconds = 300,
  nowSeconds = Date.now() / 1000,
): Promise<boolean> {
  if (!header || !secret) return false;
  let timestamp = "";
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key === "t") timestamp = value;
    if (key === "v1" && value) signatures.push(value);
  }
  if (!timestamp || signatures.length === 0) return false;
  const issued = Number(timestamp);
  if (!Number.isFinite(issued)) return false;
  if (
    toleranceSeconds >= 0 &&
    Math.abs(nowSeconds - issued) > toleranceSeconds
  ) {
    return false;
  }
  const expected = await hmacSha256Hex(secret, `${timestamp}.${payload}`);
  return signatures.some((signature) => timingSafeEqual(signature, expected));
}

const BLOCKED_HOSTS = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.google.com",
]);

function ipv4Parts(host: string): number[] | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return null;
  const parts = match.slice(1).map((part) => Number(part));
  if (parts.some((part) => part > 255)) return null;
  return parts;
}

/**
 * https only. When `allowlist` is set, the host must be on it. Private,
 * link-local, loopback, and metadata hosts are never fetched.
 */
export function fileUrlAllowed(
  fileUrl: string,
  allowlist: string | undefined,
): boolean {
  let url: URL;
  try {
    url = new URL(fileUrl);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    !host ||
    BLOCKED_HOSTS.has(host) ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    return false;
  }
  const ipv4 = ipv4Parts(host);
  if (ipv4) {
    const a = ipv4[0] ?? 0;
    const b = ipv4[1] ?? 0;
    const blocked =
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127);
    if (blocked) return false;
  }
  if (
    host === "::1" ||
    host.startsWith("fe80:") ||
    host.startsWith("fc") ||
    host.startsWith("fd")
  ) {
    return false;
  }
  const allowed = (allowlist ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  if (allowed.length > 0 && !allowed.includes(host)) return false;
  return true;
}
