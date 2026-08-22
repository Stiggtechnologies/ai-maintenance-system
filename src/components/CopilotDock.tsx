import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bot,
  Download,
  Loader2,
  Maximize2,
  Mic,
  MicOff,
  Minimize2,
  PanelLeft,
  Paperclip,
  RotateCcw,
  Send,
  ShieldCheck,
  Sparkles,
  Square,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { useDictation } from "../hooks/useDictation";
import { useFeatureFlag } from "../hooks/useFeatureFlag";
import { useSpeechOutput } from "../hooks/useSpeechOutput";
import { useSyncStream } from "../hooks/useSyncStream";
import { getCopilotEphemeralContext } from "../lib/copilot-context";
import { getRolePersona } from "../lib/rolePersonas";
import { supabase } from "../lib/supabase";
import { supabasePublicKey, supabaseUrl } from "../lib/supabase-config";
import { describeQuotaRefusal } from "../services/agentQuota";
import { getKpiDashboard } from "../services/kpiService";
import { removeSyncAttachmentGoverned } from "../services/syncAttachmentLifecycle";
import {
  archiveSyncConversation,
  createSyncConversation,
  deleteSyncConversation,
  listSyncAttachments,
  listSyncConversations,
  loadLatestSyncConversation,
  loadSyncConversation,
  renameSyncConversation,
  restoreSyncConversation,
  uploadSyncAttachment,
  type SyncAttachment,
  type SyncConversationMode,
  type SyncConversationSummary,
} from "../services/syncConversation";
import type {
  AssistantBlock,
  EvidenceReference,
  InvestigationCheckRecord,
  ProposedAction,
  SyncStreamEvent,
  SyncTurnTelemetry,
} from "../types/sync-stream";
import { useAuth } from "./AuthProvider";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { SyncActivityTimeline } from "./SyncActivityTimeline";
import { SyncConversationSidebar } from "./SyncConversationSidebar";
import { SyncResponseBody } from "./SyncResponseBody";
import { SyncStructuredBlock } from "./SyncStructuredBlock";

interface ChatMessage {
  id: string;
  role: "user" | "agent";
  text: string;
  status?: "streaming" | "complete" | "error";
  evidence?: EvidenceReference[];
  proposal?: ProposedAction;
  blocks?: AssistantBlock[];
  checks?: InvestigationCheckRecord[];
  telemetry?: SyncTurnTelemetry | null;
  attachmentIds?: string[];
  responseMode?: string | null;
}

interface CopilotDockProps {
  currentPath?: string;
}

type ViewMode = "dock" | "expanded" | "fullscreen";

const DELIVERABLE_RE =
  /\b(complete|produce|create|build|generate|develop|prepare|draft|perform|write)\b[\s\S]{0,140}\b(fmea|fmeca|rca|fracas|rcm|register|assessment|analysis|packet|report|plan|study|review|procedure|strategy)\b/i;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function mergeEvidence(
  current: EvidenceReference[] | undefined,
  incoming: EvidenceReference[],
): EvidenceReference[] {
  const byId = new Map((current ?? []).map((item) => [item.id, item]));
  for (const item of incoming) byId.set(item.id, item);
  return [...byId.values()];
}

function upsertCheck(
  current: InvestigationCheckRecord[] | undefined,
  check: InvestigationCheckRecord,
): InvestigationCheckRecord[] {
  const next = [...(current ?? [])];
  const index = next.findIndex((item) => item.id === check.id);
  if (index >= 0) next[index] = check;
  else next.push(check);
  return next;
}

function markdownTableToCsv(text: string): string | null {
  const lines = text.split("\n").filter((line) => line.trim().startsWith("|"));
  if (lines.length < 3) return null;
  const rows = lines
    .filter((line) => !/^\s*\|[\s:|-]+\|\s*$/.test(line))
    .map((line) =>
      line
        .replace(/^\s*\|/, "")
        .replace(/\|\s*$/, "")
        .split("|")
        .map((cell) => `"${cell.trim().replace(/"/g, '""')}"`)
        .join(","),
    );
  return rows.length >= 2 ? rows.join("\n") : null;
}

