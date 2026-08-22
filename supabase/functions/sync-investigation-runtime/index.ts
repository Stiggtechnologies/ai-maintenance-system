import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import * as XLSX from "npm:xlsx@0.18.5";
import {
  buildProviderChain,
  callWithResilience,
  resolveExternalGatewayUrl,
  type LlmProvider,
} from "../_shared/llm-provider.ts";
import { callWithResilienceStream } from "../_shared/llm-provider-stream.ts";
import { retrieveReliabilityContext } from "../_shared/reliability-context.ts";
import {
  RELIABILITY_PROMPT_VERSION,
  appendApprovedReliabilityContext,
  buildReliabilityEngineerPrompt,
} from "../_shared/reliability-engineer-core.ts";
import {
  selectReliabilitySpecialists,
  type ReliabilitySpecialist,
} from "../_shared/reliability-specialists.ts";
import {
  buildInvestigationPlan,
  compactText,
  formatKpiValue,
  isDataIntegrityKpi,
  isSafetyKpi,
  prioritizeKpis,
  type InvestigationCategory,
  type KpiSnapshot,
} from "../_shared/sync-investigation.ts";
import { notificationTypeFor } from "../_shared/sync-notification-classifier.ts";
import { buildSyncResponsePolicy } from "../_shared/sync-response-policy.ts";
import {
  createSyncEventStream,
  sseHeaders,
  type StreamableEvent,
} from "../_shared/sync-stream.ts";
import { proposalParamsHash } from "../_shared/sync-tool-proof.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") ?? "https://app.syncai.ca";
const LLM_BASE_URL = Deno.env.get("LLM_BASE_URL") ?? "https://api.openai.com";
const MODEL_DELIVERABLE = Deno.env.get("MODEL_DELIVERABLE") ?? "gpt-5.6-terra";
const MODEL_CHAT = Deno.env.get("MODEL_CHAT") ?? "gpt-5.6-luna";
const MODEL_RELIABILITY = Deno.env.get("MODEL_RELIABILITY") ?? MODEL_DELIVERABLE;
const MODEL_SAFETY = "gpt-4o-mini";
const TIER_DELIVERABLE = Deno.env.get("TIER_DELIVERABLE") ?? "stigg/agent";
const TIER_CHAT = Deno.env.get("TIER_CHAT") ?? "stigg/fast";
const TOOL_PROPOSAL_TTL_MS = 30 * 60 * 1000;
const MAX_ATTACHMENTS_PER_TURN = 8;
const MAX_ATTACHMENT_TEXT = 60_000;

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
  context?: SyncAppContext;
  attachmentIds?: string[];
  toolExecution?: ToolExecutionRequest;
}

interface EvidenceReference {
  id: string;
  sourceType: string;
  sourceId: string;
  title?: string;
  excerpt?: string;
  locator?: {
    page?: number;
    section?: string;
    timestamp?: string;
    recordId?: string;
  };
  applicationUrl?: string;
  retrievedAt?: string;
}

interface InvestigationCheckRecord {
  id: string;
  label: string;
  category: InvestigationCategory;
  state: "ok" | "attention" | "unavailable";
  detail?: string;
  durationMs?: number;
  evidence?: EvidenceReference[];
}

interface TurnTelemetry {
  firstActivityMs?: number | null;
  firstEvidenceMs?: number | null;
  firstTokenMs?: number | null;
  retrievalMs?: number | null;
  specialistMs?: number | null;
  modelMs?: number | null;
  totalMs?: number | null;
  sourceCount?: number;
  checkCount?: number;
}

interface ContextSource {
  label: string;
  priority: number;
  text: string;
  evidence: EvidenceReference;
}

interface AttachmentRow {
  id: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  object_path: string;
  extraction_status: string;
  extracted_text: string | null;
}

interface QuotaVerdict {
  allowed?: boolean;
  reservation_id?: number;
  limit?: string;
  resets_at?: string;
}

