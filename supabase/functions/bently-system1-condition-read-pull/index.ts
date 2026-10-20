// Governed Bently Nevada System 1 condition-data read for C2.19.
//
// System 1 remains at the customer boundary. A customer-operated gateway reads
// its OPC UA export and exposes the narrow /syncai/v1/system1/readings contract.
// This adapter performs bounded HTTPS GETs only, maps exact approved node/unit
// bindings to canonical sensors and promotes through the existing condition
// reading writer. It has no OPC write, alarm acknowledgement or control path.
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  mapSystem1Readings,
  readSystem1GatewayPage,
  system1GatewayUrl,
  type JsonRecord,
  type System1NodeBinding,
} from "../_shared/bently-system1-condition-read.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ALLOWED_ORIGIN =
  Deno.env.get("ALLOWED_ORIGIN") ?? "https://app.syncai.ca";
const ALLOWED_HOSTS = (Deno.env.get("SYSTEM1_READ_ALLOWED_HOSTS") ?? "")
  .split(",")
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);
const CREDENTIALS_JSON =
  Deno.env.get("SYSTEM1_READ_CREDENTIALS_JSON") ?? "{}";
const MAX_REQUEST_BYTES = 4 * 1024;
const MAX_PAGE_BYTES = 10 * 1024 * 1024;
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
    JSON.stringify({
      fn: "bently-system1-condition-read-pull",
      event,
      ...detail,
    }),
  );
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function verifiedSessionAal(authorization: string): "aal1" | "aal2" {
  const payload = authorization.replace(/^Bearer\s+/i, "").split(".")[1];
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

function isPrivateHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  const address = lower.replace(/^\[/, "").replace(/\]$/, "");
  if (
    lower === "localhost" ||
    lower.endsWith(".localhost") ||
    lower.endsWith(".local") ||
    address === "::" ||
    address === "::1" ||
    /^(?:fc|fd)[0-9a-f]{2}:/i.test(address) ||
    /^fe[89ab][0-9a-f]:/i.test(address)
  )
    return true;
  const octets = lower.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  )
    return false;
  return (
    octets[0] === 10 ||
    octets[0] === 127 ||
    octets[0] === 0 ||
    (octets[0] === 169 && octets[1] === 254) ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
}

function gatewayEndpoint(value: string): URL {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    url.search ||
    url.hash ||
    isPrivateHostname(host) ||
    !url.pathname.endsWith("/syncai/v1/system1/readings")
  ) {
    throw new Error(
      "Configured System 1 gateway is not the credential-free public HTTPS readings endpoint.",
    );
  }
  if (!ALLOWED_HOSTS.length || !ALLOWED_HOSTS.includes(host)) {
    throw new Error(
      "Configured System 1 gateway host is not in the deployment allowlist.",
    );
  }
  return url;
}

