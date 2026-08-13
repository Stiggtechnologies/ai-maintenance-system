import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowUpRight,
  Bot,
  Calculator,
  Check,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  Clock3,
  Database,
  FileText,
  Gauge,
  History,
  Layers3,
  LockKeyhole,
  MessageSquare,
  Play,
  Plus,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Target,
  TriangleAlert,
  UserRound,
  Users,
  Workflow,
  XCircle,
} from "lucide-react";
import { PublicProductHeader } from "../components/PublicProductHeader";
import {
  DECISION_CASE_STAGES,
  PUBLIC_DECISION_CASE_STORAGE_KEY,
  createDraftDecisionCase,
  createSeedDecisionCases,
  formatDecisionValue,
  readDecisionCases,
  stageDecisionCaseHandoff,
  writeDecisionCases,
  type ApprovalStatus,
  type DecisionCase,
  type DecisionEvidence,
  type DecisionJourneyContext,
} from "../lib/decision-case";
import {
  askDecisionCase,
  createPersistedDecisionCase,
  isPersistedDecisionCase,
  loadPersistedDecisionCase,
  savePersistedDecisionCase,
} from "../services/decisionCaseService";
import "./DecisionCaseWorkspacePage.css";

type PacketTab = "decision" | "evidence" | "authority" | "work" | "value";
type MobileView = "cases" | "case" | "packet" | "gate";

const tabs: Array<{ id: PacketTab; label: string }> = [
  { id: "decision", label: "Decision" },
  { id: "evidence", label: "Evidence" },
  { id: "authority", label: "Authority" },
  { id: "work", label: "Work" },
  { id: "value", label: "Value" },
];
const roles = [
  "Reliability Engineer",
  "Maintenance Manager",
  "Operations Authority",
  "Executive / finance sponsor",
];

function getContext(params: URLSearchParams): DecisionJourneyContext {
  return {
    asset: params.get("asset") || undefined,
    pain: params.get("pain") || undefined,
    role: params.get("role") || undefined,
    company: params.get("company") || undefined,
    system: params.get("system") || undefined,
    intakeId: params.get("intake") || undefined,
  };
}

