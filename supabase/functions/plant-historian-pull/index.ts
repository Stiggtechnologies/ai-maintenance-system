// plant-historian-pull — a narrow, user-triggered, read-only JSON adapter.
//
// The endpoint, mapping and credential binding all come from tenant-scoped
// approved database configuration. The caller cannot submit an arbitrary URL.
// Endpoint hosts must also be present in PLANT_HISTORIAN_ALLOWED_HOSTS, which
// closes the SSRF boundary independently of the tenant configuration.
// Credentials are resolved by opaque URI from PLANT_HISTORIAN_CREDENTIALS_JSON
// and are never stored in or returned by the database.
//
// Promoted rows go through ingest_plant_historian_batch → ingest_batch
// (condition_reading). This function never writes to the plant source.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const ALLOWED_ORIGIN =
  Deno.env.get("ALLOWED_ORIGIN") ?? "https://app.syncai.ca";
const ALLOWED_HOSTS = (Deno.env.get("PLANT_HISTORIAN_ALLOWED_HOSTS") ?? "")
  .split(",")
  .map((host) => host.trim().toLowerCase())
  .filter(Boolean);
const CREDENTIALS_JSON =
  Deno.env.get("PLANT_HISTORIAN_CREDENTIALS_JSON") ?? "{}";
const MAX_TOTAL_ROWS = 50_000;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;
const MAX_PAGE_ROWS = 10_000;
const MAX_PAGE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_DURATION_MS = 55_000;
const FETCH_TIMEOUT_MS = 20_000;

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
  console.log(
    JSON.stringify({ fn: "plant-historian-pull", event, ...details }),
  );
}

function isPrivateHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  const address = lower.replace(/^\[/, "").replace(/\]$/, "");
  if (
    lower === "localhost" ||
    lower.endsWith(".localhost") ||
    lower.endsWith(".local")
  )
    return true;
  if (
    address === "::" ||
    address === "::1" ||
    /^(?:fc|fd)[0-9a-f]{2}:/i.test(address) ||
    /^fe[89ab][0-9a-f]:/i.test(address)
  )
    return true;
  if (lower === "0.0.0.0") return true;
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

function validateEndpoint(endpoint: string): URL {
  const url = new URL(endpoint);
  const hostname = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443")
  ) {
    throw new Error(
      "The configured endpoint is not a credential-free standard HTTPS URL.",
    );
  }
  if (isPrivateHostname(hostname))
    throw new Error("Private and local endpoint targets are blocked.");
  if (ALLOWED_HOSTS.length === 0)
    throw new Error(
      "Plant historian pull is not configured: PLANT_HISTORIAN_ALLOWED_HOSTS is empty. Seed/sim telemetry remains in force.",
    );
  if (!ALLOWED_HOSTS.includes(hostname))
    throw new Error(
      "The configured endpoint host is not in the deployment allowlist.",
    );
  url.hash = "";
  return url;
}

function valueAtPath(payload: unknown, path: string): unknown {
  let value = payload;
  for (const segment of path
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean)) {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return undefined;
    value = (value as Record<string, unknown>)[segment];
  }
  return value;
}

function extractRows(
  payload: unknown,
  path: string,
): Array<Record<string, unknown>> {
  const value = valueAtPath(payload, path);
  if (!Array.isArray(value))
    throw new Error("Configured source array path is not a JSON array.");
  if (value.length > MAX_PAGE_ROWS)
    throw new Error(
      `Historian page returned more than ${MAX_PAGE_ROWS} rows; narrow the endpoint window.`,
    );
  if (
    value.some((row) => !row || typeof row !== "object" || Array.isArray(row))
  )
    throw new Error("Every source row must be a JSON object.");
  return value as Array<Record<string, unknown>>;
}

function nextPage(
  payload: unknown,
  path: string,
  current: URL,
  initial: URL,
): URL | null {
  const value = valueAtPath(payload, path);
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string")
    throw new Error("Historian next-page value must be a URL string or null.");
  const next = validateEndpoint(new URL(value, current).href);
  if (next.origin !== initial.origin)
    throw new Error(
      "Historian next-page URL must remain on the approved source origin.",
    );
  return next;
}

