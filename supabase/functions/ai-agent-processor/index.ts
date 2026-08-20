import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
// Model tiers. These were pinned to gpt-4o / gpt-4o-mini — two generations
// stale — on paths that produce FMEA, RCA and FRACAS deliverables a technical
// authority signs. Anything a human puts their name to is agent-class.
//
// MODEL_SAFETY is the last resort beneath all three: an unavailable model
// returns 404, classified fatal, so the chain drops to a known-good model
// instantly rather than going dark. That is the difference between a
// degraded answer and the month of silence this chain exists to prevent.
const MODEL_DELIVERABLE = Deno.env.get("MODEL_DELIVERABLE") ?? "gpt-5.6-terra";
const MODEL_CHAT = Deno.env.get("MODEL_CHAT") ?? "gpt-5.6-luna";
const MODEL_STRUCTURED = Deno.env.get("MODEL_STRUCTURED") ?? "gpt-5.6-luna";
const MODEL_RELIABILITY = Deno.env.get("MODEL_RELIABILITY") ?? MODEL_DELIVERABLE;
const MODEL_PUBLIC_FRONTIER =
  Deno.env.get("MODEL_PUBLIC_FRONTIER") ?? "gpt-5.6-terra";
const MODEL_SAFETY = "gpt-4o-mini";

// Gateway tier aliases. A provider must be asked for a name IT recognises —
// the same rule the chain already applies to models, now applied to the
// gateway. Asking the gateway for "gpt-5.6-terra" is not merely redundant:
// SyncAI's virtual key is scoped to `['stigg/agent','stigg/fast', ...]`, so a
// concrete vendor name is REFUSED, fatal, and fails straight over to direct
// OpenAI — the gateway would be configured, billed for, and never used.
//
// Deliverables are agent-class; chat and structured output are fast-class.
const TIER_DELIVERABLE = Deno.env.get("TIER_DELIVERABLE") ?? "stigg/agent";
const TIER_CHAT = Deno.env.get("TIER_CHAT") ?? "stigg/fast";
const TIER_STRUCTURED = Deno.env.get("TIER_STRUCTURED") ?? "stigg/fast";

/** The alias this gateway knows for a given direct-provider model. */
function gatewayTierFor(directModel: string): string {
  if (directModel === MODEL_RELIABILITY) return TIER_DELIVERABLE;
  if (directModel === MODEL_DELIVERABLE) return TIER_DELIVERABLE;
  if (directModel === MODEL_STRUCTURED) return TIER_STRUCTURED;
  return TIER_CHAT;
}

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
// Resilient provider chain — gateway-first when configured, direct OpenAI as
// fallback. Deno-free and unit-tested by vitest against this exact file.
import {
  buildProviderChain,
  callWithResilience,
  resolveExternalGatewayUrl,
} from "../_shared/llm-provider.ts";
import { retrieveReliabilityContext } from "../_shared/reliability-context.ts";
import {
  RELIABILITY_PROMPT_VERSION,
  appendApprovedReliabilityContext,
  buildReliabilityEngineerPrompt,
} from "../_shared/reliability-engineer-core.ts";
const LLM_BASE_URL = Deno.env.get("LLM_BASE_URL") ?? "https://api.openai.com";
const ALLOWED_ORIGIN =
  Deno.env.get("ALLOWED_ORIGIN") ?? "https://app.syncai.ca";

const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  Vary: "Origin",
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
  publicOnly?: boolean;
  maxOutputTokens?: number;
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

