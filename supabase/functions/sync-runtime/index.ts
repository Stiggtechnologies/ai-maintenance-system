import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  createSyncEventStream,
  sseHeaders,
  type StreamableEvent,
} from "../_shared/sync-stream.ts";
import {
  buildSpecialistBrief,
  selectReliabilitySpecialists,
} from "../_shared/reliability-specialists.ts";
import {
  hasCanonicalIdempotencyKey,
  proposalIsUnexpired,
  proposalParamsHash,
} from "../_shared/sync-tool-proof.ts";
import { notificationTypeFor } from "../_shared/sync-notification-classifier.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const ALLOWED_ORIGIN =
  Deno.env.get("ALLOWED_ORIGIN") ?? "https://app.syncai.ca";
const TOOL_PROPOSAL_TTL_MS = 30 * 60 * 1000;

const JSON_HEADERS = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Cache-Control": "no-store",
  "Content-Type": "application/json",
  Vary: "Origin",
  "X-Content-Type-Options": "nosniff",
};

interface AuthContext {
  token: string;
  userId: string;
  organizationId: string;
  role: string;
}

interface EntityContext {
  type: string;
  id: string;
  displayName?: string;
}

interface SyncAppContext {
  route?: string;
  pageTitle?: string;
  mode?: "conversation" | "meeting" | "field";
  revisionId?: string;
  entity?: EntityContext;
  liveContext?: string;
}

interface ToolExecutionRequest {
  proposalId: string;
  toolId: string;
  idempotencyKey: string;
  params: Record<string, unknown>;
}

interface SyncRequest {
  query?: string;
  conversationId?: string;
  depth?: "standard" | "deliverable";
  context?: SyncAppContext;
  toolExecution?: ToolExecutionRequest;
}

interface AgentResponse {
  success?: boolean;
  response?: string;
  citations?: Array<{
    title?: string;
    pageRange?: string;
    documentClass?: string;
    label?: string;
  }>;
  processingTime?: number;
  modelUsed?: string;
  knowledgeBaseUsed?: boolean;
  error?: string;
  resets_at?: string;
  limit?: string;
}

type ToolProposalEvent = Extract<StreamableEvent, { type: "tool.proposed" }>;
type ToolProposal = ToolProposalEvent["proposal"];

function adminClient() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  });
}

function extractBearer(req: Request): string {
  const value = req.headers.get("Authorization") ?? "";
  return value.startsWith("Bearer ") ? value.slice(7) : "";
}

