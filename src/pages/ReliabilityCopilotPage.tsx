import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  BookOpenText,
  Bot,
  BrainCircuit,
  CheckCircle2,
  CircleDot,
  Clock3,
  ClipboardCheck,
  Database,
  Download,
  FileText,
  Gauge,
  ListChecks,
  Layers3,
  MessageSquare,
  PackageCheck,
  RefreshCw,
  Save,
  Send,
  ShieldCheck,
  Sparkles,
  Upload,
  Wrench,
} from "lucide-react";
import {
  applyAssetOnboardingAnswer,
  buildAssetOnboardingExports,
  createAssetOnboardingSession,
  getAssetClassLabel,
  getAssetOnboardingIndustryLabel,
  getAssetOnboardingLifecycleLabel,
  getCurrentOnboardingStep,
  getOnboardingSampleAnswer,
  parseAssetOnboardingCommand,
  type AssetOnboardingExports,
  type AssetOnboardingSession,
} from "../lib/asset-onboarding";
import {
  calculateAvailability,
  exponentialReliability,
  failureRate,
} from "../lib/reliability-calculations";
import {
  generateReliabilityReport,
  SAMPLE_FAILURE_HISTORY_CSV,
  type CopilotMode,
  type ReliabilityReport,
} from "../lib/reliability-report-engine";
import {
  listAssetOnboardingSessions,
  loadAssetOnboardingSession,
  saveAssetOnboardingSession,
  type AssetOnboardingSummary,
} from "../services/assetOnboardingPersistence";
import { useOnboardingStore } from "../store/onboardingStore";
import {
  runLiveReliabilityAgent,
  type LiveReliabilityAgentResult,
} from "../services/reliabilityCopilotAgent";

const modes: CopilotMode[] = [
  "RCA",
  "FRACAS",
  "FMEA",
  "RCM",
  "RAM",
  "PM Optimization",
  "Executive Brief",
];

const workflowCards = [
  {
    title: "RCA Report",
    detail: "Timeline, hypotheses, evidence gaps, actions, recurrence check.",
    icon: BrainCircuit,
  },
  {
    title: "FRACAS Case",
    detail: "Failure event, taxonomy, corrective action, owner, verification.",
    icon: ClipboardCheck,
  },
  {
    title: "FMEA Worksheet",
    detail: "Functions, modes, effects, controls, risk, residual action plan.",
    icon: Layers3,
  },
  {
    title: "Executive Brief",
    detail:
      "Bad actors, cost of unreliability, next decisions, approval needs.",
    icon: FileText,
  },
];

const intakeItems = [
  "Work order CSV/XLSX",
  "Asset register",
  "Failure history",
  "RCA/FMEA files",
  "OEM/manual excerpts",
  "Site standards",
];

const exportOptions: Array<{
  label: string;
  key: keyof AssetOnboardingExports;
  extension: string;
  mime: string;
}> = [
  {
    label: "Markdown",
    key: "markdown",
    extension: "md",
    mime: "text/markdown;charset=utf-8",
  },
  {
    label: "Word",
    key: "wordHtml",
    extension: "doc",
    mime: "application/msword;charset=utf-8",
  },
  {
    label: "PDF HTML",
    key: "pdfHtml",
    extension: "html",
    mime: "text/html;charset=utf-8",
  },
  {
    label: "Excel CSV",
    key: "excelWorkbookCsv",
    extension: "csv",
    mime: "text/csv;charset=utf-8",
  },
  {
    label: "JSON",
    key: "json",
    extension: "json",
    mime: "application/json;charset=utf-8",
  },
  {
    label: "CMMS CSV",
    key: "cmmsImportCsv",
    extension: "csv",
    mime: "text/csv;charset=utf-8",
  },
  {
    label: "Power BI",
    key: "powerBiDatasetJson",
    extension: "json",
    mime: "application/json;charset=utf-8",
  },
  {
    label: "API Payload",
    key: "apiPayloadJson",
    extension: "json",
    mime: "application/json;charset=utf-8",
  },
];

function asNumber(value: string): number {
  return Number(value.replace(/,/g, ""));
}

