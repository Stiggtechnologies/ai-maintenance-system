// develop-methodology-agent — the Sync Develop Methodology Agent (D12.06,
// spec §56), ADVISORY ONLY (§70 absolute).
//
// Reads ONE document from the tenant's governed intake register and proposes
// the stage-gate framework it describes:
//
//   * retrieval rides the EXISTING governed KB rail — the same claim-typed,
//     org-scoped RPC the evidence agent and the reliability copilot use. No
//     second index, no second way into the tenant's corpus;
//   * the model call rides the EXISTING llm-provider chain (gateway →
//     OpenAI). SyncAI is model-agnostic: no provider or model id is hardcoded
//     here, and with NO provider configured the function refuses honestly
//     rather than proposing a framework it did not read;
//   * the model's answer is validated by the DETERMINISTIC half
//     (develop-agent-core.ts, vitest-tested) against the canonical lifecycle
//     stage vocabulary. A non-canonical stage key is refused, not mapped.
//
// WRITES: exactly one, and only when `record: true` — the governed RPC
// propose_framework_from_document, called AS THE CALLING USER (their JWT,
// their role check), which materializes a DRAFT ProjectFramework with every
// requirement stamped AI_SUGGESTION.
//
// §70: a draft framework governs nothing. adopt_project_framework refuses the
// AI-operator identity by name (20261123090000), so this function holds no
// path — none — that puts a framework into force.

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  buildProviderChain,
  callWithResilience,
  resolveExternalGatewayUrl,
} from "../_shared/llm-provider.ts";
import {
  buildMethodologyPrompts,
  parseFrameworkProposal,
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

// The governance content a framework document carries sits in the analysis
// and maintenance-task claim families; asking across all of them and taking
// the best chunks is the same contract the evidence agent retrieves under.
const KB_CLAIM_TYPES = ["analysis_method", "maintenance_task", "component_structure"];

// websearch_to_tsquery syntax: `or` between quoted phrases and bare words
// yields a DISJUNCTION. Bare words separated by spaces are AND-ed, which is
// what made the original default unmatchable. Kept short so it stays inside
// the rail's 500-character slice with a caller-supplied query still possible.
const DEFAULT_RETRIEVAL_QUERY =
  '"stage gate" or "decision gate" or "gate review" or stages or gates or ' +
  "requirements or deliverables or governance or approval";

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

/** A client that IS the calling user — RPCs run with their auth.uid(). */
const userClient = (token: string) =>
  createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

interface AuthContext {
  token: string;
  userId: string;
  organizationId: string;
  role: string;
}

async function authenticate(req: Request): Promise<AuthContext | null> {
  const header = req.headers.get("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return null;
  const admin = serviceClient();
  const { data: userResult, error: userError } = await admin.auth.getUser(token);
  if (userError || !userResult.user) return null;
  const { data: profile } = await admin
    .from("user_profiles")
    .select("organization_id, role")
    .eq("id", userResult.user.id)
    .maybeSingle();
  if (!profile?.organization_id) return null;
  return {
    token,
    userId: userResult.user.id,
    organizationId: profile.organization_id,
    role: profile.role ?? "user",
  };
}

interface KbChunkRow {
  chunk_id: string;
  title: string;
  page_start: number;
  page_end: number;
  content?: string;
  chunk_text?: string;
  documentClass: string;
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

  let body: { document_id?: string; record?: boolean; query?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }
  const documentId = String(body.document_id ?? "");
  if (!documentId) return json({ error: "document_id is required" }, 400);

  const admin = serviceClient();

  const { data: doc } = await admin
    .from("kb_intake_documents")
    .select("id, title, document_class")
    .eq("id", documentId)
    .eq("organization_id", auth.organizationId)
    .maybeSingle();
  if (!doc) {
    return json(
      {
        error:
          "document not found in this organization's intake register — ingest it through the knowledge-base intake door first",
      },
      404,
    );
  }

  // The canonical stage vocabulary. Read, never assumed: the parser refuses a
  // stage key that is not in this list, so the list has to be the real one.
  const { data: stageRows } = await admin
    .from("lifecycle_stages")
    .select("stage_key, stage_order")
    .order("stage_order");
  const canonicalStageKeys = (stageRows ?? []).map(
    (r: { stage_key: string }) => r.stage_key,
  );
  if (canonicalStageKeys.length === 0) {
    return json({ error: "the canonical lifecycle stage vocabulary is unavailable" }, 500);
  }

  // Retrieval, on the governed rail.
  //
  // THE DEFAULT QUERY IS A DISJUNCTION, AND THAT IS NOT A STYLE CHOICE.
  // retrieve_kb_context runs the query through websearch_to_tsquery, which
  // CONJOINS bare words: the first version's default —
  // `stage gate framework stages gates decision requirements ${doc.title}` —
  // compiled to ten AND-ed lexemes and matched nothing, on any document, ever.
  // Measured against this slice's own fixture, a manual that literally opens
  // "Stage 1 Identify… Stage 2 Select…": 0 chunks for all three claim types.
  // Since the UI is the only caller and it sent no query, the ONLY product path
  // to D12.06 always reached the "nothing was retrieved" refusal. `or` is
  // websearch syntax, so this is one disjunctive tsquery rather than several
  // calls, and the caller can still name a better one.
  const query = (body.query ?? "").trim() || DEFAULT_RETRIEVAL_QUERY;
  const excerpts: string[] = [];
  const seen = new Set<string>();
  const results = await Promise.all(
    KB_CLAIM_TYPES.map((claimType) =>
      admin.rpc("retrieve_kb_context", {
        p_query: query.slice(0, 500),
        p_claim_type: claimType,
        // The rail has no document filter, so the named document is selected
        // from the top-k AFTER ranking (below). At k=4 an unrelated
        // higher-ranked document crowded the named one out of its own
        // proposal; 20 is the rail's own clamp ceiling.
        p_limit: 20,
        p_organization_id: auth.organizationId,
      }),
    ),
  );
  // SCOPED TO THE NAMED DOCUMENT. retrieve_kb_context is the ONE governed
  // retrieval rail and it searches the whole permitted corpus, so the chunks
  // it returns are filtered here to the document the caller named. A proposal
  // assembled from three unrelated documents would carry a basis citing a
  // manual it never read. (The join is on title, which is what the rail
  // returns; two intake documents sharing one title would both contribute,
  // and the response reports which titles were used so that is visible.)
  const wanted = doc.title.trim().toLowerCase();
  for (const result of results) {
    if (result.error) continue;
    for (const chunk of (result.data ?? []) as KbChunkRow[]) {
      if (seen.has(chunk.chunk_id)) continue;
      if ((chunk.title ?? "").trim().toLowerCase() !== wanted) continue;
      seen.add(chunk.chunk_id);
      const content = (chunk.content ?? chunk.chunk_text ?? "").slice(0, 1200);
      if (content.trim().length === 0) continue;
      excerpts.push(`${chunk.title} p.${chunk.page_start}: ${content}`);
      if (excerpts.length >= 8) break;
    }
    if (excerpts.length >= 8) break;
  }

  if (excerpts.length === 0) {
    return json({
      advisory: true,
      documentId,
      documentTitle: doc.title,
      proposal: null,
      refusal:
        `nothing from "${doc.title}" was retrieved for this query, so there is nothing to propose a ` +
        "framework from. Confirm the document finished processing in the knowledge base, or narrow the " +
        "query to wording the document actually uses — a framework proposed from other documents would " +
        "carry a basis citing a manual it never read.",
      recorded: null,
    });
  }

  const gatewayUrl = resolveExternalGatewayUrl(LLM_BASE_URL);
  const providers = buildProviderChain({
    gatewayUrl,
    gatewayKey: gatewayUrl ? Deno.env.get("LLM_API_KEY") : undefined,
    gatewayModel: GATEWAY_MODEL,
    openaiKey: OPENAI_API_KEY,
    openaiModel: MODEL,
  });
  if (providers.length === 0) {
    return json({
      advisory: true,
      documentId,
      documentTitle: doc.title,
      proposal: null,
      refusal:
        "no model provider is configured, so no framework was proposed. Unlike a gap analysis, a framework " +
        "proposal has no deterministic fallback — inventing stages and gates without reading the document " +
        "would be the machine writing governance out of nothing.",
      recorded: null,
    });
  }

  const prompts = buildMethodologyPrompts({
    documentTitle: doc.title,
    documentClass: doc.document_class ?? null,
    excerpts,
    canonicalStageKeys,
  });
  const result = await callWithResilience(fetch, providers, {
    systemPrompt: prompts.systemPrompt,
    userContent: prompts.userContent,
    maxTokens: 1600,
    timeoutMs: 60_000,
  });
  if (result.events.length > 1 || !result.ok) {
    console.error(
      "develop-methodology-agent provider trail",
      JSON.stringify(result.events),
    );
  }
  if (!result.ok) {
    return json({
      advisory: true,
      documentId,
      documentTitle: doc.title,
      proposal: null,
      refusal: "the model call failed, so no framework was proposed.",
      recorded: null,
    });
  }

  const parsed = parseFrameworkProposal(result.content, canonicalStageKeys);
  if (!parsed.ok) {
    return json({
      advisory: true,
      documentId,
      documentTitle: doc.title,
      model: result.model,
      proposal: null,
      refusal: parsed.refusal,
      recorded: null,
    });
  }

  // The only write, and only on request. Through the governed RPC, as the
  // caller, producing a DRAFT nobody but a human can adopt.
  let recorded: unknown = null;
  let recordNote: string | null = null;
  if (body.record === true) {
    const { data, error } = await userClient(auth.token).rpc(
      "propose_framework_from_document",
      {
        p_document_id: documentId,
        p_proposal: {
          ...parsed.proposal,
          agent_key: "sync-develop-methodology",
          model: result.model,
        },
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
    documentId,
    documentTitle: doc.title,
    model: result.model,
    excerptsUsed: excerpts.length,
    proposal: parsed.proposal,
    droppedElements: parsed.dropped,
    recorded,
    recordNote,
    disclaimer:
      "A proposal, not a decision. Everything recorded is a DRAFT framework with every requirement " +
      "tagged AI_SUGGESTION; it governs nothing until a human executive or administrator adopts it, " +
      "and the database refuses this agent's identity at that act (spec §70).",
  });
});
