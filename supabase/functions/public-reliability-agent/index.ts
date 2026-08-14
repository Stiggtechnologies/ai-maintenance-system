import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  PUBLIC_DECISION_CASE_DAILY_LIMIT,
  buildDecisionCaseChatPrompts,
  buildDecisionCaseRetrievalQuery,
  parsePublicDecisionCaseContext,
} from "../_shared/decision-case-chat.ts";
import {
  buildProviderChain,
  callWithResilience,
  resolveExternalGatewayUrl,
} from "../_shared/llm-provider.ts";
import { retrieveReliabilityContext } from "../_shared/reliability-context.ts";
import {
  selectReliabilitySpecialists,
  specialistClaimTypes,
} from "../_shared/reliability-specialists.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const MODEL = Deno.env.get("PUBLIC_RELIABILITY_MODEL") ?? "gpt-5.6-terra";
const MODEL_SAFETY = "gpt-4o-mini";
const TIER_AGENT = Deno.env.get("TIER_DELIVERABLE") ?? "stigg/agent";
const LLM_BASE_URL = Deno.env.get("LLM_BASE_URL") ?? "https://api.openai.com";
const RATE_LIMIT_SECRET =
  Deno.env.get("PUBLIC_RELIABILITY_RATE_LIMIT_SECRET") ?? "";
const ALLOWED_ORIGINS = (
  Deno.env.get("ALLOWED_ORIGINS") ??
  "https://app.syncai.ca,http://localhost:5173"
)
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

const scenarios = {
  "open-question": {
    asset: "User-described asset or system",
    facts: [] as string[],
  },
  "pump-seal": {
    asset: "P-101 process pump",
    question: "Why does P-101 keep leaking after seal replacement?",
    facts: [
      "P-101 has six coded events in the approved reference-case history: five seal leaks and one bearing-temperature event.",
      "The five seal events total 89 downtime hours and CAD 21,300 captured maintenance cost.",
      "Seal leakage recurred after replacement and around restart/change in operating conditions.",
      "Deterministic portfolio inputs: 8,760 operating hours, 8 failures, 38 repair hours, 168-hour mission.",
    ],
  },
  "conveyor-mistracking": {
    asset: "CV-204 conveyor",
    question: "What is driving CV-204 belt mistracking?",
    facts: [
      "CV-204 has five coded events: four belt-mistracking events and one carryback-buildup event.",
      "Those events total 45 downtime hours and CAD 5,500 captured maintenance cost.",
      "Spillage, wet feed, carryback and only temporary recovery after idler adjustment are recorded.",
      "Deterministic portfolio inputs: 6,200 operating hours, 7 failures, 22 repair hours, 120-hour mission.",
    ],
  },
  "compressor-vibration": {
    asset: "C-330 compressor",
    question:
      "What evidence should be collected before a permanent mechanical change?",
    facts: [
      "C-330 has five coded events: four high-vibration events and one coupling-wear event.",
      "Those events total 114 downtime hours and CAD 33,400 captured maintenance cost.",
      "A process-rate change, drive-end vibration, coupling wear and repeat excursions are recorded.",
      "Deterministic portfolio inputs: 7,100 operating hours, 7 failures, 51 repair hours, 168-hour mission.",
    ],
  },
} as const;

type ScenarioId = keyof typeof scenarios;
type PublicMode = "assessment" | "decision_case_chat";

interface PublicRequest {
  mode?: PublicMode;
  scenarioId?: string;
  question?: string;
  browserId?: string;
  caseContext?: unknown;
}

function headers(origin: string | null): Record<string, string> {
  const allowed =
    origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Cache-Control": "no-store",
    "Content-Type": "application/json",
    Vary: "Origin",
    "X-Content-Type-Options": "nosniff",
  };
}

function json(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: headers(origin),
  });
}