// ---------------------------------------------------------------------------
// Cost guardrails (20260916000000_llm_cost_guardrails.sql).
//
// Every tenant-scoped model call is gated by a per-organization daily budget
// (calls AND tokens) checked BEFORE the provider is contacted, and recorded
// in private.llm_usage afterwards. The usage table is the counting source, so
// the cap and the telemetry can never disagree.
//
// FAIL CLOSED — both ways. Over-budget returns 429 naming the limit and its
// reset time. An INFRASTRUCTURE error reading the quota (RPC unreachable,
// table missing) refuses the call too, with a distinct 503 body: this is a
// money cap, and a cost cap that fails open the moment its table hiccups is
// not a cap — it is a suggestion. The rest of this function's logging is
// deliberately fail-soft; the quota gate is the one deliberate exception.
//
// CONCURRENCY. The gate is check-AND-RESERVE (20260916000000 §4): under a
// per-org advisory lock it counts settled usage plus open reservations and,
// when allowed, inserts a reservation row holding our conservative token
// estimate before returning. A concurrent burst therefore cannot all read
// the same pre-insert totals and overrun the daily token cap — each request
// sees every earlier reservation. recordLlmUsage settles the reservation
// with actual counts; releaseQuotaReservation deletes it when the provider
// call failed and returned no usage. A crash between reserve and settle
// leaves the estimate standing for the rest of the UTC day — an overcount
// in the fail-closed direction, never an undercount.

interface QuotaVerdict {
  allowed?: boolean;
  limit?: string;
  reservation_id?: number;
  calls_used?: number;
  max_calls?: number;
  tokens_used?: number;
  max_tokens?: number;
  resets_at?: string;
}

interface QuotaGateResult {
  /** Null when the call may proceed; otherwise the refusal to return as-is. */
  refusal: Response | null;
  /** Set when the call may proceed: settle or release it, never drop it. */
  reservationId: number | null;
}

async function checkOrgQuota(
  admin: ReturnType<typeof serviceClient>,
  organizationId: string,
  requestedModel: string,
  estimatedTokens: number,
): Promise<QuotaGateResult> {
  try {
    const { data, error } = await admin.rpc("check_llm_quota", {
      p_organization_id: organizationId,
      p_fn: "ai-agent-processor",
      p_model: requestedModel,
      p_estimated_tokens: Math.max(0, Math.ceil(estimatedTokens)),
    });
    if (error) throw error;
    const verdict = (data ?? {}) as QuotaVerdict;
    if (verdict.allowed === true) {
      return {
        refusal: null,
        reservationId:
          typeof verdict.reservation_id === "number"
            ? verdict.reservation_id
            : null,
      };
    }
    return {
      refusal: response(
        {
          success: false,
          error: "org_daily_quota_exceeded",
          limit: verdict.limit ?? "unknown",
          calls_used: verdict.calls_used ?? null,
          max_calls: verdict.max_calls ?? null,
          tokens_used: verdict.tokens_used ?? null,
          max_tokens: verdict.max_tokens ?? null,
          resets_at: verdict.resets_at ?? null,
        },
        429,
      ),
      reservationId: null,
    };
  } catch (error) {
    console.error("ai-agent-processor quota check unavailable", error);
    // Distinct body from the 429: the caller can tell "you are over budget"
    // apart from "the budget could not be read". Both refuse the model call.
    return {
      refusal: response(
        { success: false, error: "quota_check_unavailable" },
        503,
      ),
      reservationId: null,
    };
  }
}

/**
 * Delete an open reservation after a FAILED provider call (no usage to
 * settle). FAIL-SOFT: a leaked reservation merely overcounts today's budget.
 */
async function releaseQuotaReservation(
  admin: ReturnType<typeof serviceClient>,
  reservationId: number | null,
): Promise<void> {
  if (reservationId === null) return;
  try {
    const { error } = await admin.rpc("release_llm_reservation", {
      p_reservation_id: reservationId,
    });
    if (error)
      console.error("ai-agent-processor reservation release failed", error);
  } catch (error) {
    console.error("ai-agent-processor reservation release failed", error);
  }
}

/**
 * One row per model call into private.llm_usage. FAIL-SOFT: telemetry must
 * never fail or delay the user's request — the caller already has its answer.
 */
