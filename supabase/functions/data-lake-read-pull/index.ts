// data-lake-read-pull — governed ADLS Gen2 object ingestion for C2.14.
//
// The user selects an administrator-approved tenant connector and entity. The
// request cannot choose a URL, prefix, credential, mapping or watermark. ADLS
// access uses Microsoft OAuth and GET only. Every selected object is fully
// downloaded, parsed, hashed and included in a retained manifest before the
// service-only run-attestation RPC opens the canonical connector run.
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  applyDataLakeMapping,
  encodeObjectPath,
  parseDataLakeObject,
  selectAdlsObjects,
  sha256Hex,
  withoutDataLakeProvenance,
  type AdlsPathItem,
  type DataLakeCursor,
  type DataLakeFormat,
} from "../_shared/adls-data-lake.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ALLOWED_ORIGIN =
  Deno.env.get("ALLOWED_ORIGIN") ?? "https://app.syncai.ca";
const ALLOWED_HOSTS = (Deno.env.get("RECOVERY_CONNECTOR_ALLOWED_HOSTS") ?? "")
  .split(",")
  .map((host) => host.trim().toLowerCase())
  .filter(Boolean);
const CREDENTIALS_JSON =
  Deno.env.get("RECOVERY_CONNECTOR_CREDENTIALS_JSON") ?? "{}";
const AZURE_STORAGE_SCOPE = "https://storage.azure.com/.default";
const AZURE_STORAGE_VERSION = "2023-11-03";
const MAX_LIST_PAGES = 20;
const MAX_LIST_ITEMS = 100_000;
const MAX_LIST_PAGE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_ROWS = 50_000;
const MAX_OBJECT_ROWS = 20_000;
const MAX_TOTAL_DURATION_MS = 55_000;

const corsHeaders = {
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
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function safeLog(event: string, details: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ fn: "data-lake-read-pull", event, ...details }));
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function filesystemUrl(value: string): URL {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split("/").filter(Boolean);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    url.search ||
    url.hash ||
    !/^[a-z0-9]{3,24}\.dfs\.core\.windows\.net$/.test(host) ||
    segments.length !== 1 ||
    !/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/.test(segments[0])
  ) {
    throw new Error(
      "Configured filesystem URL is not an exact public ADLS Gen2 DFS filesystem root.",
    );
  }
  if (!ALLOWED_HOSTS.length || !ALLOWED_HOSTS.includes(host)) {
    throw new Error(
      "Configured ADLS account host is not in the deployment allowlist.",
    );
  }
  url.pathname = `/${segments[0]}`;
  return url;
}

interface ServicePrincipal {
  organizationId: string;
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

function servicePrincipal(
  binding: string,
  expectedOrganizationId: string,
): ServicePrincipal {
  let registry: Record<string, unknown>;
  try {
    registry = JSON.parse(CREDENTIALS_JSON) as Record<string, unknown>;
  } catch {
    throw new Error(
      "Recovery connector credential registry is not valid JSON.",
    );
  }
  const entry = record(registry[binding]);
  if (!entry || entry.type !== "azure_service_principal") {
    throw new Error(
      "ADLS credential binding must name an Azure service-principal entry in the Edge secret registry.",
    );
  }
  const organizationId = String(entry.organization_id ?? "").trim();
  const tenantId = String(entry.tenant_id ?? "").trim();
  const clientId = String(entry.client_id ?? "").trim();
  const clientSecret = String(entry.client_secret ?? "");
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (
    !uuid.test(organizationId) ||
    organizationId !== expectedOrganizationId ||
    !uuid.test(tenantId) ||
    !uuid.test(clientId) ||
    clientSecret.length < 16 ||
    /[\r\n]/.test(clientSecret)
  ) {
    throw new Error(
      "ADLS service-principal credential entry is invalid or belongs to another SyncAI tenant.",
    );
  }
  return { organizationId, tenantId, clientId, clientSecret };
}

const tokenCache = new Map<string, { value: string; expiresAt: number }>();

async function storageToken(
  binding: string,
  credential: ServicePrincipal,
): Promise<string> {
  const cacheKey = `${credential.organizationId}:${binding}:${credential.clientId}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.value;
  const response = await fetch(
    `https://login.microsoftonline.com/${credential.tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: credential.clientId,
        client_secret: credential.clientSecret,
        scope: AZURE_STORAGE_SCOPE,
        grant_type: "client_credentials",
      }),
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!response.ok) {
    safeLog("azure_auth_failed", { status: response.status });
    throw new Error("Microsoft rejected the configured ADLS identity.");
  }
  const payload = record(await response.json());
  const value =
    typeof payload?.access_token === "string" ? payload.access_token : "";
  if (value.length < 32)
    throw new Error("Microsoft returned an invalid ADLS token.");
  const seconds = Number(payload?.expires_in ?? 300);
  tokenCache.set(cacheKey, {
    value,
    expiresAt: Date.now() + Math.max(60, Math.min(seconds, 3600)) * 1000,
  });
  return value;
}

