import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const LLM_BASE_URL = Deno.env.get("LLM_BASE_URL") ?? "https://api.openai.com";
const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") ?? "https://app.syncai.ca";

const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Vary": "Origin",
};

interface AuthContext {
  internal: boolean;
  userId: string;
  organizationId: string;
  role: string;
}

interface LegacyAgentRequest {
  agentType: string;
  industry?: string;
  query?: string;
  requiresApproval?: boolean;
  depth?: "standard" | "deliverable";
}

interface TypedAgentRequest {
  task_code: string;
  agent_code: string;
  tenant_id?: string;
  autonomy_level: "advisory" | "conditional" | "controlled";
  idempotency_key: string;
  input_schema_version: string;
  prompt_version: string;
  input: {
    work_order_id: string;
    asset_id: string;
    trigger_reason: string;
  };
}

function response(body: unknown, status = 200): Response {
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

function extractBearer(req: Request): string {
  const value = req.headers.get("Authorization") ?? "";
  return value.startsWith("Bearer ") ? value.slice(7) : "";
}

function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const left = enc.encode(a);
  const right = enc.encode(b);
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i += 1) mismatch |= left[i] ^ right[i];
  return mismatch === 0;
}

function serviceClient() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function authenticate(req: Request): Promise<AuthContext | null> {
  const token = extractBearer(req);
  if (!token) return null;

  if (SERVICE_ROLE_KEY && safeEqual(token, SERVICE_ROLE_KEY)) {
    return {
      internal: true,
      userId: "00000000-0000-0000-0000-000000000000",
      organizationId: "",
      role: "service_role",
    };
  }

  const admin = serviceClient();
  const { data: userResult, error: userError } = await admin.auth.getUser(token);
  if (userError || !userResult.user) return null;

  const { data: profile, error: profileError } = await admin
    .from("user_profiles")
    .select("organization_id, role")
    .eq("id", userResult.user.id)
    .maybeSingle();

  if (profileError || !profile?.organization_id) return null;
  return {
    internal: false,
    userId: userResult.user.id,
    organizationId: profile.organization_id,
    role: profile.role ?? "user",
  };
}

function getProviderUrl(path: string): URL {
  const url = new URL(path, LLM_BASE_URL);
  const localTest = ["localhost", "127.0.0.1"].includes(url.hostname);
  if (url.protocol !== "https:" && !localTest) throw new Error("invalid_provider_configuration");
  return url;
}

async function callLLM(
  model: string,
  systemPrompt: string,
  userQuery: string,
  jsonMode = false,
  maxTokens = 1200,
): Promise<{ content: string; usage: Record<string, number> }> {
  const providerUrl = getProviderUrl("/v1/chat/completions");
  const payload: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userQuery },
    ],
    temperature: 0.3,
    max_completion_tokens: maxTokens,
  };
  if (jsonMode) payload.response_format = { type: "json_object" };

  const llmResponse = await fetch(providerUrl, {
    method: "POST",
    signal: AbortSignal.timeout(60_000),
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify(payload),
  });

  if (!llmResponse.ok) {
    console.error("ai-agent-processor provider failure", { status: llmResponse.status });
    throw new Error("provider_unavailable");
  }

  const data = await llmResponse.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new Error("invalid_provider_response");
  return { content, usage: data.usage ?? {} };
}

const AGENT_PURPOSE: Record<string, string> = {
  ReliabilityAgent: "reliability engineering, failure analysis, FRACAS, RCM and lifecycle risk",
  PreventiveMaintenanceAgent: "failure-mode-driven preventive and predictive maintenance strategy",
  AssetHealthAgent: "condition monitoring, degradation assessment and asset health",
  RiskAssessmentAgent: "asset risk, consequence, safeguards and risk-based prioritization",
  WorkOrderAgent: "work request quality, job planning, execution and closeout discipline",
  PlanningSchedulingAgent: "maintenance planning, scheduling, readiness and resource deconfliction",
  InventoryAgent: "MRO spares, criticality, stockout risk and materials readiness",
  RootCauseAnalysisAgent: "evidence-led root cause analysis and corrective-action verification",
  HSEComplianceAgent: "HSE critical controls, regulatory applicability and audit traceability",
  CentralCoordinationAgent: "cross-functional maintenance, reliability, materials, HSE and production coordination",
};