function adminClient() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function userClient(auth: AuthContext) {
  return createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${auth.token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
      Vary: "Origin",
      "X-Content-Type-Options": "nosniff",
    },
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

async function enabledFlags(organizationId: string): Promise<Set<string>> {
  const { data, error } = await adminClient()
    .from("feature_flags")
    .select("flag_key, enabled")
    .eq("organization_id", organizationId)
    .eq("enabled", true)
    .like("flag_key", "sync_%");
  if (error) throw error;
  return new Set((data ?? []).map((row) => String(row.flag_key)));
}

function safeMode(context?: SyncAppContext): "conversation" | "meeting" | "field" {
  return context?.mode === "meeting" || context?.mode === "field"
    ? context.mode
    : "conversation";
}

function normalizeContext(context?: SyncAppContext): SyncAppContext | undefined {
  if (!context) return undefined;
  return {
    route: context.route?.slice(0, 500),
    pageTitle: context.pageTitle?.slice(0, 300),
    mode: safeMode(context),
    revisionId: context.revisionId?.slice(0, 200),
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
  if (safeMode(context) === "meeting") {
    return `MEETING MODE — FACILITATION CONTRACT:
Act as facilitator and technical participant, never as meeting authority. Separate confirmed facts, hypotheses, explicit participant decisions, dissent, actions and missing evidence. Never infer speaker identity or consensus from silence.`;
  }
  if (safeMode(context) === "field") {
    return `FIELD MODE — CONTROLLED GUIDANCE CONTRACT:
Give bounded field guidance one checkpoint at a time. Never bypass LOTO/isolation, interlocks, protective functions, approved procedures, permits, OEM/site limits or qualified authority. Stop when required evidence or authorization is missing.`;
  }
  return "CONVERSATION MODE — preserve governed Reliability Engineer decision discipline.";
}

function gatewayTierFor(model: string): string {
  return model === MODEL_RELIABILITY || model === MODEL_DELIVERABLE
    ? TIER_DELIVERABLE
    : TIER_CHAT;
}

function providersFor(model: string): LlmProvider[] {
  const gatewayUrl = resolveExternalGatewayUrl(LLM_BASE_URL);
  return buildProviderChain({
    gatewayUrl,
    gatewayKey: gatewayUrl ? Deno.env.get("LLM_API_KEY") : undefined,
    gatewayModel: gatewayTierFor(model),
    openaiKey: OPENAI_API_KEY,
    openaiModel: model,
    openaiSafetyModel: MODEL_SAFETY,
  });
}

async function recordProviderEvents(events: Array<Record<string, unknown>>) {
  if (events.length <= 1 && events[0]?.outcome === "ok") return;
  try {
    await adminClient().from("llm_provider_events").insert(
      events.map((event) => ({
        function_name: "sync-investigation-runtime",
        provider: event.provider,
        outcome: event.outcome,
        status: event.status,
        detail: event.detail,
      })),
    );
  } catch {
    // Provider health logging is fail-soft; the turn itself stays authoritative.
  }
}

async function reserveQuota(
  organizationId: string,
  model: string,
  estimatedTokens: number,
): Promise<number> {
  const { data, error } = await adminClient().rpc("check_llm_quota", {
    p_organization_id: organizationId,
    p_fn: "sync-investigation-runtime",
    p_model: model,
    p_estimated_tokens: Math.max(0, Math.ceil(estimatedTokens)),
  });
  if (error) throw new Error("quota_check_unavailable");
  const verdict = (data ?? {}) as QuotaVerdict;
  if (verdict.allowed !== true) {
    const reset = verdict.resets_at ? ` It resets at ${verdict.resets_at}.` : "";
    throw new Error(`Your organization's daily AI allowance has been reached.${reset}`);
  }
  if (typeof verdict.reservation_id !== "number") {
    throw new Error("quota_reservation_missing");
  }
  return verdict.reservation_id;
}

async function settleQuota(
  organizationId: string,
  model: string,
  usage: Record<string, number>,
  reservationId: number,
) {
  const { error } = await adminClient().rpc("record_llm_usage", {
    p_organization_id: organizationId,
    p_fn: "sync-investigation-runtime",
    p_model: model,
    p_prompt_tokens: usage.prompt_tokens ?? usage.input_tokens ?? 0,
    p_completion_tokens: usage.completion_tokens ?? usage.output_tokens ?? 0,
    p_reservation_id: reservationId,
  });
  if (error) console.error("Sync quota settlement failed", error);
}

async function releaseQuota(reservationId: number | null) {
  if (reservationId === null) return;
  try {
    await adminClient().rpc("release_llm_reservation", {
      p_reservation_id: reservationId,
    });
  } catch {
    // Fail-closed overcount is safer than an unbounded call.
  }
}

async function resolveWorkspace(auth: AuthContext, body: SyncRequest): Promise<string> {
  const admin = adminClient();
  if (body.conversationId) {
    const { data, error } = await admin
      .from("cowork_workspaces")
      .select("id, status")
      .eq("id", body.conversationId)
      .eq("organization_id", auth.organizationId)
      .eq("workspace_kind", "sync")
      .eq("created_by", auth.userId)
      .maybeSingle();
    if (error) throw error;
    if (!data?.id) throw new Error("sync_conversation_not_found");
    if (data.status !== "active") throw new Error("sync_conversation_archived");
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

  const title = compactText(body.query || "New Sync conversation", 90) || "New Sync conversation";
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
  if (error || !data?.id) throw error ?? new Error("workspace_create_failed");
  return data.id;
}

async function persistMessage(input: {
  auth: AuthContext;
  workspaceId: string;
  turnId: string;
  role: "user" | "agent";
  message: string;
  metadata?: Record<string, unknown>;
  evidenceRefs?: EvidenceReference[];
}) {
  const { error } = await adminClient().from("cowork_messages").insert({
    organization_id: input.auth.organizationId,
    workspace_id: input.workspaceId,
    turn_id: input.turnId,
    role: input.role,
    agent: input.role === "agent" ? "sync" : null,
    message: input.message,
    delivery_status: "complete",
    metadata: input.metadata ?? {},
    blocks: input.role === "agent" ? [{ kind: "markdown", content: input.message }] : [],
    evidence_refs: input.evidenceRefs ?? [],
  });
  if (error) console.error("Sync message persistence failed", error);
}

async function touchWorkspace(auth: AuthContext, workspaceId: string) {
  const now = new Date().toISOString();
  await adminClient()
    .from("cowork_workspaces")
    .update({ updated_at: now, last_turn_at: now })
    .eq("id", workspaceId)
    .eq("organization_id", auth.organizationId)
    .eq("created_by", auth.userId);
}

function nextLabel(prefix: "L" | "A", counters: Record<string, number>): string {
  counters[prefix] = (counters[prefix] ?? 0) + 1;
  return `${prefix}${counters[prefix]}`;
}

function sourceFromKpi(row: KpiSnapshot, label: string, priority: number): ContextSource {
  const value = formatKpiValue(row);
  const status = row.status ?? "unknown";
  const evidence: EvidenceReference = {
    id: label,
    sourceType: "kpi",
    sourceId: label,
    title: row.name,
    excerpt: `${row.name}: ${value} [${status}]`,
    locator: row.computed_at ? { timestamp: row.computed_at } : undefined,
    retrievedAt: new Date().toISOString(),
  };
  return {
    label,
    priority,
    text: `${row.name}=${value}; status=${status}; confidence=${row.confidence ?? "unknown"}${row.accountable ? `; accountable=${row.accountable}` : ""}${row.responsible ? `; responsible=${row.responsible}` : ""}`,
    evidence,
  };
}

async function extractPdfOrImage(
  auth: AuthContext,
  fileName: string,
  mimeType: string,
  blob: Blob,
): Promise<{ text: string; usage: Record<string, number>; model: string }> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  const dataUrl = `data:${mimeType};base64,${btoa(binary)}`;
  const model = MODEL_CHAT;
  const reservationId = await reserveQuota(auth.organizationId, model, 5_000);
  try {
    const content = mimeType === "application/pdf"
      ? [
          { type: "input_file", filename: fileName, file_data: dataUrl },
          { type: "input_text", text: "Extract the factual text, tables, labels and measurements from this source. Preserve uncertainty and units. Do not analyze or recommend. Return concise Markdown suitable for evidence grounding." },
        ]
      : [
          { type: "input_image", image_url: dataUrl, detail: "auto" },
          { type: "input_text", text: "Transcribe and describe only factual visible content relevant to industrial engineering. Preserve labels, values, units and uncertainty. Do not infer hidden facts or recommend actions." },
        ];
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      signal: AbortSignal.timeout(90_000),
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        store: false,
        max_output_tokens: 4_000,
        input: [{ role: "user", content }],
      }),
    });
    if (!response.ok) throw new Error(`attachment_extract_${response.status}`);
    const payload = (await response.json()) as Record<string, unknown>;
    const outputText = typeof payload.output_text === "string"
      ? payload.output_text
      : Array.isArray(payload.output)
        ? payload.output
            .flatMap((item) =>
              item && typeof item === "object" && Array.isArray((item as { content?: unknown[] }).content)
                ? (item as { content: Array<{ text?: string }> }).content.map((part) => part.text ?? "")
                : [],
            )
            .join("\n")
        : "";
    if (!outputText.trim()) throw new Error("attachment_extract_empty");
    const usage = payload.usage && typeof payload.usage === "object"
      ? (payload.usage as Record<string, number>)
      : {};
    await settleQuota(auth.organizationId, model, usage, reservationId);
    return { text: outputText.slice(0, MAX_ATTACHMENT_TEXT), usage, model };
  } catch (error) {
    await releaseQuota(reservationId);
    throw error;
  }
}

