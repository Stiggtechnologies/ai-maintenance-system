// develop-benefits-agent — D12.16 / spec §66, advisory only.
//
// Answers "did we get what we paid for?" by consuming the ONE governed
// benefits screen. It does not accept caller-supplied values, recompute the
// baseline, infer missing actuals, or claim that an attribution proves cause.
// Every number and source reference originates in get_case_benefits_screen.
// The function has no write client and therefore cannot verify value, allocate
// leakage, approve investment, or change an operating record.

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  analyzeBenefits,
  type BenefitAgentScreen,
} from "../_shared/develop-benefits-core.ts";

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

  // SECURITY INVOKER RPC, called with the user's JWT. A case outside their
  // tenant is indistinguishable from a missing case and yields no analysis.
  const { data, error } = await caller.rpc("get_case_benefits_screen", {
    p_case_id: caseId,
  });
  if (error) return json({ error: error.message }, 400);
  const screen = data as BenefitAgentScreen | { error?: string };
  if (!screen || typeof screen !== "object" || "error" in screen)
    return json(
      {
        error:
          "error" in (screen ?? {})
            ? screen.error
            : "benefits screen unavailable",
      },
      404,
    );

  return json({
    advisory: true,
    caseId,
    analysis: analyzeBenefits(screen),
    narrativeSource: "deterministic_governed_records",
    disclaimer:
      "Advisory comparison only. Recorded leakage attribution is an evidence statement, not proof of causation. A named human must verify value records and separately authorize any investment or operational action.",
  });
});
