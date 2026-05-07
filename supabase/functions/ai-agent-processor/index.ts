/**
 * ai-agent-processor Edge Function — v2 (DB-driven, integrations-aware)
 * =====================================================================
 * Resolves agent definitions from `agent_definitions` (migration 014),
 * routes to the org's connected Anthropic integration when available,
 * and logs every run to `agent_runs`.
 *
 * Provider resolution order:
 *   1. Org's connected Anthropic integration (preferred — customer's own key)
 *   2. ANTHROPIC_API_KEY env var (platform fallback)
 *   3. Per-request `openaiKey` (legacy v1 caller path)
 *   4. OPENAI_API_KEY env var (final fallback)
 *
 * Request body:
 *   {
 *     agent_code: string;             // e.g. "reliability_engineering"
 *     query: string;                  // user message
 *     industry?: string;
 *     organization_id?: string;       // resolved from auth if absent
 *     requires_approval?: boolean;
 *     // legacy v1 aliases (still accepted):
 *     agentType?: string;             // mapped from old camelCase names
 *     openaiKey?: string;
 *   }
 *
 * Response:
 *   {
 *     ok, run_id, response, model_used, provider, latency_ms,
 *     agent: { code, name, role }
 *   }
 *
 * Schema dependency: 014_ai_agents.sql, 013_integrations.sql
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// Legacy v1 → v2 agent code map. Old callers (UnifiedChatInterface, etc.)
// pass camelCase agentType strings; map them to canonical snake_case codes
// from migration 014.
const LEGACY_AGENT_MAP: Record<string, string> = {
  PreventiveMaintenanceAgent: "maintenance_strategy",
  PredictiveAnalyticsAgent: "condition_monitoring",
  AssetHealthAgent: "asset_management",
  WorkOrderAgent: "work_order_management",
  RootCauseAnalysisAgent: "reliability_engineering",
  SparePartsAgent: "inventory_management",
  PerformanceAnalysisAgent: "data_analytics",
  FailureModeAgent: "reliability_engineering",
  CostOptimizationAgent: "financial_contract",
  ComplianceAgent: "compliance_auditing",
  RiskAssessmentAgent: "compliance_auditing",
  EnergyEfficiencyAgent: "sustainability_esg",
  EnvironmentalAgent: "sustainability_esg",
  SafetyAgent: "compliance_auditing",
  ReliabilityAgent: "reliability_engineering",
  CentralCoordinationAgent: "central_coordination",
};

interface AgentRequest {
  agent_code?: string;
  agentType?: string;            // legacy alias
  query: string;
  industry?: string;
  organization_id?: string;
  requires_approval?: boolean;
  openaiKey?: string;            // legacy
}

interface AgentDefinition {
  code: string;
  name: string;
  role: string;
  category: string;
  system_prompt: string;
  preferred_model: string;
  max_tokens: number;
  is_active: boolean;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const body = (await req.json().catch(() => ({}))) as AgentRequest;

    const code = resolveAgentCode(body);
    if (!code) return json({ ok: false, error: "agent_code (or legacy agentType) is required", error_code: "MISSING_AGENT" }, 400);
    if (!body.query) return json({ ok: false, error: "query is required", error_code: "MISSING_QUERY" }, 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return json({ ok: false, error: "Server misconfigured", error_code: "MISSING_ENV" }, 500);

    const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const auth = await resolveAuth(supabase, req, body.organization_id);
    if (!auth.ok) return json({ ok: false, error: auth.error, error_code: "AUTH" }, 401);

    const { data: agent, error: agentErr } = await supabase
      .from("agent_definitions")
      .select("code, name, role, category, system_prompt, preferred_model, max_tokens, is_active")
      .eq("code", code)
      .maybeSingle();

    if (agentErr) return json({ ok: false, error: `Agent lookup failed: ${agentErr.message}` }, 500);
    if (!agent || !agent.is_active) return json({ ok: false, error: `Unknown or inactive agent: ${code}`, error_code: "UNKNOWN_AGENT" }, 404);

    const def = agent as AgentDefinition;

    const { data: runIdRaw, error: startErr } = await supabase.rpc("agent_record_run_start", {
      p_organization_id: auth.organizationId,
      p_agent_code: code,
      p_user_id: auth.userId,
      p_industry: body.industry ?? null,
      p_query: body.query,
      p_requires_approval: !!body.requires_approval,
    });
    if (startErr || !runIdRaw) return json({ ok: false, error: `Run start failed: ${startErr?.message ?? "unknown"}` }, 500);
    const runId = runIdRaw as string;

    const t0 = Date.now();

    try {
      const provider = await resolveProvider(supabase, auth.organizationId, body.openaiKey);
      const industryContext = body.industry ? ` in the ${body.industry} industry` : "";
      const userQuery = body.query.length < 50
        ? `${body.query}\n\nProvide a brief, helpful response. If this is a greeting, respond conversationally then offer relevant insights${industryContext}.`
        : body.query;

      let response: string;
      let modelUsed: string;

      if (provider.kind === "anthropic") {
        modelUsed = provider.model ?? def.preferred_model;
        response = await callAnthropic(modelUsed, def.system_prompt + industryContext, userQuery, provider.apiKey, def.max_tokens);
      } else {
        modelUsed = pickOpenAIModel(def.category);
        response = await callOpenAI(modelUsed, def.system_prompt + industryContext, userQuery, provider.apiKey, def.max_tokens);
      }

      const latency = Date.now() - t0;

      await supabase.rpc("agent_record_run_complete", {
        p_run_id: runId,
        p_response: response,
        p_model_used: modelUsed,
        p_provider: provider.kind,
        p_integration_id: provider.integrationId ?? null,
        p_latency_ms: latency,
      });

      return json({
        ok: true,
        run_id: runId,
        response,
        model_used: modelUsed,
        provider: provider.kind,
        latency_ms: latency,
        agent: { code: def.code, name: def.name, role: def.role },
      });
    } catch (err) {
      const latency = Date.now() - t0;
      const message = err instanceof Error ? err.message : String(err);
      await supabase.rpc("agent_record_run_failure", { p_run_id: runId, p_error: message, p_latency_ms: latency });
      return json({ ok: false, error: message, run_id: runId, error_code: "PROVIDER_ERROR" }, 502);
    }
  } catch (err) {
    console.error("[ai-agent-processor] uncaught", err);
    return json({ ok: false, error: String((err as Error)?.message ?? err), error_code: "INTERNAL" }, 500);
  }
});

function resolveAgentCode(body: AgentRequest): string | null {
  if (body.agent_code) return body.agent_code;
  if (body.agentType) return LEGACY_AGENT_MAP[body.agentType] ?? body.agentType;
  return null;
}

async function resolveAuth(
  supabase: SupabaseClient,
  req: Request,
  fallbackOrgId?: string,
): Promise<{ ok: true; userId: string | null; organizationId: string } | { ok: false; error: string }> {
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (token) {
    const { data: userResult } = await supabase.auth.getUser(token);
    if (userResult?.user) {
      const { data: profile } = await supabase
        .from("user_profiles")
        .select("organization_id")
        .eq("id", userResult.user.id)
        .maybeSingle();
      if (profile?.organization_id) {
        return { ok: true, userId: userResult.user.id, organizationId: profile.organization_id };
      }
    }
  }

  if (fallbackOrgId) return { ok: true, userId: null, organizationId: fallbackOrgId };
  return { ok: false, error: "No organization context — pass Authorization: Bearer <jwt> or organization_id" };
}

interface ResolvedProvider {
  kind: "anthropic" | "openai";
  apiKey: string;
  model?: string;
  integrationId?: string;
}

async function resolveProvider(
  supabase: SupabaseClient,
  orgId: string,
  legacyOpenAIKey?: string,
): Promise<ResolvedProvider> {
  // 1. Org's connected Anthropic integration
  const { data: anthropicRow } = await supabase
    .from("integrations")
    .select("id, status")
    .eq("organization_id", orgId)
    .eq("catalog_code", "anthropic")
    .eq("status", "connected")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (anthropicRow) {
    const { data: creds } = await supabase.rpc("integration_read_credentials", { p_id: anthropicRow.id });
    if (creds && (creds as Record<string, string>).api_key) {
      const c = creds as Record<string, string>;
      return { kind: "anthropic", apiKey: c.api_key, model: c.model, integrationId: anthropicRow.id };
    }
  }

  // 2. Platform Anthropic key
  const platformAnthropic = Deno.env.get("ANTHROPIC_API_KEY");
  if (platformAnthropic) return { kind: "anthropic", apiKey: platformAnthropic };

  // 3. Legacy per-request OpenAI key
  if (legacyOpenAIKey) return { kind: "openai", apiKey: legacyOpenAIKey };

  // 4. Platform OpenAI key
  const platformOpenAI = Deno.env.get("OPENAI_API_KEY");
  if (platformOpenAI) return { kind: "openai", apiKey: platformOpenAI };

  throw new Error("No AI provider configured. Connect Anthropic in Integrations, or set ANTHROPIC_API_KEY / OPENAI_API_KEY.");
}

async function callAnthropic(model: string, system: string, query: string, apiKey: string, maxTokens: number): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: query }],
    }),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`Anthropic ${res.status}: ${errBody.slice(0, 300)}`);
  }
  const data = await res.json();
  const text = Array.isArray(data?.content)
    ? data.content.filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("\n")
    : (data?.content ?? "");
  return text || "(empty response)";
}

async function callOpenAI(model: string, system: string, query: string, apiKey: string, maxTokens: number): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: system }, { role: "user", content: query }],
      temperature: 0.7,
      max_completion_tokens: maxTokens,
    }),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`OpenAI ${res.status}: ${errBody.slice(0, 300)}`);
  }
  const data = await res.json();
  return data?.choices?.[0]?.message?.content ?? "(empty response)";
}

function pickOpenAIModel(category: string): string {
  if (category === "strategic" || category === "orchestration") return "gpt-4o";
  return "gpt-4o-mini";
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
