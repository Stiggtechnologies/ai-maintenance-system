#!/usr/bin/env node
import {
  createHash,
  createPrivateKey,
  generateKeyPairSync,
  sign,
} from "node:crypto";

const context = "syncai-edge-evidence-v1";
const command = process.argv[2];

if (command === "generate") {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  process.stdout.write(
    JSON.stringify({
      publicJwk: publicKey.export({ format: "jwk" }),
      privateJwk: privateKey.export({ format: "jwk" }),
    }),
  );
  process.exit(0);
}

if (command === "sign") {
  const rawBody = process.env.EDGE_BODY;
  const privateJwkJson = process.env.EDGE_PRIVATE_JWK;
  if (!rawBody || !privateJwkJson) {
    throw new Error("EDGE_BODY and EDGE_PRIVATE_JWK are required");
  }
  const envelope = JSON.parse(rawBody);
  const privateKey = createPrivateKey({
    key: JSON.parse(privateJwkJson),
    format: "jwk",
  });
  const digest = createHash("sha256").update(rawBody, "utf8").digest("hex");
  const message = [
    context,
    envelope.nodeId,
    envelope.keyId,
    String(envelope.sequence),
    envelope.signedAt,
    digest,
  ].join("\n");
  process.stdout.write(
    sign(null, Buffer.from(message), privateKey).toString("base64url"),
  );
  process.exit(0);
}

throw new Error("usage: edge-evidence-crypto.mjs generate|sign");
