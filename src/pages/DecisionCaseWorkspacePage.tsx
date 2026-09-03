import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowUpRight,
  Bot,
  Calculator,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  Database,
  Gauge,
  History,
  LockKeyhole,
  PanelLeft,
  Play,
  Plus,
  Search,
  Send,
  Paperclip,
  Mic,
  MicOff,
  Camera,
  Image as ImageIcon,
  X as XIcon,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  UserRound,
  Users,
  XCircle,
} from "lucide-react";
import {
  profileAttachment,
  formatAttachmentForMessage,
  isRefusal,
  type AttachmentProfile,
} from "../lib/composer-attachment";
import { useDictation } from "../hooks/useDictation";
import { useOptionalAuth } from "../components/AuthProvider";
import {
  ASK_PLACEHOLDER,
  PublicAskBar,
} from "../components/public-ask/PublicAskBar";
import { PublicAskEmpty } from "../components/public-ask/PublicAskEmpty";
import { PublicAskRail } from "../components/public-ask/PublicAskRail";
import { MarkdownRenderer } from "../components/MarkdownRenderer";
import { RecommendationTurn } from "../components/chat/RecommendationTurn";
import { LearnUnpersistedPointer } from "../components/chat/LearnUnpersistedPointer";
import {
  conversationIsEmpty,
  establishedFromEvidence,
  frozenDisposition,
  isNamedAuthority,
  isRecommendationTurn,
  notProvenFromEvidence,
  reviewingAuthority,
  shouldShowLearnPointer,
} from "../lib/chat/recommendation-turn";
import {
  createDraftDecisionCase,
  createSeedDecisionCases,
  formatDecisionValue,
  getDecisionIndustryPack,
  getPublicDecisionCaseStorageKey,
  normalizeDecisionIndustry,
  readDecisionCases,
  stageDecisionCaseHandoff,
  writeDecisionCases,
  type ApprovalStatus,
  type DecisionCase,
  type DecisionIndustryId,
  type DecisionEvidence,
  type DecisionJourneyContext,
} from "../lib/decision-case";
import { classifyDecisionQuestionScope } from "../lib/reliability-agent-contract";
import {
  FIRST_PAINT_QUESTIONS,
  createFirstPaintSeed,
} from "../lib/first-paint-seeds";
import { RotatingSeedChip } from "../components/RotatingSeedChip";
import {
  askDecisionCase,
  createPersistedDecisionCase,
  isPersistedDecisionCase,
  loadPersistedDecisionCase,
  savePersistedDecisionCase,
} from "../services/decisionCaseService";
import "./DecisionCaseWorkspacePage.css";
import "../components/public-ask/public-ask.css";

type PacketTab = "decision" | "evidence" | "authority" | "work" | "value";

const tabs: Array<{ id: PacketTab; label: string }> = [
  { id: "decision", label: "Decision" },
  { id: "evidence", label: "Evidence" },
  { id: "authority", label: "Authority" },
  { id: "work", label: "Work" },
  { id: "value", label: "Value" },
];
const PUBLIC_VALUE_PROOF_TOKEN_ALLOWANCE = 60000;

function trackDecisionWorkspaceEvent(
  eventName: string,
  metadata: Record<string, string | number | boolean> = {},
) {
  if (typeof window === "undefined") return;
  const payload = {
    event: eventName,
    page: "decision_workspace_demo",
    ...metadata,
  };
  const analyticsWindow = window as Window & {
    dataLayer?: Array<Record<string, unknown>>;
  };
  analyticsWindow.dataLayer?.push(payload);
  if (import.meta.env.DEV) {
    console.info("[SyncAI workspace event]", payload);
  }
}

function includeCompletePublicValueProof(cases: DecisionCase[]) {
  return cases.map((item) => ({
    ...item,
    billingMode: "complimentary" as const,
    tokenAllowance: Math.max(
      item.tokenAllowance,
      PUBLIC_VALUE_PROOF_TOKEN_ALLOWANCE,
    ),
  }));
}

function getContext(params: URLSearchParams): DecisionJourneyContext {
  return {
    asset: params.get("asset") || undefined,
    pain: params.get("pain") || undefined,
    role: params.get("role") || undefined,
    company: params.get("company") || undefined,
    system: params.get("system") || undefined,
    intakeId: params.get("intake") || undefined,
    industry: normalizeDecisionIndustry(params.get("industry")),
  };
}

function readStoredCases(
  storage: Pick<Storage, "getItem">,
  storageKey: string,
): DecisionCase[] | null {
  try {
    const raw = storage.getItem(storageKey);
    const parsed = raw ? (JSON.parse(raw) as DecisionCase[]) : null;
    return Array.isArray(parsed) && parsed.length ? parsed : null;
  } catch {
    return null;
  }
}

function initialCases(
  routeId: string | undefined,
  context: DecisionJourneyContext,
  publicMode: boolean,
): DecisionCase[] {
  const industry = normalizeDecisionIndustry(context.industry);
  const storage = publicMode ? window.sessionStorage : window.localStorage;
  const storageKey = publicMode
    ? getPublicDecisionCaseStorageKey(industry)
    : undefined;

  if (publicMode) {
    const stored = storageKey ? readStoredCases(storage, storageKey) : null;
    if (stored) return includeCompletePublicValueProof(stored);
    const role = context.role || getDecisionIndustryPack(industry).roles[0];
    return includeCompletePublicValueProof([
      createDraftDecisionCase(role, industry),
    ]);
  }

  const stored = readDecisionCases(storage, context, storageKey);
  if (
    !routeId ||
    routeId === "demo" ||
    stored.some((item) => item.id === routeId)
  ) {
    return stored;
  }
  const personalized = createSeedDecisionCases(context)[0];
  personalized.id = routeId;
  personalized.caseNumber = `VP-${routeId.slice(-6).toUpperCase()}`;
  return [personalized, ...stored];
}

