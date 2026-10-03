// D12.02 / spec I.17 — evidence-grounded contract-strategy advice.
// Advisory only: this function cannot award a contract, select a bidder,
// commit spend, accept risk or approve its own pending recommendation.

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  buildProviderChain,
  callWithResilience,
  resolveExternalGatewayUrl,
} from "../_shared/llm-provider.ts";
import {
  buildContractStrategyPrompts,
  parseContractStrategyAdvice,
  validateContractStrategyAssessment,
} from "../_shared/develop-contract-strategy-core.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const LLM_BASE_URL = Deno.env.get("LLM_BASE_URL") ?? "";
const MODEL = Deno.env.get("DEVELOP_AGENT_MODEL") || undefined;
const GATEWAY_MODEL = Deno.env.get("LLM_GATEWAY_MODEL") || undefined;
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

  let body: { case_id?: string; assessment?: unknown; record?: boolean };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }
  const caseId = String(body.case_id ?? "").trim();
  if (!caseId) return json({ error: "case_id is required" }, 400);
  const validation = validateContractStrategyAssessment(body.assessment);
  if (!validation.ok) return json({ error: validation.refusal }, 400);

  const { data: contextData, error: contextError } = await caller.rpc(
    "get_contract_strategy_context",
    { p_case_id: caseId },
  );
  const context = contextData as { caseTitle?: string; error?: string } | null;
  if (contextError || !context || context.error || !context.caseTitle) {
    return json(
      {
        error:
          contextError?.message ??
          context?.error ??
          "development case not found",
      },
      404,
    );
  }

  const evidenceIds = [
    ...new Set(
      Object.values(validation.assessment).map(
        (factor) => factor.evidenceItemId,
      ),
    ),
  ];
  const { data: evidenceRows, error: evidenceError } = await caller
    .from("evidence_items")
    .select(
      "id, description, evidence_class, data_quality, verification_status, source_system, source_reference",
    )
    .eq("development_case_id", caseId)
    .in("id", evidenceIds);
  if (evidenceError) return json({ error: evidenceError.message }, 400);
  if ((evidenceRows ?? []).length !== evidenceIds.length) {
    return json(
      {
        error:
          "every factor requires evidence visible on this development case",
      },
      400,
    );
  }

  const gatewayUrl = resolveExternalGatewayUrl(LLM_BASE_URL);
  const providers = buildProviderChain({
    gatewayUrl,
    gatewayKey: gatewayUrl ? Deno.env.get("LLM_API_KEY") : undefined,
    gatewayModel: GATEWAY_MODEL,
    openaiKey: OPENAI_API_KEY,
    openaiModel: MODEL,
  });
  const base = {
    advisory: true as const,
    caseId,
    assessment: validation.assessment,
    disclaimer:
      "Recommendation only. A named human decides the strategy; bidder selection, risk acceptance, expenditure commitment and contract award remain separate governed human acts.",
  };
  if (providers.length === 0) {
    return json({
      ...base,
      advice: null,
      recorded: null,
      refusal:
        "no model provider is configured, so no contract strategy was recommended",
    });
  }

  const prompts = buildContractStrategyPrompts({
    caseTitle: context.caseTitle,
    assessment: validation.assessment,
    evidence: (evidenceRows ?? []).map((row) => ({
      id: String(row.id),
      description: row.description ?? null,
      evidenceClass: row.evidence_class ?? null,
      dataQuality: row.data_quality ?? null,
      verificationStatus: row.verification_status ?? null,
      sourceSystem: row.source_system ?? null,
      sourceReference: row.source_reference ?? null,
    })),
  });
  const result = await callWithResilience(fetch, providers, {
    systemPrompt: prompts.systemPrompt,
    userContent: prompts.userContent,
    maxTokens: 1800,
    timeoutMs: 40_000,
  });
  if (!result.ok) {
    console.error(
      "contract strategy provider trail",
      JSON.stringify(result.events),
    );
    return json({
      ...base,
      advice: null,
      recorded: null,
      refusal: "the model call failed, so no contract strategy was recommended",
    });
  }
  const parsed = parseContractStrategyAdvice(result.content);
  if (!parsed.ok)
    return json({
      ...base,
      model: result.model,
      advice: null,
      recorded: null,
      refusal: parsed.refusal,
    });

  let recorded: unknown = null;
  let recordNote: string | null = null;
  if (body.record === true) {
    const { data, error } = await caller.rpc(
      "record_contract_strategy_recommendation",
      {
        p_case_id: caseId,
        p_assessment: validation.assessment,
        p_advice: { ...parsed.advice, model: result.model },
      },
    );
    const payload = data as { error?: string } | null;
    if (error || payload?.error)
      recordNote = `not recorded: ${error?.message ?? payload?.error}`;
    else recorded = payload;
  }

  return json({
    ...base,
    model: result.model,
    advice: parsed.advice,
    recorded,
    recordNote,
  });
});