async function authenticate(req: Request): Promise<AuthContext | null> {
  const token = extractBearer(req);
  if (!token) return null;
  const admin = adminClient();
  const { data: userResult, error: userError } = await admin.auth.getUser(token);
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

async function enabledFlags(
  organizationId: string,
): Promise<Set<string>> {
  const { data, error } = await adminClient()
    .from("feature_flags")
    .select("flag_key, enabled")
    .eq("organization_id", organizationId)
    .eq("enabled", true)
    .like("flag_key", "sync_%");
  if (error) throw error;
  return new Set((data ?? []).map((row) => String(row.flag_key)));
}

function safeMode(
  context?: SyncAppContext,
): "conversation" | "meeting" | "field" {
  return context?.mode === "meeting" || context?.mode === "field"
    ? context.mode
    : "conversation";
}

function normalizeContext(context?: SyncAppContext): SyncAppContext | undefined {
  if (!context) return undefined;
  return {
    ...context,
    route: context.route?.slice(0, 500),
    pageTitle: context.pageTitle?.slice(0, 300),
    revisionId: context.revisionId?.slice(0, 200),
    liveContext: context.liveContext?.slice(0, 5_000),
    entity: context.entity
      ? {
          type: String(context.entity.type).slice(0, 80),
          id: String(context.entity.id).slice(0, 160),
          displayName: context.entity.displayName?.slice(0, 300),
        }
      : undefined,
  };
}

function modeDirective(context?: SyncAppContext): string {
  switch (safeMode(context)) {
    case "meeting":
      return `MEETING MODE — FACILITATION CONTRACT:
Act as a facilitator and technical participant, never as the meeting's authority. Separate confirmed facts, hypotheses, proposals, decisions explicitly made by authenticated participants, unresolved disagreement/dissent, action items, and missing evidence. Do not infer speaker identity from voice/text or treat silence/lack of objection as consensus. Preserve material disagreement rather than averaging it away. End with concise sections titled: Decisions explicitly made; Dissent / unresolved; Actions and owners; Evidence needed.`;
    case "field":
      return `FIELD MODE — CONTROLLED GUIDANCE CONTRACT:
Give voice-friendly, bounded field guidance one step or checkpoint at a time. Never instruct a user to bypass isolation/LOTO, interlocks, protective functions, approved procedures, OEM/site limits, permits, or qualified technical authority. Treat user and sensor observations as evidence, not authorization. If a required procedure, limit, isolation state, or acceptance criterion is not present in approved evidence, stop that branch and identify the qualified role or source needed before proceeding. Distinguish observation, verification, recommendation, and authorization explicitly.`;
    default:
      return "CONVERSATION MODE — answer coherently and preserve the normal governed Reliability Engineer decision discipline.";
  }
}

function modeNotice(context?: SyncAppContext) {
  const mode = safeMode(context);
  if (mode === "meeting") {
    return {
      kind: "warning",
      severity: "info",
      content:
        "Meeting mode does not authenticate speaker identity or infer consensus; explicit participant decisions and dissent remain distinct.",
    };
  }
  if (mode === "field") {
    return {
      kind: "warning",
      severity: "warning",
      content:
        "Field mode provides guidance only. Approved procedures, isolations, protective controls and qualified human authority govern the work.",
    };
  }
  return null;
}

async function resolveWorkspace(
  auth: AuthContext,
  body: SyncRequest,
): Promise<string> {
  const admin = adminClient();
  if (body.conversationId) {
    const { data, error } = await admin
      .from("cowork_workspaces")
      .select("id")
      .eq("id", body.conversationId)
      .eq("organization_id", auth.organizationId)
      .eq("workspace_kind", "sync")
      .eq("created_by", auth.userId)
      .maybeSingle();
    if (error) throw error;
    if (!data?.id) throw new Error("sync_conversation_not_found");

    const { error: updateError } = await admin
      .from("cowork_workspaces")
      .update({
        context_snapshot: body.context ?? {},
        mode: safeMode(body.context),
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.id)
      .eq("organization_id", auth.organizationId)
      .eq("created_by", auth.userId);
    if (updateError) throw updateError;
    return data.id;
  }

  const title =
    String(body.query ?? "New Sync conversation")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 90) || "New Sync conversation";
  const { data, error } = await admin
    .from("cowork_workspaces")
    .insert({
      organization_id: auth.organizationId,
      title,
      objective: "Governed Sync conversation",
      status: "active",
      agents: ["sync", "reliability-engineer"],
      created_by: auth.userId,
      workspace_kind: "sync",
      mode: safeMode(body.context),
      retention_policy: "tenant_default",
      context_snapshot: body.context ?? {},
      last_turn_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error || !data?.id)
    throw error ?? new Error("workspace_create_failed");
  return data.id;
}

async function persistMessage(input: {
  auth: AuthContext;
  workspaceId: string;
  turnId: string;
  role: "user" | "agent";
  message: string;
  status?: string;
  metadata?: Record<string, unknown>;
  blocks?: unknown[];
  evidenceRefs?: unknown[];
}) {
  const { error } = await adminClient().from("cowork_messages").insert({
    organization_id: input.auth.organizationId,
    workspace_id: input.workspaceId,
    turn_id: input.turnId,
    role: input.role,
    agent: input.role === "agent" ? "sync" : null,
    message: input.message,
    delivery_status: input.status ?? "complete",
    metadata: input.metadata ?? {},
    blocks: input.blocks ?? [],
    evidence_refs: input.evidenceRefs ?? [],
  });
  if (error) console.error("sync-runtime message persistence failed", error);
}

async function touchWorkspace(
  organizationId: string,
  workspaceId: string,
  userId: string,
) {
  const now = new Date().toISOString();
  const { error } = await adminClient()
    .from("cowork_workspaces")
    .update({ updated_at: now, last_turn_at: now })
    .eq("id", workspaceId)
    .eq("organization_id", organizationId)
    .eq("created_by", userId);
  if (error) console.error("sync-runtime workspace touch failed", error);
}

function evidenceFromAgent(payload: AgentResponse, turnId: string) {
  return (payload.citations ?? []).map((citation, index) => ({
    id: `${turnId}:kb:${index + 1}`,
    sourceType: "reliability_knowledge_base",
    sourceId: citation.label ?? citation.title ?? `citation-${index + 1}`,
    title: citation.title,
    locator: citation.pageRange
      ? { section: citation.pageRange }
      : undefined,
    retrievedAt: new Date().toISOString(),
  }));
}

function buildGroundedQuery(
  question: string,
  context: SyncAppContext | undefined,
  specialistBrief: string,
): string {
  const contextLines = [
    context?.route ? `APPLICATION ROUTE: ${context.route}` : "",
    context?.pageTitle ? `APPLICATION SURFACE: ${context.pageTitle}` : "",
    context?.entity
      ? `CURRENT ENTITY: ${context.entity.type} ${context.entity.displayName ?? context.entity.id} [id=${context.entity.id}]`
      : "",
    context?.revisionId
      ? `CONTEXT REVISION: ${context.revisionId}`
      : "",
    context?.liveContext
      ? `ROLE-SCOPED LIVE CONTEXT:\n${context.liveContext}`
      : "",
  ].filter(Boolean);

  return [
    "SYNC ROUTING — use the relevant specialist disciplines below while remaining one coherent assistant:",
    specialistBrief,
    modeDirective(context),
    contextLines.join("\n"),
    `QUESTION: ${question}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function proposalFor(
  question: string,
  context: SyncAppContext | undefined,
): ToolProposalEvent | null {
  const entity = context?.entity;
  if (!entity || entity.type !== "asset" || !entity.id) return null;
  if (
    !/\b(report|raise|log|record|create)\b[\s\S]{0,80}\b(fault|observation|maintenance notification|maintenance request)\b/i.test(
      question,
    )
  ) {
    return null;
  }
  const notificationType = notificationTypeFor(question);
  const proposalId = crypto.randomUUID();
  return {
    type: "tool.proposed",
    proposal: {
      proposalId,
      toolId: "raise_maintenance_notification",
      title: `Report this ${notificationType} on ${entity.displayName ?? "the current asset"}`,
      params: {
        assetId: entity.id,
        description: question,
        notificationType,
      },
      targetEntity: entity,
      risk: "low",
      requiresApproval: true,
      contextRevisionId: context?.revisionId,
      reason:
        "Sync can prepare the report, but the authenticated user must confirm before the governed RPC writes it.",
    },
  };
}

async function persistToolProposal(
  auth: AuthContext,
  proposal: ToolProposal,
): Promise<void> {
  const params = proposal.params ?? {};
  const paramsHash = await proposalParamsHash(
    proposal.proposalId,
    proposal.toolId,
    params,
  );
  const expiresAt = new Date(Date.now() + TOOL_PROPOSAL_TTL_MS).toISOString();
  const { error } = await adminClient().from("audit_events").insert({
    organization_id: auth.organizationId,
    entity_type: "sync_tool_proposal",
    actor: auth.userId,
    event_data: {
      status: "proposed",
      proposal_id: proposal.proposalId,
      tool_id: proposal.toolId,
      params_hash: paramsHash,
      expires_at: expiresAt,
    },
  });
  if (error) {
    console.error("sync-runtime proposal persistence failed", error);
    throw new Error("tool_proposal_persistence_failed");
  }
}

async function requireIssuedToolProposal(
  auth: AuthContext,
  execution: ToolExecutionRequest,
): Promise<void> {
  if (
    !execution.proposalId ||
    execution.proposalId.length > 160 ||
    !hasCanonicalIdempotencyKey(
      execution.proposalId,
      execution.idempotencyKey,
    )
  ) {
    throw new Error("invalid_tool_confirmation");
  }

  const { data, error } = await adminClient()
    .from("audit_events")
    .select("id, event_data")
    .eq("organization_id", auth.organizationId)
    .eq("entity_type", "sync_tool_proposal")
    .eq("actor", auth.userId)
    .contains("event_data", { proposal_id: execution.proposalId })
    .maybeSingle();
  if (error || !data?.id) throw new Error("tool_proposal_not_issued");

  const eventData = (data.event_data ?? {}) as Record<string, unknown>;
  if (
    eventData.status !== "proposed" ||
    eventData.tool_id !== execution.toolId ||
    !proposalIsUnexpired(eventData.expires_at)
  ) {
    throw new Error("tool_proposal_invalid_or_expired");
  }

  const expectedHash = String(eventData.params_hash ?? "");
  const actualHash = await proposalParamsHash(
    execution.proposalId,
    execution.toolId,
    execution.params,
  );
  if (!expectedHash || actualHash !== expectedHash) {
    throw new Error("tool_proposal_payload_mismatch");
  }
}

async function reserveToolExecution(
  auth: AuthContext,
  execution: ToolExecutionRequest,
): Promise<{ id: string; replay: unknown | null } | { error: string }> {
  if (!execution.idempotencyKey || execution.idempotencyKey.length > 160) {
    return { error: "invalid_idempotency_key" };
  }
  const admin = adminClient();
  const { data: existing } = await admin
    .from("audit_events")
    .select("id, event_data")
    .eq("organization_id", auth.organizationId)
    .eq("entity_type", "sync_tool_execution")
    .contains("event_data", { idempotency_key: execution.idempotencyKey })
    .maybeSingle();
  if (existing?.id) {
    const eventData = (existing.event_data ?? {}) as Record<string, unknown>;
    if (eventData.status === "completed") {
      return { id: existing.id, replay: eventData.result ?? null };
    }
    return { error: "tool_execution_already_reserved" };
  }

  const { data, error } = await admin
    .from("audit_events")
    .insert({
      organization_id: auth.organizationId,
      entity_type: "sync_tool_execution",
      actor: auth.userId,
      event_data: {
        status: "running",
        idempotency_key: execution.proposalId,
        proposal_id: execution.proposalId,
        tool_id: execution.toolId,
      },
    })
    .select("id")
    .single();
  if (error || !data?.id)
    return { error: "tool_execution_reservation_failed" };
  return { id: data.id, replay: null };
}

async function executeTool(
  auth: AuthContext,
  execution: ToolExecutionRequest,
  onStarted?: (executionId: string) => void,
): Promise<{ executionId: string; result: unknown; replay: boolean }> {
  if (execution.toolId !== "raise_maintenance_notification") {
    throw new Error("tool_not_registered");
  }

  await requireIssuedToolProposal(auth, execution);

  const assetId = String(execution.params.assetId ?? "");
  const description = String(execution.params.description ?? "").trim();
  const notificationType = String(
    execution.params.notificationType ?? "observation",
  );
  if (!assetId || description.length < 5)
    throw new Error("invalid_tool_params");
  if (
    !["fault", "observation", "request", "safety"].includes(notificationType)
  ) {
    throw new Error("invalid_tool_params");
  }

  const reservation = await reserveToolExecution(auth, execution);
  if ("error" in reservation) throw new Error(reservation.error);
  if (reservation.replay !== null) {
    return {
      executionId: reservation.id,
      result: reservation.replay,
      replay: true,
    };
  }
  onStarted?.(reservation.id);

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${auth.token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await userClient.rpc(
    "raise_maintenance_notification",
    {
      p_asset_id: assetId,
      p_description: description,
      p_notification_type: notificationType,
    },
  );
  const result = data ?? (error ? { error: error.message } : null);
  const rpcError =
    error ||
    (result && typeof result === "object" && "error" in result
      ? String((result as { error?: unknown }).error ?? "tool_refused")
      : null);

  await adminClient()
    .from("audit_events")
    .update({
      event_data: {
        status: rpcError ? "refused" : "completed",
        idempotency_key: execution.proposalId,
        proposal_id: execution.proposalId,
        tool_id: execution.toolId,
        result,
      },
    })
    .eq("id", reservation.id)
    .eq("organization_id", auth.organizationId);

  if (rpcError)
    throw new Error(
      typeof rpcError === "string" ? rpcError : rpcError.message,
    );
  return { executionId: reservation.id, result, replay: false };
}

function readableUpstreamError(payload: AgentResponse, status: number): string {
  if (payload.error === "org_daily_quota_exceeded") {
    const reset = payload.resets_at
      ? ` It resets at ${payload.resets_at}.`
      : "";
    return `Your organization's daily AI allowance has been reached.${reset}`;
  }
  if (payload.error === "quota_check_unavailable") {
    return "Sync could not verify the AI spend guardrail, so the model call was refused safely.";
  }
  return `The Reliability Engineer could not complete this turn (${payload.error ?? status}).`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: JSON_HEADERS });
  }
  if (req.method !== "POST")
    return json({ error: "method_not_allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
    console.error("sync-runtime missing required configuration");
    return json({ error: "service_unavailable" }, 503);
  }

  const auth = await authenticate(req);
  if (!auth) return json({ error: "unauthorized" }, 401);

  let body: SyncRequest;
  try {
    body = (await req.json()) as SyncRequest;
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  let flags: Set<string>;
  try {
    flags = await enabledFlags(auth.organizationId);
  } catch (error) {
    console.error("sync-runtime flag read failed", error);
    return json({ error: "feature_flag_unavailable" }, 503);
  }
  if (!flags.has("sync_global_shell")) {
    return json({ error: "sync_not_enabled" }, 403);
  }

  body.context = normalizeContext(body.context);
  const requestedMode = safeMode(body.context);
  if (requestedMode === "meeting" && !flags.has("sync_meeting_mode")) {
    return json({ error: "sync_meeting_mode_disabled" }, 403);
  }
  if (requestedMode === "field" && !flags.has("sync_field_mode")) {
    return json({ error: "sync_field_mode_disabled" }, 403);
  }

  const question = String(body.query ?? "").trim();
  if (!question && !body.toolExecution) {
    return json({ error: "query_required" }, 400);
  }
  if (question.length > 30_000)
    return json({ error: "query_too_large" }, 413);

  const abortController = new AbortController();
  const stream = createSyncEventStream({
    onCancel: () => abortController.abort(),
  });
  const turnId = crypto.randomUUID();
  const send = (event: StreamableEvent) => stream.send(event);

  void (async () => {
    let workspaceId: string | null = null;
    try {
      workspaceId = await resolveWorkspace(auth, body);
      if (!send({ type: "turn.started", turnId, conversationId: workspaceId })) {
        return;
      }

      if (body.toolExecution) {
        if (!flags.has("sync_tools")) {
          send({
            type: "error",
            code: "sync_tools_disabled",
            message:
              "Governed Sync actions are not enabled for this organization.",
            recoverable: false,
          });
          return;
        }
        const executed = await executeTool(
          auth,
          body.toolExecution,
          (executionId) =>
            send({ type: "tool.started", executionId }),
        );
        send({
          type: "tool.completed",
          executionId: executed.executionId,
          result: executed.result,
        });
        await persistMessage({
          auth,
          workspaceId,
          turnId,
          role: "agent",
          message: executed.replay
            ? "The confirmed action had already completed; the prior result was returned without executing it again."
            : "The confirmed maintenance notification was recorded through the governed notification RPC.",
          metadata: {
            tool_id: body.toolExecution.toolId,
            execution_id: executed.executionId,
            idempotent_replay: executed.replay,
          },
        });
        send({ type: "turn.completed", turnId });
        return;
      }

      await persistMessage({
        auth,
        workspaceId,
        turnId,
        role: "user",
        message: question,
        status: "complete",
        metadata: {
          route: body.context?.route,
          mode: safeMode(body.context),
        },
      });

      const specialists = flags.has("sync_agent_routing")
        ? selectReliabilitySpecialists(question)
        : [
            {
              id: "reliability-engineer",
              label: "Reliability Engineer",
              brief:
                "Use the governed Reliability Engineer as the single specialist.",
              claimTypes: [],
            },
          ];
      for (const specialist of specialists) {
        send({ type: "agent.started", agentId: specialist.id });
      }
      send({ type: "retrieval.started", query: question });

      const upstream = await fetch(
        `${SUPABASE_URL}/functions/v1/ai-agent-processor`,
        {
          method: "POST",
          signal: abortController.signal,
          headers: {
            Authorization: `Bearer ${auth.token}`,
            apikey: ANON_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            agentType: "ReliabilityAgent",
            depth:
              body.depth === "deliverable" ? "deliverable" : "standard",
            query: buildGroundedQuery(
              question,
              body.context,
              buildSpecialistBrief(specialists),
            ),
          }),
        },
      );
      const payload = (await upstream
        .json()
        .catch(() => ({}))) as AgentResponse;
      if (!upstream.ok || payload.success === false) {
        send({
          type: "error",
          code: payload.error ?? `upstream_${upstream.status}`,
          message: readableUpstreamError(payload, upstream.status),
          recoverable: false,
        });
        return;
      }

      const answer = String(payload.response ?? "").trim();
      if (!answer) throw new Error("empty_agent_response");
      const evidence = evidenceFromAgent(payload, turnId);
      send({ type: "retrieval.completed", evidence });

      // The existing provider path is deliberately reused so quota reservation,
      // RAG and provider failover remain authoritative. Until that provider gains
      // token callbacks, the completed answer is framed into bounded deltas here;
      // the transport is genuinely incremental and tool/retrieval state is typed.
      const chunkSize = 160;
      for (let index = 0; index < answer.length; index += chunkSize) {
        if (stream.closed || abortController.signal.aborted) return;
        send({
          type: "assistant.delta",
          text: answer.slice(index, index + chunkSize),
        });
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      const markdownBlock = { kind: "markdown", content: answer };
      const noticeBlock = modeNotice(body.context);
      if (noticeBlock) {
        send({ type: "assistant.block", block: noticeBlock });
      }
      send({ type: "assistant.block", block: markdownBlock });
      if (evidence.length > 0) {
        send({
          type: "assistant.block",
          block: { kind: "evidence", items: evidence },
        });
      }

      const proposal = flags.has("sync_tools")
        ? proposalFor(question, body.context)
        : null;
      if (proposal) {
        await persistToolProposal(auth, proposal.proposal);
        send(proposal);
      }

      await persistMessage({
        auth,
        workspaceId,
        turnId,
        role: "agent",
        message: answer,
        metadata: {
          specialists: specialists.map((specialist) => specialist.id),
          processing_time_ms: payload.processingTime ?? null,
          model_used: payload.modelUsed ?? null,
          knowledge_base_used: payload.knowledgeBaseUsed ?? false,
          route: body.context?.route,
          mode: safeMode(body.context),
        },
        blocks: noticeBlock ? [noticeBlock, markdownBlock] : [markdownBlock],
        evidenceRefs: evidence,
      });
      await touchWorkspace(auth.organizationId, workspaceId, auth.userId);

      for (const specialist of specialists) {
        send({
          type: "agent.completed",
          agentId: specialist.id,
          status: "completed",
        });
      }
      send({ type: "turn.completed", turnId });
    } catch (error) {
      if (abortController.signal.aborted || stream.closed) return;
      const message =
        error instanceof Error ? error.message : "sync_turn_failed";
      console.error("sync-runtime turn failed", {
        turnId,
        workspaceId,
        error,
      });
      send({
        type: "error",
        code: "sync_turn_failed",
        message,
        recoverable: false,
      });
    } finally {
      if (workspaceId)
        await touchWorkspace(auth.organizationId, workspaceId, auth.userId);
      stream.close();
    }
  })();

  return new Response(stream.readable, {
    status: 200,
    headers: sseHeaders(req.headers.get("Origin"), [ALLOWED_ORIGIN]),
  });
});
