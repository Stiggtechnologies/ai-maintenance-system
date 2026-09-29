import { createClient } from "npm:@supabase/supabase-js@2";
import {
  buildEdgeSignatureMessage,
  isPublicEd25519Jwk,
  sha256Hex,
  signedAtWithinWindow,
  verifyEdgeSignature,
} from "./auth.ts";
import { EdgeBodyTooLargeError, readBoundedBody } from "./body.ts";

const MAX_BODY_BYTES = 256 * 1024;
const responseHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

interface EdgeEvidenceRequest {
  nodeId: string;
  keyId: string;
  sequence: number;
  signedAt: string;
  observationId: string;
  capturedAt: string;
  assetId: string;
  sensorId?: string | null;
  modelRegisterId: number;
  confidence: number;
  observation: Record<string, unknown>;
}

interface EdgeNodeCredential {
  id: string;
  status: string;
  current_key_id: string;
  current_public_key_jwk: JsonWebKey;
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders,
  });
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function parseRequest(value: unknown): EdgeEvidenceRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (
    !isUuid(body.nodeId) ||
    typeof body.keyId !== "string" ||
    body.keyId.length < 8 ||
    !Number.isSafeInteger(body.sequence) ||
    Number(body.sequence) <= 0 ||
    typeof body.signedAt !== "string" ||
    typeof body.observationId !== "string" ||
    body.observationId.trim().length < 8 ||
    typeof body.capturedAt !== "string" ||
    !Number.isFinite(Date.parse(body.capturedAt)) ||
    !isUuid(body.assetId) ||
    (body.sensorId != null && !isUuid(body.sensorId)) ||
    !Number.isSafeInteger(body.modelRegisterId) ||
    Number(body.modelRegisterId) <= 0 ||
    typeof body.confidence !== "number" ||
    !Number.isFinite(body.confidence) ||
    body.confidence < 0 ||
    body.confidence > 1 ||
    !body.observation ||
    typeof body.observation !== "object" ||
    Array.isArray(body.observation)
  ) {
    return null;
  }
  return body as unknown as EdgeEvidenceRequest;
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return json(405, { error: "POST required" });
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return json(413, { error: "request body exceeds 256 KiB" });
  }
  const signature = request.headers.get("x-syncai-edge-signature");
  if (!signature) return json(401, { error: "device authentication failed" });

  let rawBody: Uint8Array;
  try {
    rawBody = await readBoundedBody(request, MAX_BODY_BYTES);
  } catch (error) {
    if (error instanceof EdgeBodyTooLargeError) {
      return json(413, { error: "request body exceeds 256 KiB" });
    }
    console.error("edge evidence request body could not be read");
    return json(400, { error: "request body could not be read" });
  }
  if (rawBody.byteLength === 0) {
    return json(400, { error: "request body must contain JSON" });
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(new TextDecoder().decode(rawBody));
  } catch {
    return json(400, { error: "request body must be valid JSON" });
  }
  const body = parseRequest(parsedJson);
  if (!body) return json(400, { error: "edge evidence envelope is invalid" });
  if (!signedAtWithinWindow(body.signedAt)) {
    return json(401, { error: "device authentication failed" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error(
      "edge-evidence-ingest is missing required server configuration",
    );
    return json(503, { error: "edge evidence service unavailable" });
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: nodeData, error: nodeError } = await supabase
    .from("edge_nodes")
    .select("id,status,current_key_id,current_public_key_jwk")
    .eq("id", body.nodeId)
    .maybeSingle();
  const node = nodeData as EdgeNodeCredential | null;
  if (
    nodeError ||
    !node ||
    node.status !== "active" ||
    node.current_key_id !== body.keyId ||
    !isPublicEd25519Jwk(node.current_public_key_jwk)
  ) {
    return json(401, { error: "device authentication failed" });
  }

  const payloadSha256 = await sha256Hex(rawBody);
  const signatureMessage = buildEdgeSignatureMessage(
    {
      nodeId: body.nodeId,
      keyId: body.keyId,
      sequence: body.sequence,
      signedAt: body.signedAt,
    },
    payloadSha256,
  );
  if (
    !(await verifyEdgeSignature(
      node.current_public_key_jwk,
      signatureMessage,
      signature,
    ))
  ) {
    return json(401, { error: "device authentication failed" });
  }

  const { data, error } = await supabase.rpc("ingest_verified_edge_evidence", {
    p_edge_node_id: body.nodeId,
    p_key_id: body.keyId,
    p_sequence: body.sequence,
    p_observation_id: body.observationId.trim(),
    p_captured_at: body.capturedAt,
    p_asset_id: body.assetId,
    p_sensor_id: body.sensorId ?? null,
    p_model_register_id: body.modelRegisterId,
    p_confidence: body.confidence,
    p_payload_sha256: payloadSha256,
    p_observation: body.observation,
  });
  if (error) {
    console.error("edge evidence persistence failed", {
      code: error.code,
      nodeId: body.nodeId,
      observationId: body.observationId,
    });
    return json(500, { error: "edge evidence could not be recorded" });
  }
  if (data?.error) {
    const replay = /replay|already recorded|sequence/i.test(String(data.error));
    return json(replay ? 409 : 422, { error: String(data.error) });
  }
  return json(201, data as Record<string, unknown>);
});
