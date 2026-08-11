import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
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
import {
  runLiveReliabilityAgent,
  type LiveReliabilityAgentResult,
} from "../services/reliabilityCopilotAgent";
import { GovernedEngineeringLoop } from "../components/GovernedEngineeringLoop";

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

function scrollToWorkspaceElement(
  id: string,
  block: ScrollLogicalPosition = "start",
) {
  document.getElementById(id)?.scrollIntoView?.({
    behavior: "smooth",
    block,
  });
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

function getJourneyPrompt(): string {
  if (typeof window === "undefined") return initialPrompt;

  const params = new URLSearchParams(window.location.search);
  const asset = params.get("asset")?.trim();
  const pain = params.get("pain")?.trim();
  const role = params.get("role")?.trim();

  if (!asset && !pain && !role) return initialPrompt;

  return [
    `Analyze ${asset || "this reliability opportunity"}.`,
    pain ? `Focus on: ${pain}.` : "",
    role ? `Prepare the decision for the ${role} role.` : "",
    "Rank where the next dollar should go, identify the first risk, recommend the governed action, and define how value will be verified.",
  ]
    .filter(Boolean)
    .join(" ");
}

const sampleDecisionPrompt =
  "Run the sample decision packet: rank the next reliability dollar, identify the first risk to address, recommend the governed action, and define how value will be verified.";

const FREE_TRIAL_TOKEN_ALLOWANCE = 12000;
const FREE_TRIAL_USAGE_STORAGE_KEY = "syncai.reliability.freeUsage.v1";

type FreeTrialUsage = {
  tokensUsed: number;
  decisionPackets: number;
};

type WorkspaceView = "analysis" | "onboarding" | "evidence";

type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  meta?: string;
};

type ValueProofInputs = {
  actionCost: string;
  downtimeHourValue: string;
  expectedAvoidedHours: string;
  verificationWindowDays: string;
  owner: string;
};

const executiveSignals = [
  { label: "Evidence", value: "Grounded", detail: "source to asset" },
  { label: "Analysis", value: "Deterministic", detail: "visible math" },
  { label: "Authority", value: "Human", detail: "qualified approval" },
  { label: "Action", value: "Controlled", detail: "work and change" },
  { label: "Outcome", value: "Verified", detail: "measured to learned" },
];

const valueDecisionCards = [
  {
    title: "Where should we spend next?",
    detail: "Rank assets, sites, and failure modes by risk-adjusted value.",
    metric: "Next CAD",
    prompt:
      "Rank the next reliability dollar across the sample assets using risk-adjusted value, then explain the evidence and approval boundary.",
    icon: BarChart3,
  },
  {
    title: "Which risk comes first?",
    detail:
      "Balance safety, availability, production, environmental, and cost exposure.",
    metric: "Priority risk",
    prompt:
      "Prioritize the first reliability risk to address using safety, production, environmental, availability, and cost exposure.",
    icon: AlertTriangle,
  },
  {
    title: "What action should be taken?",
    detail:
      "Choose inspection, redesign, PM change, spares, operating change, or escalation.",
    metric: "Governed action",
    prompt:
      "Recommend the smallest governed action that will reduce or validate the top reliability risk, including owner and approval gate.",
    icon: Wrench,
  },
  {
    title: "Did it create value, and what changes next?",
    detail:
      "Verify realized outcomes and feed the evidence into the next decision.",
    metric: "Verify + learn",
    prompt:
      "Build a value verification and learning plan for the recommended action, separating estimated, approved, and realized value and defining what should update next.",
    icon: CheckCircle2,
  },
];

const industryProfiles = [
  "Oil sands and upstream",
  "Refining and chemicals",
  "High-volume manufacturing",
  "Battery and energy systems",
];

const enterpriseReadiness = [
  "Process safety",
  "Asset integrity",
  "AI safety",
  "Financial controls",
  "Workforce reality",
  "Decision traceability",
];

function estimateTokenUsage(text: string): number {
  return Math.ceil(text.trim().length / 4);
}

function estimateDecisionPacketCost({
  mode,
  prompt,
  csvText,
}: {
  mode: CopilotMode;
  prompt: string;
  csvText: string;
}): number {
  const baseWorkflowCost = 1800;
  const responseAllowance = 1400;
  const inputCost = estimateTokenUsage([mode, prompt, csvText].join("\n"));

  return Math.max(3200, inputCost + baseWorkflowCost + responseAllowance);
}

function loadFreeTrialUsage(): FreeTrialUsage {
  if (
    typeof window === "undefined" ||
    typeof window.localStorage?.getItem !== "function"
  ) {
    return { tokensUsed: 0, decisionPackets: 0 };
  }

  try {
    const saved = window.localStorage.getItem(FREE_TRIAL_USAGE_STORAGE_KEY);
    if (!saved) return { tokensUsed: 0, decisionPackets: 0 };
    const parsed = JSON.parse(saved) as Partial<FreeTrialUsage>;

    return {
      tokensUsed: Math.max(0, Number(parsed.tokensUsed) || 0),
      decisionPackets: Math.max(0, Number(parsed.decisionPackets) || 0),
    };
  } catch {
    return { tokensUsed: 0, decisionPackets: 0 };
  }
}

