import { describe, expect, it } from "vitest";
import {
  buildEdgeSignatureMessage,
  decodeBase64Url,
  isPublicEd25519Jwk,
  sha256Hex,
  signedAtWithinWindow,
  verifyEdgeSignature,
} from "./auth";

function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

describe("edge evidence signature contract", () => {
  it("binds the exact payload digest and sequence to an Ed25519 signature", async () => {
    const keys = await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
      "sign",
      "verify",
    ]);
    const publicJwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
    const body = new TextEncoder().encode('{"observationId":"obs-0001"}');
    const digest = await sha256Hex(body);
    const fields = {
      nodeId: "09b1f6e1-99b3-46f7-bb23-48b2aa4a6399",
      keyId: "field-key-2026-01",
      sequence: 41,
      signedAt: "2026-09-29T12:00:00.000Z",
    };
    const message = buildEdgeSignatureMessage(fields, digest);
    const signature = new Uint8Array(
      await crypto.subtle.sign({ name: "Ed25519" }, keys.privateKey, message),
    );

    expect(isPublicEd25519Jwk(publicJwk)).toBe(true);
    expect(
      await verifyEdgeSignature(publicJwk, message, base64Url(signature)),
    ).toBe(true);
    expect(
      await verifyEdgeSignature(
        publicJwk,
        buildEdgeSignatureMessage({ ...fields, sequence: 42 }, digest),
        base64Url(signature),
      ),
    ).toBe(false);
    expect(
      await verifyEdgeSignature(
        publicJwk,
        buildEdgeSignatureMessage(
          fields,
          await sha256Hex(new TextEncoder().encode("tampered")),
        ),
        base64Url(signature),
      ),
    ).toBe(false);
  });

  it("rejects private JWK material, malformed base64url and stale signatures", () => {
    expect(
      isPublicEd25519Jwk({
        kty: "OKP",
        crv: "Ed25519",
        x: "A".repeat(43),
        d: "private-material-must-never-arrive",
      }),
    ).toBe(false);
    expect(
      isPublicEd25519Jwk({
        kty: "OKP",
        crv: "Ed25519",
        x: "+".repeat(43),
      }),
    ).toBe(false);
    expect(() => decodeBase64Url("not+base64url")).toThrow(/base64url/);
    expect(
      signedAtWithinWindow(
        "2026-09-29T12:00:00.000Z",
        Date.parse("2026-09-29T12:04:59.000Z"),
      ),
    ).toBe(true);
    expect(
      signedAtWithinWindow(
        "2026-09-29T12:00:00.000Z",
        Date.parse("2026-09-29T12:05:01.000Z"),
      ),
    ).toBe(false);
  });
});
