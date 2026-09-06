// develop-change-impact-agent — the Sync Develop Change Impact Agent
// (D12.10, spec §60), ADVISORY ONLY (§70 absolute).
//
// §60: "Change Impact Agent (graph traversal: changing pump P-102 affects
// power study, foundation, P&ID, HAZOP, BOM, PM, spares, commissioning)."
//
// THE SPLIT THIS FILE EXISTS TO ENFORCE. The traversal is Slice 5C's
// `get_case_thread_impact` — ONE graph, ONE refusal predicate — and this
// function does not recompute it, does not send the graph to a model to be
// re-walked, and does not let a model's answer change which objects are in the
// set. A traversal is a query with one right answer; making it probabilistic
// would produce an affected set nobody could defend at a change board.
//
// The model is used for exactly ONE thing: for objects the traversal ALREADY
// reached, saying what the engineering consequence is likely to be. Nothing in
// the schema can see that. Those outputs are labelled AI-generated end to end —
// `source` is written as 'ai_suggestion' by a SQL literal inside the RPC and
// `severity` is fixed at 'attention' there too, so a model cannot mark its own
// guess blocking or label it deterministic.
//
// THE REFUSAL IS THE ANSWER, AND THE MODEL IS NOT ASKED FOR IT. When the
// traversal refuses — a chain skip, an object with no released revision, a
// severed hop out of the region, a retired object in the path, a backward hop,
// the depth cap — the reached set is a FLOOR. Narrating a floor is how
// "0 downstream impacts" gets written by another route, so no provider is
// called at all and the refusal is returned verbatim with its gaps.
//
// IT CANNOT CHANGE ANYTHING, and that is not a promise this file makes — it is
// five database refusals it inherits:
//
//   * acknowledge_thread_receipt refuses 'ai_admin' by name, so the identity
//     cannot record that a downstream package received a change;
//   * declare_thread_version_authoritative refuses it by name and at a wall
//     bound to declared_by, for every writer including the service key;
//   * sever_thread_link / retire_thread_object / reanchor_thread_object refuse
//     it at their door AND at the wall on the link's and the object's actor
//     columns;
//   * answer_develop_event_consequence refuses it by name, so it cannot clear
//     the gate blocker its own reading might justify;
//   * change_impact_reports has no column that can hold a disposition, and
//     `advisory` is pinned true by a CHECK.
//
// This function holds no path to any of those. Its only write is
// record_change_impact_report, whose counts come from the traversal.
//
// Model-agnostic — no provider or model id is hardcoded here.

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  buildProviderChain,
  callWithResilience,
  resolveExternalGatewayUrl,
} from "../_shared/llm-provider.ts";
import {
  buildChangeImpactPrompts,
  parseChangeConsequences,
  readChangeImpact,
  type ChangeImpactAffected,
  type ChangeImpactView,
} from "../_shared/develop-agent-core.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const LLM_BASE_URL = Deno.env.get("LLM_BASE_URL") ?? "";
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

  let body: { case_id?: string; object_id?: number; record?: boolean };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }
  const caseId = String(body.case_id ?? "");
  const objectId = Number(body.object_id ?? 0);
  if (!caseId) return json({ error: "case_id is required" }, 400);
  if (!Number.isFinite(objectId) || objectId <= 0) {
    return json({ error: "object_id is required" }, 400);
  }

  // Read AS THE CALLING USER. get_case_thread_impact is org-scoped through
  // app_current_org(), and reading it with the service key would hand the
  // agent — and the narrative it writes — a case the requester may not be
  // entitled to.
  const caller = userClient(auth.token);
  const { data: impactData, error: impactError } = await caller.rpc(
    "get_case_thread_impact",
    { p_case_id: caseId, p_object_id: objectId },
  );
  if (impactError) return json({ error: impactError.message }, 400);

  const raw = (impactData ?? {}) as Record<string, unknown> & { error?: string };
  if (raw.error) return json({ error: raw.error }, 404);

  const affected = (raw.affected ?? []) as ChangeImpactAffected[];
  const view: ChangeImpactView = {
    objectRef: String(raw.objectRef ?? ""),
    objectKind: (raw.objectKind as string) ?? null,
    refused: raw.refused === true,
    refusal: (raw.refusal as string) ?? null,
    downstreamCount:
      raw.downstreamCount === null || raw.downstreamCount === undefined
        ? null
        : Number(raw.downstreamCount),
    reachedCount: Number(raw.reachedCount ?? affected.length),
    affected,
    gaps: (raw.gaps ?? []) as ChangeImpactView["gaps"],
  };
  const reading = readChangeImpact(view);

  let narrative: string | null = null;
  let model: string | null = null;
  let providerNote: string | null = null;
  let consequences: { objectRef: string; consequence: string }[] = [];
  let dropped: string[] = [];

  if (view.refused) {
    // RULING 5D-R9. No provider call at all: there is nothing to narrate
    // except a set the product has just declined to state.
    providerNote =
      "the traversal REFUSED, so no model was asked. The objects it reached are a floor, and a narrative over a floor is how a refusal gets read as an answer with a caveat.";
  } else {
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
        "no model provider is configured — the deterministic affected set above stands on its own, and no engineering-consequence reading was attempted";
    } else if (affected.length === 0) {
      providerNote =
        "the affected set is empty, so there is nothing to comment on — NOT reported as 'no consequences'";
    } else {
      const prompts = buildChangeImpactPrompts({
        reading,
        objectRef: view.objectRef,
        objectKind: view.objectKind,
        affected,
      });
      const result = await callWithResilience(fetch, providers, {
        systemPrompt: prompts.systemPrompt,
        userContent: prompts.userContent,
        maxTokens: 900,
        timeoutMs: 30_000,
      });
      if (result.events.length > 1 || !result.ok) {
        console.error(
          "develop-change-impact-agent provider trail",
          JSON.stringify(result.events),
        );
      }
      if (result.ok) {
        narrative = result.content;
        model = result.model;
        const parsed = parseChangeConsequences(
          result.content,
          affected.map((a) => a.objectRef),
        );
        if (parsed.ok) {
          consequences = parsed.consequences;
          dropped = parsed.dropped;
          if (consequences.length === 0) {
            // ASKED AND FOUND NOTHING is not NEVER ASKED.
            providerNote =
              `${result.model} was asked what a change to ${view.objectRef} does to each affected object and named none. ` +
              "That is a model's reading, not a finding that the change is consequence-free — the affected set above is the part that stands on a query.";
          }
        } else {
          providerNote = parsed.refusal;
        }
      } else {
        providerNote =
          "the model call failed — the deterministic affected set above stands on its own";
      }
    }
  }

  // The only write, and only on request. The RPC re-reads the traversal from
  // the database; the payload below contributes narrative and candidate
  // consequences and nothing else.
  let recorded: unknown = null;
  let recordNote: string | null = null;
  if (body.record === true) {
    const { data, error } = await caller.rpc("record_change_impact_report", {
      p_case_id: caseId,
      p_object_id: objectId,
      p_narrative: [
        reading.headline,
        ...reading.affectedLines.map((l) => `- ${l}`),
        ...reading.gapLines.map((l) => `GAP: ${l}`),
      ]
        .concat(
          narrative
            ? [
                "",
                `── AI-GENERATED (${model ?? "model"}) — a reading of what the affected objects are, not a traversal result. Nothing below is a finding of this system. ──`,
                narrative,
              ]
            : [],
        )
        .join("\n")
        .slice(0, 6000),
      p_model: model,
      p_ai_consequences: consequences,
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
    objectId,
    objectRef: view.objectRef,
    refused: view.refused,
    refusal: view.refusal,
    reading,
    downstreamCount: view.downstreamCount,
    reachedCount: view.reachedCount,
    affected,
    gaps: view.gaps,
    aiConsequences: consequences,
    aiDropped: dropped,
    narrative,
    model,
    providerNote,
    recorded,
    recordNote,
    disclaimer:
      "A reading, not a decision. The traversal is get_case_thread_impact — Slice 5C's ONE graph walk — and this agent recomputes none of it. It cannot acknowledge a change receipt, declare a revision authoritative, sever a hop, retire an object or answer an event consequence (spec §70): every one of those refuses this identity by name and at a persistence wall, service key included.",
  });
});