function remaining(deadline: number): number {
  const value = deadline - Date.now();
  if (value <= 0)
    throw new Error("ADLS pull exceeded its total transport time limit.");
  return value;
}

async function listPaths(
  root: URL,
  prefix: string,
  token: string,
  deadline: number,
): Promise<AdlsPathItem[]> {
  const items: AdlsPathItem[] = [];
  const seen = new Set<string>();
  let continuation = "";
  let page = 0;
  const normalized = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
  const slash = normalized.lastIndexOf("/");
  const directory = prefix.endsWith("/")
    ? normalized
    : slash >= 0
      ? normalized.slice(0, slash)
      : "";
  do {
    if (page >= MAX_LIST_PAGES)
      throw new Error(
        "ADLS listing exceeded 20 pages; narrow the administrator-approved prefix.",
      );
    const url = new URL(root.href);
    url.searchParams.set("resource", "filesystem");
    url.searchParams.set("recursive", "true");
    url.searchParams.set("maxResults", "5000");
    if (directory) url.searchParams.set("directory", directory);
    if (continuation) url.searchParams.set("continuation", continuation);
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "x-ms-version": AZURE_STORAGE_VERSION,
        Accept: "application/json",
      },
      redirect: "error",
      signal: AbortSignal.timeout(Math.min(15_000, remaining(deadline))),
    });
    if (!response.ok)
      throw new Error(`ADLS path listing returned HTTP ${response.status}.`);
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_LIST_PAGE_BYTES)
      throw new Error("ADLS listing page exceeds the 5 MB limit.");
    const payload = record(JSON.parse(text));
    if (!payload || !Array.isArray(payload.paths))
      throw new Error("ADLS path listing response is invalid.");
    for (const raw of payload.paths) {
      const item = record(raw);
      if (!item)
        throw new Error("ADLS path listing contains an invalid entry.");
      const name = String(item.name ?? "");
      if (seen.has(name))
        throw new Error("ADLS path listing repeated an object.");
      seen.add(name);
      items.push(item as AdlsPathItem);
      if (items.length > MAX_LIST_ITEMS)
        throw new Error(
          "ADLS listing exceeds 100,000 entries; narrow the administrator-approved prefix.",
        );
    }
    continuation = response.headers.get("x-ms-continuation") ?? "";
    page += 1;
  } while (continuation);
  return items;
}

