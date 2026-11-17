import { createHmac } from "node:crypto";
import type { Session } from "@supabase/supabase-js";

/** Test observations use actual database time, never a synthetic future offset. */
export function freshMeterTimestamp(
  databaseNow: string,
  latestRecordedAt: string | null,
): string {
  const observedAt = new Date(databaseNow).getTime();
  const previous =
    latestRecordedAt === null ? null : new Date(latestRecordedAt).getTime();
  if (
    !Number.isFinite(observedAt) ||
    (previous !== null &&
      (!Number.isFinite(previous) || observedAt <= previous))
  )
    throw new Error(
      "Actual local database observation time must be strictly after existing meters",
    );
  return new Date(observedAt).toISOString();
}

/** Pure test-only boundary; never permits remote disposable-fixture writes. */
export function requireLocalEndpoint(value: string, port: string): URL {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    url.port !== port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new Error(
      "Survival browser acceptance requires the disposable local stack",
    );
  }
  return url;
}

/**
 * Local HS256 assurance token. Every claim is an argument. Nothing here is
 * read from a password or from a password-login result.
 */
export function localAal2AccessToken(input: {
  signingKey: string;
  subject: string;
  email: string;
  sessionId: string;
  issuer: string;
}): { accessToken: string; expiresAt: number } {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 3600;
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  ).toString("base64url");
  const payload = {
    aud: "authenticated",
    exp: expiresAt,
    iat: now,
    iss: input.issuer,
    sub: input.subject,
    email: input.email,
    role: "authenticated",
    aal: "aal2",
    amr: [{ method: "totp", timestamp: now }],
    session_id: input.sessionId,
    is_anonymous: false,
  };
  const unsigned = `${header}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
  const signature = createHmac("sha256", input.signingKey)
    .update(unsigned)
    .digest("base64url");
  return { accessToken: `${unsigned}.${signature}`, expiresAt };
}

/** Synthetic local assurance only, for a caller-built session. Not used with password-login results. */
export function assuranceFixture(
  session: Session,
  signingKey: string,
): Session {
  const [, body] = session.access_token.split(".");
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  const issued = localAal2AccessToken({
    signingKey,
    subject: String(payload.sub ?? ""),
    email: String(payload.email ?? ""),
    sessionId: String(payload.session_id ?? ""),
    issuer: String(payload.iss ?? ""),
  });
  const issuedPayload = JSON.parse(
    Buffer.from(issued.accessToken.split(".")[1], "base64url").toString("utf8"),
  );
  // Retain the supplied identity claims. Only assurance fields change.
  const merged = {
    ...payload,
    aal: "aal2",
    iat: issuedPayload.iat,
    exp: issuedPayload.exp,
    amr: [
      ...(payload.amr ?? []),
      { method: "totp", timestamp: issuedPayload.iat },
    ],
  };
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  ).toString("base64url");
  const unsigned = `${header}.${Buffer.from(JSON.stringify(merged)).toString("base64url")}`;
  const signature = createHmac("sha256", signingKey)
    .update(unsigned)
    .digest("base64url");
  return {
    ...session,
    access_token: `${unsigned}.${signature}`,
    expires_at: merged.exp,
    expires_in: 3600,
  };
}
