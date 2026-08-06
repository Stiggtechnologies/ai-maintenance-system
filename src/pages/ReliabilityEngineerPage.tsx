import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowRight,
  BarChart3,
  BookOpenText,
  BrainCircuit,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleStop,
  Clipboard,
  Clock3,
  Cpu,
  Database,
  FileSearch,
  History,
  PanelRight,
  LockKeyhole,
  LogIn,
  Menu,
  MessageSquare,
  Mic,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Wrench,
  X,
} from "lucide-react";
import {
  PUBLIC_RELIABILITY_FREE_RUN_LIMIT,
  PUBLIC_RELIABILITY_SCENARIOS,
  generatePublicReliabilityAnalysis,
  getPublicReliabilityScenario,
  hasUsedPublicReliabilityFreeRun,
  readPublicReliabilityUsage,
  recordPublicReliabilityRun,
  type PublicReliabilityUsage,
  type PublicReliabilityResult,
  type PublicReliabilityScenario,
  type PublicReliabilityScenarioId,
} from "../lib/public-reliability";
import {
  runPublicReliabilityAgent,
  type PublicExpertResult,
} from "../services/publicReliabilityAgent";

const MAX_PROMPT_LENGTH = 1600;

const RUN_STAGES = [
  { label: "Interpreting asset context", tool: "Evidence parser" },
  { label: "Checking available evidence", tool: "Evidence quality" },
  { label: "Evaluating supported calculations", tool: "RAM calculator" },
  { label: "Building testable hypotheses", tool: "RCA reasoning" },
  { label: "Checking evidence and approval gates", tool: "Governance policy" },
  { label: "Composing the decision packet", tool: "Report builder" },
];

type AgentState = "idle" | "running" | "stopped" | "complete";
type ArtifactTab = "summary" | "evidence" | "governance";
type Feedback = "positive" | "negative" | null;
type GateAction = "attachment" | "export" | "followup" | "voice" | "workflow";

function readUsageSafely(): PublicReliabilityUsage | null {
  try {
    return readPublicReliabilityUsage(window.localStorage);
  } catch {
    return null;
  }
}