async function extractAttachment(
  auth: AuthContext,
  workspaceId: string,
  row: AttachmentRow,
): Promise<string | null> {
  if (row.extraction_status === "ready" && row.extracted_text) {
    return row.extracted_text.slice(0, MAX_ATTACHMENT_TEXT);
  }
  const admin = adminClient();
  await admin
    .from("cowork_attachments")
    .update({ extraction_status: "extracting" })
    .eq("id", row.id)
    .eq("organization_id", auth.organizationId)
    .eq("workspace_id", workspaceId)
    .eq("uploaded_by", auth.userId);
  try {
    const { data, error } = await admin.storage
      .from("sync-attachments")
      .download(row.object_path);
    if (error || !data) throw error ?? new Error("attachment_download_failed");
    const mime = row.mime_type ?? data.type ?? "application/octet-stream";
    const lower = row.file_name.toLowerCase();
    let text: string | null = null;
    let method = "unsupported";

    if (
      mime.startsWith("text/") ||
      /\.(txt|md|markdown|csv|json|xml|yaml|yml|log)$/i.test(lower)
    ) {
      text = (await data.text()).slice(0, MAX_ATTACHMENT_TEXT);
      method = "direct_text";
    } else if (/\.xlsx$/i.test(lower)) {
      const workbook = XLSX.read(new Uint8Array(await data.arrayBuffer()), { type: "array" });
      text = workbook.SheetNames.slice(0, 8)
        .map((name) => `## Sheet: ${name}\n${XLSX.utils.sheet_to_csv(workbook.Sheets[name])}`)
        .join("\n\n")
        .slice(0, MAX_ATTACHMENT_TEXT);
      method = "xlsx_to_csv";
    } else if (mime === "application/pdf" || mime.startsWith("image/")) {
      const extracted = await extractPdfOrImage(auth, row.file_name, mime, data);
      text = extracted.text;
      method = mime === "application/pdf" ? "multimodal_pdf" : "multimodal_image";
    }

    if (!text?.trim()) {
      await admin
        .from("cowork_attachments")
        .update({
          extraction_status: "unsupported",
          extraction_metadata: { method, reason: "No supported extractor for this file type" },
        })
        .eq("id", row.id)
        .eq("organization_id", auth.organizationId)
        .eq("workspace_id", workspaceId);
      return null;
    }

    await admin
      .from("cowork_attachments")
      .update({
        extraction_status: "ready",
        extracted_text: text,
        extraction_metadata: { method, chars: text.length },
      })
      .eq("id", row.id)
      .eq("organization_id", auth.organizationId)
      .eq("workspace_id", workspaceId)
      .eq("uploaded_by", auth.userId);
    return text;
  } catch (error) {
    console.error("Sync attachment extraction failed", { attachmentId: row.id, error });
    await admin
      .from("cowork_attachments")
      .update({
        extraction_status: "failed",
        extraction_metadata: { reason: "Extraction failed safely" },
      })
      .eq("id", row.id)
      .eq("organization_id", auth.organizationId)
      .eq("workspace_id", workspaceId);
    return null;
  }
}