async function downloadObject(
  root: URL,
  object: { path: string; contentLength: number; etag: string },
  token: string,
  deadline: number,
): Promise<Uint8Array> {
  const url = new URL(root.href);
  url.pathname = `${root.pathname}/${encodeObjectPath(object.path)}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "x-ms-version": AZURE_STORAGE_VERSION,
      Accept: "application/octet-stream,text/csv,application/json",
    },
    redirect: "error",
    signal: AbortSignal.timeout(Math.min(20_000, remaining(deadline))),
  });
  if (!response.ok)
    throw new Error(`ADLS object download returned HTTP ${response.status}.`);
  const responseEtag = response.headers.get("etag") ?? "";
  if (!responseEtag || responseEtag !== object.etag)
    throw new Error("ADLS object changed between listing and download.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength !== object.contentLength)
    throw new Error("ADLS object length changed between listing and download.");
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
    return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST")
    return json({ error: "method_not_allowed" }, 405);
  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY)
    return json({ error: "service_unavailable" }, 503);

  const authorization = request.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer "))
    return json({ error: "unauthorized" }, 401);
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return json({ error: "unauthorized" }, 401);

  let body: {
    connector_key?: unknown;
    entity_type?: unknown;
    dry_run?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const connectorKey =
    typeof body.connector_key === "string" ? body.connector_key.trim() : "";
  const entityType =
    typeof body.entity_type === "string" ? body.entity_type.trim() : "";
  const dryRun = body.dry_run !== false;
  if (!connectorKey || !entityType)
    return json({ error: "connector_key and entity_type are required" }, 400);

  let runId: string | null = null;
  let organizationId: string | null = null;
  const serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  try {
    const source = await rpc<Record<string, unknown>>(
      userClient,
      "get_data_lake_read_source",
      { p_connector_key: connectorKey, p_entity_type: entityType },
    );
    organizationId = String(source.organization_id ?? "");
    if (source.direction !== "read_only" || source.write_enabled)
      throw new Error("ADLS source is not governed as read-only.");
    if (
      !dryRun &&
      (!source.enabled ||
        source.mapping_status !== "approved" ||
        source.can_commit !== true)
    )
      throw new Error(
        "Commit requires an active source, a named-human-approved mapping and a named human operator.",
      );
    const root = filesystemUrl(String(source.filesystem_url ?? ""));
    const binding = String(source.credential_binding_ref ?? "");
    const prefix = String(source.object_prefix ?? "");
    const format = String(source.object_format ?? "") as DataLakeFormat;
    const maxFiles = Number(source.max_files ?? 0);
    const maxBytes = Number(source.max_bytes ?? 0);
    const contractHash = String(source.contract_hash ?? "");
    if (
      !organizationId ||
      !binding ||
      !prefix ||
      !["csv", "jsonl", "json"].includes(format) ||
      !Number.isInteger(maxFiles) ||
      maxFiles < 1 ||
      maxFiles > 100 ||
      !Number.isSafeInteger(maxBytes) ||
      maxBytes < 1024 * 1024 ||
      maxBytes > 50 * 1024 * 1024 ||
      !/^[0-9a-f]{32}$/.test(contractHash)
    ) {
      throw new Error("ADLS source profile is invalid.");
    }
    const previous =
      source.last_cursor === null
        ? null
        : (source.last_cursor as DataLakeCursor);
    if (
      previous &&
      (typeof previous.last_modified !== "string" ||
        !Number.isFinite(Date.parse(previous.last_modified)) ||
        typeof previous.path !== "string" ||
        !previous.path)
    ) {
      throw new Error("Stored ADLS watermark is invalid.");
    }

    const deadline = Date.now() + MAX_TOTAL_DURATION_MS;
    const credential = servicePrincipal(binding, organizationId);
    const token = await storageToken(binding, credential);
    const listed = await listPaths(root, prefix, token, deadline);
    const selected = selectAdlsObjects(
      listed,
      prefix,
      format,
      previous,
      maxFiles,
      maxBytes,
    );
    if (!selected.objects.length || !selected.cursor) {
      return json({
        dry_run: dryRun,
        status: "no_change",
        transport_complete: true,
        objects: 0,
        bytes: 0,
        read: 0,
        accepted: 0,
        duplicate: 0,
        rejected: 0,
        note: "No object is newer than the last clean watermark.",
      });
    }
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const mappedRows: Array<Record<string, unknown>> = [];
    const manifest: Array<Record<string, unknown>> = [];
    let actualBytes = 0;
    for (const object of selected.objects) {
      const bytes = await downloadObject(root, object, token, deadline);
      actualBytes += bytes.byteLength;
      if (actualBytes > maxBytes)
        throw new Error("ADLS object window exceeded its byte limit.");
      let text: string;
      try {
        text = decoder.decode(bytes);
      } catch {
        throw new Error("ADLS object is not valid UTF-8 text.");
      }
      const rows = parseDataLakeObject(
        text,
        format,
        String(source.source_array_path ?? ""),
      );
      if (rows.length > MAX_OBJECT_ROWS)
        throw new Error("One ADLS object exceeds the 20,000-row limit.");
      if (mappedRows.length + rows.length > MAX_TOTAL_ROWS)
        throw new Error("ADLS object window exceeds the 50,000-row limit.");
      const digest = await sha256Hex(bytes);
      const provenance = {
        transport: "adls_gen2",
        path: object.path,
        etag: object.etag,
        last_modified: object.lastModified,
        content_length: object.contentLength,
        sha256: digest,
      };
      const mapping = source.column_mapping as Record<string, string>;
      const valueMaps = source.value_mappings as Record<
        string,
        Record<string, string>
      >;
      const constants = source.constants as Record<string, unknown>;
      mappedRows.push(
        ...rows.map((row) =>
          applyDataLakeMapping(row, mapping, valueMaps, constants, provenance),
        ),
      );
      manifest.push({ ...provenance, row_count: rows.length });
    }

    const totals = { read: 0, accepted: 0, duplicate: 0, rejected: 0 };
    const results: unknown[] = [];
    if (dryRun) {
      for (let index = 0; index < mappedRows.length; index += 500) {
        const preview = await rpc<{
          read: number;
          accepted: number;
          duplicate: number;
          rejected: number;
          results: unknown[];
        }>(userClient, "preview_recovery_activation_batch", {
          p_connector_key: connectorKey,
          p_entity_type: entityType,
          // Preview validates canonical values but writes no staging evidence.
          // Committed batches independently prove each reserved receipt
          // against the immutable run manifest before retaining it.
          p_rows: mappedRows
            .slice(index, index + 500)
            .map(withoutDataLakeProvenance),
        });
        totals.read += preview.read;
        totals.accepted += preview.accepted;
        totals.duplicate += preview.duplicate;
        totals.rejected += preview.rejected;
        if (results.length < 100)
          results.push(...preview.results.slice(0, 100 - results.length));
      }
      safeLog("dry_run_complete", {
        connectorKey,
        entityType,
        objects: manifest.length,
        rows: totals.read,
        rejected: totals.rejected,
      });
      return json({
        dry_run: true,
        transport_complete: true,
        objects: manifest.length,
        bytes: actualBytes,
        cursor_to: selected.cursor,
        ...totals,
        results,
        note: "Every selected object was downloaded, parsed and hashed. No canonical, staging, run or watermark row was written.",
      });
    }

    const started = await rpc<{ run_id: string }>(
      serviceClient,
      "begin_data_lake_read_run",
      {
        p_organization_id: organizationId,
        p_triggered_by: userData.user.id,
        p_connector_key: connectorKey,
        p_entity_type: entityType,
        p_manifest: manifest,
        p_cursor_to: selected.cursor,
        p_source_bytes: actualBytes,
        p_expected_contract_hash: contractHash,
      },
    );
    runId = started.run_id;
    for (let index = 0; index < mappedRows.length; index += 500) {
      const batch = await rpc<typeof totals>(
        userClient,
        "ingest_data_lake_read_batch",
        { p_run_id: runId, p_rows: mappedRows.slice(index, index + 500) },
      );
      totals.read += batch.read;
      totals.accepted += batch.accepted;
      totals.duplicate += batch.duplicate;
      totals.rejected += batch.rejected;
    }
    const status = totals.rejected ? "partial" : "success";
    const finished = await rpc<{ cursor_advanced: boolean }>(
      serviceClient,
      "finish_data_lake_read_run",
      {
        p_organization_id: organizationId,
        p_run_id: runId,
        p_finished_by: userData.user.id,
        p_status: status,
        p_error: null,
      },
    );
    safeLog("sync_complete", {
      connectorKey,
      entityType,
      runId,
      status,
      objects: manifest.length,
      rows: totals.read,
    });
    return json({
      dry_run: false,
      transport_complete: true,
      run_id: runId,
      status,
      cursor_advanced: finished.cursor_advanced,
      objects: manifest.length,
      bytes: actualBytes,
      ...totals,
    });
  } catch (error) {
    if (runId && organizationId) {
      try {
        await rpc(serviceClient, "finish_data_lake_read_run", {
          p_organization_id: organizationId,
          p_run_id: runId,
          p_finished_by: userData.user.id,
          p_status: "failure",
          p_error: "ADLS adapter failed; inspect Edge Function logs.",
        });
      } catch {
        // The original error remains primary; an open run remains observable.
      }
    }
    safeLog("request_failed", {
      connectorKey,
      entityType,
      runId,
      error: String(error),
    });
    return json(
      { error: error instanceof Error ? error.message : "ADLS pull failed." },
      422,
    );
  }
});
