// Governed Oracle Primavera P6 EPPM schedule read for C2.16.
// The request chooses only an administrator-approved tenant connector. Both
// complete, project-filtered Oracle responses are fetched and hashed before a
// service-attested canonical run opens. This function issues GET only.
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  mapP6ScheduleSnapshot,
  P6_ACTIVITY_FIELDS,
  P6_RELATIONSHIP_FIELDS,
  p6ResourceUrl,
  type JsonRecord,
} from "../_shared/p6-schedule-read.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ALLOWED_ORIGIN =
  Deno.env.get("ALLOWED_ORIGIN") ?? "https://app.syncai.ca";
const ALLOWED_HOSTS = (Deno.env.get("P6_READ_ALLOWED_HOSTS") ?? "")
  .split(",")
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);
const CREDENTIALS_JSON = Deno.env.get("P6_READ_CREDENTIALS_JSON") ?? "{}";
const MAX_REQUEST_BYTES = 4 * 1024;
const MAX_RESPONSE_BYTES = 15 * 1024 * 1024;
const MAX_TOTAL_BYTES = 25 * 1024 * 1024;
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
  console.log(
    JSON.stringify({ fn: "p6-schedule-read-pull", event, ...detail }),
  );
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

// This is called only after Auth has verified the bearer through getUser().
// Reading the already-verified token's assurance claim preserves the human
// session context when the service-only ingest wrapper invokes canonical SQL;
// an absent or unfamiliar claim is conservatively treated as AAL1.
function verifiedSessionAal(authorization: string): "aal1" | "aal2" {
  const token = authorization.replace(/^Bearer\s+/i, "");
  const payload = token.split(".")[1];
  if (!payload) return "aal1";
  try {
    const normalized = payload.replaceAll("-", "+").replaceAll("_", "/");
    const decoded = JSON.parse(
      atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")),
    ) as { aal?: unknown };
    return decoded.aal === "aal2" ? "aal2" : "aal1";
  } catch {
    return "aal1";
  }
}

function baseUrl(value: string): URL {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  const privateIpv4 =
    /^(10|127|0)\.|^169\.254\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(
      host,
    );
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    url.search ||
    url.hash ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host === "::1" ||
    privateIpv4
  ) {
    throw new Error(
      "Configured P6 base URL is not a credential-free public HTTPS URL.",
    );
  }
  if (!ALLOWED_HOSTS.length || !ALLOWED_HOSTS.includes(host)) {
    throw new Error("Configured P6 host is not in the deployment allowlist.");
  }
  url.pathname = url.pathname.replace(/\/$/, "");
  return url;
}

function bearer(binding: string): string {
  let registry: Record<string, unknown>;
  try {
    registry = JSON.parse(CREDENTIALS_JSON) as Record<string, unknown>;
  } catch {
    throw new Error("P6 credential registry is not valid JSON.");
  }
  const entry = asRecord(registry[binding]);
  if (!entry || entry.type !== "oauth_bearer") {
    throw new Error(
      "P6 credential binding must name an oauth_bearer entry in the Edge secret registry.",
    );
  }
  const token =
    typeof entry.access_token === "string" ? entry.access_token : "";
  if (token.length < 32 || /[\r\n]/.test(token)) {
    throw new Error("Configured P6 OAuth bearer token is invalid.");
  }
  return token;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function boundedResponseBytes(
  response: Response,
  label: string,
): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    throw new Error(`P6 ${label} response exceeds the 15 MB limit.`);
  }
  if (!response.body) {
    throw new Error(`P6 ${label} response has no body.`);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error(`P6 ${label} response exceeds the 15 MB limit.`);
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

async function fetchRows(
  url: URL,
  token: string,
  deadline: number,
  label: string,
): Promise<{ rows: unknown[]; bytes: number; sha256: string }> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    throw new Error("P6 pull exceeded its total transport time limit.");
  }
  const response = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
    redirect: "error",
    signal: AbortSignal.timeout(Math.min(25_000, remaining)),
  });
  if (
    !response.ok ||
    !(response.headers.get("content-type") ?? "")
      .toLowerCase()
      .includes("application/json")
  ) {
    safeLog("oracle_response_refused", { label, status: response.status });
    throw new Error(
      `P6 ${label} read did not return successful application/json.`,
    );
  }
  const bytes = await boundedResponseBytes(response, label);
  let payload: unknown;
  try {
    payload = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
  } catch {
    throw new Error(`P6 ${label} response is not valid UTF-8 JSON.`);
  }
  if (!Array.isArray(payload)) {
    throw new Error(`P6 ${label} response must be a complete JSON array.`);
  }
  return {
    rows: payload,
    bytes: bytes.byteLength,
    sha256: await sha256Hex(bytes),
  };
}

