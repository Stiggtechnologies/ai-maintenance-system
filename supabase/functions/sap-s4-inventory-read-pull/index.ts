// Governed SAP S/4HANA Material Stock read for C2.17. This function performs
// bounded OData V2 GETs only. It hashes every complete page before opening the
// service-attested canonical connector run and never sends a request to SAP
// that can mutate inventory.
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  mapSapMaterialStock,
  readSapODataPage,
  sapMaterialStockUrl,
  validateSapNextUrl,
  type JsonRecord,
} from "../_shared/sap-s4-inventory-read.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ALLOWED_ORIGIN =
  Deno.env.get("ALLOWED_ORIGIN") ?? "https://app.syncai.ca";
const ALLOWED_HOSTS = (
  Deno.env.get("SAP_S4_INVENTORY_READ_ALLOWED_HOSTS") ?? ""
)
  .split(",")
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);
const CREDENTIALS_JSON =
  Deno.env.get("SAP_S4_INVENTORY_READ_CREDENTIALS_JSON") ?? "{}";
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
    JSON.stringify({ fn: "sap-s4-inventory-read-pull", event, ...detail }),
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
    host === "::1" ||
    privateIpv4
  ) {
    throw new Error(
      "Configured SAP service root is not a credential-free public HTTPS URL.",
    );
  }
  if (!/\/API_MATERIAL_STOCK_SRV\/?$/.test(url.pathname)) {
    throw new Error(
      "Configured SAP service root must end in API_MATERIAL_STOCK_SRV.",
    );
  }
  if (!ALLOWED_HOSTS.length || !ALLOWED_HOSTS.includes(host)) {
    throw new Error("Configured SAP host is not in the deployment allowlist.");
  }
  url.pathname = url.pathname.replace(/\/$/, "");
  return url;
}

function bearer(binding: string): string {
  let registry: Record<string, unknown>;
  try {
    registry = JSON.parse(CREDENTIALS_JSON) as Record<string, unknown>;
  } catch {
    throw new Error("SAP inventory credential registry is not valid JSON.");
  }
  const entry = asRecord(registry[binding]);
  if (!entry || entry.type !== "oauth_bearer") {
    throw new Error(
      "SAP inventory credential binding must name an oauth_bearer entry in the Edge secret registry.",
    );
  }
  const token =
    typeof entry.access_token === "string" ? entry.access_token : "";
  if (token.length < 32 || /[\r\n]/.test(token)) {
    throw new Error("Configured SAP OAuth bearer token is invalid.");
  }
  return token;
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
    throw new Error("SAP inventory page exceeds the 10 MB limit.");
  }
  if (!response.body) throw new Error("SAP inventory response has no body.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_PAGE_BYTES) {
      await reader.cancel();
      throw new Error("SAP inventory page exceeds the 10 MB limit.");
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
      "get_sap_s4_inventory_source",
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
      throw new Error("SAP inventory source is not enabled and read-only.");
    }
    const root = serviceRoot(String(source.service_root ?? ""));
    const token = bearer(String(source.credential_binding_ref ?? ""));
    const plant = String(source.plant ?? "");
    const storageLocation = String(source.storage_location ?? "");
    const siteId = String(source.site_id ?? "");
    const maxRows = Number(source.max_rows ?? 0);
    const pageSize = Number(source.page_size ?? 0);
    const maxPages = Number(source.max_pages ?? 0);
    const firstUrl = sapMaterialStockUrl(
      root,
      plant,
      storageLocation,
      pageSize,
    );
    let nextUrl: URL | null = firstUrl;
    const deadline = Date.now() + MAX_TRANSPORT_MS;
    const rows: unknown[] = [];
    const manifest: JsonRecord[] = [];
    let totalBytes = 0;

    while (nextUrl) {
      if (manifest.length >= maxPages) {
        throw new Error(
          "SAP inventory response exceeds the approved page limit.",
        );
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0)
        throw new Error("SAP inventory pull exceeded its time limit.");
      const response = await fetch(nextUrl, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
          DataServiceVersion: "2.0",
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
          "SAP inventory read did not return successful application/json.",
        );
      }
      const bytes = await boundedBytes(response);
      totalBytes += bytes.byteLength;
      if (totalBytes > MAX_TOTAL_BYTES) {
        throw new Error("SAP inventory pull exceeds the 25 MB total limit.");
      }
      let payload: unknown;
      try {
        payload = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        );
      } catch {
        throw new Error("SAP inventory page is not valid UTF-8 JSON.");
      }
      const page = readSapODataPage(payload);
      rows.push(...page.rows);
      if (rows.length > maxRows) {
        throw new Error(
          "SAP inventory response exceeds the approved row limit.",
        );
      }
      manifest.push({
        transport: "sap_s4_odata_v2",
        resource: "A_MatlStkInAcctMod",
        page: manifest.length + 1,
        plant,
        storage_location: storageLocation,
        sha256: await sha256Hex(bytes),
        bytes: bytes.byteLength,
        row_count: page.rows.length,
      });
      nextUrl = page.nextUrl
        ? validateSapNextUrl(page.nextUrl, firstUrl)
        : null;
    }

    const fetchedAt = new Date().toISOString();
    const mapped = mapSapMaterialStock(rows, {
      plant,
      storageLocation,
      siteId,
      observedAt: fetchedAt,
      maxRows,
    });
    const cursor = {
      fetched_at: fetchedAt,
      raw_rows: rows.length,
      mapped_rows: mapped.length,
      pages: manifest.length,
    };
    if (dryRun) {
      return json({
        ok: true,
        dry_run: true,
        raw_rows: rows.length,
        mapped_rows: mapped.length,
        pages: manifest.length,
        bytes: totalBytes,
        note: "No run, staging, material_stock or watermark row was written.",
      });
    }

    const begun = await rpc<{ run_id: string }>(
      serviceClient,
      "begin_sap_s4_inventory_read_run",
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
      "ingest_sap_s4_inventory_read_batch",
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
      "finish_sap_s4_inventory_read_run",
      {
        p_organization_id: organizationId,
        p_run_id: runId,
        p_status: status,
        p_error:
          rejected > 0
            ? `${rejected} SAP rows were refused; inspect retained staging evidence.`
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
      error instanceof Error ? error.message : "SAP inventory pull failed.";
    safeLog("pull_failed", {
      organization_id: organizationId,
      run_id: runId,
      reason: message.slice(0, 200),
    });
    if (runId && organizationId) {
      try {
        await rpc(serviceClient, "finish_sap_s4_inventory_read_run", {
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
