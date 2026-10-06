import { createHmac } from "node:crypto";
import type { Session } from "@supabase/supabase-js";

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

/** Synthetic local assurance only, retaining the actual GoTrue session identity. */
export function assuranceFixture(
  session: Session,
  signingKey: string,
): Session {
  const [, body] = session.access_token.split(".");
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  // The local legacy secret signs HMAC, regardless of the original JWT's
  // asymmetric algorithm/key ID. Never copy that header onto an HMAC signature.
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  ).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  payload.aal = "aal2";
  payload.iat = now;
  payload.exp = now + 3600;
  payload.amr = [...(payload.amr ?? []), { method: "totp", timestamp: now }];
  const unsigned = `${header}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
  const signature = createHmac("sha256", signingKey)
    .update(unsigned)
    .digest("base64url");
  return {
    ...session,
    access_token: `${unsigned}.${signature}`,
    expires_at: payload.exp,
    expires_in: 3600,
  };
}
