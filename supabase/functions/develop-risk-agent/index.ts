// develop-risk-agent — the Sync Develop Risk Agent (D12.12, spec §62),
// ADVISORY ONLY (§70 absolute).
//
// ISO 31000 workflow support for ONE risk: it locates the risk in the
// workflow from the risk's own recorded state, shortlists the §15 treatment
// strategies that state supports, and recommends one with a rationale and
// stated limitations.
//
// IT NEVER ACCEPTS A RISK, at any consequence level. accept_risk refuses the
// AI-operator identity by name; enforce_extended_risk_acceptance_authority
// and trg_treatment_owner_not_acceptor back it at the persistence boundary;
// adopt_risk_treatment_advice refuses that identity too, so the agent cannot
// even act on its own recommendation. §62 says "never accepts HIGH-consequence
// risk"; this product does not carve an exception for low ones.
//
// The advice binds to the SHIPPED advisory agent row (provision_risk_advisory_
// agents, engine key 'treatment'), which carries risk_may_approve=false and
// risk_may_accept=false under a table constraint that makes them unsettable.
// A recommendation cannot exist without an agent that structurally cannot
// approve anything.
//
// Model-agnostic: no provider or model id is hardcoded. With no provider
// configured the deterministic workflow position and strategy shortlist are
// returned and the function refuses to record advice it did not reason about.

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  buildProviderChain,
  callWithResilience,
  resolveExternalGatewayUrl,
} from "../_shared/llm-provider.ts";
import {
  buildRiskPrompts,
  locateWorkflowStep,
  parseTreatmentAdvice,
  treatmentCandidates,
  type RiskView,
} from "../_shared/develop-agent-core.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const LLM_BASE_URL = Deno.env.get("LLM_BASE_URL") ?? "";
// No model id and no vendor name is written down here. The comment above says
// so, and the earlier `?? "gpt-4o-mini"` made it false three lines later. The
// chain and every fallback in it are buildProviderChain's — the ONE shipped
// indirection — so an environment that names no model gets the chain's default
// rather than this file's opinion, and this file has no opinion to drift.
const MODEL = Deno.env.get("DEVELOP_AGENT_MODEL") || undefined;
const GATEWAY_MODEL = Deno.env.get("LLM_GATEWAY_MODEL") || undefined;
const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") ?? "https://app.syncai.ca";

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

const serviceClient = () =>
  createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

const userClient = (token: string) =>
  createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

