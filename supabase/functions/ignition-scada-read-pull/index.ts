// Governed Ignition SCADA tag read. GET only, against one approved WebDev
// resource. See ../_shared/ignition-scada-read.ts for the Inductive Automation
// WebDev and system.tag.readBlocking citations. This function never sends a
// request that can write a tag.
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  mapIgnitionTagReads,
  normalizeIgnitionPullRequest,
  readIgnitionTagSnapshot,
  type JsonRecord,
} from "../_shared/ignition-scada-read.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ALLOWED_ORIGIN =
  Deno.env.get("ALLOWED_ORIGIN") ?? "https://app.syncai.ca";
const ALLOWED_HOSTS = (Deno.env.get("IGNITION_SCADA_READ_ALLOWED_HOSTS") ?? "")
  .split(",")
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);
const CREDENTIALS_JSON =
  Deno.env.get("IGNITION_SCADA_READ_CREDENTIALS_JSON") ?? "{}";
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
  console.log(
    JSON.stringify({ fn: "ignition-scada-read-pull", event, ...detail }),
  );
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function authorizationHeader(binding: string): string {
  let registry: Record<string, unknown>;
  try {
    registry = JSON.parse(CREDENTIALS_JSON) as Record<string, unknown>;
  } catch {
    throw new Error("Ignition credential registry is not valid JSON.");
  }
  const entry = asRecord(registry[binding]);
  if (!entry) {
    throw new Error(
      "Ignition credential binding must name an entry in the Edge secret registry.",
    );
  }
  if (entry.type === "http_basic") {
    const username = typeof entry.username === "string" ? entry.username : "";
    const password = typeof entry.password === "string" ? entry.password : "";
    if (
      username.length < 1 ||
      username.length > 128 ||
      password.length < 8 ||
      password.length > 512 ||
      username.includes(":") ||
      /[^\x21-\x7e]/.test(username) ||
      /[^\x21-\x7e]/.test(password)
    ) {
      throw new Error("Configured Ignition HTTP basic credential is invalid.");
    }
    return `Basic ${btoa(`${username}:${password}`)}`;
  }
  if (entry.type === "bearer") {
    const token =
      typeof entry.access_token === "string" ? entry.access_token : "";
    if (token.length < 16 || token.length > 4096 || /[\r\n]/.test(token)) {
      throw new Error("Configured Ignition bearer token is invalid.");
    }
    return `Bearer ${token}`;
  }
  throw new Error(
    "Ignition credential binding must be http_basic or bearer in the Edge secret registry.",
  );
}

function tagPaths(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string")
  ) {
    throw new Error("Ignition source tag list is invalid.");
  }
  return value as string[];
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
    throw new Error("Ignition data operation failed.");
  }
  const payload = data as { error?: string } | null;
  if (payload?.error) throw new Error(payload.error);
  return data as T;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS")
    return new Response("ok", { headers: cors });
  if (request.method !== "POST")
    return json({ error: "method_not_allowed" }, 405);
  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
    return json({ error: "service_unavailable" }, 503);
  }
  const authorization = request.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer "))
    return json({ error: "unauthorized" }, 401);
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
    ({ connectorKey, dryRun } = normalizeIgnitionPullRequest(body));
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
    const source = await rpc<JsonRecord>(
      userClient,
      "get_ignition_scada_source",
      {
        p_connector_key: connectorKey,
      },
    );
    organizationId = String(source.organization_id ?? "");
    if (
      !source.enabled ||
      source.direction !== "read_only" ||
      source.write_enabled
    ) {
      throw new Error("Ignition source is not enabled and read-only.");
    }
    const resource = String(source.resource_url ?? "");
    let host = "";
    try {
      host = new URL(resource).hostname.toLowerCase();
    } catch {
      throw new Error("Configured Ignition resource URL is invalid.");
    }
    if (!ALLOWED_HOSTS.length || !ALLOWED_HOSTS.includes(host)) {
      throw new Error(
        "Configured Ignition host is not in the deployment allowlist.",
      );
    }
    const header = authorizationHeader(
      String(source.credential_binding_ref ?? ""),
    );
    const snapshot = await readIgnitionTagSnapshot({
      resource,
      tagPaths: tagPaths(source.tag_paths),
      authorization: header,
      direction: "read_only",
      writeEnabled: false,
      allowLoopback: false,
    });
    const mapped = mapIgnitionTagReads(
      snapshot.readings,
      tagPaths(source.tag_paths),
    );
    const tags = snapshot.readings.map((reading) => ({
      path: reading.path,
      value: reading.value,
      quality: reading.quality,
      timestamp: reading.timestamp,
    }));
    if (dryRun) {
      return json({
        ok: true,
        dry_run: true,
        raw_rows: snapshot.readings.length,
        mapped_rows: mapped.length,
        pages: snapshot.manifest.length,
        bytes: snapshot.totalBytes,
        tags,
        note: "No run, staging or watermark row was written.",
      });
    }
    const cursor = {
      fetched_at: snapshot.fetchedAt,
      raw_rows: snapshot.readings.length,
      mapped_rows: mapped.length,
      pages: snapshot.manifest.length,
    };
    const begun = await rpc<{ run_id: string }>(
      serviceClient,
      "begin_ignition_scada_read_run",
      {
        p_organization_id: organizationId,
        p_triggered_by: userData.user.id,
        p_connector_key: connectorKey,
        p_manifest: snapshot.manifest,
        p_cursor_to: cursor,
        p_source_bytes: snapshot.totalBytes,
      },
    );
    runId = begun.run_id;
    const ingested = await rpc<Record<string, number>>(
      serviceClient,
      "ingest_ignition_scada_read_batch",
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
      "finish_ignition_scada_read_run",
      {
        p_organization_id: organizationId,
        p_run_id: runId,
        p_status: status,
        p_error:
          rejected > 0
            ? `${rejected} Ignition tags were refused; inspect retained staging evidence.`
            : null,
      },
    );
    safeLog("pull_finished", {
      organization_id: organizationId,
      run_id: runId,
      status,
      raw_rows: snapshot.readings.length,
    });
    return json({
      ...finished,
      raw_rows: snapshot.readings.length,
      mapped_rows: mapped.length,
      pages: snapshot.manifest.length,
      bytes: snapshot.totalBytes,
      tags,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Ignition tag read failed.";
    safeLog("pull_failed", {
      organization_id: organizationId,
      run_id: runId,
      reason: message.slice(0, 200),
    });
    if (runId && organizationId) {
      try {
        await rpc(serviceClient, "finish_ignition_scada_read_run", {
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