function addEvidenceSources(
  target: ContextSource[],
  rows: KpiSnapshot[],
  counters: Record<string, number>,
  priority: number,
) {
  for (const row of rows) {
    const label = nextLabel("L", counters);
    target.push(sourceFromKpi(row, label, priority));
  }
}

async function runInvestigation(input: {
  auth: AuthContext;
  workspaceId: string;
  question: string;
  context?: SyncAppContext;
  attachmentIds: string[];
  send: (event: StreamableEvent) => boolean;
  startedAt: number;
  telemetry: TurnTelemetry;
}): Promise<{
  checks: InvestigationCheckRecord[];
  sources: ContextSource[];
  riskCheckPending: boolean;
}> {
  const { auth, workspaceId, question, context, attachmentIds, send, startedAt, telemetry } = input;
  const client = userClient(auth);
  const plan = buildInvestigationPlan({
    question,
    entityType: context?.entity?.type,
    attachmentCount: attachmentIds.length,
  });
  const checks: InvestigationCheckRecord[] = [];
  const sources: ContextSource[] = [];
  const counters: Record<string, number> = {};
  let dashboard: KpiSnapshot[] | null = null;
  let riskCheckPending = false;

  send({ type: "investigation.started", turnId: crypto.randomUUID(), plannedChecks: plan.length });
  if (telemetry.firstActivityMs == null) telemetry.firstActivityMs = Date.now() - startedAt;

  const loadDashboard = async () => {
    if (dashboard) return dashboard;
    const { data, error } = await client.rpc("get_kpi_dashboard");
    if (error) throw error;
    const result = data as { kpis?: KpiSnapshot[]; error?: string };
    if (result?.error) throw new Error(result.error);
    dashboard = result?.kpis ?? [];
    return dashboard;
  };

  for (const item of plan) {
    if (item.id === "risk-ranking") {
      send({ type: "investigation.check.started", checkId: item.id, label: item.label, category: item.category });
      riskCheckPending = true;
      continue;
    }
    const checkStarted = Date.now();
    send({ type: "investigation.check.started", checkId: item.id, label: item.label, category: item.category });
    let state: InvestigationCheckRecord["state"] = "ok";
    let detail = "Checked";
    const checkEvidence: EvidenceReference[] = [];
    try {
      if (item.id === "operational-kpis") {
        const rows = prioritizeKpis(await loadDashboard());
        const breach = rows.filter((row) => row.status === "breach").length;
        const watch = rows.filter((row) => row.status === "watch").length;
        state = breach > 0 ? "attention" : "ok";
        detail = `${rows.length} role-visible indicators · ${breach} breached · ${watch} watch`;
        const before = sources.length;
        addEvidenceSources(sources, rows.slice(0, 14), counters, 1);
        checkEvidence.push(...sources.slice(before).map((source) => source.evidence));
      } else if (item.id === "asset-data-integrity") {
        const rows = (await loadDashboard()).filter(isDataIntegrityKpi);
        const prioritized = prioritizeKpis(rows, 8);
        const attention = prioritized.filter((row) => row.status === "breach" || row.status === "watch");
        state = attention.length > 0 ? "attention" : prioritized.length > 0 ? "ok" : "unavailable";
        detail = prioritized.length
          ? `${prioritized.length} integrity/coverage indicators · ${attention.length} require attention`
          : "No role-visible data-integrity KPI is currently available";
        const before = sources.length;
        addEvidenceSources(sources, prioritized, counters, 0);
        checkEvidence.push(...sources.slice(before).map((source) => source.evidence));
      } else if (item.id === "safety-indicators") {
        const rows = prioritizeKpis((await loadDashboard()).filter(isSafetyKpi), 8);
        const attention = rows.filter((row) => row.status === "breach" || row.status === "watch");
        state = attention.length > 0 ? "attention" : rows.length > 0 ? "ok" : "unavailable";
        detail = rows.length
          ? `${rows.length} role-visible safety/risk indicators · ${attention.length} require attention`
          : "No role-visible safety KPI is currently available";
        const before = sources.length;
        addEvidenceSources(sources, rows, counters, 0);
        checkEvidence.push(...sources.slice(before).map((source) => source.evidence));
      } else if (item.id === "open-recommendations") {
        const { data, error } = await client
          .from("recommendations")
          .select("id, title, urgency, status, asset_id, created_at")
          .in("status", ["pending", "escalated"])
          .order("created_at", { ascending: false })
          .limit(10);
        if (error) throw error;
        const rows = data ?? [];
        state = rows.length > 0 ? "attention" : "ok";
        detail = rows.length ? `${rows.length} open recommendations reviewed` : "No open recommendations returned";
        for (const row of rows) {
          const label = nextLabel("L", counters);
          const evidence: EvidenceReference = {
            id: label,
            sourceType: "recommendation",
            sourceId: label,
            title: row.title,
            excerpt: `${row.title} [${row.urgency}; ${row.status}]`,
            locator: { recordId: row.id, timestamp: row.created_at },
            applicationUrl: "/recommendations",
            retrievedAt: new Date().toISOString(),
          };
          sources.push({ label, priority: row.urgency === "critical" ? 0 : 2, text: `${row.title}; urgency=${row.urgency}; status=${row.status}`, evidence });
          checkEvidence.push(evidence);
        }
      } else if (item.id === "current-asset") {
        if (!context?.entity?.id || context.entity.type !== "asset") {
          state = "unavailable";
          detail = "No current asset is selected in application context";
        } else {
          const { data, error } = await client
            .from("assets")
            .select("id, tag, name, asset_class, criticality, status, health_score, risk_score, area, system, manufacturer, model, serial_number")
            .eq("id", context.entity.id)
            .maybeSingle();
          if (error) throw error;
          if (!data) {
            state = "unavailable";
            detail = "Current asset is not visible to this role";
          } else {
            state = data.status === "critical" ? "attention" : "ok";
            detail = `${data.name}${data.tag ? ` · ${data.tag}` : ""} · ${data.status ?? "status unknown"}`;
            const label = nextLabel("L", counters);
            const evidence: EvidenceReference = {
              id: label,
              sourceType: "asset",
              sourceId: label,
              title: data.name,
              excerpt: `${data.name}; tag=${data.tag ?? "unknown"}; class=${data.asset_class ?? "unknown"}; criticality=${data.criticality ?? "unknown"}; status=${data.status ?? "unknown"}; health=${data.health_score ?? "unknown"}; risk=${data.risk_score ?? "unknown"}`,
              locator: { recordId: data.id },
              applicationUrl: `/assets/${data.id}`,
              retrievedAt: new Date().toISOString(),
            };
            sources.push({ label, priority: 0, text: evidence.excerpt ?? data.name, evidence });
            checkEvidence.push(evidence);
          }
        }
      } else if (item.id === "work-context") {
        let query = client
          .from("work_orders")
          .select("id, wo_number, title, status, priority, asset_id, assignee, scheduled_date, estimated_hours, parts_ready, safety_flag, created_at")
          .order("created_at", { ascending: false })
          .limit(10);
        if (context?.entity?.type === "work_order") query = query.eq("id", context.entity.id);
        else if (context?.entity?.type === "asset") query = query.eq("asset_id", context.entity.id);
        const { data, error } = await query;
        if (error) throw error;
        const rows = data ?? [];
        const high = rows.filter((row) => row.priority === "critical" || row.priority === "high" || row.safety_flag).length;
        state = high > 0 ? "attention" : rows.length > 0 ? "ok" : "unavailable";
        detail = rows.length ? `${rows.length} work records reviewed · ${high} high/safety-significant` : "No matching work records returned";
        for (const row of rows) {
          const label = nextLabel("L", counters);
          const evidence: EvidenceReference = {
            id: label,
            sourceType: "work_order",
            sourceId: label,
            title: row.title,
            excerpt: `${row.wo_number ?? row.id}: ${row.title}; status=${row.status}; priority=${row.priority}; parts_ready=${row.parts_ready}; safety_flag=${row.safety_flag}`,
            locator: { recordId: row.id, timestamp: row.created_at },
            applicationUrl: `/work/${row.id}`,
            retrievedAt: new Date().toISOString(),
          };
          sources.push({ label, priority: row.safety_flag || row.priority === "critical" ? 0 : 2, text: evidence.excerpt ?? row.title, evidence });
          checkEvidence.push(evidence);
        }
      } else if (item.id === "attachments") {
        const ids = attachmentIds.slice(0, MAX_ATTACHMENTS_PER_TURN);
        const { data, error } = await adminClient()
          .from("cowork_attachments")
          .select("id, file_name, mime_type, size_bytes, object_path, extraction_status, extracted_text")
          .eq("organization_id", auth.organizationId)
          .eq("workspace_id", workspaceId)
          .eq("uploaded_by", auth.userId)
          .is("deleted_at", null)
          .in("id", ids);
        if (error) throw error;
        const rows = (data ?? []) as AttachmentRow[];
        let ready = 0;
        for (const row of rows) {
          const text = await extractAttachment(auth, workspaceId, row);
          if (!text) continue;
          ready += 1;
          const label = nextLabel("A", counters);
          const evidence: EvidenceReference = {
            id: label,
            sourceType: "attachment",
            sourceId: label,
            title: row.file_name,
            excerpt: compactText(text, 300),
            locator: { recordId: row.id },
            retrievedAt: new Date().toISOString(),
          };
          sources.push({ label, priority: 1, text: `Attached source ${row.file_name}:\n${text.slice(0, 12_000)}`, evidence });
          checkEvidence.push(evidence);
        }
        state = ready === rows.length && ready > 0 ? "ok" : ready > 0 ? "attention" : "unavailable";
        detail = `${ready}/${ids.length} attached sources ready for grounding`;
      } else {
        detail = "Governed context will be retrieved from the Reliability knowledge base";
      }
    } catch (error) {
      state = "unavailable";
      detail = `Check unavailable: ${error instanceof Error ? error.message : "unknown error"}`;
    }

    const check: InvestigationCheckRecord = {
      id: item.id,
      label: item.label.replace(/ing\b/, "ed"),
      category: item.category,
      state,
      detail,
      durationMs: Date.now() - checkStarted,
      evidence: checkEvidence,
    };
    checks.push(check);
    if (telemetry.firstEvidenceMs == null && checkEvidence.length > 0) {
      telemetry.firstEvidenceMs = Date.now() - startedAt;
    }
    send({ type: "investigation.check.completed", check });
    send({ type: "telemetry.updated", telemetry: { ...telemetry } });
  }

  return { checks, sources, riskCheckPending };
}

