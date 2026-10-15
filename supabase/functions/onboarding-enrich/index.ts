// onboarding-enrich — AI deduction pass for autonomous asset onboarding.
//
// Service-only, fail-soft, and human-in-the-loop by design.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const LLM_BASE_URL =
  Deno.env.get("ONBOARD_LLM_BASE_URL") ??
  Deno.env.get("LLM_BASE_URL") ??
  "https://api.openai.com";
const LLM_API_KEY =
  Deno.env.get("ONBOARD_LLM_API_KEY") ??
  Deno.env.get("OPENAI_API_KEY") ??
  Deno.env.get("LLM_API_KEY") ??
  "";
const LLM_MODEL = Deno.env.get("ONBOARD_LLM_MODEL") ?? "gpt-4o-mini";
const ENRICH_SHARED_SECRET = Deno.env.get("ENRICH_SHARED_SECRET") ?? "";

const ASSET_BATCH = 1;
const CHUNK_SIZE = 8;
const DEADLINE_MS = 100_000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://app.syncai.ca",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
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
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error("onboarding-enrich missing required platform configuration");
    return json({ error: "service_unavailable" }, 503);
  }

  const auth = req.headers.get("Authorization") ?? "";
  const serviceToken = `Bearer ${SERVICE_ROLE_KEY}`;
  const sharedToken = ENRICH_SHARED_SECRET ? `Bearer ${ENRICH_SHARED_SECRET}` : "";
  const authorized = safeEqual(auth, serviceToken) || (sharedToken !== "" && safeEqual(auth, sharedToken));
  if (!authorized) return json({ error: "unauthorized" }, 401);

  if (!LLM_API_KEY) return json({ deduced: 0, skipped: "llm_not_configured" });

  let providerUrl: URL;
  try {
    providerUrl = new URL("/v1/chat/completions", LLM_BASE_URL);
    if (providerUrl.protocol !== "https:") throw new Error("HTTPS required");
  } catch {
    console.error("onboarding-enrich invalid LLM_BASE_URL");
    return json({ deduced: 0, skipped: "invalid_llm_configuration" }, 503);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: queue, error } = await supabase.rpc("get_onboarding_ai_queue", {
    p_limit: ASSET_BATCH,
  });
  if (error) {
    console.error("onboarding-enrich queue lookup failed", error);
    return json({ deduced: 0, skipped: "queue_failed" }, 500);
  }

  const entries = (queue ?? []) as QueueEntry[];
  if (entries.length === 0) return json({ deduced: 0, skipped: "queue_empty" });

  let deduced = 0;
  let demotedToHuman = 0;
  const failures: string[] = [];
  const startedAt = Date.now();

  const releaseReservation = async (reservationId: number | null) => {
    if (reservationId === null) return;
    const { error: releaseError } = await supabase.rpc(
      "release_llm_reservation",
      { p_reservation_id: reservationId },
    );
    if (releaseError) {
      console.error("onboarding-enrich reservation release failed", {
        reservationId,
        error: releaseError,
      });
    }
  };

  for (const entry of entries) {
    const pending = entry.pending ?? [];
    if (pending.length === 0) continue;

    let assetDeduced = 0;
    let assetDemoted = 0;
    let asked = 0;

    for (let i = 0; i < pending.length; i += CHUNK_SIZE) {
      if (Date.now() - startedAt > DEADLINE_MS) {
        failures.push("deadline_reached");
        break;
      }

      const chunk = pending.slice(i, i + CHUNK_SIZE);
      asked += chunk.length;
      let reservationId: number | null = null;
      let providerCompleted = false;

      try {
        const askList = chunk
          .map((item) => `- "${item.key}": ${item.label}${item.hint ? ` (${item.hint})` : ""}`)
          .join("\n");
        const estimatedTokens = Math.min(
          20_000,
          1200 +
            Math.ceil(
              (JSON.stringify(entry.asset).length +
                JSON.stringify(entry.known).length +
                askList.length) /
                4,
            ),
        );
        const { data: quota, error: quotaError } = await supabase.rpc(
          "check_llm_commercial_quota",
          {
            p_organization_id: entry.organization_id,
            p_fn: "onboarding-enrich",
            p_model: LLM_MODEL,
            p_estimated_tokens: estimatedTokens,
            p_cost_object_type: "asset_onboarding",
            p_cost_object_id: entry.asset_id,
          },
        );
        const verdict = (quota ?? {}) as Record<string, unknown>;
        reservationId = Number(verdict.reservation_id);
        if (
          quotaError ||
          verdict.allowed !== true ||
          !Number.isSafeInteger(reservationId)
        ) {
          console.error("onboarding-enrich commercial quota refused", {
            assetId: entry.asset_id,
            limit: verdict.limit ?? "quota_check_unavailable",
            error: quotaError,
          });
          failures.push(`${entry.asset_id}: commercial_quota_refused`);
          reservationId = null;
          continue;
        }

        const resp = await fetch(providerUrl, {
          method: "POST",
          signal: AbortSignal.timeout(45_000),
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${LLM_API_KEY}`,
          },
          body: JSON.stringify({
            model: LLM_MODEL,
            temperature: 0.2,
            max_completion_tokens: 1200,
            messages: [
              {
                role: "system",
                content:
                  "You are a senior reliability engineer (RCM/FMEA/MIL-HDBK-338B practice) onboarding an asset " +
                  "into a reliability platform. Deduce ONLY what a competent engineer could infer from the asset's " +
                  "class, OEM, model and operating context. Return strict JSON keyed by requirement key: " +
                  '{"<key>": {"summary": "<concise engineering answer, 1-2 sentences>", ' +
                  '"confidence": "high"|"medium"|"low", "rationale": "<why / basis, one short phrase>"}}. ' +
                  'Use confidence "low" whenever site-specific data is required. Never invent serial numbers, dates, document links or stock levels.',
              },
              {
                role: "user",
                content:
                  `Asset: ${JSON.stringify(entry.asset).slice(0, 5000)}\n` +
                  `Already established during onboarding: ${JSON.stringify(entry.known).slice(0, 2500)}\n\n` +
                  `Deduce the following requirements:\n${askList}`,
              },
            ],
          }),
        });

        if (!resp.ok) {
          console.error("onboarding-enrich provider request failed", { assetId: entry.asset_id, status: resp.status });
          failures.push(`${entry.asset_id}: provider_error`);
          await releaseReservation(reservationId);
          reservationId = null;
          continue;
        }
        providerCompleted = true;

        const data = await resp.json();

        // Settlement is a commercial control. Preserve the reservation and
        // refuse to apply deductions when actual usage cannot be accounted.
        const usage =
          data.usage && typeof data.usage === "object" ? data.usage : {};
        const { error: usageError } = await supabase.rpc(
          "record_llm_usage",
          {
            p_organization_id: entry.organization_id,
            p_fn: "onboarding-enrich",
            p_model:
              typeof data.model === "string" ? data.model : LLM_MODEL,
            p_prompt_tokens: usage.prompt_tokens ?? 0,
            p_completion_tokens: usage.completion_tokens ?? 0,
            p_reservation_id: reservationId,
          },
        );
        reservationId = null;
        if (usageError) {
          console.error("onboarding-enrich usage settlement failed", usageError);
          failures.push(`${entry.asset_id}: usage_settlement_failed`);
          continue;
        }

        const content: string = data.choices?.[0]?.message?.content ?? "";
        const match = content.match(/\{[\s\S]*\}/);
        const parsed = match ? JSON.parse(match[0]) : {};

        for (const item of chunk) {
          const answer = parsed[item.key];
          if (!answer || typeof answer.summary !== "string" || answer.summary.trim().length === 0) continue;
          const confidence = ["high", "medium", "low"].includes(answer.confidence)
            ? answer.confidence
            : "low";

          const { error: applyError } = await supabase.rpc("apply_onboarding_ai_deduction", {
            p_item_id: item.item_id,
            p_value: { summary: answer.summary.trim() },
            p_confidence: confidence,
            p_rationale: typeof answer.rationale === "string" ? answer.rationale.slice(0, 500) : null,
          });

          if (applyError) {
            console.error("onboarding-enrich deduction apply failed", { itemId: item.item_id, error: applyError });
            failures.push(`${item.key}: apply_failed`);
          } else if (confidence === "low") {
            assetDemoted += 1;
          } else {
            assetDeduced += 1;
          }
        }
      } catch (error) {
        if (!providerCompleted) await releaseReservation(reservationId);
        console.error("onboarding-enrich chunk failed", { assetId: entry.asset_id, error });
        failures.push(`${entry.asset_id}: deduction_failed`);
      }
    }

    deduced += assetDeduced;
    demotedToHuman += assetDemoted;

    const { error: runError } = await supabase.from("asset_onboarding_runs").insert({
      organization_id: entry.organization_id,
      asset_id: entry.asset_id,
      run_type: "ai_deduction",
      items_deduced: assetDeduced,
      items_human_required: assetDemoted,
      detail: { model: LLM_MODEL, asked },
    });
    if (runError) console.error("onboarding-enrich run audit insert failed", { assetId: entry.asset_id, error: runError });
  }

  return json({
    deduced,
    demoted_to_human: demotedToHuman,
    assets: entries.length,
    failures,
  });
});