async function authenticate(
  req: Request,
): Promise<{ token: string; organizationId: string; role: string } | null> {
  const header = req.headers.get("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return null;
  const admin = serviceClient();
  const { data: userResult, error } = await admin.auth.getUser(token);
  if (error || !userResult.user) return null;
  const { data: profile } = await admin
    .from("user_profiles")
    .select("organization_id, role")
    .eq("id", userResult.user.id)
    .maybeSingle();
  if (!profile?.organization_id) return null;
  return {
    token,
    organizationId: profile.organization_id,
    role: profile.role ?? "user",
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
    return json({ error: "function is not configured" }, 500);
  }

  const auth = await authenticate(req);
  if (!auth) return json({ error: "authentication required" }, 401);

  let body: { risk_id?: string; record?: boolean };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }
  const riskId = String(body.risk_id ?? "");
  if (!riskId) return json({ error: "risk_id is required" }, 400);

  // Read AS THE CALLING USER throughout. The risk register carries a
  // sensitivity ladder (can_read_risk); reading it with the service key would
  // let a requester who may not see a confidential risk receive an analysis
  // of it.
  const caller = userClient(auth.token);
  const { data: riskRow, error: riskError } = await caller
    .from("risks")
    .select(
      "id, title, event_description, current_risk_level, current_risk_score, residual_risk_level, target_risk_score, status, objective_id",
    )
    .eq("id", riskId)
    .maybeSingle();
  if (riskError) return json({ error: riskError.message }, 400);
  if (!riskRow) return json({ error: "risk not found" }, 404);

  const [controls, treatments, assumptions] = await Promise.all([
    // Controls are reusable and joined through risk_control_links; the rating
    // vocabulary is the shipped one (unknown/effective/partial/weak/
    // ineffective) — no second scale is invented here.
    caller
      .from("risk_control_links")
      .select("control_id, risk_controls(effectiveness_rating)")
      .eq("risk_id", riskId),
    caller
      .from("recommendations")
      .select("id, status")
      .eq("risk_id", riskId)
      .not("treatment_strategy", "is", null),
    caller
      .from("risk_assumptions")
      .select("id, status")
      .eq("risk_id", riskId),
  ]);

  const controlRows = (controls.data ?? []) as {
    risk_controls: { effectiveness_rating: string | null } | null;
  }[];
  const treatmentRows = (treatments.data ?? []) as { status: string | null }[];
  const assumptionRows = (assumptions.data ?? []) as { status: string | null }[];

  const risk: RiskView = {
    id: String(riskRow.id),
    title: String(riskRow.title ?? "this risk"),
    eventDescription: riskRow.event_description ?? null,
    currentRiskLevel: riskRow.current_risk_level ?? null,
    currentRiskScore:
      riskRow.current_risk_score === null || riskRow.current_risk_score === undefined
        ? null
        : Number(riskRow.current_risk_score),
    residualRiskLevel: riskRow.residual_risk_level ?? null,
    targetRiskScore:
      riskRow.target_risk_score === null || riskRow.target_risk_score === undefined
        ? null
        : Number(riskRow.target_risk_score),
    status: riskRow.status ?? null,
    controlCount: controlRows.length,
    ineffectiveControlCount: controlRows.filter((c) =>
      ["ineffective", "weak", "partial"].includes(
        c.risk_controls?.effectiveness_rating ?? "",
      ),
    ).length,
    openTreatmentCount: treatmentRows.filter(
      (t) => (t.status ?? "") !== "rejected" && (t.status ?? "") !== "dismissed",
    ).length,
    hasObjectiveLink: riskRow.objective_id != null,
    assumptionCount: assumptionRows.length,
    invalidatedAssumptionCount: assumptionRows.filter(
      (a) => a.status === "invalidated" || a.status === "expired",
    ).length,
  };

  const position = locateWorkflowStep(risk);
  const candidates = treatmentCandidates(risk);

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
    riskId,
    riskTitle: risk.title,
    workflowStep: position.step,
    workflowReason: position.reason,
    candidates,
    disclaimer:
      "A recommendation, not a decision. Creating the treatment is a human act, and accepting any " +
      "residual risk is a separate human act the database refuses this identity at every consequence " +
      "level (spec §62, §70).",
  };

  if (providers.length === 0) {
    return json({
      ...base,
      advice: null,
      refusal:
        "no model provider is configured, so no treatment was recommended. The workflow position and " +
        "the strategies this risk's recorded state supports are above and stand on their own.",
      recorded: null,
    });
  }

  const prompts = buildRiskPrompts({ risk, position, candidates });
  const result = await callWithResilience(fetch, providers, {
    systemPrompt: prompts.systemPrompt,
    userContent: prompts.userContent,
    maxTokens: 800,
    timeoutMs: 40_000,
  });
  if (result.events.length > 1 || !result.ok) {
    console.error("develop-risk-agent provider trail", JSON.stringify(result.events));
  }
  if (!result.ok) {
    return json({
      ...base,
      advice: null,
      refusal: "the model call failed, so no treatment was recommended.",
      recorded: null,
    });
  }

  const parsed = parseTreatmentAdvice(result.content, candidates);
  if (!parsed.ok) {
    return json({
      ...base,
      model: result.model,
      advice: null,
      refusal: parsed.refusal,
      recorded: null,
    });
  }

  let recorded: unknown = null;
  let recordNote: string | null = null;
  if (body.record === true) {
    const { data, error } = await caller.rpc("record_risk_treatment_advice", {
      p_risk_id: riskId,
      p_advice: {
        workflow_step: position.step,
        recommended_strategy: parsed.advice.recommended_strategy,
        label: parsed.advice.label,
        rationale: parsed.advice.rationale,
        expected_residual: parsed.advice.expected_residual,
        expected_introduced: parsed.advice.expected_introduced,
        limitations: parsed.advice.limitations,
        model: result.model,
      },
    });
    const payload = data as { error?: string } | null;
    if (error || payload?.error) {
      recordNote = `not recorded: ${error?.message ?? payload?.error}`;
    } else {
      recorded = payload;
    }
  }

  return json({
    ...base,
    model: result.model,
    advice: parsed.advice,
    recorded,
    recordNote,
  });
});