function credentialHeaders(
  binding: string,
  organizationId: string,
): Record<string, string> {
  let registry: Record<string, unknown>;
  try {
    registry = JSON.parse(CREDENTIALS_JSON) as Record<string, unknown>;
  } catch {
    throw new Error("System 1 credential registry is not valid JSON.");
  }
  const entry = asRecord(registry[binding]);
  if (!entry || entry.tenant_id !== organizationId) {
    throw new Error(
      "System 1 credential binding is missing or not authorized for the active tenant.",
    );
  }
  const value = typeof entry.value === "string" ? entry.value : "";
  if (value.length < 16 || /[\r\n]/.test(value)) {
    throw new Error("Configured System 1 gateway credential is invalid.");
  }
  if (entry.type === "header") {
    const header = typeof entry.header === "string" ? entry.header : "";
    if (!/^(x-api-key|api-key)$/i.test(header)) {
      throw new Error(
        "System 1 custom credentials are limited to x-api-key or api-key.",
      );
    }
    return { [header]: value };
  }
  if (entry.type !== "bearer") {
    throw new Error(
      "System 1 credential binding must use bearer or approved API-key header authentication.",
    );
  }
  return { Authorization: `Bearer ${value}` };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function boundedBytes(response: Response): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_PAGE_BYTES) {
    throw new Error("System 1 gateway page exceeds the 10 MB limit.");
  }
  if (!response.body) throw new Error("System 1 gateway response has no body.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_PAGE_BYTES) {
      await reader.cancel();
      throw new Error("System 1 gateway page exceeds the 10 MB limit.");
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
  if (error) throw new Error(error.message);
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
  const actorAal = verifiedSessionAal(authorization);

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) {
    return json({ error: "request_too_large" }, 413);
  }
  let body: { connector_key?: unknown; dry_run?: unknown };
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BYTES) {
      return json({ error: "request_too_large" }, 413);
    }
    body = JSON.parse(raw) as typeof body;
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
      "get_bently_system1_source",
      { p_connector_key: connectorKey },
    );
    organizationId = String(source.organization_id ?? "");
    if (!source.enabled || source.direction !== "read_only" || source.write_enabled) {
      throw new Error("System 1 source is not enabled and read-only.");
    }
    if (!dryRun && source.can_commit !== true) {
      throw new Error(
        "A named human reliability, maintenance or administrator role must promote System 1 readings.",
      );
    }
    const endpoint = gatewayEndpoint(String(source.endpoint ?? ""));
    const headers = credentialHeaders(
      String(source.credential_binding_ref ?? ""),
      organizationId,
    );
    const bindings = source.node_bindings as System1NodeBinding[];
    const maxRows = Number(source.max_rows ?? 0);
    const pageSize = Number(source.page_size ?? 0);
    const maxPages = Number(source.max_pages ?? 0);
    const watermarkFrom = source.watermark_from
      ? String(source.watermark_from)
      : null;
    const contractHash = String(source.contract_hash ?? "");
    if (!/^[0-9a-f]{64}$/.test(contractHash)) {
      throw new Error("System 1 source contract hash is invalid.");
    }

    const deadline = Date.now() + MAX_TRANSPORT_MS;
    const allItems: unknown[] = [];
    const manifest: JsonRecord[] = [];
    const visited = new Set<string>();
    let cursor: string | null = null;
    let totalBytes = 0;
    let complete = false;

    while (!complete) {
      if (manifest.length >= maxPages) {
        throw new Error("System 1 response exceeds the approved page limit.");
      }
      if (cursor && visited.has(cursor)) {
        throw new Error("System 1 gateway repeated a pagination cursor.");
      }
      if (cursor) visited.add(cursor);
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new Error("System 1 pull exceeded its transport time limit.");
      }
      const url = system1GatewayUrl(endpoint, watermarkFrom, pageSize, cursor);
      const response = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json", ...headers },
        redirect: "error",
        signal: AbortSignal.timeout(Math.min(25_000, remaining)),
      });
      if (
        !response.ok ||
        !(response.headers.get("content-type") ?? "")
          .toLowerCase()
          .includes("application/json")
      ) {
        safeLog("gateway_response_refused", {
          status: response.status,
          page: manifest.length + 1,
        });
        throw new Error(
          "System 1 gateway did not return successful application/json.",
        );
      }
      const bytes = await boundedBytes(response);
      totalBytes += bytes.byteLength;
      if (totalBytes > MAX_TOTAL_BYTES) {
        throw new Error("System 1 pull exceeds the 25 MB total limit.");
      }
      let payload: unknown;
      try {
        payload = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        );
      } catch {
        throw new Error("System 1 gateway page is not valid UTF-8 JSON.");
      }
      const page = readSystem1GatewayPage(payload, pageSize);
      if (allItems.length + page.items.length > maxRows) {
        throw new Error("System 1 response exceeds the approved row limit.");
      }
      const cursorIn = cursor;
      allItems.push(...page.items);
      manifest.push({
        transport: "system1_gateway_v1",
        resource: "readings",
        page: manifest.length + 1,
        cursor_in: cursorIn,
        cursor_out: page.nextCursor,
        complete: page.complete,
        sha256: await sha256Hex(bytes),
        bytes: bytes.byteLength,
        row_count: page.items.length,
      });
      cursor = page.nextCursor;
      complete = page.complete;
    }

    const fetchedAt = new Date().toISOString();
    const mapped = mapSystem1Readings(allItems, {
      bindings,
      watermarkFrom,
      fetchedAt,
      maxRows,
    });
    const sourceDigest = await sha256Hex(
      new TextEncoder().encode(manifest.map((item) => item.sha256).join(":")),
    );
    const cursorTo = {
      fetched_at: fetchedAt,
      max_taken_at: mapped.maxTakenAt,
      raw_rows: allItems.length,
      mapped_rows: mapped.rows.length,
      pages: manifest.length,
      source_digest: sourceDigest,
      contract_hash: contractHash,
    };

    if (dryRun) {
      return json({
        ok: true,
        dry_run: true,
        raw_rows: allItems.length,
        mapped_rows: mapped.rows.length,
        pages: manifest.length,
        bytes: totalBytes,
        max_taken_at: mapped.maxTakenAt,
        cursor_to: cursorTo,
        note: "The complete bounded System 1 response was validated, mapped and hashed. No run, staging, reading, alert or watermark row was written.",
      });
    }

    const begun = await rpc<{ run_id: string }>(
      serviceClient,
      "begin_bently_system1_read_run",
      {
        p_organization_id: organizationId,
        p_triggered_by: userData.user.id,
        p_connector_key: connectorKey,
        p_contract_hash: contractHash,
        p_manifest: manifest,
        p_cursor_to: cursorTo,
        p_source_bytes: totalBytes,
      },
    );
    runId = begun.run_id;
    const totals = { read: 0, accepted: 0, duplicate: 0, rejected: 0 };
    for (let index = 0; index < mapped.rows.length; index += 500) {
      const batch = await rpc<Record<string, number>>(
        serviceClient,
        "ingest_bently_system1_read_batch",
        {
          p_organization_id: organizationId,
          p_triggered_by: userData.user.id,
          p_run_id: runId,
          p_actor_aal: actorAal,
          p_rows: mapped.rows.slice(index, index + 500),
        },
      );
      totals.read += Number(batch.read ?? 0);
      totals.accepted += Number(batch.accepted ?? 0);
      totals.duplicate += Number(batch.duplicate ?? 0);
      totals.rejected += Number(batch.rejected ?? 0);
    }
    const status = totals.rejected > 0 ? "partial" : "success";
    const finished = await rpc<JsonRecord>(
      serviceClient,
      "finish_bently_system1_read_run",
      {
        p_organization_id: organizationId,
        p_run_id: runId,
        p_status: status,
        p_error:
          totals.rejected > 0
            ? `${totals.rejected} System 1 samples were refused; inspect retained staging evidence.`
            : null,
      },
    );
    safeLog("pull_finished", {
      organization_id: organizationId,
      run_id: runId,
      status,
      raw_rows: allItems.length,
    });
    return json({
      ...finished,
      raw_rows: allItems.length,
      mapped_rows: mapped.rows.length,
      pages: manifest.length,
      bytes: totalBytes,
      ...totals,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "System 1 pull failed.";
    safeLog("pull_failed", {
      organization_id: organizationId,
      run_id: runId,
      reason: message.slice(0, 200),
    });
    if (runId && organizationId) {
      try {
        await rpc(serviceClient, "finish_bently_system1_read_run", {
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