async function hmac(value: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(RATE_LIMIT_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(value),
  );
  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function extractText(payload: Record<string, unknown>): string {
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

async function runDecisionCaseChat(
  admin: ReturnType<typeof createClient>,
  body: PublicRequest,
  question: string,
  resetsAt: string,
  origin: string | null,
): Promise<Response> {
  const caseContext = parsePublicDecisionCaseContext(body.caseContext);
  if (!caseContext) return json({ error: "invalid_case_context" }, 400, origin);
  const specialists = selectReliabilitySpecialists(
    `${question} ${caseContext.questionScope === "active_case" ? caseContext.objective : ""}`,
  );

  const knowledge = await retrieveReliabilityContext(
    admin,
    buildDecisionCaseRetrievalQuery(caseContext, question),
    {
      publicOnly: true,
      limitPerClaim: 4,
      claimTypes: specialistClaimTypes(specialists),
    },
  );
  const prompts = buildDecisionCaseChatPrompts(
    caseContext,
    question,
    knowledge.promptContext,
  );
  const gatewayUrl = resolveExternalGatewayUrl(LLM_BASE_URL);
  const result = await callWithResilience(
    fetch,
    buildProviderChain({
      gatewayUrl,
      gatewayKey: gatewayUrl ? Deno.env.get("LLM_API_KEY") : undefined,
      gatewayModel: TIER_AGENT,
      openaiKey: OPENAI_API_KEY,
      openaiModel: MODEL,
      openaiSafetyModel: MODEL_SAFETY,
    }),
    {
      systemPrompt: prompts.systemPrompt,
      userContent: prompts.userContent,
      maxTokens: 4200,
      timeoutMs: 75_000,
    },
  );

  if (result.events.length > 1 || !result.ok) {
    console.error(
      "public-reliability-agent decision chat provider trail",
      JSON.stringify(result.events),
    );
  }
  if (!result.ok || !result.content.trim()) {
    return json({ error: "decision_case_agent_unavailable" }, 502, origin);
  }

  return json(
    {
      success: true,
      response: result.content.trim(),
      citations: knowledge.citations.map((citation) => ({
        title: citation.title,
        pageRange: citation.pageRange,
        documentClass: citation.documentClass,
        label: citation.label,
      })),
      knowledgeBaseUsed: knowledge.knowledgeBaseUsed,
      provider: result.provider,
      modelUsed: result.model,
      specialists: specialists.map((specialist) => specialist.id),
      resetsAt,
    },
    200,
    origin,
  );
}

const schema = {
  type: "object",
  additionalProperties: false,
  required: [
    "executiveSummary",
    "observedPattern",
    "ramInterpretation",
    "riskExposure",
    "financialImpact",
    "confidence",
    "hypotheses",
    "actions",
    "evidenceGaps",
    "bottomLine",
    "citations",
  ],
  properties: {
    executiveSummary: { type: "string" },
    observedPattern: { type: "string" },
    ramInterpretation: { type: "string" },
    riskExposure: { type: "string" },
    financialImpact: { type: "string" },
    confidence: { enum: ["low", "medium", "high"] },
    hypotheses: {
      type: "array",
      minItems: 2,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["hypothesis", "evidenceFor", "verification", "confidence"],
        properties: {
          hypothesis: { type: "string" },
          evidenceFor: { type: "string" },
          verification: { type: "string" },
          confidence: { enum: ["low", "medium", "high"] },
        },
      },
    },
    actions: {
      type: "array",
      minItems: 3,
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "action",
          "owner",
          "timeWindow",
          "verification",
          "approvalRequired",
        ],
        properties: {
          action: { type: "string" },
          owner: { type: "string" },
          timeWindow: { type: "string" },
          verification: { type: "string" },
          approvalRequired: { type: "boolean" },
        },
      },
    },
    evidenceGaps: {
      type: "array",
      minItems: 2,
      maxItems: 6,
      items: { type: "string" },
    },
    bottomLine: { type: "string" },
    citations: {
      type: "array",
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "pageRange"],
        properties: {
          title: { type: "string" },
          pageRange: { type: "string" },
        },
      },
    },
  },
};

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers: headers(origin) });
  if (req.method !== "POST")
    return json({ error: "method_not_allowed" }, 405, origin);
  if (origin && !ALLOWED_ORIGINS.includes(origin))
    return json({ error: "origin_not_allowed" }, 403, origin);
  if (
    !SUPABASE_URL ||
    !SERVICE_ROLE_KEY ||
    !OPENAI_API_KEY ||
    !RATE_LIMIT_SECRET
  ) {
    return json({ error: "service_not_configured" }, 503, origin);
  }

  let body: PublicRequest;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400, origin);
  }
  const mode: PublicMode =
    body.mode === "decision_case_chat" ? "decision_case_chat" : "assessment";
  if (
    typeof body.question !== "string" ||
    typeof body.browserId !== "string" ||
    (mode === "assessment" &&
      (!body.scenarioId || !(body.scenarioId in scenarios)))
  ) {
    return json({ error: "invalid_request" }, 400, origin);
  }
  const question = body.question.trim().slice(0, 2400);
  if (!question || body.browserId.length < 8 || body.browserId.length > 100)
    return json({ error: "invalid_request" }, 400, origin);

  const clientAddress =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("cf-connecting-ip") ??
    "unknown";
  const fingerprintInput = `${clientAddress}|${req.headers.get("user-agent") ?? ""}|${body.browserId}`;
  const fingerprint = await hmac(
    mode === "assessment" ? fingerprintInput : `${mode}|${fingerprintInput}`,
  );
  const now = new Date();
  const windowStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const resetsAt = new Date(windowStart.getTime() + 86_400_000).toISOString();
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  const { data: allowed, error: allowanceError } = await admin.rpc(
    "consume_public_reliability_allowance",
    {
      p_fingerprint_hash: fingerprint,
      p_window_start: windowStart.toISOString(),
      p_limit:
        mode === "decision_case_chat" ? PUBLIC_DECISION_CASE_DAILY_LIMIT : 1,
    },
  );
  if (allowanceError)
    return json({ error: "rate_limit_unavailable" }, 503, origin);
  if (!allowed) {
    return json(
      {
        error:
          mode === "decision_case_chat"
            ? "public_decision_case_limit_reached"
            : "public_reliability_limit_reached",
        resetsAt,
      },
      429,
      origin,
    );
  }

  if (mode === "decision_case_chat") {
    return runDecisionCaseChat(admin, body, question, resetsAt, origin);
  }

  const scenario = scenarios[body.scenarioId as ScenarioId];
  const knowledge = await retrieveReliabilityContext(
    admin,
    `${scenario.asset} ${question}`,
    { publicOnly: true, limitPerClaim: 3 },
  );
  const instructions = `You are SyncAI's senior Reliability Engineer. Produce a concise, board-ready but field-usable assessment. Treat statements in the user's question as unverified user context unless they also appear in the trusted reference facts. Separate observations, user assertions, hypotheses, and verified facts. Do not claim a root cause. Never invent standards, citations, operating limits, costs, measurements, or evidence. If structured exposure and repair inputs are absent, do not calculate or imply MTBF, MTTR, availability, Weibull parameters, or financial impact. Recommend reversible verification before permanent changes. Every action needs an owner, time window, effectiveness check, and approval boundary. Safety, OEM, MOC, site procedures, and qualified human approval always prevail. Retrieved passages support general methods and failure behaviour, not observations about the demonstrated asset. Use only exact supplied source titles and page ranges for citations. Return the required JSON only.`;
  const input = [
    `Assessment context: ${scenario.asset}`,
    `User question and unverified context: ${question}`,
    ...(scenario.facts.length > 0
      ? [
          "Trusted reference-case facts:",
          ...scenario.facts.map((fact) => `- ${fact}`),
        ]
      : ["Trusted reference-case facts: none supplied."]),
    "No tenant documents, site operating envelope, teardown evidence, condition-monitoring data, production value, consequence model, or OEM limits are available in free access.",
    knowledge.promptContext
      ? `Approved public reliability reference passages:\n${knowledge.promptContext}`
      : "Approved public reliability reference passages: none matched.",
  ].join("\n");

  try {
    const provider = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      signal: AbortSignal.timeout(60_000),
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        store: false,
        max_output_tokens: 2600,
        instructions,
        input,
        text: {
          format: {
            type: "json_schema",
            name: "reliability_analysis",
            strict: true,
            schema,
          },
        },
      }),
    });
    if (!provider.ok) {
      console.error("public-reliability-agent provider failure", {
        status: provider.status,
      });
      return json({ error: "provider_unavailable" }, 502, origin);
    }
    const payload = (await provider.json()) as Record<string, unknown>;
    const text = extractText(payload);
    const analysis = JSON.parse(text);
    return json(
      {
        success: true,
        analysis,
        modelUsed: MODEL,
        knowledgeBaseUsed: knowledge.knowledgeBaseUsed,
        resetsAt,
      },
      200,
      origin,
    );
  } catch (error) {
    console.error("public-reliability-agent failed", {
      name: error instanceof Error ? error.name : "unknown",
    });
    return json({ error: "expert_review_unavailable" }, 502, origin);
  }
});