function buildLegacyPrompt(agentType: string, industry?: string, deliverable = false): string {
  const purpose = AGENT_PURPOSE[agentType] ?? AGENT_PURPOSE.CentralCoordinationAgent;
  let prompt = `You are SyncAI's senior industrial AI specialist for ${purpose}${industry ? ` in ${industry}` : ""}.
Use only supplied facts and clearly label assumptions. Distinguish symptoms, mechanisms, causes and systemic causes. Quantify deviations where data permits. Recommend reversible field verification before permanent changes. Every material recommendation must name an owner role, time window, verification metric, consequence of being wrong, and whether qualified human approval is required. Never advise bypassing safety, regulatory, OEM, change-management or operational approvals. End with a concise bottom line.`;

  if (deliverable) {
    prompt += `\nThe user requested a complete work product. Produce the artifact now rather than a methodology outline. For an FMEA, include at least 20 scored failure-mode rows plus scoring scales, assumptions, a prioritized action plan, regulatory applicability, method references and a bottom line. For RCA, FRACAS, RCM, risk or planning requests, provide the corresponding complete professional artifact.`;
  }
  return prompt;
}

async function retrieveReliabilityContext(admin: ReturnType<typeof serviceClient>, query: string): Promise<string> {
  try {
    if (query.trim().length < 12) return "";
    const { data } = await admin
      .from("reliability_kb_chunks")
      .select("title, page_start, page_end, content")
      .textSearch("content", query.slice(0, 500))
      .limit(4);
    if (!data?.length) return "";
    return data.map((item: Record<string, unknown>) =>
      `[${item.title}, p.${item.page_start}${item.page_end !== item.page_start ? `-${item.page_end}` : ""}]\n${String(item.content).slice(0, 1200)}`
    ).join("\n\n---\n\n");
  } catch {
    return "";
  }
}