function buildPrioritizedContext(sources: ContextSource[]): string {
  const selected = [...sources]
    .sort((a, b) => a.priority - b.priority)
    .slice(0, 28);
  return selected
    .map((source) => `[${source.label}] ${source.text.slice(0, 12_000)}`)
    .join("\n");
}

function kbEvidence(citations: Array<{ label?: string; title?: string; pageRange?: string }> | undefined): EvidenceReference[] {
  return (citations ?? []).map((citation, index) => ({
    id: citation.label ?? `R${index + 1}`,
    sourceType: "reliability_knowledge_base",
    sourceId: citation.label ?? `R${index + 1}`,
    title: citation.title,
    locator: citation.pageRange ? { section: citation.pageRange } : undefined,
    retrievedAt: new Date().toISOString(),
  }));
}

async function runFocusedSpecialist(input: {
  auth: AuthContext;
  specialist: ReliabilitySpecialist;
  question: string;
  contextText: string;
  kbPrompt: string;
}): Promise<{ text: string; model: string; durationMs: number }> {
  const { auth, specialist, question, contextText, kbPrompt } = input;
  const model = MODEL_CHAT;
  const reservationId = await reserveQuota(auth.organizationId, model, 2_500);
  const started = Date.now();
  try {
    const base = buildReliabilityEngineerPrompt({ accessMode: "authenticated" });
    const systemPrompt = appendApprovedReliabilityContext(
      `${base}\n\nFOCUSED SPECIALIST EXECUTION — ${specialist.label}:\n${specialist.brief}\nReturn at most six decision-relevant bullets. Separate facts from hypotheses, cite supplied labels where applicable, and do not make the final cross-disciplinary decision.`,
      kbPrompt,
    );
    const result = await callWithResilience(fetch, providersFor(model), {
      systemPrompt,
      userContent: `${contextText}\n\nQUESTION: ${question}`,
      maxTokens: 900,
      timeoutMs: 60_000,
    });
    await recordProviderEvents(result.events as unknown as Array<Record<string, unknown>>);
    if (!result.ok) throw new Error("specialist_provider_unavailable");
    await settleQuota(auth.organizationId, result.model ?? model, result.usage, reservationId);
    return { text: result.content, model: result.model ?? model, durationMs: Date.now() - started };
  } catch (error) {
    await releaseQuota(reservationId);
    throw error;
  }
}

