// Signed, read-only Azure IoT Operations relay ingress.
//
// The Azure Function relay consumes Event Hubs and sends normalized telemetry
// only. There is intentionally no command, write, OPC UA method or MQTT
// control surface in this function.

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  parseAzureIotIngressBindings,
  parseAzureIotIngressEnvelope,
  verifyAzureIotIngressSignature,
} from "../_shared/azure-iot-operations-ingress.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const BINDINGS_JSON =
  Deno.env.get("AZURE_IOT_OPERATIONS_INGRESS_KEYS_JSON") ?? "";
const MAX_BODY_BYTES = 1024 * 1024;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function safeLog(event: string, details: Record<string, unknown> = {}): void {
  console.log(
    JSON.stringify({ fn: "azure-iot-operations-ingest", event, ...details }),
  );
}

Deno.serve(async (request) => {
  if (request.method !== "POST")
    return json({ error: "method_not_allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !BINDINGS_JSON)
    return json({ error: "ingress_not_configured" }, 503);
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return json({ error: "body_too_large" }, 413);

  const keyId = request.headers.get("x-syncai-key-id")?.trim() ?? "";
  const timestamp = request.headers.get("x-syncai-timestamp")?.trim() ?? "";
  const signature = request.headers.get("x-syncai-signature")?.trim() ?? "";
  let bindings: ReturnType<typeof parseAzureIotIngressBindings>;
  try {
    bindings = parseAzureIotIngressBindings(BINDINGS_JSON);
  } catch (error) {
    console.error("Azure IoT ingress registry rejected", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return json({ error: "ingress_not_configured" }, 503);
  }
  const binding = bindings[keyId];
  if (!binding || !timestamp || !signature)
    return json({ error: "signed_ingress_required" }, 401);

  let body: string;
  try {
    body = await request.text();
  } catch {
    return json({ error: "body_unreadable" }, 400);
  }
  if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES)
    return json({ error: "body_too_large" }, 413);

  try {
    const verified = await verifyAzureIotIngressSignature({
      body,
      timestamp,
      signature,
      secret: binding.secret,
    });
    const envelope = parseAzureIotIngressEnvelope(body);
    const client = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client.rpc(
      "ingest_azure_iot_operations_batch",
      {
        p_organization_id: binding.organizationId,
        p_connector_key: binding.connectorKey,
        p_ingress_key_id: keyId,
        p_delivery_id: envelope.deliveryId,
        p_body_sha256: verified.bodySha256,
        p_received_at: verified.receivedAt,
        p_points: envelope.points,
      },
    );
    if (error) throw new Error(error.message);
    const result = data as Record<string, unknown> | null;
    if (typeof result?.error === "string") throw new Error(result.error);
    safeLog("delivery_recorded", {
      keyId,
      connectorKey: binding.connectorKey,
      deliveryId: envelope.deliveryId,
      points: envelope.points.length,
      runId: result?.run_id,
      status: result?.status,
      replayed: result?.replayed,
    });
    return json(result ?? { ok: true }, result?.replayed ? 200 : 202);
  } catch (error) {
    const message = error instanceof Error ? error.message : "ingress_failed";
    safeLog("delivery_refused", { keyId, error: message });
    const status = message.includes("signature") ? 401 : 422;
    return json({ error: message }, status);
  }
});
