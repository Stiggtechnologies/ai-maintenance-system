/**
 * integration-connect Edge Function
 * =================================
 * Stores credentials for a per-org integration instance and immediately
 * runs a connectivity test if the catalog entry has has_test_endpoint = true.
 *
 * Request body:
 *   {
 *     catalog_code: string;          // e.g. "anthropic", "sap_pm"
 *     name: string;                  // human-readable, e.g. "ACME Production SAP"
 *     credentials: Record<string, unknown>; // shape per credentials_schema
 *     config?: Record<string, unknown>;     // non-sensitive (base URLs, etc.)
 *     organization_id?: string;      // resolved from auth if omitted
 *   }
 *
 * Response:
 *   { ok: true, integration_id: string, status: 'connected'|'error'|'connecting',
 *     test_result?: { ok: boolean; latency_ms?: number; error?: string } }
 *
 * Schema dependency: 013_integrations.sql
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface ConnectRequest {
  catalog_code: string;
  name: string;
  credentials: Record<string, unknown>;
  config?: Record<string, unknown>;
  organization_id?: string;
}

interface CatalogEntry {
  code: string;
  vendor: string;
  product: string;
  auth_type: string;
  credentials_schema: Record<string, unknown>;
  has_test_endpoint: boolean;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  try {
    const body = (await req.json().catch(() => ({}))) as ConnectRequest;
    const v = validate(body);
    if (v.error) return json({ ok: false, error: v.error, error_code: "INVALID_REQUEST" }, 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return json({ ok: false, error: "Server misconfigured", error_code: "MISSING_ENV" }, 500);

    const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const auth = await resolveAuth(supabase, req, body.organization_id);
    if (!auth.ok) return json({ ok: false, error: auth.error, error_code: "AUTH" }, 401);

    // 1. Fetch catalog entry & validate credentials shape
    const { data: catalog, error: catalogErr } = await supabase
      .from("integration_catalog")
      .select("code, vendor, product, auth_type, credentials_schema, has_test_endpoint, is_active")
      .eq("code", body.catalog_code)
      .maybeSingle();

    if (catalogErr) return json({ ok: false, error: `Catalog lookup failed: ${catalogErr.message}` }, 500);
    if (!catalog || !catalog.is_active) return json({ ok: false, error: `Unknown or inactive catalog_code: ${body.catalog_code}`, error_code: "UNKNOWN_INTEGRATION" }, 404);

    const schemaCheck = validateAgainstSchema(body.credentials, catalog.credentials_schema as Record<string, unknown>);
    if (!schemaCheck.ok) return json({ ok: false, error: schemaCheck.error, error_code: "CREDENTIALS_INVALID" }, 400);

    // 2. Upsert with encrypted credentials
    const { data: idResult, error: upsertErr } = await supabase.rpc("integration_upsert_with_credentials", {
      p_organization_id: auth.organizationId,
      p_catalog_code: body.catalog_code,
      p_name: body.name,
      p_credentials: body.credentials,
      p_config: body.config ?? {},
      p_user_id: auth.userId,
    });
    if (upsertErr) return json({ ok: false, error: `Persist failed: ${upsertErr.message}`, error_code: "PERSIST" }, 500);

    const integrationId = idResult as string;

    // 3. If catalog has a real test endpoint, run a roundtrip immediately
    let testResult: { ok: boolean; latency_ms?: number; error?: string } | undefined;
    if (catalog.has_test_endpoint) {
      testResult = await runConnectivityTest(catalog as CatalogEntry, body.credentials);
      await supabase.rpc("integration_record_result", {
        p_id: integrationId,
        p_event_type: testResult.ok ? "connect_success" : "connect_failure",
        p_success: testResult.ok,
        p_health: testResult.ok ? 100 : 0,
        p_error: testResult.error ?? null,
        p_details: { latency_ms: testResult.latency_ms ?? null },
      });
    } else {
      // Catalog entry has no live test — mark as connected pending real adapter
      await supabase.rpc("integration_record_result", {
        p_id: integrationId,
        p_event_type: "connect_success",
        p_success: true,
        p_health: 75,
        p_error: null,
        p_details: { note: "credential validation only; no live test endpoint yet" },
      });
    }

    const finalStatus = testResult ? (testResult.ok ? "connected" : "error") : "connected";
    return json({ ok: true, integration_id: integrationId, status: finalStatus, test_result: testResult });
  } catch (err) {
    console.error("[integration-connect] uncaught", err);
    return json({ ok: false, error: String((err as Error)?.message ?? err), error_code: "INTERNAL" }, 500);
  }
});

function validate(body: ConnectRequest): { error?: string } {
  if (!body || typeof body !== "object") return { error: "Missing JSON body" };
  if (!body.catalog_code) return { error: "catalog_code is required" };
  if (!body.name || typeof body.name !== "string") return { error: "name is required" };
  if (!body.credentials || typeof body.credentials !== "object") return { error: "credentials object is required" };
  return {};
}

/**
 * Minimal JSON-Schema validator covering the fields we use:
 *   { type: "object", required: [...], properties: { x: { type, format } } }
 * Not a full JSON Schema implementation — sufficient for catalog schemas.
 */
