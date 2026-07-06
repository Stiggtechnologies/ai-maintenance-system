// agent-loop-enrich — LLM enrichment for loop-raised recommendations.
//
// The continuous agent loop (run_agent_loop) raises deterministic PENDING
// recommendations from sensor state. This function upgrades their rationale
// with real model reasoning via the Stigg AI Gateway (OpenAI-compatible).
//
// Design constraints:
//   - FAIL-SOFT: no LLM secrets configured → {skipped: "llm_not_configured"};
//     any LLM/network error → the recommendation stays deterministic. The
//     loop never depends on this function succeeding.
//   - HITL preserved: enrichment only edits rationale/confidence metadata on
//     PENDING recommendations. It never changes status, never approves.
//   - Service-role only: invoked by pg_cron (via pg_net) or operators.
//
// Secrets (supabase secrets set):
//   LLM_BASE_URL  e.g. https://stigg-ai-gateway.fly.dev
//   LLM_API_KEY   virtual key `ai-maintenance-system-staging` from the gateway
//   LLM_MODEL     optional, default "stigg/fast"

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
// ENRICH_* lets this background surface use a different (cheaper) provider
// than the interactive copilot, which owns LLM_BASE_URL/OPENAI_API_KEY.
const LLM_BASE_URL =
  Deno.env.get("ENRICH_LLM_BASE_URL") ?? Deno.env.get("LLM_BASE_URL") ?? "";
const LLM_API_KEY =
  Deno.env.get("ENRICH_LLM_API_KEY") ?? Deno.env.get("LLM_API_KEY") ?? "";
const LLM_MODEL =
  Deno.env.get("ENRICH_LLM_MODEL") ?? Deno.env.get("LLM_MODEL") ?? "stigg/fast";
// Dedicated caller secret — decoupled from platform key formats. Set with:
//   supabase secrets set ENRICH_SHARED_SECRET=<random>
const ENRICH_SHARED_SECRET = Deno.env.get("ENRICH_SHARED_SECRET") ?? "";

const BATCH_LIMIT = 5;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Platform-only — accept the injected service key or our dedicated secret.
  const auth = req.headers.get("Authorization") ?? "";
  const authorized =
    (SERVICE_ROLE_KEY && auth === `Bearer ${SERVICE_ROLE_KEY}`) ||
    (ENRICH_SHARED_SECRET && auth === `Bearer ${ENRICH_SHARED_SECRET}`);
  if (!authorized) {
    return json({ error: "service role required" }, 401);
  }

  if (!LLM_BASE_URL || !LLM_API_KEY) {
    return json({ enriched: 0, skipped: "llm_not_configured" });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: recs, error } = await supabase
    .from("recommendations")
    .select("id, organization_id, asset_id, title, issue, action, confidence, urgency")
    .like("rationale", "Raised by the continuous%")
    .is("enriched_at", null)
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(BATCH_LIMIT);

  if (error) return json({ enriched: 0, skipped: `query_failed: ${error.message}` });
  if (!recs || recs.length === 0) return json({ enriched: 0, skipped: "nothing_to_enrich" });

  const providerInfo = { base: LLM_BASE_URL, model: LLM_MODEL, key_len: LLM_API_KEY.length };

  let enriched = 0;
  const failures: string[] = [];

  for (const rec of recs) {
    try {
      const resp = await fetch(`${LLM_BASE_URL}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${LLM_API_KEY}`,
        },
        body: JSON.stringify({
          model: LLM_MODEL,
          temperature: 0.3,
          max_completion_tokens: 1500,
          messages: [
            {
              role: "system",
              content:
                "You are a senior reliability engineer for asset-intensive industry. " +
                "Given a condition-monitoring finding, return strict JSON: " +
                '{"analysis": "2-3 sentence engineering assessment of likely failure mechanism and consequence", ' +
                '"recommended_window_hours": <number>, "confidence": <0-100 integer>}. ' +
                "Be specific and conservative; never advise bypassing approvals.",
            },
            {
              role: "user",
              content: `Finding: ${rec.title}\nSensor detail: ${rec.issue}\nCurrent proposed action: ${rec.action}\nUrgency: ${rec.urgency}`,
            },
          ],
        }),
      });

      if (!resp.ok) {
        const errBody = (await resp.text()).slice(0, 180);
        failures.push(`${rec.id}: HTTP ${resp.status} — ${errBody}`);
        continue;
      }

      const data = await resp.json();
      const content: string = data.choices?.[0]?.message?.content ?? "";
      // Providers differ on JSON-mode support — extract the first JSON object.
      const match = content.match(/\{[\s\S]*\}/);
      const parsed = match ? JSON.parse(match[0]) : {};
      if (!parsed.analysis) {
        failures.push(`${rec.id}: no analysis in response`);
        continue;
      }

      const confidence = Math.min(
        95,
        Math.max(rec.confidence ?? 70, Math.round(Number(parsed.confidence) || 0)),
      );

      await supabase
        .from("recommendations")
        .update({
          rationale:
            `AI analysis (${LLM_MODEL}): ${parsed.analysis} ` +
            `Suggested action window: ${parsed.recommended_window_hours ?? "n/a"}h. ` +
            "Raised by the continuous condition-monitoring loop; human approval required before any action.",
          confidence,
          enriched_at: new Date().toISOString(),
          enrichment_model: LLM_MODEL,
          updated_at: new Date().toISOString(),
        })
        .eq("id", rec.id)
        .eq("status", "pending"); // never touch anything a human already actioned

      await supabase.from("agent_runs").insert({
        organization_id: rec.organization_id,
        asset_id: rec.asset_id,
        status: "completed",
        summary: `LLM enrichment: ${rec.title}`,
        confidence,
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      });

      enriched += 1;
    } catch (e) {
      failures.push(`${rec.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return json({ enriched, of: recs.length, failures, provider: providerInfo });
});
