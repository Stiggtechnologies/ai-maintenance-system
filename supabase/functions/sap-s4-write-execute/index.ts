// Human-approved SAP S/4HANA write execution.
//
// This function is intentionally absent from config/edge-function-boundary.json
// and from .github/workflows/deploy-migrations.yml. It is not deployed.
// Calls below use mocked tests only; this file does not contact a customer
// SAP tenant by being merged.
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  normalizeSapWriteExecuteRequest,
  runSapWriteExecution,
  type SapWriteCompletion,
} from "../_shared/sap-s4-write.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") ?? "https://app.syncai.ca";
const ALLOWED_HOSTS = (Deno.env.get("SAP_S4_WRITE_ALLOWED_HOSTS") ?? "")
  .split(",")
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);
const CREDENTIALS_JSON = Deno.env.get("SAP_S4_WRITE_CREDENTIALS_JSON") ?? "{}";
const MAX_REQUEST_BYTES = 4 * 1024;

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
  console.log(JSON.stringify({ fn: "sap-s4-write-execute", event, ...detail }));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function bearer(binding: string): string {
  let registry: Record<string, unknown>;
  try {
    registry = JSON.parse(CREDENTIALS_JSON) as Record<string, unknown>;
  } catch {
    throw new Error("SAP write credential registry is not valid JSON.");
  }
  const entry = asRecord(registry[binding]);
  if (!entry || entry.type !== "oauth_bearer") {
    throw new Error(
      "SAP write credential binding must name an oauth_bearer entry in the Edge secret registry.",
    );
  }
  const token = typeof entry.access_token === "string" ? entry.access_token : "";
  if (token.length < 32 || /[\r\n]/.test(token)) {
    throw new Error("Configured SAP OAuth bearer token is invalid.");
  }
  return token;
}

async function rpc(
  client: ReturnType<typeof createClient>,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { data, error } = await client.rpc(name, args);
  if (error) {
    safeLog("rpc_failed", { rpc: name });
    throw new Error("SAP write data operation failed.");
  }
  const payload = asRecord(data);
  if (!payload) throw new Error("SAP write data operation returned no object.");
  return payload;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
    return json({ error: "service_unavailable" }, 503);
  }
  const authorization = request.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);
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
  let requestId: string;
  try {
    ({ requestId } = normalizeSapWriteExecuteRequest(body));
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : "invalid_request" },
      400,
    );
  }

  const serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  const actorId = userData.user.id;
  try {
    const claimed = await rpc(serviceClient, "claim_sap_s4_write_execution", {
      p_actor: actorId,
      p_request_id: requestId,
    });
    let accessToken = "";
    if (claimed.call_sap === true) {
      try {
        accessToken = bearer(String(claimed.credential_binding_ref ?? ""));
      } catch (error) {
        await rpc(serviceClient, "complete_sap_s4_write_execution", {
          p_actor: actorId,
          p_request_id: requestId,
          p_http_status: null,
          p_error: error instanceof Error ? error.message : "sap_credential_invalid",
          p_succeeded: false,
        });
        return json({ error: "SAP write credential is not available.", sap_called: false }, 400);
      }
    }
    const result = await runSapWriteExecution({
      claim: async () => claimed,
      complete: async (completion: SapWriteCompletion) => {
        await rpc(serviceClient, "complete_sap_s4_write_execution", {
          p_actor: actorId,
          p_request_id: completion.requestId,
          p_http_status: completion.httpStatus,
          p_error: completion.error,
          p_succeeded: completion.succeeded,
        });
      },
      fetchImpl: fetch,
      accessToken,
      allowedHosts: ALLOWED_HOSTS,
    });
    safeLog(result.sapCalled ? "sap_write_finished" : "sap_write_not_called", {
      request_id: requestId,
      mutating_calls: result.mutatingCalls,
      http_status: result.httpStatus,
    });
    return json({
      ok: result.completion ? result.completion.succeeded : result.error == null,
      sap_called: result.sapCalled,
      mutating_calls: result.mutatingCalls,
      http_calls: result.httpCalls,
      idempotent_replay: result.idempotentReplay,
      http_status: result.httpStatus,
      payload_sha256: result.payloadSha256,
      error: result.error,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "SAP write execution failed.";
    safeLog("execution_failed", { request_id: requestId, reason: message.slice(0, 200) });
    return json({ error: message }, 400);
  }
});