function validateAgainstSchema(
  data: Record<string, unknown>,
  schema: Record<string, unknown>,
): { ok: true } | { ok: false; error: string } {
  if (!schema || schema.type !== "object") return { ok: true };
  const required = (schema.required as string[] | undefined) ?? [];
  for (const field of required) {
    const v = data[field];
    if (v === undefined || v === null || v === "") {
      return { ok: false, error: `credentials.${field} is required` };
    }
  }
  const props = (schema.properties as Record<string, { type?: string }> | undefined) ?? {};
  for (const [key, def] of Object.entries(props)) {
    if (data[key] === undefined) continue;
    if (def.type === "string" && typeof data[key] !== "string") {
      return { ok: false, error: `credentials.${key} must be a string` };
    }
  }
  return { ok: true };
}

async function resolveAuth(
  supabase: SupabaseClient,
  req: Request,
  fallbackOrgId?: string,
): Promise<{ ok: true; userId: string | null; organizationId: string } | { ok: false; error: string }> {
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (token) {
    const { data: userResult } = await supabase.auth.getUser(token);
    if (userResult?.user) {
      const { data: profile } = await supabase
        .from("user_profiles")
        .select("organization_id")
        .eq("id", userResult.user.id)
        .maybeSingle();
      if (profile?.organization_id) {
        return { ok: true, userId: userResult.user.id, organizationId: profile.organization_id };
      }
    }
  }

  if (fallbackOrgId) return { ok: true, userId: null, organizationId: fallbackOrgId };
  return { ok: false, error: "No organization context — pass Authorization: Bearer <jwt> or organization_id" };
}

/**
 * Run a real connectivity test for catalog entries with has_test_endpoint = true.
 *
 * Currently implemented: anthropic, openai (lightweight model listing /
 * minimal completion call). Other vendors return ok:true with a note —
 * they're connected at the credential level until a real adapter ships.
 */
async function runConnectivityTest(
  catalog: CatalogEntry,
  credentials: Record<string, unknown>,
): Promise<{ ok: boolean; latency_ms?: number; error?: string }> {
  const t0 = Date.now();
  try {
    if (catalog.code === "anthropic") {
      const apiKey = credentials.api_key as string;
      const model = (credentials.model as string) ?? "claude-haiku-4-5-20251001";

      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          max_tokens: 16,
          messages: [{ role: "user", content: "Reply with the single word: ok" }],
        }),
      });
      const latency = Date.now() - t0;

      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        return { ok: false, latency_ms: latency, error: `HTTP ${res.status}: ${errBody.slice(0, 200)}` };
      }
      return { ok: true, latency_ms: latency };
    }

    if (catalog.code === "openai") {
      const apiKey = credentials.api_key as string;
      const res = await fetch("https://api.openai.com/v1/models", {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const latency = Date.now() - t0;
      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        return { ok: false, latency_ms: latency, error: `HTTP ${res.status}: ${errBody.slice(0, 200)}` };
      }
      return { ok: true, latency_ms: latency };
    }

    // Default: no live test, but credentials format was already validated
    return { ok: true, latency_ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, latency_ms: Date.now() - t0, error: (e as Error).message };
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