async function logToSir(
  admin: ReturnType<typeof serviceClient>,
  auth: AuthContext,
  agentType: string,
  userQuery: string,
  aiResponse: string,
  model: string,
  usage: Record<string, number>,
  processingTimeMs: number,
  correlationId?: string,
) {
  try {
    const { data: existing } = await admin
      .from("sir_sessions")
      .select("id")
      .eq("tenant_id", auth.organizationId)
      .eq("user_id", auth.userId)
      .eq("status", "active")
      .order("last_active_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let sessionId = existing?.id;
    if (!sessionId) {
      const { data: session } = await admin
        .from("sir_sessions")
        .insert({
          tenant_id: auth.organizationId,
          user_id: auth.userId,
          context: { source: "ai-agent-processor", agent_type: agentType, correlation_id: correlationId },
          status: "active",
        })
        .select("id")
        .single();
      sessionId = session?.id;
    }
    if (!sessionId) return;

    await admin.from("sir_messages").insert([
      { session_id: sessionId, role: "user", content: userQuery, metadata: { agent_type: agentType, correlation_id: correlationId } },
      { session_id: sessionId, role: "assistant", content: aiResponse, metadata: { agent_type: agentType, correlation_id: correlationId, processing_time_ms: processingTimeMs } },
    ]);
    await admin.from("sir_costs").insert({
      tenant_id: auth.organizationId,
      session_id: sessionId,
      model,
      prompt_tokens: usage.prompt_tokens ?? 0,
      completion_tokens: usage.completion_tokens ?? 0,
      cost_usd: (((usage.prompt_tokens ?? 0) * 0.00015) + ((usage.completion_tokens ?? 0) * 0.0006)) / 1000,
    });
  } catch (error) {
    console.error("ai-agent-processor SIR logging failed", error);
  }
}

async function handleLegacy(
  admin: ReturnType<typeof serviceClient>,
  auth: AuthContext,
  body: LegacyAgentRequest,
): Promise<Response> {
  const agentType = body.agentType;
  if (!agentType) return response({ success: false, error: "agentType_required" }, 400);
  const query = String(body.query ?? "").trim();
  if (!query) return response({ success: false, error: "query_required" }, 400);
  if (query.length > 30_000) return response({ success: false, error: "query_too_large" }, 413);

  const deliverable = body.depth === "deliverable" || /\b(fmea|rca|fracas|rcm|register|assessment|report|plan)\b/i.test(query);
  const model = deliverable ? "gpt-4o" : "gpt-4o-mini";
  const maxTokens = deliverable ? 12_000 : 1_500;
  const kb = await retrieveReliabilityContext(admin, query);
  const systemPrompt = `${buildLegacyPrompt(agentType, body.industry, deliverable)}${kb ? `\n\nApproved reliability reference passages:\n${kb}\nUse only the exact bracket labels supplied for citations.` : ""}`;
  const started = Date.now();
  const { content, usage } = await callLLM(model, systemPrompt, query, false, maxTokens);
  const elapsed = Date.now() - started;

  await admin.from("ai_agent_logs").insert({
    agent_type: agentType,
    query,
    response: content,
    industry: body.industry ?? "general",
    processing_time_ms: elapsed,
  }).then(({ error }) => error && console.error("ai_agent_logs insert failed", error));
  await logToSir(admin, auth, agentType, query, content, model, usage, elapsed);

  return response({
    success: true,
    response: content,
    processingTime: elapsed,
    agentType,
    industry: body.industry ?? "general",
    modelUsed: model,
    depth: deliverable ? "deliverable" : "standard",
    knowledgeBaseUsed: Boolean(kb),
    requiresApproval: body.requiresApproval ?? false,
  });
}

function buildTypedPrompts(body: TypedAgentRequest, workOrder: Record<string, unknown>, asset: Record<string, unknown>) {
  const context = `Work order: ${workOrder.title}\nDescription: ${workOrder.description ?? "not supplied"}\nPriority: ${workOrder.priority ?? "unspecified"}\nStatus: ${workOrder.status ?? "unspecified"}\nType: ${workOrder.type ?? "unspecified"}\n\nAsset: ${asset.name}\nTag: ${asset.tag ?? "not supplied"}\nCriticality: ${asset.criticality ?? "unspecified"}\nStatus: ${asset.status ?? "unspecified"}\nManufacturer/model: ${asset.manufacturer ?? "unknown"} ${asset.model ?? ""}\nTrigger: ${body.input.trigger_reason}`;

  if (body.task_code === "classify_failure_mode") {
    return {
      system: `You are a reliability engineer. Return strict JSON with failure_mode, failure_mode_family, likely_cause_family, recommended_next_diagnostic_step, risk_level, evidence, summary, confidence (0-1), and requires_human_review. Never invent evidence or bypass human approval.`,
      user: `Classify the likely failure mode:\n\n${context}`,
    };
  }
  if (body.task_code === "draft_reliability_assessment") {
    return {
      system: `You are a reliability engineer. Return strict JSON with likely_causes, recommended_actions, risk_level, evidence, summary, confidence (0-1), and requires_human_review. Recommendations are advisory and must preserve qualified human approval.`,
      user: `Draft a reliability assessment:\n\n${context}`,
    };
  }
  throw new Error("unsupported_task_code");
}

async function handleTyped(
  admin: ReturnType<typeof serviceClient>,
  auth: AuthContext,
  body: TypedAgentRequest,
): Promise<Response> {
  const organizationId = auth.internal ? String(body.tenant_id ?? "") : auth.organizationId;
  if (!organizationId || (!auth.internal && body.tenant_id && body.tenant_id !== organizationId)) {
    return response({ success: false, error: "tenant_scope_invalid" }, 403);
  }
  if (!body.input?.work_order_id || !body.input?.asset_id || !body.task_code || !body.idempotency_key) {
    return response({ success: false, error: "invalid_task_envelope" }, 400);
  }

  const correlationId = crypto.randomUUID();
  const { data: existingRun } = await admin
    .from("sir_orchestration_runs")
    .select("id, status, output")
    .eq("tenant_id", organizationId)
    .eq("idempotency_key", body.idempotency_key)
    .maybeSingle();
  if (existingRun?.status === "completed") {
    return response({ success: true, idempotent_replay: true, agent_run_id: existingRun.id, output: existingRun.output });
  }

  const { data: run, error: runError } = await admin
    .from("sir_orchestration_runs")
    .insert({
      tenant_id: organizationId,
      status: "running",
      input: body.input,
      started_at: new Date().toISOString(),
      correlation_id: correlationId,
      idempotency_key: body.idempotency_key,
      autonomy_level: body.autonomy_level,
      workflow_definition_code: body.task_code,
      prompt_version: body.prompt_version,
    })
    .select("id")
    .single();
  if (runError || !run) {
    console.error("typed orchestration run creation failed", runError);
    return response({ success: false, error: "orchestration_start_failed", correlation_id: correlationId }, 500);
  }

  try {
    const [workOrderResult, assetResult] = await Promise.all([
      admin.from("work_orders").select("title, description, priority, status, type").eq("id", body.input.work_order_id).eq("organization_id", organizationId).single(),
      admin.from("assets").select("name, tag, status, criticality, manufacturer, model").eq("id", body.input.asset_id).eq("organization_id", organizationId).single(),
    ]);
    if (!workOrderResult.data || !assetResult.data) throw new Error("scoped_context_not_found");

    const prompts = buildTypedPrompts(body, workOrderResult.data, assetResult.data);
    const started = Date.now();
    const { content, usage } = await callLLM("gpt-4o-mini", prompts.system, prompts.user, true, 1800);
    const parsed = JSON.parse(content);
    const confidence = Math.max(0, Math.min(1, Number(parsed.confidence ?? 0.5)));
    const requiresHumanReview = Boolean(parsed.requires_human_review) || ["high", "critical"].includes(parsed.risk_level);
    const finishedAt = new Date().toISOString();

    await admin.from("sir_orchestration_runs").update({
      status: "completed",
      output: parsed,
      finished_at: finishedAt,
      duration_ms: Date.now() - started,
    }).eq("id", run.id);

    const governanceResponse = await fetch(`${SUPABASE_URL}/functions/v1/autonomous-orchestrator`, {
      method: "POST",
      signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create_intelligence_decision",
        data: {
          tenant_id: organizationId,
          correlation_id: correlationId,
          asset_id: body.input.asset_id,
          work_order_id: body.input.work_order_id,
          autonomy_level: body.autonomy_level,
          agent_run_id: run.id,
          task_code: body.task_code,
          confidence,
          requires_human_review: requiresHumanReview,
          raw_summary: parsed.summary ?? "Assessment complete.",
          structured_output: parsed,
        },
      }),
    });
    if (!governanceResponse.ok) throw new Error("governance_handoff_failed");
    const governance = await governanceResponse.json();
    await logToSir(admin, { ...auth, organizationId }, body.agent_code, prompts.user, parsed.summary ?? content, "gpt-4o-mini", usage, Date.now() - started, correlationId);

    return response({
      success: true,
      task_code: body.task_code,
      correlation_id: correlationId,
      agent_run_id: run.id,
      decision_id: governance.decision_id,
      approval_status: governance.approval_status ?? "pending",
      output_schema_version: "1.0.0",
      confidence,
      requires_human_review: requiresHumanReview,
      raw_summary: parsed.summary ?? "Assessment complete.",
      output: parsed,
    });
  } catch (error) {
    const safeMessage = error instanceof Error ? error.message : "task_failed";
    console.error("typed agent invocation failed", { correlationId, error });
    await admin.from("sir_orchestration_runs").update({
      status: "failed",
      output: { error: safeMessage },
      finished_at: new Date().toISOString(),
    }).eq("id", run.id);
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/autonomous-orchestrator`, {
        method: "POST",
        signal: AbortSignal.timeout(15_000),
        headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_failed_decision",
          data: {
            tenant_id: organizationId,
            correlation_id: correlationId,
            asset_id: body.input.asset_id,
            work_order_id: body.input.work_order_id,
            task_code: body.task_code,
            error_message: safeMessage,
          },
        }),
      });
    } catch {
      // Best-effort audit completion.
    }
    return response({ success: false, error: "intelligence_task_failed", correlation_id: correlationId }, 500);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return response({ success: false, error: "method_not_allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !OPENAI_API_KEY) {
    console.error("ai-agent-processor missing required configuration");
    return response({ success: false, error: "service_unavailable" }, 503);
  }

  const auth = await authenticate(req);
  if (!auth) return response({ success: false, error: "unauthorized" }, 401);

  try {
    const body = await req.json();
    const admin = serviceClient();
    if (body?.task_code) return await handleTyped(admin, auth, body as TypedAgentRequest);
    return await handleLegacy(admin, auth, body as LegacyAgentRequest);
  } catch (error) {
    console.error("ai-agent-processor request failed", error);
    return response({ success: false, error: "request_failed" }, 500);
  }
});
