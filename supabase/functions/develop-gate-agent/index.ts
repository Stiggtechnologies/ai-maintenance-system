// develop-gate-agent — the Sync Develop Gate Agent (D12.08, spec §58),
// ADVISORY ONLY (§70 absolute).
//
// Reads one gate's readiness and reports it. It CANNOT approve, and that is
// not a promise this file makes — it is four database refusals it inherits:
//
//   * record_case_gate_review refuses role 'ai_admin' by name;
//   * trg_gate_review_provenance refuses any client writing an outcome
//     directly (20261101090300);
//   * trg_review_recorder_is_human refuses a review attributed to the
//     AI-operator identity for EVERY writer, service included (20261123090000);
//   * open_gate_review and record_gate_review_outcome both consult
//     gate_review_sod_position, which reports that identity as blocked.
//
// This function holds no path to any of those tables. Its only write is
// record_gate_agent_report, whose table has no column that can hold a
// decision and whose readiness figures are read by the DATABASE from
// get_gate_readiness rather than supplied by this caller — so a model cannot
// report a percentage it invented.
//
// The narrative rides the EXISTING llm-provider chain and degrades honestly:
// with no provider configured the deterministic reading stands on its own and
// says so. Model-agnostic — no provider or model id is hardcoded here.

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  buildProviderChain,
  callWithResilience,
  resolveExternalGatewayUrl,
} from "../_shared/llm-provider.ts";
import {
  buildGatePrompts,
  readGateReadiness,
  type GateReadinessView,
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

  let body: { case_id?: string; gate_id?: number; record?: boolean };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }
  const caseId = String(body.case_id ?? "");
  const gateId = Number(body.gate_id ?? 0);
  if (!caseId || !Number.isInteger(gateId) || gateId <= 0) {
    return json({ error: "case_id and gate_id are required" }, 400);
  }

  // Readiness read AS THE CALLING USER: get_gate_readiness is SECURITY
  // INVOKER so the risk-sensitivity ladder applies to the risk blockers it
  // names. Reading it with the service key would hand the agent — and the
  // narrative it writes — risks the requester may not see.
  const caller = userClient(auth.token);
  const { data: readinessData, error: readinessError } = await caller.rpc(
    "get_gate_readiness",
    { p_case_id: caseId, p_gate_id: gateId },
  );
  if (readinessError) {
    return json({ error: readinessError.message }, 400);
  }
  const readiness = (readinessData ?? {}) as Record<string, unknown> & {
    error?: string;
  };
  if (readiness.error) return json({ error: readiness.error }, 404);

  const view: GateReadinessView = {
    gateName: String(readiness.gateName ?? "this gate"),
    blocked: readiness.blocked === true,
    readinessPct:
      readiness.readinessPct === null || readiness.readinessPct === undefined
        ? null
        : Number(readiness.readinessPct),
    criteriaTotal: Number(readiness.criteriaTotal ?? 0),
    mandatoryTotal: Number(readiness.mandatoryTotal ?? 0),
    mandatoryMet: Number(readiness.mandatoryMet ?? 0),
    blockers: (readiness.blockers ?? []) as GateReadinessView["blockers"],
    projection: (readiness.projection ?? null) as GateReadinessView["projection"],
  };
  const reading = readGateReadiness(view);

  let narrative: string | null = null;
  let model: string | null = null;
  let providerNote: string | null = null;
  const gatewayUrl = resolveExternalGatewayUrl(LLM_BASE_URL);
  const providers = buildProviderChain({
    gatewayUrl,
    gatewayKey: gatewayUrl ? Deno.env.get("LLM_API_KEY") : undefined,
    gatewayModel: GATEWAY_MODEL,
    openaiKey: OPENAI_API_KEY,
    openaiModel: MODEL,
  });
  if (providers.length === 0) {
    providerNote =
      "no model provider is configured — the deterministic reading above stands on its own";
  } else {
    const prompts = buildGatePrompts(reading);
    const result = await callWithResilience(fetch, providers, {
      systemPrompt: prompts.systemPrompt,
      userContent: prompts.userContent,
      maxTokens: 600,
      timeoutMs: 30_000,
    });
    if (result.events.length > 1 || !result.ok) {
      console.error(
        "develop-gate-agent provider trail",
        JSON.stringify(result.events),
      );
    }
    if (result.ok) {
      narrative = result.content;
      model = result.model;
    } else {
      providerNote =
        "the model call failed — the deterministic reading above stands on its own";
    }
  }

  // The only write, and only on request. The RPC takes the narrative and
  // re-reads every number from the evaluator itself.
  let recorded: unknown = null;
  let recordNote: string | null = null;
  if (body.record === true) {
    const { data, error } = await caller.rpc("record_gate_agent_report", {
      p_case_id: caseId,
      p_gate_id: gateId,
      p_narrative: [reading.headline, ...reading.blockerLines.map((l) => `- ${l}`), reading.projectionLine]
        .concat(narrative ? ["", narrative] : [])
        .join("\n")
        .slice(0, 6000),
      p_model: model,
    });
    const payload = data as { error?: string } | null;
    if (error || payload?.error) {
      recordNote = `not recorded: ${error?.message ?? payload?.error}`;
    } else {
      recorded = payload;
    }
  }

  return json({
    advisory: true,
    caseId,
    gateId,
    reading,
    readiness: {
      gateName: view.gateName,
      blocked: view.blocked,
      readinessPct: view.readinessPct,
      mandatoryTotal: view.mandatoryTotal,
      mandatoryMet: view.mandatoryMet,
      blockers: view.blockers,
      categories: readiness.categories ?? [],
      assurance: readiness.assurance ?? null,
    },
    narrative,
    model,
    providerNote,
    recorded,
    recordNote,
    disclaimer:
      "A reading of the gate, not a decision on it. The AI cannot pass a gate (spec §70): the gate " +
      "decision RPC refuses this identity by name and the persistence boundary refuses a review " +
      "attributed to it, for every writer.",
  });
});
