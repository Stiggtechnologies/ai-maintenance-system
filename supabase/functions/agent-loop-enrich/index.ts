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

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const LLM_BASE_URL =
  Deno.env.get("ENRICH_LLM_BASE_URL") ?? Deno.env.get("LLM_BASE_URL") ?? "";
const LLM_API_KEY =
  Deno.env.get("ENRICH_LLM_API_KEY") ?? Deno.env.get("LLM_API_KEY") ?? "";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
// Resilient chain: the configured gateway first, direct OpenAI as fallback.
// This loop pointed at a gateway that stopped resolving and then failed
// SILENTLY for a month — zero enrichments in 30 days, nothing surfaced.
// The chain restores service through the fallback TODAY, and the health
// events make any future silence visible.
import {
  buildProviderChain,
  callWithResilience,
  resolveExternalGatewayUrl,
} from "../_shared/llm-provider.ts";
const LLM_MODEL =
  Deno.env.get("ENRICH_LLM_MODEL") ?? Deno.env.get("LLM_MODEL") ?? "stigg/fast";
const ENRICH_SHARED_SECRET = Deno.env.get("ENRICH_SHARED_SECRET") ?? "";

const BATCH_LIMIT = 5;
const corsHeaders = {
  "Access-Control-Allow-Origin": "https://app.syncai.ca",
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

function safeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i += 1) mismatch |= left[i] ^ right[i];
  return mismatch === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error("agent-loop-enrich missing required platform configuration");
    return json({ error: "service_unavailable" }, 503);
  }

  const auth = req.headers.get("Authorization") ?? "";
  const serviceToken = `Bearer ${SERVICE_ROLE_KEY}`;
  const sharedToken = ENRICH_SHARED_SECRET
    ? `Bearer ${ENRICH_SHARED_SECRET}`
    : "";
  const authorized =
    safeEqual(auth, serviceToken) ||
    (sharedToken !== "" && safeEqual(auth, sharedToken));
  if (!authorized) return json({ error: "unauthorized" }, 401);

  // Gateway first when configured; direct OpenAI as fallback. An empty chain
  // is reported as configuration, not silently skipped.
  const gatewayUrl = resolveExternalGatewayUrl(LLM_BASE_URL);
  const providers = buildProviderChain({
    gatewayUrl,
    gatewayKey: gatewayUrl ? LLM_API_KEY : undefined,
    gatewayModel: LLM_MODEL,
    openaiKey: OPENAI_API_KEY,
    // Enrichment output is read and signed by an engineer, so the direct
    // fallback is an `agent`-class model, not the cheapest thing available.
    // gpt-4o-mini stays as the safety net beneath it: if this key lacks
    // 5.6 access the 404 is fatal and the chain drops instantly rather than
    // going dark, and llm_provider_events records which one answered.
    openaiModel: Deno.env.get("OPENAI_FALLBACK_MODEL") ?? "gpt-5.6-terra",
    openaiSafetyModel: "gpt-4o-mini",
  });
  if (providers.length === 0) {
    return json({ enriched: 0, skipped: "llm_not_configured" });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: recs, error } = await supabase
    .from("recommendations")
    .select(
      "id, organization_id, asset_id, title, issue, action, confidence, urgency",
    )
    .like("rationale", "Raised by the continuous%")
    .is("enriched_at", null)
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(BATCH_LIMIT);

  if (error) {
    console.error("agent-loop-enrich query failed", error);
    return json({ enriched: 0, skipped: "query_failed" }, 500);
  }
  if (!recs || recs.length === 0)
    return json({ enriched: 0, skipped: "nothing_to_enrich" });

  let enriched = 0;
  const failures: string[] = [];

  for (const rec of recs) {
    try {
      const result = await callWithResilience(fetch, providers, {
        systemPrompt:
          "You are a senior reliability engineer for asset-intensive industry. " +
          "Given a condition-monitoring finding, return strict JSON: " +
          '{"analysis": "2-3 sentence engineering assessment of likely failure mechanism and consequence", ' +
          '"recommended_window_hours": <number>, "confidence": <0-100 integer>}. ' +
          "Be specific and conservative; never advise bypassing approvals.",
        userContent: `Finding: ${rec.title}\nSensor detail: ${rec.issue}\nCurrent proposed action: ${rec.action}\nUrgency: ${rec.urgency}`,
        maxTokens: 1500,
        timeoutMs: 45_000,
      });

      // The month of silence happened because failures only went to
      // console.error. Health events are queryable; the console is not.
      if (result.events.length > 1 || !result.ok) {
        await supabase.from("llm_provider_events").insert(
          result.events.map((e) => ({
            function_name: "agent-loop-enrich",
            provider: e.provider,
            outcome: e.outcome,
            status: e.status,
            detail: e.detail,
          })),
        );
      }

      if (!result.ok) {
        console.error("agent-loop-enrich provider exhausted", { id: rec.id });
        failures.push(`${rec.id}: provider_error`);
        continue;
      }

      const content: string = result.content;
      const match = content.match(/\{[\s\S]*\}/);
      const parsed = match ? JSON.parse(match[0]) : {};
      if (
        typeof parsed.analysis !== "string" ||
        parsed.analysis.trim().length === 0
      ) {
        failures.push(`${rec.id}: invalid_response`);
        continue;
      }

      const requestedConfidence = Number(parsed.confidence);
      const confidence = Math.min(
        95,
        Math.max(
          rec.confidence ?? 70,
          Number.isFinite(requestedConfidence)
            ? Math.round(requestedConfidence)
            : 0,
        ),
      );

      const { error: updateError } = await supabase
        .from("recommendations")
        .update({
          rationale:
            `AI analysis (${result.model ?? LLM_MODEL}): ${parsed.analysis.trim()} ` +
            `Suggested action window: ${parsed.recommended_window_hours ?? "n/a"}h. ` +
            "Raised by the continuous condition-monitoring loop; human approval required before any action.",
          confidence,
          enriched_at: new Date().toISOString(),
          // The model that ACTUALLY answered, not the one requested. When the
          // chain fails over these differ, and storing the request would put a
          // false provenance claim into a record an engineer signs.
          enrichment_model: result.model ?? LLM_MODEL,
          updated_at: new Date().toISOString(),
        })
        .eq("id", rec.id)
        .eq("status", "pending");

      if (updateError) {
        console.error("agent-loop-enrich recommendation update failed", {
          id: rec.id,
          error: updateError,
        });
        failures.push(`${rec.id}: update_failed`);
        continue;
      }

      const { error: runError } = await supabase.from("agent_runs").insert({
        organization_id: rec.organization_id,
        asset_id: rec.asset_id,
        status: "completed",
        summary: `LLM enrichment: ${rec.title}`,
        confidence,
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      });
      if (runError)
        console.error("agent-loop-enrich agent run insert failed", {
          id: rec.id,
          error: runError,
        });

      enriched += 1;
    } catch (error) {
      console.error("agent-loop-enrich failed", { id: rec.id, error });
      failures.push(`${rec.id}: enrichment_failed`);
    }
  }

  return json({ enriched, of: recs.length, failures });
});