function saveFreeTrialUsage(usage: FreeTrialUsage) {
  if (
    typeof window === "undefined" ||
    typeof window.localStorage?.setItem !== "function"
  ) {
    return;
  }

  try {
    window.localStorage.setItem(
      FREE_TRIAL_USAGE_STORAGE_KEY,
      JSON.stringify(usage),
    );
  } catch {
    // Demo metering should not interrupt the reliability workflow.
  }
}

function trackTrialEvent(
  eventName: string,
  metadata: Record<string, string | number | boolean> = {},
) {
  if (typeof window === "undefined") return;
  const payload = {
    event: eventName,
    page: "reliability_copilot_demo",
    ...metadata,
  };
  const analyticsWindow = window as Window & {
    dataLayer?: Array<Record<string, unknown>>;
  };

  analyticsWindow.dataLayer?.push(payload);

  if (import.meta.env.DEV) {
    console.info("[SyncAI trial event]", payload);
  }
}

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
  const [journeyPrompt] = useState(() => getJourneyPrompt());
  const [prompt, setPrompt] = useState(journeyPrompt);
  const [csvText, setCsvText] = useState(SAMPLE_FAILURE_HISTORY_CSV);
  const [report, setReport] = useState<ReliabilityReport>(() =>
    generateReliabilityReport({
      mode: "RCA",
      prompt: journeyPrompt,
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
  const [valueProofInputs, setValueProofInputs] = useState<ValueProofInputs>({
    actionCost: "12500",
    downtimeHourValue: "8500",
    expectedAvoidedHours: "22",
    verificationWindowDays: "90",
    owner: "Reliability engineer",
  });
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
  const [freeTrialUsage, setFreeTrialUsage] = useState<FreeTrialUsage>(() =>
    loadFreeTrialUsage(),
  );

  const estimatedCurrentRunCost = useMemo(
    () => estimateDecisionPacketCost({ mode, prompt, csvText }),
    [csvText, mode, prompt],
  );
  const freeTrialRemaining = Math.max(
    0,
    FREE_TRIAL_TOKEN_ALLOWANCE - freeTrialUsage.tokensUsed,
  );
  const freeTrialPercentUsed = Math.min(
    100,
    Math.round((freeTrialUsage.tokensUsed / FREE_TRIAL_TOKEN_ALLOWANCE) * 100),
  );
  const freeTrialPercentRemaining = Math.max(0, 100 - freeTrialPercentUsed);
  const freeTrialIsExhausted = freeTrialRemaining <= 0;
  const customerAgentStatus =
    liveAgent.status === "disabled" ? "ready" : liveAgent.status;
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

  const handleValueProofInputChange = (
    key: keyof ValueProofInputs,
    value: string,
  ) => {
    setValueProofInputs((current) => ({ ...current, [key]: value }));
  };

  const valueProof = useMemo(() => {
    const actionCost = asNumber(valueProofInputs.actionCost);
    const downtimeHourValue = asNumber(valueProofInputs.downtimeHourValue);
    const expectedAvoidedHours = asNumber(
      valueProofInputs.expectedAvoidedHours,
    );
    const verificationWindowDays = asNumber(
      valueProofInputs.verificationWindowDays,
    );
    const estimatedAvoidedCost = downtimeHourValue * expectedAvoidedHours;
    const netValue = estimatedAvoidedCost - actionCost;
    const roiPercent =
      actionCost > 0 ? Math.round((netValue / actionCost) * 100) : 0;

    return {
      actionCost,
      downtimeHourValue,
      expectedAvoidedHours,
      verificationWindowDays,
      estimatedAvoidedCost,
      netValue,
      roiPercent,
    };
  }, [valueProofInputs]);

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

  const generateReport = async (
    options: {
      promptOverride?: string;
      modeOverride?: CopilotMode;
      csvTextOverride?: string;
    } = {},
  ) => {
    const activeMode = options.modeOverride ?? mode;
    const activeCsvText = options.csvTextOverride ?? csvText;
    const submittedPrompt =
      options.promptOverride?.trim() || prompt.trim() || journeyPrompt;
    const estimatedCost = estimateDecisionPacketCost({
      mode: activeMode,
      prompt: submittedPrompt,
      csvText: activeCsvText,
    });
    const hasRunCapacity =
      freeTrialRemaining >= estimatedCost || freeTrialUsage.tokensUsed === 0;

    if (!hasRunCapacity) {
      trackTrialEvent("free_capacity_cutoff", {
        decisionPackets: freeTrialUsage.decisionPackets,
        tokensUsed: freeTrialUsage.tokensUsed,
      });
      setActiveWorkspace("analysis");
      setChatMessages((current) => [
        ...current,
        {
          id: `assistant-limit-${Date.now()}`,
          role: "assistant",
          text: "You have used the included free analysis capacity. Start a 48-hour value proof to use sanitized customer data, then continue into a secure workspace to save cases, collaborate with your team, and verify realized value after execution.",
          meta: "Free capacity reached",
        },
      ]);
      return;
    }

    setActiveWorkspace("analysis");
    setChatMessages((current) => [
      ...current,
      {
        id: `user-${Date.now()}`,
        role: "user",
        text: submittedPrompt,
        meta: activeMode,
      },
    ]);

    const onboarding = parseAssetOnboardingCommand(submittedPrompt);
    if (onboarding.isOnboarding) {
      const nextSession = createAssetOnboardingSession({
        commandText: submittedPrompt,
      });
      setOnboardingCommand(submittedPrompt);
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
      mode: activeMode,
      prompt: submittedPrompt,
      csvText: activeCsvText,
      inputs: {
        operatingHours: asNumber(inputs.operatingHours),
        failures: asNumber(inputs.failures),
        repairHours: asNumber(inputs.repairHours),
        repairEvents: asNumber(inputs.repairEvents),
        missionTimeHours: asNumber(inputs.missionTime),
      },
    });
    const nextFreeTrialUsage = {
      tokensUsed: Math.min(
        FREE_TRIAL_TOKEN_ALLOWANCE,
        freeTrialUsage.tokensUsed + estimatedCost,
      ),
      decisionPackets: freeTrialUsage.decisionPackets + 1,
    };
    setFreeTrialUsage(nextFreeTrialUsage);
    saveFreeTrialUsage(nextFreeTrialUsage);
    setReport(nextReport);
    setLastGeneratedMode(activeMode);
    setIsRunningLiveAgent(true);
    setLiveAgent({
      status: "disabled",
      response: "Running live AI reliability review...",
    });
    const liveResult = await runLiveReliabilityAgent({
      mode: activeMode,
      prompt: submittedPrompt,
      csvText: activeCsvText,
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
    trackTrialEvent("decision_packet_generated", {
      mode: activeMode,
      decisionPackets: nextFreeTrialUsage.decisionPackets,
      tokensUsed: nextFreeTrialUsage.tokensUsed,
    });
    window.requestAnimationFrame(() => {
      scrollToWorkspaceElement("decision-thread");
    });
  };

  const runSampleDecisionPacket = () => {
    setPrompt(sampleDecisionPrompt);
    setMode("Executive Brief");
    setActiveWorkspace("analysis");
    void generateReport({
      promptOverride: sampleDecisionPrompt,
      modeOverride: "Executive Brief",
    });
  };

  const selectDecisionQuestion = (
    card: (typeof valueDecisionCards)[number],
  ) => {
    setActiveWorkspace("analysis");
    setPrompt(card.prompt);
    trackTrialEvent("decision_question_selected", { question: card.metric });
    window.requestAnimationFrame(() => {
      scrollToWorkspaceElement("syncai-chat", "center");
    });
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
      setOnboardingSaveMessage(
        `${messagePrefix} Saved via ${
          result.mode === "supabase"
            ? "tenant database"
            : "browser demo storage"
        }.${result.warning ? ` ${result.warning}` : ""}`,
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
    const nextSession = applyAssetOnboardingAnswer({
      session: onboardingSession,
      answer: onboardingAnswer,
    });
    setOnboardingSession(nextSession);
    setOnboardingAnswer(getOnboardingSampleAnswer(nextSession));
    await persistOnboardingSession(nextSession, "Step saved.");
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
    <div className="mx-auto max-w-[1440px] space-y-4 pb-16">
      <section className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-[linear-gradient(135deg,rgba(13,19,26,0.98),rgba(8,12,17,0.99))] p-4 shadow-xl shadow-black/20 md:p-6">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-teal-300/50 to-transparent" />
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_430px]">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-teal-300/20 bg-teal-300/10 px-3 py-1 text-xs font-medium text-teal-200">
              <Bot size={14} />
              Industrial value decision intelligence
            </div>
            <h1 className="mt-4 max-w-4xl text-3xl font-semibold text-[#F8FAFC] md:text-5xl">
              Know where the next reliability dollar should go.
            </h1>
            <p className="mt-4 max-w-3xl text-base leading-[1.65] text-slate-300">
              SyncAI connects approved engineering knowledge to asset state and
              operational evidence, calculates deterministic options, preserves
              human technical authority, controls the action, and verifies what
              changed afterward.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              {industryProfiles.map((profile) => (
                <span
                  key={profile}
                  className="rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-slate-300"
                >
                  {profile}
                </span>
              ))}
            </div>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <button
                onClick={runSampleDecisionPacket}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-teal-400 px-5 py-3 text-sm font-semibold text-slate-950 shadow-lg shadow-teal-950/20 transition-colors hover:bg-teal-300"
              >
                <Sparkles size={16} />
                Run sample decision packet
              </button>
              <a
                href="/setup"
                onClick={() => trackTrialEvent("secure_workspace_clicked")}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/[0.1] px-5 py-3 text-sm font-semibold text-slate-200 transition-colors hover:bg-white/[0.05]"
              >
                <ShieldCheck size={16} />
                Start 48-hour value proof
              </a>
            </div>

            <div
              id="syncai-chat"
              className="mt-6 scroll-mt-24 border-y border-white/[0.08] py-4"
            >
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-teal-300">
                  <MessageSquare size={14} />
                  Ask SyncAI
                </div>
                <span className="text-xs text-slate-500">
                  {freeTrialPercentRemaining}% complimentary capacity
                </span>
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
                className="min-h-24 w-full resize-none rounded-lg border border-white/[0.1] bg-black/30 p-3 text-sm leading-[1.6] text-[#E6EDF3] outline-none transition-colors placeholder:text-slate-500 focus:border-teal-400/70 focus:ring-4 focus:ring-teal-400/10"
                placeholder="Describe the asset, failure pattern, risk, or decision you need to make..."
                aria-label="SyncAI chat input"
              />
              <div className="mt-2 flex items-center justify-between gap-3">
                <span className="hidden text-xs text-slate-500 sm:block">
                  Examples and non-sensitive context only
                </span>
                <button
                  type="button"
                  onClick={() => void generateReport()}
                  disabled={!!calculation.error || isRunningLiveAgent}
                  className="ml-auto inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-teal-400 px-5 text-sm font-semibold text-slate-950 transition-colors hover:bg-teal-300 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isRunningLiveAgent ? (
                    <RefreshCw size={16} />
                  ) : (
                    <Send size={16} />
                  )}
                  {isRunningLiveAgent ? "Working" : "Build decision packet"}
                </button>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-teal-300/20 bg-[linear-gradient(180deg,rgba(20,184,166,0.12),rgba(0,0,0,0.18))] p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-200">
                  Decision packet preview
                </div>
                <div className="mt-1 text-lg font-semibold text-[#F8FAFC]">
                  Governed decision recommendation
                </div>
              </div>
              <ShieldCheck size={22} className="text-teal-300" />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Metric label="Top risk" value={report.riskLevel} />
              <Metric
                label="Top asset"
                value={report.badActors[0]?.assetId ?? "Pending"}
              />
              <Metric
                label="Availability"
                value={
                  calculation.error
                    ? "Check inputs"
                    : formatPercent(calculation.inherentAvailability)
                }
              />
              <Metric label="Confidence" value={report.confidence} />
            </div>
            <div className="mt-4 rounded-xl border border-amber-300/20 bg-amber-300/[0.08] p-3 text-sm leading-[1.6] text-amber-100">
              Safety, environmental, regulatory, OEM limit, and
              production-critical changes require qualified engineering
              approval.
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {valueDecisionCards.map((card) => {
            const Icon = card.icon;
            return (
              <button
                key={card.title}
                onClick={() => selectDecisionQuestion(card)}
                className="rounded-2xl border border-white/[0.07] bg-white/[0.035] p-4 text-left transition-colors hover:border-teal-300/25 hover:bg-teal-300/[0.06]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="rounded-xl bg-teal-300/10 p-2 text-teal-200">
                    <Icon size={18} />
                  </div>
                  <span className="rounded-full bg-black/25 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                    {card.metric}
                  </span>
                </div>
                <div className="mt-4 text-sm font-semibold text-[#F8FAFC]">
                  {card.title}
                </div>
                <p className="mt-2 text-sm leading-[1.6] text-slate-400">
                  {card.detail}
                </p>
              </button>
            );
          })}
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-5">
          {executiveSignals.map((signal) => (
            <div
              key={signal.label}
              className="rounded-xl border border-white/[0.07] bg-black/20 px-4 py-3"
            >
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                {signal.label}
              </div>
              <div className="mt-1 text-lg font-semibold text-[#F8FAFC]">
                {signal.value}
              </div>
              <div className="mt-0.5 text-xs text-slate-500">
                {signal.detail}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          {enterpriseReadiness.map((item) => (
            <span
              key={item}
              className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-black/20 px-3 py-1.5 text-xs font-medium text-slate-300"
            >
              <CheckCircle2 size={13} className="text-teal-300" />
              {item}
            </span>
          ))}
        </div>

        <FreeCapacityPanel
          percentUsed={freeTrialPercentUsed}
          percentRemaining={freeTrialPercentRemaining}
          packetsGenerated={freeTrialUsage.decisionPackets}
          estimatedRunCost={estimatedCurrentRunCost}
          remainingTokens={freeTrialRemaining}
          isExhausted={freeTrialIsExhausted}
        />
      </section>

      <GovernedEngineeringLoop />

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
            <p className="mt-1 text-xs leading-[1.45] text-slate-500">
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
            <p className="mt-1 text-xs leading-[1.45] text-slate-500">
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
            <p className="mt-1 text-xs leading-[1.45] text-slate-500">
              Source trail, deterministic math, and approval controls.
            </p>
          </button>
          <div className="grid grid-cols-3 gap-2 rounded-xl border border-white/[0.06] bg-black/20 p-3">
            <CompactMetric label="Risk" value={report.riskLevel} />
            <CompactMetric
              label="Readiness"
              value={onboardingSession.reliabilityReadiness}
            />
            <CompactMetric
              label="Free capacity"
              value={`${freeTrialPercentRemaining}% left`}
            />
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
                <div className="text-xs text-slate-500">Completion</div>
                <div className="mt-1 text-2xl font-bold text-[#E6EDF3]">
                  {onboardingSession.completionScore}%
                </div>
              </div>
              <div className="rounded-lg border border-white/[0.06] bg-black/20 p-3">
                <div className="text-xs text-slate-500">Readiness</div>
                <div className="mt-1 text-lg font-bold capitalize text-teal-300">
                  {onboardingSession.reliabilityReadiness}
                </div>
              </div>
              <div className="rounded-lg border border-white/[0.06] bg-black/20 p-3">
                <div className="text-xs text-slate-500">Mode</div>
                <div className="mt-1 text-lg font-bold capitalize text-[#E6EDF3]">
                  {onboardingSession.mode}
                </div>
              </div>
              <div className="rounded-lg border border-white/[0.06] bg-black/20 p-3">
                <div className="text-xs text-slate-500">Lifecycle</div>
                <div className="mt-1 text-sm font-bold text-[#E6EDF3]">
                  {getAssetOnboardingLifecycleLabel(
                    onboardingSession.lifecycle,
                  )}
                </div>
              </div>
              <div className="rounded-lg border border-white/[0.06] bg-black/20 p-3">
                <div className="text-xs text-slate-500">Template</div>
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
                    <p className="mt-1 text-sm text-slate-500">
                      {currentOnboardingStep.purpose}
                    </p>
                  </div>
                  <span className="rounded-lg bg-white/[0.04] px-2 py-1 text-xs font-medium text-slate-300">
                    {currentOnboardingStep.completionScore}% complete
                  </span>
                </div>
                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
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
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
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
                    <p className="mt-1 text-sm text-slate-500">
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
                        <div className="mt-1 text-xs capitalize text-slate-500">
                          {session.assetClass.replace("_", " ")} ·{" "}
                          {session.mode} · {session.lifecycle.replace("_", " ")}{" "}
                          · {session.industry.replace("_", " ")} ·{" "}
                          {session.completionScore}% ·{" "}
                          {session.currentStep.replace("_", " ")}
                        </div>
                      </button>
                    ))
                  ) : (
                    <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] p-3 text-sm text-slate-500 md:col-span-2">
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
                <p className="mt-2 text-sm text-slate-500">
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
                          <div className="text-xs capitalize text-slate-500">
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
                  Live value decision workspace
                </div>
                <h2 className="mt-1 text-lg font-semibold tracking-tight text-[#F8FAFC]">
                  Turn failure history into a spend, risk, action, and value
                  decision
                </h2>
                <p className="text-sm text-slate-500">
                  Select a reliability method, add context, and produce a
                  review-ready packet that links technical action to verified
                  business value.
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
              <div className="rounded-2xl border border-amber-300/20 bg-amber-300/[0.08] p-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle size={18} className="mt-0.5 text-amber-300" />
                  <div>
                    <div className="text-sm font-semibold text-amber-100">
                      Free mode is for examples and non-sensitive context
                    </div>
                    <p className="mt-1 text-sm leading-[1.6] text-amber-100/80">
                      Do not enter confidential site data, controlled documents,
                      personal information, or proprietary operating history in
                      the free demo. Use the secure workspace for
                      tenant-isolated company analysis.
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid gap-3 lg:grid-cols-4">
                <ValueLensCard
                  label="Spend next"
                  value={
                    report.badActors[0]
                      ? `${report.badActors[0].assetId} bad actor`
                      : "Highest value asset"
                  }
                  detail="Direct the next maintenance dollar to the repeat pattern with the clearest exposure."
                />
                <ValueLensCard
                  label="Address first"
                  value={`${report.riskLevel} risk`}
                  detail="Prioritize by safety, production, environmental, and cost consequence."
                />
                <ValueLensCard
                  label="Take action"
                  value={
                    report.governedRecommendations[0]?.recommendation ??
                    report.actions[0]
                  }
                  detail="Create the smallest controlled work or change package that can validate or reduce the risk."
                />
                <ValueLensCard
                  label="Verify and learn"
                  value="Estimated -> approved -> verified -> learned"
                  detail="Measure the outcome, preserve the result, and update the next engineering decision."
                />
              </div>

              <ValueProofPanel
                inputs={valueProofInputs}
                proof={valueProof}
                onChange={handleValueProofInputChange}
              />

              <ProofHandoffPanel />

              <div className="grid min-h-[620px] min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
                <div
                  id="decision-thread"
                  className="scroll-mt-24 flex min-h-[620px] min-w-0 flex-col rounded-2xl border border-white/[0.08] bg-[#080C11] shadow-xl shadow-black/20"
                >
                  <div className="order-1 border-b border-white/[0.06] p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <div className="flex items-center gap-2 text-base font-semibold text-[#F8FAFC]">
                          <MessageSquare size={18} className="text-teal-300" />
                          Decision Thread
                        </div>
                        <p className="mt-1 text-sm leading-[1.6] text-slate-500">
                          Approved intent, evidence, calculation, authority,
                          controlled action, outcome, and learning stay
                          together.
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
                          value={customerAgentStatus}
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
                          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                            Recommendation
                          </div>
                          <p className="mt-1 text-sm leading-[1.6] text-slate-200">
                            {report.recommendations[0]}
                          </p>
                        </div>
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                            Approval Gate
                          </div>
                          <p className="mt-1 text-sm leading-[1.6] text-slate-200">
                            {report.approvalBoundary[0]}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="hidden">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-300">
                        Ask SyncAI
                      </div>
                      <div className="text-xs text-slate-500">
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
                      className="min-h-28 w-full resize-none rounded-2xl border border-teal-300/20 bg-black/45 p-4 text-sm leading-[1.6] text-[#E6EDF3] outline-none transition-colors placeholder:text-slate-500 focus:border-teal-400/70 focus:ring-4 focus:ring-teal-400/10"
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

                <div className="min-w-0 space-y-4">
                  <div className="rounded-2xl border border-white/[0.08] bg-[#080C11] p-4 shadow-xl shadow-black/20">
                    <div className="flex items-center gap-2 text-sm font-semibold text-[#F8FAFC]">
                      <Bot size={17} className="text-teal-300" />
                      Agent Workstream
                    </div>
                    <p className="mt-1 text-xs leading-[1.45] text-slate-500">
                      Real-time feedback from the reliability workflow.
                    </p>
                    <div className="mt-4 rounded-2xl border border-white/[0.07] bg-black/25 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
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
                    <span className="text-xs text-slate-500">
                      Optional CSV intake
                    </span>
                  </div>
                </summary>
                <p className="mt-3 text-sm text-slate-500">
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
                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  <div className="rounded-2xl border border-white/[0.06] bg-black/25 p-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                      Before SyncAI
                    </div>
                    <p className="mt-2 text-sm leading-[1.6] text-slate-300">
                      Scattered work orders, unclear mechanism, competing
                      maintenance requests, and no clean trail from spend to
                      realized value.
                    </p>
                  </div>
                  <div className="rounded-2xl border border-teal-300/20 bg-teal-300/[0.07] p-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.16em] text-teal-200">
                      After SyncAI
                    </div>
                    <p className="mt-2 text-sm leading-[1.6] text-slate-100">
                      Approved intent connected to asset evidence, deterministic
                      analysis completed, controlled action proposed, technical
                      authority preserved, and the outcome ready to verify and
                      learn from.
                    </p>
                  </div>
                </div>
                <div className="mt-3 grid gap-3 text-sm text-slate-300 md:grid-cols-2">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Recommendation
                    </div>
                    <p className="mt-1">{report.recommendations[0]}</p>
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
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
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Next Actions
                    </div>
                    <p className="mt-1">{report.actions[0]}</p>
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Approval Boundary
                    </div>
                    <p className="mt-1">{report.approvalBoundary[0]}</p>
                  </div>
                </div>
                <div className="mt-4 grid gap-3 lg:grid-cols-3">
                  <div className="rounded-xl border border-white/[0.06] bg-black/20 p-3">
                    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
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
                          <div className="text-slate-500">
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
                    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      <ShieldCheck size={15} className="text-teal-300" />
                      Governed Recommendation
                    </div>
                    <p className="mt-2 text-xs text-slate-300">
                      {report.governedRecommendations[0]?.requiredValidation}
                    </p>
                    <p className="mt-2 text-xs text-slate-500">
                      Owner: {report.governedRecommendations[0]?.ownerRole}
                    </p>
                  </div>
                  <div className="rounded-xl border border-white/[0.06] bg-black/20 p-3">
                    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      <AlertTriangle size={15} className="text-amber-300" />
                      Data Quality
                    </div>
                    <p className="mt-2 text-xs text-slate-300">
                      {report.dataQualityFindings[0]?.issue ??
                        "No high-impact data quality issues were detected."}
                    </p>
                    <p className="mt-2 text-xs text-slate-500">
                      {report.dataQualityFindings[0]?.nextAction ??
                        "Keep failure modes, dates, downtime, and repair hours normalized."}
                    </p>
                  </div>
                </div>
                <details className="mt-4 rounded-xl border border-white/[0.06] bg-black/30">
                  <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-200">
                    View full deterministic report
                  </summary>
                  <pre className="max-h-96 overflow-auto whitespace-pre-wrap border-t border-white/[0.06] p-4 text-xs leading-[1.45] text-slate-200">
                    {report.markdown}
                  </pre>
                </details>
              </div>

              <div className="rounded-2xl border border-teal-300/20 bg-teal-300/[0.07] p-4">
                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                  <div className="flex items-center gap-2 text-sm font-semibold text-[#E6EDF3]">
                    <Bot size={17} className="text-teal-300" />
                    Reliability review
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs">
                    <span className="rounded-lg bg-black/20 px-2 py-1 text-slate-200">
                      Status: {customerAgentStatus}
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
                <p className="mt-3 whitespace-pre-wrap text-sm leading-[1.6] text-slate-200">
                  {liveAgent.status === "disabled"
                    ? "The deterministic decision engine is ready. Build a packet to calculate RAM metrics, rank risk, assemble the evidence trail, and apply approval gates."
                    : liveAgent.response}
                </p>
                {liveAgent.error && (
                  <p className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                    The live model was unavailable, so the governed
                    deterministic packet was preserved for review.
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
                  <p className="text-sm text-slate-500">
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
                      <span className="text-xs font-medium text-slate-500">
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
                <p className="mt-1 max-w-3xl text-sm leading-[1.6] text-slate-400">
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
                      <div className="mt-2 text-xs text-slate-500">
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
              <pre className="mt-3 max-h-[520px] overflow-auto whitespace-pre-wrap rounded-xl border border-white/[0.06] bg-black/30 p-4 text-xs leading-[1.45] text-slate-200">
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
                <p className="mt-2 text-sm text-slate-500">
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
          Secure workspace capabilities
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
                    Included
                  </span>
                </div>
                <h3 className="mt-4 text-sm font-semibold text-[#E6EDF3]">
                  {card.title}
                </h3>
                <p className="mt-2 text-sm text-slate-500">{card.detail}</p>
              </div>
            );
          })}
        </section>

        <section className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Signal
            icon={Wrench}
            label="First 48 hours"
            value="RCA + FRACAS starter pack from customer maintenance data"
          />
          <Signal
            icon={BarChart3}
            label="Expand the value"
            value="Bad actors, PM optimization, executive reliability report"
          />
          <Signal
            icon={ShieldCheck}
            label="Enterprise deployment"
            value="Tenant-isolated workspace with governed team access"
          />
        </section>
      </details>
    </div>
  );
}

