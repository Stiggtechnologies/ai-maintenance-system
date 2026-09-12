// develop-operational-readiness-agent — D12.14 / spec §64, advisory only.
//
// Answers "could operations take ownership tomorrow?" from the ONE governed
// Operational Readiness Index. The caller JWT is used for the canonical RPC;
// there is no service role, table write, readiness completion or acceptance
// path in this function.

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  analyzeOperationalReadiness,
  type OperationalReadinessAgentView,
} from "../_shared/develop-operational-readiness-core.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const ALLOWED_ORIGIN =
  Deno.env.get("ALLOWED_ORIGIN") ?? "https://app.syncai.ca";

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

function bearer(req: Request): string {
  const header = req.headers.get("Authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!SUPABASE_URL || !ANON_KEY)
    return json({ error: "function is not configured" }, 500);

  const token = bearer(req);
  if (!token) return json({ error: "authentication required" }, 401);
  const caller = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: authData, error: authError } = await caller.auth.getUser();
  if (authError || !authData.user)
    return json({ error: "authentication required" }, 401);

  let body: { case_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }
  const caseId = String(body.case_id ?? "");
  if (!caseId) return json({ error: "case_id is required" }, 400);

  // SECURITY DEFINER RPC with explicit app_current_org filtering, invoked as
  // the caller. A foreign or guessed case yields only the canonical refusal.
  const { data, error } = await caller.rpc(
    "get_case_operational_readiness_index",
    { p_case_id: caseId },
  );
  if (error) return json({ error: error.message }, 400);
  const view = data as OperationalReadinessAgentView & { error?: string };
  if (!view || typeof view !== "object" || view.error)
    return json(
      { error: view?.error ?? "operational readiness unavailable" },
      404,
    );

  return json({
    advisory: true,
    caseId,
    question: "Could operations take ownership tomorrow?",
    analysis: analyzeOperationalReadiness(view),
    narrativeSource: "deterministic_governed_records",
    decisionBoundary: view.decisionBoundary ?? null,
    disclaimer:
      "Advisory readiness explanation only. The agent cannot accept handover, approve go-live, authorize energization, complete a readiness item, or replace the named human receiving authority.",
  });
});