async function recordLlmUsage(
  admin: ReturnType<typeof serviceClient>,
  organizationId: string,
  model: string,
  usage: Record<string, number>,
  reservationId: number | null = null,
): Promise<void> {
  try {
    const { error } = await admin.rpc("record_llm_usage", {
      p_organization_id: organizationId || null,
      p_fn: "ai-agent-processor",
      p_model: model,
      p_prompt_tokens: usage.prompt_tokens ?? 0,
      p_completion_tokens: usage.completion_tokens ?? 0,
      p_reservation_id: reservationId,
    });
    if (error) console.error("ai-agent-processor usage insert failed", error);
  } catch (error) {
    console.error("ai-agent-processor usage insert failed", error);
  }
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
  const { data: userResult, error: userError } =
    await admin.auth.getUser(token);
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

async function callLLM(
  model: string,
  systemPrompt: string,
  userQuery: string,
  jsonMode = false,
  maxTokens = 1200,
  // `model` is what we ASK for. The returned `model` is what answered — after
  // a failover they differ, and the SIR log must carry the latter.
): Promise<{ content: string; usage: Record<string, number>; model: string }> {
  // Chain: LLM_BASE_URL (the gateway, when set and not plain OpenAI) first,
  // then direct OpenAI. Today LLM_BASE_URL is unset, so this is OpenAI with
  // retry; the moment the gateway secret is set, routing flips with no deploy.
  const gatewayUrl = resolveExternalGatewayUrl(LLM_BASE_URL);
  const providers = buildProviderChain({
    gatewayUrl,
    gatewayKey: gatewayUrl ? Deno.env.get("LLM_API_KEY") : undefined,
    gatewayModel: gatewayTierFor(model),
    openaiKey: OPENAI_API_KEY,
    openaiModel: model,
    openaiSafetyModel: MODEL_SAFETY,
  });

  const result = await callWithResilience(fetch, providers, {
    systemPrompt,
    userContent: userQuery,
    jsonMode,
    maxTokens,
    timeoutMs: 60_000,
  });

  // Every non-first-attempt trail is recorded, so a background failure can
  // never again sit invisible for a month.
  if (result.events.length > 1 || !result.ok) {
    console.error(
      "ai-agent-processor provider trail",
      JSON.stringify(result.events),
    );
    try {
      const admin = serviceClient();
      await admin.from("llm_provider_events").insert(
        result.events.map((e) => ({
          function_name: "ai-agent-processor",
          provider: e.provider,
          outcome: e.outcome,
          status: e.status,
          detail: e.detail,
        })),
      );
    } catch {
      /* health logging must never take the copilot down */
    }
  }

  if (!result.ok) throw new Error("provider_unavailable");
  return {
    content: result.content,
    usage: result.usage,
    model: result.model ?? model,
  };
}

function extractResponseText(payload: Record<string, unknown>): string {
  if (typeof payload.output_text === "string") return payload.output_text;
  const output = Array.isArray(payload.output) ? payload.output : [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = Array.isArray((item as { content?: unknown[] }).content)
      ? (item as { content: unknown[] }).content
      : [];
    for (const part of content) {
      if (
        part &&
        typeof part === "object" &&
        typeof (part as { text?: unknown }).text === "string"
      ) {
        return (part as { text: string }).text;
      }
    }
  }
  return "";
}

async function callPublicReliabilityEngineer(
  model: string,
  systemPrompt: string,
  userQuery: string,
  maxTokens: number,
): Promise<{
  content: string;
  usage: Record<string, number>;
  model: string;
}> {
  const provider = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    signal: AbortSignal.timeout(78_000),
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      store: false,
      max_output_tokens: maxTokens,
      instructions: systemPrompt,
      input: userQuery,
      reasoning: { effort: "low" },
      text: { verbosity: "medium" },
    }),
  });
  if (!provider.ok) {
    const detail = (await provider.text().catch(() => ""))
      .slice(0, 240)
      .replace(/\s+/g, " ");
    console.error("public Reliability Engineer frontier failure", {
      status: provider.status,
      detail,
    });
    throw new Error("frontier_provider_unavailable");
  }

  const payload = (await provider.json()) as Record<string, unknown>;
  if (payload.status === "incomplete") {
    console.error("public Reliability Engineer returned incomplete output", {
      detail: payload.incomplete_details,
    });
    throw new Error("frontier_provider_incomplete_response");
  }
  const content = extractResponseText(payload).trim();
  if (!content) throw new Error("frontier_provider_empty_response");
  const rawUsage =
    payload.usage && typeof payload.usage === "object"
      ? (payload.usage as Record<string, number>)
      : {};
  return {
    content,
    usage: {
      ...rawUsage,
      prompt_tokens: rawUsage.input_tokens ?? 0,
      completion_tokens: rawUsage.output_tokens ?? 0,
    },
    model: typeof payload.model === "string" ? payload.model : model,
  };
}

