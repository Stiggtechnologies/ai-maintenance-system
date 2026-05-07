/**
 * integration-disconnect Edge Function
 * ====================================
 * Clears stored credentials for an integration and sets its status to
 * disconnected. Records an audit event. Optionally deletes the row
 * entirely if hard_delete=true.
 *
 * Request body: { integration_id: string; hard_delete?: boolean }
 * Response:     { ok: true; integration_id: string; deleted?: boolean }
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  try {
    const body = (await req.json().catch(() => ({}))) as { integration_id: string; hard_delete?: boolean };
    if (!body?.integration_id) return json({ ok: false, error: "integration_id is required" }, 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return json({ ok: false, error: "Server misconfigured" }, 500);

    const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const { data: integration } = await supabase
      .from("integrations")
      .select("id, organization_id")
      .eq("id", body.integration_id)
      .maybeSingle();

    if (!integration) return json({ ok: false, error: "Integration not found" }, 404);

    const access = await verifyOrgAccess(supabase, req, integration.organization_id);
    if (!access.ok) return json({ ok: false, error: access.error }, 403);

    // Always record disconnect event (and clear credentials via RPC)
    await supabase.rpc("integration_record_result", {
      p_id: body.integration_id,
      p_event_type: "disconnect",
      p_success: true,
      p_health: 0,
      p_error: null,
      p_details: { hard_delete: !!body.hard_delete },
    });

    if (body.hard_delete) {
      await supabase.from("integrations").delete().eq("id", body.integration_id);
      return json({ ok: true, integration_id: body.integration_id, deleted: true });
    }

    return json({ ok: true, integration_id: body.integration_id });
  } catch (err) {
    console.error("[integration-disconnect] uncaught", err);
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

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