async function persistToolProposal(auth: AuthContext, proposal: Record<string, unknown>) {
  const proposalId = String(proposal.proposalId ?? "");
  const toolId = String(proposal.toolId ?? "");
  const params = (proposal.params ?? {}) as Record<string, unknown>;
  const paramsHash = await proposalParamsHash(proposalId, toolId, params);
  const expiresAt = new Date(Date.now() + TOOL_PROPOSAL_TTL_MS).toISOString();
  const { error } = await adminClient().from("audit_events").insert({
    organization_id: auth.organizationId,
    entity_type: "sync_tool_proposal",
    actor: auth.userId,
    event_data: {
      status: "proposed",
      proposal_id: proposalId,
      tool_id: toolId,
      params_hash: paramsHash,
      expires_at: expiresAt,
    },
  });
  if (error) throw new Error("tool_proposal_persistence_failed");
}

async function maybeProposeAction(auth: AuthContext, question: string, context?: SyncAppContext) {
  const entity = context?.entity;
  if (!entity || entity.type !== "asset" || !entity.id) return null;
  if (!/\b(report|raise|log|record|create)\b[\s\S]{0,80}\b(fault|observation|maintenance notification|maintenance request)\b/i.test(question)) return null;
  const notificationType = notificationTypeFor(question);
  const proposal = {
    proposalId: crypto.randomUUID(),
    toolId: "raise_maintenance_notification",
    title: `Report this ${notificationType} on ${entity.displayName ?? "the current asset"}`,
    params: { assetId: entity.id, description: question, notificationType },
    targetEntity: entity,
    risk: "low",
    requiresApproval: true,
    contextRevisionId: context?.revisionId,
    reason: "Sync prepared the report; you must confirm before the governed application RPC writes it.",
  };
  await persistToolProposal(auth, proposal);
  return proposal;
}

