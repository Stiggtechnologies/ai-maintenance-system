// Governed OPC-UA read for C2.20.
//
// Supabase Edge Functions run on Deno. Their supported outbound API is fetch.
// OPC UA Binary needs a TCP session to opc.tcp, which this runtime does not
// provide, and node-opcua's net/tls client is not a Deno edge dependency.
// This function therefore never opens a socket. It resolves the secret-registry
// credential and POSTs one read-only envelope to the allowlisted HTTPS gateway
// at /v1/read. The gateway (services/opc-ua-read-gateway) is the OPC UA client.
// Write and Call are not representable in the envelope.
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  buildOpcUaReadGatewayCall,
  mapOpcUaReadings,
  normalizeOpcUaPullRequest,
  resolveOpcUaCredential,
  type JsonRecord,
  type OpcUaAuthMode,
  type OpcUaSecurityMode,
  type OpcUaSecurityPolicy,
} from "../_shared/opc-ua-read.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ALLOWED_ORIGIN =
  Deno.env.get("ALLOWED_ORIGIN") ?? "https://app.syncai.ca";
const GATEWAY_URL = Deno.env.get("OPC_UA_READ_GATEWAY_URL") ?? "";
const GATEWAY_HOSTS = (Deno.env.get("OPC_UA_READ_GATEWAY_ALLOWED_HOSTS") ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const SERVER_HOSTS = (Deno.env.get("OPC_UA_READ_SERVER_ALLOWED_HOSTS") ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const CREDENTIALS_JSON = Deno.env.get("OPC_UA_READ_CREDENTIALS_JSON") ?? "{}";
const GATEWAY_TOKEN = Deno.env.get("OPC_UA_READ_GATEWAY_TOKEN") ?? "";
const MAX_REQUEST_BYTES = 4 * 1024;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_TRANSPORT_MS = 55_000;

const cors = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  Vary: "Origin",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function safeLog(event: string, detail: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ fn: "opc-ua-read-pull", event, ...detail }));
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function boundedBytes(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error("OPC-UA gateway response exceeds its byte limit.");
  }
  if (!response.body) throw new Error("OPC-UA gateway response has no body.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("OPC-UA gateway response exceeds its byte limit.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function rpc<T>(
  client: ReturnType<typeof createClient>,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await client.rpc(name, args);
  if (error) {
    safeLog("rpc_failed", {
      rpc: name,
      code: typeof error.code === "string" ? error.code : "unknown",
    });
    throw new Error("OPC-UA data operation failed.");
  }
  const payload = data as { error?: string } | null;
  if (payload?.error) throw new Error(payload.error);
  return data as T;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }
  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
    return json({ error: "service_unavailable" }, 503);
  }
  const authorization = request.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) {
    return json({ error: "unauthorized" }, 401);
  }
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return json({ error: "unauthorized" }, 401);

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) {
    return json({ error: "request_too_large" }, 413);
  }
  let body: unknown;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BYTES) {
      return json({ error: "request_too_large" }, 413);
    }
    body = JSON.parse(raw);
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  let connectorKey: string;
  let dryRun: boolean;
  try {
    ({ connectorKey, dryRun } = normalizeOpcUaPullRequest(body));
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : "invalid_request" },
      400,
    );
  }

  const serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  let runId: string | null = null;
  let organizationId: string | null = null;
  try {
    const source = await rpc<JsonRecord>(userClient, "get_opc_ua_read_source", {
      p_connector_key: connectorKey,
    });
    organizationId = String(source.organization_id ?? "");
    if (
      !source.enabled ||
      source.direction !== "read_only" ||
      source.write_enabled
    ) {
      throw new Error("OPC-UA source is not enabled and read-only.");
    }
    const nodeIds = source.node_ids;
    if (!Array.isArray(nodeIds)) {
      throw new Error("OPC-UA source node list is invalid.");
    }
    const identity = resolveOpcUaCredential(
      CREDENTIALS_JSON,
      String(source.credential_binding_ref ?? ""),
      String(source.auth_mode ?? "") as OpcUaAuthMode,
    );
    const call = buildOpcUaReadGatewayCall({
      gatewayUrl: GATEWAY_URL,
      allowedGatewayHosts: GATEWAY_HOSTS,
      endpointUrl: String(source.endpoint_url ?? ""),
      allowedServerHosts: SERVER_HOSTS,
      securityMode: String(source.security_mode ?? "") as OpcUaSecurityMode,
      securityPolicy: String(
        source.security_policy ?? "",
      ) as OpcUaSecurityPolicy,
      userIdentity: identity,
      nodeIds: nodeIds.map((nodeId) => String(nodeId)),
      timeoutMs: 10_000,
    });
    if (
      !GATEWAY_TOKEN ||
      GATEWAY_TOKEN.length < 32 ||
      /[\r\n]/.test(GATEWAY_TOKEN)
    ) {
      throw new Error("OPC-UA gateway token is not configured.");
    }
    const deadline = Date.now() + MAX_TRANSPORT_MS;
    const response = await fetch(call.url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${GATEWAY_TOKEN}`,
      },
      body: JSON.stringify(call.body),
      redirect: "error",
      signal: AbortSignal.timeout(Math.min(20_000, deadline - Date.now())),
    });
    if (
      !response.ok ||
      !(response.headers.get("content-type") ?? "")
        .toLowerCase()
        .includes("application/json")
    ) {
      safeLog("gateway_response_refused", { status: response.status });
      throw new Error(
        "OPC-UA gateway read did not return successful application/json.",
      );
    }
    const bytes = await boundedBytes(response, MAX_RESPONSE_BYTES);
    let payload: unknown;
    try {
      payload = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );
    } catch {
      throw new Error("OPC-UA gateway response is not valid UTF-8 JSON.");
    }
    const fetchedAt = new Date().toISOString();
    const mapped = mapOpcUaReadings(payload, {
      nodeIds: call.body.nodeIds,
      maxNodes: 50,
    }).map((reading) => ({
      node_id: reading.nodeId,
      value: reading.value,
      status_code: reading.statusCode,
      source_timestamp: reading.sourceTimestamp,
    }));
    if (Date.now() > deadline) {
      throw new Error("OPC-UA read exceeded its time limit.");
    }
    const manifest = [
      {
        transport: "opc_ua_binary_read",
        resource: "Read",
        page: 1,
        security_mode: call.body.securityMode,
        security_policy: call.body.securityPolicy,
        sha256: await sha256Hex(bytes),
        bytes: bytes.byteLength,
        row_count: mapped.length,
      },
    ];
    const cursor = {
      fetched_at: fetchedAt,
      raw_rows: mapped.length,
      mapped_rows: mapped.length,
      pages: 1,
    };
    if (dryRun) {
      return json({
        ok: true,
        dry_run: true,
        readings: mapped,
        raw_rows: mapped.length,
        mapped_rows: mapped.length,
        bytes: bytes.byteLength,
        note: "No run, staging or watermark row was written.",
      });
    }
    const begun = await rpc<{ run_id: string }>(
      serviceClient,
      "begin_opc_ua_read_run",
      {
        p_organization_id: organizationId,
        p_triggered_by: userData.user.id,
        p_connector_key: connectorKey,
        p_manifest: manifest,
        p_cursor_to: cursor,
        p_source_bytes: bytes.byteLength,
      },
    );
    runId = begun.run_id;
    const ingested = await rpc<Record<string, number>>(
      serviceClient,
      "ingest_opc_ua_read_batch",
      {
        p_organization_id: organizationId,
        p_triggered_by: userData.user.id,
        p_run_id: runId,
        p_rows: mapped,
      },
    );
    const rejected = Number(ingested.rejected ?? 0);
    const status = rejected > 0 ? "partial" : "success";
    const finished = await rpc<JsonRecord>(
      serviceClient,
      "finish_opc_ua_read_run",
      {
        p_organization_id: organizationId,
        p_run_id: runId,
        p_status: status,
        p_error:
          rejected > 0
            ? `${rejected} OPC-UA readings were refused; inspect retained staging evidence.`
            : null,
      },
    );
    safeLog("pull_finished", {
      organization_id: organizationId,
      run_id: runId,
      status,
      mapped_rows: mapped.length,
    });
    return json({
      ...finished,
      readings: mapped,
      raw_rows: mapped.length,
      mapped_rows: mapped.length,
      bytes: bytes.byteLength,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "OPC-UA read failed.";
    safeLog("pull_failed", {
      organization_id: organizationId,
      run_id: runId,
      reason: message.slice(0, 200),
    });
    if (runId && organizationId) {
      try {
        await rpc(serviceClient, "finish_opc_ua_read_run", {
          p_organization_id: organizationId,
          p_run_id: runId,
          p_status: "failed",
          p_error: message,
        });
      } catch (finishError) {
        safeLog("failed_run_close_error", {
          run_id: runId,
          reason:
            finishError instanceof Error
              ? finishError.message.slice(0, 160)
              : "unknown",
        });
      }
    }
    return json({ error: message }, 400);
  }
});
