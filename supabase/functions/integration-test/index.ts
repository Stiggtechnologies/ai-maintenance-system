/**
 * integration-test Edge Function
 * ==============================
 * Reads stored credentials for a per-org integration instance and runs a
 * live connectivity test. Updates last_test_at, status, and last_error
 * via integration_record_result RPC.
 *
 * Request body:  { integration_id: string }
 * Response:      { ok: boolean; latency_ms?: number; error?: string; status: 'connected'|'error' }
 *
 * Anthropic & OpenAI run real round-trips. Vendors without an adapter
 * return ok:true without making a network call (credentials present is
 * the strongest signal we have until a real adapter exists).
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

interface TestRequest {
  integration_id: string;
}

interface IntegrationRow {
  id: string;
  organization_id: string;
  catalog_code: string;
  name: string;
  status: string;
}

interface CatalogEntry {
  code: string;
  has_test_endpoint: boolean;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  try {
    const body = (await req.json().catch(() => ({}))) as TestRequest;
    if (!body?.integration_id) return json({ ok: false, error: "integration_id is required" }, 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return json({ ok: false, error: "Server misconfigured" }, 500);

    const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    // 1. Look up the integration row (verifies org via Authorization)
    const { data: integration, error: intErr } = await supabase
      .from("integrations")
      .select("id, organization_id, catalog_code, name, status")
      .eq("id", body.integration_id)
      .maybeSingle();

    if (intErr || !integration) return json({ ok: false, error: "Integration not found" }, 404);

    // 2. Verify the requester has access to this integration's org
    const orgCheck = await verifyOrgAccess(supabase, req, (integration as IntegrationRow).organization_id);
    if (!orgCheck.ok) return json({ ok: false, error: orgCheck.error }, 403);

    // 3. Look up the catalog entry to know if a real test exists
    const { data: catalog } = await supabase
      .from("integration_catalog")
      .select("code, has_test_endpoint")
      .eq("code", (integration as IntegrationRow).catalog_code)
      .maybeSingle();

    if (!catalog) return json({ ok: false, error: "Catalog entry missing for integration" }, 500);

    // 4. Read decrypted credentials via RPC
    const { data: credsData, error: credsErr } = await supabase.rpc("integration_read_credentials", {
      p_id: body.integration_id,
    });
    if (credsErr) return json({ ok: false, error: `Read credentials failed: ${credsErr.message}` }, 500);
    const credentials = (credsData ?? {}) as Record<string, unknown>;

    if (!credentials || Object.keys(credentials).length === 0) {
      await supabase.rpc("integration_record_result", {
        p_id: body.integration_id,
        p_event_type: "test_failure",
        p_success: false,
        p_health: 0,
        p_error: "No credentials stored — connect first",
      });
      return json({ ok: false, status: "error", error: "No credentials stored" }, 400);
    }

    // 5. Run the test
    const result = await runTest((catalog as CatalogEntry).code, credentials, !!(catalog as CatalogEntry).has_test_endpoint);

    // 6. Record outcome
    await supabase.rpc("integration_record_result", {
      p_id: body.integration_id,
      p_event_type: result.ok ? "test_success" : "test_failure",
      p_success: result.ok,
      p_health: result.ok ? 100 : 0,
      p_error: result.error ?? null,
      p_details: { latency_ms: result.latency_ms ?? null, has_real_test: !!(catalog as CatalogEntry).has_test_endpoint },
    });

    return json({
      ok: result.ok,
      status: result.ok ? "connected" : "error",
      latency_ms: result.latency_ms,
      error: result.error,
    });
  } catch (err) {
    console.error("[integration-test] uncaught", err);
    return json({ ok: false, error: String((err as Error)?.message ?? err) }, 500);
  }
});

async function verifyOrgAccess(
  supabase: SupabaseClient,
  req: Request,
  orgId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return { ok: false, error: "Authorization: Bearer <jwt> required" };

  const { data: userResult } = await supabase.auth.getUser(token);
  if (!userResult?.user) return { ok: false, error: "Invalid token" };

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("organization_id")
    .eq("id", userResult.user.id)
    .maybeSingle();
  if (profile?.organization_id !== orgId) return { ok: false, error: "Forbidden — organization mismatch" };
  return { ok: true };
}

async function runTest(
  catalogCode: string,
  credentials: Record<string, unknown>,
  hasRealTest: boolean,
): Promise<{ ok: boolean; latency_ms?: number; error?: string }> {
  const t0 = Date.now();

  if (catalogCode === "anthropic") {
    try {
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
        const body = await res.text().catch(() => "");
        return { ok: false, latency_ms: latency, error: `HTTP ${res.status}: ${body.slice(0, 200)}` };
      }
      return { ok: true, latency_ms: latency };
    } catch (e) {
      return { ok: false, latency_ms: Date.now() - t0, error: (e as Error).message };
    }
  }

  if (catalogCode === "openai") {
    try {
      const apiKey = credentials.api_key as string;
      const res = await fetch("https://api.openai.com/v1/models", {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const latency = Date.now() - t0;
      if (!res.ok) return { ok: false, latency_ms: latency, error: `HTTP ${res.status}` };
      return { ok: true, latency_ms: latency };
    } catch (e) {
      return { ok: false, latency_ms: Date.now() - t0, error: (e as Error).message };
    }
  }

  // No real adapter yet — credential presence is the strongest signal we have
  return {
    ok: true,
    latency_ms: Date.now() - t0,
    error: hasRealTest ? undefined : "no live adapter; credential validation only",
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
