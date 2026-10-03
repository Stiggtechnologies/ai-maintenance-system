export const EDGE_SIGNATURE_CONTEXT = "syncai-edge-evidence-v1";
export const EDGE_SIGNATURE_MAX_SKEW_MS = 5 * 60 * 1000;

export interface EdgeSignatureFields {
  nodeId: string;
  keyId: string;
  sequence: number;
  signedAt: string;
}

const encoder = new TextEncoder();

export function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(body: Uint8Array): Promise<string> {
  return bytesToHex(
    new Uint8Array(await crypto.subtle.digest("SHA-256", body)),
  );
}

export function buildEdgeSignatureMessage(
  fields: EdgeSignatureFields,
  payloadSha256: string,
): Uint8Array {
  return encoder.encode(
    [
      EDGE_SIGNATURE_CONTEXT,
      fields.nodeId,
      fields.keyId,
      String(fields.sequence),
      fields.signedAt,
      payloadSha256,
    ].join("\n"),
  );
}

export function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("signature is not base64url");
  }
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

export function signedAtWithinWindow(
  signedAt: string,
  nowMs = Date.now(),
  maxSkewMs = EDGE_SIGNATURE_MAX_SKEW_MS,
): boolean {
  const signedAtMs = Date.parse(signedAt);
  return (
    Number.isFinite(signedAtMs) && Math.abs(nowMs - signedAtMs) <= maxSkewMs
  );
}

export function isPublicEd25519Jwk(value: unknown): value is JsonWebKey {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const jwk = value as Record<string, unknown>;
  return (
    jwk.kty === "OKP" &&
    jwk.crv === "Ed25519" &&
    typeof jwk.x === "string" &&
    /^[A-Za-z0-9_-]{43}$/.test(jwk.x) &&
    !("d" in jwk)
  );
}

export async function verifyEdgeSignature(
  publicJwk: JsonWebKey,
  message: Uint8Array,
  signatureBase64Url: string,
): Promise<boolean> {
  if (!isPublicEd25519Jwk(publicJwk)) return false;
  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      publicJwk,
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify(
      { name: "Ed25519" },
      key,
      decodeBase64Url(signatureBase64Url),
      message,
    );
  } catch {
    return false;
  }
}
