/**
 * CopilotDock / Sync shell — one global interaction layer, two rollout modes.
 *
 * sync_global_shell OFF preserves the established role-aware Reliability
 * Engineer path. When the tenant gate is ON, the same dock becomes the Sync
 * surface: resumable context, typed streaming state, evidence, voice, routed
 * specialists and human-confirmed governed actions.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bot,
  Calculator,
  Download,
  FileQuestion,
  Lightbulb,
  Link2,
  ListChecks,
  Loader2,
  Mic,
  MicOff,
  RotateCcw,
  Send,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Square,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { supabasePublicKey, supabaseUrl } from "../lib/supabase-config";
import { describeQuotaRefusal } from "../services/agentQuota";
import { loadLatestSyncConversation } from "../services/syncConversation";
import { useAuth } from "./AuthProvider";
import { getRolePersona } from "../lib/rolePersonas";
import { getKpiDashboard } from "../services/kpiService";
import { getCopilotEphemeralContext } from "../lib/copilot-context";
import { useFeatureFlag } from "../hooks/useFeatureFlag";
import { useSyncStream } from "../hooks/useSyncStream";
import { useDictation } from "../hooks/useDictation";
import { useSpeechOutput } from "../hooks/useSpeechOutput";
import type {
  AssistantBlock,
  EvidenceReference,
  ProposedAction,
  SyncStreamEvent,
} from "../types/sync-stream";
import { MarkdownRenderer } from "./MarkdownRenderer";

interface ChatMessage {
  id: string;
  role: "user" | "agent";
  text: string;
  status?: "streaming" | "complete" | "error";
  evidence?: EvidenceReference[];
  proposal?: ProposedAction;
  blocks?: AssistantBlock[];
}

interface CopilotDockProps {
  currentPath?: string;
}

const DELIVERABLE_RE =
  /\b(complete|produce|create|build|generate|develop|prepare|draft|perform)\b[\s\S]{0,120}\b(fmea|rca|fracas|rcm|register|assessment|analysis|packet|report|plan|study|review)\b/i;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

async function buildLiveContext(): Promise<string> {
  const adhoc = getCopilotEphemeralContext();
  if (adhoc) return adhoc;

  const parts: string[] = [];
  try {
    const dash = await getKpiDashboard();
    const withValues = dash.kpis.filter((kpi) => kpi.value != null);
    const breaches = withValues.filter((kpi) => kpi.status === "breach");
    parts.push(
      "LIVE KPIs (visible to this role): " +
        withValues
          .slice(0, 14)
          .map(
            (kpi) =>
              `${kpi.name}=${kpi.value}${kpi.unit === "%" ? "%" : ""} [${kpi.status}]`,
          )
          .join("; "),
    );
    if (breaches.length > 0) {
      parts.push(
        "BREACHED: " +
          breaches
            .map(
              (kpi) =>
                `${kpi.name} (A: ${kpi.accountable}, R: ${kpi.responsible})`,
            )
            .join("; "),
      );
    }
  } catch {
    // Live context enriches a turn; it must not become an availability gate.
  }

  try {
    const { data } = await supabase
      .from("recommendations")
      .select("title, urgency, status")
      .in("status", ["pending", "escalated"])
      .order("created_at", { ascending: false })
      .limit(6);
    if (data?.length) {
      parts.push(
        "OPEN RECOMMENDATIONS: " +
          data.map((row) => `${row.title} [${row.urgency}]`).join("; "),
      );
    }
  } catch {
    // Same fail-soft rule as KPI enrichment.
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
    const row = result as {
      id?: unknown;
      status?: unknown;
      work_order_id?: unknown;
    };
    if (row.id) {
      return `Action completed${row.status ? ` — ${String(row.status)}` : ""}. Reference: ${String(row.id)}${row.work_order_id ? ` · Work order: ${String(row.work_order_id)}` : ""}`;
    }
  }
  return "Action completed through the governed application service.";
}

function StructuredBlock({ block }: { block: AssistantBlock }) {
  if (block.kind === "markdown" || block.kind === "evidence") return null;

  if (block.kind === "warning") {
    const critical = ["critical", "high", "warning"].includes(
      block.severity.toLowerCase(),
    );
    return (
      <div
        className={`mt-2 rounded-lg border px-2.5 py-2 text-[11px] leading-4 ${
          critical
            ? "border-amber-500/25 bg-amber-500/5 text-amber-100"
            : "border-sky-500/20 bg-sky-500/5 text-sky-100"
        }`}
      >
        <div className="mb-1 flex items-center gap-1.5 font-semibold uppercase tracking-wide">
          <ShieldAlert className="h-3 w-3" aria-hidden />
          {block.severity}
        </div>
        {block.content}
      </div>
    );
  }

  if (
    block.kind === "facts" ||
    block.kind === "hypotheses" ||
    block.kind === "missing_evidence"
  ) {
    const title =
      block.kind === "facts"
        ? "Facts"
        : block.kind === "hypotheses"
          ? "Hypotheses"
          : "Missing evidence";
    const Icon = block.kind === "missing_evidence" ? FileQuestion : ListChecks;
    return (
      <div className="mt-2 rounded-lg border border-white/6 bg-black/10 p-2.5">
        <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
          <Icon className="h-3 w-3" aria-hidden />
          {title}
        </div>
        <ul className="space-y-1 text-xs text-slate-300">
          {block.items.map((item, index) => (
            <li key={`${title}-${index}`} className="flex gap-1.5">
              <span aria-hidden>•</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (block.kind === "calculation") {
    const calculation = block.calculation;
    return (
      <div className="mt-2 rounded-lg border border-white/6 bg-black/10 p-2.5">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
          <Calculator className="h-3 w-3" aria-hidden />
          Calculation
        </div>
        <div className="mt-1 text-xs font-medium text-slate-200">
          {calculation.title}
        </div>
        {calculation.result !== undefined && (
          <div className="mt-1 text-xs text-teal-200">
            {String(calculation.result)}{calculation.units ? ` ${calculation.units}` : ""}
          </div>
        )}
        {calculation.method && (
          <div className="mt-1 text-[11px] text-slate-500">
            {calculation.method}
          </div>
        )}
      </div>
    );
  }

  if (block.kind === "recommendation") {
    return (
      <div className="mt-2 rounded-lg border border-teal-500/20 bg-teal-500/5 p-2.5">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-teal-300">
          <Lightbulb className="h-3 w-3" aria-hidden />
          Recommendation
        </div>
        <div className="mt-1 text-xs text-slate-200">
          {block.recommendation.summary}
        </div>
        {block.recommendation.rationale && (
          <div className="mt-1 text-[11px] text-slate-400">
            {block.recommendation.rationale}
          </div>
        )}
      </div>
    );
  }

  if (block.kind === "entity_links") {
    return (
      <div className="mt-2 rounded-lg border border-white/6 bg-black/10 p-2.5">
        <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
          <Link2 className="h-3 w-3" aria-hidden />
          Related records
        </div>
        <div className="space-y-1 text-xs text-slate-300">
          {block.entities.map((entity) => (
            <div key={`${entity.type}:${entity.id}`}>
              {entity.displayName ?? entity.id}
              <span className="ml-1 text-[10px] text-slate-500">
                {entity.type}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (block.kind === "action_proposal") {
    return (
      <div className="mt-2 rounded-lg border border-amber-500/25 bg-amber-500/5 p-2.5 text-xs text-amber-100">
        Proposed action: {block.action.title}
      </div>
    );
  }

  return null;
}

export function CopilotDock({
  currentPath =
    typeof window !== "undefined" ? window.location.pathname : "/",
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
  const [mode, setMode] = useState<"conversation" | "meeting" | "field">(
    "conversation",
  );
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [startingSync, setStartingSync] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeAgentMessageRef = useRef<string | null>(null);
  const processedEventCountRef = useRef(0);
  const lastQuestionRef = useRef<string>("");

  const dictation = useDictation((text) => {
    setInput((current) => (current.trim() ? `${current.trim()} ${text}` : text));
  });

  const syncEnabled = syncGlobal.enabled;
  const sending =
    legacySending || startingSync || streamStatus === "streaming";

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, sending]);

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
    void loadLatestSyncConversation()
      .then((snapshot) => {
        if (!alive || !snapshot) return;
        setConversationId(snapshot.id);
        setMode(snapshot.mode);
        setMessages(
          snapshot.messages.map((message) => ({
            id: message.id,
            role: message.role,
            text: message.text,
            status: message.status === "error" ? "error" : "complete",
            evidence: message.evidence,
            blocks: message.blocks,
          })),
        );
      })
      .catch(() => {
        // A history read failure must not disable a new conversation.
      })
      .finally(() => alive && setHistoryLoaded(true));
    return () => {
      alive = false;
    };
  }, [historyLoaded, open, syncEnabled]);

  const updateActiveAgent = useCallback(
    (update: (message: ChatMessage) => ChatMessage) => {
      const activeId = activeAgentMessageRef.current;
      if (!activeId) return;
      setMessages((current) =>
        current.map((message) =>
          message.id === activeId ? update(message) : message,
        ),
      );
    },
    [],
  );

  const handleStreamEvent = useCallback(
    (event: SyncStreamEvent) => {
      if (event.type === "turn.started") {
        if (event.conversationId) setConversationId(event.conversationId);
        return;
      }
      if (event.type === "assistant.delta") {
        updateActiveAgent((message) => ({
          ...message,
          text: message.text + event.text,
          status: "streaming",
        }));
        return;
      }
      if (event.type === "assistant.block") {
        const block = event.block;
        if (block.kind === "evidence") {
          updateActiveAgent((message) => ({
            ...message,
            evidence: block.items,
          }));
        } else if (block.kind === "action_proposal") {
          updateActiveAgent((message) => ({
            ...message,
            proposal: block.action,
          }));
        } else if (block.kind !== "markdown") {
          updateActiveAgent((message) => ({
            ...message,
            blocks: [...(message.blocks ?? []), block],
          }));
        }
        return;
      }
      if (event.type === "retrieval.completed") {
        updateActiveAgent((message) => ({
          ...message,
          evidence: event.evidence,
        }));
        return;
      }
      if (event.type === "tool.proposed") {
        updateActiveAgent((message) => ({
          ...message,
          proposal: event.proposal,
        }));
        return;
      }
      if (event.type === "tool.started") {
        updateActiveAgent((message) => ({
          ...message,
          text:
            "Executing the action you confirmed through the governed application service…",
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
        updateActiveAgent((message) => ({
          ...message,
          text: event.message,
          status: "error",
        }));
        return;
      }
      if (event.type === "turn.completed") {
        updateActiveAgent((message) => ({ ...message, status: "complete" }));
      }
    },
    [updateActiveAgent],
  );

  useEffect(() => {
    if (streamEvents.length < processedEventCountRef.current) {
      processedEventCountRef.current = 0;
    }
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
      setStartingSync(true);
      try {
        await startStream(`${supabaseUrl}/functions/v1/sync-runtime`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            apikey: supabasePublicKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });
      } finally {
        setStartingSync(false);
      }
    },
    [startStream],
  );

  const askLegacy = useCallback(
    async (question: string) => {
      setLegacySending(true);
      try {
        const deliverable = DELIVERABLE_RE.test(question);
        setLongRun(deliverable);
        const context = await buildLiveContext();
        const { data, error } = await supabase.functions.invoke(
          "ai-agent-processor",
          {
            body: {
              agentType: "ReliabilityAgent",
              depth: deliverable ? "deliverable" : "standard",
              query:
                `${persona.framing}\n\n` +
                (context ? `${context}\n\n` : "") +
                `QUESTION: ${question}\n\n` +
                (deliverable
                  ? "This is a work-product request: produce the COMPLETE deliverable now."
                  : "Answer for this audience. Where the live context above is relevant, use its real numbers."),
            },
          },
        );
        if (error) {
          const quota = await describeQuotaRefusal(error);
          if (quota) {
            setMessages((current) => [
              ...current,
              {
                id: crypto.randomUUID(),
                role: "agent",
                text: quota.message,
                status: "error",
              },
            ]);
            return;
          }
          throw new Error(error.message);
        }
        const text =
          (data as { response?: string })?.response ??
          "The copilot returned no content.";
        setMessages((current) => [
          ...current,
          {
            id: crypto.randomUUID(),
            role: "agent",
            text,
            status: "complete",
          },
        ]);
      } catch {
        setMessages((current) => [
          ...current,
          {
            id: crypto.randomUUID(),
            role: "agent",
            text:
              "The copilot is unavailable right now — your operating data and actions are unaffected. Please try again shortly.",
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
      if (!question || sending) return;
      setInput("");
      lastQuestionRef.current = question;
      if (appendUser) {
        setMessages((current) => [
          ...current,
          {
            id: crypto.randomUUID(),
            role: "user",
            text: question,
            status: "complete",
          },
        ]);
      }

      if (!syncEnabled) {
        await askLegacy(question);
        return;
      }

      const agentMessageId = crypto.randomUUID();
      setMessages((current) => [
        ...current,
        {
          id: agentMessageId,
          role: "agent",
          text: "",
          status: "streaming",
          blocks: [],
        },
      ]);
      const liveContext = await buildLiveContext();
      try {
        await startSyncRequest(
          {
            query: question,
            conversationId,
            depth: DELIVERABLE_RE.test(question) ? "deliverable" : "standard",
            context: {
              route: currentPath,
              pageTitle: document.title,
              mode,
              entity: deriveEntityContext(currentPath),
              liveContext: `${persona.framing}\n${liveContext}`.slice(0, 2600),
            },
          },
          agentMessageId,
        );
      } catch (error) {
        updateActiveAgent((message) => ({
          ...message,
          text:
            error instanceof Error
              ? error.message
              : "Sync could not start this turn.",
          status: "error",
        }));
      }
    },
    [
      askLegacy,
      conversationId,
      currentPath,
      mode,
      persona.framing,
      sending,
      startSyncRequest,
      syncEnabled,
      updateActiveAgent,
    ],
  );

  const executeProposal = useCallback(
    async (proposal: ProposedAction) => {
      if (!syncEnabled || sending) return;
      const agentMessageId = crypto.randomUUID();
      setMessages((current) => [
        ...current,
        {
          id: agentMessageId,
          role: "agent",
          text: "Confirming the governed action…",
          status: "streaming",
        },
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
          text:
            error instanceof Error
              ? error.message
              : "The confirmed action could not be submitted.",
          status: "error",
        }));
      }
    },
    [
      conversationId,
      currentPath,
      mode,
      sending,
      startSyncRequest,
      syncEnabled,
      updateActiveAgent,
    ],
  );

  const startDictation = () => {
    speech.stop();
    dictation.start();
  };

  return (
    <>
      <button
        onClick={() => setOpen((value) => !value)}
        aria-label={
          open ? "Close Sync" : `Open ${syncEnabled ? "Sync" : persona.title}`
        }
        data-testid="copilot-launcher"
        className="fixed bottom-5 right-5 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-teal-500 text-slate-950 shadow-lg shadow-teal-500/20 hover:bg-teal-400 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-teal-300"
      >
        {open ? (
          <X className="h-5 w-5" aria-hidden />
        ) : (
          <Bot className="h-6 w-6" aria-hidden />
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={syncEnabled ? "Sync" : persona.title}
          data-testid="copilot-dock"
          className="fixed bottom-20 right-5 z-40 flex h-[620px] max-h-[calc(100vh-7rem)] w-[420px] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-2xl border border-white/8 bg-[#0D1520] shadow-2xl shadow-black/50"
        >
          <div className="border-b border-white/6 px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-teal-300" aria-hidden />
                <h2 className="text-sm font-semibold text-white">
                  {syncEnabled ? "Sync" : persona.title}
                </h2>
                {syncEnabled && (
                  <span className="rounded-full border border-teal-500/30 bg-teal-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-teal-300">
                    governed
                  </span>
                )}
              </div>
              {syncEnabled && conversationId && (
                <span className="text-[10px] text-slate-500">resumable</span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-slate-400">
              {syncEnabled
                ? "The interaction layer across your operating system — grounded in what your role can see."
                : persona.intro}
            </p>
            {syncEnabled &&
              (meetingModeFlag.enabled || fieldModeFlag.enabled) && (
                <div
                  className="mt-2 flex gap-1"
                  aria-label="Sync interaction mode"
                >
                  {(["conversation", "meeting", "field"] as const)
                    .filter(
                      (candidate) =>
                        candidate === "conversation" ||
                        (candidate === "meeting" && meetingModeFlag.enabled) ||
                        (candidate === "field" && fieldModeFlag.enabled),
                    )
                    .map((candidate) => (
                      <button
                        key={candidate}
                        type="button"
                        onClick={() => setMode(candidate)}
                        className={`rounded-md px-2 py-1 text-[10px] capitalize ${
                          mode === candidate
                            ? "bg-teal-500/15 text-teal-200"
                            : "text-slate-500 hover:text-slate-300"
                        }`}
                      >
                        {candidate}
                      </button>
                    ))}
                </div>
              )}
          </div>

          <div
            ref={scrollRef}
            className="flex-1 space-y-3 overflow-y-auto p-4"
          >
            {messages.length === 0 && (
              <div className="space-y-2" data-testid="copilot-suggestions">
                <p className="text-xs text-slate-400">Try asking:</p>
                {persona.suggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => void ask(suggestion)}
                    className="block w-full rounded-lg border border-white/6 bg-white/2 px-3 py-2 text-left text-xs text-slate-300 hover:border-teal-500/40 hover:text-white focus:outline-hidden focus-visible:ring-2 focus-visible:ring-teal-300"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}

            {messages.map((message) =>
              message.role === "user" ? (
                <div key={message.id} className="flex justify-end">
                  <div className="max-w-[85%] rounded-xl rounded-br-sm bg-teal-500/15 px-3 py-2 text-sm text-teal-100">
                    {message.text}
                  </div>
                </div>
              ) : (
                <div key={message.id} className="flex justify-start">
                  <div className="max-w-[94%] rounded-xl rounded-bl-sm border border-white/6 bg-white/3 px-3 py-2 text-sm text-slate-200">
                    {message.text ? (
                      <MarkdownRenderer content={message.text} />
                    ) : (
                      <div className="flex items-center gap-2 text-xs text-slate-400">
                        <Loader2
                          className="h-3.5 w-3.5 animate-spin"
                          aria-hidden
                        />
                        Reading the relevant operating context…
                      </div>
                    )}

                    {message.blocks?.map((block, index) => (
                      <StructuredBlock
                        key={`${message.id}:block:${index}`}
                        block={block}
                      />
                    ))}

                    {message.evidence && message.evidence.length > 0 && (
                      <div className="mt-2 border-t border-white/6 pt-2">
                        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                          Evidence
                        </div>
                        <div className="space-y-1">
                          {message.evidence.map((evidence) => (
                            <div
                              key={evidence.id}
                              className="rounded-md bg-black/15 px-2 py-1 text-[11px] text-slate-400"
                            >
                              {evidence.title ?? evidence.sourceId}
                              {evidence.locator?.section
                                ? ` · ${evidence.locator.section}`
                                : ""}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {message.proposal && (
                      <div className="mt-2 rounded-lg border border-amber-500/25 bg-amber-500/5 p-2.5">
                        <div className="flex items-center gap-1.5 text-xs font-medium text-amber-200">
                          <ShieldCheck
                            className="h-3.5 w-3.5"
                            aria-hidden
                          />
                          Proposed action
                        </div>
                        <div className="mt-1 text-xs text-slate-200">
                          {message.proposal.title}
                        </div>
                        {message.proposal.reason && (
                          <div className="mt-1 text-[11px] text-slate-400">
                            {message.proposal.reason}
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => void executeProposal(message.proposal!)}
                          disabled={sending}
                          className="mt-2 rounded-md bg-amber-400 px-2.5 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-300 disabled:opacity-40"
                        >
                          Confirm action
                        </button>
                      </div>
                    )}

                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {markdownTableToCsv(message.text) && (
                        <button
                          onClick={() =>
                            downloadCsvText(
                              markdownTableToCsv(message.text)!,
                              "syncai-deliverable.csv",
                            )
                          }
                          className="inline-flex items-center gap-1.5 rounded-lg border border-teal-500/30 bg-teal-500/10 px-2 py-1 text-[11px] font-medium text-teal-300 hover:bg-teal-500/20"
                        >
                          <Download className="h-3 w-3" aria-hidden />
                          CSV
                        </button>
                      )}
                      {syncEnabled &&
                        voiceOutput.enabled &&
                        speech.supported &&
                        message.text && (
                          <button
                            type="button"
                            onClick={() =>
                              speech.speaking
                                ? speech.stop()
                                : speech.speak(message.text)
                            }
                            className="inline-flex items-center gap-1 rounded-lg border border-white/8 px-2 py-1 text-[11px] text-slate-400 hover:text-slate-200"
                            aria-label={
                              speech.speaking
                                ? "Stop speaking"
                                : "Read response aloud"
                            }
                          >
                            {speech.speaking ? (
                              <VolumeX className="h-3 w-3" aria-hidden />
                            ) : (
                              <Volume2 className="h-3 w-3" aria-hidden />
                            )}
                            {speech.speaking ? "Stop" : "Listen"}
                          </button>
                        )}
                    </div>
                  </div>
                </div>
              ),
            )}

            {legacySending && (
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                {longRun
                  ? "Producing the complete deliverable…"
                  : "Reading your live operating data…"}
              </div>
            )}
          </div>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              void ask(input);
            }}
            className="border-t border-white/6 p-3"
          >
            {dictation.error && (
              <div className="mb-2 text-[11px] text-amber-300">
                {dictation.error}
              </div>
            )}
            <div className="flex gap-2">
              <input
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder={
                  syncEnabled ? "Talk to Sync…" : "Ask about your operation…"
                }
                aria-label={`Ask ${syncEnabled ? "Sync" : persona.title}`}
                className="min-w-0 flex-1 rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white placeholder-slate-400 focus:border-teal-400 focus:outline-hidden focus:ring-1 focus:ring-teal-400"
              />

              {syncEnabled && voiceInput.enabled && dictation.supported && (
                <button
                  type="button"
                  onClick={dictation.listening ? dictation.stop : startDictation}
                  aria-label={
                    dictation.listening ? "Stop dictation" : "Start dictation"
                  }
                  className={`flex h-9 w-9 items-center justify-center rounded-lg border ${
                    dictation.listening
                      ? "border-red-400/50 bg-red-500/10 text-red-300"
                      : "border-white/10 text-slate-300 hover:text-white"
                  }`}
                >
                  {dictation.listening ? (
                    <MicOff className="h-4 w-4" aria-hidden />
                  ) : (
                    <Mic className="h-4 w-4" aria-hidden />
                  )}
                </button>
              )}

              {syncEnabled && streamStatus === "streaming" ? (
                <button
                  type="button"
                  onClick={cancelStream}
                  aria-label="Stop response"
                  className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-200 text-slate-950 hover:bg-white"
                >
                  <Square
                    className="h-3.5 w-3.5 fill-current"
                    aria-hidden
                  />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={sending || !input.trim()}
                  aria-label="Send"
                  className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-500 text-slate-950 hover:bg-teal-400 disabled:opacity-40 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-teal-300"
                >
                  <Send className="h-4 w-4" aria-hidden />
                </button>
              )}
            </div>

            <div className="mt-1.5 flex items-center justify-between gap-2">
              <p className="text-[10px] leading-4 text-slate-500">
                {syncEnabled
                  ? "Role-scoped evidence · human-confirmed actions · tenant audit trail"
                  : "Grounded in data your role can see · advisory only — actions stay human-approved"}
              </p>
              {syncEnabled &&
                lastQuestionRef.current &&
                streamStatus !== "streaming" && (
                  <button
                    type="button"
                    onClick={() => void ask(lastQuestionRef.current, false)}
                    className="inline-flex shrink-0 items-center gap-1 text-[10px] text-slate-500 hover:text-slate-300"
                  >
                    <RotateCcw className="h-3 w-3" aria-hidden />
                    Regenerate
                  </button>
                )}
            </div>
          </form>
        </div>
      )}
    </>
  );
}