function downloadCsvText(csv: string, filename: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function buildLegacyContext(): Promise<string> {
  const adhoc = getCopilotEphemeralContext();
  if (adhoc) return adhoc;
  const parts: string[] = [];
  try {
    const dash = await getKpiDashboard();
    const withValues = dash.kpis.filter((kpi) => kpi.value != null);
    parts.push(
      `ROLE-VISIBLE KPI SNAPSHOT: ${withValues
        .slice(0, 14)
        .map((kpi) => `${kpi.name}=${kpi.value}${kpi.unit === "%" ? "%" : ""} [${kpi.status}]`)
        .join("; ")}`,
    );
  } catch {
    // Legacy enrichment is fail-soft; Sync v2 performs server-side checks.
  }
  return parts.join("\n").slice(0, 1800);
}

function deriveEntityContext(currentPath: string) {
  const segments = currentPath.split("/").filter(Boolean);
  const id = segments[1];
  if (!id || !UUID_RE.test(id)) return undefined;
  if (segments[0] === "assets") return { type: "asset", id };
  if (segments[0] === "work") return { type: "work_order", id };
  if (segments[0] === "decision-cases") return { type: "decision_case", id };
  return undefined;
}

function actionResultText(result: unknown): string {
  if (result && typeof result === "object") {
    const row = result as { id?: unknown; status?: unknown; work_order_id?: unknown };
    if (row.id) {
      return `Action completed${row.status ? ` — ${String(row.status)}` : ""}. Reference: ${String(row.id)}${row.work_order_id ? ` · Work order: ${String(row.work_order_id)}` : ""}`;
    }
  }
  return "Action completed through the governed application service.";
}

function shellClass(viewMode: ViewMode, showHistory: boolean): string {
  const common =
    "z-40 flex overflow-hidden border border-white/8 bg-[#0D1520] shadow-2xl shadow-black/50";
  if (viewMode === "fullscreen") return `fixed inset-3 ${common} rounded-2xl`;
  if (viewMode === "expanded") {
    return `fixed bottom-6 right-6 top-6 w-[min(1120px,calc(100vw-3rem))] ${common} rounded-2xl`;
  }
  return `fixed bottom-20 right-5 h-[720px] max-h-[calc(100vh-7rem)] ${showHistory ? "w-[980px]" : "w-[760px]"} max-w-[calc(100vw-2.5rem)] ${common} rounded-2xl`;
}

export function CopilotDock({
  currentPath = typeof window !== "undefined" ? window.location.pathname : "/",
}: CopilotDockProps) {
  const { profile } = useAuth();
  const persona = getRolePersona(profile?.role as string);
  const syncGlobal = useFeatureFlag("sync_global_shell");
  const voiceInput = useFeatureFlag("sync_voice_input");
  const voiceOutput = useFeatureFlag("sync_voice_output");
  const meetingModeFlag = useFeatureFlag("sync_meeting_mode");
  const fieldModeFlag = useFeatureFlag("sync_field_mode");
  const {
    events: streamEvents,
    status: streamStatus,
    error: streamError,
    start: startStream,
    cancel: cancelStream,
  } = useSyncStream();
  const speech = useSpeechOutput();

  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [legacySending, setLegacySending] = useState(false);
  const [longRun, setLongRun] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversationStatus, setConversationStatus] = useState("active");
  const [mode, setMode] = useState<SyncConversationMode>("conversation");
  const [startingSync, setStartingSync] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [conversations, setConversations] = useState<SyncConversationSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("dock");
  const [pendingAttachments, setPendingAttachments] = useState<SyncAttachment[]>([]);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeAgentMessageRef = useRef<string | null>(null);
  const processedEventCountRef = useRef(0);
  const lastQuestionRef = useRef("");

  const syncEnabled = syncGlobal.enabled;
  const sending = legacySending || startingSync || streamStatus === "streaming";

  const dictation = useDictation((text) => {
    setInput((current) => (current.trim() ? `${current.trim()} ${text}` : text));
  });

  const refreshConversations = useCallback(async () => {
    if (!syncEnabled) return;
    setHistoryLoading(true);
    try {
      setConversations(await listSyncConversations({ includeArchived: true, limit: 60 }));
    } finally {
      setHistoryLoading(false);
    }
  }, [syncEnabled]);

  const applySnapshot = useCallback(
    async (id: string) => {
      const snapshot = await loadSyncConversation(id);
      if (!snapshot) return;
      setConversationId(snapshot.id);
      setConversationStatus(snapshot.status);
      setMode(snapshot.mode);
      setMessages(
        snapshot.messages.map((message) => ({
          id: message.id,
          role: message.role,
          text: message.text,
          status: message.status === "error" ? "error" : "complete",
          evidence: message.evidence,
          blocks: message.blocks,
          checks: message.checks,
          telemetry: message.telemetry,
          attachmentIds: message.attachmentIds,
          responseMode: message.responseMode,
        })),
      );
      setPendingAttachments([]);
      const attachments = await listSyncAttachments(snapshot.id).catch(() => []);
      setAttachmentError(
        attachments.some((attachment) => attachment.extractionStatus === "failed")
          ? "One prior attachment could not be extracted."
          : null,
      );
    },
    [],
  );

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, sending, streamEvents.length]);

  useEffect(() => {
    if (!syncEnabled && streamStatus === "streaming") cancelStream();
  }, [cancelStream, streamStatus, syncEnabled]);

  useEffect(() => {
    if (!voiceOutput.enabled && speech.speaking) speech.stop();
  }, [speech, voiceOutput.enabled]);

  useEffect(() => {
    if (mode === "meeting" && !meetingModeFlag.enabled) setMode("conversation");
    if (mode === "field" && !fieldModeFlag.enabled) setMode("conversation");
  }, [fieldModeFlag.enabled, meetingModeFlag.enabled, mode]);

  useEffect(() => {
    if (!syncEnabled || !open || historyLoaded) return;
    let alive = true;
    setHistoryLoading(true);
    void Promise.all([
      listSyncConversations({ includeArchived: true, limit: 60 }),
      loadLatestSyncConversation(),
    ])
      .then(([items, latest]) => {
        if (!alive) return;
        setConversations(items);
        if (latest) {
          setConversationId(latest.id);
          setConversationStatus(latest.status);
          setMode(latest.mode);
          setMessages(
            latest.messages.map((message) => ({
              id: message.id,
              role: message.role,
              text: message.text,
              status: message.status === "error" ? "error" : "complete",
              evidence: message.evidence,
              blocks: message.blocks,
              checks: message.checks,
              telemetry: message.telemetry,
              attachmentIds: message.attachmentIds,
              responseMode: message.responseMode,
            })),
          );
        }
      })
      .catch(() => {
        // History failure cannot block a new conversation.
      })
      .finally(() => {
        if (alive) {
          setHistoryLoading(false);
          setHistoryLoaded(true);
        }
      });
    return () => {
      alive = false;
    };
  }, [historyLoaded, open, syncEnabled]);

  const updateActiveAgent = useCallback(
    (update: (message: ChatMessage) => ChatMessage) => {
      const activeId = activeAgentMessageRef.current;
      if (!activeId) return;
      setMessages((current) =>
        current.map((message) => (message.id === activeId ? update(message) : message)),
      );
    },
    [],
  );

  const handleStreamEvent = useCallback(
    (event: SyncStreamEvent) => {
      if (event.type === "turn.started") {
        if (event.conversationId) {
          setConversationId(event.conversationId);
          setConversationStatus("active");
        }
        return;
      }
      if (event.type === "assistant.delta") {
        updateActiveAgent((message) => ({ ...message, text: message.text + event.text, status: "streaming" }));
        return;
      }
      if (event.type === "investigation.check.completed") {
        updateActiveAgent((message) => ({ ...message, checks: upsertCheck(message.checks, event.check) }));
        return;
      }
      if (event.type === "investigation.completed") {
        updateActiveAgent((message) => ({
          ...message,
          checks: event.checks,
          evidence: mergeEvidence(message.evidence, event.evidence),
        }));
        return;
      }
      if (event.type === "telemetry.updated") {
        updateActiveAgent((message) => ({ ...message, telemetry: event.telemetry }));
        return;
      }
      if (event.type === "assistant.block") {
        const block = event.block;
        if (block.kind === "evidence") {
          updateActiveAgent((message) => ({ ...message, evidence: mergeEvidence(message.evidence, block.items) }));
        } else if (block.kind === "action_proposal") {
          updateActiveAgent((message) => ({ ...message, proposal: block.action }));
        } else if (block.kind !== "markdown") {
          updateActiveAgent((message) => ({ ...message, blocks: [...(message.blocks ?? []), block] }));
        }
        return;
      }
      if (event.type === "retrieval.completed") {
        updateActiveAgent((message) => ({ ...message, evidence: mergeEvidence(message.evidence, event.evidence) }));
        return;
      }
      if (event.type === "tool.proposed") {
        updateActiveAgent((message) => ({ ...message, proposal: event.proposal }));
        return;
      }
      if (event.type === "tool.started") {
        updateActiveAgent((message) => ({
          ...message,
          text: "Executing the action you confirmed through the governed application service…",
          status: "streaming",
        }));
        return;
      }
      if (event.type === "tool.completed") {
        updateActiveAgent((message) => ({
          ...message,
          text: actionResultText(event.result),
          status: "complete",
          proposal: undefined,
        }));
        return;
      }
      if (event.type === "error") {
        updateActiveAgent((message) => ({ ...message, text: message.text || event.message, status: "error" }));
        return;
      }
      if (event.type === "turn.completed") {
        updateActiveAgent((message) => ({
          ...message,
          status: "complete",
          checks: event.checks ?? message.checks,
          telemetry: event.telemetry ?? message.telemetry,
        }));
        void refreshConversations();
      }
    },
    [refreshConversations, updateActiveAgent],
  );

  useEffect(() => {
    if (streamEvents.length < processedEventCountRef.current) processedEventCountRef.current = 0;
    const unprocessed = streamEvents.slice(processedEventCountRef.current);
    for (const event of unprocessed) handleStreamEvent(event);
    processedEventCountRef.current = streamEvents.length;
  }, [handleStreamEvent, streamEvents]);

  useEffect(() => {
    if (!syncEnabled) return;
    if (streamStatus === "cancelled") {
      updateActiveAgent((message) => ({
        ...message,
        text: message.text || "Stopped before Sync returned content.",
        status: "complete",
      }));
    } else if (streamStatus === "error" && streamError) {
      updateActiveAgent((message) => ({
        ...message,
        text: message.text || streamError || "Sync stream failed.",
        status: "error",
      }));
    }
  }, [streamError, streamStatus, syncEnabled, updateActiveAgent]);

  const startSyncRequest = useCallback(
    async (body: Record<string, unknown>, agentMessageId: string) => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Your session has expired.");
      activeAgentMessageRef.current = agentMessageId;
      processedEventCountRef.current = 0;
      await startStream(`${supabaseUrl}/functions/v1/sync-investigation-runtime`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          apikey: supabasePublicKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    },
    [startStream],
  );

  const askLegacy = useCallback(
    async (question: string) => {
      setLegacySending(true);
      try {
        const deliverable = DELIVERABLE_RE.test(question);
        setLongRun(deliverable);
        const context = await buildLegacyContext();
        const { data, error } = await supabase.functions.invoke("ai-agent-processor", {
          body: {
            agentType: "ReliabilityAgent",
            depth: deliverable ? "deliverable" : "standard",
            query: `${persona.framing}\n\n${context ? `${context}\n\n` : ""}QUESTION: ${question}`,
          },
        });
        if (error) {
          const quota = await describeQuotaRefusal(error);
          if (quota) {
            setMessages((current) => [...current, { id: crypto.randomUUID(), role: "agent", text: quota.message, status: "error" }]);
            return;
          }
          throw new Error(error.message);
        }
        setMessages((current) => [
          ...current,
          {
            id: crypto.randomUUID(),
            role: "agent",
            text: (data as { response?: string })?.response ?? "The copilot returned no content.",
            status: "complete",
          },
        ]);
      } catch {
        setMessages((current) => [
          ...current,
          {
            id: crypto.randomUUID(),
            role: "agent",
            text: "The copilot is unavailable right now — your operating data and actions are unaffected. Please try again shortly.",
            status: "error",
          },
        ]);
      } finally {
        setLegacySending(false);
      }
    },
    [persona.framing],
  );

  const ask = useCallback(
    async (rawQuestion: string, appendUser = true) => {
      const question = rawQuestion.trim();
      if (!question || sending || conversationStatus !== "active") return;
      setInput("");
      setAttachmentError(null);
      lastQuestionRef.current = question;
      const attachmentIds = pendingAttachments.map((attachment) => attachment.id);
      if (appendUser) {
        setMessages((current) => [
          ...current,
          {
            id: crypto.randomUUID(),
            role: "user",
            text: question,
            status: "complete",
            attachmentIds,
          },
        ]);
      }
      if (!syncEnabled) {
        await askLegacy(question);
        return;
      }

      const agentMessageId = crypto.randomUUID();
      activeAgentMessageRef.current = agentMessageId;
      processedEventCountRef.current = 0;
      setStartingSync(true);
      setMessages((current) => [
        ...current,
        {
          id: agentMessageId,
          role: "agent",
          text: "",
          status: "streaming",
          blocks: [],
          checks: [],
          evidence: [],
        },
      ]);
      setPendingAttachments([]);
      try {
        await startSyncRequest(
          {
            query: question,
            conversationId,
            attachmentIds,
            context: {
              route: currentPath,
              pageTitle: document.title,
              mode,
              entity: deriveEntityContext(currentPath),
            },
          },
          agentMessageId,
        );
      } catch (error) {
        updateActiveAgent((message) => ({
          ...message,
          text: error instanceof Error ? error.message : "Sync could not start this turn.",
          status: "error",
        }));
      } finally {
        setStartingSync(false);
      }
    },
    [
      askLegacy,
      conversationId,
      conversationStatus,
      currentPath,
      mode,
      pendingAttachments,
      sending,
      startSyncRequest,
      syncEnabled,
      updateActiveAgent,
    ],
  );

  const executeProposal = useCallback(
    async (proposal: ProposedAction) => {
      if (!syncEnabled || sending || conversationStatus !== "active") return;
      const agentMessageId = crypto.randomUUID();
      activeAgentMessageRef.current = agentMessageId;
      processedEventCountRef.current = 0;
      setStartingSync(true);
      setMessages((current) => [
        ...current,
        { id: agentMessageId, role: "agent", text: "", status: "streaming", checks: [] },
      ]);
      try {
        await startSyncRequest(
          {
            conversationId,
            context: {
              route: currentPath,
              pageTitle: document.title,
              mode,
              entity: deriveEntityContext(currentPath),
            },
            toolExecution: {
              proposalId: proposal.proposalId,
              toolId: proposal.toolId,
              idempotencyKey: proposal.proposalId,
              params: proposal.params ?? {},
            },
          },
          agentMessageId,
        );
      } catch (error) {
        updateActiveAgent((message) => ({
          ...message,
          text: error instanceof Error ? error.message : "The confirmed action could not be submitted.",
          status: "error",
        }));
      } finally {
        setStartingSync(false);
      }
    },
    [conversationId, conversationStatus, currentPath, mode, sending, startSyncRequest, syncEnabled, updateActiveAgent],
  );

  const ensureConversationForUpload = useCallback(async (): Promise<string> => {
    if (conversationId && conversationStatus === "active") return conversationId;
    const id = await createSyncConversation("New Sync conversation", mode);
    setConversationId(id);
    setConversationStatus("active");
    setMessages([]);
    await refreshConversations();
    return id;
  }, [conversationId, conversationStatus, mode, refreshConversations]);

  const addFiles = useCallback(
    async (files: File[]) => {
      if (!syncEnabled || files.length === 0 || attachmentBusy) return;
      setAttachmentBusy(true);
      setAttachmentError(null);
      try {
        const workspaceId = await ensureConversationForUpload();
        const uploaded: SyncAttachment[] = [];
        for (const file of files.slice(0, 8)) {
          uploaded.push(await uploadSyncAttachment(workspaceId, file));
        }
        setPendingAttachments((current) => [...current, ...uploaded]);
      } catch (error) {
        setAttachmentError(error instanceof Error ? error.message : "Attachment upload failed.");
      } finally {
        setAttachmentBusy(false);
      }
    },
    [attachmentBusy, ensureConversationForUpload, syncEnabled],
  );

  const removePendingAttachment = useCallback(async (attachment: SyncAttachment) => {
    try {
      await removeSyncAttachmentGoverned(attachment);
      setPendingAttachments((current) => current.filter((item) => item.id !== attachment.id));
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : "Attachment could not be removed.");
    }
  }, []);

  const newConversation = useCallback(() => {
    if (sending) return;
    setConversationId(null);
    setConversationStatus("active");
    setMessages([]);
    setPendingAttachments([]);
    setInput("");
  }, [sending]);

  const selectConversation = useCallback(
    async (id: string) => {
      if (sending) return;
      try {
        await applySnapshot(id);
      } catch {
        setAttachmentError("The selected conversation could not be loaded.");
      }
    },
    [applySnapshot, sending],
  );

  const mutateConversation = useCallback(
    async (operation: () => Promise<void>, fallbackAfter = false) => {
      if (sending) return;
      try {
        await operation();
        await refreshConversations();
        if (fallbackAfter) newConversation();
      } catch (error) {
        setAttachmentError(error instanceof Error ? error.message : "Conversation update failed.");
      }
    },
    [newConversation, refreshConversations, sending],
  );

  const startDictation = () => {
    speech.stop();
    dictation.start();
  };

  const currentArchived = conversationId != null && conversationStatus !== "active";

  return (
    <>
      <button
        onClick={() => setOpen((value) => !value)}
        aria-label={open ? "Close Sync" : `Open ${syncEnabled ? "Sync" : persona.title}`}
        data-testid="copilot-launcher"
        className="fixed bottom-5 right-5 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-teal-500 text-slate-950 shadow-lg shadow-teal-500/20 hover:bg-teal-400 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-teal-300"
      >
        {open ? <X className="h-5 w-5" aria-hidden /> : <Bot className="h-6 w-6" aria-hidden />}
      </button>

      {open ? (
        <div role="dialog" aria-label={syncEnabled ? "Sync" : persona.title} data-testid="copilot-dock" className={shellClass(viewMode, showHistory)}>
          {syncEnabled && showHistory ? (
            <SyncConversationSidebar
              conversations={conversations}
              activeId={conversationId}
              loading={historyLoading}
              onNew={newConversation}
              onSelect={(id) => void selectConversation(id)}
              onRename={(id, title) => void mutateConversation(() => renameSyncConversation(id, title))}
              onArchive={(id) => void mutateConversation(() => archiveSyncConversation(id), id === conversationId)}
              onRestore={(id) => void mutateConversation(async () => { await restoreSyncConversation(id); await applySnapshot(id); })}
              onDelete={(id) => {
                if (!window.confirm("Delete this Sync conversation and its attached source files?")) return;
                void mutateConversation(() => deleteSyncConversation(id), id === conversationId);
              }}
            />
          ) : null}

          <div className="flex min-w-0 flex-1 flex-col">
            <div className="border-b border-white/6 px-4 py-3 sm:px-5">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 shrink-0 text-teal-300" aria-hidden />
                    <h2 className="truncate text-sm font-semibold text-white">{syncEnabled ? "Sync" : persona.title}</h2>
                    {syncEnabled ? <span className="rounded-full border border-teal-500/30 bg-teal-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-teal-300">governed</span> : null}
                    {currentArchived ? <span className="rounded-full border border-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-300">archived</span> : null}
                  </div>
                  <p className="mt-0.5 max-w-2xl truncate text-xs leading-5 text-slate-400">
                    {syncEnabled ? "Your governed interaction layer across operating data, evidence and controlled actions." : persona.intro}
                  </p>
                </div>

                {syncEnabled ? (
                  <div className="flex shrink-0 items-center gap-1">
                    <button type="button" onClick={() => setShowHistory((value) => !value)} aria-label="Toggle conversation history" className="rounded-lg p-2 text-slate-500 hover:bg-white/5 hover:text-slate-200"><PanelLeft className="h-4 w-4" aria-hidden /></button>
                    <button
                      type="button"
                      onClick={() => setViewMode((value) => (value === "dock" ? "expanded" : value === "expanded" ? "fullscreen" : "dock"))}
                      aria-label={viewMode === "fullscreen" ? "Return to dock" : "Expand Sync"}
                      className="rounded-lg p-2 text-slate-500 hover:bg-white/5 hover:text-slate-200"
                    >
                      {viewMode === "fullscreen" ? <Minimize2 className="h-4 w-4" aria-hidden /> : <Maximize2 className="h-4 w-4" aria-hidden />}
                    </button>
                  </div>
                ) : null}
              </div>

              {syncEnabled && (meetingModeFlag.enabled || fieldModeFlag.enabled) ? (
                <div className="mt-2 flex gap-1" aria-label="Sync interaction mode">
                  {(["conversation", "meeting", "field"] as const)
                    .filter((candidate) => candidate === "conversation" || (candidate === "meeting" && meetingModeFlag.enabled) || (candidate === "field" && fieldModeFlag.enabled))
                    .map((candidate) => (
                      <button key={candidate} type="button" onClick={() => setMode(candidate)} className={`rounded-md px-2 py-1 text-[10px] capitalize ${mode === candidate ? "bg-teal-500/15 text-teal-200" : "text-slate-500 hover:text-slate-300"}`}>{candidate}</button>
                    ))}
                </div>
              ) : null}
            </div>

            <div ref={scrollRef} className="flex-1 space-y-5 overflow-y-auto px-4 py-5 sm:px-6">
              {messages.length === 0 ? (
                <div className="mx-auto max-w-2xl space-y-2" data-testid="copilot-suggestions">
                  <p className="text-xs text-slate-400">Try asking:</p>
                  {persona.suggestions.map((suggestion) => (
                    <button key={suggestion} onClick={() => void ask(suggestion)} className="block w-full rounded-xl border border-white/6 bg-white/2 px-3.5 py-2.5 text-left text-[13px] leading-5 text-slate-300 hover:border-teal-500/40 hover:text-white focus:outline-hidden focus-visible:ring-2 focus-visible:ring-teal-300">{suggestion}</button>
                  ))}
                </div>
              ) : null}

              {messages.map((message) =>
                message.role === "user" ? (
                  <div key={message.id} className="flex justify-end">
                    <div className="max-w-[78%] rounded-2xl rounded-br-md bg-teal-500/15 px-4 py-2.5 text-[14px] leading-6 text-teal-50">
                      {message.text}
                      {message.attachmentIds?.length ? <div className="mt-1 text-[10px] text-teal-200/60">{message.attachmentIds.length} source file{message.attachmentIds.length === 1 ? "" : "s"}</div> : null}
                    </div>
                  </div>
                ) : (
                  <div key={message.id} className="flex justify-start">
                    <article className="w-full min-w-0 py-1 text-slate-200">
                      <div className="mb-2 flex items-center gap-2 text-[11px] font-medium text-slate-500">
                        <Sparkles className="h-3.5 w-3.5 text-teal-300" aria-hidden />
                        <span>{syncEnabled ? "Sync" : persona.title}</span>
                        {message.status === "error" ? <span className="text-amber-300">needs attention</span> : null}
                      </div>

                      {syncEnabled && message.id === activeAgentMessageRef.current && (startingSync || streamStatus === "streaming") ? (
                        <SyncActivityTimeline events={streamEvents} status="streaming" />
                      ) : null}

                      {message.text ? (
                        syncEnabled ? (
                          <SyncResponseBody
                            text={message.text}
                            streaming={message.status === "streaming"}
                            evidence={message.evidence}
                            checks={message.checks}
                            telemetry={message.telemetry}
                            responseMode={message.responseMode}
                          />
                        ) : (
                          <MarkdownRenderer content={message.text} />
                        )
                      ) : !syncEnabled ? (
                        <div className="flex items-center gap-2 text-xs text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />Reading the relevant operating context…</div>
                      ) : null}

                      {message.blocks?.map((block, index) => <SyncStructuredBlock key={`${message.id}:block:${index}`} block={block} />)}

                      {message.evidence?.length ? (
                        <details className="mt-4 border-t border-white/6 pt-3 text-[12px] text-slate-500">
                          <summary className="cursor-pointer select-none font-medium text-slate-400 hover:text-slate-200">Evidence · {message.evidence.length}</summary>
                          <div className="mt-2 space-y-1.5">
                            {message.evidence.map((evidence) => (
                              <div key={evidence.id} className="rounded-lg bg-white/2 px-3 py-2 leading-5 text-slate-400">
                                <div className="flex items-start gap-2"><span className="shrink-0 font-semibold text-cyan-300">{evidence.id}</span><span>{evidence.title ?? evidence.sourceType}</span></div>
                                {evidence.excerpt ? <div className="mt-1 text-[11px] text-slate-500">{evidence.excerpt}</div> : null}
                              </div>
                            ))}
                          </div>
                        </details>
                      ) : null}

                      {message.proposal ? (
                        <div className="mt-4 rounded-xl border border-amber-500/25 bg-amber-500/5 p-3.5">
                          <div className="flex items-center gap-1.5 text-[12px] font-medium text-amber-200"><ShieldCheck className="h-3.5 w-3.5" aria-hidden />Proposed action</div>
                          <div className="mt-2 text-[14px] leading-5 text-slate-100">{message.proposal.title}</div>
                          {message.proposal.reason ? <div className="mt-2 text-[12px] leading-5 text-slate-400">{message.proposal.reason}</div> : null}
                          <button type="button" onClick={() => void executeProposal(message.proposal!)} disabled={sending} className="mt-3 rounded-md bg-amber-400 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-300 disabled:opacity-40">Confirm action</button>
                        </div>
                      ) : null}

                      {message.text ? (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {markdownTableToCsv(message.text) ? (
                            <button onClick={() => downloadCsvText(markdownTableToCsv(message.text)!, "syncai-deliverable.csv")} className="inline-flex items-center gap-1.5 rounded-lg border border-teal-500/20 bg-teal-500/6 px-2 py-1 text-[11px] font-medium text-teal-300 hover:bg-teal-500/12"><Download className="h-3 w-3" aria-hidden />CSV</button>
                          ) : null}
                          {syncEnabled && voiceOutput.enabled && speech.supported ? (
                            <button type="button" onClick={() => (speech.speaking ? speech.stop() : speech.speak(message.text))} className="inline-flex items-center gap-1 rounded-lg border border-white/8 px-2 py-1 text-[11px] text-slate-500 hover:text-slate-200" aria-label={speech.speaking ? "Stop speaking" : "Read response aloud"}>
                              {speech.speaking ? <VolumeX className="h-3 w-3" aria-hidden /> : <Volume2 className="h-3 w-3" aria-hidden />}{speech.speaking ? "Stop" : "Listen"}
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </article>
                  </div>
                ),
              )}

              {legacySending ? (
                <div className="flex items-center gap-2 text-xs text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />{longRun ? "Producing the complete deliverable…" : "Reading your live operating data…"}</div>
              ) : null}
            </div>

            <form
              onSubmit={(event) => {
                event.preventDefault();
                void ask(input);
              }}
              onDragOver={(event) => {
                if (syncEnabled) event.preventDefault();
              }}
              onDrop={(event) => {
                if (!syncEnabled) return;
                event.preventDefault();
                void addFiles([...event.dataTransfer.files]);
              }}
              className="border-t border-white/6 p-3 sm:px-5"
            >
              {currentArchived ? <div className="mb-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-200">This conversation is archived. Restore it from History to continue.</div> : null}
              {attachmentError ? <div className="mb-2 text-[11px] text-amber-300">{attachmentError}</div> : null}
              {dictation.error ? <div className="mb-2 text-[11px] text-amber-300">{dictation.error}</div> : null}

              {pendingAttachments.length > 0 ? (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {pendingAttachments.map((attachment) => (
                    <span key={attachment.id} className="inline-flex max-w-56 items-center gap-1.5 rounded-lg border border-white/8 bg-white/3 px-2 py-1 text-[10px] text-slate-400">
                      <Paperclip className="h-3 w-3 shrink-0" aria-hidden /><span className="truncate">{attachment.fileName}</span>
                      <button type="button" onClick={() => void removePendingAttachment(attachment)} aria-label={`Remove ${attachment.fileName}`} className="text-slate-600 hover:text-slate-300"><X className="h-3 w-3" aria-hidden /></button>
                    </span>
                  ))}
                </div>
              ) : null}

              <div className="flex items-end gap-2">
                <div className="relative min-w-0 flex-1">
                  <textarea
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                        event.preventDefault();
                        void ask(input);
                      }
                    }}
                    rows={1}
                    disabled={sending || currentArchived}
                    placeholder={syncEnabled ? "Talk to Sync…  Shift+Enter for a new line" : "Ask about your operation…"}
                    aria-label={`Ask ${syncEnabled ? "Sync" : persona.title}`}
                    className="max-h-40 min-h-11 w-full resize-none rounded-xl border border-slate-600 bg-slate-900 px-3.5 py-2.5 pr-10 text-sm leading-5 text-white placeholder-slate-500 focus:border-teal-400 focus:outline-hidden focus:ring-1 focus:ring-teal-400 disabled:opacity-60"
                  />
                  {syncEnabled ? (
                    <>
                      <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        className="hidden"
                        accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.md,.markdown,.csv,.json,.xml,.yaml,.yml,.log,.xlsx"
                        onChange={(event) => {
                          void addFiles([...(event.target.files ?? [])]);
                          event.currentTarget.value = "";
                        }}
                      />
                      <button type="button" disabled={sending || currentArchived || attachmentBusy} onClick={() => fileInputRef.current?.click()} aria-label="Attach source files" className="absolute bottom-2 right-2 rounded-md p-1.5 text-slate-500 hover:bg-white/5 hover:text-slate-200 disabled:opacity-40">
                        {attachmentBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Paperclip className="h-4 w-4" aria-hidden />}
                      </button>
                    </>
                  ) : null}
                </div>

                {syncEnabled && voiceInput.enabled && dictation.supported ? (
                  <button type="button" onClick={dictation.listening ? dictation.stop : startDictation} aria-label={dictation.listening ? "Stop dictation" : "Start dictation"} className={`flex h-11 w-11 items-center justify-center rounded-xl border ${dictation.listening ? "border-red-400/50 bg-red-500/10 text-red-300" : "border-white/10 text-slate-300 hover:text-white"}`}>
                    {dictation.listening ? <MicOff className="h-4 w-4" aria-hidden /> : <Mic className="h-4 w-4" aria-hidden />}
                  </button>
                ) : null}

                {syncEnabled && streamStatus === "streaming" ? (
                  <button type="button" onClick={cancelStream} aria-label="Stop response" className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-200 text-slate-950 hover:bg-white"><Square className="h-3.5 w-3.5 fill-current" aria-hidden /></button>
                ) : (
                  <button type="submit" disabled={sending || currentArchived || !input.trim()} aria-label="Send" className="flex h-11 w-11 items-center justify-center rounded-xl bg-teal-500 text-slate-950 hover:bg-teal-400 disabled:opacity-40 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-teal-300"><Send className="h-4 w-4" aria-hidden /></button>
                )}
              </div>

              <div className="mt-1.5 flex items-center justify-between gap-2">
                <p className="text-[10px] leading-4 text-slate-500">
                  {syncEnabled ? "Role-scoped evidence · source-linked claims · human-confirmed actions · tenant audit trail" : "Grounded in data your role can see · advisory only — actions stay human-approved"}
                </p>
                {syncEnabled && lastQuestionRef.current && streamStatus !== "streaming" && !currentArchived ? (
                  <button type="button" onClick={() => void ask(lastQuestionRef.current, false)} className="inline-flex shrink-0 items-center gap-1 text-[10px] text-slate-500 hover:text-slate-300"><RotateCcw className="h-3 w-3" aria-hidden />Regenerate</button>
                ) : null}
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
