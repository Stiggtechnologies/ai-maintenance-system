import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// ---------------------------------------------------------------------------
// ai-agent-processor — Intelligence Plane entry point
//
// Plane ownership (see docs/architecture/canonical-plane-ownership.md):
//   - This function is INTELLIGENCE PLANE ONLY (OpenClaw).
//   - It writes to OpenClaw tables (sir_orchestration_runs) and SIR
//     tables (sir_sessions, sir_messages, sir_costs).
//   - It NEVER writes to Autonomous tables (autonomous_decisions,
//     approval_workflows, autonomous_actions). That handoff happens
//     in the caller (frontend → autonomous-orchestrator).
//
// Audit truth: Autonomous is the only canonical audit chain. Records
// written here are observational intelligence traces, not governance.
// ---------------------------------------------------------------------------

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get('ALLOWED_ORIGIN') || 'https://app.syncai.ca',
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// LLM_BASE_URL seam: defaults to OpenAI; override in CI/test to point
// at a local mock server for deterministic golden-path tests.
const LLM_BASE_URL = Deno.env.get("LLM_BASE_URL") || "https://api.openai.com";

// ---------------------------------------------------------------------------
// Legacy interface (preserved for backwards compat with UnifiedChatInterface
// and other callers that don't send task_code).
// ---------------------------------------------------------------------------

interface LegacyAgentRequest {
  agentType: string;
  industry?: string;
  query?: string;
  assetId?: string;
  requiresApproval?: boolean;
}

// ---------------------------------------------------------------------------
// Typed interface for the new three-plane flow.
// Mirrors AgentTaskEnvelope<DraftReliabilityAssessmentInput> from
// src/types/sir-contracts.ts (which can't be imported in Deno).
// ---------------------------------------------------------------------------

interface TypedAgentRequest {
  task_code: string;
  agent_code: string;
  tenant_id: string;
  autonomy_level: "advisory" | "conditional" | "controlled";
  idempotency_key: string;
  correlation_id: string;
  input_schema_version: string;
  prompt_version: string;
  input: {
    work_order_id: string;
    asset_id: string;
    trigger_reason: string;
  };
}

// ---------------------------------------------------------------------------
// Shared LLM call (uses LLM_BASE_URL seam)
// ---------------------------------------------------------------------------

