// onboarding-enrich — AI deduction pass for autonomous asset onboarding.
//
// run_onboarding_autofill() fills everything findable deterministically and
// marks items an experienced reliability engineer could INFER (function,
// failure definition, operating envelope, skills, isolation, regulatory
// context…) as pending_ai. This function deduces those from the asset's
// class, OEM, model and everything already known, and writes them back via
// apply_onboarding_ai_deduction().
//
// Design constraints:
//   - FAIL-SOFT: no LLM secrets → {skipped: "llm_not_configured"}; items stay
//     pending_ai and remain answerable by a human in the onboarding hub.
//   - HITL preserved: low-confidence deductions are demoted to human_required
//     (by apply_onboarding_ai_deduction), never silently accepted. Find-only
//     facts (serials, documents, ownership, stocking levels) are never routed
//     here — the catalog marks them 'human'.
//   - Service-role only: invoked by pg_cron (via pg_net) or operators.
//
// Uses the copilot's provider (OPENAI_API_KEY / LLM_BASE_URL) with optional
// ONBOARD_LLM_* overrides so this surface can run on a cheaper model.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const LLM_BASE_URL =
  Deno.env.get("ONBOARD_LLM_BASE_URL") ??
  Deno.env.get("ENRICH_LLM_BASE_URL") ??
  Deno.env.get("LLM_BASE_URL") ??
  "https://api.openai.com";
const LLM_API_KEY =
  Deno.env.get("ONBOARD_LLM_API_KEY") ??
  Deno.env.get("ENRICH_LLM_API_KEY") ??
  Deno.env.get("OPENAI_API_KEY") ??
  Deno.env.get("LLM_API_KEY") ??
  "";
const LLM_MODEL =
  Deno.env.get("ONBOARD_LLM_MODEL") ??
  Deno.env.get("ENRICH_LLM_MODEL") ??
  "gpt-4o-mini";
const ENRICH_SHARED_SECRET = Deno.env.get("ENRICH_SHARED_SECRET") ?? "";

const ASSET_BATCH = 3;

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

interface PendingItem {
  item_id: string;
  key: string;
  label: string;
  hint: string | null;
}

interface QueueEntry {
  asset_id: string;
  organization_id: string;
  asset: Record<string, unknown>;
  known: Record<string, unknown>;
  pending: PendingItem[] | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });

  const auth = req.headers.get("Authorization") ?? "";
  const authorized =
    (SERVICE_ROLE_KEY && auth === `Bearer ${SERVICE_ROLE_KEY}`) ||
    (ENRICH_SHARED_SECRET && auth === `Bearer ${ENRICH_SHARED_SECRET}`);
  if (!authorized) {
    return json({ error: "service role required" }, 401);
  }

  if (!LLM_API_KEY) {
    return json({ deduced: 0, skipped: "llm_not_configured" });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: queue, error } = await supabase.rpc("get_onboarding_ai_queue", {
    p_limit: ASSET_BATCH,
  });
  if (error) return json({ deduced: 0, skipped: `queue_failed: ${error.message}` });

  const entries = (queue ?? []) as QueueEntry[];
  if (entries.length === 0) return json({ deduced: 0, skipped: "queue_empty" });

  const providerInfo = {
    base: LLM_BASE_URL,
    model: LLM_MODEL,
    key_len: LLM_API_KEY.length,
  };

  let deduced = 0;
  let demotedToHuman = 0;
  const failures: string[] = [];

  for (const entry of entries) {
    const pending = entry.pending ?? [];
    if (pending.length === 0) continue;

    try {
      const askList = pending
        .map((p) => `- "${p.key}": ${p.label}${p.hint ? ` (${p.hint})` : ""}`)
        .join("\n");

      const resp = await fetch(`${LLM_BASE_URL}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${LLM_API_KEY}`,
        },
        body: JSON.stringify({
          model: LLM_MODEL,
          temperature: 0.2,
          max_completion_tokens: 3000,
          messages: [
            {
              role: "system",
              content:
                "You are a senior reliability engineer (RCM/FMEA/MIL-HDBK-338B practice) onboarding an asset " +
                "into a reliability platform. Deduce ONLY what a competent engineer could infer from the asset's " +
                "class, OEM, model and operating context. Return strict JSON keyed by requirement key: " +
                '{"<key>": {"summary": "<concise engineering answer, 1-3 sentences>", ' +
                '"confidence": "high"|"medium"|"low", "rationale": "<why / basis>"}}. ' +
                "Use confidence \"low\" whenever the answer genuinely requires site-specific data you were not given " +
                "(that routes it to a human). Never invent serial numbers, dates, document links or stock levels.",
            },
            {
              role: "user",
              content:
                `Asset: ${JSON.stringify(entry.asset)}\n` +
                `Already established during onboarding: ${JSON.stringify(entry.known).slice(0, 4000)}\n\n` +
                `Deduce the following requirements:\n${askList}`,
            },
          ],
        }),
      });

      if (!resp.ok) {
        const errBody = (await resp.text()).slice(0, 180);
        failures.push(`${entry.asset_id}: HTTP ${resp.status} — ${errBody}`);
        continue;
      }

      const data = await resp.json();
      const content: string = data.choices?.[0]?.message?.content ?? "";
      const match = content.match(/\{[\s\S]*\}/);
      const parsed = match ? JSON.parse(match[0]) : {};

      let assetDeduced = 0;
      let assetDemoted = 0;
      for (const item of pending) {
        const answer = parsed[item.key];
        if (!answer || !answer.summary) continue;
        const confidence = ["high", "medium", "low"].includes(answer.confidence)
          ? answer.confidence
          : "low";

        const { error: applyError } = await supabase.rpc(
          "apply_onboarding_ai_deduction",
          {
            p_item_id: item.item_id,
            p_value: { summary: answer.summary },
            p_confidence: confidence,
            p_rationale: answer.rationale ?? null,
          },
        );
        if (applyError) {
          failures.push(`${item.key}: ${applyError.message}`);
        } else if (confidence === "low") {
          assetDemoted += 1;
        } else {
          assetDeduced += 1;
        }
      }
      deduced += assetDeduced;
      demotedToHuman += assetDemoted;

      await supabase.from("asset_onboarding_runs").insert({
        organization_id: entry.organization_id,
        asset_id: entry.asset_id,
        run_type: "ai_deduction",
        items_deduced: assetDeduced,
        items_human_required: assetDemoted,
        detail: { model: LLM_MODEL, asked: pending.length },
      });
    } catch (e) {
      failures.push(
        `${entry.asset_id}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  return json({
    deduced,
    demoted_to_human: demotedToHuman,
    assets: entries.length,
    failures,
    provider: providerInfo,
  });
});
