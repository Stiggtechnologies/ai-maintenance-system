// Governed SAP Asset Performance Management indicator read for C2.19.
// This function performs bounded HTTPS GETs only against IndicatorService.
// It never calls the documented time-series write API and never sends a request
// that can mutate SAP APM.
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  mapSapApmIndicators,
  normalizeSapApmIndicatorPullRequest,
  readSapApmIndicatorPage,
  sapApmIndicatorUrl,
  validateSapApmNextUrl,
  type JsonRecord,
  type SapApmIndicatorBinding,
} from "../_shared/sap-apm-indicator-read.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ALLOWED_ORIGIN =
  Deno.env.get("ALLOWED_ORIGIN") ?? "https://app.syncai.ca";
const ALLOWED_HOSTS = (Deno.env.get("SAP_APM_INDICATOR_READ_ALLOWED_HOSTS") ?? "")
  .split(",")
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);
const CREDENTIALS_JSON =
  Deno.env.get("SAP_APM_INDICATOR_READ_CREDENTIALS_JSON") ?? "{}";
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
    JSON.stringify({ fn: "sap-apm-indicator-read-pull", event, ...detail }),
  );
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function serviceRoot(value: string): URL {
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
    host.startsWith("[") ||
    privateIpv4
  ) {
    throw new Error(
      "Configured SAP APM service root is not a credential-free public HTTPS URL.",
    );
  }
  if (!/\/IndicatorService\/v1$/.test(url.pathname)) {
    throw new Error(
      "Configured SAP APM service root must end in IndicatorService/v1.",
    );
  }
  if (!ALLOWED_HOSTS.length || !ALLOWED_HOSTS.includes(host)) {
    throw new Error("Configured SAP APM host is not in the deployment allowlist.");
  }
  url.pathname = url.pathname.replace(/\/$/, "");
  return url;
}

function credentials(binding: string): { token: string; apiKey: string } {
  let registry: Record<string, unknown>;
  try {
    registry = JSON.parse(CREDENTIALS_JSON) as Record<string, unknown>;
  } catch {
    throw new Error("SAP APM credential registry is not valid JSON.");
  }
  const entry = asRecord(registry[binding]);
  if (!entry || entry.type !== "oauth_bearer") {
    throw new Error(
      "SAP APM credential binding must name an oauth_bearer entry in the Edge secret registry.",
    );
  }
  const token =
    typeof entry.access_token === "string" ? entry.access_token : "";
  const apiKey = typeof entry.api_key === "string" ? entry.api_key : "";
  if (token.length < 32 || /[\r\n]/.test(token)) {
    throw new Error("Configured SAP APM OAuth bearer token is invalid.");
  }
  if (apiKey.length < 8 || /[\r\n]/.test(apiKey)) {
    throw new Error("Configured SAP APM API key is invalid.");
  }
  return { token, apiKey };
}