const AGENT_PURPOSE: Record<string, string> = {
  ReliabilityAgent:
    "reliability engineering, failure analysis, FRACAS, RCM and lifecycle risk",
  PreventiveMaintenanceAgent:
    "failure-mode-driven preventive and predictive maintenance strategy",
  AssetHealthAgent:
    "condition monitoring, degradation assessment and asset health",
  RiskAssessmentAgent:
    "asset risk, consequence, safeguards and risk-based prioritization",
  WorkOrderAgent:
    "work request quality, job planning, execution and closeout discipline",
  PlanningSchedulingAgent:
    "maintenance planning, scheduling, readiness and resource deconfliction",
  InventoryAgent:
    "MRO spares, criticality, stockout risk and materials readiness",
  RootCauseAnalysisAgent:
    "evidence-led root cause analysis and corrective-action verification",
  HSEComplianceAgent:
    "HSE critical controls, regulatory applicability and audit traceability",
  CentralCoordinationAgent:
    "cross-functional maintenance, reliability, materials, HSE and production coordination",
};

function buildLegacyPrompt(
  agentType: string,
  industry?: string,
  deliverable = false,
  accessMode: "public" | "authenticated" = "authenticated",
): string {
  if (agentType === "ReliabilityAgent") {
    return buildReliabilityEngineerPrompt({
      industry,
      accessMode,
      deliverable,
    });
  }

  const purpose =
    AGENT_PURPOSE[agentType] ?? AGENT_PURPOSE.CentralCoordinationAgent;
  let prompt = `You are SyncAI's senior industrial AI specialist for ${purpose}${industry ? ` in ${industry}` : ""}.
Use only supplied facts and clearly label assumptions. Distinguish symptoms, mechanisms, causes and systemic causes. Quantify deviations where data permits. Recommend reversible field verification before permanent changes. Every material recommendation must name an owner role, time window, verification metric, consequence of being wrong, and whether qualified human approval is required. Never advise bypassing safety, regulatory, OEM, change-management or operational approvals. End with a concise bottom line.`;

  if (deliverable) {
    prompt += `\nThe user requested a complete work product. Produce the artifact now rather than a methodology outline. For an FMEA, include at least 20 scored failure-mode rows plus scoring scales, assumptions, a prioritized action plan, regulatory applicability, method references and a bottom line. For RCA, FRACAS, RCM, risk or planning requests, provide the corresponding complete professional artifact.`;
  }
  return prompt;
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
          context: {
            source: "ai-agent-processor",
            agent_type: agentType,
            correlation_id: correlationId,
          },
          status: "active",
        })
        .select("id")
        .single();
      sessionId = session?.id;
    }
    if (!sessionId) return;

    await admin.from("sir_messages").insert([
      {
        session_id: sessionId,
        role: "user",
        content: userQuery,
        metadata: { agent_type: agentType, correlation_id: correlationId },
      },
      {
        session_id: sessionId,
        role: "assistant",
        content: aiResponse,
        metadata: {
          agent_type: agentType,
          correlation_id: correlationId,
          processing_time_ms: processingTimeMs,
        },
      },
    ]);
    await admin.from("sir_costs").insert({
      tenant_id: auth.organizationId,
      session_id: sessionId,
      model,
      prompt_tokens: usage.prompt_tokens ?? 0,
      completion_tokens: usage.completion_tokens ?? 0,
      cost_usd:
        ((usage.prompt_tokens ?? 0) * 0.00015 +
          (usage.completion_tokens ?? 0) * 0.0006) /
        1000,
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
  if (!agentType)
    return response({ success: false, error: "agentType_required" }, 400);
  const query = String(body.query ?? "").trim();
  if (!query) return response({ success: false, error: "query_required" }, 400);
  if (query.length > 30_000)
    return response({ success: false, error: "query_too_large" }, 413);

  const deliverable =
    body.depth === "deliverable" ||
    /\b(fmea|rca|fracas|rcm|register|assessment|report|plan)\b/i.test(query);
  const model = agentType === "ReliabilityAgent"
    ? body.publicOnly
      ? MODEL_PUBLIC_FRONTIER
      : MODEL_RELIABILITY
    : body.publicOnly
      ? deliverable
        ? MODEL_PUBLIC_FRONTIER
        : MODEL_CHAT
      : deliverable
        ? MODEL_DELIVERABLE
        : MODEL_CHAT;
  const defaultMaxTokens = deliverable ? 12_000 : 1_500;
  const requestedMaxTokens = Number(body.maxOutputTokens);
  const maxTokens = Number.isFinite(requestedMaxTokens)
    ? Math.max(800, Math.min(defaultMaxTokens, requestedMaxTokens))
    : defaultMaxTokens;

  // Money cap, before any model spend (and before KB retrieval, which is
  // also work). Tenant-scoped callers always carry an organizationId; the
  // only caller without one is the service-role rail from
  // public-reliability-agent, whose spend is bounded upstream by that
  // function's per-IP daily allowance.
  let quotaReservationId: number | null = null;
  if (auth.organizationId) {
    // Conservative-high pre-spend estimate, reserved atomically so a
    // concurrent burst cannot overrun the daily token cap (20260916000000
    // §4): the completion cap, plus the query at the standard ~4 chars per
    // token, plus 3,000 for the system prompt and retrieved KB context
    // (~2,000 tokens of KB per the migration's sizing arithmetic, rounded
    // up). Settled to actual counts by recordLlmUsage below.
    const estimatedTokens = maxTokens + Math.ceil(query.length / 4) + 3_000;
    const quota = await checkOrgQuota(
      admin,
      auth.organizationId,
      model,
      estimatedTokens,
    );
    if (quota.refusal) return quota.refusal;
    quotaReservationId = quota.reservationId;
  }

  const kb = await retrieveReliabilityContext(admin, query, {
    organizationId: auth.organizationId,
    publicOnly: body.publicOnly === true,
  });
  const basePrompt = buildLegacyPrompt(
    agentType,
    body.industry,
    deliverable,
    body.publicOnly ? "public" : "authenticated",
  );
  const systemPrompt = agentType === "ReliabilityAgent"
    ? appendApprovedReliabilityContext(basePrompt, kb.promptContext)
    : `${basePrompt}${kb.promptContext ? `\n\nApproved reliability reference passages:\n${kb.promptContext}\nUse only the exact bracket labels supplied for citations.` : ""}`;
  const started = Date.now();
  let content: string;
  let usage: Record<string, number>;
  let answeredBy: string;
  try {
    ({
      content,
      usage,
      model: answeredBy,
    } = body.publicOnly
      ? await callPublicReliabilityEngineer(
          model,
          systemPrompt,
          query,
          maxTokens,
        )
      : await callLLM(model, systemPrompt, query, false, maxTokens));
  } catch (error) {
    // Failed provider call: no usage to settle, so free the estimate.
    await releaseQuotaReservation(admin, quotaReservationId);
    throw error;
  }
  const elapsed = Date.now() - started;
  await recordLlmUsage(
    admin,
    auth.organizationId,
    answeredBy,
    usage,
    quotaReservationId,
  );

  await admin
    .from("ai_agent_logs")
    .insert({
      agent_type: agentType,
      query,
      response: content,
      industry: body.industry ?? "general",
      processing_time_ms: elapsed,
    })
    .then(
      ({ error }) =>
        error && console.error("ai_agent_logs insert failed", error),
    );
  await logToSir(
    admin,
    auth,
    agentType,
    query,
    content,
    answeredBy,
    usage,
    elapsed,
  );

  return response({
    success: true,
    response: content,
    processingTime: elapsed,
    agentType,
    industry: body.industry ?? "general",
    provider: "ai-agent-processor",
    modelUsed: answeredBy,
    requestedModel: model,
    depth: deliverable ? "deliverable" : "standard",
    promptVersion: agentType === "ReliabilityAgent" ? RELIABILITY_PROMPT_VERSION : undefined,
    knowledgeBaseUsed: kb.knowledgeBaseUsed,
    citations: kb.citations.map((citation) => ({
      title: citation.title,
      pageRange: citation.pageRange,
      documentClass: citation.documentClass,
      label: citation.label,
    })),
    requiresApproval: body.requiresApproval ?? false,
  });
}

function buildTypedPrompts(
  body: TypedAgentRequest,
  workOrder: Record<string, unknown>,
  asset: Record<string, unknown>,
  knowledgeContext = "",
) {
  const context = `Work order: ${workOrder.title}\nDescription: ${workOrder.description ?? "not supplied"}\nPriority: ${workOrder.priority ?? "unspecified"}\nStatus: ${workOrder.status ?? "unspecified"}\nType: ${workOrder.type ?? "unspecified"}\n\nAsset: ${asset.name}\nTag: ${asset.tag ?? "not supplied"}\nCriticality: ${asset.criticality ?? "unspecified"}\nStatus: ${asset.status ?? "unspecified"}\nManufacturer/model: ${asset.manufacturer ?? "unknown"} ${asset.model ?? ""}\nTrigger: ${body.input.trigger_reason}`;
  const reliabilityPrompt = appendApprovedReliabilityContext(
    buildReliabilityEngineerPrompt({
      accessMode: "authenticated",
      structuredOutput: true,
    }),
    knowledgeContext,
  );

  if (body.task_code === "classify_failure_mode") {
    return {
      system: `${reliabilityPrompt}\nReturn strict JSON with failure_mode, failure_mode_family, likely_cause_family, recommended_next_diagnostic_step, risk_level, evidence, summary, confidence (0-1), and requires_human_review.`,
      user: `Classify the likely failure mode:\n\n${context}`,
    };
  }
  if (body.task_code === "draft_reliability_assessment") {
    return {
      system: `${reliabilityPrompt}\nReturn strict JSON with likely_causes, recommended_actions, risk_level, evidence, summary, confidence (0-1), and requires_human_review.`,
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
  const organizationId = auth.internal
    ? String(body.tenant_id ?? "")
    : auth.organizationId;
  if (
    !organizationId ||
    (!auth.internal && body.tenant_id && body.tenant_id !== organizationId)
  ) {
    return response({ success: false, error: "tenant_scope_invalid" }, 403);
  }
  if (
    !body.input?.work_order_id ||
    !body.input?.asset_id ||
    !body.task_code ||
    !body.idempotency_key
  ) {
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
    return response({
      success: true,
      idempotent_replay: true,
      agent_run_id: existingRun.id,
      output: existingRun.output,
    });
  }

  // Money cap, after the idempotent-replay fast path (a replay never touches
  // the model, so it must never be refused for budget) and before the run row
  // and provider call. Typed calls always resolve an organizationId above.
  // Estimate: the 1,800 completion cap plus ~1,200 prompt tokens — the same
  // ~3,000-token typed-call figure the migration's sizing arithmetic uses.
  const quota = await checkOrgQuota(admin, organizationId, MODEL_STRUCTURED, 3_000);
  if (quota.refusal) return quota.refusal;
  const quotaReservationId = quota.reservationId;

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
    return response(
      {
        success: false,
        error: "orchestration_start_failed",
        correlation_id: correlationId,
      },
      500,
    );
  }

  try {
    const [workOrderResult, assetResult] = await Promise.all([
      admin
        .from("work_orders")
        .select("title, description, priority, status, type")
        .eq("id", body.input.work_order_id)
        .eq("organization_id", organizationId)
        .single(),
      admin
        .from("assets")
        .select("name, tag, status, criticality, manufacturer, model")
        .eq("id", body.input.asset_id)
        .eq("organization_id", organizationId)
        .single(),
    ]);
    if (!workOrderResult.data || !assetResult.data)
      throw new Error("scoped_context_not_found");

    const typedQuery = [
      workOrderResult.data.title,
      workOrderResult.data.description,
      assetResult.data.name,
      assetResult.data.manufacturer,
      assetResult.data.model,
      body.input.trigger_reason,
    ].filter(Boolean).join(" ");
    const kb = await retrieveReliabilityContext(admin, typedQuery, {
      organizationId,
    });
    const prompts = buildTypedPrompts(
      body,
      workOrderResult.data,
      assetResult.data,
      kb.promptContext,
    );
    const started = Date.now();
    const {
      content,
      usage,
      model: answeredBy,
    } = await callLLM(
      MODEL_STRUCTURED,
      prompts.system,
      prompts.user,
      true,
      1800,
    );
    await recordLlmUsage(
      admin,
      organizationId,
      answeredBy,
      usage,
      quotaReservationId,
    );
    const parsed = JSON.parse(content);
    const confidence = Math.max(
      0,
      Math.min(1, Number(parsed.confidence ?? 0.5)),
    );
    const requiresHumanReview =
      Boolean(parsed.requires_human_review) ||
      ["high", "critical"].includes(parsed.risk_level);
    const finishedAt = new Date().toISOString();

    await admin
      .from("sir_orchestration_runs")
      .update({
        status: "completed",
        output: parsed,
        finished_at: finishedAt,
        duration_ms: Date.now() - started,
      })
      .eq("id", run.id);

    const governanceResponse = await fetch(
      `${SUPABASE_URL}/functions/v1/autonomous-orchestrator`,
      {
        method: "POST",
        signal: AbortSignal.timeout(30_000),
        headers: {
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
        },
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
      },
    );
    if (!governanceResponse.ok) throw new Error("governance_handoff_failed");
    const governance = await governanceResponse.json();
    await logToSir(
      admin,
      { ...auth, organizationId },
      body.agent_code,
      prompts.user,
      parsed.summary ?? content,
      answeredBy,
      usage,
      Date.now() - started,
      correlationId,
    );

    return response({
      success: true,
      task_code: body.task_code,
      correlation_id: correlationId,
      agent_run_id: run.id,
      decision_id: governance.decision_id,
      approval_status: governance.approval_status ?? "pending",
      output_schema_version: "1.0.0",
      prompt_version: RELIABILITY_PROMPT_VERSION,
      model_used: answeredBy,
      knowledge_base_used: kb.knowledgeBaseUsed,
      citations: kb.citations.map((citation) => ({
        title: citation.title,
        pageRange: citation.pageRange,
        documentClass: citation.documentClass,
        label: citation.label,
      })),
      confidence,
      requires_human_review: requiresHumanReview,
      raw_summary: parsed.summary ?? "Assessment complete.",
      output: parsed,
    });
  } catch (error) {
    const safeMessage = error instanceof Error ? error.message : "task_failed";
    console.error("typed agent invocation failed", { correlationId, error });
    // Free the quota estimate when the provider call never produced usage.
    // Harmless after a successful recordLlmUsage: release only deletes OPEN
    // reservations, and settling closed this one.
    await releaseQuotaReservation(admin, quotaReservationId);
    await admin
      .from("sir_orchestration_runs")
      .update({
        status: "failed",
        output: { error: safeMessage },
        finished_at: new Date().toISOString(),
      })
      .eq("id", run.id);
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/autonomous-orchestrator`, {
        method: "POST",
        signal: AbortSignal.timeout(15_000),
        headers: {
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
        },
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
    return response(
      {
        success: false,
        error: "intelligence_task_failed",
        correlation_id: correlationId,
      },
      500,
    );
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST")
    return response({ success: false, error: "method_not_allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !OPENAI_API_KEY) {
    console.error("ai-agent-processor missing required configuration");
    return response({ success: false, error: "service_unavailable" }, 503);
  }

  const auth = await authenticate(req);
  if (!auth) return response({ success: false, error: "unauthorized" }, 401);

  try {
    const body = await req.json();
    const admin = serviceClient();
    if (body?.task_code)
      return await handleTyped(admin, auth, body as TypedAgentRequest);
    return await handleLegacy(admin, auth, body as LegacyAgentRequest);
  } catch (error) {
    console.error("ai-agent-processor request failed", error);
    return response({ success: false, error: "request_failed" }, 500);
  }
});