function applyMapping(
  row: Record<string, unknown>,
  mapping: Record<string, string>,
  valueMaps: Record<string, Record<string, string>>,
  constants: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [target, source] of Object.entries(mapping)) {
    const raw = row[source];
    if (raw === undefined || raw === null || raw === "") continue;
    result[target] = valueMaps[target]?.[String(raw)] ?? raw;
  }
  for (const [target, value] of Object.entries(constants)) {
    if (value !== undefined && value !== null && value !== "")
      result[target] = value;
  }
  return result;
}

type Credential =
  string | { type?: "bearer" | "header"; header?: string; value?: string };

function credentialHeaders(binding: string): Record<string, string> {
  let credentials: Record<string, Credential>;
  try {
    credentials = JSON.parse(CREDENTIALS_JSON) as Record<string, Credential>;
  } catch {
    throw new Error("Plant historian credential registry is not valid JSON.");
  }
  const credential = credentials[binding];
  if (!credential)
    throw new Error(
      "The configured credential binding is not present in the Edge Function secret registry.",
    );
  if (typeof credential === "string")
    return { Authorization: `Bearer ${credential}` };
  const value = credential.value ?? "";
  if (!value || /[\r\n]/.test(value))
    throw new Error("The credential binding is empty or invalid.");
  if (credential.type === "header") {
    const header = credential.header ?? "";
    if (!/^(x-api-key|api-key)$/i.test(header))
      throw new Error(
        "Only x-api-key or api-key custom credential headers are permitted.",
      );
    return { [header]: value };
  }
  return { Authorization: `Bearer ${value}` };
}