function bindings(value: unknown): SapApmIndicatorBinding[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 40) {
    throw new Error("SAP APM indicator bindings are invalid.");
  }
  return value.map((item) => {
    const row = asRecord(item);
    if (
      !row ||
      typeof row.characteristicsInternalId !== "string" ||
      typeof row.positionId !== "string" ||
      typeof row.categoryName !== "string" ||
      typeof row.technicalObjectType !== "string" ||
      typeof row.sensorId !== "string"
    ) {
      throw new Error("SAP APM indicator bindings are invalid.");
    }
    return {
      characteristicsInternalId: row.characteristicsInternalId,
      positionId: row.positionId,
      categoryName: row.categoryName,
      technicalObjectType: row.technicalObjectType,
      sensorId: row.sensorId,
    };
  });
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
    throw new Error("SAP APM indicator page exceeds its transport byte limit.");
  }
  if (!response.body) throw new Error("SAP APM indicator response has no body.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("SAP APM indicator page exceeds its transport byte limit.");
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
    throw new Error("SAP APM indicator data operation failed.");
  }
  const payload = data as { error?: string } | null;
  if (payload?.error) throw new Error(payload.error);
  return data as T;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
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
    ({ connectorKey, dryRun } = normalizeSapApmIndicatorPullRequest(body));
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
      "get_sap_apm_indicator_source",
      { p_connector_key: connectorKey },
    );
    organizationId = String(source.organization_id ?? "");
    if (
      !source.enabled ||
      source.direction !== "read_only" ||
      source.write_enabled
    ) {
      throw new Error("SAP APM indicator source is not enabled and read-only.");
    }
    const root = serviceRoot(String(source.service_root ?? ""));
    const secret = credentials(String(source.credential_binding_ref ?? ""));
    const technicalObjectNumber = String(source.technical_object_number ?? "");
    const siteId = String(source.site_id ?? "");
    const maxRows = Number(source.max_rows ?? 0);
    const maxPages = Number(source.max_pages ?? 0);
    const contractHash = String(source.contract_hash ?? "");
    if (
      !organizationId ||
      !/^[0-9a-f]{64}$/.test(contractHash) ||
      !Number.isSafeInteger(maxRows) ||
      maxRows < 1 ||
      maxRows > 5000 ||
      !Number.isSafeInteger(maxPages) ||
      maxPages < 2 ||
      maxPages > 100
    ) {
      throw new Error("SAP APM indicator source profile is invalid.");
    }
    const firstUrl = sapApmIndicatorUrl(root, technicalObjectNumber);
    let nextUrl: URL | null = firstUrl;
    const deadline = Date.now() + MAX_TRANSPORT_MS;
    const rows: unknown[] = [];
    const manifest: JsonRecord[] = [];
    const fetchedUrls = new Set<string>();
    let totalBytes = 0;

    while (nextUrl) {
      if (fetchedUrls.has(nextUrl.href)) {
        throw new Error("SAP APM indicator pagination repeated a page URL.");
      }
      fetchedUrls.add(nextUrl.href);
      if (manifest.length >= maxPages) {
        throw new Error(
          "SAP APM indicator response exceeds the approved page limit.",
        );
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new Error("SAP APM indicator pull exceeded its time limit.");
      }
      const remainingBytes = MAX_TOTAL_BYTES - totalBytes;
      if (remainingBytes <= 0) {
        throw new Error("SAP APM indicator pull exceeds the 25 MB total limit.");
      }
      const response = await fetch(nextUrl, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${secret.token}`,
          "X-API-Key": secret.apiKey,
        },
        redirect: "error",
        signal: AbortSignal.timeout(Math.min(25_000, remaining)),
      });
      if (
        !response.ok ||
        !(response.headers.get("content-type") ?? "")
          .toLowerCase()
          .includes("application/json")
      ) {
        safeLog("sap_response_refused", {
          status: response.status,
          page: manifest.length + 1,
        });
        throw new Error(
          "SAP APM indicator read did not return successful application/json.",
        );
      }
      const bytes = await boundedBytes(
        response,
        Math.min(MAX_PAGE_BYTES, remainingBytes),
      );
      totalBytes += bytes.byteLength;
      if (totalBytes > MAX_TOTAL_BYTES) {
        throw new Error("SAP APM indicator pull exceeds the 25 MB total limit.");
      }
      let payload: unknown;
      try {
        payload = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        );
      } catch {
        throw new Error("SAP APM indicator page is not valid UTF-8 JSON.");
      }
      const page = readSapApmIndicatorPage(payload);
      rows.push(...page.rows);
      if (rows.length > maxRows) {
        throw new Error(
          "SAP APM indicator response exceeds the approved row limit.",
        );
      }
      manifest.push({
        transport: "sap_apm_rest",
        resource: "IndicatorService/v1/Indicators",
        page: manifest.length + 1,
        technical_object_number: technicalObjectNumber,
        sha256: await sha256Hex(bytes),
        bytes: bytes.byteLength,
        row_count: page.rows.length,
      });
      nextUrl = page.nextUrl
        ? validateSapApmNextUrl(page.nextUrl, firstUrl)
        : null;
    }

    const fetchedAt = new Date().toISOString();
    const mapped = mapSapApmIndicators(rows, {
      technicalObjectNumber,
      siteId,
      observedAt: fetchedAt,
      maxRows,
      bindings: bindings(source.indicator_bindings),
    });
    if (Date.now() > deadline) {
      throw new Error("SAP APM indicator pull exceeded its time limit.");
    }
    const cursor = {
      fetched_at: fetchedAt,
      raw_rows: rows.length,
      mapped_rows: mapped.length,
      pages: manifest.length,
      contract_hash: contractHash,
    };
    if (dryRun) {
      return json({
        ok: true,
        dry_run: true,
        raw_rows: rows.length,
        mapped_rows: mapped.length,
        pages: manifest.length,
        bytes: totalBytes,
        note: "No run, staging, sensor or watermark row was written.",
      });
    }

    const begun = await rpc<{ run_id: string }>(
      serviceClient,
      "begin_sap_apm_indicator_read_run",
      {
        p_organization_id: organizationId,
        p_triggered_by: userData.user.id,
        p_connector_key: connectorKey,
        p_manifest: manifest,
        p_cursor_to: cursor,
        p_source_bytes: totalBytes,
      },
    );
    runId = begun.run_id;
    const ingested = await rpc<Record<string, number>>(
      serviceClient,
      "ingest_sap_apm_indicator_read_batch",
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
      "finish_sap_apm_indicator_read_run",
      {
        p_organization_id: organizationId,
        p_run_id: runId,
        p_status: status,
        p_error:
          rejected > 0
            ? `${rejected} SAP APM rows were refused; inspect retained staging evidence.`
            : null,
      },
    );
    safeLog("pull_finished", {
      organization_id: organizationId,
      run_id: runId,
      status,
      raw_rows: rows.length,
      mapped_rows: mapped.length,
    });
    return json({
      ...finished,
      raw_rows: rows.length,
      mapped_rows: mapped.length,
      pages: manifest.length,
      bytes: totalBytes,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "SAP APM indicator pull failed.";
    safeLog("pull_failed", {
      organization_id: organizationId,
      run_id: runId,
      reason: message.slice(0, 200),
    });
    if (runId && organizationId) {
      try {
        await rpc(serviceClient, "finish_sap_apm_indicator_read_run", {
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
