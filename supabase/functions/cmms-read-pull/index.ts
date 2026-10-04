// cmms-read-pull — user-triggered, read-only HTTPS JSON work-order import.
// Source configuration, mapping, pagination and opaque credential binding are
// tenant-owned and administrator-approved. This function never writes to a
// source CMMS and never opens a canonical run until transport is complete.
import { createClient } from "npm:@supabase/supabase-js@2";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN") ?? "https://app.syncai.ca";
const allowedHosts = (Deno.env.get("CMMS_READ_ALLOWED_HOSTS") ?? "")
  .split(",")
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);
const credentials = Deno.env.get("CMMS_READ_CREDENTIALS_JSON") ?? "{}";
const MAX_TOTAL_ROWS = 50_000;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;
const MAX_PAGE_ROWS = 10_000;
const MAX_PAGE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_DURATION_MS = 55_000;
const cors = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  Vary: "Origin",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });

function endpoint(value: string): URL {
  const out = new URL(value);
  const host = out.hostname.toLowerCase();
  const privateIpv4 =
    /^(10|127|0)\.|^169\.254\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(
      host,
    );
  if (
    out.protocol !== "https:" ||
    out.username ||
    out.password ||
    (out.port && out.port !== "443") ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host === "::1" ||
    privateIpv4
  ) {
    throw new Error(
      "Configured endpoint is not a credential-free public HTTPS URL.",
    );
  }
  if (!allowedHosts.length) {
    throw new Error(
      "CMMS pull is not configured: CMMS_READ_ALLOWED_HOSTS is empty.",
    );
  }
  if (!allowedHosts.includes(host)) {
    throw new Error(
      "Configured endpoint host is not in the deployment allowlist.",
    );
  }
  out.hash = "";
  return out;
}

function headers(binding: string, tenantId: string): Record<string, string> {
  let registry: Record<string, unknown>;
  try {
    registry = JSON.parse(credentials);
  } catch {
    throw new Error("CMMS credential registry is not valid JSON.");
  }
  const entry = registry[binding];
  if (!entry) {
    throw new Error(
      "Configured credential binding is not present in the Edge Function secret registry.",
    );
  }
  if (!entry || typeof entry !== "object") {
    throw new Error("Configured credential binding is invalid.");
  }
  const record = entry as {
    tenant_id?: string;
    type?: string;
    header?: string;
    value?: string;
  };
  if (!tenantId || record.tenant_id !== tenantId) {
    throw new Error(
      "Configured credential binding is not assigned to the active tenant.",
    );
  }
  const value = record.value ?? "";
  if (!value || /[\r\n]/.test(value)) {
    throw new Error("Configured credential binding is empty or invalid.");
  }
  if (record.type === "header") {
    const header = record.header ?? "";
    if (!/^(x-api-key|api-key)$/i.test(header)) {
      throw new Error(
        "Only x-api-key or api-key custom credential headers are permitted.",
      );
    }
    return { [header]: value };
  }
  return { Authorization: `Bearer ${value}` };
}