async function rpc<T>(
  client: ReturnType<typeof createClient>,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(error.message);
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
  const actorAal = verifiedSessionAal(authorization);

  const declaredRequestBytes = Number(
    request.headers.get("content-length") ?? "0",
  );
  if (
    Number.isFinite(declaredRequestBytes) &&
    declaredRequestBytes > MAX_REQUEST_BYTES
  ) {
    return json({ error: "request_too_large" }, 413);
  }
  let body: { connector_key?: unknown; dry_run?: unknown };
  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_BYTES) {
      return json({ error: "request_too_large" }, 413);
    }
    body = JSON.parse(rawBody) as typeof body;
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const connectorKey =
    typeof body.connector_key === "string" ? body.connector_key.trim() : "";
  const dryRun = body.dry_run !== false;
  if (!connectorKey) return json({ error: "connector_key is required" }, 400);

  const serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  let runId: string | null = null;
  let organizationId: string | null = null;
  try {
    const source = await rpc<JsonRecord>(
      userClient,
      "get_p6_schedule_read_source",
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
      throw new Error("P6 source is not enabled and read-only.");
    }
    const root = baseUrl(String(source.base_url ?? ""));
    const binding = String(source.credential_binding_ref ?? "");
    const projectObjectId = Number(source.project_object_id ?? 0);
    const maxActivities = Number(source.max_activities ?? 0);
    const maxRelationships = Number(source.max_relationships ?? 0);
    const durationToHours = Number(source.duration_to_hours ?? 0);
    if (
      !organizationId ||
      !binding ||
      !Number.isSafeInteger(projectObjectId) ||
      projectObjectId <= 0 ||
      !Number.isSafeInteger(maxActivities) ||
      maxActivities < 1 ||
      maxActivities > 5000 ||
      !Number.isSafeInteger(maxRelationships) ||
      maxRelationships < 1 ||
      maxRelationships > 20000 ||
      !Number.isFinite(durationToHours) ||
      durationToHours <= 0
    ) {
      throw new Error("P6 source profile is invalid.");
    }

    const token = bearer(binding);
    const deadline = Date.now() + MAX_TRANSPORT_MS;
    const activitiesUrl = p6ResourceUrl(
      root,
      "activity",
      P6_ACTIVITY_FIELDS,
      `ProjectObjectId:eq:${projectObjectId}`,
    );
    const relationshipsUrl = p6ResourceUrl(
      root,
      "relationship",
      P6_RELATIONSHIP_FIELDS,
      `SuccessorProjectObjectId:eq:${projectObjectId}`,
    );
    const activities = await fetchRows(
      activitiesUrl,
      token,
      deadline,
      "activity",
    );
    const relationships = await fetchRows(
      relationshipsUrl,
      token,
      deadline,
      "relationship",
    );
    const totalBytes = activities.bytes + relationships.bytes;
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new Error("P6 project responses exceed the 25 MB total limit.");
    }
    if (activities.rows.length > maxActivities) {
      throw new Error("P6 activity response exceeds the approved row limit.");
    }
    if (relationships.rows.length > maxRelationships) {
      throw new Error(
        "P6 relationship response exceeds the approved row limit.",
      );
    }
    const rows = mapP6ScheduleSnapshot(activities.rows, relationships.rows, {
      projectObjectId,
      developmentCaseId: String(source.development_case_id ?? ""),
      scheduleName: String(source.schedule_name ?? ""),
      durationToHours,
      maxActivities,
      maxRelationships,
    });
    const fetchedAt = new Date().toISOString();
    const manifest = [
      {
        transport: "oracle_p6_eppm_rest",
        resource: "activity",
        project_object_id: projectObjectId,
        row_count: activities.rows.length,
        bytes: activities.bytes,
        sha256: activities.sha256,
      },
      {
        transport: "oracle_p6_eppm_rest",
        resource: "relationship",
        project_object_id: projectObjectId,
        row_count: relationships.rows.length,
        bytes: relationships.bytes,
        sha256: relationships.sha256,
      },
    ];
    const cursor = {
      fetched_at: fetchedAt,
      activity_sha256: activities.sha256,
      relationship_sha256: relationships.sha256,
    };
    if (dryRun) {
      safeLog("dry_run_complete", {
        connectorKey,
        projectObjectId,
        activities: rows.length,
        relationships: relationships.rows.length,
      });
      return json({
        dry_run: true,
        transport_complete: true,
        activities: rows.length,
        relationships: relationships.rows.length,
        bytes: totalBytes,
        cursor_to: cursor,
        note: "Both project-filtered Oracle responses were downloaded, validated, mapped and hashed. No run, staging, canonical schedule or watermark row was written.",
      });
    }

    const started = await rpc<{ run_id: string }>(
      serviceClient,
      "begin_p6_schedule_read_run",
      {
        p_organization_id: organizationId,
        p_triggered_by: userData.user.id,
        p_connector_key: connectorKey,
        p_manifest: manifest,
        p_cursor_to: cursor,
        p_source_bytes: totalBytes,
      },
    );
    runId = started.run_id;
    const totals = await rpc<{
      read: number;
      accepted: number;
      duplicate: number;
      rejected: number;
    }>(serviceClient, "ingest_p6_schedule_read_batch", {
      p_organization_id: organizationId,
      p_triggered_by: userData.user.id,
      p_run_id: runId,
      p_actor_aal: actorAal,
      p_rows: rows,
    });
    const status = totals.rejected ? "partial" : "success";
    const finished = await rpc<{ watermark_advanced: boolean }>(
      serviceClient,
      "finish_p6_schedule_read_run",
      {
        p_organization_id: organizationId,
        p_run_id: runId,
        p_status: status,
        p_error: null,
      },
    );
    safeLog("sync_complete", {
      connectorKey,
      projectObjectId,
      runId,
      status,
      read: totals.read,
      rejected: totals.rejected,
    });
    return json({
      dry_run: false,
      transport_complete: true,
      run_id: runId,
      status,
      watermark_advanced: finished.watermark_advanced,
      activities: rows.length,
      relationships: relationships.rows.length,
      bytes: totalBytes,
      ...totals,
      note: totals.duplicate
        ? "Changed or replayed P6 activities were retained as duplicate evidence. Review a pending schedule revision before any canonical update."
        : "The complete P6 project snapshot entered the canonical read-only schedule analysis path.",
    });
  } catch (error) {
    if (runId && organizationId) {
      try {
        await rpc(serviceClient, "finish_p6_schedule_read_run", {
          p_organization_id: organizationId,
          p_run_id: runId,
          p_status: "failed",
          p_error: "P6 adapter failed; inspect Edge Function logs.",
        });
      } catch {
        // Preserve the original error. The open run remains observable.
      }
    }
    safeLog("request_failed", { connectorKey, runId, error: String(error) });
    return json(
      { error: error instanceof Error ? error.message : "P6 pull failed." },
      422,
    );
  }
});