function FreeCapacityPanel({
  percentUsed,
  percentRemaining,
  packetsGenerated,
  estimatedRunCost,
  remainingTokens,
  isExhausted,
}: {
  percentUsed: number;
  percentRemaining: number;
  packetsGenerated: number;
  estimatedRunCost: number;
  remainingTokens: number;
  isExhausted: boolean;
}) {
  const estimatedRunsRemaining =
    estimatedRunCost > 0 ? Math.floor(remainingTokens / estimatedRunCost) : 0;

  return (
    <div className="mt-5 rounded-2xl border border-white/[0.08] bg-black/20 p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-[#F8FAFC]">
            <Gauge size={17} className="text-teal-300" />
            Complimentary analysis capacity
          </div>
          <p className="mt-1 max-w-3xl text-sm leading-[1.6] text-slate-400">
            Experience a governed decision packet from evidence through
            deterministic analysis, technical authority, controlled action, and
            outcome verification before moving into a secure value proof.
          </p>
        </div>
        <a
          href="/setup"
          onClick={() => trackTrialEvent("secure_workspace_clicked")}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-teal-400 px-4 py-2.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-teal-300"
        >
          Start 48-hour value proof
        </a>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto_auto] md:items-center">
        <div>
          <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className={`h-full rounded-full ${
                isExhausted ? "bg-amber-300" : "bg-teal-300"
              }`}
              style={{ width: `${percentUsed}%` }}
            />
          </div>
          <div className="mt-2 text-xs text-slate-500">
            {isExhausted
              ? "Included free capacity used."
              : `${percentRemaining}% free capacity remaining.`}
          </div>
        </div>
        <CompactMetric
          label="Packets run"
          value={`${packetsGenerated} included`}
        />
        <CompactMetric
          label="Next run"
          value={
            isExhausted || estimatedRunsRemaining < 1
              ? "Secure workspace"
              : "Included"
          }
        />
      </div>
    </div>
  );
}

function ValueLensCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-black/20 p-4">
      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-teal-300/80">
        {label}
      </div>
      <div className="mt-2 line-clamp-2 text-sm font-semibold text-[#F8FAFC]">
        {value}
      </div>
      <p className="mt-2 text-xs leading-[1.45] text-slate-500">{detail}</p>
    </div>
  );
}

function ValueProofPanel({
  inputs,
  proof,
  onChange,
}: {
  inputs: ValueProofInputs;
  proof: {
    estimatedAvoidedCost: number;
    netValue: number;
    roiPercent: number;
    verificationWindowDays: number;
  };
  onChange: (key: keyof ValueProofInputs, value: string) => void;
}) {
  const fields: Array<{
    key: keyof ValueProofInputs;
    label: string;
    prefix?: string;
  }> = [
    { key: "actionCost", label: "Action cost", prefix: "CAD" },
    { key: "downtimeHourValue", label: "Downtime value / hour", prefix: "CAD" },
    { key: "expectedAvoidedHours", label: "Avoided hours" },
    { key: "verificationWindowDays", label: "Verify after days" },
    { key: "owner", label: "Value owner" },
  ];

  return (
    <div className="rounded-2xl border border-teal-300/15 bg-[linear-gradient(135deg,rgba(20,184,166,0.07),rgba(0,0,0,0.2))] p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-[#F8FAFC]">
            <BarChart3 size={17} className="text-teal-300" />
            Value proof model
          </div>
          <p className="mt-1 max-w-3xl text-sm leading-[1.6] text-slate-400">
            Make the recommendation measurable before it becomes work. Track
            estimated value, authorized value, and verified realized value after
            the action window.
          </p>
        </div>
        <div className="grid min-w-full grid-cols-2 gap-2 sm:min-w-[420px]">
          <Metric
            label="Estimated avoided cost"
            value={`CAD ${formatNumber(proof.estimatedAvoidedCost, 0)}`}
          />
          <Metric
            label="Net value"
            value={`CAD ${formatNumber(proof.netValue, 0)}`}
          />
          <Metric label="ROI" value={`${proof.roiPercent}%`} />
          <Metric
            label="Verification"
            value={`${formatNumber(proof.verificationWindowDays, 0)} days`}
          />
        </div>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-5">
        {fields.map((field) => (
          <label key={field.key} className="space-y-1">
            <span className="text-xs font-medium text-slate-500">
              {field.label}
            </span>
            <div className="flex rounded-lg border border-white/[0.08] bg-black/20 focus-within:border-teal-500/60">
              {field.prefix && (
                <span className="border-r border-white/[0.06] px-2 py-2 text-xs font-semibold text-slate-500">
                  {field.prefix}
                </span>
              )}
              <input
                value={inputs[field.key]}
                onChange={(event) => onChange(field.key, event.target.value)}
                className="min-w-0 flex-1 bg-transparent px-2 py-2 text-sm text-[#E6EDF3] outline-none"
                aria-label={field.label}
              />
            </div>
          </label>
        ))}
      </div>
    </div>
  );
}