function valueAtPath(payload: unknown, path: string): unknown {
  let value = payload;
  for (const part of path.split(".").filter(Boolean)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

function rows(payload: unknown, path: string): Array<Record<string, unknown>> {
  const value = valueAtPath(payload, path);
  if (
    !Array.isArray(value) ||
    value.length > MAX_PAGE_ROWS ||
    value.some((row) => !row || typeof row !== "object" || Array.isArray(row))
  ) {
    throw new Error(
      "Each CMMS page must contain at most 10,000 JSON-object work-order rows at the approved source array path.",
    );
  }
  return value as Array<Record<string, unknown>>;
}

function map(row: Record<string, unknown>, mapping: Record<string, string>) {
  const out: Record<string, unknown> = {};
  for (const [target, source] of Object.entries(mapping)) {
    if (
      row[source] !== undefined &&
      row[source] !== null &&
      row[source] !== ""
    ) {
      out[target] = row[source];
    }
  }
  return out;
}

function nextPage(
  payload: unknown,
  path: string,
  current: URL,
  initial: URL,
): URL | null {
  const value = valueAtPath(payload, path);
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new Error("CMMS next-page value must be a URL string or null.");
  }
  const next = endpoint(new URL(value, current).href);
  if (next.origin !== initial.origin) {
    throw new Error(
      "CMMS next-page URL must remain on the approved source origin.",
    );
  }
  return next;
}

async function rpc(
  client: ReturnType<typeof createClient>,
  name: string,
  args: Record<string, unknown>,
) {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(error.message);
  const payload = data as { error?: string } | null;
  if (payload?.error) throw new Error(payload.error);
  return data as Record<string, unknown>;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS")
    return new Response("ok", { headers: cors });
  if (request.method !== "POST") {
    return reply({ error: "method_not_allowed" }, 405);
  }
  const authorization = request.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) {
    return reply({ error: "unauthorized" }, 401);
  }
  const client = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data: user, error: authError } = await client.auth.getUser();
  if (authError || !user.user) return reply({ error: "unauthorized" }, 401);

  let body: { connector_key?: unknown; dry_run?: unknown };
  try {
    body = await request.json();
  } catch {
    return reply({ error: "invalid_json" }, 400);
  }
  const key =
    typeof body.connector_key === "string" ? body.connector_key.trim() : "";
  const dryRun = body.dry_run !== false;
  if (!key) return reply({ error: "connector_key is required" }, 400);

  let runId: string | null = null;
  try {
    const source = await rpc(client, "get_cmms_read_source", {
      p_connector_key: key,
    });
    if (
      source.direction !== "read_only" ||
      source.write_enabled
    ) {
      throw new Error("CMMS source is not governed as read-only.");
    }
    if (
      !dryRun &&
      (!source.enabled || source.mapping_status !== "approved")
    ) {
      throw new Error(
        "Canonical CMMS promotion requires an enabled source and a human-approved mapping.",
      );
    }
    if (!dryRun && source.can_commit !== true) {
      throw new Error(
        "A named human planning, engineering, maintenance or administrator role must trigger canonical CMMS promotion.",
      );
    }
    if (
      typeof source.endpoint_url !== "string" ||
      typeof source.credential_binding_ref !== "string" ||
      !source.endpoint_url ||
      !source.credential_binding_ref
    ) {
      throw new Error(
        "CMMS source endpoint or credential binding is not configured.",
      );
    }
    if (
      !source.column_mapping ||
      typeof source.column_mapping !== "object" ||
      Array.isArray(source.column_mapping)
    ) {
      throw new Error("CMMS source mapping is invalid.");
    }

    const mode = String(source.pagination_mode ?? "none");
    const maxPages = Number(source.pagination_max_pages ?? 1);
    const nextPath = String(source.pagination_next_path ?? "");
    if (!["none", "next_url"].includes(mode)) {
      throw new Error("CMMS pagination mode is invalid.");
    }
    if (
      !Number.isInteger(maxPages) ||
      (mode === "none" && maxPages !== 1) ||
      (mode === "next_url" && (maxPages < 2 || maxPages > 100 || !nextPath))
    ) {
      throw new Error("CMMS pagination profile is invalid.");
    }

    const initial = endpoint(source.endpoint_url);
    let current: URL | null = initial;
    let pageCount = 0;
    let totalBytes = 0;
    const mapped: Array<Record<string, unknown>> = [];
    const visited = new Set<string>();
    let transportComplete = false;
    const transportStartedAt = Date.now();

    while (current) {
      if (pageCount >= maxPages) {
        throw new Error("CMMS pagination exceeded its approved page limit.");
      }
      if (visited.has(current.href)) {
        throw new Error("CMMS pagination loop detected.");
      }
      const remainingMs =
        MAX_TOTAL_DURATION_MS - (Date.now() - transportStartedAt);
      if (remainingMs <= 0) {
        throw new Error(
          "CMMS pagination exceeded its total transport time limit.",
        );
      }
      visited.add(current.href);
      const response = await fetch(current, {
        headers: {
          Accept: "application/json",
          ...headers(
            source.credential_binding_ref,
            String(source.credential_tenant_id ?? ""),
          ),
        },
        redirect: "error",
        signal: AbortSignal.timeout(Math.min(20_000, remainingMs)),
      });
      if (
        !response.ok ||
        !(response.headers.get("content-type") ?? "")
          .toLowerCase()
          .includes("application/json")
      ) {
        throw new Error(
          "CMMS source did not return successful application/json.",
        );
      }
      const raw = await response.text();
      const pageBytes = new TextEncoder().encode(raw).byteLength;
      if (pageBytes > MAX_PAGE_BYTES) {
        throw new Error("CMMS response page exceeds the 10 MB limit.");
      }
      totalBytes += pageBytes;
      if (totalBytes > MAX_TOTAL_BYTES) {
        throw new Error(
          "CMMS paginated response exceeds the 50 MB total limit.",
        );
      }
      const payload = JSON.parse(raw) as unknown;
      const pageRows = rows(payload, String(source.source_array_path ?? ""));
      if (mapped.length + pageRows.length > MAX_TOTAL_ROWS) {
        throw new Error(
          "CMMS paginated response exceeds the 50,000-row limit.",
        );
      }
      const mapping = source.column_mapping as Record<string, string>;
      mapped.push(...pageRows.map((row) => map(row, mapping)));
      pageCount += 1;
      current =
        mode === "next_url"
          ? nextPage(payload, nextPath, current, initial)
          : null;
    }
    transportComplete = true;

    const totals = { read: 0, accepted: 0, duplicate: 0, rejected: 0 };
    if (dryRun) {
      for (let index = 0; index < mapped.length; index += 500) {
        const result = await rpc(client, "preview_cmms_work_order_batch", {
          p_connector_key: key,
          p_rows: mapped.slice(index, index + 500),
        });
        for (const field of Object.keys(totals) as Array<keyof typeof totals>) {
          totals[field] += Number(result[field] ?? 0);
        }
      }
      return reply({
        dry_run: true,
        transport_complete: transportComplete,
        pages: pageCount,
        bytes: totalBytes,
        ...totals,
        note: "All approved pages were read. No canonical or staging rows were written.",
      });
    }

    const run = await rpc(client, "begin_cmms_read_run", {
      p_connector_key: key,
      p_expected_contract_hash: String(source.contract_hash ?? ""),
    });
    runId = String(run.run_id);
    for (let index = 0; index < mapped.length; index += 500) {
      const result = await rpc(client, "ingest_cmms_read_batch", {
        p_run_id: runId,
        p_rows: mapped.slice(index, index + 500),
      });
      for (const field of Object.keys(totals) as Array<keyof typeof totals>) {
        totals[field] += Number(result[field] ?? 0);
      }
    }
    await rpc(client, "finish_connector_run", {
      p_run_id: runId,
      p_status: totals.rejected ? "partial" : "success",
      p_error: null,
    });
    return reply({
      dry_run: false,
      transport_complete: transportComplete,
      status: totals.rejected ? "partial" : "success",
      run_id: runId,
      pages: pageCount,
      bytes: totalBytes,
      ...totals,
    });
  } catch (error) {
    if (runId) {
      try {
        await rpc(client, "finish_connector_run", {
          p_run_id: runId,
          p_status: "failure",
          p_error: String((error as Error).message).slice(0, 500),
        });
      } catch {
        // Preserve the original error.
      }
    }
    return reply({ error: (error as Error).message }, 400);
  }
});