function timestamp(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function approvalLabel(status: ApprovalStatus) {
  const labels: Partial<Record<ApprovalStatus, string>> = {
    complete: "Complete",
    approved: "Approved",
    changes_requested: "Changes requested",
    delegated: "Delegated",
    rejected: "Rejected",
  };
  return labels[status] || "Awaiting decision";
}

function exportDecisionRecord(active: DecisionCase, publicMode: boolean) {
  const record = {
    exportStatus: publicMode ? "DEMO_NOT_APPROVED" : active.statusLabel,
    exportedAt: new Date().toISOString(),
    packetVersion: active.version,
    decisionCase: active,
  };
  const blob = new Blob([JSON.stringify(record, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${active.caseNumber}-${active.version}-decision-record.json`;
  link.click();
  URL.revokeObjectURL(url);
}

export function DecisionCaseWorkspacePage({
  publicMode = false,
}: {
  publicMode?: boolean;
}) {
  const { caseId } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const context = useMemo(() => getContext(params), [params]);
  const [industry, setIndustry] = useState<DecisionIndustryId>(() =>
    normalizeDecisionIndustry(params.get("industry")),
  );
  const industryPack = getDecisionIndustryPack(industry);
  const [cases, setCases] = useState(() =>
    initialCases(caseId, context, publicMode),
  );
  const [selectedId, setSelectedId] = useState(
    caseId && caseId !== "demo" ? caseId : cases[0].id,
  );
  const auth = useOptionalAuth();
  const viewerName = auth?.profile?.full_name ?? null;
  const [railOpen, setRailOpen] = useState(false);
  const [recordOpen, setRecordOpen] = useState(false);
  const [tab, setTab] = useState<PacketTab>("decision");
  const [role] = useState(context.role || industryPack.roles[0]);
  const [composer, setComposer] = useState("");
  const [composerPlaceholder, setComposerPlaceholder] = useState(
    publicMode ? ASK_PLACEHOLDER : "Ask a reliability question…",
  );
  const [attachment, setAttachment] = useState<AttachmentProfile | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const plusSheetRef = useRef<HTMLDivElement | null>(null);
  const [plusOpen, setPlusOpen] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const dictation = useDictation((text) =>
    setComposer((prev) => (prev ? `${prev} ${text}` : text)),
  );
  const [comment, setComment] = useState("");
  const [replying, setReplying] = useState(false);
  const [evidence, setEvidence] = useState<DecisionEvidence | null>(null);
  const [usageOpen, setUsageOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const active = cases.find((item) => item.id === selectedId) || cases[0];
  const activeId = active.id;
  const composerScope = classifyDecisionQuestionScope(active, composer);

  const updateCase = (change: (current: DecisionCase) => DecisionCase) => {
    setCases((current) =>
      current.map((item) =>
        item.id === selectedId
          ? { ...change(item), updatedAt: new Date().toISOString() }
          : item,
      ),
    );
  };

  useEffect(() => {
    const storage = publicMode ? window.sessionStorage : window.localStorage;
    writeDecisionCases(
      storage,
      cases,
      publicMode ? getPublicDecisionCaseStorageKey(industry) : undefined,
    );
  }, [cases, industry, publicMode]);
  useEffect(() => {
    if (!publicMode) return;
    trackDecisionWorkspaceEvent("industry_proof_viewed", { industry });
  }, [industry, publicMode]);
  useEffect(() => {
    if (!publicMode) return;
    const routedIndustry = normalizeDecisionIndustry(context.industry);
    if (routedIndustry === industry) return;
    const nextCases = initialCases(
      caseId,
      { ...context, industry: routedIndustry },
      true,
    );
    setIndustry(routedIndustry);
    setCases(nextCases);
    setSelectedId(nextCases[0].id);
    setTab("decision");
    setEvidence(null);
    setRecordOpen(false);
  }, [caseId, context, industry, publicMode]);
  useEffect(() => {
    if (publicMode || !isPersistedDecisionCase(activeId)) return;
    let cancelled = false;
    void loadPersistedDecisionCase(activeId)
      .then((saved) => {
        if (!cancelled && saved) {
          setCases((current) =>
            current.map((item) => (item.id === saved.id ? saved : item)),
          );
        }
      })
      .catch(() => setNotice("Working locally. Cloud sync will retry."));
    return () => {
      cancelled = true;
    };
  }, [activeId, publicMode]);
  useEffect(() => {
    if (publicMode || !isPersistedDecisionCase(active.id)) return;
    const timer = window.setTimeout(() => {
      void savePersistedDecisionCase(active).catch(() =>
        setNotice("Changes are safe on this device; cloud sync is pending."),
      );
    }, 700);
    return () => window.clearTimeout(timer);
  }, [active, publicMode]);
  useEffect(() => {
    if (typeof endRef.current?.scrollIntoView === "function") {
      endRef.current.scrollIntoView({ block: "nearest" });
    }
  }, [active.messages.length, replying]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 3600);
    return () => window.clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (conversationIsEmpty(active.messages)) {
      composerRef.current?.focus();
    }
  }, [active.id, active.messages]);
  useEffect(() => {
    if (!plusOpen) return;
    const onPointer = (event: MouseEvent) => {
      if (
        plusSheetRef.current &&
        !plusSheetRef.current.contains(event.target as Node)
      ) {
        setPlusOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPlusOpen(false);
    };
    window.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [plusOpen]);

  const chooseCase = (id: string) => {
    setSelectedId(id);
    setTab("decision");
    setEvidence(null);
    setRecordOpen(false);
  };

  const trySample = (index = 0) => {
    const sample = createFirstPaintSeed(index, {
      ...context,
      industry,
      role,
    });
    setCases((current) => {
      const keep = current.filter(
        (item) =>
          item.id !== sample.id &&
          !(item.id.startsWith("draft-") && conversationIsEmpty(item.messages)),
      );
      return [sample, ...keep];
    });
    setSelectedId(sample.id);
    setRecordOpen(false);
    setRailOpen(false);
  };

  const createCase = async () => {
    const existingDraft = cases.find(
      (item) =>
        item.id.startsWith("draft-") &&
        (!publicMode || conversationIsEmpty(item.messages)),
    );
    if (existingDraft) {
      chooseCase(existingDraft.id);
      if (publicMode) {
        setComposer("");
        setComposerPlaceholder(ASK_PLACEHOLDER);
        setRailOpen(false);
        setRecordOpen(false);
      }
      return;
    }
    const next = createDraftDecisionCase(role, industry);
    setCases((current) => [next, ...current]);
    setSelectedId(next.id);
    if (publicMode) {
      setComposer("");
      setComposerPlaceholder(ASK_PLACEHOLDER);
      setRailOpen(false);
      setRecordOpen(false);
    }
    if (!publicMode) {
      try {
        const persisted = await createPersistedDecisionCase(next, context);
        setCases((current) =>
          current.map((item) => (item.id === next.id ? persisted : item)),
        );
        setSelectedId(persisted.id);
        navigate(`/decision-cases/${persisted.id}`);
        setNotice("Decision Case saved to the governed team workspace.");
      } catch {
        setNotice("Case created locally. Cloud sync is pending.");
      }
    }
  };

  const handleAttach = async (file: File | undefined) => {
    if (!file) return;
    setAttachmentError(null);
    if (
      file.type.startsWith("image/") ||
      /\.(png|jpe?g|gif|webp|heic|bmp|tiff?)$/i.test(file.name)
    ) {
      setPhoto(file);
      return;
    }
    const result = await profileAttachment(file);
    if (isRefusal(result)) {
      setAttachment(null);
      setAttachmentError(result.error);
      return;
    }
    setAttachment(result);
  };

  const sendMessage = async (suggestion?: string) => {
    const typed = (suggestion || composer).trim();
    const photoLine = photo
      ? `[Attached photo — ${photo.name}]\nImage will be sent with this turn. The file is not read or transcribed here.`
      : "";
    // The attachment profile is prepended rather than hidden, so the message
    // in the transcript is exactly what was sent — the person can audit it.
    const text = [
      attachment ? formatAttachmentForMessage(attachment) : "",
      photoLine,
      typed,
    ]
      .filter(Boolean)
      .join("\n\n");
    if (!text || replying) return;
    if (
      active.billingMode === "paused" ||
      (!publicMode &&
        active.billingMode === "complimentary" &&
        active.tokensUsed >= active.tokenAllowance)
    ) {
      setUsageOpen(true);
      return;
    }
    const userMessage = {
      id: `user-${Date.now()}`,
      role: "user" as const,
      author: "You",
      text,
      createdAt: new Date().toISOString(),
    };
    const requestCase = {
      ...active,
      messages: [...active.messages, userMessage],
    };
    updateCase((current) => ({
      ...current,
      messages: [...current.messages, userMessage],
      tokensUsed:
        current.tokensUsed + Math.max(50, Math.ceil(text.length / 3.7)),
    }));
    setComposer("");
    setAttachment(null);
    setPhoto(null);
    setAttachmentError(null);
    setComposerPlaceholder(
      publicMode ? ASK_PLACEHOLDER : "Ask a reliability question…",
    );
    setReplying(true);
    try {
      const response = await askDecisionCase(requestCase, text, {
        publicMode,
      });
      updateCase((current) => ({
        ...current,
        messages: [...current.messages, response.message],
        tokensUsed: current.tokensUsed + response.estimatedTokens,
      }));
    } catch {
      updateCase((current) => ({
        ...current,
        messages: [
          ...current.messages,
          {
            id: `retry-${Date.now()}`,
            role: "assistant",
            author: "SyncAI",
            text: "The conversation is preserved, but live analysis is temporarily unavailable. The governed recommendation and evidence packet remain available.",
            createdAt: new Date().toISOString(),
            meta: "Saved for retry",
          },
        ],
      }));
    } finally {
      setReplying(false);
    }
  };

  const decide = (
    status: ApprovalStatus,
    extra?: { delegateName?: string },
  ) => {
    const approved = status === "approved";
    const decidedAt = new Date().toISOString();
    const time = timestamp(decidedAt);
    updateCase((current) => {
      const reviewer = reviewingAuthority(current.approvals);
      const actorName = reviewer?.name || extra?.delegateName || role;
      let text: string;
      if (approved) {
        text = publicMode
          ? `Simulated: ${actorName} approved the controlled plan · ${time}. ${current.workPackage.number} recorded as released to ${current.workPackage.targetSystem}; no production system was changed.`
          : `${actorName} approved the controlled plan · ${time}. ${current.workPackage.number} is released to ${current.workPackage.targetSystem}.`;
      } else if (status === "changes_requested") {
        text = `${actorName} requested changes · ${time}`;
      } else if (status === "delegated") {
        text = `${actorName} delegated to ${extra?.delegateName || "another named human"} · ${time}`;
      } else {
        text = `${actorName} rejected the controlled plan · ${time}`;
      }
      return {
        ...current,
        stage: approved ? "execution" : "evidence",
        statusLabel: approved ? "Work package released" : approvalLabel(status),
        approvals: current.approvals.map((item) =>
          item.status === "reviewing" ? { ...item, status, decidedAt } : item,
        ),
        workPackage: {
          ...current.workPackage,
          status: approved ? "released" : current.workPackage.status,
          receipt: approved
            ? {
                externalId: publicMode
                  ? `DEMO-${current.workPackage.number}`
                  : `${current.workPackage.targetSystem.toUpperCase().replace(/\W+/g, "-")}-${current.workPackage.number}`,
                status: publicMode ? "simulated" : "accepted",
                releasedAt: decidedAt,
                lastSync: decidedAt,
              }
            : current.workPackage.receipt,
        },
        messages: [
          ...current.messages,
          {
            id: `gate-${Date.now()}`,
            role: "system" as const,
            author: publicMode ? "Demo simulation" : actorName,
            text,
            createdAt: decidedAt,
          },
        ],
      };
    });
    if (status === "changes_requested") {
      setComposerPlaceholder("What is missing or wrong?");
      window.setTimeout(() => composerRef.current?.focus(), 0);
    }
  };

  const completeWork = () => {
    updateCase((current) => ({
      ...current,
      stage: "outcomes",
      statusLabel: "Value verification",
      workPackage: {
        ...current.workPackage,
        status: "complete",
        controls: current.workPackage.controls.map((item) => ({
          ...item,
          status: "complete",
        })),
      },
    }));
    setTab("value");
    setNotice("Work evidence captured. The value-proof window is open.");
  };

  const verifyValue = () => {
    if (publicMode) {
      trackDecisionWorkspaceEvent("industry_value_proof_completed", {
        industry,
        caseNumber: active.caseNumber,
      });
    }
    updateCase((current) => ({
      ...current,
      stage: "learning",
      statusLabel: "Value verified",
      financeStatus: "verified",
      valueMetrics: current.valueMetrics.map((item) => ({
        ...item,
        actual: item.verifiedActual,
      })),
      learningRecord: {
        id: `LR-${current.caseNumber.replace(/\D/g, "")}`,
        status: "retained",
        summary: `${current.asset} outcome, approved conditions, and recurrence definition retained for future governed decisions.`,
      },
      messages: [
        ...current.messages,
        {
          id: `value-${Date.now()}`,
          role: "system",
          author: current.financeSponsor,
          text: "Finance verified the measured outcome against the approved baseline. The learning record is now available to future cases.",
          createdAt: new Date().toISOString(),
          meta: "Value assurance complete",
        },
      ],
    }));
    setNotice("Measured value verified and returned to the learning loop.");
    if (publicMode) setUsageOpen(true);
  };

  const addComment = () => {
    if (!comment.trim()) return;
    updateCase((current) => ({
      ...current,
      comments: [
        ...current.comments,
        {
          id: `comment-${Date.now()}`,
          author: role,
          text: comment.trim(),
          createdAt: new Date().toISOString(),
        },
      ],
    }));
    setComment("");
  };

  const namedAuthority =
    reviewingAuthority(active.approvals) ||
    active.approvals.find((item) =>
      ["approved", "changes_requested", "delegated", "rejected"].includes(
        item.status,
      ),
    );
  const frozen = frozenDisposition(active.approvals);
  const canDispose = publicMode
    ? !frozen
    : Boolean(
        namedAuthority &&
        isNamedAuthority(viewerName, namedAuthority.name) &&
        !frozen,
      );
  const emptyConversation = conversationIsEmpty(active.messages);
  const showLearnPointer = shouldShowLearnPointer(active.approvals);
  const authority = reviewingAuthority(active.approvals);
  const dictationTitle = dictation.supported
    ? dictation.listening
      ? "Stop dictation"
      : "Dictate — runs in your browser"
    : "This browser has no speech recognition";
  const publicAskBar = (
    <PublicAskBar
      docked={!emptyConversation}
      value={composer}
      placeholder={composerPlaceholder}
      textareaRef={composerRef}
      onChange={setComposer}
      onSend={() => void sendMessage()}
      sendDisabled={(!composer.trim() && !attachment && !photo) || replying}
      caseExists={!emptyConversation}
      dictationSupported={dictation.supported}
      dictationListening={dictation.listening}
      dictationTitle={dictationTitle}
      onToggleDictation={() =>
        dictation.listening ? dictation.stop() : dictation.start()
      }
      photoInputRef={photoInputRef}
      onOpenAttachMenu={() => setPlusOpen((value) => !value)}
    />
  );

  const workspace = (
    <div
      className={`decision-workspace ${publicMode ? "is-public" : ""}`}
      data-layout="chat-first"
    >
      <header className="dw-topbar">
        <div className="dw-topbar-side">
          {!emptyConversation && (
            <button
              type="button"
              className="dw-icon"
              aria-label="Conversations"
              aria-expanded={railOpen}
              onClick={() => setRailOpen((value) => !value)}
            >
              <PanelLeft size={17} />
            </button>
          )}
        </div>
        <div
          className="dw-topbar-center"
          data-testid="first-paint-header-center"
        >
          {!emptyConversation && (
            <span className="dw-case-name">{active.title}</span>
          )}
        </div>
        <div className="dw-topbar-side is-end">
          {!emptyConversation && (
            <button
              type="button"
              className="dw-view-record"
              onClick={() => setRecordOpen((value) => !value)}
            >
              {recordOpen ? "Hide record" : "View record"}
            </button>
          )}
        </div>
      </header>

      <div
        className={`dw-layout${railOpen ? " is-rail-open" : ""}${recordOpen ? " is-record-open" : ""}`}
      >
        {railOpen && (
          <aside className="dw-rail" aria-label="Conversation list">
            <button
              type="button"
              className="dw-new"
              onClick={() => void createCase()}
            >
              <Plus size={16} /> New
            </button>
            <div className="dw-section-label">Conversations</div>
            <div className="dw-case-list">
              {cases.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={`dw-case-row ${item.id === active.id ? "active" : ""}`}
                  onClick={() => chooseCase(item.id)}
                >
                  <span>
                    <strong>{item.title}</strong>
                    <small>{item.asset}</small>
                  </span>
                </button>
              ))}
            </div>
          </aside>
        )}

        <main className="dw-main">
          <>
            <section className="dw-thread" aria-label="Conversation">
              {emptyConversation ? (
                <div className="dw-empty" data-testid="first-paint-empty">
                  <RotatingSeedChip
                    questions={FIRST_PAINT_QUESTIONS}
                    onSelect={trySample}
                  />
                </div>
              ) : (
                active.messages.map((message) => (
                  <article
                    key={message.id}
                    className={`dw-message role-${message.role}`}
                  >
                    {message.role !== "system" && (
                      <span className="dw-avatar">
                        {message.role === "assistant" ? (
                          <Bot size={16} />
                        ) : (
                          <UserRound size={16} />
                        )}
                      </span>
                    )}
                    <div>
                      {message.role === "system" ? (
                        <p className="dw-system-turn">{message.text}</p>
                      ) : (
                        <>
                          <header>
                            <strong>
                              {message.role === "assistant"
                                ? "SyncAI"
                                : message.author}
                            </strong>
                            <span>{timestamp(message.createdAt)}</span>
                          </header>
                          {message.role === "assistant" ? (
                            <MarkdownRenderer
                              content={message.text}
                              className="dw-message-markdown"
                            />
                          ) : (
                            <p>{message.text}</p>
                          )}
                        </>
                      )}
                      {message.role === "assistant" &&
                        isRecommendationTurn(message) &&
                        namedAuthority && (
                          <RecommendationTurn
                            established={establishedFromEvidence(
                              active.evidence,
                            )}
                            notProven={notProvenFromEvidence(active.evidence)}
                            recommendation={active.recommendation}
                            recommendationDetail={active.recommendationDetail}
                            authorityName={namedAuthority.name}
                            authorityRole={namedAuthority.role}
                            publicMode={publicMode}
                            canDispose={canDispose}
                            frozen={frozen}
                            approvals={active.approvals}
                            onDecide={decide}
                          />
                        )}
                    </div>
                  </article>
                ))
              )}
              {replying && (
                <article className="dw-message role-assistant">
                  <span className="dw-avatar">
                    <Bot size={16} />
                  </span>
                  <div>
                    <header>
                      <strong>SyncAI</strong>
                      <span>working</span>
                    </header>
                    <p className="dw-thinking" aria-label="working">
                      <i />
                      <i />
                      <i />
                    </p>
                  </div>
                </article>
              )}
              {showLearnPointer && <LearnUnpersistedPointer />}
              <div ref={endRef} />
            </section>
            <section className="dw-composer-wrap" id="syncai-chat">
              {attachment && (
                <div className="dw-attach-chip">
                  <Paperclip size={13} />
                  <span className="dw-attach-name">{attachment.name}</span>
                  <span className="dw-attach-meta">
                    {attachment.rowCount.toLocaleString()} rows ×{" "}
                    {attachment.headers.length} cols · column names and{" "}
                    {attachment.sampleRows.length} sample rows will be included
                  </span>
                  <button
                    type="button"
                    title="Remove attachment"
                    onClick={() => setAttachment(null)}
                  >
                    <XIcon size={13} />
                  </button>
                </div>
              )}
              {photo && (
                <div className="dw-attach-chip">
                  <Camera size={13} />
                  <span className="dw-attach-name">{photo.name}</span>
                  <span className="dw-attach-meta">
                    Photo will be sent with this turn
                  </span>
                  <button
                    type="button"
                    title="Remove photo"
                    onClick={() => setPhoto(null)}
                  >
                    <XIcon size={13} />
                  </button>
                </div>
              )}
              {(attachmentError || dictation.error) && (
                <div className="dw-attach-error" role="status">
                  {attachmentError || dictation.error}
                </div>
              )}
              <div className="dw-composer">
                {!emptyConversation && (
                  <div className="dw-plus" ref={plusSheetRef}>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".csv,.tsv,.txt,.log"
                      className="dw-file-input"
                      aria-label="Attach a data file"
                      onChange={(event) => {
                        void handleAttach(event.target.files?.[0]);
                        event.target.value = "";
                        setPlusOpen(false);
                      }}
                    />
                    <input
                      ref={photoInputRef}
                      type="file"
                      accept="image/*"
                      className="dw-file-input"
                      aria-label="Attach a photo"
                      onChange={(event) => {
                        void handleAttach(event.target.files?.[0]);
                        event.target.value = "";
                        setPlusOpen(false);
                      }}
                    />
                    <input
                      ref={cameraInputRef}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="dw-file-input"
                      aria-label="Open camera"
                      onChange={(event) => {
                        void handleAttach(event.target.files?.[0]);
                        event.target.value = "";
                        setPlusOpen(false);
                      }}
                    />
                    <button
                      type="button"
                      className="dw-composer-tool"
                      title="Add"
                      aria-label="Add camera, photos, or files"
                      aria-expanded={plusOpen}
                      aria-haspopup="menu"
                      onClick={() => setPlusOpen((value) => !value)}
                    >
                      <Plus size={16} />
                    </button>
                    {plusOpen && (
                      <div className="dw-plus-sheet" role="menu">
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => cameraInputRef.current?.click()}
                        >
                          <Camera size={16} />
                          Camera
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => photoInputRef.current?.click()}
                        >
                          <ImageIcon size={16} />
                          Photos
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => fileInputRef.current?.click()}
                        >
                          <Paperclip size={16} />
                          Files
                        </button>
                      </div>
                    )}
                  </div>
                )}
                <textarea
                  ref={composerRef}
                  value={composer}
                  onChange={(event) => setComposer(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void sendMessage();
                    }
                  }}
                  placeholder={composerPlaceholder}
                  rows={2}
                />
                {!emptyConversation && (
                  <button
                    type="button"
                    className={`dw-composer-tool ${dictation.listening ? "is-live" : ""}`}
                    title={
                      dictation.supported
                        ? dictation.listening
                          ? "Stop dictation"
                          : "Dictate — runs in your browser"
                        : "This browser has no speech recognition"
                    }
                    aria-label={
                      dictation.listening
                        ? "Stop dictation"
                        : "Dictate a message"
                    }
                    aria-pressed={dictation.listening}
                    disabled={!dictation.supported}
                    onClick={() =>
                      dictation.listening ? dictation.stop() : dictation.start()
                    }
                  >
                    {dictation.supported ? (
                      <Mic size={16} />
                    ) : (
                      <MicOff size={16} />
                    )}
                  </button>
                )}
                <button
                  type="button"
                  title="Send message"
                  disabled={
                    (!composer.trim() && !attachment && !photo) || replying
                  }
                  onClick={() => void sendMessage()}
                >
                  <Send size={17} />
                </button>
              </div>
              {!emptyConversation && (
                <div className="dw-composer-meta">
                  <span>
                    <LockKeyhole size={12} />
                    {composer.trim() &&
                    composerScope === "provisional_new_subject"
                      ? `New subject · ${active.caseNumber} unchanged`
                      : `Using ${active.caseNumber} context`}
                  </span>
                </div>
              )}
            </section>
          </>
        </main>

        {recordOpen && (
          <aside className="dw-packet" aria-label="Decision record">
            <div className="dw-packet-head">
              <span>
                <small>Current decision packet</small>
                <strong>
                  {active.caseNumber} · {active.version}
                </strong>
              </span>
              <button
                className="dw-icon"
                type="button"
                title="Export decision record"
                onClick={() => {
                  exportDecisionRecord(active, publicMode);
                  setNotice(
                    publicMode
                      ? "Demo decision record exported with a not-approved status."
                      : "Decision record exported.",
                  );
                }}
              >
                <ArrowUpRight size={16} />
              </button>
            </div>
            <div className="dw-tabs" role="tablist">
              {tabs.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={tab === item.id ? "active" : ""}
                  onClick={() => setTab(item.id)}
                >
                  {item.label}
                  {item.id === "evidence" && (
                    <span>{active.evidence.length}</span>
                  )}
                </button>
              ))}
            </div>
            <div className="dw-packet-body">
              {tab === "decision" && (
                <DecisionPanel active={active} setEvidence={setEvidence} />
              )}
              {tab === "evidence" && (
                <EvidencePanel active={active} setEvidence={setEvidence} />
              )}
              {tab === "authority" && (
                <AuthorityPanel
                  active={active}
                  authority={authority}
                  comment={comment}
                  setComment={setComment}
                  addComment={addComment}
                />
              )}
              {tab === "work" && (
                <WorkPanel active={active} completeWork={completeWork} />
              )}
              {tab === "value" && (
                <ValuePanel active={active} verifyValue={verifyValue} />
              )}
            </div>
          </aside>
        )}
      </div>

      {evidence && (
        <EvidenceModal evidence={evidence} close={() => setEvidence(null)} />
      )}
      {usageOpen && (
        <UsageModal
          publicMode={publicMode}
          proofComplete={active.financeStatus === "verified"}
          close={() => setUsageOpen(false)}
          onSecure={() =>
            stageDecisionCaseHandoff(window.sessionStorage, active)
          }
          choose={(mode, allowance) => {
            updateCase((current) => ({
              ...current,
              billingMode: mode,
              tokenAllowance: allowance || current.tokenAllowance,
            }));
            setUsageOpen(false);
            setNotice(
              mode === "paused"
                ? "Case paused safely."
                : "Continuation selected for this case.",
            );
          }}
        />
      )}
      {historyOpen && (
        <HistoryModal
          active={active}
          publicMode={publicMode}
          close={() => setHistoryOpen(false)}
        />
      )}
      {notice && (
        <div className="dw-notice">
          <CheckCircle2 size={16} /> {notice}
        </div>
      )}
    </div>
  );
  if (!publicMode) return workspace;

  // Bolt public shell. Mode A is the empty canvas — no public product
  // header / RELIABILITY ENGINEER lockup. Mode B is the existing case /
  // transcript / recommendation / Approve path on a light conversation.
  // LEARN after Simulate stays LearnUnpersistedPointer — verification is
  // not written here. Packet and attach stay gated on a started case.
  return (
    <div
      className={`bolt-public ${emptyConversation ? "is-empty" : "is-thread"}`}
      data-layout="chat-first"
    >
      <PublicAskRail
        homeActive={emptyConversation}
        onHome={() => void createCase()}
        assessHref="/setup"
        signInHref="/signin?returnTo=%2F"
        onSignIn={() => stageDecisionCaseHandoff(window.sessionStorage, active)}
      />
      <div className="bolt-stage">
        {emptyConversation ? (
          <PublicAskEmpty askBar={publicAskBar} onSelectIntent={trySample} />
        ) : (
          <>
            <header className="bolt-thread-bar">
              <div className="bolt-thread-bar-side">
                <button
                  type="button"
                  className="bolt-icon"
                  aria-label="Conversations"
                  aria-expanded={railOpen}
                  onClick={() => setRailOpen((value) => !value)}
                >
                  <PanelLeft size={17} />
                </button>
              </div>
              <div
                className="bolt-thread-bar-side is-center"
                data-testid="first-paint-header-center"
              >
                <span className="bolt-thread-title">{active.title}</span>
              </div>
              <div className="bolt-thread-bar-side is-end">
                <button
                  type="button"
                  className="bolt-view-record"
                  onClick={() => setRecordOpen((value) => !value)}
                >
                  {recordOpen ? "Hide record" : "View record"}
                </button>
              </div>
            </header>
            <div
              className={`bolt-layout${railOpen ? " is-rail-open" : ""}${recordOpen ? " is-record-open" : ""}`}
            >
              {railOpen && (
                <aside className="dw-rail" aria-label="Conversation list">
                  <button
                    type="button"
                    className="dw-new"
                    onClick={() => void createCase()}
                  >
                    <Plus size={16} /> New
                  </button>
                  <div className="dw-section-label">Conversations</div>
                  <div className="dw-case-list">
                    {cases.map((item) => (
                      <button
                        type="button"
                        key={item.id}
                        className={`dw-case-row ${item.id === active.id ? "active" : ""}`}
                        onClick={() => chooseCase(item.id)}
                      >
                        <span>
                          <strong>{item.title}</strong>
                          <small>{item.asset}</small>
                        </span>
                      </button>
                    ))}
                  </div>
                </aside>
              )}
              <main className="bolt-main">
                <section className="dw-thread" aria-label="Conversation">
                  {active.messages.map((message) => (
                    <article
                      key={message.id}
                      className={`dw-message role-${message.role}`}
                    >
                      {message.role !== "system" && (
                        <span className="dw-avatar">
                          {message.role === "assistant" ? (
                            <Bot size={16} />
                          ) : (
                            <UserRound size={16} />
                          )}
                        </span>
                      )}
                      <div>
                        {message.role === "system" ? (
                          <p className="dw-system-turn">{message.text}</p>
                        ) : (
                          <>
                            <header>
                              <strong>
                                {message.role === "assistant"
                                  ? "SyncAI"
                                  : message.author}
                              </strong>
                              <span>{timestamp(message.createdAt)}</span>
                            </header>
                            {message.role === "assistant" ? (
                              <MarkdownRenderer
                                content={message.text}
                                className="dw-message-markdown"
                              />
                            ) : (
                              <p>{message.text}</p>
                            )}
                          </>
                        )}
                        {message.role === "assistant" &&
                          isRecommendationTurn(message) &&
                          namedAuthority && (
                            <RecommendationTurn
                              established={establishedFromEvidence(
                                active.evidence,
                              )}
                              notProven={notProvenFromEvidence(active.evidence)}
                              recommendation={active.recommendation}
                              recommendationDetail={active.recommendationDetail}
                              authorityName={namedAuthority.name}
                              authorityRole={namedAuthority.role}
                              publicMode={publicMode}
                              canDispose={canDispose}
                              frozen={frozen}
                              approvals={active.approvals}
                              onDecide={decide}
                            />
                          )}
                      </div>
                    </article>
                  ))}
                  {replying && (
                    <article className="dw-message role-assistant">
                      <span className="dw-avatar">
                        <Bot size={16} />
                      </span>
                      <div>
                        <header>
                          <strong>SyncAI</strong>
                          <span>working</span>
                        </header>
                        <p className="dw-thinking" aria-label="working">
                          <i />
                          <i />
                          <i />
                        </p>
                      </div>
                    </article>
                  )}
                  {showLearnPointer && <LearnUnpersistedPointer />}
                  <div ref={endRef} />
                </section>
                <section className="dw-composer-wrap" id="syncai-chat">
                  {attachment && (
                    <div className="dw-attach-chip">
                      <Paperclip size={13} />
                      <span className="dw-attach-name">{attachment.name}</span>
                      <span className="dw-attach-meta">
                        {attachment.rowCount.toLocaleString()} rows ×{" "}
                        {attachment.headers.length} cols · column names and{" "}
                        {attachment.sampleRows.length} sample rows will be
                        included
                      </span>
                      <button
                        type="button"
                        title="Remove attachment"
                        onClick={() => setAttachment(null)}
                      >
                        <XIcon size={13} />
                      </button>
                    </div>
                  )}
                  {photo && (
                    <div className="dw-attach-chip">
                      <Camera size={13} />
                      <span className="dw-attach-name">{photo.name}</span>
                      <span className="dw-attach-meta">
                        Photo will be sent with this turn
                      </span>
                      <button
                        type="button"
                        title="Remove photo"
                        onClick={() => setPhoto(null)}
                      >
                        <XIcon size={13} />
                      </button>
                    </div>
                  )}
                  {(attachmentError || dictation.error) && (
                    <div className="dw-attach-error" role="status">
                      {attachmentError || dictation.error}
                    </div>
                  )}
                  <div className="dw-plus" ref={plusSheetRef}>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".csv,.tsv,.txt,.log"
                      className="dw-file-input"
                      aria-label="Attach a data file"
                      onChange={(event) => {
                        void handleAttach(event.target.files?.[0]);
                        event.target.value = "";
                        setPlusOpen(false);
                      }}
                    />
                    <input
                      ref={photoInputRef}
                      type="file"
                      accept="image/*"
                      className="dw-file-input"
                      aria-label="Attach a photo"
                      onChange={(event) => {
                        void handleAttach(event.target.files?.[0]);
                        event.target.value = "";
                        setPlusOpen(false);
                      }}
                    />
                    <input
                      ref={cameraInputRef}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="dw-file-input"
                      aria-label="Open camera"
                      onChange={(event) => {
                        void handleAttach(event.target.files?.[0]);
                        event.target.value = "";
                        setPlusOpen(false);
                      }}
                    />
                    {plusOpen && (
                      <div className="dw-plus-sheet" role="menu">
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => cameraInputRef.current?.click()}
                        >
                          <Camera size={16} />
                          Camera
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => photoInputRef.current?.click()}
                        >
                          <ImageIcon size={16} />
                          Photos
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => fileInputRef.current?.click()}
                        >
                          <Paperclip size={16} />
                          Files
                        </button>
                      </div>
                    )}
                  </div>
                  {publicAskBar}
                </section>
              </main>
              {recordOpen && (
                <aside className="dw-packet" aria-label="Decision record">
                  <div className="dw-packet-head">
                    <span>
                      <small>Current decision packet</small>
                      <strong>
                        {active.caseNumber} · {active.version}
                      </strong>
                    </span>
                    <button
                      className="dw-icon"
                      type="button"
                      title="Export decision record"
                      onClick={() => {
                        exportDecisionRecord(active, publicMode);
                        setNotice(
                          publicMode
                            ? "Demo decision record exported with a not-approved status."
                            : "Decision record exported.",
                        );
                      }}
                    >
                      <ArrowUpRight size={16} />
                    </button>
                  </div>
                  <div className="dw-tabs" role="tablist">
                    {tabs.map((item) => (
                      <button
                        type="button"
                        key={item.id}
                        className={tab === item.id ? "active" : ""}
                        onClick={() => setTab(item.id)}
                      >
                        {item.label}
                        {item.id === "evidence" && (
                          <span>{active.evidence.length}</span>
                        )}
                      </button>
                    ))}
                  </div>
                  <div className="dw-packet-body">
                    {tab === "decision" && (
                      <DecisionPanel
                        active={active}
                        setEvidence={setEvidence}
                      />
                    )}
                    {tab === "evidence" && (
                      <EvidencePanel
                        active={active}
                        setEvidence={setEvidence}
                      />
                    )}
                    {tab === "authority" && (
                      <AuthorityPanel
                        active={active}
                        authority={authority}
                        comment={comment}
                        setComment={setComment}
                        addComment={addComment}
                      />
                    )}
                    {tab === "work" && (
                      <WorkPanel active={active} completeWork={completeWork} />
                    )}
                    {tab === "value" && (
                      <ValuePanel active={active} verifyValue={verifyValue} />
                    )}
                  </div>
                </aside>
              )}
            </div>
          </>
        )}
      </div>
      {evidence && (
        <EvidenceModal evidence={evidence} close={() => setEvidence(null)} />
      )}
      {usageOpen && (
        <UsageModal
          publicMode={publicMode}
          proofComplete={active.financeStatus === "verified"}
          close={() => setUsageOpen(false)}
          onSecure={() =>
            stageDecisionCaseHandoff(window.sessionStorage, active)
          }
          choose={(mode, allowance) => {
            updateCase((current) => ({
              ...current,
              billingMode: mode,
              tokenAllowance: allowance || current.tokenAllowance,
            }));
            setUsageOpen(false);
            setNotice(
              mode === "paused"
                ? "Case paused safely."
                : "Continuation selected for this case.",
            );
          }}
        />
      )}
      {historyOpen && (
        <HistoryModal
          active={active}
          publicMode={publicMode}
          close={() => setHistoryOpen(false)}
        />
      )}
      {notice && (
        <div className="dw-notice">
          <CheckCircle2 size={16} /> {notice}
        </div>
      )}
    </div>
  );
}

function DecisionPanel({
  active,
  setEvidence,
}: {
  active: DecisionCase;
  setEvidence: (value: DecisionEvidence) => void;
}) {
  return (
    <div className="dw-panel">
      <div className="dw-recommendation">
        <ShieldCheck size={17} />
        <span>
          <small>Governed recommendation</small>
          <strong>{active.recommendation}</strong>
        </span>
      </div>
      <p className="dw-rationale">{active.recommendationDetail}</p>
      <div className="dw-metrics">
        {active.decisionMetrics.map((item) => (
          <div key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            <small>{item.detail}</small>
          </div>
        ))}
      </div>
      {active.valueExposure > 0 && (
        <div className="dw-decision-path">
          <CheckCircle2 size={15} />
          <p>
            Pattern identified, first risk ranked, governed action proposed,
            approval boundary preserved, and value ready to verify after
            execution.
          </p>
        </div>
      )}
      <section className="dw-basis">
        <header>
          <span>Source grounding</span>
          <strong>{active.evidenceScore}% evidence quality</strong>
        </header>
        <div>
          <span style={{ width: `${active.evidenceScore}%` }} />
        </div>
        {active.evidence.slice(0, 3).map((item) => (
          <button type="button" key={item.id} onClick={() => setEvidence(item)}>
            <i className={`quality-${item.quality}`} />
            <span>
              <strong>{item.title}</strong>
              <small>{item.state}</small>
            </span>
            <ArrowUpRight size={14} />
          </button>
        ))}
      </section>
      {active.calculations.length > 0 && (
        <section className="dw-calculations">
          <header>
            <Calculator size={15} />
            <span>
              <small>Deterministic calculations</small>
              <strong>Inspectable and source-linked</strong>
            </span>
          </header>
          {active.calculations.map((item) => (
            <div key={item.id}>
              <span>
                <strong>{item.label}</strong>
                <small>{item.formula}</small>
              </span>
              <em>{item.result}</em>
            </div>
          ))}
        </section>
      )}
      <section className="dw-authority-summary">
        <ShieldCheck size={18} />
        <span>
          <small>Required authority</small>
          <strong>{active.authorityRole}</strong>
        </span>
        <span className="dw-authority-note">
          Disposition lives on the recommendation turn.
        </span>
      </section>
    </div>
  );
}

function EvidencePanel({
  active,
  setEvidence,
}: {
  active: DecisionCase;
  setEvidence: (value: DecisionEvidence) => void;
}) {
  return (
    <div className="dw-panel">
      <div className="dw-tab-intro">
        <span>
          <small>Source grounding · data quality</small>
          <strong>{active.evidenceScore}% decision-ready</strong>
        </span>
        <em className="dw-source-count">
          <Search size={14} /> {active.evidence.length} governed sources
        </em>
      </div>
      <div className="dw-evidence-list">
        {active.evidence.map((item) => (
          <button type="button" key={item.id} onClick={() => setEvidence(item)}>
            <span className={`dw-evidence-icon quality-${item.quality}`}>
              {item.quality === "missing" || item.quality === "conflict" ? (
                <TriangleAlert size={16} />
              ) : (
                <Database size={16} />
              )}
            </span>
            <span>
              <strong>{item.title}</strong>
              <small>{item.summary}</small>
              <em>{item.state}</em>
            </span>
            <ArrowUpRight size={15} />
          </button>
        ))}
      </div>
    </div>
  );
}

function AuthorityPanel({
  active,
  authority,
  comment,
  setComment,
  addComment,
}: {
  active: DecisionCase;
  authority: DecisionCase["approvals"][number] | undefined;
  comment: string;
  setComment: (value: string) => void;
  addComment: () => void;
}) {
  return (
    <div className="dw-panel">
      <div className="dw-tab-intro">
        <span>
          <small>Approval boundary</small>
          <strong>
            {authority ? `${authority.name} is reviewing` : active.statusLabel}
          </strong>
        </span>
        <ShieldCheck size={19} />
      </div>
      <div className="dw-approval-chain">
        {active.approvals.map((item) => (
          <div key={item.id} className={`status-${item.status}`}>
            <span>{item.initials}</span>
            <span>
              <strong>{item.name}</strong>
              <small>{item.role}</small>
              <em>{item.responsibility}</em>
            </span>
            <i>{approvalLabel(item.status)}</i>
          </div>
        ))}
      </div>
      {authority && (
        <>
          <section className="dw-authority-task">
            <ClipboardCheck size={16} />
            <span>
              <small>
                TQ-{active.caseNumber.replace(/\D/g, "")}-01 · due today
              </small>
              <strong>{authority.name}</strong>
              <em>Resolve the blocking evidence and record a disposition.</em>
            </span>
          </section>
          <p className="dw-panel-description">
            Viewing this record is not authorization. Disposition sits on the
            recommendation turn.
          </p>
        </>
      )}
      <section className="dw-comments">
        <span>Review comments</span>
        {active.comments.map((item) => (
          <div key={item.id}>
            <strong>{item.author}</strong>
            <p>{item.text}</p>
          </div>
        ))}
        <div className="dw-comment-entry">
          <input
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder="Add rationale or a condition..."
          />
          <button type="button" onClick={addComment} disabled={!comment.trim()}>
            <Send size={14} />
          </button>
        </div>
      </section>
    </div>
  );
}

function WorkPanel({
  active,
  completeWork,
}: {
  active: DecisionCase;
  completeWork: () => void;
}) {
  return (
    <div className="dw-panel">
      <div className="dw-tab-intro">
        <span>
          <small>Controlled work · {active.workPackage.number}</small>
          <strong>{active.workPackage.title}</strong>
        </span>
        <em className={`dw-work-state status-${active.workPackage.status}`}>
          {active.workPackage.status.replace("_", " ")}
        </em>
      </div>
      <p className="dw-panel-description">
        Review source work orders, operating context, SME input, and field
        evidence before implementation.
      </p>
      <div className="dw-target">
        <Database size={16} />
        <span>
          <small>Target system</small>
          <strong>{active.workPackage.targetSystem}</strong>
        </span>
        <ArrowUpRight size={15} />
      </div>
      {active.workPackage.receipt && (
        <div className="dw-receipt">
          <CheckCircle2 size={16} />
          <span>
            <small>Connector receipt</small>
            <strong>{active.workPackage.receipt.externalId}</strong>
            <em>
              {active.workPackage.receipt.status} · last sync{" "}
              {timestamp(active.workPackage.receipt.lastSync)}
            </em>
          </span>
        </div>
      )}
      <div className="dw-controls">
        {active.workPackage.controls.map((item, index) => (
          <div key={item.id}>
            <span>
              {item.status === "complete" ? <Check size={13} /> : index + 1}
            </span>
            <p>
              <strong>{item.text}</strong>
              <small>{item.owner} owner</small>
            </p>
            <em>{item.status}</em>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="dw-primary"
        onClick={completeWork}
        disabled={
          active.workPackage.status === "locked" ||
          active.workPackage.status === "complete"
        }
      >
        <Play size={15} />
        {active.workPackage.status === "locked"
          ? "Authority approval required"
          : active.workPackage.status === "complete"
            ? "Work evidence complete"
            : "Record work complete"}
      </button>
    </div>
  );
}

function ValuePanel({
  active,
  verifyValue,
}: {
  active: DecisionCase;
  verifyValue: () => void;
}) {
  return (
    <div className="dw-panel">
      <div className="dw-tab-intro">
        <span>
          <small>Value proof</small>
          <strong>
            {active.financeStatus === "verified"
              ? "Value verified"
              : "Verification in progress"}
          </strong>
        </span>
        <Gauge size={19} />
      </div>
      <p className="dw-panel-description">
        Make the recommendation measurable before it becomes work. Track
        estimated, authorized, and verified value through execution.
      </p>
      <div className="dw-value-hero">
        <span>Value at stake</span>
        <strong>{formatDecisionValue(active.valueExposure)}</strong>
        <small>Finance-approved baseline</small>
      </div>
      <div className="dw-value-table">
        <div>
          <span>Measure</span>
          <span>Baseline</span>
          <span>Target</span>
          <span>Actual</span>
        </div>
        {active.valueMetrics.map((item) => (
          <div key={item.id}>
            <span>
              <strong>{item.label}</strong>
              <small>{item.detail}</small>
            </span>
            <span>{item.baseline}</span>
            <span>{item.target}</span>
            <span className={item.actual ? "verified" : "pending"}>
              {item.actual || "Pending"}
            </span>
          </div>
        ))}
      </div>
      <div className="dw-finance">
        <span>
          {active.financeSponsor
            .split(" ")
            .map((part) => part[0])
            .join("")}
        </span>
        <span>
          <small>Finance sponsor</small>
          <strong>{active.financeSponsor}</strong>
        </span>
        <em>{active.financeStatus.replace("_", " ")}</em>
      </div>
      {active.learningRecord && (
        <div className="dw-learning-record">
          <CheckCircle2 size={16} />
          <span>
            <small>{active.learningRecord.id} · retained learning</small>
            <strong>{active.learningRecord.summary}</strong>
          </span>
        </div>
      )}
      <button
        type="button"
        className="dw-primary"
        onClick={verifyValue}
        disabled={
          active.workPackage.status !== "complete" ||
          active.financeStatus === "verified"
        }
      >
        <CheckCircle2 size={15} />{" "}
        {active.financeStatus === "verified"
          ? "Value verified"
          : "Verify measured value"}
      </button>
    </div>
  );
}

function EvidenceModal({
  evidence,
  close,
}: {
  evidence: DecisionEvidence;
  close: () => void;
}) {
  return (
    <div className="dw-backdrop" role="presentation" onMouseDown={close}>
      <section
        className="dw-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`${evidence.title} evidence details`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <span className={`dw-evidence-icon quality-${evidence.quality}`}>
            <Database size={17} />
          </span>
          <span>
            <small>{evidence.state}</small>
            <h2>{evidence.title}</h2>
          </span>
          <button
            className="dw-icon"
            type="button"
            title="Close evidence"
            onClick={close}
          >
            <XCircle size={18} />
          </button>
        </header>
        <div className="dw-evidence-detail">
          <section>
            <span>Governed record</span>
            <strong>{evidence.record}</strong>
          </section>
          <section>
            <span>Finding</span>
            <p>{evidence.finding}</p>
          </section>
          <section>
            <span>Lineage</span>
            <p>{evidence.lineage}</p>
          </section>
          <section>
            <span>Source system</span>
            <p>{evidence.sourceSystem}</p>
          </section>
        </div>
        <footer>
          <ShieldCheck size={15} /> Source, transformation, and use are retained
          in the decision audit trail.
        </footer>
      </section>
    </div>
  );
}

function HistoryModal({
  active,
  publicMode,
  close,
}: {
  active: DecisionCase;
  publicMode: boolean;
  close: () => void;
}) {
  const events: Array<{ title: string; detail: string; at: string }> = [
    {
      title: "Decision Case created",
      detail: active.createdFromIntake
        ? "Created from the 48-hour value-proof intake."
        : "Created in the governed workspace.",
      at: active.messages[0]?.createdAt || active.updatedAt,
    },
    ...active.approvals
      .filter((item) => item.decidedAt)
      .map((item) => ({
        title: `${item.name}: ${approvalLabel(item.status)}`,
        detail: `${item.role} · ${item.responsibility}`,
        at: item.decidedAt!,
      })),
    ...(active.workPackage.receipt
      ? [
          {
            title: `Work package ${active.workPackage.receipt.status}`,
            detail: `${active.workPackage.receipt.externalId} · ${active.workPackage.targetSystem}`,
            at: active.workPackage.receipt.releasedAt,
          },
        ]
      : []),
    ...(active.learningRecord
      ? [
          {
            title: "Learning retained",
            detail: active.learningRecord.summary,
            at: active.updatedAt,
          },
        ]
      : []),
  ];
  return (
    <div className="dw-backdrop" role="presentation" onMouseDown={close}>
      <section
        className="dw-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`${active.caseNumber} version and audit history`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <span className="dw-evidence-icon">
            <History size={17} />
          </span>
          <span>
            <small>Immutable decision history</small>
            <h2>
              {active.caseNumber} · {active.version}
            </h2>
          </span>
          <button
            className="dw-icon"
            type="button"
            title="Close"
            onClick={close}
          >
            <XCircle size={18} />
          </button>
        </header>
        {publicMode && (
          <p className="dw-history-boundary">
            Demonstration audit trail. Simulated dispositions are never treated
            as production authorization.
          </p>
        )}
        <div className="dw-history-list">
          {events.map((item, index) => (
            <div key={`${item.title}-${item.at}-${index}`}>
              <Clock3 size={14} />
              <span>
                <strong>{item.title}</strong>
                <p>{item.detail}</p>
                <small>
                  {new Intl.DateTimeFormat("en-US", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(item.at))}
                </small>
              </span>
            </div>
          ))}
        </div>
        <footer>
          <ShieldCheck size={15} /> Packet versions, authority dispositions,
          connector receipts, and measured outcomes remain case-scoped.
        </footer>
      </section>
    </div>
  );
}

function UsageModal({
  publicMode,
  proofComplete,
  close,
  onSecure,
  choose,
}: {
  publicMode: boolean;
  proofComplete: boolean;
  close: () => void;
  onSecure: () => void;
  choose: (mode: DecisionCase["billingMode"], allowance?: number) => void;
}) {
  if (publicMode) {
    return (
      <div className="dw-backdrop" role="presentation" onMouseDown={close}>
        <section
          className="dw-modal dw-usage-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Secure the value proof workspace"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <header>
            <span className="dw-evidence-icon">
              <ShieldCheck size={17} />
            </span>
            <span>
              <small>
                {proofComplete
                  ? "Value loop complete"
                  : "Move from proof to production"}
              </small>
              <h2>
                {proofComplete
                  ? "You proved the loop. Keep the decision working."
                  : "Secure this Decision Case when you are ready"}
              </h2>
            </span>
            <button
              className="dw-icon"
              type="button"
              title="Close"
              onClick={close}
            >
              <XCircle size={18} />
            </button>
          </header>
          <p>
            The complete public value proof remains available. Secure a
            tenant-isolated workspace when you are ready to use customer data,
            connect operating systems, invite authorities, and retain the
            auditable record.
          </p>
          <div className="dw-continuation">
            <a href="/setup#value-proof-intake" onClick={onSecure}>
              <Sparkles size={18} />
              <strong>Start the 48-hour proof</strong>
              <small>Apply this workflow to sanitized customer evidence.</small>
              <em>Recommended next step</em>
            </a>
            <a href="/signin?returnTo=%2F" onClick={onSecure}>
              <LockKeyhole size={18} />
              <strong>Sign in and retain it</strong>
              <small>Move the case into a governed company workspace.</small>
              <em>For existing teams</em>
            </a>
            <button type="button" onClick={close}>
              <Play size={18} />
              <strong>Keep exploring</strong>
              <small>
                Continue the full demo without entering payment details.
              </small>
              <em>No paywall yet</em>
            </button>
          </div>
          <footer>
            <ShieldCheck size={14} /> Production access adds security,
            persistence, collaboration, and integrations, not a smarter demo.
          </footer>
        </section>
      </div>
    );
  }

  return (
    <div className="dw-backdrop" role="presentation" onMouseDown={close}>
      <section
        className="dw-modal dw-usage-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Value proof continuation"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <span className="dw-evidence-icon">
            <Sparkles size={17} />
          </span>
          <span>
            <small>Value proof continuation</small>
            <h2>Keep the Decision Case working</h2>
          </span>
          <button
            className="dw-icon"
            type="button"
            title="Close"
            onClick={close}
          >
            <XCircle size={18} />
          </button>
        </header>
        <p>
          Complimentary decision analysis is sized to reach a real
          recommendation and authority gate. Your case, evidence, and audit
          history remain intact.
        </p>
        <div className="dw-continuation">
          <button type="button" onClick={() => choose("pay_per_use", 52000)}>
            <Gauge size={18} />
            <strong>Pay per use</strong>
            <small>Continue only the agents this workflow needs.</small>
            <em>Best for one decision</em>
          </button>
          <button type="button" onClick={() => choose("workspace", 250000)}>
            <Users size={18} />
            <strong>Team workspace</strong>
            <small>
              Shared cases, approvals, integrations, and governance.
            </small>
            <em>Best for ongoing work</em>
          </button>
          <button type="button" onClick={() => choose("paused")}>
            <Clock3 size={18} />
            <strong>Pause safely</strong>
            <small>Preserve the complete case and resume later.</small>
            <em>No data loss</em>
          </button>
        </div>
        <footer>
          <LockKeyhole size={14} /> No charge is created in this preview.
          Commercial confirmation remains explicit.
        </footer>
      </section>
    </div>
  );
}
