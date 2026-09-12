// develop-lessons-agent — D12.17 / spec §67, advisory only.
//
// Compares a new development case with canonical project history through the
// ONE deterministic lesson-screening RPC. It has no service role or write
// client and cannot adopt a lesson, standard, framework or corrective action.

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  analyzeApplicableLessons,
  type LessonsAgentScreen,
} from "../_shared/develop-lessons-core.ts";

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

  // SECURITY DEFINER RPC with app_current_org filtering, invoked with the
  // caller's JWT. A guessed foreign case yields only the canonical refusal.
  const { data, error } = await caller.rpc(
    "screen_applicable_project_lessons",
    { p_case_id: caseId },
  );
  if (error) return json({ error: error.message }, 400);
  const screen = data as LessonsAgentScreen & { error?: string };
  if (!screen || typeof screen !== "object" || screen.error)
    return json(
      { error: screen?.error ?? "lesson screening unavailable" },
      404,
    );

  return json({
    advisory: true,
    caseId,
    question: "What recorded project lessons apply here?",
    analysis: analyzeApplicableLessons(screen),
    narrativeSource: "deterministic_governed_records",
    disclaimer:
      "Advisory history comparison only. A named human must confirm applicability and separately authorize any requirement, corrective action, standard change or project decision.",
  });
});