function formatNumber(value: number, digits = 1): string {
  return new Intl.NumberFormat("en-CA", {
    maximumFractionDigits: digits,
  }).format(value);
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

interface ReliabilityEngineerPageProps {
  onSignup: () => void;
  onSignIn: () => void;
}

export function ReliabilityEngineerPage({
  onSignup,
  onSignIn,
}: ReliabilityEngineerPageProps) {
  const [initialUsage] = useState(readUsageSafely);
  const initialScenarioId = initialUsage?.scenarioId ?? "open-question";
  const initialScenario = getPublicReliabilityScenario(initialScenarioId);
  const initialQuestion = initialUsage?.question ?? initialScenario.question;

  const [usage, setUsage] = useState<PublicReliabilityUsage | null>(initialUsage);
  const [scenarioId, setScenarioId] =
    useState<PublicReliabilityScenarioId>(initialScenarioId);
  const [prompt, setPrompt] = useState(initialQuestion);
  const [submittedQuestion, setSubmittedQuestion] = useState<string | null>(
    initialUsage ? initialQuestion : null,
  );
  const [result, setResult] = useState<PublicReliabilityResult | null>(
    () =>
      initialUsage
        ? generatePublicReliabilityAnalysis(
            initialUsage.scenarioId,
            new Date(),
            initialQuestion,
          )
        : null,
  );
  const [expertResult, setExpertResult] = useState<PublicExpertResult | null>(
    initialUsage
      ? { status: "fallback", error: "Showing the saved deterministic analysis." }
      : null,
  );
  const [agentState, setAgentState] = useState<AgentState>(
    initialUsage ? "complete" : "idle",
  );
  const [activeStage, setActiveStage] = useState(0);
  const [artifactTab, setArtifactTab] = useState<ArtifactTab>("summary");
  const [artifactOpen, setArtifactOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [gateAction, setGateAction] = useState<GateAction | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [copied, setCopied] = useState(false);
  const recordRunRef = useRef(true);
  const generationRef = useRef(0);
  const messageEndRef = useRef<HTMLDivElement | null>(null);

  const scenario = useMemo(
    () => getPublicReliabilityScenario(scenarioId),
    [scenarioId],
  );
  const freeRunUsed = hasUsedPublicReliabilityFreeRun(usage);
  const isRunning = agentState === "running";

  useEffect(() => {
    if (!isRunning) return;

    const finalStage = activeStage === RUN_STAGES.length - 1;
    const timer = window.setTimeout(
      () => {
        if (!finalStage) {
          setActiveStage((current) => current + 1);
          return;
        }

        const question = submittedQuestion || scenario.question;
        const generation = generationRef.current;
        const completed = generatePublicReliabilityAnalysis(
          scenarioId,
          new Date(),
          question,
        );
        if (recordRunRef.current) {
          let nextUsage: PublicReliabilityUsage = {
            runCount: PUBLIC_RELIABILITY_FREE_RUN_LIMIT,
            scenarioId,
            completedAt: new Date().toISOString(),
            question,
          };
          try {
            nextUsage = recordPublicReliabilityRun(
              window.localStorage,
              scenarioId,
              new Date(),
              question,
            );
          } catch {
            // Browser storage can be disabled; the in-memory gate still applies.
          }
          setUsage(nextUsage);
        }
        void runPublicReliabilityAgent({ scenarioId, question }).then(
          (expert) => {
            if (generation !== generationRef.current) return;
            setExpertResult(expert);
            setResult(completed);
            setAgentState("complete");
            setArtifactTab("summary");
          },
        );
      },
      finalStage ? 440 : 320,
    );

    return () => window.clearTimeout(timer);
  }, [
    activeStage,
    isRunning,
    scenario.question,
    scenarioId,
    submittedQuestion,
  ]);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView?.({ block: "end" });
  }, [activeStage, agentState, result]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(timer);
  }, [copied]);

  useEffect(() => {
    if (!gateAction && !artifactOpen && !mobileNavOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setGateAction(null);
      setArtifactOpen(false);
      setMobileNavOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [artifactOpen, gateAction, mobileNavOpen]);

  const startGeneration = ({
    question,
    recordRun,
  }: {
    question: string;
    recordRun: boolean;
  }) => {
    const boundedQuestion =
      question.trim().slice(0, MAX_PROMPT_LENGTH) || scenario.question;
    recordRunRef.current = recordRun;
    generationRef.current += 1;
    setSubmittedQuestion(boundedQuestion);
    setPrompt(boundedQuestion);
    setResult(null);
    setExpertResult(null);
    setFeedback(null);
    setCopied(false);
    setActiveStage(0);
    setAgentState("running");
  };

  const handleSend = () => {
    if (freeRunUsed) {
      setGateAction("followup");
      return;
    }
    startGeneration({ question: prompt, recordRun: true });
  };

  const handleRegenerate = () => {
    startGeneration({
      question: submittedQuestion || prompt,
      recordRun: false,
    });
  };

  const handleRetry = () => {
    startGeneration({
      question: submittedQuestion || prompt,
      recordRun: !freeRunUsed,
    });
  };

  const handleStop = () => {
    generationRef.current += 1;
    setAgentState("stopped");
  };

  const handleNewConversation = () => {
    if (freeRunUsed) {
      setGateAction("followup");
      return;
    }
    setPrompt(scenario.question);
    setSubmittedQuestion(null);
    setResult(null);
    setAgentState("idle");
    setActiveStage(0);
    setMobileNavOpen(false);
  };

  const handleScenarioChange = (nextId: PublicReliabilityScenarioId) => {
    if (freeRunUsed) {
      setGateAction("followup");
      return;
    }
    const nextScenario = getPublicReliabilityScenario(nextId);
    setScenarioId(nextId);
    setPrompt(nextScenario.question);
    setSubmittedQuestion(null);
    setResult(null);
    setAgentState("idle");
    setMobileNavOpen(false);
  };

  const handleCopy = async () => {
    if (!result) return;
    const summary = [
      result.patternSummary,
      "",
      "Hypotheses to validate:",
      ...result.scenario.hypotheses.map(
        (item, index) => `${index + 1}. ${item.hypothesis}`,
      ),
      "",
      `Approval boundary: ${result.report.approvalBoundary[0]}`,
    ].join("\n");
    try {
      await navigator.clipboard.writeText(summary);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const openArtifact = (tab: ArtifactTab = "summary") => {
    setArtifactTab(tab);
    setArtifactOpen(true);
  };

  const sidebar = (
    <ConversationSidebar
      scenarioId={scenarioId}
      usage={usage}
      onNewConversation={handleNewConversation}
      onScenarioChange={handleScenarioChange}
      onClose={() => setMobileNavOpen(false)}
    />
  );

  return (
    <main className="h-screen overflow-hidden bg-[#090d12] text-industrial-text">
      <header className="flex h-16 items-center justify-between border-b border-white/7 bg-[#0b0f14] px-4 sm:px-6">
        <a
          href="/"
          className="flex items-center gap-3"
          aria-label="SyncAI home"
        >
          <span className="grid h-9 w-9 place-items-center rounded-lg border border-teal-400/25 bg-teal-400/8">
            <Activity size={18} className="text-teal-300" />
          </span>
          <span>
            <span className="block text-sm font-bold tracking-tight text-white">
              SyncAI
            </span>
            <span className="hidden text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 sm:block">
              Industrial Intelligence Infrastructure
            </span>
          </span>
        </a>

        <div className="hidden items-center gap-2 rounded-full border border-white/7 bg-white/[0.025] px-3 py-1.5 text-xs text-slate-400 md:flex">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          Live Reliability Engineer
          <span className="text-slate-700">·</span>
          Limited free access
        </div>

        <div className="flex items-center gap-2">
          <a
            href="/pilot/reliability"
            className="hidden rounded-lg px-3 py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-white/5 hover:text-white sm:inline-flex"
          >
            14-day pilot
          </a>
          <button
            type="button"
            onClick={onSignIn}
            className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm font-semibold text-slate-200 transition-colors hover:border-white/20 hover:bg-white/5"
          >
            <LogIn size={15} />
            Sign in
          </button>
        </div>
      </header>

      <div className="h-[calc(100vh-4rem)] p-2 sm:p-3">
        <div className="mx-auto grid h-full max-w-[1680px] overflow-hidden rounded-xl border border-white/7 bg-[#0d1218] shadow-[0_18px_60px_rgba(0,0,0,0.28)] lg:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)_420px]">
          <aside className="hidden min-h-0 border-r border-white/7 bg-[#0a0f15] lg:block">
            {sidebar}
          </aside>

          <section className="flex min-h-0 min-w-0 flex-col bg-[#0d1218]">
            <ChatHeader
              scenario={scenario}
              resultReady={Boolean(result)}
              onOpenMenu={() => setMobileNavOpen(true)}
              onOpenArtifact={() => openArtifact()}
            />

            <div
              className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8"
              aria-live="polite"
            >
              <div className="mx-auto max-w-3xl space-y-7">
                <WelcomeMessage
                  scenarioId={scenarioId}
                  onScenarioChange={handleScenarioChange}
                />

                {submittedQuestion ? (
                  <UserMessage
                    question={submittedQuestion}
                    scenario={scenario}
                  />
                ) : (
                  <PromptStarters
                    scenario={scenario}
                    onSelectPrompt={setPrompt}
                  />
                )}

                {agentState === "running" && (
                  <AgentThinking activeStage={activeStage} />
                )}

                {agentState === "stopped" && (
                  <StoppedMessage onRetry={handleRetry} />
                )}

                {result && agentState === "complete" && (
                  <ChatAnswer
                    result={result}
                    expertResult={expertResult}
                    copied={copied}
                    feedback={feedback}
                    onCopy={() => void handleCopy()}
                    onFeedback={setFeedback}
                    onOpenArtifact={openArtifact}
                    onRegenerate={handleRegenerate}
                  />
                )}
                <div ref={messageEndRef} />
              </div>
            </div>

            <ChatComposer
              prompt={prompt}
              scenario={scenario}
              isRunning={isRunning}
              freeRunUsed={freeRunUsed}
              onPromptChange={setPrompt}
              onSend={handleSend}
              onStop={handleStop}
              onLockedAction={setGateAction}
            />
          </section>

          <aside className="hidden min-h-0 border-l border-white/7 bg-[#0a0f15] xl:block">
            <ArtifactPanel
              result={result}
              expertResult={expertResult}
              isRunning={isRunning}
              activeStage={activeStage}
              activeTab={artifactTab}
              onTabChange={setArtifactTab}
              onLockedAction={setGateAction}
              onSignup={onSignup}
            />
          </aside>
        </div>
      </div>

      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close conversation menu"
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setMobileNavOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 w-[290px] border-r border-white/10 bg-[#0a0f15] shadow-2xl">
            {sidebar}
          </aside>
        </div>
      )}

      {artifactOpen && (
        <div className="fixed inset-0 z-50 xl:hidden">
          <button
            type="button"
            aria-label="Close decision packet"
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setArtifactOpen(false)}
          />
          <aside className="absolute inset-y-0 right-0 w-full max-w-[520px] border-l border-white/10 bg-[#0a0f15] shadow-2xl">
            <ArtifactPanel
              result={result}
              expertResult={expertResult}
              isRunning={isRunning}
              activeStage={activeStage}
              activeTab={artifactTab}
              onTabChange={setArtifactTab}
              onLockedAction={setGateAction}
              onSignup={onSignup}
              onClose={() => setArtifactOpen(false)}
            />
          </aside>
        </div>
      )}

      {gateAction && (
        <CapabilityGateDialog
          action={gateAction}
          onClose={() => setGateAction(null)}
          onSignup={onSignup}
        />
      )}
    </main>
  );
}

function ChatHeader({
  scenario,
  resultReady,
  onOpenMenu,
  onOpenArtifact,
}: {
  scenario: PublicReliabilityScenario;
  resultReady: boolean;
  onOpenMenu: () => void;
  onOpenArtifact: () => void;
}) {
  return (
    <div className="flex h-16 shrink-0 items-center justify-between border-b border-white/7 px-3 sm:px-5">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={onOpenMenu}
          aria-label="Open conversation menu"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-white/5 hover:text-white lg:hidden"
        >
          <Menu size={19} />
        </button>
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-teal-400/10 text-teal-300">
          <Wrench size={18} />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-sm font-semibold text-white">
              Reliability Engineer
            </h1>
            <span className="rounded-md border border-teal-400/20 bg-teal-400/8 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-teal-200">
              Advisory
            </span>
          </div>
          <p className="truncate text-xs text-slate-500">{scenario.asset}</p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="hidden items-center gap-1.5 text-[11px] text-slate-500 sm:flex">
          <span className="rounded-md bg-white/[0.035] px-2 py-1">
            Retrieve
          </span>
          <span>→</span>
          <span className="rounded-md bg-white/[0.035] px-2 py-1">
            Diagnose
          </span>
          <span>→</span>
          <span className="rounded-md bg-white/[0.035] px-2 py-1">Plan</span>
        </div>
        <button
          type="button"
          onClick={onOpenArtifact}
          className="relative inline-flex items-center gap-2 rounded-lg border border-white/8 px-3 py-2 text-xs font-semibold text-slate-300 transition-colors hover:bg-white/5 hover:text-white xl:hidden"
        >
          <PanelRight size={16} />
          <span className="hidden sm:inline">Decision packet</span>
          {resultReady && (
            <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-[#0d1218] bg-emerald-400" />
          )}
        </button>
      </div>
    </div>
  );
}

function ConversationSidebar({
  scenarioId,
  usage,
  onNewConversation,
  onScenarioChange,
  onClose,
}: {
  scenarioId: PublicReliabilityScenarioId;
  usage: PublicReliabilityUsage | null;
  onNewConversation: () => void;
  onScenarioChange: (id: PublicReliabilityScenarioId) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const filteredScenarios = PUBLIC_RELIABILITY_SCENARIOS.filter((scenario) =>
    `${scenario.label} ${scenario.asset}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-white/7 p-3">
        <button
          type="button"
          onClick={onNewConversation}
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-white/9 bg-white/[0.035] px-3 py-2.5 text-xs font-semibold text-slate-200 transition-colors hover:bg-white/[0.065]"
        >
          <Plus size={15} />
          New analysis
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close conversation menu"
          className="grid h-9 w-9 place-items-center rounded-lg text-slate-500 hover:bg-white/5 hover:text-white lg:hidden"
        >
          <X size={17} />
        </button>
      </div>

      <div className="p-3 pb-2">
        <label className="relative block">
          <Search
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-600"
          />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search analyses"
            placeholder="Search analyses"
            className="w-full rounded-lg border border-white/7 bg-black/20 py-2 pl-9 pr-3 text-xs text-slate-300 outline-hidden placeholder:text-slate-600 focus:border-teal-400/35"
          />
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        <div className="px-2 pb-2 pt-3 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-600">
          {usage ? "Recent" : "Reliability entry points"}
        </div>
        <div className="space-y-1">
          {filteredScenarios.map((scenario) => {
            const active = scenario.id === scenarioId;
            return (
              <button
                key={scenario.id}
                type="button"
                onClick={() => onScenarioChange(scenario.id)}
                className={`group w-full rounded-lg px-3 py-2.5 text-left transition-colors ${
                  active
                    ? "bg-white/[0.065] text-white"
                    : "text-slate-400 hover:bg-white/[0.035] hover:text-slate-200"
                }`}
              >
                <span className="flex items-center gap-2 text-xs font-semibold">
                  {active ? (
                    <MessageSquare size={14} className="text-teal-300" />
                  ) : (
                    <History size={14} className="text-slate-600" />
                  )}
                  <span className="truncate">{scenario.shortLabel}</span>
                </span>
                <span className="mt-1 block truncate pl-[22px] text-[10px] text-slate-600 group-hover:text-slate-500">
                  {scenario.signal}
                </span>
              </button>
            );
          })}
          {filteredScenarios.length === 0 && (
            <div className="px-3 py-6 text-center text-xs text-slate-600">
              No matching analyses
            </div>
          )}
        </div>

        <div className="mx-2 mt-5 rounded-lg border border-white/6 bg-white/[0.02] p-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
            <ShieldCheck size={14} className="text-teal-300" />
            Governed free access
          </div>
          <p className="mt-2 text-[10px] leading-4 text-slate-600">
            Live expert reasoning, approved reference cases, no tenant memory,
            and no operational execution.
          </p>
        </div>
      </div>

      <div className="border-t border-white/7 p-3">
        <div className="mb-3 flex items-center justify-between text-[10px] text-slate-500">
          <span>Anonymous analysis</span>
          <span>{usage ? "1 / 1 used" : "1 / 1 available"}</span>
        </div>
        <div className="mb-3 h-1 overflow-hidden rounded-full bg-white/5">
          <div className={`h-full bg-teal-400 ${usage ? "w-full" : "w-0"}`} />
        </div>
        <a
          href="/pilot/reliability"
          className="flex items-center justify-between rounded-lg bg-teal-400/8 px-3 py-2.5 text-xs font-semibold text-teal-200 transition-colors hover:bg-teal-400/12"
        >
          Start CAD $7.5K pilot
          <ArrowRight size={14} />
        </a>
      </div>
    </div>
  );
}

function WelcomeMessage({
  scenarioId,
  onScenarioChange,
}: {
  scenarioId: PublicReliabilityScenarioId;
  onScenarioChange: (id: PublicReliabilityScenarioId) => void;
}) {
  return (
    <div className="flex gap-3 sm:gap-4">
      <AgentAvatar />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-white">
            Reliability Engineer
          </span>
          <span className="text-[10px] text-slate-600">just now</span>
        </div>
        <div className="mt-2 text-[15px] leading-7 text-slate-300">
          <p>
            Bring me a repeat failure. I’ll rank the pattern, calculate the RAM
            baseline, separate facts from hypotheses, and build a validation
            plan with human approval boundaries.
          </p>
          <p className="mt-2 text-sm text-slate-500">
            Ask your own question or explore an approved reference case. No
            account is required for the included live assessment.
          </p>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          {PUBLIC_RELIABILITY_SCENARIOS.map((scenario) => (
            <button
              key={scenario.id}
              type="button"
              onClick={() => onScenarioChange(scenario.id)}
              className={`rounded-xl border p-3 text-left transition-colors ${
                scenario.id === scenarioId
                  ? "border-teal-400/35 bg-teal-400/8"
                  : "border-white/7 bg-white/[0.02] hover:border-white/14 hover:bg-white/[0.04]"
              }`}
            >
              <span className="block text-xs font-semibold text-slate-200">
                {scenario.shortLabel}
              </span>
              <span className="mt-1 block text-[10px] leading-4 text-slate-600">
                {scenario.signal}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function PromptStarters({
  scenario,
  onSelectPrompt,
}: {
  scenario: PublicReliabilityScenario;
  onSelectPrompt: (prompt: string) => void;
}) {
  const prompts = [
    scenario.question,
    `Build a 72-hour evidence plan for ${scenario.asset}.`,
    `Which maintenance change would be premature for ${scenario.asset}, and why?`,
  ];

  return (
    <div className="ml-0 sm:ml-12">
      <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-600">
        Suggested prompts
      </div>
      <div className="flex flex-wrap gap-2">
        {prompts.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => onSelectPrompt(item)}
            className="rounded-full border border-white/8 bg-white/[0.025] px-3 py-2 text-left text-xs text-slate-400 transition-colors hover:border-teal-400/25 hover:bg-teal-400/5 hover:text-slate-200"
          >
            {item}
          </button>
        ))}
      </div>
    </div>
  );
}

function UserMessage({
  question,
  scenario,
}: {
  question: string;
  scenario: PublicReliabilityScenario;
}) {
  return (
    <div className="flex justify-end gap-3">
      <div className="max-w-[88%] rounded-2xl rounded-tr-md border border-white/7 bg-[#18202a] px-4 py-3 text-sm leading-6 text-slate-200 sm:max-w-[78%]">
        <p>{question}</p>
        <div className="mt-3 flex flex-wrap gap-2 border-t border-white/6 pt-3 text-[10px] text-slate-500">
          <span className="inline-flex items-center gap-1.5 rounded-md bg-black/20 px-2 py-1">
            <Database size={11} />
            {scenario.hasReferenceData
              ? `${scenario.asset} reference-case history`
              : "User-described context"}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-md bg-black/20 px-2 py-1">
            <ShieldCheck size={11} />
            Advisory only
          </span>
        </div>
      </div>
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-700 text-[10px] font-bold text-slate-200">
        YOU
      </div>
    </div>
  );
}

function AgentThinking({ activeStage }: { activeStage: number }) {
  return (
    <div className="flex gap-3 sm:gap-4" aria-live="polite">
      <AgentAvatar active />
      <div className="min-w-0 flex-1 rounded-xl border border-white/7 bg-white/[0.02] p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
              <BrainCircuit size={15} className="text-teal-300" />
              Working through the reliability case
            </div>
            <p className="mt-1 text-xs text-slate-600">
              Calculations are deterministic; hypotheses remain
              validation-dependent.
            </p>
          </div>
          <span className="shrink-0 text-xs font-semibold tabular-nums text-teal-300">
            {activeStage + 1}/{RUN_STAGES.length}
          </span>
        </div>

        <div className="mt-4 h-1 overflow-hidden rounded-full bg-white/5">
          <div
            className="h-full rounded-full bg-teal-400 transition-[width] duration-300"
            style={{
              width: `${((activeStage + 1) / RUN_STAGES.length) * 100}%`,
            }}
          />
        </div>

        <div className="mt-4 space-y-2.5">
          {RUN_STAGES.map((stage, index) => {
            const complete = index < activeStage;
            const active = index === activeStage;
            return (
              <div
                key={stage.label}
                className={`flex items-center gap-3 text-xs ${
                  active || complete ? "text-slate-300" : "text-slate-700"
                }`}
              >
                <span
                  className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border ${
                    complete
                      ? "border-teal-400 bg-teal-400 text-[#091016]"
                      : active
                        ? "border-teal-400/55 bg-teal-400/8"
                        : "border-white/7"
                  }`}
                >
                  {complete ? <Check size={11} strokeWidth={3} /> : null}
                </span>
                <span className="min-w-0 flex-1 truncate">{stage.label}</span>
                <span
                  className={`hidden rounded-md px-2 py-1 text-[9px] sm:inline ${
                    active
                      ? "bg-teal-400/8 text-teal-300"
                      : "bg-white/[0.025] text-slate-600"
                  }`}
                >
                  {stage.tool}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function StoppedMessage({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex gap-3 sm:gap-4">
      <AgentAvatar />
      <div className="min-w-0 flex-1 rounded-xl border border-white/7 bg-white/[0.02] p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-300">
          <CircleStop size={15} />
          Generation stopped
        </div>
        <p className="mt-2 text-xs leading-5 text-slate-500">
          No public usage was consumed. Retry when you’re ready.
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 inline-flex items-center gap-2 rounded-lg border border-white/8 px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-white/5"
        >
          <RefreshCw size={13} />
          Retry analysis
        </button>
      </div>
    </div>
  );
}

function ChatAnswer({
  result,
  expertResult,
  copied,
  feedback,
  onCopy,
  onFeedback,
  onOpenArtifact,
  onRegenerate,
}: {
  result: PublicReliabilityResult;
  expertResult: PublicExpertResult | null;
  copied: boolean;
  feedback: Feedback;
  onCopy: () => void;
  onFeedback: (feedback: Feedback) => void;
  onOpenArtifact: (tab?: ArtifactTab) => void;
  onRegenerate: () => void;
}) {
  const { report, scenario } = result;
  const topActor = report.badActors[0];
  const expert = expertResult?.status === "success" ? expertResult.analysis : null;

  return (
    <div className="flex gap-3 sm:gap-4">
      <AgentAvatar />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-white">
            Reliability Engineer
          </span>
          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-400/8 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-300">
            <CheckCircle2 size={10} />
            Decision packet ready
          </span>
          <span className="rounded-md border border-white/7 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-400">
            {expert
              ? "Live production analysis"
              : scenario.hasReferenceData
                ? "Verified calculation mode"
                : "Evidence-gathering mode"}
          </span>
          {expertResult?.status === "success" && (
            <span className={`rounded-md border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${expertResult.knowledgeBaseUsed
              ? "border-teal-300/15 bg-teal-300/[0.045] text-teal-300"
              : "border-white/7 text-slate-500"
            }`}>
              {expertResult.knowledgeBaseUsed ? "RAG grounded" : "No KB match"}
            </span>
          )}
        </div>

        <div className="mt-3 text-sm leading-7 text-slate-300">
          <p>{expert?.executiveSummary ?? result.patternSummary}</p>
          <p className="mt-3">
            {expert?.bottomLine ?? "The strongest next move is not another component replacement. Preserve evidence, validate the operating mechanism, and route any permanent strategy change through the qualified approval boundary."}
          </p>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          {scenario.hasReferenceData ? (
            <>
              <AnswerMetric
                label="Top bad actor"
                value={topActor?.assetId ?? "—"}
                detail={`${topActor?.failures ?? 0} events`}
              />
              <AnswerMetric
                label="MTBF baseline"
                value={`${formatNumber(report.metrics.mtbf, 0)} h`}
                detail="Exposure to verify"
              />
              <AnswerMetric
                label="Availability"
                value={formatPercent(report.metrics.inherentAvailability)}
                detail={`MTTR ${formatNumber(report.metrics.mttr)} h`}
              />
            </>
          ) : (
            <>
              <AnswerMetric
                label="Evidence status"
                value="Context only"
                detail="No files or history attached"
              />
              <AnswerMetric
                label="Assessment confidence"
                value={expert?.confidence ?? "Pending"}
                detail="Recalculated as evidence is added"
              />
              <AnswerMetric
                label="Quantitative RAM"
                value="Not calculated"
                detail="Exposure and repair data required"
              />
            </>
          )}
        </div>

        <div className="mt-4 rounded-xl border border-white/7 bg-white/[0.02] p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs font-semibold text-slate-300">
              Leading hypotheses to validate
            </div>
            <span className="rounded-md bg-amber-300/8 px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-amber-200">
              Not root cause yet
            </span>
          </div>
          <div className="mt-3 space-y-3">
            {(expert?.hypotheses ?? scenario.hypotheses).slice(0, 2).map((item, index) => (
              <div
                key={item.hypothesis}
                className="flex gap-3 text-xs leading-5"
              >
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-teal-400/8 font-bold text-teal-300">
                  {index + 1}
                </span>
                <div>
                  <div className="font-semibold text-slate-300">
                    {item.hypothesis}
                  </div>
                  <div className="mt-0.5 text-slate-600">{("verification" in item) ? item.verification : item.validation}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={() => onOpenArtifact("summary")}
          className="mt-4 flex w-full items-center justify-between rounded-xl border border-teal-400/20 bg-teal-400/[0.055] px-4 py-3 text-left transition-colors hover:bg-teal-400/[0.085]"
        >
          <span>
            <span className="block text-xs font-semibold text-teal-100">
              Open the governed decision packet
            </span>
            <span className="mt-0.5 block text-[10px] text-teal-200/50">
              Hypotheses, evidence, actions, assumptions, and approvals
            </span>
          </span>
          <PanelRight size={17} className="text-teal-300" />
        </button>

        <div className="mt-4 flex flex-wrap items-center gap-1 border-t border-white/6 pt-3">
          <ToolbarButton
            label={copied ? "Copied" : "Copy answer"}
            icon={copied ? Check : Clipboard}
            active={copied}
            onClick={onCopy}
          />
          <ToolbarButton
            label="Good response"
            icon={ThumbsUp}
            active={feedback === "positive"}
            onClick={() =>
              onFeedback(feedback === "positive" ? null : "positive")
            }
          />
          <ToolbarButton
            label="Needs improvement"
            icon={ThumbsDown}
            active={feedback === "negative"}
            onClick={() =>
              onFeedback(feedback === "negative" ? null : "negative")
            }
          />
          <ToolbarButton
            label="Regenerate response"
            icon={RefreshCw}
            onClick={onRegenerate}
          />
          <button
            type="button"
            onClick={() => onOpenArtifact("evidence")}
            className="ml-auto inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[10px] font-semibold text-slate-500 hover:bg-white/5 hover:text-slate-300"
          >
            <BookOpenText size={13} />
            {report.sources.length || 1} sources
          </button>
        </div>
      </div>
    </div>
  );
}

function ChatComposer({
  prompt,
  scenario,
  isRunning,
  freeRunUsed,
  onPromptChange,
  onSend,
  onStop,
  onLockedAction,
}: {
  prompt: string;
  scenario: PublicReliabilityScenario;
  isRunning: boolean;
  freeRunUsed: boolean;
  onPromptChange: (prompt: string) => void;
  onSend: () => void;
  onStop: () => void;
  onLockedAction: (action: GateAction) => void;
}) {
  const [workflowOpen, setWorkflowOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 144)}px`;
  }, [prompt]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!isRunning) onSend();
    }
  };

  return (
    <div className="shrink-0 border-t border-white/7 bg-[#0d1218] px-3 pb-3 pt-3 sm:px-5 sm:pb-4">
      <div className="mx-auto max-w-3xl">
        {freeRunUsed && !isRunning ? (
          <button
            type="button"
            onClick={() => onLockedAction("followup")}
            className="flex w-full items-center justify-between rounded-xl border border-teal-400/20 bg-teal-400/[0.055] px-4 py-3.5 text-left transition-colors hover:bg-teal-400/[0.085]"
          >
            <span className="flex items-center gap-3">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-teal-400/10 text-teal-300">
                <LockKeyhole size={15} />
              </span>
              <span>
                <span className="block text-sm font-semibold text-white">
                  Continue with your own data
                </span>
                <span className="mt-0.5 block text-[10px] text-slate-500">
                  Ask follow-ups, attach files, save cases, and use tenant
                  knowledge
                </span>
              </span>
            </span>
            <ArrowRight size={17} className="text-teal-300" />
          </button>
        ) : (
          <div className="rounded-2xl border border-white/10 bg-[#121922] p-2 shadow-[0_10px_35px_rgba(0,0,0,0.22)] focus-within:border-teal-400/30">
            <div className="flex items-center gap-2 px-2 pb-1.5 pt-1">
              <span className="inline-flex items-center gap-1.5 rounded-md bg-teal-400/7 px-2 py-1 text-[10px] font-semibold text-teal-200">
                <Database size={11} />
                {scenario.asset}
              </span>
              <span className="text-[10px] text-slate-600">
                {scenario.hasReferenceData
                  ? "Approved reference data"
                  : "No files attached"}
              </span>
            </div>
            <textarea
              ref={textareaRef}
              value={prompt}
              onChange={(event) =>
                onPromptChange(event.target.value.slice(0, MAX_PROMPT_LENGTH))
              }
              onKeyDown={handleKeyDown}
              aria-keyshortcuts="Enter"
              rows={2}
              disabled={isRunning}
              aria-label="Ask the Reliability Engineer"
              placeholder="Ask about a repeat failure, RAM baseline, RCA, FRACAS, or maintenance strategy…"
              className="max-h-36 min-h-16 w-full resize-none bg-transparent px-2 py-2 text-sm leading-6 text-slate-200 outline-hidden placeholder:text-slate-600 disabled:opacity-60"
            />
            <div className="flex items-center justify-between gap-2 px-1 pb-1">
              <div className="flex items-center gap-1">
                <ComposerIconButton
                  label="Attach files (requires workspace)"
                  icon={Paperclip}
                  onClick={() => onLockedAction("attachment")}
                />
                <ComposerIconButton
                  label="Voice input (disabled in public mode)"
                  icon={Mic}
                  onClick={() => onLockedAction("voice")}
                />
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setWorkflowOpen((open) => !open)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[10px] font-semibold text-slate-400 hover:bg-white/5 hover:text-slate-200"
                    aria-expanded={workflowOpen}
                  >
                    <BrainCircuit size={14} />
                    RCA
                    <ChevronDown size={12} />
                  </button>
                  {workflowOpen && (
                    <div className="absolute bottom-10 left-0 z-20 w-44 rounded-xl border border-white/10 bg-[#151c25] p-1.5 shadow-2xl">
                      <button
                        type="button"
                        onClick={() => setWorkflowOpen(false)}
                        className="flex w-full items-center justify-between rounded-lg bg-white/[0.055] px-3 py-2 text-left text-xs font-semibold text-slate-200"
                      >
                        RCA
                        <Check size={13} className="text-teal-300" />
                      </button>
                      {["FRACAS", "FMEA", "RCM", "RAM"].map((workflow) => (
                        <button
                          key={workflow}
                          type="button"
                          onClick={() => {
                            setWorkflowOpen(false);
                            onLockedAction("workflow");
                          }}
                          className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs text-slate-500 hover:bg-white/[0.035] hover:text-slate-300"
                        >
                          {workflow}
                          <LockKeyhole size={11} />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="hidden text-[9px] tabular-nums text-slate-700 sm:inline">
                  {prompt.length}/{MAX_PROMPT_LENGTH}
                </span>
                {isRunning ? (
                  <button
                    type="button"
                    onClick={onStop}
                    className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-xs font-semibold text-slate-200 hover:bg-white/[0.07]"
                  >
                    <CircleStop size={14} />
                    Stop
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={onSend}
                    disabled={!prompt.trim()}
                    aria-label="Send message"
                    className="grid h-9 w-9 place-items-center rounded-lg bg-teal-500 text-white transition-colors hover:bg-teal-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-500"
                  >
                    <Send size={15} />
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
        <div className="mt-2 flex items-center justify-center gap-2 text-center text-[9px] leading-4 text-slate-700">
          <ShieldCheck size={11} />
          Free access is live but not tenant-isolated. Do not enter confidential
          or site-sensitive information; sign in before using company data.
        </div>
      </div>
    </div>
  );
}

function ArtifactPanel({
  result,
  expertResult,
  isRunning,
  activeStage,
  activeTab,
  onTabChange,
  onLockedAction,
  onSignup,
  onClose,
}: {
  result: PublicReliabilityResult | null;
  expertResult: PublicExpertResult | null;
  isRunning: boolean;
  activeStage: number;
  activeTab: ArtifactTab;
  onTabChange: (tab: ArtifactTab) => void;
  onLockedAction: (action: GateAction) => void;
  onSignup: () => void;
  onClose?: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-16 shrink-0 items-center justify-between border-b border-white/7 px-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <FileSearch size={16} className="text-teal-300" />
            Decision packet
          </div>
          <div className="mt-0.5 text-[10px] text-slate-600">
            Governed engineering artifact
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onLockedAction("export")}
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-2 text-[10px] font-semibold text-slate-500 hover:bg-white/5 hover:text-slate-300"
          >
            <LockKeyhole size={12} />
            Export
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close decision packet"
              className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-white/5 hover:text-white"
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      <div className="flex shrink-0 border-b border-white/7 px-2 pt-2">
        {(["summary", "evidence", "governance"] as ArtifactTab[]).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => onTabChange(tab)}
            className={`flex-1 border-b-2 px-2 py-2 text-[10px] font-bold uppercase tracking-[0.12em] transition-colors ${
              activeTab === tab
                ? "border-teal-400 text-teal-200"
                : "border-transparent text-slate-600 hover:text-slate-400"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {isRunning ? (
          <ArtifactLoading activeStage={activeStage} />
        ) : result ? (
          <>
            {activeTab === "summary" && <ArtifactSummary result={result} expertResult={expertResult} />}
            {activeTab === "evidence" && <ArtifactEvidence result={result} expertResult={expertResult} />}
            {activeTab === "governance" && (
              <ArtifactGovernance
                result={result}
                expertResult={expertResult}
              />
            )}
          </>
        ) : (
          <ArtifactEmpty />
        )}
      </div>

      {result && !isRunning && (
        <div className="shrink-0 border-t border-white/7 p-3">
          <button
            type="button"
            onClick={onSignup}
            className="flex w-full items-center justify-between rounded-lg bg-teal-500 px-3 py-3 text-left text-xs font-bold text-white transition-colors hover:bg-teal-400"
          >
            <span>
              <span className="block">Continue in a secure workspace</span>
              <span className="mt-0.5 block text-[9px] font-medium text-white/65">
                Files, memory, follow-ups, exports, approvals
              </span>
            </span>
            <ArrowRight size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

function ArtifactEmpty() {
  return (
    <div className="grid h-full min-h-[420px] place-items-center px-5 text-center">
      <div>
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-xl border border-white/7 bg-white/[0.025] text-slate-600">
          <PanelRight size={21} />
        </span>
        <h2 className="mt-4 text-sm font-semibold text-slate-300">
          Your decision packet will appear here
        </h2>
        <p className="mt-2 text-xs leading-5 text-slate-600">
          Run the analysis to populate calculations, hypotheses, evidence gaps,
          actions, and approval boundaries.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2 text-[9px] text-slate-600">
          {["RAM metrics", "RCA hypotheses", "Evidence", "Governance"].map(
            (item) => (
              <span
                key={item}
                className="rounded-md bg-white/[0.025] px-2 py-1"
              >
                {item}
              </span>
            ),
          )}
        </div>
      </div>
    </div>
  );
}

function ArtifactLoading({ activeStage }: { activeStage: number }) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-teal-400/15 bg-teal-400/[0.045] p-4">
        <div className="flex items-center gap-2 text-xs font-semibold text-teal-100">
          <BrainCircuit size={14} className="text-teal-300" />
          Building artifact
        </div>
        <p className="mt-2 text-[10px] leading-4 text-teal-100/50">
          {RUN_STAGES[activeStage]?.label}
        </p>
      </div>
      {[80, 100, 70, 92, 64].map((width, index) => (
        <div
          key={width + index}
          className="rounded-xl border border-white/6 p-4"
        >
          <div
            className="h-2.5 rounded bg-white/[0.055]"
            style={{ width: `${width}%` }}
          />
          <div className="mt-3 h-2 rounded bg-white/[0.03]" />
          <div
            className="mt-2 h-2 rounded bg-white/[0.03]"
            style={{ width: `${Math.max(width - 18, 40)}%` }}
          />
        </div>
      ))}
    </div>
  );
}

function ArtifactSummary({ result, expertResult }: { result: PublicReliabilityResult; expertResult: PublicExpertResult | null }) {
  const { report, scenario } = result;
  const topActor = report.badActors[0];
  const expert = expertResult?.status === "success" ? expertResult.analysis : null;

  return (
    <div className="space-y-4">
      <ArtifactStatus
        label={`${report.riskLevel} pattern risk`}
        confidence={report.confidence}
      />

      <ArtifactSection title="Pattern detected" icon={BarChart3}>
        <p className="text-xs leading-5 text-slate-400">
          {expert?.observedPattern ?? result.patternSummary}
        </p>
      </ArtifactSection>

      <div className="grid grid-cols-2 gap-2">
        <CompactMetric label="Top asset" value={topActor?.assetId ?? "—"} />
        <CompactMetric
          label="Downtime"
          value={`${formatNumber(report.dataSummary.totalDowntimeHours, 0)} h`}
        />
        <CompactMetric
          label="MTBF"
          value={`${formatNumber(report.metrics.mtbf, 0)} h`}
        />
        <CompactMetric
          label="Availability"
          value={formatPercent(report.metrics.inherentAvailability)}
        />
      </div>

      <ArtifactSection title="Hypotheses to validate" icon={BrainCircuit}>
        <div className="space-y-3">
          {(expert?.hypotheses ?? scenario.hypotheses).map((item, index) => (
            <div key={item.hypothesis} className="rounded-lg bg-black/20 p-3">
              <div className="flex gap-2 text-xs font-semibold text-slate-300">
                <span className="text-teal-300">{index + 1}.</span>
                {item.hypothesis}
              </div>
              <p className="mt-2 text-[10px] leading-4 text-slate-600">
                Validate: {("verification" in item) ? item.verification : item.validation}
              </p>
            </div>
          ))}
        </div>
      </ArtifactSection>

      <ArtifactSection title="Immediate containment" icon={Clock3}>
        <p className="text-xs leading-5 text-slate-400">
          {result.immediateContainment}
        </p>
      </ArtifactSection>

      {expert && (
        <ArtifactSection title="Financial impact boundary" icon={BarChart3}>
          <p className="text-xs leading-5 text-slate-400">{expert.financialImpact}</p>
        </ArtifactSection>
      )}
    </div>
  );
}

function ArtifactEvidence({ result, expertResult }: { result: PublicReliabilityResult; expertResult: PublicExpertResult | null }) {
  const { report } = result;
  const expert = expertResult?.status === "success" ? expertResult.analysis : null;
  return (
    <div className="space-y-4">
      <ArtifactSection title="Reference data summary" icon={Database}>
        <div className="grid grid-cols-2 gap-2">
          <SmallStat
            label="Records"
            value={String(report.dataSummary.recordCount)}
          />
          <SmallStat
            label="Assets"
            value={String(report.dataSummary.uniqueAssets)}
          />
          <SmallStat
            label="Repair time"
            value={`${formatNumber(report.dataSummary.totalRepairHours, 0)} h`}
          />
          <SmallStat
            label="Uncoded modes"
            value={String(report.dataSummary.uncodedFailureModes)}
          />
        </div>
      </ArtifactSection>

      <ArtifactSection title="Source grounding" icon={BookOpenText}>
        <div className="space-y-2">
          {expert?.citations.length ? (
            expert.citations.map((source, index) => (
              <div key={`${source.title}-${index}`} className="rounded-lg border border-white/6 bg-black/15 p-3">
                <div className="text-[10px] font-semibold text-slate-300">{source.title} · {source.pageRange}</div>
              </div>
            ))
          ) : report.sources.length ? (
            report.sources.map((source, index) => (
              <div
                key={source.id}
                className="rounded-lg border border-white/6 bg-black/15 p-3"
              >
                <div className="flex items-start gap-2">
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded bg-teal-400/8 text-[9px] font-bold text-teal-300">
                    {index + 1}
                  </span>
                  <div>
                    <div className="text-[10px] font-semibold text-slate-300">
                      {source.source} · {source.pageRange}
                    </div>
                    <div className="mt-1 text-[10px] leading-4 text-slate-600">
                      {source.title}
                    </div>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <p className="text-xs leading-5 text-slate-600">
              No exact reference match. Treat the output as general engineering
              guidance until site evidence is attached.
            </p>
          )}
        </div>
      </ArtifactSection>

      <ArtifactSection title="Evidence gaps" icon={FileSearch}>
        <ListItems items={expert?.evidenceGaps ?? report.evidenceGaps} />
      </ArtifactSection>
    </div>
  );
}

function ArtifactGovernance({
  result,
  expertResult,
}: {
  result: PublicReliabilityResult;
  expertResult: PublicExpertResult | null;
}) {
  const { report } = result;
  const recommendation = report.governedRecommendations[0];
  const expert = expertResult?.status === "success" ? expertResult : null;
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-amber-300/15 bg-amber-300/[0.045] p-4">
        <div className="flex items-center gap-2 text-xs font-semibold text-amber-100">
          <ShieldCheck size={14} />
          Human approval boundary
        </div>
        <p className="mt-2 text-[10px] leading-5 text-amber-50/60">
          {recommendation?.approvalRequirement ?? report.approvalBoundary[0]}
        </p>
      </div>

      <ArtifactSection title="Decision lineage" icon={Activity}>
        <div className="flex items-center justify-between gap-1 text-[9px] font-semibold text-slate-500">
          {["Retrieve", "Diagnose", "Plan", "Approve"].map((stage, index) => (
            <div key={stage} className="contents">
              <span className="rounded-md border border-white/6 bg-white/[0.025] px-2 py-1.5">
                {stage}
              </span>
              {index < 3 && <span>→</span>}
            </div>
          ))}
        </div>
      </ArtifactSection>

      {expert && (
        <ArtifactSection title="Expert runtime" icon={Cpu}>
          <div className="space-y-2 text-[10px] leading-4 text-slate-500">
            <div className="flex items-center justify-between gap-3">
              <span>Methodology</span>
              <span className="text-right text-slate-300">
                {expert.promptVersion ?? "Stigg Reliability Engineer"}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span>Model</span>
              <span className="text-right text-slate-300">
                {expert.modelUsed ?? "Configured reliability model"}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span>Knowledge grounding</span>
              <span className="text-right text-slate-300">
                {expert.knowledgeBaseUsed
                  ? `${expert.retrievedSources.length} approved passages`
                  : "No approved passage matched"}
              </span>
            </div>
          </div>
        </ArtifactSection>
      )}

      <ArtifactSection title="Assumptions" icon={Sparkles}>
        <ListItems items={report.assumptions} />
      </ArtifactSection>

      <ArtifactSection title="Consequence of being wrong" icon={ShieldCheck}>
        <p className="text-xs leading-5 text-slate-400">
          {recommendation?.consequenceOfBeingWrong}
        </p>
        <div className="mt-3 rounded-lg bg-black/20 p-3">
          <div className="text-[9px] font-bold uppercase tracking-wide text-slate-600">
            Required validation
          </div>
          <p className="mt-1 text-[10px] leading-4 text-slate-500">
            {recommendation?.requiredValidation}
          </p>
        </div>
      </ArtifactSection>
    </div>
  );
}

function CapabilityGateDialog({
  action,
  onClose,
  onSignup,
}: {
  action: GateAction;
  onClose: () => void;
  onSignup: () => void;
}) {
  const content: Record<GateAction, { title: string; detail: string }> = {
    attachment: {
      title: "Analyze your own maintenance history",
      detail:
        "Create a secure workspace to attach CSV/XLSX work orders, RCA files, manuals, and site standards with tenant isolation.",
    },
    export: {
      title: "Save and export decision packets",
      detail:
        "Workspace access unlocks saved cases, governed PDF/Word/CSV exports, CMMS handoff, and audit lineage.",
    },
    followup: {
      title: "Continue the engineering conversation",
      detail:
        "Your public analysis is complete. Create a workspace for follow-up questions, case memory, team review, and approvals.",
    },
    voice: {
      title: "Voice input is disabled in public mode",
      detail:
        "Voice capture is not enabled in free access. A secure workspace supports approved typed and file inputs; voice will only ship after tenant controls and auditability are validated.",
    },
    workflow: {
      title: "Unlock the full reliability workflow",
      detail:
        "Continue from RCA into FRACAS, FMEA, RCM, RAM, PM optimization, and executive briefs without losing decision lineage.",
    },
  };
  const selected = content[action];

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center p-4">
      <button
        type="button"
        aria-label="Close capability dialog"
        className="absolute inset-0 bg-black/75 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="capability-dialog-title"
        className="relative w-full max-w-md rounded-2xl border border-white/10 bg-[#121922] p-6 shadow-2xl"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close capability dialog"
          className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-white/5 hover:text-white"
        >
          <X size={17} />
        </button>
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-teal-400/10 text-teal-300">
          <LockKeyhole size={18} />
        </span>
        <h2
          id="capability-dialog-title"
          className="mt-4 text-xl font-semibold tracking-tight text-white"
        >
          {selected.title}
        </h2>
        <p className="mt-3 text-sm leading-6 text-slate-400">
          {selected.detail}
        </p>

        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          {[
            "Tenant-isolated data",
            "10 full sessions",
            "Saved case memory",
            "Human approval workflow",
          ].map((item) => (
            <div
              key={item}
              className="flex items-center gap-2 rounded-lg bg-white/[0.025] px-3 py-2 text-[10px] text-slate-400"
            >
              <Check size={12} className="text-teal-300" />
              {item}
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={onSignup}
          className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-teal-500 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-teal-400"
        >
          Create secure workspace
          <ArrowRight size={16} />
        </button>
        <a
          href="/pilot/reliability"
          className="mt-2 inline-flex w-full items-center justify-center rounded-xl px-4 py-3 text-xs font-semibold text-slate-400 transition-colors hover:bg-white/5 hover:text-slate-200"
        >
          Or view the CAD $7.5K design-partner pilot
        </a>
      </div>
    </div>
  );
}

function AgentAvatar({ active = false }: { active?: boolean }) {
  return (
    <span
      className={`relative grid h-8 w-8 shrink-0 place-items-center rounded-lg border bg-teal-400/8 text-teal-300 ${
        active ? "border-teal-400/40" : "border-teal-400/20"
      }`}
    >
      <Wrench size={15} />
      {active && (
        <span className="absolute -bottom-1 -right-1 h-2.5 w-2.5 rounded-full border-2 border-[#0d1218] bg-emerald-400" />
      )}
    </span>
  );
}

function AnswerMetric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-lg border border-white/6 bg-white/[0.02] p-3">
      <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-600">
        {label}
      </div>
      <div className="mt-1.5 text-lg font-semibold tracking-tight text-white">
        {value}
      </div>
      <div className="mt-0.5 text-[10px] text-slate-600">{detail}</div>
    </div>
  );
}

function ToolbarButton({
  label,
  icon: Icon,
  active = false,
  onClick,
}: {
  label: string;
  icon: React.ElementType;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`grid h-8 w-8 place-items-center rounded-md transition-colors ${
        active
          ? "bg-teal-400/10 text-teal-300"
          : "text-slate-600 hover:bg-white/5 hover:text-slate-300"
      }`}
    >
      <Icon size={14} />
    </button>
  );
}

function ComposerIconButton({
  label,
  icon: Icon,
  onClick,
}: {
  label: string;
  icon: React.ElementType;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="relative grid h-8 w-8 place-items-center rounded-lg text-slate-500 transition-colors hover:bg-white/5 hover:text-slate-300"
    >
      <Icon size={15} />
      <LockKeyhole
        size={7}
        className="absolute bottom-1 right-1 text-slate-700"
      />
    </button>
  );
}

function ArtifactStatus({
  label,
  confidence,
}: {
  label: string;
  confidence: string;
}) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-red-400/12 bg-red-400/[0.035] px-3 py-2.5">
      <span className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wide text-red-200">
        <Activity size={12} />
        {label}
      </span>
      <span className="text-[9px] text-slate-600">{confidence} confidence</span>
    </div>
  );
}

function ArtifactSection({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-white/6 bg-white/[0.018] p-4">
      <h3 className="mb-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.13em] text-slate-500">
        <Icon size={13} className="text-teal-300" />
        {title}
      </h3>
      {children}
    </section>
  );
}

function CompactMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/6 bg-white/[0.018] p-3">
      <div className="text-[9px] uppercase tracking-wide text-slate-600">
        {label}
      </div>
      <div className="mt-1 text-base font-semibold text-slate-200">{value}</div>
    </div>
  );
}

function SmallStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-black/20 p-2.5">
      <div className="text-[9px] text-slate-600">{label}</div>
      <div className="mt-1 text-sm font-semibold text-slate-300">{value}</div>
    </div>
  );
}

function ListItems({ items }: { items: string[] }) {
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div
          key={item}
          className="flex gap-2 text-[10px] leading-4 text-slate-500"
        >
          <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-teal-400" />
          {item}
        </div>
      ))}
    </div>
  );
}