async function fetchJson(
  endpoint: URL,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<{ payload: unknown; bytes: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: "GET",
      headers: { Accept: "application/json", ...headers },
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok)
      throw new Error(`Source returned HTTP ${response.status}.`);
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("application/json"))
      throw new Error("Source did not return application/json.");
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > MAX_PAGE_BYTES)
      throw new Error("Historian response page exceeds the 10 MB limit.");
    const text = await response.text();
    const bytes = new TextEncoder().encode(text).byteLength;
    if (bytes > MAX_PAGE_BYTES)
      throw new Error("Historian response page exceeds the 10 MB limit.");
    return { payload: JSON.parse(text) as unknown, bytes };
  } finally {
    clearTimeout(timer);
  }
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

  const authorization = request.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer "))
    return json({ error: "unauthorized" }, 401);
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user) return json({ error: "unauthorized" }, 401);

  let body: { connector_key?: unknown; dry_run?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const connectorKey =
    typeof body.connector_key === "string" ? body.connector_key.trim() : "";
  const dryRun = body.dry_run !== false;
  if (!connectorKey) return json({ error: "connector_key is required" }, 400);

  let runId: string | null = null;
  try {
    const source = await rpc<{
      enabled: boolean;
      direction: string;
      write_enabled: boolean;
      endpoint_url: string | null;
      credential_binding_ref: string | null;
      mapping_status: string;
      source_array_path: string;
      column_mapping: Record<string, string>;
      value_mappings: Record<string, Record<string, string>>;
      constants: Record<string, unknown>;
      pagination_mode: string;
      pagination_next_path: string | null;
      pagination_max_pages: number;
    }>(client, "get_plant_historian_source", {
      p_connector_key: connectorKey,
    });
    if (
      !source.enabled ||
      source.direction !== "read_only" ||
      source.write_enabled
    )
      throw new Error("Source is not active and read-only.");
    if (source.mapping_status !== "approved")
      throw new Error("Source mapping is not approved.");
    if (!source.endpoint_url || !source.credential_binding_ref)
      throw new Error(
        "Source endpoint or credential binding is not configured.",
      );

    const mode = String(source.pagination_mode ?? "none");
    const maxPages = Number(source.pagination_max_pages ?? 1);
    const nextPath = String(source.pagination_next_path ?? "");
    if (!["none", "next_url"].includes(mode))
      throw new Error("Historian pagination mode is invalid.");
    if (
      !Number.isInteger(maxPages) ||
      (mode === "none" && maxPages !== 1) ||
      (mode === "next_url" && (maxPages < 2 || maxPages > 100 || !nextPath))
    )
      throw new Error("Historian pagination profile is invalid.");

    const initial = validateEndpoint(source.endpoint_url);
    let current: URL | null = initial;
    let pageCount = 0;
    let totalBytes = 0;
    const rows: Array<Record<string, unknown>> = [];
    const visited = new Set<string>();
    const sourceHeaders = credentialHeaders(source.credential_binding_ref);
    const transportStartedAt = Date.now();
    let transportComplete = false;

    while (current) {
      if (pageCount >= maxPages)
        throw new Error(
          "Historian pagination exceeded its approved page limit.",
        );
      if (visited.has(current.href))
        throw new Error("Historian pagination loop detected.");
      const remainingMs =
        MAX_TOTAL_DURATION_MS - (Date.now() - transportStartedAt);
      if (remainingMs <= 0)
        throw new Error(
          "Historian pagination exceeded its total transport time limit.",
        );
      visited.add(current.href);
      const page = await fetchJson(
        current,
        sourceHeaders,
        Math.min(FETCH_TIMEOUT_MS, remainingMs),
      );
      totalBytes += page.bytes;
      if (totalBytes > MAX_TOTAL_BYTES)
        throw new Error(
          "Historian paginated response exceeds the 50 MB total limit.",
        );
      const pageRows = extractRows(page.payload, source.source_array_path);
      if (rows.length + pageRows.length > MAX_TOTAL_ROWS)
        throw new Error(
          "Historian paginated response exceeds the 50,000-row limit.",
        );
      rows.push(
        ...pageRows.map((row) =>
          applyMapping(
            row,
            source.column_mapping,
            source.value_mappings,
            source.constants,
          ),
        ),
      );
      pageCount += 1;
      current =
        mode === "next_url"
          ? nextPage(page.payload, nextPath, current, initial)
          : null;
    }
    transportComplete = true;

    if (dryRun) {
      const totals = { read: 0, accepted: 0, duplicate: 0, rejected: 0 };
      const results: unknown[] = [];
      for (let index = 0; index < rows.length; index += 500) {
        const preview = await rpc<{
          read: number;
          accepted: number;
          duplicate: number;
          rejected: number;
          results: unknown[];
        }>(client, "preview_plant_historian_batch", {
          p_connector_key: connectorKey,
          p_rows: rows.slice(index, index + 500),
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
        pages: pageCount,
        rows: totals.read,
        rejected: totals.rejected,
      });
      return json({
        dry_run: true,
        transport_complete: transportComplete,
        pages: pageCount,
        bytes: totalBytes,
        ...totals,
        results,
        note: "All approved pages were read. No canonical or staging rows were written.",
      });
    }

    const started = await rpc<{ run_id: string }>(
      client,
      "begin_plant_historian_run",
      { p_connector_key: connectorKey },
    );
    runId = started.run_id;
    const totals = { read: 0, accepted: 0, duplicate: 0, rejected: 0 };
    for (let index = 0; index < rows.length; index += 500) {
      const batch = await rpc<typeof totals>(
        client,
        "ingest_plant_historian_batch",
        {
          p_run_id: runId,
          p_rows: rows.slice(index, index + 500),
        },
      );
      totals.read += batch.read;
      totals.accepted += batch.accepted;
      totals.duplicate += batch.duplicate;
      totals.rejected += batch.rejected;
    }
    const status = totals.rejected > 0 ? "partial" : "success";
    await rpc(client, "finish_connector_run", {
      p_run_id: runId,
      p_status: status,
      p_error: null,
    });
    safeLog("sync_complete", {
      connectorKey,
      runId,
      status,
      pages: pageCount,
      ...totals,
    });
    return json({
      dry_run: false,
      transport_complete: transportComplete,
      run_id: runId,
      status,
      pages: pageCount,
      bytes: totalBytes,
      ...totals,
    });
  } catch (error) {
    if (runId) {
      try {
        await rpc(client, "finish_connector_run", {
          p_run_id: runId,
          p_status: "failed",
          p_error:
            "Plant historian adapter failed; inspect Edge Function logs.",
        });
      } catch {
        // The original error remains primary; the open run is visible for diagnosis.
      }
    }
    safeLog("request_failed", {
      connectorKey,
      runId,
      error: String(error),
    });
    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Plant historian pull failed.",
      },
      422,
    );
  }
});