function formatNumber(value: number, digits = 2): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
  }).format(value);
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function downloadTextFile(
  contents: string,
  filename: string,
  mimeType: string,
) {
  const blob = new Blob([contents], {
    type: mimeType,
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

const initialInputs = {
  operatingHours: "10000",
  failures: "20",
  repairHours: "100",
  repairEvents: "20",
  missionTime: "100",
};

const initialPrompt =
  "Analyze chronic pump seal failures from the last 12 months and create a defensible RCA starter pack.";

type WorkspaceView = "analysis" | "onboarding" | "evidence";

type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  meta?: string;
};

const executiveSignals = [
  { label: "Workspace mode", value: "Agentic", detail: "human-led cowork" },
  {
    label: "Live agents",
    value: "7 roles",
    detail: "specialized reliability flow",
  },
  { label: "Evidence mode", value: "Cited", detail: "RAG + calculations" },
  { label: "Governance", value: "Human gate", detail: "safety and OEM limits" },
];

const liveWorkLabels = [
  "Reading the request",
  "Normalizing asset and failure context",
  "Running RAM calculations",
  "Retrieving reliability evidence",
  "Checking approval and safety gates",
  "Composing the decision packet",
];

export function ReliabilityCopilotPage() {
  const [activeWorkspace, setActiveWorkspace] =
    useState<WorkspaceView>("analysis");
  const [mode, setMode] = useState<CopilotMode>("RCA");
  const [prompt, setPrompt] = useState(initialPrompt);
  const [csvText, setCsvText] = useState(SAMPLE_FAILURE_HISTORY_CSV);
  const [report, setReport] = useState<ReliabilityReport>(() =>
    generateReliabilityReport({
      mode: "RCA",
      prompt: initialPrompt,
      csvText: SAMPLE_FAILURE_HISTORY_CSV,
      inputs: {
        operatingHours: asNumber(initialInputs.operatingHours),
        failures: asNumber(initialInputs.failures),
        repairHours: asNumber(initialInputs.repairHours),
        repairEvents: asNumber(initialInputs.repairEvents),
        missionTimeHours: asNumber(initialInputs.missionTime),
      },
    }),
  );
  const [lastGeneratedMode, setLastGeneratedMode] =
    useState<CopilotMode>("RCA");
  const [inputs, setInputs] = useState(initialInputs);
  const [onboardingCommand, setOnboardingCommand] = useState(
    "/onboard used pump P-101 oil-sands deep",
  );
  const [onboardingSession, setOnboardingSession] =
    useState<AssetOnboardingSession>(() =>
      createAssetOnboardingSession({
        commandText: "/onboard used pump P-101 oil-sands deep",
      }),
    );
  const [onboardingAnswer, setOnboardingAnswer] = useState(() =>
    getOnboardingSampleAnswer(
      createAssetOnboardingSession({
        commandText: "/onboard used pump P-101 oil-sands deep",
      }),
    ),
  );
  const [savedOnboardingSessions, setSavedOnboardingSessions] = useState<
    AssetOnboardingSummary[]
  >([]);
  const [onboardingSaveMessage, setOnboardingSaveMessage] = useState(
    "Demo session is ready. Save progress to make it resumable.",
  );
  const [isSavingOnboarding, setIsSavingOnboarding] = useState(false);
  const registerOnboardingSession = useOnboardingStore(
    (state) => state.registerSession,
  );
  const recordOnboardingStep = useOnboardingStore(
    (state) => state.recordStepCompleted,
  );
  const recordOnboardingExport = useOnboardingStore(
    (state) => state.recordExport,
  );
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: "system-1",
      role: "system",
      text: "SyncAI is ready. Ask for an RCA, FRACAS, FMEA, PM optimization, RAM calculation, executive brief, or start with /onboard pump P-101.",
      meta: "Reliability cowork session",
    },
    {
      id: "assistant-1",
      role: "assistant",
      text: "I can work from pasted failure history, uploaded CSV data, asset context, or a slash command. I will show my work as the specialist agents run.",
      meta: "Guided decision support",
    },
  ]);
  const [liveStage, setLiveStage] = useState(liveWorkLabels.length);
  const [liveAgent, setLiveAgent] = useState<LiveReliabilityAgentResult>({
    status: "disabled",
    response:
      "Generate a report to run the live AI review against the deterministic reliability workflow.",
  });
  const [isRunningLiveAgent, setIsRunningLiveAgent] = useState(false);

  const currentOnboardingStep = useMemo(
    () => getCurrentOnboardingStep(onboardingSession),
    [onboardingSession],
  );

  const onboardingExports = useMemo(
    () => buildAssetOnboardingExports(onboardingSession),
    [onboardingSession],
  );

  const refreshSavedOnboardingSessions = async () => {
    setSavedOnboardingSessions(await listAssetOnboardingSessions());
  };

  useEffect(() => {
    void refreshSavedOnboardingSessions();
  }, []);

  useEffect(() => {
    if (!isRunningLiveAgent) {
      if (liveAgent.status === "success" || liveAgent.status === "error") {
        setLiveStage(liveWorkLabels.length);
      }
      return;
    }

    setLiveStage(0);
    const timer = window.setInterval(() => {
      setLiveStage((current) =>
        Math.min(current + 1, liveWorkLabels.length - 1),
      );
    }, 650);

    return () => window.clearInterval(timer);
  }, [isRunningLiveAgent, liveAgent.status]);

  const calculation = useMemo(() => {
    try {
      const operatingHours = asNumber(inputs.operatingHours);
      const failures = asNumber(inputs.failures);
      const repairHours = asNumber(inputs.repairHours);
      const repairEvents = asNumber(inputs.repairEvents);
      const missionTime = asNumber(inputs.missionTime);
      const availability = calculateAvailability(
        operatingHours,
        failures,
        repairHours,
        repairEvents,
      );
      const lambda = failureRate(failures, operatingHours);

      return {
        ...availability,
        failureRate: lambda,
        missionReliability: exponentialReliability(lambda, missionTime),
        error: null,
      };
    } catch (error) {
      return {
        mtbf: 0,
        mttr: 0,
        inherentAvailability: 0,
        failureRate: 0,
        missionReliability: 0,
        error: error instanceof Error ? error.message : "Invalid inputs.",
      };
    }
  }, [inputs]);

  const handleInputChange = (key: keyof typeof inputs, value: string) => {
    setInputs((current) => ({ ...current, [key]: value }));
  };

  const agentRuntimeSteps = useMemo(
    () => [
      {
        icon: BrainCircuit,
        agent: "Reliability Engineer",
        status: "Framing decision",
        detail: `${lastGeneratedMode} method selected with approval boundary applied.`,
        state: "complete",
      },
      {
        icon: Database,
        agent: "Data Analyst",
        status: "Normalizing history",
        detail: `${report.dataSummary.recordCount} records, ${report.dataSummary.uniqueAssets} assets, ${formatNumber(report.dataSummary.totalDowntimeHours)} downtime hours.`,
        state: "complete",
      },
      {
        icon: BookOpenText,
        agent: "RAG Researcher",
        status: "Grounding evidence",
        detail: report.sources[0]
          ? `${report.sources[0].source}: ${report.sources[0].title}`
          : "No source match. General engineering guidance only.",
        state: report.sources.length ? "complete" : "attention",
      },
      {
        icon: Gauge,
        agent: "RAM Modeler",
        status: "Calculating baseline",
        detail: calculation.error
          ? calculation.error
          : `MTBF ${formatNumber(calculation.mtbf)}h, availability ${formatPercent(calculation.inherentAvailability)}.`,
        state: calculation.error ? "attention" : "complete",
      },
      {
        icon: ShieldCheck,
        agent: "Governance Agent",
        status: "Checking approval gates",
        detail: report.approvalBoundary[0],
        state: "complete",
      },
      {
        icon: FileText,
        agent: "Report Agent",
        status:
          liveAgent.status === "success"
            ? "Live review complete"
            : "Decision packet ready",
        detail:
          liveAgent.status === "success"
            ? "Live model response is attached to the deterministic workflow."
            : "Starter pack is ready; generate again to refresh live agent output.",
        state: liveAgent.status === "success" ? "complete" : "active",
      },
    ],
    [calculation, lastGeneratedMode, liveAgent.status, report],
  );

  const liveWorkItems = useMemo(
    () =>
      liveWorkLabels.map((label, index) => ({
        label,
        status:
          isRunningLiveAgent && index === liveStage
            ? "active"
            : isRunningLiveAgent && index > liveStage
              ? "queued"
              : "complete",
      })),
    [isRunningLiveAgent, liveStage],
  );

  const generateReport = async () => {
    const submittedPrompt = prompt.trim() || initialPrompt;
    setActiveWorkspace("analysis");
    setChatMessages((current) => [
      ...current,
      {
        id: `user-${Date.now()}`,
        role: "user",
        text: submittedPrompt,
        meta: mode,
      },
    ]);

    const onboarding = parseAssetOnboardingCommand(prompt);
    if (onboarding.isOnboarding) {
      const nextSession = createAssetOnboardingSession({ commandText: prompt });
      setOnboardingCommand(prompt);
      setOnboardingSession(nextSession);
      setOnboardingAnswer(getOnboardingSampleAnswer(nextSession));
      setActiveWorkspace("onboarding");
      setChatMessages((current) => [
        ...current,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          text: `I started a guided onboarding session for ${nextSession.assetId}. The next step is ${getCurrentOnboardingStep(nextSession).name}, and the asset is currently ${nextSession.completionScore}% complete.`,
          meta: "Asset onboarding",
        },
      ]);
      void persistOnboardingSession(nextSession, "Onboarding started.");
      return;
    }

    if (calculation.error) return;
    setChatMessages((current) => [
      ...current,
      {
        id: `assistant-working-${Date.now()}`,
        role: "assistant",
        text: "I’m running the reliability workflow now: parsing the data, calculating RAM metrics, grounding the recommendation, and checking approval gates.",
        meta: "Live work started",
      },
    ]);
    const nextReport = generateReliabilityReport({
      mode,
      prompt,
      csvText,
      inputs: {
        operatingHours: asNumber(inputs.operatingHours),
        failures: asNumber(inputs.failures),
        repairHours: asNumber(inputs.repairHours),
        repairEvents: asNumber(inputs.repairEvents),
        missionTimeHours: asNumber(inputs.missionTime),
      },
    });
    setReport(nextReport);
    setLastGeneratedMode(mode);
    setIsRunningLiveAgent(true);
    setLiveAgent({
      status: "disabled",
      response: "Running live AI reliability review...",
    });
    const liveResult = await runLiveReliabilityAgent({
      mode,
      prompt,
      csvText,
      report: nextReport,
    });
    setLiveAgent(liveResult);
    setIsRunningLiveAgent(false);
    setChatMessages((current) => [
      ...current,
      {
        id: `assistant-result-${Date.now()}`,
        role: "assistant",
        text: `${nextReport.mode} packet is ready. Risk is ${nextReport.riskLevel}, confidence is ${nextReport.confidence}, and the first recommendation is: ${nextReport.recommendations[0]}`,
        meta:
          liveResult.status === "success"
            ? `Live review complete via ${liveResult.provider ?? "configured model"}`
            : "Deterministic workflow complete",
      },
    ]);
  };

  const exportReport = () => {
    downloadTextFile(
      report.markdown,
      `syncai-${report.mode.toLowerCase().replace(/\s+/g, "-")}-report.md`,
      "text/markdown;charset=utf-8",
    );
  };

  const persistOnboardingSession = async (
    session: AssetOnboardingSession,
    messagePrefix: string,
  ) => {
    setIsSavingOnboarding(true);
    try {
      const exports = buildAssetOnboardingExports(session);
      const result = await saveAssetOnboardingSession(session, exports);
      // Make this operational across SyncAI (Asset Intelligence, Reliability,
      // Work Action Board, Governance, Mission Control, Value, Cowork, Learning).
      registerOnboardingSession(session, result);
      setOnboardingSaveMessage(
        result.mode === "supabase"
          ? `${messagePrefix} Saved to the tenant database.`
          : `${messagePrefix} ⚠ Not saved to the tenant database — saved only in this browser. ${
              result.warning ??
              "Sign in with a Supabase-connected tenant to persist this session."
            }`,
      );
      await refreshSavedOnboardingSessions();
    } catch (error) {
      setOnboardingSaveMessage(
        error instanceof Error
          ? `Save failed: ${error.message}`
          : "Save failed. Keep the current page open and try again.",
      );
    } finally {
      setIsSavingOnboarding(false);
    }
  };

  const startOnboarding = (commandText = onboardingCommand) => {
    const nextSession = createAssetOnboardingSession({ commandText });
    setOnboardingCommand(commandText);
    setOnboardingSession(nextSession);
    setOnboardingAnswer(getOnboardingSampleAnswer(nextSession));
    void persistOnboardingSession(nextSession, "Onboarding started.");
  };

  const saveOnboardingAnswer = async () => {
    const completedStepName = getCurrentOnboardingStep(onboardingSession).name;
    const nextSession = applyAssetOnboardingAnswer({
      session: onboardingSession,
      answer: onboardingAnswer,
    });
    setOnboardingSession(nextSession);
    setOnboardingAnswer(getOnboardingSampleAnswer(nextSession));
    await persistOnboardingSession(nextSession, "Step saved.");
    recordOnboardingStep(nextSession, completedStepName);
  };

  const resumeOnboardingSession = async (sessionId: string) => {
    const savedSession = await loadAssetOnboardingSession(sessionId);
    if (!savedSession) {
      setOnboardingSaveMessage(
        "That saved onboarding session could not be loaded.",
      );
      return;
    }

    setOnboardingSession(savedSession);
    setOnboardingCommand(
      `/onboard ${savedSession.lifecycle} ${savedSession.assetClass} ${savedSession.assetId} ${savedSession.industry}`,
    );
    setOnboardingAnswer(getOnboardingSampleAnswer(savedSession));
    setOnboardingSaveMessage(
      `Resumed ${savedSession.assetId} at ${savedSession.completionScore}% completion.`,
    );
  };

  const exportOnboarding = ({
    key,
    extension,
    mime,
  }: {
    key: keyof AssetOnboardingExports;
    extension: string;
    mime: string;
  }) => {
    downloadTextFile(
      onboardingExports[key],
      `syncai-${onboardingSession.assetId.toLowerCase()}-asset-onboarding-${key}.${extension}`,
      mime,
    );
    recordOnboardingExport(onboardingSession, 1);
  };

  const handleFailureFile = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setCsvText(await file.text());
    event.target.value = "";
  };

  return (
    <div className="mx-auto max-w-[1440px] space-y-4 pb-10">
      <section className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-[linear-gradient(135deg,rgba(13,19,26,0.96),rgba(8,12,17,0.98))] p-4 shadow-xl shadow-black/20">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-teal-300/50 to-transparent" />
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-teal-300/20 bg-teal-300/10 px-3 py-1 text-xs font-medium text-teal-200">
              <Bot size={14} />
              Reliability decision support
            </div>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight text-[#F8FAFC]">
              Reliability Engineering Copilot
            </h1>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-400">
              A governed reliability workspace for RCA, FRACAS, FMEA, RCM, PM
              optimization, RAM calculations, and executive reliability
              reporting.
            </p>
          </div>
          <div className="rounded-xl border border-amber-300/20 bg-amber-300/[0.08] p-4 text-sm text-amber-100 lg:max-w-md">
            <div className="flex items-start gap-3">
              <AlertTriangle size={18} className="mt-0.5 text-amber-300" />
              <p>
                Decision support only. Safety, environmental, regulatory, OEM
                limit, and production-critical changes require qualified
                engineering approval.
              </p>
            </div>
          </div>
        </div>

        <div className="hidden">
          {executiveSignals.map((signal) => (
            <div
              key={signal.label}
              className="rounded-xl border border-white/[0.07] bg-black/20 px-4 py-3"
            >
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                {signal.label}
              </div>
              <div className="mt-1 text-lg font-semibold text-[#F8FAFC]">
                {signal.value}
              </div>
              <div className="mt-0.5 text-xs text-slate-400">
                {signal.detail}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-white/[0.08] bg-[#0D131A]/75 p-1.5 shadow-lg shadow-black/10">
        <div className="grid gap-3 lg:grid-cols-[1fr_1fr_1fr_1.1fr]">
          <button
            onClick={() => setActiveWorkspace("analysis")}
            className={`rounded-xl border p-3 text-left transition-all ${
              activeWorkspace === "analysis"
                ? "border-teal-300/40 bg-teal-300/[0.09] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
                : "border-white/[0.06] bg-white/[0.025] hover:border-white/[0.1] hover:bg-white/[0.05]"
            }`}
          >
            <div className="flex items-center gap-2 text-sm font-semibold text-[#E6EDF3]">
              <BrainCircuit size={17} className="text-teal-300" />
              Analyze a reliability problem
            </div>
            <p className="mt-1 text-xs leading-5 text-slate-400">
              RCA, FRACAS, FMEA, RAM, PM optimization, and governed reports.
            </p>
          </button>
          <button
            onClick={() => setActiveWorkspace("onboarding")}
            className={`rounded-xl border p-3 text-left transition-all ${
              activeWorkspace === "onboarding"
                ? "border-teal-300/40 bg-teal-300/[0.09] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
                : "border-white/[0.06] bg-white/[0.025] hover:border-white/[0.1] hover:bg-white/[0.05]"
            }`}
          >
            <div className="flex items-center gap-2 text-sm font-semibold text-[#E6EDF3]">
              <PackageCheck size={17} className="text-teal-300" />
              Guided Asset Onboarding
            </div>
            <p className="mt-1 text-xs leading-5 text-slate-400">
              Build a reliability-ready asset profile from one command.
            </p>
          </button>
          <button
            onClick={() => setActiveWorkspace("evidence")}
            className={`rounded-xl border p-3 text-left transition-all ${
              activeWorkspace === "evidence"
                ? "border-teal-300/40 bg-teal-300/[0.09] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
                : "border-white/[0.06] bg-white/[0.025] hover:border-white/[0.1] hover:bg-white/[0.05]"
            }`}
          >
            <div className="flex items-center gap-2 text-sm font-semibold text-[#E6EDF3]">
              <BookOpenText size={17} className="text-teal-300" />
              Evidence & Governance
            </div>
            <p className="mt-1 text-xs leading-5 text-slate-400">
              Source trail, deterministic math, and approval controls.
            </p>
          </button>
          <div className="grid grid-cols-3 gap-2 rounded-xl border border-white/[0.06] bg-black/20 p-3">
            <CompactMetric label="Risk" value={report.riskLevel} />
            <CompactMetric
              label="Readiness"
              value={onboardingSession.reliabilityReadiness}
            />
            <CompactMetric label="RAG" value="Live" />
          </div>
        </div>
      </section>

      {activeWorkspace === "onboarding" && (
        <section className="glass rounded-xl border border-teal-500/20 p-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-lg border border-teal-500/20 bg-teal-500/10 px-3 py-1 text-xs font-medium text-teal-300">
                <PackageCheck size={14} />
                One-command workflow
              </div>
              <h2 className="mt-3 text-xl font-bold text-[#E6EDF3]">
                Guided Asset Onboarding
              </h2>
              <p className="mt-1 max-w-3xl text-sm text-slate-400">
                Convert any asset into a reliability-ready digital profile for
                RCA, FMEA, PM optimization, FRACAS, RAM, criticality, spares,
                and lifecycle planning.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 text-center sm:min-w-[520px] lg:grid-cols-5">
              <div className="rounded-lg border border-white/[0.06] bg-black/20 p-3">
                <div className="text-xs text-slate-400">Completion</div>
                <div className="mt-1 text-2xl font-bold text-[#E6EDF3]">
                  {onboardingSession.completionScore}%
                </div>
              </div>
              <div className="rounded-lg border border-white/[0.06] bg-black/20 p-3">
                <div className="text-xs text-slate-400">Readiness</div>
                <div className="mt-1 text-lg font-bold capitalize text-teal-300">
                  {onboardingSession.reliabilityReadiness}
                </div>
              </div>
              <div className="rounded-lg border border-white/[0.06] bg-black/20 p-3">
                <div className="text-xs text-slate-400">Mode</div>
                <div className="mt-1 text-lg font-bold capitalize text-[#E6EDF3]">
                  {onboardingSession.mode}
                </div>
              </div>
              <div className="rounded-lg border border-white/[0.06] bg-black/20 p-3">
                <div className="text-xs text-slate-400">Lifecycle</div>
                <div className="mt-1 text-sm font-bold text-[#E6EDF3]">
                  {getAssetOnboardingLifecycleLabel(
                    onboardingSession.lifecycle,
                  )}
                </div>
              </div>
              <div className="rounded-lg border border-white/[0.06] bg-black/20 p-3">
                <div className="text-xs text-slate-400">Template</div>
                <div className="mt-1 text-sm font-bold text-teal-300">
                  {getAssetOnboardingIndustryLabel(onboardingSession.industry)}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
            <div className="space-y-4">
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
                <input
                  value={onboardingCommand}
                  onChange={(event) => setOnboardingCommand(event.target.value)}
                  className="rounded-xl border border-white/[0.08] bg-black/20 px-4 py-3 font-mono text-sm text-[#E6EDF3] outline-none focus:border-teal-500/60"
                  aria-label="Asset onboarding command"
                />
                <button
                  onClick={() => startOnboarding()}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-teal-500 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-teal-400"
                >
                  <Send size={16} />
                  Start Onboarding
                </button>
              </div>
              <div className="flex flex-wrap gap-2 text-xs text-slate-400">
                {[
                  "/onboard asset",
                  "/onboard used pump P-101 oil-sands deep",
                  "/onboard new conveyor CV-204 mining",
                  "/onboard transferred fleet haul_trucks mining",
                  "/onboard from SAP export oil-sands",
                  "/onboard from OEM manual",
                ].map((command) => (
                  <button
                    key={command}
                    onClick={() => startOnboarding(command)}
                    className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-2.5 py-1.5 transition-colors hover:bg-white/[0.08]"
                  >
                    {command}
                  </button>
                ))}
              </div>

              <div className="rounded-xl border border-white/[0.06] bg-black/20 p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-semibold text-[#E6EDF3]">
                      <ListChecks size={17} className="text-teal-300" />
                      Current step: {currentOnboardingStep.name}
                    </div>
                    <p className="mt-1 text-sm text-slate-400">
                      {currentOnboardingStep.purpose}
                    </p>
                  </div>
                  <span className="rounded-lg bg-white/[0.04] px-2 py-1 text-xs font-medium text-slate-300">
                    {currentOnboardingStep.completionScore}% complete
                  </span>
                </div>
                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Guided questions
                    </div>
                    <ul className="mt-2 space-y-2 text-sm text-slate-300">
                      {currentOnboardingStep.questions.map((question) => (
                        <li key={question} className="flex gap-2">
                          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-300" />
                          <span>{question}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Required fields
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {currentOnboardingStep.requiredFields
                        .slice(0, 14)
                        .map((field) => (
                          <span
                            key={field}
                            className="rounded-lg bg-white/[0.04] px-2 py-1 text-xs text-slate-300"
                          >
                            {field}
                          </span>
                        ))}
                    </div>
                  </div>
                </div>
                <textarea
                  value={onboardingAnswer}
                  onChange={(event) => setOnboardingAnswer(event.target.value)}
                  className="mt-4 min-h-32 w-full resize-y rounded-xl border border-white/[0.08] bg-black/20 p-3 text-sm text-[#E6EDF3] outline-none focus:border-teal-500/60"
                  aria-label="Asset onboarding answer"
                />
                <div className="mt-3 flex flex-wrap gap-3">
                  <button
                    onClick={saveOnboardingAnswer}
                    className="inline-flex items-center gap-2 rounded-lg bg-teal-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-teal-400"
                  >
                    {isSavingOnboarding ? (
                      <RefreshCw size={16} />
                    ) : (
                      <Save size={16} />
                    )}
                    Save Step And Continue
                  </button>
                  <button
                    onClick={() =>
                      setOnboardingAnswer(
                        getOnboardingSampleAnswer(onboardingSession),
                      )
                    }
                    className="inline-flex items-center gap-2 rounded-lg border border-white/[0.08] px-4 py-2 text-sm font-semibold text-slate-200 transition-colors hover:bg-white/[0.04]"
                  >
                    <BrainCircuit size={16} />
                    Use Guided Draft
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <Signal
                  icon={PackageCheck}
                  label="Asset"
                  value={`${onboardingSession.assetId} - ${getAssetClassLabel(
                    onboardingSession.assetClass,
                  )}`}
                />
                <Signal
                  icon={ShieldCheck}
                  label="Criticality"
                  value={`${onboardingSession.profile.criticality.criticalityClass} (${onboardingSession.profile.criticality.score}/${onboardingSession.profile.criticality.maxScore})`}
                />
                <Signal
                  icon={AlertTriangle}
                  label="Readiness"
                  value={onboardingSession.readinessMessage}
                />
              </div>

              <div className="rounded-xl border border-white/[0.06] bg-black/20 p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-semibold text-[#E6EDF3]">
                      <Database size={17} className="text-teal-300" />
                      Persistence and resume
                    </div>
                    <p className="mt-1 text-sm text-slate-400">
                      {onboardingSaveMessage}
                    </p>
                  </div>
                  <button
                    onClick={() => void refreshSavedOnboardingSessions()}
                    className="inline-flex items-center gap-2 rounded-lg border border-white/[0.08] px-3 py-2 text-xs font-semibold text-slate-200 transition-colors hover:bg-white/[0.04]"
                  >
                    <RefreshCw size={14} />
                    Refresh
                  </button>
                </div>
                <div
                  className="mt-3 grid gap-2 md:grid-cols-2"
                  aria-label="Saved onboarding sessions"
                >
                  {savedOnboardingSessions.length ? (
                    savedOnboardingSessions.slice(0, 4).map((session) => (
                      <button
                        key={session.sessionId}
                        onClick={() =>
                          void resumeOnboardingSession(session.sessionId)
                        }
                        className="rounded-lg border border-white/[0.06] bg-white/[0.03] p-3 text-left transition-colors hover:bg-white/[0.08]"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="font-mono text-sm font-semibold text-[#E6EDF3]">
                            {session.assetId}
                          </div>
                          <span className="rounded bg-teal-500/10 px-2 py-0.5 text-xs capitalize text-teal-300">
                            {session.source}
                          </span>
                        </div>
                        <div className="mt-1 text-xs capitalize text-slate-400">
                          {session.assetClass.replace("_", " ")} ·{" "}
                          {session.mode} · {session.lifecycle.replace("_", " ")}{" "}
                          · {session.industry.replace("_", " ")} ·{" "}
                          {session.completionScore}% ·{" "}
                          {session.currentStep.replace("_", " ")}
                        </div>
                      </button>
                    ))
                  ) : (
                    <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] p-3 text-sm text-slate-400 md:col-span-2">
                      No saved sessions yet. Start onboarding or save a step to
                      create a resumable asset profile.
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-xl border border-white/[0.06] bg-black/20 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-[#E6EDF3]">
                  <PackageCheck size={17} className="text-teal-300" />
                  Final Package Exports
                </div>
                <p className="mt-2 text-sm text-slate-400">
                  Export the onboarding package as Word, PDF-ready HTML, Excel
                  CSV, JSON, CMMS import CSV, Power BI dataset JSON, or API
                  payload.
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {exportOptions.map((option) => (
                    <button
                      key={option.key}
                      onClick={() => exportOnboarding(option)}
                      className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs font-semibold text-slate-200 transition-colors hover:bg-white/[0.08]"
                    >
                      <Download size={14} />
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-white/[0.06] bg-black/20 p-4">
                <div className="text-sm font-semibold text-[#E6EDF3]">
                  Progress
                </div>
                <div className="mt-3 max-h-[520px] space-y-2 overflow-auto pr-1">
                  {onboardingSession.steps.map((step, index) => (
                    <div
                      key={step.id}
                      className={`rounded-lg border px-3 py-2 ${
                        step.id === onboardingSession.currentStep
                          ? "border-teal-500/40 bg-teal-500/10"
                          : "border-white/[0.06] bg-white/[0.03]"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-[#E6EDF3]">
                            {index + 1}. {step.name}
                          </div>
                          <div className="text-xs capitalize text-slate-400">
                            {step.completionStatus.replace("_", " ")}
                          </div>
                        </div>
                        <div className="text-right text-xs font-semibold text-teal-300">
                          {step.completionScore}%
                        </div>
                      </div>
                      <div className="mt-2 h-1.5 rounded-full bg-white/[0.06]">
                        <div
                          className="h-1.5 rounded-full bg-teal-400"
                          style={{ width: `${step.completionScore}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {activeWorkspace === "analysis" && (
        <section className="grid grid-cols-1 gap-5">
          <div className="rounded-2xl border border-white/[0.08] bg-[#0D131A]/90 p-4 shadow-xl shadow-black/20">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-300/80">
                  Active workspace
                </div>
                <h2 className="mt-1 text-lg font-semibold tracking-tight text-[#F8FAFC]">
                  Ask, analyze, and produce the decision packet
                </h2>
                <p className="text-sm text-slate-400">
                  Select a reliability method, add context, and generate a
                  review-ready starter pack.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {modes.map((item) => (
                  <button
                    key={item}
                    onClick={() => setMode(item)}
                    className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                      mode === item
                        ? "bg-teal-400 text-slate-950 shadow-lg shadow-teal-950/20"
                        : "bg-white/[0.04] text-slate-300 hover:bg-white/[0.08]"
                    }`}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-4 space-y-4">
              <div className="grid min-h-[620px] gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
                <div className="flex min-h-[620px] flex-col rounded-2xl border border-white/[0.08] bg-[#080C11] shadow-xl shadow-black/20">
                  <div className="order-1 border-b border-white/[0.06] p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <div className="flex items-center gap-2 text-base font-semibold text-[#F8FAFC]">
                          <MessageSquare size={18} className="text-teal-300" />
                          Cowork Thread
                        </div>
                        <p className="mt-1 text-sm leading-6 text-slate-400">
                          The conversation, decisions, and generated reliability
                          packet stay together.
                        </p>
                      </div>
                      <div className="grid min-w-[260px] grid-cols-3 gap-2 text-center">
                        <CompactMetric label="Mode" value={lastGeneratedMode} />
                        <CompactMetric
                          label="Records"
                          value={String(report.dataSummary.recordCount)}
                        />
                        <CompactMetric
                          label="Status"
                          value={liveAgent.status}
                        />
                      </div>
                    </div>
                  </div>
                  <div className="order-3 flex-1 space-y-4 overflow-auto p-5">
                    {chatMessages.map((message) => (
                      <ChatBubble key={message.id} message={message} />
                    ))}
                    <div className="rounded-2xl border border-teal-300/15 bg-[linear-gradient(135deg,rgba(20,184,166,0.08),rgba(8,12,17,0.8))] p-4">
                      <div className="flex items-center gap-2 text-sm font-semibold text-[#F8FAFC]">
                        <Bot size={17} className="text-teal-300" />
                        Current Decision Packet
                      </div>
                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                            Recommendation
                          </div>
                          <p className="mt-1 text-sm leading-6 text-slate-200">
                            {report.recommendations[0]}
                          </p>
                        </div>
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                            Approval Gate
                          </div>
                          <p className="mt-1 text-sm leading-6 text-slate-200">
                            {report.approvalBoundary[0]}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="order-4 border-t border-white/[0.06] p-4">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-300">
                        Ask SyncAI
                      </div>
                      <div className="text-xs text-slate-400">
                        Press Cmd/Ctrl + Enter to send
                      </div>
                    </div>
                    <textarea
                      value={prompt}
                      onChange={(event) => setPrompt(event.target.value)}
                      onKeyDown={(event) => {
                        if (
                          event.key === "Enter" &&
                          (event.metaKey || event.ctrlKey)
                        ) {
                          event.preventDefault();
                          void generateReport();
                        }
                      }}
                      className="min-h-28 w-full resize-none rounded-2xl border border-teal-300/20 bg-black/45 p-4 text-sm leading-6 text-[#E6EDF3] outline-none transition-colors placeholder:text-slate-400 focus:border-teal-400/70 focus:ring-4 focus:ring-teal-400/10"
                      placeholder="Ask for RCA, FRACAS, PM optimization, RAM, or /onboard pump P-101..."
                      aria-label="Interactive reliability chat input"
                    />
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => void generateReport()}
                        disabled={!!calculation.error || isRunningLiveAgent}
                        aria-label="Generate Report"
                        className="inline-flex items-center gap-2 rounded-xl bg-teal-400 px-4 py-2.5 text-sm font-semibold text-slate-950 shadow-lg shadow-teal-950/20 transition-colors hover:bg-teal-300 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isRunningLiveAgent ? (
                          <RefreshCw size={16} />
                        ) : (
                          <Send size={16} />
                        )}
                        {isRunningLiveAgent ? "Working" : "Send"}
                      </button>
                      <button
                        onClick={() =>
                          setPrompt("/onboard used pump P-101 oil-sands deep")
                        }
                        className="inline-flex items-center gap-2 rounded-xl border border-white/[0.08] px-3 py-2.5 text-xs font-semibold text-slate-200 transition-colors hover:bg-white/[0.04]"
                      >
                        <Sparkles size={14} />
                        /onboard
                      </button>
                      <button
                        onClick={exportReport}
                        className="inline-flex items-center gap-2 rounded-xl border border-white/[0.08] px-3 py-2.5 text-xs font-semibold text-slate-200 transition-colors hover:bg-white/[0.04]"
                      >
                        <Download size={14} />
                        Export
                      </button>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="rounded-2xl border border-white/[0.08] bg-[#080C11] p-4 shadow-xl shadow-black/20">
                    <div className="flex items-center gap-2 text-sm font-semibold text-[#F8FAFC]">
                      <Bot size={17} className="text-teal-300" />
                      Agent Workstream
                    </div>
                    <p className="mt-1 text-xs leading-5 text-slate-400">
                      Real-time feedback from the reliability workflow.
                    </p>
                    <div className="mt-4 rounded-2xl border border-white/[0.07] bg-black/25 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                          Live Work Stream
                        </div>
                        <span className="rounded-full border border-teal-300/20 bg-teal-300/10 px-2.5 py-1 text-xs font-semibold text-teal-200">
                          {isRunningLiveAgent ? "running" : "ready"}
                        </span>
                      </div>
                      <div className="mt-4 space-y-2">
                        {liveWorkItems.map((item) => (
                          <LiveWorkItem key={item.label} {...item} />
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-white/[0.08] bg-[#080C11] p-4 shadow-xl shadow-black/20">
                    <div className="flex items-center gap-2 text-sm font-semibold text-[#F8FAFC]">
                      <CircleDot size={17} className="text-teal-300" />
                      Artifact Snapshot
                    </div>
                    <div className="mt-4 space-y-3">
                      <DecisionRow
                        label="Risk"
                        value={report.riskLevel}
                        tone="amber"
                      />
                      <DecisionRow
                        label="Confidence"
                        value={report.confidence}
                      />
                      <DecisionRow
                        label="RAG"
                        value={report.sources[0]?.source ?? "General guidance"}
                      />
                      <DecisionRow
                        label="Top Asset"
                        value={report.badActors[0]?.assetId ?? "Pending data"}
                      />
                    </div>
                  </div>

                  <div className="rounded-2xl border border-white/[0.08] bg-[#080C11] p-4 shadow-xl shadow-black/20">
                    <div className="flex items-center gap-2 text-sm font-semibold text-[#F8FAFC]">
                      <Gauge size={17} className="text-teal-300" />
                      Live Math
                    </div>
                    {calculation.error ? (
                      <div className="mt-4 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200">
                        {calculation.error}
                      </div>
                    ) : (
                      <div className="mt-4 grid grid-cols-2 gap-2">
                        <Metric
                          label="MTBF calc"
                          value={formatNumber(calculation.mtbf)}
                        />
                        <Metric
                          label="MTTR"
                          value={formatNumber(calculation.mttr)}
                        />
                        <Metric
                          label="Avail."
                          value={formatPercent(
                            calculation.inherentAvailability,
                          )}
                          wide
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <details className="rounded-2xl border border-dashed border-white/[0.12] bg-white/[0.025] p-4">
                <summary className="cursor-pointer list-none">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-2 text-sm font-semibold text-[#E6EDF3]">
                      <Upload size={17} className="text-teal-300" />
                      Add failure-history data
                    </div>
                    <span className="text-xs text-slate-400">
                      Optional CSV intake
                    </span>
                  </div>
                </summary>
                <p className="mt-3 text-sm text-slate-400">
                  Paste or upload CSV failure history. The report updates from
                  this data when you generate.
                </p>
                <label className="mt-4 flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-black/20 px-3 py-2 text-sm font-medium text-slate-200 transition-colors hover:bg-white/[0.04]">
                  <Upload size={16} />
                  Upload CSV
                  <input
                    type="file"
                    accept=".csv,text/csv,text/plain"
                    onChange={handleFailureFile}
                    className="hidden"
                  />
                </label>
                <textarea
                  value={csvText}
                  onChange={(event) => setCsvText(event.target.value)}
                  className="mt-3 min-h-44 w-full resize-y rounded-xl border border-white/[0.08] bg-[#080C11] p-3 font-mono text-xs text-[#E6EDF3] outline-none focus:border-teal-500/60"
                  aria-label="Failure history CSV"
                />
                <div className="mt-4 grid gap-2 md:grid-cols-2">
                  {intakeItems.map((item) => (
                    <div
                      key={item}
                      className="flex items-center gap-2 rounded-lg bg-black/20 px-3 py-2 text-sm text-slate-300"
                    >
                      <ClipboardCheck size={15} className="text-teal-300" />
                      {item}
                    </div>
                  ))}
                </div>
              </details>

              <div className="rounded-2xl border border-white/[0.08] bg-[linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.02))] p-4 shadow-xl shadow-black/10">
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div className="flex items-center gap-2 text-sm font-semibold text-[#F8FAFC]">
                    <ShieldCheck size={17} className="text-teal-300" />
                    {lastGeneratedMode} Report
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs">
                    <span className="rounded-full border border-amber-300/20 bg-amber-300/10 px-2.5 py-1 text-amber-100">
                      Risk: {report.riskLevel}
                    </span>
                    <span className="rounded-full border border-sky-300/20 bg-sky-300/10 px-2.5 py-1 text-sky-100">
                      Confidence: {report.confidence}
                    </span>
                    <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-slate-300">
                      Records: {report.dataSummary.recordCount}
                    </span>
                  </div>
                </div>
                <div className="mt-3 grid gap-3 text-sm text-slate-300 md:grid-cols-2">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Recommendation
                    </div>
                    <p className="mt-1">{report.recommendations[0]}</p>
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Top Bad Actor
                    </div>
                    <p className="mt-1">
                      {report.badActors[0]
                        ? `${report.badActors[0].assetId}: ${formatNumber(
                            report.badActors[0].downtimeHours,
                          )} downtime hours, ${report.badActors[0].failures} failures`
                        : "No structured failure history provided yet."}
                    </p>
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Next Actions
                    </div>
                    <p className="mt-1">{report.actions[0]}</p>
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Approval Boundary
                    </div>
                    <p className="mt-1">{report.approvalBoundary[0]}</p>
                  </div>
                </div>
                <div className="mt-4 grid gap-3 lg:grid-cols-3">
                  <div className="rounded-xl border border-white/[0.06] bg-black/20 p-3">
                    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                      <BookOpenText size={15} className="text-teal-300" />
                      Source Grounding
                    </div>
                    <div className="mt-2 space-y-2">
                      {report.sources.slice(0, 2).map((source) => (
                        <div key={source.id} className="text-xs text-slate-300">
                          <div className="font-semibold text-[#E6EDF3]">
                            {source.source}
                          </div>
                          <div>{source.title}</div>
                          <div className="text-slate-400">
                            Confidence: {source.confidence}
                          </div>
                        </div>
                      ))}
                      {report.sources.length === 0 && (
                        <div className="text-xs text-slate-400">
                          No source match. Treat as general engineering
                          guidance.
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="rounded-xl border border-white/[0.06] bg-black/20 p-3">
                    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                      <ShieldCheck size={15} className="text-teal-300" />
                      Governed Recommendation
                    </div>
                    <p className="mt-2 text-xs text-slate-300">
                      {report.governedRecommendations[0]?.requiredValidation}
                    </p>
                    <p className="mt-2 text-xs text-slate-400">
                      Owner: {report.governedRecommendations[0]?.ownerRole}
                    </p>
                  </div>
                  <div className="rounded-xl border border-white/[0.06] bg-black/20 p-3">
                    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                      <AlertTriangle size={15} className="text-amber-300" />
                      Data Quality
                    </div>
                    <p className="mt-2 text-xs text-slate-300">
                      {report.dataQualityFindings[0]?.issue ??
                        "No high-impact data quality issues were detected."}
                    </p>
                    <p className="mt-2 text-xs text-slate-400">
                      {report.dataQualityFindings[0]?.nextAction ??
                        "Keep failure modes, dates, downtime, and repair hours normalized."}
                    </p>
                  </div>
                </div>
                <details className="mt-4 rounded-xl border border-white/[0.06] bg-black/30">
                  <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-200">
                    View full deterministic report
                  </summary>
                  <pre className="max-h-96 overflow-auto whitespace-pre-wrap border-t border-white/[0.06] p-4 text-xs leading-5 text-slate-200">
                    {report.markdown}
                  </pre>
                </details>
              </div>

              <div className="rounded-2xl border border-teal-300/20 bg-teal-300/[0.07] p-4">
                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                  <div className="flex items-center gap-2 text-sm font-semibold text-[#E6EDF3]">
                    <Bot size={17} className="text-teal-300" />
                    Live AI Reliability Review
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs">
                    <span className="rounded-lg bg-black/20 px-2 py-1 text-slate-200">
                      Status: {liveAgent.status}
                    </span>
                    {liveAgent.provider && (
                      <span className="rounded-lg bg-black/20 px-2 py-1 text-slate-200">
                        Provider: {liveAgent.provider}
                      </span>
                    )}
                    {liveAgent.modelUsed && (
                      <span className="rounded-lg bg-black/20 px-2 py-1 text-slate-200">
                        Model: {liveAgent.modelUsed}
                      </span>
                    )}
                  </div>
                </div>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-200">
                  {liveAgent.response}
                </p>
                {liveAgent.error && (
                  <p className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                    Live endpoint note: {liveAgent.error}
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="hidden space-y-4">
            <div className="rounded-2xl border border-teal-300/20 bg-[#0D131A]/90 p-5 shadow-xl shadow-black/20">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-[#E6EDF3]">
                  <Bot size={17} className="text-teal-300" />
                  Agent Runtime
                </div>
                <span className="rounded-full border border-teal-300/20 bg-teal-300/10 px-2.5 py-1 text-xs font-semibold text-teal-200">
                  visible work
                </span>
              </div>
              <div className="mt-4 space-y-2">
                {agentRuntimeSteps.map((step) => (
                  <AgentRuntimeStep key={step.agent} {...step} />
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-white/[0.08] bg-[#0D131A]/90 p-5 shadow-xl shadow-black/20">
              <div className="flex items-center gap-2 text-sm font-semibold text-[#E6EDF3]">
                <ShieldCheck size={17} className="text-teal-300" />
                Decision Snapshot
              </div>
              <div className="mt-4 space-y-3">
                <DecisionRow
                  label="Risk"
                  value={report.riskLevel}
                  tone="amber"
                />
                <DecisionRow label="Confidence" value={report.confidence} />
                <DecisionRow
                  label="Approval"
                  value={report.approvalBoundary[0]}
                />
                <DecisionRow
                  label="RAG"
                  value={report.sources[0]?.source ?? "General guidance"}
                />
              </div>
            </div>

            <div className="rounded-2xl border border-white/[0.08] bg-[#0D131A]/90 p-5 shadow-xl shadow-black/20">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-[#E6EDF3]">
                    RAM Calculator
                  </h2>
                  <p className="text-sm text-slate-400">
                    Deterministic formulas, not LLM math.
                  </p>
                </div>
                <Gauge size={24} className="text-teal-300" />
              </div>

              {calculation.error ? (
                <div className="mt-4 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200">
                  {calculation.error}
                </div>
              ) : (
                <div className="mt-5 grid grid-cols-2 gap-3">
                  <Metric label="MTBF" value={formatNumber(calculation.mtbf)} />
                  <Metric label="MTTR" value={formatNumber(calculation.mttr)} />
                  <Metric
                    label="Availability"
                    value={formatPercent(calculation.inherentAvailability)}
                  />
                  <Metric
                    label="Failure rate"
                    value={formatNumber(calculation.failureRate, 5)}
                  />
                  <Metric
                    label="Mission reliability"
                    value={formatPercent(calculation.missionReliability)}
                    wide
                  />
                </div>
              )}

              <details className="mt-4 rounded-xl border border-white/[0.06] bg-black/20 p-3">
                <summary className="cursor-pointer text-sm font-semibold text-slate-200">
                  Adjust calculation inputs
                </summary>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  {[
                    ["operatingHours", "Operating hours"],
                    ["failures", "Failures"],
                    ["repairHours", "Repair hours"],
                    ["repairEvents", "Repair events"],
                    ["missionTime", "Mission time"],
                  ].map(([key, label]) => (
                    <label key={key} className="space-y-1">
                      <span className="text-xs font-medium text-slate-400">
                        {label}
                      </span>
                      <input
                        value={inputs[key as keyof typeof inputs]}
                        onChange={(event) =>
                          handleInputChange(
                            key as keyof typeof inputs,
                            event.target.value,
                          )
                        }
                        className="w-full rounded-lg border border-white/[0.08] bg-black/20 px-3 py-2 text-sm text-[#E6EDF3] outline-none focus:border-teal-500/60"
                      />
                    </label>
                  ))}
                </div>
              </details>
            </div>
          </div>
        </section>
      )}

      {activeWorkspace === "evidence" && (
        <section className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.2fr)_420px]">
          <div className="rounded-2xl border border-white/[0.08] bg-[#0D131A]/90 p-5 shadow-2xl shadow-black/20">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-300/80">
                  Evidence room
                </div>
                <h2 className="mt-1 text-xl font-semibold tracking-tight text-[#F8FAFC]">
                  Source Trail And Governance
                </h2>
                <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-400">
                  This screen is the audit surface: what was used, what was
                  calculated, what is uncertain, and what requires human
                  approval before implementation.
                </p>
              </div>
              <button
                onClick={exportReport}
                className="inline-flex items-center gap-2 rounded-xl border border-white/[0.08] px-4 py-2.5 text-sm font-semibold text-slate-200 transition-colors hover:bg-white/[0.04]"
              >
                <Download size={16} />
                Export Evidence Pack
              </button>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-3">
              <EvidenceTile
                icon={BookOpenText}
                label="Primary Source"
                value={report.sources[0]?.source ?? "General guidance"}
              />
              <EvidenceTile
                icon={Gauge}
                label="Availability"
                value={
                  calculation.error
                    ? "Invalid inputs"
                    : formatPercent(calculation.inherentAvailability)
                }
              />
              <EvidenceTile
                icon={AlertTriangle}
                label="Approval Gate"
                value="Qualified review required"
              />
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl border border-white/[0.06] bg-black/20 p-4">
                <div className="text-sm font-semibold text-[#F8FAFC]">
                  Retrieved knowledge
                </div>
                <div className="mt-3 space-y-3">
                  {report.sources.map((source) => (
                    <div
                      key={source.id}
                      className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-3"
                    >
                      <div className="text-sm font-semibold text-[#E6EDF3]">
                        {source.source}
                      </div>
                      <div className="mt-1 text-sm text-slate-400">
                        {source.title}
                      </div>
                      <div className="mt-2 text-xs text-slate-400">
                        Confidence: {source.confidence}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-white/[0.06] bg-black/20 p-4">
                <div className="text-sm font-semibold text-[#F8FAFC]">
                  Data quality and assumptions
                </div>
                <div className="mt-3 space-y-3">
                  {report.dataQualityFindings.map((finding) => (
                    <div
                      key={finding.issue}
                      className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-3"
                    >
                      <div className="text-sm font-semibold text-[#E6EDF3]">
                        {finding.issue}
                      </div>
                      <div className="mt-1 text-sm text-slate-400">
                        {finding.nextAction}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl border border-teal-300/20 bg-[#0D131A]/90 p-5 shadow-xl shadow-black/20">
              <div className="flex items-center gap-2 text-sm font-semibold text-[#E6EDF3]">
                <Bot size={17} className="text-teal-300" />
                Agent Work Trace
              </div>
              <div className="mt-4 space-y-2">
                {agentRuntimeSteps.map((step) => (
                  <AgentRuntimeStep key={step.agent} {...step} />
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-white/[0.08] bg-[#0D131A]/90 p-5 shadow-xl shadow-black/20">
              <div className="text-sm font-semibold text-[#F8FAFC]">
                Deterministic report
              </div>
              <pre className="mt-3 max-h-[520px] overflow-auto whitespace-pre-wrap rounded-xl border border-white/[0.06] bg-black/30 p-4 text-xs leading-5 text-slate-200">
                {report.markdown}
              </pre>
            </div>
          </div>
        </section>
      )}

      {activeWorkspace === "analysis" && (
        <details className="glass rounded-xl border border-white/[0.06] p-4">
          <summary className="cursor-pointer text-sm font-semibold text-[#E6EDF3]">
            Bad actor detail
          </summary>
          <section className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {report.badActors.slice(0, 4).map((actor, index) => (
              <div
                key={actor.assetId}
                className="glass rounded-xl border border-white/[0.06] p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="rounded-lg bg-teal-500/10 p-2">
                    <BarChart3 size={19} className="text-teal-300" />
                  </div>
                  <span className="rounded-lg bg-white/[0.04] px-2 py-1 text-xs font-medium text-slate-300">
                    #{index + 1}
                  </span>
                </div>
                <h3 className="mt-4 text-sm font-semibold text-[#E6EDF3]">
                  {actor.assetId}
                </h3>
                <p className="mt-2 text-sm text-slate-400">
                  {formatNumber(actor.downtimeHours)} downtime hours,{" "}
                  {actor.failures} failures, top mode: {actor.topFailureMode}.
                </p>
              </div>
            ))}
          </section>
        </details>
      )}

      <details className="glass rounded-xl border border-white/[0.06] p-4">
        <summary className="cursor-pointer text-sm font-semibold text-[#E6EDF3]">
          Product capabilities and go-to-market notes
        </summary>
        <section className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {workflowCards.map((card) => {
            const Icon = card.icon;
            return (
              <div
                key={card.title}
                className="glass rounded-xl border border-white/[0.06] p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="rounded-lg bg-teal-500/10 p-2">
                    <Icon size={19} className="text-teal-300" />
                  </div>
                  <span className="rounded-lg bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-300">
                    MVP
                  </span>
                </div>
                <h3 className="mt-4 text-sm font-semibold text-[#E6EDF3]">
                  {card.title}
                </h3>
                <p className="mt-2 text-sm text-slate-400">{card.detail}</p>
              </div>
            );
          })}
        </section>

        <section className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Signal
            icon={Wrench}
            label="First sellable outcome"
            value="RCA + FRACAS starter pack from customer maintenance data"
          />
          <Signal
            icon={BarChart3}
            label="Expansion motion"
            value="Bad actors, PM optimization, executive reliability report"
          />
          <Signal
            icon={ShieldCheck}
            label="Marketplace posture"
            value="Private Teams app first, AppSource listing after pilot proof"
          />
        </section>
      </details>
    </div>
  );
}

function CompactMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-medium text-slate-400">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold capitalize text-[#E6EDF3]">
        {value}
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  wide = false,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border border-white/[0.06] bg-black/20 p-3 ${wide ? "col-span-2" : ""}`}
    >
      <div className="text-xs text-slate-400">{label}</div>
      <div className="mt-1 text-xl font-bold text-[#E6EDF3]">{value}</div>
    </div>
  );
}

function DecisionRow({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "amber";
}) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-black/20 p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </div>
      <div
        className={`mt-1 text-sm font-semibold ${
          tone === "amber" ? "text-amber-200" : "text-[#E6EDF3]"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function AgentRuntimeStep({
  icon: Icon,
  agent,
  status,
  detail,
  state,
  compact = false,
}: {
  icon: typeof Wrench;
  agent: string;
  status: string;
  detail: string;
  state: string;
  compact?: boolean;
}) {
  const stateClass =
    state === "attention"
      ? "border-amber-300/20 bg-amber-300/[0.07] text-amber-200"
      : state === "active"
        ? "border-teal-300/25 bg-teal-300/[0.08] text-teal-200"
        : "border-white/[0.06] bg-white/[0.03] text-slate-300";

  return (
    <div className={`rounded-xl border p-3 ${stateClass}`}>
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-black/20 p-2">
          <Icon size={compact ? 15 : 16} className="text-current" />
        </div>
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
            {agent}
          </div>
          <div className="mt-1 text-sm font-semibold text-[#F8FAFC]">
            {status}
          </div>
          <div className="mt-1 text-xs leading-5 text-slate-400">{detail}</div>
        </div>
      </div>
    </div>
  );
}

function ChatBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[92%] rounded-2xl border px-3 py-2.5 ${
          isUser
            ? "border-teal-300/25 bg-teal-300/[0.12] text-teal-50"
            : isSystem
              ? "border-white/[0.08] bg-white/[0.035] text-slate-300"
              : "border-white/[0.08] bg-black/30 text-slate-200"
        }`}
      >
        <div className="flex items-center gap-2">
          {isUser ? (
            <MessageSquare size={14} className="text-teal-300" />
          ) : isSystem ? (
            <ShieldCheck size={14} className="text-slate-400" />
          ) : (
            <Bot size={14} className="text-teal-300" />
          )}
          <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
            {isUser ? "You" : isSystem ? "System" : "SyncAI"}
          </span>
          {message.meta && (
            <span className="truncate rounded-full bg-white/[0.05] px-2 py-0.5 text-xs text-slate-400">
              {message.meta}
            </span>
          )}
        </div>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-6">
          {message.text}
        </p>
      </div>
    </div>
  );
}

function LiveWorkItem({ label, status }: { label: string; status: string }) {
  const Icon =
    status === "complete"
      ? CheckCircle2
      : status === "active"
        ? RefreshCw
        : Clock3;

  return (
    <div
      className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${
        status === "complete"
          ? "border-emerald-300/15 bg-emerald-300/[0.06] text-emerald-200"
          : status === "active"
            ? "border-teal-300/25 bg-teal-300/[0.09] text-teal-200"
            : "border-white/[0.06] bg-white/[0.025] text-slate-400"
      }`}
    >
      <Icon size={16} className={status === "active" ? "animate-spin" : ""} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-[#F8FAFC]">
          {label}
        </div>
        <div className="text-xs capitalize text-slate-400">{status}</div>
      </div>
    </div>
  );
}

function EvidenceTile({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Wrench;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-black/20 p-4">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
        <Icon size={15} className="text-teal-300" />
        {label}
      </div>
      <div className="mt-2 text-sm font-semibold text-[#F8FAFC]">{value}</div>
    </div>
  );
}

function Signal({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Wrench;
  label: string;
  value: string;
}) {
  return (
    <div className="glass flex items-start gap-3 rounded-xl border border-white/[0.06] p-4">
      <div className="rounded-lg bg-white/[0.04] p-2">
        <Icon size={18} className="text-teal-300" />
      </div>
      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          {label}
        </div>
        <div className="mt-1 text-sm text-[#E6EDF3]">{value}</div>
      </div>
    </div>
  );
}