function initialCases(
  routeId: string | undefined,
  context: DecisionJourneyContext,
  publicMode: boolean,
): DecisionCase[] {
  const storage = publicMode ? window.sessionStorage : window.localStorage;
  const storageKey = publicMode ? PUBLIC_DECISION_CASE_STORAGE_KEY : undefined;
  const seededContext =
    publicMode && !context.intakeId
      ? { ...context, intakeId: "demo-value-proof" }
      : context;
  const saved = readDecisionCases(storage, seededContext, storageKey);
  if (
    !routeId ||
    routeId === "demo" ||
    saved.some((item) => item.id === routeId)
  ) {
    return saved;
  }
  const personalized = createSeedDecisionCases(context)[0];
  personalized.id = routeId;
  personalized.caseNumber = `VP-${routeId.slice(-6).toUpperCase()}`;
  return [personalized, ...saved];
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
  const [cases, setCases] = useState(() =>
    initialCases(caseId, context, publicMode),
  );
  const [selectedId, setSelectedId] = useState(
    caseId && caseId !== "demo" ? caseId : cases[0].id,
  );
  const [portfolio, setPortfolio] = useState(false);
  const [tab, setTab] = useState<PacketTab>("decision");
  const [mobileView, setMobileView] = useState<MobileView>("case");
  const [role, setRole] = useState(context.role || roles[0]);
  const [composer, setComposer] = useState("");
  const [comment, setComment] = useState("");
  const [replying, setReplying] = useState(false);
  const [evidence, setEvidence] = useState<DecisionEvidence | null>(null);
  const [usageOpen, setUsageOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const active = cases.find((item) => item.id === selectedId) || cases[0];
  const activeId = active.id;

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
      publicMode ? PUBLIC_DECISION_CASE_STORAGE_KEY : undefined,
    );
  }, [cases, publicMode]);
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

  const chooseCase = (id: string) => {
    setSelectedId(id);
    setPortfolio(false);
    setTab("decision");
    setEvidence(null);
    setMobileView("case");
  };

  const createCase = async () => {
    const existingDraft = cases.find((item) => item.id.startsWith("draft-"));
    if (existingDraft) {
      chooseCase(existingDraft.id);
      setNotice(
        "Your existing draft is open. Drafts carry no portfolio exposure.",
      );
      return;
    }
    const next = createDraftDecisionCase(role);
    setCases((current) => [next, ...current]);
    setSelectedId(next.id);
    setPortfolio(false);
    setNotice("New Decision Case created.");
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

  const sendMessage = async (suggestion?: string) => {
    const text = (suggestion || composer).trim();
    if (!text || replying) return;
    if (
      active.billingMode === "paused" ||
      (active.billingMode === "complimentary" &&
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
    setReplying(true);
    try {
      const response = await askDecisionCase(requestCase, text);
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

  const decide = (status: ApprovalStatus) => {
    const approved = status === "approved";
    const decidedAt = new Date().toISOString();
    updateCase((current) => ({
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
          role: "system",
          author: publicMode ? "Demo simulation" : role,
          text: approved
            ? publicMode
              ? `Simulated the controlled approval. A demo connector receipt was generated for ${current.workPackage.number}; no production system was changed.`
              : `Approved the controlled evidence plan. ${current.workPackage.number} is released to ${current.workPackage.targetSystem}.`
            : `${approvalLabel(status)} at the technical authority gate. The disposition is retained in this case.`,
          createdAt: decidedAt,
          meta: publicMode
            ? "Simulated disposition · no production work released"
            : "Auditable authority disposition",
        },
      ],
    }));
    setNotice(
      approved
        ? publicMode
          ? `${active.workPackage.number} simulated release completed.`
          : `${active.workPackage.number} released with approved controls.`
        : "Authority disposition recorded.",
    );
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

  const governedCases = cases.filter((item) => item.valueExposure > 0);
  const totalExposure = governedCases.reduce(
    (sum, item) => sum + item.valueExposure,
    0,
  );
  const awaitingAuthority = governedCases.filter(
    (item) => item.stage === "authority",
  ).length;
  const awaitingValue = governedCases.filter(
    (item) => item.stage === "outcomes",
  ).length;
  const usagePercent = Math.min(
    100,
    Math.round((active.tokensUsed / active.tokenAllowance) * 100),
  );
  const complimentaryRemainingPercent = Math.max(0, 100 - usagePercent);
  const currentStage = DECISION_CASE_STAGES.findIndex(
    (item) => item.id === active.stage,
  );
  const authority = active.approvals.find(
    (item) => item.status === "reviewing",
  );

  const workspace = (
    <div className={`decision-workspace ${publicMode ? "is-public" : ""}`}>
      <header className="dw-topbar">
        <div className="dw-identity">
          <span className="dw-mark">
            <Workflow size={17} />
          </span>
          <span>
            <strong>Decision Workspace</strong>
            <small>Spend · risk · action · verified value</small>
          </span>
        </div>
        <div className="dw-context" aria-label="Organization and site context">
          <strong>{active.organization}</strong>
          <span>/</span>
          <span>{active.site}</span>
          <span>/</span>
          <b>{active.caseNumber}</b>
        </div>
        <div className="dw-top-actions">
          <span className="dw-system">
            <i /> {publicMode ? "Isolated demo session" : "Systems governed"}
          </span>
          <label className="dw-role">
            <Users size={15} />
            <select
              value={role}
              onChange={(event) => setRole(event.target.value)}
              aria-label="Working perspective"
              title="Changes the workspace perspective; it does not grant approval authority."
            >
              {roles.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
            <ChevronDown size={14} />
          </label>
          <button
            className="dw-icon"
            type="button"
            title="Case history"
            onClick={() => setHistoryOpen(true)}
          >
            <History size={17} />
          </button>
        </div>
      </header>

      <div className="dw-layout">
        <aside
          className={`dw-rail ${mobileView === "cases" ? "mobile-active" : ""}`}
        >
          <button
            type="button"
            className="dw-new"
            onClick={() => void createCase()}
          >
            <Plus size={16} /> New Decision Case
          </button>
          <button
            type="button"
            className={`dw-portfolio-button ${portfolio ? "active" : ""}`}
            onClick={() => setPortfolio((value) => !value)}
          >
            <Target size={16} />
            <span>
              <strong>Decision portfolio</strong>
              <small>
                {formatDecisionValue(totalExposure)} governed exposure
              </small>
            </span>
          </button>
          <div className="dw-section-label">
            Active cases <span>{governedCases.length}</span>
          </div>
          <div className="dw-case-list">
            {cases.map((item) => (
              <button
                type="button"
                key={item.id}
                className={`dw-case-row ${item.id === active.id ? "active" : ""}`}
                onClick={() => chooseCase(item.id)}
              >
                <i className={`risk-${item.risk}`} />
                <span>
                  <strong>{item.asset}</strong>
                  <small>{item.statusLabel}</small>
                </span>
                <em>{formatDecisionValue(item.valueExposure)}</em>
              </button>
            ))}
          </div>
          <div className="dw-rail-links">
            <button
              type="button"
              onClick={() => {
                setTab("evidence");
                setMobileView("packet");
              }}
            >
              <Database size={15} /> Evidence library
            </button>
            <button
              type="button"
              onClick={() => {
                setTab("evidence");
                setMobileView("packet");
                setNotice(
                  "Asset context is linked to each governed evidence record.",
                );
              }}
            >
              <Layers3 size={15} /> Asset context
            </button>
            <button type="button" onClick={() => setHistoryOpen(true)}>
              <ClipboardCheck size={15} /> Decision history
            </button>
          </div>
          <div className="dw-usage">
            <div>
              <span>
                {active.billingMode === "complimentary"
                  ? "Complimentary analysis"
                  : "Decision analysis"}
              </span>
              <strong>
                {active.billingMode === "complimentary"
                  ? `${complimentaryRemainingPercent}% left`
                  : `${usagePercent}% used`}
              </strong>
            </div>
            <div
              className="dw-usage-track"
              role="progressbar"
              aria-label="Decision analysis capacity used"
              aria-valuenow={usagePercent}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <span style={{ width: `${usagePercent}%` }} />
            </div>
            <small>
              {active.billingMode === "complimentary"
                ? "Sized to reach a recommendation and authority gate."
                : "Metered and retained with this Decision Case."}
            </small>
            <button type="button" onClick={() => setUsageOpen(true)}>
              Continue analysis <ArrowUpRight size={13} />
            </button>
          </div>
        </aside>

        <main
          className={`dw-main ${mobileView === "case" ? "mobile-active" : ""}`}
        >
          {portfolio ? (
            <section className="dw-portfolio">
              <span className="dw-kicker">
                <Target size={14} /> Ranked decision portfolio
              </span>
              <h1>Know where the next reliability dollar should go.</h1>
              <p>
                Rank assets, sites, and failure modes by consequence, evidence
                readiness, authority state, and value that can be verified.
              </p>
              <div className="dw-summary">
                <div>
                  <span>Governed exposure</span>
                  <strong>{formatDecisionValue(totalExposure)}</strong>
                </div>
                <div>
                  <span>Awaiting authority</span>
                  <strong>
                    {awaitingAuthority} case{awaitingAuthority === 1 ? "" : "s"}
                  </strong>
                </div>
                <div>
                  <span>Value verification</span>
                  <strong>
                    {awaitingValue} case{awaitingValue === 1 ? "" : "s"}
                  </strong>
                </div>
              </div>
              <div className="dw-ranked">
                {[...governedCases]
                  .sort((a, b) => b.valueExposure - a.valueExposure)
                  .map((item, index) => (
                    <button
                      type="button"
                      key={item.id}
                      onClick={() => chooseCase(item.id)}
                    >
                      <em>{String(index + 1).padStart(2, "0")}</em>
                      <span>
                        <strong>{item.title}</strong>
                        <small>{item.priorityReason}</small>
                      </span>
                      <span>
                        <strong>
                          {formatDecisionValue(item.valueExposure)}
                        </strong>
                        <small>{item.evidenceScore}% evidence</small>
                      </span>
                      <ArrowUpRight size={17} />
                    </button>
                  ))}
              </div>
            </section>
          ) : (
            <>
              <section className="dw-case-header">
                <div className="dw-case-meta">
                  <span>{active.caseNumber}</span>
                  <span>{active.version}</span>
                  <span className={`risk-${active.risk}`}>
                    {active.risk} risk
                  </span>
                  <span>{active.statusLabel}</span>
                </div>
                {publicMode && (
                  <div className="dw-case-promise">
                    <Target size={13} />
                    <strong>
                      Know where the next reliability dollar should go.
                    </strong>
                    <span>Spend · risk · action · verified value</span>
                  </div>
                )}
                <h1>{active.title}</h1>
                <p>{active.objective}</p>
                <div className="dw-stages" aria-label="Decision lifecycle">
                  {DECISION_CASE_STAGES.map((stage, index) => (
                    <div
                      key={stage.id}
                      className={
                        index < currentStage
                          ? "complete"
                          : index === currentStage
                            ? "current"
                            : ""
                      }
                    >
                      <span>
                        {index < currentStage ? <Check size={11} /> : index + 1}
                      </span>
                      <small>{stage.label}</small>
                    </div>
                  ))}
                </div>
              </section>
              {active.createdFromIntake && (
                <div className="dw-handoff">
                  <Sparkles size={16} />
                  <span>
                    <strong>
                      {publicMode
                        ? "One-click onboarding preview"
                        : "Your value-proof intake is already working."}
                    </strong>
                    <small>
                      {publicMode
                        ? "One intake generated the workspace shell, evidence checklist, role context, approval gates, and first analysis queue shown here."
                        : "Asset scope, sponsor outcome, system of record, and first evidence requirements were carried into this case."}
                    </small>
                  </span>
                  <CheckCircle2 size={18} />
                </div>
              )}
              {publicMode && (
                <div className="dw-demo-boundary">
                  <ShieldCheck size={15} />
                  <span className="dw-demo-long">
                    Interactive demonstration · use sanitized, non-sensitive
                    context only · data is isolated to this browser tab ·
                    approvals and connector receipts are simulated
                  </span>
                  <span className="dw-demo-short">
                    Sanitized context only · approvals and connector receipts
                    are simulated
                  </span>
                </div>
              )}
              <section
                className="dw-thread"
                aria-label="Decision case conversation"
              >
                <div className="dw-thread-intro">
                  <span>
                    <MessageSquare size={15} />
                  </span>
                  <div>
                    <strong>Decision Thread</strong>
                    <small>
                      The question, evidence, recommendation, approval gate,
                      controlled work, and value trail stay together.
                    </small>
                  </div>
                </div>
                {active.messages.map((message) => (
                  <article
                    key={message.id}
                    className={`dw-message role-${message.role}`}
                  >
                    <span className="dw-avatar">
                      {message.role === "assistant" ? (
                        <Bot size={16} />
                      ) : message.role === "system" ? (
                        <ShieldCheck size={16} />
                      ) : (
                        <UserRound size={16} />
                      )}
                    </span>
                    <div>
                      <header>
                        <strong>{message.author}</strong>
                        <span>{timestamp(message.createdAt)}</span>
                      </header>
                      <p>{message.text}</p>
                      {message.meta && <footer>{message.meta}</footer>}
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
                      <p className="dw-thinking">
                        <i />
                        <i />
                        <i /> Reviewing evidence and authority boundary
                      </p>
                    </div>
                  </article>
                )}
                <div ref={endRef} />
              </section>
              <section className="dw-composer-wrap" id="syncai-chat">
                <div className="dw-quick">
                  <button
                    type="button"
                    onClick={() =>
                      void sendMessage(
                        "What evidence is still missing, and what does it block?",
                      )
                    }
                  >
                    Evidence gaps
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void sendMessage(
                        "Where should the next dollar go and how will we verify value?",
                      )
                    }
                  >
                    Next dollar
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setTab("authority");
                      setMobileView("gate");
                    }}
                  >
                    Review authority gate
                  </button>
                </div>
                <div className="dw-composer">
                  <textarea
                    value={composer}
                    onChange={(event) => setComposer(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        void sendMessage();
                      }
                    }}
                    placeholder={`Ask about ${active.asset}, the evidence, risk, or approval boundary...`}
                    rows={2}
                  />
                  <button
                    type="button"
                    title="Send message"
                    disabled={!composer.trim() || replying}
                    onClick={() => void sendMessage()}
                  >
                    <Send size={17} />
                  </button>
                </div>
                <div className="dw-composer-meta">
                  <span>
                    <LockKeyhole size={12} /> Governed sources only
                  </span>
                  <span>Human authority remains in control</span>
                </div>
              </section>
            </>
          )}
        </main>

        <aside
          className={`dw-packet ${mobileView === "packet" || mobileView === "gate" ? "mobile-active" : ""}`}
        >
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
                openAuthority={() => setTab("authority")}
              />
            )}
            {tab === "evidence" && (
              <EvidencePanel active={active} setEvidence={setEvidence} />
            )}
            {tab === "authority" && (
              <AuthorityPanel
                active={active}
                authority={authority}
                role={role}
                comment={comment}
                setComment={setComment}
                addComment={addComment}
                decide={decide}
                publicMode={publicMode}
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
      </div>

      <nav className="dw-mobile-nav" aria-label="Workspace views">
        <button
          type="button"
          className={mobileView === "cases" ? "active" : ""}
          onClick={() => setMobileView("cases")}
        >
          <Layers3 size={17} />
          <span>Cases</span>
        </button>
        <button
          type="button"
          className={mobileView === "case" ? "active" : ""}
          onClick={() => setMobileView("case")}
        >
          <MessageSquare size={17} />
          <span>Case</span>
        </button>
        <button
          type="button"
          className={mobileView === "packet" ? "active" : ""}
          onClick={() => {
            setTab("decision");
            setMobileView("packet");
          }}
        >
          <FileText size={17} />
          <span>Packet</span>
        </button>
        <button
          type="button"
          className={mobileView === "gate" ? "active" : ""}
          onClick={() => {
            setTab("authority");
            setMobileView("gate");
          }}
        >
          <ShieldCheck size={17} />
          <span>Gate</span>
        </button>
      </nav>

      {evidence && (
        <EvidenceModal evidence={evidence} close={() => setEvidence(null)} />
      )}
      {usageOpen && (
        <UsageModal
          close={() => setUsageOpen(false)}
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
  return publicMode ? (
    <div className="dw-public">
      <PublicProductHeader
        active="copilot"
        signInHref="/signin?returnTo=%2F"
        onSignIn={() => stageDecisionCaseHandoff(window.sessionStorage, active)}
      />
      {workspace}
    </div>
  ) : (
    workspace
  );
}

function DecisionPanel({
  active,
  setEvidence,
  openAuthority,
}: {
  active: DecisionCase;
  setEvidence: (value: DecisionEvidence) => void;
  openAuthority: () => void;
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
        <button type="button" onClick={openAuthority}>
          Open gate <ArrowUpRight size={14} />
        </button>
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
  role,
  comment,
  setComment,
  addComment,
  decide,
  publicMode,
}: {
  active: DecisionCase;
  authority: DecisionCase["approvals"][number] | undefined;
  role: string;
  comment: string;
  setComment: (value: string) => void;
  addComment: () => void;
  decide: (status: ApprovalStatus) => void;
  publicMode: boolean;
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
          <section className="dw-gate">
            <span>
              {publicMode
                ? `Simulation preview from the ${role} perspective. This does not grant authority.`
                : `Your disposition as ${role}`}
            </span>
            <button
              type="button"
              className="primary"
              onClick={() => decide("approved")}
            >
              <CheckCircle2 size={15} />{" "}
              {publicMode
                ? "Simulate controlled approval"
                : "Approve controlled plan"}
            </button>
            <div>
              <button type="button" onClick={() => decide("changes_requested")}>
                {publicMode ? "Simulate changes" : "Request changes"}
              </button>
              <button type="button" onClick={() => decide("delegated")}>
                {publicMode ? "Simulate delegate" : "Delegate"}
              </button>
              <button type="button" onClick={() => decide("rejected")}>
                {publicMode ? "Simulate reject" : "Reject"}
              </button>
            </div>
          </section>
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
  close,
  choose,
}: {
  close: () => void;
  choose: (mode: DecisionCase["billingMode"], allowance?: number) => void;
}) {
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