function ProofHandoffPanel() {
  return (
    <div className="grid gap-4 rounded-2xl border border-teal-300/15 bg-[#07110F] p-5 lg:grid-cols-[1fr_auto] lg:items-center">
      <div>
        <div className="flex items-center gap-2 text-sm font-semibold text-teal-300">
          <PackageCheck size={17} />
          Ready for one-click onboarding?
        </div>
        <p className="mt-2 max-w-3xl text-sm leading-[1.6] text-slate-300">
          Start with a sanitized export for the 48-hour value proof. If the
          packet shows a real opportunity, SyncAI can generate the approved
          baseline, asset-state request, evidence checklist, authority map,
          governance gates, controlled-work handoff, and verification plan in
          one guided step.
        </p>
      </div>
      <div className="flex flex-wrap gap-3 lg:justify-end">
        <a
          href="/setup"
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-teal-500 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-teal-400"
        >
          Start 48-hour value proof
          <ArrowRight size={16} />
        </a>
        <a
          href="/setup#onboarding"
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/[0.08] px-5 py-3 text-sm font-semibold text-slate-200 transition-colors hover:bg-white/[0.05]"
        >
          Preview onboarding
        </a>
      </div>
    </div>
  );
}

function CompactMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-medium text-slate-500">{label}</div>
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
      <div className="text-xs text-slate-500">{label}</div>
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
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
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
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
            {agent}
          </div>
          <div className="mt-1 text-sm font-semibold text-[#F8FAFC]">
            {status}
          </div>
          <div className="mt-1 text-xs leading-[1.45] text-slate-400">
            {detail}
          </div>
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
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            {isUser ? "You" : isSystem ? "System" : "SyncAI"}
          </span>
          {message.meta && (
            <span className="truncate rounded-full bg-white/[0.05] px-2 py-0.5 text-[11px] text-slate-400">
              {message.meta}
            </span>
          )}
        </div>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-[1.6]">
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
            : "border-white/[0.06] bg-white/[0.025] text-slate-500"
      }`}
    >
      <Icon size={16} className={status === "active" ? "animate-spin" : ""} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-[#F8FAFC]">
          {label}
        </div>
        <div className="text-xs capitalize text-slate-500">{status}</div>
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
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
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
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {label}
        </div>
        <div className="mt-1 text-sm text-[#E6EDF3]">{value}</div>
      </div>
    </div>
  );
}