async function proxyGovernedTool(req: Request, body: SyncRequest, auth: AuthContext): Promise<Response> {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/sync-runtime`, {
    method: "POST",
    signal: req.signal,
    headers: {
      Authorization: `Bearer ${auth.token}`,
      apikey: ANON_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return new Response(response.body, {
    status: response.status,
    headers: sseHeaders(req.headers.get("Origin"), [ALLOWED_ORIGIN]),
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: sseHeaders(req.headers.get("Origin"), [ALLOWED_ORIGIN]) });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY || !OPENAI_API_KEY) return json({ error: "service_unavailable" }, 503);

  const auth = await authenticate(req);
  if (!auth) return json({ error: "unauthorized" }, 401);

  let body: SyncRequest;
  try {
    body = (await req.json()) as SyncRequest;
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  body.context = normalizeContext(body.context);

  let flags: Set<string>;
  try {
    flags = await enabledFlags(auth.organizationId);
  } catch {
    return json({ error: "feature_flag_unavailable" }, 503);
  }
  if (!flags.has("sync_global_shell")) return json({ error: "sync_not_enabled" }, 403);
  if (safeMode(body.context) === "meeting" && !flags.has("sync_meeting_mode")) return json({ error: "sync_meeting_mode_disabled" }, 403);
  if (safeMode(body.context) === "field" && !flags.has("sync_field_mode")) return json({ error: "sync_field_mode_disabled" }, 403);

  if (body.toolExecution) return proxyGovernedTool(req, body, auth);

  const question = compactText(body.query ?? "", 30_000);
  if (!question) return json({ error: "query_required" }, 400);
  const attachmentIds = [...new Set(body.attachmentIds ?? [])]
    .filter((value) => typeof value === "string" && value.length <= 80)
    .slice(0, MAX_ATTACHMENTS_PER_TURN);

  const abortController = new AbortController();
  req.signal.addEventListener("abort", () => abortController.abort(), { once: true });
  const stream = createSyncEventStream({ onCancel: () => abortController.abort() });
  const turnId = crypto.randomUUID();
  const startedAt = Date.now();
  const telemetry: TurnTelemetry = {};
  const send = (event: StreamableEvent) => stream.send(event);

  void (async () => {
    let workspaceId: string | null = null;
    let finalReservationId: number | null = null;
    try {
      workspaceId = await resolveWorkspace(auth, body);
      if (!send({ type: "turn.started", turnId, conversationId: workspaceId })) return;
      await persistMessage({
        auth,
        workspaceId,
        turnId,
        role: "user",
        message: question,
        metadata: { route: body.context?.route, mode: safeMode(body.context), attachment_ids: attachmentIds },
      });

      const investigation = await runInvestigation({
        auth,
        workspaceId,
        question,
        context: body.context,
        attachmentIds,
        send,
        startedAt,
        telemetry,
      });

      const contextText = buildPrioritizedContext(investigation.sources);
      send({ type: "retrieval.started" });
      const retrievalStarted = Date.now();
      const kb = await retrieveReliabilityContext(adminClient(), `${question}\n${contextText.slice(0, 5_000)}`, {
        organizationId: auth.organizationId,
      });
      telemetry.retrievalMs = Date.now() - retrievalStarted;
      const knowledgeEvidence = kbEvidence(kb.citations);
      if (telemetry.firstEvidenceMs == null && knowledgeEvidence.length > 0) telemetry.firstEvidenceMs = Date.now() - startedAt;
      send({ type: "retrieval.completed", evidence: knowledgeEvidence });

      const responsePolicy = buildSyncResponsePolicy(question);
      const routed = flags.has("sync_agent_routing")
        ? selectReliabilitySpecialists(question)
        : [];
      const specialistOutputs: Array<{ specialist: ReliabilitySpecialist; text: string }> = [];
      const specialistStarted = Date.now();
      for (const specialist of routed) {
        if (abortController.signal.aborted || stream.closed) return;
        send({ type: "agent.started", agentId: specialist.id, label: specialist.label, executionMode: "executed" });
        const started = Date.now();
        try {
          const result = await runFocusedSpecialist({
            auth,
            specialist,
            question,
            contextText,
            kbPrompt: kb.promptContext,
          });
          specialistOutputs.push({ specialist, text: result.text });
          send({ type: "agent.completed", agentId: specialist.id, label: specialist.label, status: "completed", executionMode: "executed", durationMs: result.durationMs });
        } catch (error) {
          send({ type: "agent.completed", agentId: specialist.id, label: specialist.label, status: "failed", executionMode: "executed", durationMs: Date.now() - started });
          console.error("Sync specialist execution failed", { specialist: specialist.id, error });
        }
      }
      telemetry.specialistMs = routed.length > 0 ? Date.now() - specialistStarted : 0;

      const coordinatorLabel = "Reliability Engineer";
      send({ type: "agent.started", agentId: "reliability-engineer", label: coordinatorLabel, executionMode: "executed" });
      const basePrompt = buildReliabilityEngineerPrompt({
        accessMode: "authenticated",
        deliverable: responsePolicy.mode === "deliverable",
      });
      const systemPrompt = appendApprovedReliabilityContext(
        [
          basePrompt,
          responsePolicy.directive,
          modeDirective(body.context),
          "CITATION CONTRACT: Material factual claims based on supplied live context, attachments or approved knowledge must carry the exact bracket label shown beside the source, e.g. [L2], [A1], [R3]. Do not invent labels.",
        ].join("\n\n"),
        kb.promptContext,
      );
      const specialistContext = specialistOutputs.length
        ? `EXECUTED SPECIALIST RESULTS (advisory inputs; synthesize and resolve conflicts explicitly):\n${specialistOutputs
            .map(({ specialist, text }) => `### ${specialist.label}\n${text}`)
            .join("\n\n")}`
        : "";
      const userContent = [
        body.context?.route ? `APPLICATION ROUTE: ${body.context.route}` : "",
        body.context?.pageTitle ? `APPLICATION SURFACE: ${body.context.pageTitle}` : "",
        body.context?.entity ? `CURRENT ENTITY: ${body.context.entity.type} ${body.context.entity.displayName ?? body.context.entity.id} [id=${body.context.entity.id}]` : "",
        contextText ? `PRIORITIZED ROLE-SCOPED LIVE / ATTACHED EVIDENCE:\n${contextText}` : "",
        specialistContext,
        `QUESTION: ${question}`,
      ]
        .filter(Boolean)
        .join("\n\n");

      const model = responsePolicy.mode === "deliverable" ? MODEL_DELIVERABLE : MODEL_RELIABILITY;
      finalReservationId = await reserveQuota(
        auth.organizationId,
        model,
        responsePolicy.maxTokens + Math.ceil(userContent.length / 4) + 4_000,
      );
      const modelStarted = Date.now();
      let sequence = 0;
      const streamed = await callWithResilienceStream(fetch, providersFor(model), {
        systemPrompt,
        userContent,
        maxTokens: responsePolicy.maxTokens,
        timeoutMs: responsePolicy.mode === "deliverable" ? 180_000 : 90_000,
        signal: abortController.signal,
        onDelta: async (text) => {
          if (telemetry.firstTokenMs == null) telemetry.firstTokenMs = Date.now() - startedAt;
          sequence += 1;
          if (!send({ type: "assistant.delta", text, sequence })) abortController.abort();
        },
      });
      telemetry.modelMs = Date.now() - modelStarted;
      await recordProviderEvents(streamed.events as unknown as Array<Record<string, unknown>>);
      if (!streamed.ok) throw new Error("provider_unavailable");
      await settleQuota(auth.organizationId, streamed.model ?? model, streamed.usage, finalReservationId);
      finalReservationId = null;
      if (streamed.firstTokenAtMs != null && telemetry.firstTokenMs == null) telemetry.firstTokenMs = streamed.firstTokenAtMs;

      send({ type: "agent.completed", agentId: "reliability-engineer", label: coordinatorLabel, status: "completed", executionMode: "executed", durationMs: telemetry.modelMs });

      if (investigation.riskCheckPending) {
        const attention = investigation.checks.filter((check) => check.state === "attention").length;
        const riskCheck: InvestigationCheckRecord = {
          id: "risk-ranking",
          label: "Highest-risk condition evaluated",
          category: "risk",
          state: attention > 0 ? "attention" : "ok",
          detail: `Synthesis completed from ${investigation.checks.length} checks and ${investigation.sources.length + knowledgeEvidence.length} evidence sources`,
          durationMs: telemetry.modelMs,
        };
        investigation.checks.push(riskCheck);
        send({ type: "investigation.check.completed", check: riskCheck });
      }

      const allEvidence = [
        ...investigation.sources.map((source) => source.evidence),
        ...knowledgeEvidence,
      ];
      telemetry.totalMs = Date.now() - startedAt;
      telemetry.checkCount = investigation.checks.length;
      telemetry.sourceCount = allEvidence.length;
      send({ type: "investigation.completed", checks: investigation.checks, evidence: allEvidence });
      send({ type: "telemetry.updated", telemetry });
      send({ type: "assistant.block", block: { kind: "evidence", items: allEvidence } });

      if (flags.has("sync_tools")) {
        const proposal = await maybeProposeAction(auth, question, body.context);
        if (proposal) send({ type: "tool.proposed", proposal });
      }

      await persistMessage({
        auth,
        workspaceId,
        turnId,
        role: "agent",
        message: streamed.content,
        metadata: {
          response_mode: responsePolicy.mode,
          specialists: routed.map((specialist) => specialist.id),
          investigation_checks: investigation.checks,
          telemetry,
          model_used: streamed.model ?? model,
          prompt_version: RELIABILITY_PROMPT_VERSION,
          knowledge_base_used: kb.knowledgeBaseUsed,
          attachment_ids: attachmentIds,
          route: body.context?.route,
          mode: safeMode(body.context),
        },
        evidenceRefs: allEvidence,
      });
      await touchWorkspace(auth, workspaceId);
      send({ type: "turn.completed", turnId, telemetry, checks: investigation.checks });
    } catch (error) {
      await releaseQuota(finalReservationId);
      if (abortController.signal.aborted || stream.closed) return;
      const message = error instanceof Error ? error.message : "sync_turn_failed";
      console.error("Sync Investigation Runtime turn failed", { turnId, workspaceId, error });
      send({ type: "error", code: "sync_turn_failed", message, recoverable: false });
    } finally {
      if (workspaceId) await touchWorkspace(auth, workspaceId);
      stream.close();
    }
  })();

  return new Response(stream.readable, {
    status: 200,
    headers: sseHeaders(req.headers.get("Origin"), [ALLOWED_ORIGIN]),
  });
});
