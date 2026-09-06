// cmms-read-pull — user-triggered, read-only HTTPS JSON work-order import.
// Source configuration, mapping and opaque credential binding are tenant-owned
// and administrator-approved. This function never writes to a source CMMS.
import { createClient } from "npm:@supabase/supabase-js@2";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN") ?? "https://app.syncai.ca";
const allowedHosts = (Deno.env.get("CMMS_READ_ALLOWED_HOSTS") ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
const credentials = Deno.env.get("CMMS_READ_CREDENTIALS_JSON") ?? "{}";
const cors = { "Access-Control-Allow-Origin": allowedOrigin, "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", Vary: "Origin" };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });

function endpoint(value: string): URL {
  const out = new URL(value); const host = out.hostname.toLowerCase();
  const privateIpv4 = /^(10|127|0)\.|^169\.254\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (out.protocol !== "https:" || out.username || out.password || (out.port && out.port !== "443") || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host === "::1" || privateIpv4) throw new Error("Configured endpoint is not a credential-free public HTTPS URL.");
  if (!allowedHosts.length) throw new Error("CMMS pull is not configured: CMMS_READ_ALLOWED_HOSTS is empty.");
  if (!allowedHosts.includes(host)) throw new Error("Configured endpoint host is not in the deployment allowlist.");
  return out;
}
function headers(binding: string): Record<string, string> {
  let registry: Record<string, unknown>; try { registry = JSON.parse(credentials); } catch { throw new Error("CMMS credential registry is not valid JSON."); }
  const entry = registry[binding]; if (!entry) throw new Error("Configured credential binding is not present in the Edge Function secret registry.");
  if (typeof entry === "string") return { Authorization: `Bearer ${entry}` };
  if (!entry || typeof entry !== "object") throw new Error("Configured credential binding is invalid.");
  const record = entry as { type?: string; header?: string; value?: string }; const value = record.value ?? "";
  if (!value || /[\r\n]/.test(value)) throw new Error("Configured credential binding is empty or invalid.");
  if (record.type === "header") { const header = record.header ?? ""; if (!/^(x-api-key|api-key)$/i.test(header)) throw new Error("Only x-api-key or api-key custom credential headers are permitted."); return { [header]: value }; }
  return { Authorization: `Bearer ${value}` };
}
function rows(payload: unknown, path: string): Array<Record<string, unknown>> {
  let value = payload; for (const part of path.split(".").filter(Boolean)) { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Configured source array path does not exist."); value = (value as Record<string, unknown>)[part]; }
  if (!Array.isArray(value) || value.length > 10_000 || value.some((row) => !row || typeof row !== "object" || Array.isArray(row))) throw new Error("Source must return at most 10,000 JSON-object work-order rows.");
  return value as Array<Record<string, unknown>>;
}
function map(row: Record<string, unknown>, mapping: Record<string, string>) { const out: Record<string, unknown> = {}; for (const [target, source] of Object.entries(mapping)) if (row[source] !== undefined && row[source] !== null && row[source] !== "") out[target] = row[source]; return out; }
async function rpc(client: ReturnType<typeof createClient>, name: string, args: Record<string, unknown>) { const { data, error } = await client.rpc(name, args); if (error) throw new Error(error.message); const payload = data as { error?: string } | null; if (payload?.error) throw new Error(payload.error); return data as Record<string, unknown>; }

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return reply({ error: "method_not_allowed" }, 405);
  const authorization = request.headers.get("Authorization") ?? ""; if (!authorization.startsWith("Bearer ")) return reply({ error: "unauthorized" }, 401);
  const client = createClient(url, anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
  const { data: user, error: authError } = await client.auth.getUser(); if (authError || !user.user) return reply({ error: "unauthorized" }, 401);
  let body: { connector_key?: unknown; dry_run?: unknown }; try { body = await request.json(); } catch { return reply({ error: "invalid_json" }, 400); }
  const key = typeof body.connector_key === "string" ? body.connector_key.trim() : ""; const dryRun = body.dry_run !== false; if (!key) return reply({ error: "connector_key is required" }, 400);
  let runId: string | null = null;
  try {
    const source = await rpc(client, "get_cmms_read_source", { p_connector_key: key });
    if (!source.enabled || source.direction !== "read_only" || source.write_enabled || source.mapping_status !== "approved") throw new Error("CMMS source is not enabled, read-only and mapping-approved.");
    if (typeof source.endpoint_url !== "string" || typeof source.credential_binding_ref !== "string" || !source.endpoint_url || !source.credential_binding_ref) throw new Error("CMMS source endpoint or credential binding is not configured.");
    const response = await fetch(endpoint(source.endpoint_url), { headers: { Accept: "application/json", ...headers(source.credential_binding_ref) }, redirect: "error", signal: AbortSignal.timeout(20_000) });
    if (!response.ok || !(response.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) throw new Error("CMMS source did not return successful application/json.");
    const raw = await response.text(); if (new TextEncoder().encode(raw).byteLength > 10 * 1024 * 1024) throw new Error("CMMS response exceeds the 10 MB pull limit.");
    const mapped = rows(JSON.parse(raw), String(source.source_array_path ?? "")).map((row) => map(row, source.column_mapping as Record<string, string>));
    const totals = { read: 0, accepted: 0, duplicate: 0, rejected: 0 };
    if (dryRun) {
      for (let i = 0; i < mapped.length; i += 500) { const result = await rpc(client, "preview_cmms_work_order_batch", { p_connector_key: key, p_rows: mapped.slice(i, i + 500) }); for (const k of Object.keys(totals) as Array<keyof typeof totals>) totals[k] += Number(result[k] ?? 0); }
      return reply({ dry_run: true, ...totals, note: "No canonical or staging rows were written." });
    }
    const run = await rpc(client, "begin_cmms_read_run", { p_connector_key: key }); runId = String(run.run_id);
    for (let i = 0; i < mapped.length; i += 500) { const result = await rpc(client, "ingest_cmms_read_batch", { p_run_id: runId, p_rows: mapped.slice(i, i + 500) }); for (const k of Object.keys(totals) as Array<keyof typeof totals>) totals[k] += Number(result[k] ?? 0); }
    await rpc(client, "finish_connector_run", { p_run_id: runId, p_status: totals.rejected ? "partial" : "success", p_error: null });
    return reply({ dry_run: false, status: totals.rejected ? "partial" : "success", run_id: runId, ...totals });
  } catch (error) {
    if (runId) { try { await rpc(client, "finish_connector_run", { p_run_id: runId, p_status: "failure", p_error: String((error as Error).message).slice(0, 500) }); } catch { /* preserve original error */ } }
    return reply({ error: (error as Error).message }, 400);
  }
});
