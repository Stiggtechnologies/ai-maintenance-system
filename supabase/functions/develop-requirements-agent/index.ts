// develop-requirements-agent — the Sync Develop Requirements Agent
// (D12.09, spec §59), ADVISORY ONLY (§70 absolute).
//
// §59: "Requirements Agent (missing/unverified/orphan/inconsistent — '14
// requirements have no verification method')."
//
// THE SPLIT THIS FILE EXISTS TO ENFORCE. The spec's own example is a COUNT
// over a column. It is computed in SQL by get_case_requirement_findings and
// this function does not recompute it, does not send it to a model, and does
// not let a model's answer change it. Sending a deterministic fact to a
// language model makes it probabilistic, non-reproducible and unciteable, and
// produces a number nobody can defend at a gate review.
//
// The model is used for exactly ONE thing: reading the requirement STATEMENTS
// and proposing pairs that contradict each other in meaning. Nothing in the
// schema can see that. Those outputs are labelled AI-generated end to end —
// `source` is written as 'ai_suggestion' by a SQL literal inside the RPC, and
// severity is capped at 'attention' there too, so a model cannot mark its own
// guess blocking or label it deterministic.
//
// IT CANNOT FIX ANYTHING, and that is not a promise this file makes — it is
// four database refusals it inherits:
//
//   * create_requirement_verification refuses 'ai_admin' by name, so the
//     identity cannot state a verification method and cannot clear its own
//     "missing verification method" finding;
//   * record_verification_result refuses 'ai_admin' by name;
//   * trg_verification_recorder_is_human refuses a verification attributed to
//     that identity for EVERY writer, service included;
//   * design_requirements.verification_status is moved only as a consequence
//     of a recorded result — no act in this product types it.
//
// This function holds no path to any of those. Its only write is
// record_requirements_agent_report, whose table has no column that can hold a
// status, a result or a disposition.
//
// The narrative rides the EXISTING llm-provider chain and degrades honestly:
// with no provider configured the deterministic findings stand on their own
// and the response says so. Model-agnostic — no provider or model id is
// hardcoded here.

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  buildProviderChain,
  callWithResilience,
  resolveExternalGatewayUrl,
} from "../_shared/llm-provider.ts";
import {
  buildRequirementsPrompts,
  parseRequirementInconsistencies,
  readRequirementFindings,
  type RequirementFindingsView,
} from "../_shared/develop-agent-core.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const LLM_BASE_URL = Deno.env.get("LLM_BASE_URL") ?? "";
// No model id and no vendor name is written down here. The chain and every
// fallback in it are buildProviderChain's — the ONE shipped indirection — so
// an environment that names no model gets the chain's default rather than
// this file's opinion, and this file has no opinion to drift.
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

  let body: { case_id?: string; record?: boolean };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }
  const caseId = String(body.case_id ?? "");
  if (!caseId) return json({ error: "case_id is required" }, 400);

  // Read AS THE CALLING USER. get_case_requirement_findings is org-scoped
  // through app_current_org(), and reading it with the service key would hand
  // the agent — and the narrative it writes — a case the requester may not be
  // entitled to.
  const caller = userClient(auth.token);
  const { data: findingsData, error: findingsError } = await caller.rpc(
    "get_case_requirement_findings",
    { p_case_id: caseId },
  );
  if (findingsError) return json({ error: findingsError.message }, 400);

  const raw = (findingsData ?? {}) as Record<string, unknown> & {
    error?: string;
    refused?: boolean;
    refusal?: string;
  };
  if (raw.error) return json({ error: raw.error }, 404);

  // THE REFUSAL IS THE ANSWER. A case with no requirements gets the refusal
  // verbatim and no model call at all: there is nothing to read, and asking a
  // model to comment on an empty set is how "0 findings" gets written by
  // another route.
  if (raw.refused === true) {
    return json({
      advisory: true,
      caseId,
      refused: true,
      refusal: raw.refusal,
      reading: null,
      narrative: null,
      model: null,
      recorded: null,
      disclaimer:
        "No requirements are recorded on this case, so the agent refuses rather than reporting zero findings.",
    });
  }

  const view: RequirementFindingsView = {
    requirementCount: Number(raw.requirementCount ?? 0),
    findingCount: Number(raw.findingCount ?? 0),
    headline: String(raw.headline ?? ""),
    byFamily: (raw.byFamily ?? {}) as Record<string, number>,
    findings: (raw.findings ?? []) as RequirementFindingsView["findings"],
    refusals: (raw.refusals ?? []) as string[],
  };
  const reading = readRequirementFindings(view);

  // The statements the model reads. Fetched under the CALLER's rights through
  // the same org-scoped RLS the rest of the product uses.
  const { data: reqRows } = await caller
    .from("design_requirements")
    .select("requirement_ref, category, requirement")
    .eq("development_case_id", caseId)
    .order("requirement_ref");
  const requirements = (reqRows ?? []).map(
    (r: { requirement_ref: string; category: string; requirement: string }) => ({
      ref: r.requirement_ref,
      category: r.category,
      statement: r.requirement,
    }),
  );

  let narrative: string | null = null;
  let model: string | null = null;
  let providerNote: string | null = null;
  let aiFindings: {
    requirement_ref: string;
    related_requirement_ref: string | null;
    concern: string;
  }[] = [];
  let aiDropped: string[] = [];

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
      "no model provider is configured — the deterministic findings above stand on their own, and no semantic inconsistency check was attempted";
  } else if (requirements.length < 2) {
    providerNote =
      "semantic inconsistency needs at least two requirements to compare — not attempted, and NOT reported as 'no contradictions found'";
  } else {
    const prompts = buildRequirementsPrompts({ reading, requirements });
    const result = await callWithResilience(fetch, providers, {
      systemPrompt: prompts.systemPrompt,
      userContent: prompts.userContent,
      maxTokens: 900,
      timeoutMs: 30_000,
    });
    if (result.events.length > 1 || !result.ok) {
      console.error(
        "develop-requirements-agent provider trail",
        JSON.stringify(result.events),
      );
    }
    if (result.ok) {
      narrative = result.content;
      model = result.model;
      const parsed = parseRequirementInconsistencies(
        result.content,
        requirements.map((r) => r.ref),
      );
      if (parsed.ok) {
        aiFindings = parsed.inconsistencies;
        aiDropped = parsed.dropped;
        // ASKED AND FOUND NOTHING is not the same as NEVER ASKED, and with no
        // note the two were indistinguishable on screen — the "0 findings
        // reads as healthy" failure this slice refuses everywhere else.
        if (aiFindings.length === 0) {
          providerNote =
            `${result.model} was asked whether any two requirement statements contradict ` +
            "each other in meaning and returned none. That is a model's reading of the " +
            "statements, not a finding that no contradiction exists — the deterministic " +
            "findings above are the ones that stand on a query.";
        }
      } else {
        providerNote = parsed.refusal;
      }
    } else {
      providerNote =
        "the model call failed — the deterministic findings above stand on their own";
    }
  }

  // The only write, and only on request. The RPC re-reads every deterministic
  // finding and every count from the database; the payload below contributes
  // narrative and semantic candidates and nothing else.
  let recorded: unknown = null;
  let recordNote: string | null = null;
  if (body.record === true) {
    const { data, error } = await caller.rpc(
      "record_requirements_agent_report",
      {
        p_case_id: caseId,
        // The deterministic reading and the MODEL'S PROSE, with a marker
        // between them. They used to be joined by a blank line into one
        // undifferentiated blob rendered as a single paragraph beside a model
        // name that read as provenance — in a slice whose whole thesis is
        // that a deterministic finding must be distinguishable from a
        // judgement call. The row is immutable and org-readable, so an
        // injected fabrication inside the model half is permanent; it is now
        // permanently LABELLED.
        p_narrative: [
          reading.headline,
          ...reading.familyLines.map((l) => `- ${l}`),
          ...reading.refusalLines,
        ]
          .concat(
            narrative
              ? [
                  "",
                  `── AI-GENERATED (${model ?? "model"}) — a reading of the requirement STATEMENTS, not a query result. Nothing below is a finding of this system. ──`,
                  narrative,
                ]
              : [],
          )
          .join("\n")
          .slice(0, 6000),
        p_model: model,
        p_ai_findings: aiFindings,
      },
    );
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
    refused: false,
    reading,
    findings: view.findings,
    byFamily: view.byFamily,
    requirementCount: view.requirementCount,
    findingCount: view.findingCount,
    refusals: view.refusals,
    aiFindings,
    aiDropped,
    narrative,
    model,
    providerNote,
    recorded,
    recordNote,
    disclaimer:
      "Findings, not dispositions. The AI cannot verify a requirement, close an obligation or record " +
      "a verification result (spec §70): create_requirement_verification and record_verification_result " +
      "both refuse this identity by name, and the persistence wall refuses a verification attributed to " +
      "it for every writer, service included.",
  });
});
