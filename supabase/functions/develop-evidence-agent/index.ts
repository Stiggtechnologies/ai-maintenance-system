// develop-evidence-agent — the Sync Develop Evidence/Gap agent (D12.07,
// spec §57), ADVISORY ONLY (§70 absolute).
//
// Answers "what evidence supports this gate requirement?" for one criterion
// of one development case:
//
//   * the DETERMINISTIC half (develop-evidence-core.ts, vitest-tested) matches
//     the case's recorded evidence_items and the criterion's deliverables and
//     states the honest verdict — "no evidence found for this requirement" is
//     a first-class result, not a failure;
//   * KB retrieval rides the EXISTING governed rail: retrieve_kb_context
//     (claim-typed, org-scoped; the same RPC the reliability copilot
//     retrieves through) over the tenant's intake corpus. No new retrieval
//     path, no second index;
//   * the model call rides the EXISTING llm-provider chain (gateway →
//     OpenAI → safety model). With NO provider configured the function
//     degrades honestly: the deterministic gap analysis is returned with a
//     providerNote saying no model is configured — it never pretends.
//
// WRITES: none, with one opt-in exception — `record: true` calls the
// EXISTING governed RPC record_case_evidence AS THE CALLING USER (their JWT,
// their role check), inserting an evidence_items row born
// evidence_class='AI_INFERENCE', which the D11.18 guards keep out of
// 'verified' until a human acts. This function holds no path — none — that
// touches criteria, findings, reviews, statuses, or readiness inputs; the
// readiness calculation consumes only review findings, so this agent's
// output structurally cannot move it.

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  buildProviderChain,
  callWithResilience,
  resolveExternalGatewayUrl,
} from "../_shared/llm-provider.ts";
import {
  analyzeGap,
  buildAgentPrompts,
  buildAgentResult,
  type AgentDeliverableRow,
  type AgentEvidenceRow,
  type KbCitation,
} from "../_shared/develop-evidence-core.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const LLM_BASE_URL = Deno.env.get("LLM_BASE_URL") ?? "";
const MODEL = Deno.env.get("DEVELOP_AGENT_MODEL") ?? "gpt-4o-mini";
const ALLOWED_ORIGIN =
  Deno.env.get("ALLOWED_ORIGIN") ?? "https://app.syncai.ca";

// The KB's claim-type gate is part of the retrieval contract; the evidence
// agent asks across the claim families a gate requirement can touch.
const KB_CLAIM_TYPES = [
  "analysis_method",
  "failure_behaviour",
  "component_structure",
  "maintenance_task",
  "nameplate_spec",
];

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