async function callLLM(
  model: string,
  systemPrompt: string,
  userQuery: string,
  apiKey: string,
  jsonMode: boolean = false,
): Promise<{ content: string; usage: any }> {
  const body: any = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userQuery },
    ],
    temperature: 0.7,
    max_completion_tokens: 1200,
  };

  if (jsonMode) {
    body.response_format = { type: "json_object" };
  }

  const response = await fetch(`${LLM_BASE_URL}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LLM API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  return { content: data.choices[0].message.content, usage: data.usage };
}

// ---------------------------------------------------------------------------
// SIR interaction logging (shared by both paths)
// ---------------------------------------------------------------------------

async function logToSIR(
  supabase: any,
  tenantId: string,
  userId: string,
  agentType: string,
  userQuery: string,
  aiResponse: string,
  model: string,
  usage: any,
  processingTimeMs: number,
  correlationId?: string,
) {
  try {
    // Ensure session exists
    const { data: existingSession } = await supabase
      .from('sir_sessions')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('last_active_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let sessionId: string;
    if (existingSession) {
      await supabase.from('sir_sessions').update({ last_active_at: new Date().toISOString() }).eq('id', existingSession.id);
      sessionId = existingSession.id;
    } else {
      const { data: agent } = await supabase
        .from('sir_agents')
        .select('id')
        .eq('agent_type', agentType)
        .eq('tenant_id', tenantId)
        .limit(1)
        .maybeSingle();

      const { data: session } = await supabase
        .from('sir_sessions')
        .insert({ tenant_id: tenantId, agent_id: agent?.id || null, user_id: userId, context: { source: 'ai-agent-processor', correlation_id: correlationId }, status: 'active' })
        .select('id')
        .single();
      sessionId = session?.id;
    }

    if (!sessionId) return null;

    const metadata = { source: 'ai-agent-processor', agent_type: agentType, correlation_id: correlationId };

    await supabase.from('sir_messages').insert({ session_id: sessionId, role: 'user', content: userQuery, metadata });
    await supabase.from('sir_messages').insert({ session_id: sessionId, role: 'assistant', content: aiResponse, metadata: { ...metadata, processing_time_ms: processingTimeMs } });
    await supabase.from('sir_costs').insert({
      tenant_id: tenantId,
      session_id: sessionId,
      model,
      prompt_tokens: usage?.prompt_tokens || 0,
      completion_tokens: usage?.completion_tokens || 0,
      cost_usd: ((usage?.prompt_tokens || 0) * 0.00015 + (usage?.completion_tokens || 0) * 0.0006) / 1000,
    });

    return sessionId;
  } catch (e) {
    console.error('SIR logging error:', e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Typed path: draft_reliability_assessment
//
// OpenClaw data access: task-scoped, tenant-scoped reads only.
// Reads work_orders and assets filtered by tenant + specific IDs.
// ---------------------------------------------------------------------------

async function handleTypedRequest(
  supabase: any,
  envelope: TypedAgentRequest,
  apiKey: string,
): Promise<Response> {
  const startTime = Date.now();
  const { task_code, agent_code, tenant_id, idempotency_key, autonomy_level, input_schema_version, prompt_version, input } = envelope;

  // Backend-authoritative correlation_id. Frontend-supplied values are
  // ignored — the backend is the source of truth for audit correlation.
  const correlation_id = crypto.randomUUID();

  // Create the OpenClaw orchestration run (Intelligence Plane trace)
  const { data: run, error: runError } = await supabase
    .from('sir_orchestration_runs')
    .insert({
      tenant_id,
      status: 'running',
      input: input,
      started_at: new Date().toISOString(),
      correlation_id,
      idempotency_key,
      autonomy_level,
      workflow_definition_code: task_code,
      prompt_version,
    })
    .select('id')
    .single();

  if (runError) {
    console.error(`event=orchestration_run_create_failed agent=${agent_code} correlation_id=${correlation_id} error=${runError.message}`);
    return errorResponse(500, `Failed to create orchestration run: ${runError.message}`, correlation_id);
  }

  const runId = run.id;

  try {
    // Fetch scoped context — task-scoped, tenant-scoped reads only.
    // This is the governed data access pattern: OpenClaw reads only
    // what it needs for this specific task.
    const [woResult, assetResult] = await Promise.all([
      supabase.from('work_orders')
        .select('title, description, priority, status, work_type')
        .eq('id', input.work_order_id)
        .eq('organization_id', tenant_id)
        .single(),
      supabase.from('assets')
        .select('name, asset_tag, status, criticality, manufacturer, model')
        .eq('id', input.asset_id)
        .eq('organization_id', tenant_id)
        .single(),
    ]);

    const woContext = woResult.data || { title: 'Unknown', description: 'No description' };
    const assetContext = assetResult.data || { name: 'Unknown asset' };

    // Build structured prompt requesting JSON output
    const systemPrompt = `You are a reliability engineer AI agent for industrial asset maintenance. You produce structured JSON reliability assessments.

Given a work order and asset context, analyze the situation and return a JSON object with this exact schema:
{
  "likely_causes": ["string array of probable failure causes"],
  "recommended_actions": ["string array of recommended maintenance actions"],
  "risk_level": "low" | "medium" | "high" | "critical",
  "evidence": [{"source_type": "work_order_history" | "condition_data" | "document" | "inference", "note": "string explanation"}]
}

Also include a plain-text "summary" field with a 2-3 sentence human-readable summary.
Also include a "confidence" field (number between 0 and 1) indicating your confidence.
Also include a "requires_human_review" boolean field (true if risk_level is high or critical).

Return ONLY valid JSON. No markdown, no code fences.`;

    const userPrompt = `Analyze this work order for reliability risks:

Work Order: ${woContext.title}
Description: ${woContext.description || 'None provided'}
Priority: ${woContext.priority || 'unspecified'}
Status: ${woContext.status || 'pending'}
Work Type: ${woContext.work_type || 'unspecified'}

Asset: ${assetContext.name}
Tag: ${assetContext.asset_tag || 'N/A'}
Status: ${assetContext.status || 'unknown'}
Criticality: ${assetContext.criticality || 'unspecified'}
Manufacturer: ${assetContext.manufacturer || 'unknown'}
Model: ${assetContext.model || 'unknown'}

Trigger: ${input.trigger_reason}`;

    const model = "gpt-4o-mini";
    const { content: aiResponse, usage } = await callLLM(model, systemPrompt, userPrompt, apiKey, true);
    const processingTime = Date.now() - startTime;

    // Parse structured output
    let parsed: any;
    try {
      parsed = JSON.parse(aiResponse);
    } catch {
      // LLM returned non-JSON despite json_mode — mark as failed
      throw new Error(`LLM returned invalid JSON: ${aiResponse.slice(0, 200)}`);
    }

    const confidence = Math.min(1, Math.max(0, parsed.confidence ?? 0.5));
    const requiresHumanReview = parsed.requires_human_review ?? (parsed.risk_level === 'high' || parsed.risk_level === 'critical');

    const structuredOutput = {
      likely_causes: parsed.likely_causes || [],
      recommended_actions: parsed.recommended_actions || [],
      risk_level: parsed.risk_level || 'medium',
      evidence: parsed.evidence || [],
    };

    // Update the OpenClaw orchestration run with the result
    await supabase
      .from('sir_orchestration_runs')
      .update({
        status: 'completed',
        output: structuredOutput,
        finished_at: new Date().toISOString(),
        confidence,
        output_schema_version: '1.0.0',
        requires_human_review: requiresHumanReview,
        duration_ms: processingTime,
      })
      .eq('id', runId);

    // SIR interaction logging
    const sessionId = await logToSIR(
      supabase, tenant_id, '00000000-0000-0000-0000-000000000000',
      agent_code, userPrompt, aiResponse, model, usage, processingTime, correlation_id,
    );

    // Legacy ai_agent_logs (will be deprecated; keeping for observability continuity)
    await supabase.from("ai_agent_logs").insert({
      agent_type: agent_code,
      query: userPrompt,
      response: aiResponse,
      industry: "reliability",
      processing_time_ms: processingTime,
    }).catch(() => {}); // non-critical

    console.log(`event=agent_invocation_completed agent=${agent_code} correlation_id=${correlation_id} task_code=${task_code} confidence=${confidence} risk_level=${structuredOutput.risk_level} processing_time_ms=${processingTime}`);

    // --- Cross-plane handoff: Intelligence → Governance ---
    // Call autonomous-orchestrator internally to create the canonical
    // Autonomous decision. This keeps the frontend to a single call
    // and ensures correlation_id is backend-authoritative.
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    let governanceResult: any = { decision_id: null, approval_status: 'unknown' };
    try {
      const govRes = await fetch(
        `${supabaseUrl}/functions/v1/autonomous-orchestrator`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${serviceKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            action: 'create_intelligence_decision',
            data: {
              tenant_id,
              correlation_id,
              asset_id: input.asset_id,
              work_order_id: input.work_order_id,
              autonomy_level,
              agent_run_id: runId,
              task_code,
              confidence,
              requires_human_review: requiresHumanReview,
              raw_summary: parsed.summary || 'Assessment complete.',
              structured_output: structuredOutput,
            },
          }),
        },
      );
      if (govRes.ok) {
        governanceResult = await govRes.json();
      } else {
        console.error(`event=governance_handoff_failed correlation_id=${correlation_id} status=${govRes.status}`);
      }
    } catch (govError) {
      // Governance handoff failure is non-fatal — the intelligence result
      // is already persisted in OpenClaw. Log and continue.
      console.error(`event=governance_handoff_error correlation_id=${correlation_id} error=${govError.message}`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        task_code,
        correlation_id,
        agent_run_id: runId,
        decision_id: governanceResult.decision_id,
        approval_status: governanceResult.approval_status || 'pending',
        output_schema_version: '1.0.0',
        confidence,
        requires_human_review: requiresHumanReview,
        raw_summary: parsed.summary || 'Assessment complete.',
        output: structuredOutput,
        processingTime,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );

  } catch (error) {
    const processingTime = Date.now() - startTime;

    // Mark the OpenClaw orchestration run as failed
    await supabase
      .from('sir_orchestration_runs')
      .update({
        status: 'failed',
        output: { error: error.message },
        finished_at: new Date().toISOString(),
        duration_ms: processingTime,
      })
      .eq('id', runId);

    // Record failure in Autonomous plane (audit completeness).
    // Uses 'failed' status, not 'rejected' (rejected = human decision).
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    try {
      await fetch(`${supabaseUrl}/functions/v1/autonomous-orchestrator`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_failed_decision',
          data: { tenant_id, correlation_id, asset_id: input.asset_id, work_order_id: input.work_order_id, task_code, error_message: error.message },
        }),
      });
    } catch {
      // Best-effort audit — don't compound the error
    }

    console.error(`event=agent_invocation_failed agent=${agent_code} correlation_id=${correlation_id} task_code=${task_code} error=${error.message} processing_time_ms=${processingTime}`);

    return errorResponse(500, error.message || "Intelligence task failed", correlation_id);
  }
}

function errorResponse(status: number, message: string, correlationId?: string): Response {
  return new Response(
    JSON.stringify({ success: false, error: message, correlation_id: correlationId }),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

// ---------------------------------------------------------------------------
// Legacy path (preserved for backwards compat)
// ---------------------------------------------------------------------------

function selectOptimalModel(agentType: string, query?: string): string {
  const queryLength = query?.length || 0;
  const complexAgents = [
    "PreventiveMaintenanceAgent", "PredictiveAnalyticsAgent",
    "RootCauseAnalysisAgent", "FailureModeAgent",
    "RiskAssessmentAgent", "ReliabilityAgent", "CentralCoordinationAgent",
  ];
  if (complexAgents.includes(agentType) || queryLength > 500) return "gpt-4o";
  return "gpt-4o-mini";
}

function buildSystemPrompt(agentType: string, industry?: string): string {
  const industryContext = industry ? ` in the ${industry} industry` : "";
  const agentPrompts: Record<string, string> = {
    "PreventiveMaintenanceAgent": `You are a world-class Preventive Maintenance (PM) Agent for asset-intensive industries${industryContext}. Build time-based and usage-based maintenance strategies. Create PM calendars, standardize tasks, optimize schedules, and support work packaging. Use RCM logic and FMEA. Track PM compliance and effectiveness. Provide PM task lists, calendars, and optimization reports.`,
    "ReliabilityAgent": `You are a world-class Reliability Agent${industryContext}. Maximize uptime and reduce failures using reliability engineering. Identify bad actors, develop reliability strategies, and model lifecycle costs. Apply RCM, Weibull analysis, and ISO 55000. Output reliability improvement projects, MTBF/MTTR trends, and bad actor analyses.`,
    "WorkOrderAgent": `You are a world-class Work Order Agent${industryContext}. Manage the full lifecycle: validate requests, create WOs, support planning, track status, and ensure close-out.`,
    "AssetHealthAgent": `You are a world-class Asset Health Agent${industryContext}. Provide real-time holistic health views of critical equipment.`,
    "CentralCoordinationAgent": `You are the Central Coordination Agent orchestrating specialized AI agents for asset-intensive industries${industryContext}.`,
  };
  return agentPrompts[agentType] || `You are an expert AI agent for asset-intensive industries${industryContext}. Provide detailed, actionable insights with specific metrics and recommendations.`;
}

async function handleLegacyRequest(
  supabase: any,
  body: LegacyAgentRequest,
  apiKey: string,
): Promise<Response> {
  const { agentType, industry, query, requiresApproval } = body;

  if (!agentType) {
    return errorResponse(400, "agentType is required");
  }

  const startTime = Date.now();
  const selectedModel = selectOptimalModel(agentType, query);
  const systemPrompt = buildSystemPrompt(agentType, industry);
  const industryContextStr = industry ? ` in the ${industry} industry` : "";

  let userQuery = query;
  if (!userQuery) {
    userQuery = `Provide a concise analysis and actionable recommendations for ${agentType.replace("Agent", "")}${industryContextStr}. Include key metrics and next steps.`;
  } else if (userQuery.length < 50) {
    userQuery = `${userQuery}\n\nProvide a brief, helpful response.`;
  }

  const { content: aiResponse, usage } = await callLLM(selectedModel, systemPrompt, userQuery, apiKey);
  const processingTime = Date.now() - startTime;

  await supabase.from("ai_agent_logs").insert({
    agent_type: agentType,
    query: userQuery,
    response: aiResponse,
    industry: industry || "general",
    processing_time_ms: processingTime,
  });

  // SIR logging
  await logToSIR(
    supabase, '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
    agentType, userQuery, aiResponse, selectedModel, usage, processingTime,
  );

  return new Response(
    JSON.stringify({
      success: true,
      response: aiResponse,
      processingTime,
      agentType,
      industry: industry || "general",
      modelUsed: selectedModel,
      requiresApproval: requiresApproval || false,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

// ---------------------------------------------------------------------------
// Main handler — routes to typed or legacy path
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    // PR 2.5 fix: use SERVICE_ROLE_KEY (was ANON_KEY — the only edge
    // function in the repo using anon, causing silent SIR write failures).
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) {
      return errorResponse(400, "OpenAI API key not configured");
    }

    const body = await req.json();

    // Route: if task_code is present, use the typed three-plane path.
    // Otherwise fall through to the legacy path for backwards compat.
    if (body.task_code) {
      return await handleTypedRequest(supabase, body as TypedAgentRequest, apiKey);
    } else {
      return await handleLegacyRequest(supabase, body as LegacyAgentRequest, apiKey);
    }
  } catch (error) {
    console.error("Error processing AI agent request:", error);
    return errorResponse(500, error.message || "Internal server error");
  }
});