function serviceClient() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** A client that IS the calling user — RPCs run with their auth.uid(). */
function userClient(token: string) {
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

function extractBearer(req: Request): string {
  const value = req.headers.get("Authorization") ?? "";
  return value.startsWith("Bearer ") ? value.slice(7) : "";
}

interface AuthContext {
  token: string;
  userId: string;
  organizationId: string;
  role: string;
}

async function authenticate(req: Request): Promise<AuthContext | null> {
  const token = extractBearer(req);
  if (!token) return null;
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
  documentClass: string;
  isClientPrivate: boolean;
}

async function retrieveKb(
  organizationId: string,
  query: string,
): Promise<KbCitation[]> {
  if (query.trim().length < 12) return [];
  const admin = serviceClient();
  const seen = new Set<string>();
  const citations: KbCitation[] = [];
  const results = await Promise.all(
    KB_CLAIM_TYPES.map((claimType) =>
      admin.rpc("retrieve_kb_context", {
        p_query: query.slice(0, 500),
        p_claim_type: claimType,
        p_limit: 2,
        p_organization_id: organizationId,
      }),
    ),
  );
  for (const result of results) {
    if (result.error) continue;
    for (const chunk of (result.data ?? []) as KbChunkRow[]) {
      if (seen.has(chunk.chunk_id)) continue;
      seen.add(chunk.chunk_id);
      const pageRange =
        chunk.page_end !== chunk.page_start
          ? `p.${chunk.page_start}-${chunk.page_end}`
          : `p.${chunk.page_start}`;
      const provenance = chunk.isClientPrivate
        ? `${chunk.documentClass}, client-supplied`
        : chunk.documentClass;
      citations.push({
        chunkId: chunk.chunk_id,
        title: chunk.title,
        pageRange,
        documentClass: chunk.documentClass,
        label: `[${chunk.title}, ${pageRange} — ${provenance}]`,
      });
      if (citations.length >= 6) return citations;
    }
  }
  return citations;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "POST only" }, 405);
  }
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
    return json({ error: "function is not configured" }, 500);
  }

  const auth = await authenticate(req);
  if (!auth) return json({ error: "authentication required" }, 401);

  let body: { case_id?: string; criterion_id?: number; record?: boolean };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }
  const caseId = String(body.case_id ?? "");
  const criterionId = Number(body.criterion_id ?? 0);
  if (!caseId || !Number.isInteger(criterionId) || criterionId <= 0) {
    return json({ error: "case_id and criterion_id are required" }, 400);
  }

  const admin = serviceClient();

  // The case and the criterion, both pinned to the CALLER's organization —
  // and the criterion's gate pinned to the case's framework, the same rule
  // create_case_deliverable enforces.
  const { data: caseRow, error: caseError } = await admin
    .from("development_cases")
    .select("id, title, framework_id")
    .eq("id", caseId)
    .eq("organization_id", auth.organizationId)
    .maybeSingle();
  if (caseError || !caseRow) {
    return json({ error: "development case not found" }, 404);
  }
  const { data: criterion, error: criterionError } = await admin
    .from("stage_gate_criteria")
    .select("id, criterion, guidance, gate_id, is_mandatory, evidence_type")
    .eq("id", criterionId)
    .eq("organization_id", auth.organizationId)
    .maybeSingle();
  if (criterionError || !criterion) {
    return json({ error: "gate requirement not found" }, 404);
  }
  if (criterion.gate_id != null) {
    const { data: gate } = await admin
      .from("stage_gates")
      .select("id, framework_id")
      .eq("id", criterion.gate_id)
      .eq("organization_id", auth.organizationId)
      .maybeSingle();
    if (!gate || gate.framework_id !== caseRow.framework_id) {
      return json(
        { error: "that requirement belongs to a gate outside this case's governing framework" },
        400,
      );
    }
  }

  const { data: evidenceRows, error: evidenceError } = await admin
    .from("evidence_items")
    .select(
      "id, evidence_class, verification_status, description, source_system, applicability, revision, ts",
    )
    .eq("organization_id", auth.organizationId)
    .eq("development_case_id", caseId)
    .order("ts", { ascending: false })
    .limit(200);
  if (evidenceError) {
    return json({ error: "failed to read case evidence" }, 500);
  }
  const evidence: AgentEvidenceRow[] = (evidenceRows ?? []).map((row) => ({
    id: String(row.id),
    evidenceClass: row.evidence_class,
    verificationStatus: row.verification_status,
    description: row.description,
    sourceSystem: row.source_system,
    applicability: row.applicability,
    revision: row.revision,
    observedAt: row.ts,
  }));

  const { data: deliverableRows } = await admin
    .from("develop_deliverables")
    .select("id, title, status, revision")
    .eq("organization_id", auth.organizationId)
    .eq("development_case_id", caseId)
    .eq("requirement_id", criterionId);
  const deliverables: AgentDeliverableRow[] = (deliverableRows ?? []).map(
    (row) => ({
      id: String(row.id),
      title: row.title,
      status: row.status,
      revision: row.revision,
    }),
  );

  const analysis = analyzeGap(criterion.criterion, evidence, deliverables);
  const kbCitations = await retrieveKb(
    auth.organizationId,
    criterion.criterion,
  );

  // Optional narrative over the deterministic result. Degrades honestly.
  let narrative: string | null = null;
  let model: string | null = null;
  let providerNote: string | null = null;
  const gatewayUrl = resolveExternalGatewayUrl(LLM_BASE_URL);
  const providers = buildProviderChain({
    gatewayUrl,
    gatewayKey: gatewayUrl ? Deno.env.get("LLM_API_KEY") : undefined,
    gatewayModel: Deno.env.get("LLM_GATEWAY_MODEL") ?? "stigg/fast",
    openaiKey: OPENAI_API_KEY,
    openaiModel: MODEL,
  });
  if (providers.length === 0) {
    providerNote =
      "no model provider is configured — the deterministic gap analysis above stands on its own";
  } else {
    const prompts = buildAgentPrompts({
      criterion: criterion.criterion,
      guidance: criterion.guidance,
      analysis,
      kbCitations,
    });
    const result = await callWithResilience(fetch, providers, {
      systemPrompt: prompts.systemPrompt,
      userContent: prompts.userContent,
      maxTokens: 400,
      timeoutMs: 30_000,
    });
    if (result.events.length > 1 || !result.ok) {
      console.error(
        "develop-evidence-agent provider trail",
        JSON.stringify(result.events),
      );
    }
    if (result.ok) {
      narrative = result.content;
      model = result.model;
    } else {
      providerNote =
        "the model call failed — the deterministic gap analysis above stands on its own";
    }
  }

  // Opt-in record of the agent's own finding — through the EXISTING governed
  // RPC, as the calling user, born AI_INFERENCE. The D11.18 guards own the
  // rest of its life.
  let recordedEvidenceId: string | null = null;
  let recordNote: string | null = null;
  if (body.record === true) {
    const description = `Evidence agent finding for "${criterion.criterion.slice(0, 120)}": ${
      analysis.statement
    }${narrative ? ` ${narrative.slice(0, 400)}` : ""}`.slice(0, 900);
    const { data: recorded, error: recordError } = await userClient(
      auth.token,
    ).rpc("record_case_evidence", {
      p_case_id: caseId,
      p_evidence: {
        evidence_class: "AI_INFERENCE",
        description,
        source_system: "develop-evidence-agent",
        source_reference: `criterion:${criterionId}`,
      },
    });
    const payload = recorded as { evidence_id?: string; error?: string } | null;
    if (recordError || payload?.error) {
      recordNote = `not recorded: ${recordError?.message ?? payload?.error}`;
    } else {
      recordedEvidenceId = payload?.evidence_id ?? null;
    }
  }

  return json({
    ...buildAgentResult({
      criterionId,
      criterion: criterion.criterion,
      analysis,
      kbCitations,
      narrative,
      model,
      providerNote,
    }),
    recordedEvidenceId,
    recordNote,
  });
});
