import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  Gauge,
  LockKeyhole,
  Mail,
  MessageSquare,
  PackageCheck,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  Upload,
  Users,
  Wrench,
} from "lucide-react";
import { PublicProductHeader } from "../components/PublicProductHeader";
import { GovernedEngineeringLoop } from "../components/GovernedEngineeringLoop";
import {
  createPilotOnboardingPackage,
  submitPilotIntake,
} from "../services/pilotIntake";

const deliverables = [
  "Approved requirement and configuration trace",
  "Bad actor and risk-to-value ranking",
  "Deterministic analysis with assumptions and evidence gaps",
  "Controlled next action with technical approval boundary",
  "Value hypothesis with verification window",
  "Learning update for the next engineering decision",
];

const fitSignals = [
  "250+ maintainable assets or one critical high-value system",
  "Exportable work-order history",
  "Repeat failures, backlog pressure, or painful reporting",
  "Reliability, maintenance, asset, or operations owner",
];

const proofSteps = [
  {
    label: "Today",
    title: "Scope the proof",
    detail: "Pick one plant, line, asset class, or recurring failure pattern.",
  },
  {
    label: "48 hours",
    title: "Receive the value packet",
    detail:
      "See where to spend, what risk comes first, the controlled action, approval gate, and value test.",
  },
  {
    label: "One click",
    title: "Automated onboarding",
    detail:
      "Generate the data checklist, role invites, approval gates, and first analysis queue.",
  },
  {
    label: "10 days",
    title: "Secure workspace",
    detail:
      "Connect requirements, asset state, evidence, controlled work, verification, and learning with your team.",
  },
];

const roleOutcomes = [
  {
    label: "Plant manager",
    outcome: "Rank downtime and production exposure",
    role: "Plant / operations manager",
    pain: "Downtime cost is visible but root causes are not",
  },
  {
    label: "Reliability leader",
    outcome: "Build a governed RCA / FRACAS starter pack",
    role: "Reliability leader",
    pain: "RCA / FRACAS follow-through is inconsistent",
  },
  {
    label: "Maintenance owner",
    outcome: "Tie the action list to work-order evidence",
    role: "Maintenance manager",
    pain: "Backlog pressure and competing priorities",
  },
  {
    label: "Executive / finance sponsor",
    outcome: "Create a value hypothesis and proof trail",
    role: "Executive / finance sponsor",
    pain: "Need to prove whether actions created value",
  },
];

const roleOptions = [
  "Reliability leader",
  "Maintenance manager",
  "Plant / operations manager",
  "Asset manager",
  "Executive / finance sponsor",
  "EHS / process safety",
  "Consultant / systems integrator",
  "Other",
];

const industryOptions = [
  "Oil and gas",
  "Mining",
  "Manufacturing",
  "Utilities / power",
  "Chemicals / process",
  "Transportation / fleet",
  "Food and beverage",
  "Other asset-intensive industry",
];

const systemOptions = [
  "SAP PM / S/4HANA",
  "IBM Maximo",
  "Infor EAM",
  "Oracle eAM",
  "Fiix",
  "UpKeep",
  "MaintainX",
  "Spreadsheet / CSV exports",
  "Other CMMS / EAM",
  "Not sure yet",
];

const historyOptions = [
  "24+ months with downtime and costs",
  "12-24 months with failure history",
  "6-12 months of work orders",
  "Work orders only, limited failure coding",
  "Asset hierarchy exists but history is messy",
  "Need help identifying the right export",
];

const painOptions = [
  "Repeat failures on critical assets",
  "Unclear where to spend maintenance budget",
  "Backlog pressure and competing priorities",
  "PM program needs optimization",
  "Downtime cost is visible but root causes are not",
  "RCA / FRACAS follow-through is inconsistent",
  "Executive reporting takes too long",
  "Need to prove whether actions created value",
];

const commercialOptions = [
  "48-hour value proof first",
  "Pay per governed agent packet",
  "10-day secure pilot",
  "Enterprise rollout discussion",
  "Not sure yet",
];

const onboardingItems = [
  {
    title: "Engineering baseline",
    detail:
      "Approved requirements, standards, operating limits, pilot scope, and value owner.",
    icon: FileText,
  },
  {
    title: "Asset truth",
    detail:
      "Asset hierarchy, configuration state, system boundaries, and operating context.",
    icon: PackageCheck,
  },
  {
    title: "Operational evidence",
    detail:
      "CMMS/EAM checklist for work history, downtime, costs, inspections, and failure evidence.",
    icon: Upload,
  },
  {
    title: "Authority map",
    detail:
      "Reliability, maintenance, operations, finance, security, and qualified technical approvers.",
    icon: Users,
  },
  {
    title: "Governance gates",
    detail:
      "Safety, environmental, regulatory, OEM-limit, and production-critical approval boundaries.",
    icon: ShieldCheck,
  },
  {
    title: "Execution and value path",
    detail:
      "Controlled work handoff, outcome verification, learning, and the preferred commercial model.",
    icon: BarChart3,
  },
];

type IntakeData = {
  name: string;
  email: string;
  company: string;
  role: string;
  industry: string;
  assetScope: string;
  systemOfRecord: string;
  historyAvailable: string;
  primaryPain: string;
  dataReadiness: string;
  securityNeed: string;
  commercialModel: string;
  notes: string;
};

const initialIntakeData: IntakeData = {
  name: "",
  email: "",
  company: "",
  role: "",
  industry: "",
  assetScope: "",
  systemOfRecord: "",
  historyAvailable: "",
  primaryPain: "",
  dataReadiness: "Sanitized export can be shared",
  securityNeed: "NDA not required for first proof",
  commercialModel: "48-hour value proof first",
  notes: "",
};

function trackPilotEvent(event: string, detail: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;

  const payload = {
    event,
    page: "first_customer_pilot",
    ...detail,
  };

  const analyticsWindow = window as typeof window & {
    dataLayer?: Array<Record<string, unknown>>;
  };

  analyticsWindow.dataLayer?.push(payload);

  if (import.meta.env.DEV) {
    console.info("[SyncAI pilot event]", payload);
  }
}

export function FirstCustomerPilotPage() {
  const [intake, setIntake] = useState<IntakeData>(initialIntakeData);
  const [intakeStep, setIntakeStep] = useState(1);
  const [intakeRequestId, setIntakeRequestId] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [onboardingStarted, setOnboardingStarted] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<
    "idle" | "submitting" | "error"
  >("idle");
  const [onboardingStatus, setOnboardingStatus] = useState<
    "idle" | "saving" | "saved" | "local"
  >("idle");

  useEffect(() => {
    document.title = "48-Hour Reliability Value Proof | SyncAI";
  }, []);

  const mailtoHref = useMemo(() => {
    const subject = encodeURIComponent(
      "SyncAI 48-hour reliability value proof",
    );
    const body = encodeURIComponent(
      [
        "Hi SyncAI team,",
        "",
        "I would like to start a 48-hour Reliability Value Proof.",
        "",
        `Name: ${intake.name}`,
        `Work email: ${intake.email}`,
        `Company: ${intake.company}`,
        `Role: ${intake.role}`,
        `Industry: ${intake.industry}`,
        `Asset/system in scope: ${intake.assetScope}`,
        `CMMS/EAM: ${intake.systemOfRecord}`,
        `Work-order history available: ${intake.historyAvailable}`,
        `Primary reliability pain: ${intake.primaryPain}`,
        `Data readiness: ${intake.dataReadiness}`,
        `Security/NDA: ${intake.securityNeed}`,
        `Preferred buying path: ${intake.commercialModel}`,
        `Notes: ${intake.notes}`,
        "",
        "Thanks,",
      ].join("\n"),
    );

    return `mailto:support@syncai.ca?subject=${subject}&body=${body}`;
  }, [intake]);

  const copilotHref = useMemo(() => {
    const params = new URLSearchParams();
    if (intake.assetScope) params.set("asset", intake.assetScope);
    if (intake.primaryPain) params.set("pain", intake.primaryPain);
    if (intake.role) params.set("role", intake.role);
    if (intake.company) params.set("company", intake.company);
    if (intake.systemOfRecord) params.set("system", intake.systemOfRecord);
    if (intakeRequestId) params.set("intake", intakeRequestId);
    const query = params.toString();
    const decisionCaseId = intakeRequestId
      ? `intake-${intakeRequestId}`
      : "demo";

    return `/workspace/cases/${decisionCaseId}${query ? `?${query}` : ""}#syncai-chat`;
  }, [
    intake.assetScope,
    intake.company,
    intake.primaryPain,
    intake.role,
    intake.systemOfRecord,
    intakeRequestId,
  ]);

  const updateField = (key: keyof IntakeData, value: string) => {
    setIntake((current) => ({ ...current, [key]: value }));
  };

  const scrollToSection = (id: string) => {
    document.getElementById(id)?.scrollIntoView?.({
      behavior: "smooth",
      block: "start",
    });
  };

  const scrollToIntake = () => {
    scrollToSection("value-proof-intake");
  };

  const chooseRoleOutcome = (outcome: (typeof roleOutcomes)[number]) => {
    setIntake((current) => ({
      ...current,
      role: outcome.role,
      primaryPain: outcome.pain,
    }));
    setIntakeStep(1);
    scrollToIntake();
    trackPilotEvent("pilot_role_outcome_selected", {
      role: outcome.role,
      primaryPain: outcome.pain,
    });
  };

  const chooseJourneyStep = (step: (typeof proofSteps)[number]) => {
    if (step.label === "48 hours") {
      scrollToSection("proof-deliverables");
      return;
    }

    if (step.label === "One click") {
      scrollToSection("onboarding");
      return;
    }

    if (step.label === "10 days") {
      updateField("commercialModel", "10-day secure pilot");
      setIntakeStep(2);
    } else {
      setIntakeStep(1);
    }
    scrollToIntake();
  };

  const canContinue =
    intakeStep === 1
      ? Boolean(
          intake.role &&
          intake.industry &&
          intake.assetScope &&
          intake.primaryPain,
        )
      : intakeStep === 2
        ? Boolean(intake.systemOfRecord && intake.historyAvailable)
        : Boolean(intake.name && intake.email && intake.company);

  const handleSubmit = async () => {
    setSubmitStatus("submitting");

    try {
      const data = await submitPilotIntake(intake);
      setIntakeRequestId(data.id);
      setSubmitted(true);
      setSubmitStatus("idle");
      trackPilotEvent("value_proof_intake_submitted", {
        company: intake.company,
        role: intake.role,
        industry: intake.industry,
        commercialModel: intake.commercialModel,
      });
    } catch (error) {
      console.error("Unable to submit pilot intake request", error);
      setSubmitStatus("error");
      trackPilotEvent("value_proof_intake_submit_failed", {
        commercialModel: intake.commercialModel,
      });
    }
  };

  const handleFormSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (intakeStep < 3) {
      if (!canContinue) return;
      setIntakeStep((current) => current + 1);
      trackPilotEvent("value_proof_intake_step_completed", {
        step: intakeStep,
      });
      return;
    }

    if (canContinue) void handleSubmit();
  };

  const handleGenerateOnboarding = async () => {
    setOnboardingStarted(true);
    setOnboardingStatus("saving");
    trackPilotEvent("one_click_onboarding_started", {
      commercialModel: intake.commercialModel,
      hasIntakeRequest: Boolean(intakeRequestId),
    });

    try {
      await createPilotOnboardingPackage(intakeRequestId, intake);
      setOnboardingStatus("saved");
      trackPilotEvent("one_click_onboarding_saved", {
        commercialModel: intake.commercialModel,
      });
    } catch (error) {
      console.error("Unable to save onboarding package", error);
      setOnboardingStatus("local");
      trackPilotEvent("one_click_onboarding_local_only", {
        commercialModel: intake.commercialModel,
      });
    }
  };

  return (
    <main className="min-h-screen bg-[#0B0F14] text-[#E6EDF3] gradient-mesh">
      <PublicProductHeader active="proof" />
      <section className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-7xl gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(460px,0.7fr)] lg:items-center">
        <div>
          <div className="inline-flex items-center gap-2 rounded-lg border border-teal-500/20 bg-teal-500/10 px-3 py-1 text-xs font-semibold text-teal-300">
            <Wrench size={14} />
            First 3 design partners
          </div>
          <h1 className="mt-5 max-w-4xl text-[1.75rem] font-bold leading-[1.15] min-[420px]:text-[2rem] sm:text-5xl md:text-6xl">
            See your first reliability value proof in 48 hours.
          </h1>
          <p className="mt-5 max-w-3xl text-[0.95rem] leading-[1.7] text-slate-300 min-[420px]:text-base sm:text-lg sm:leading-[1.75]">
            SyncAI connects approved engineering knowledge to asset state and
            operational evidence, produces a deterministic decision packet,
            preserves human technical authority, and verifies whether the
            controlled action created measurable value.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={scrollToIntake}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-teal-400 px-5 py-3 text-sm font-semibold text-slate-950 shadow-lg shadow-teal-950/20 transition-colors hover:bg-teal-300"
            >
              Scope my value proof
              <ArrowRight size={16} />
            </button>
            <a
              href="/demo/copilot#syncai-chat"
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/[0.1] px-5 py-3 text-sm font-semibold text-slate-200 transition-colors hover:bg-white/[0.05]"
            >
              <MessageSquare size={16} />
              Try the live copilot
            </a>
          </div>
          <div className="mt-7 hidden grid-cols-3 gap-3 sm:grid">
            <Metric icon={Gauge} label="First proof" value="48 hours" />
            <Metric icon={BarChart3} label="Secure pilot" value="10 days" />
            <Metric
              icon={ShieldCheck}
              label="Mode"
              value="Governed decisions"
            />
          </div>
          <div className="mt-8 hidden grid-cols-2 gap-3 sm:grid">
            {roleOutcomes.map((outcome) => (
              <button
                type="button"
                key={outcome.label}
                onClick={() => chooseRoleOutcome(outcome)}
                className={`group flex min-w-0 items-start gap-2 rounded-lg border p-3 text-left transition-colors sm:gap-3 sm:p-4 ${
                  intake.role === outcome.role
                    ? "border-teal-300/35 bg-teal-300/[0.08]"
                    : "border-white/[0.06] bg-white/[0.03] hover:border-teal-300/25 hover:bg-white/[0.05]"
                }`}
              >
                <Sparkles size={17} className="mt-0.5 shrink-0 text-teal-300" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-slate-100">
                    {outcome.label}
                  </span>
                  <span className="mt-1 block text-xs leading-[1.45] text-slate-400">
                    {outcome.outcome}
                  </span>
                </span>
                <ArrowRight
                  size={15}
                  className="mt-0.5 shrink-0 text-slate-600 transition-colors group-hover:text-teal-300"
                />
              </button>
            ))}
          </div>
        </div>

        <section
          id="value-proof-intake"
          aria-labelledby="value-proof-intake-title"
          className="scroll-mt-20 rounded-2xl border border-white/[0.08] bg-[#080C11] p-5 shadow-2xl shadow-black/30"
        >
          {submitted ? (
            <div className="flex min-h-[620px] flex-col justify-center">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-lg bg-teal-500/15 text-teal-300">
                <CheckCircle2 size={24} />
              </div>
              <h2
                id="value-proof-intake-title"
                className="mt-5 text-2xl font-bold"
              >
                Request captured.
              </h2>
              <p className="mt-3 text-sm leading-[1.6] text-slate-300">
                The next step is a short scope check: confirm the asset/system,
                data export shape, security boundary, and the business outcome
                the proof needs to make visible.
              </p>
              <div className="mt-6 rounded-lg border border-teal-300/15 bg-teal-500/10 p-4">
                <div className="text-sm font-semibold text-teal-200">
                  Proof target
                </div>
                <p className="mt-2 text-sm leading-[1.6] text-slate-300">
                  {intake.company || "Your organization"} wants to evaluate{" "}
                  {intake.assetScope || "a reliability opportunity"} using{" "}
                  {intake.systemOfRecord || "available maintenance history"}.
                  Preferred buying path: {intake.commercialModel}.
                </p>
              </div>
              {onboardingStarted ? (
                <div className="mt-4 rounded-lg border border-white/[0.08] bg-white/[0.03] p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-[#F8FAFC]">
                    <PackageCheck size={17} className="text-teal-300" />
                    Automated onboarding package generated
                  </div>
                  <p className="mt-2 text-xs leading-[1.45] text-slate-400">
                    {onboardingStatus === "saved"
                      ? "Saved to the pilot onboarding queue."
                      : onboardingStatus === "saving"
                        ? "Saving the onboarding package..."
                        : "Generated locally. Use the email handoff if database capture is unavailable."}
                  </p>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {onboardingItems.map((item) => {
                      const Icon = item.icon;

                      return (
                        <div
                          key={item.title}
                          className="flex gap-3 rounded-lg border border-white/[0.06] bg-black/20 p-3"
                        >
                          <Icon
                            size={17}
                            className="mt-0.5 shrink-0 text-teal-300"
                          />
                          <div>
                            <div className="text-sm font-semibold text-[#E6EDF3]">
                              {item.title}
                            </div>
                            <p className="mt-1 text-xs leading-[1.45] text-slate-400">
                              {item.detail}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleGenerateOnboarding}
                  className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-teal-300/30 bg-teal-500/10 px-5 py-3 text-sm font-semibold text-teal-100 transition-colors hover:bg-teal-500/15"
                >
                  <PackageCheck size={16} />
                  Generate one-click onboarding checklist
                </button>
              )}
              <div className="mt-6 flex flex-wrap gap-3">
                <a
                  href={copilotHref}
                  className="inline-flex items-center gap-2 rounded-lg bg-teal-400 px-5 py-3 text-sm font-semibold text-slate-950 transition-colors hover:bg-teal-300"
                >
                  <MessageSquare size={16} />
                  Open personalized Decision Case
                  <ArrowUpRight size={15} />
                </a>
                <a
                  href={mailtoHref}
                  className="inline-flex items-center gap-2 rounded-lg border border-white/[0.08] px-5 py-3 text-sm font-semibold text-slate-200 transition-colors hover:bg-white/[0.05]"
                >
                  <Mail size={16} />
                  Email a copy
                </a>
              </div>
            </div>
          ) : (
            <form onSubmit={handleFormSubmit}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold text-teal-300">
                    <ClipboardCheck size={17} />
                    48-hour value proof intake
                  </div>
                  <h2
                    id="value-proof-intake-title"
                    className="mt-2 text-2xl font-bold"
                  >
                    Start with one decision worth proving.
                  </h2>
                </div>
                <span className="hidden shrink-0 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs font-semibold text-slate-400 sm:block">
                  About 2 minutes
                </span>
              </div>
              <p className="mt-2 text-sm leading-[1.6] text-slate-400">
                No upload is required here. Company-sensitive data only enters a
                secure workspace after scope and access are confirmed.
              </p>

              <div
                className="mt-5 grid grid-cols-3 gap-2"
                aria-label={`Intake step ${intakeStep} of 3`}
              >
                {["Decision", "Data", "Contact"].map((label, index) => {
                  const step = index + 1;
                  const isCurrent = intakeStep === step;
                  const isComplete = intakeStep > step;

                  return (
                    <div key={label} className="min-w-0">
                      <div
                        className={`h-1 rounded-full ${
                          isCurrent || isComplete
                            ? "bg-teal-300"
                            : "bg-white/[0.08]"
                        }`}
                      />
                      <div
                        className={`mt-2 text-xs font-semibold ${
                          isCurrent ? "text-slate-100" : "text-slate-500"
                        }`}
                      >
                        {step}. {label}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="min-h-[350px]">
                {intakeStep === 1 && (
                  <div className="mt-6 grid gap-3 sm:grid-cols-2">
                    <SelectField
                      label="Your role"
                      value={intake.role}
                      placeholder="Select role"
                      required
                      options={roleOptions}
                      onChange={(value) => updateField("role", value)}
                    />
                    <SelectField
                      label="Industry"
                      value={intake.industry}
                      placeholder="Select industry"
                      required
                      options={industryOptions}
                      onChange={(value) => updateField("industry", value)}
                    />
                    <div className="sm:col-span-2">
                      <TextField
                        label="Asset, system, line, or failure pattern"
                        value={intake.assetScope}
                        required
                        placeholder="e.g. P-101 pump train or chronic seal failures"
                        onChange={(value) => updateField("assetScope", value)}
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <SelectField
                        label="Decision you need to improve"
                        value={intake.primaryPain}
                        placeholder="Select the primary challenge"
                        required
                        options={painOptions}
                        onChange={(value) => updateField("primaryPain", value)}
                      />
                    </div>
                  </div>
                )}

                {intakeStep === 2 && (
                  <div className="mt-6 grid gap-3 sm:grid-cols-2">
                    <SelectField
                      label="CMMS / EAM"
                      value={intake.systemOfRecord}
                      placeholder="Select system"
                      required
                      options={systemOptions}
                      onChange={(value) => updateField("systemOfRecord", value)}
                    />
                    <SelectField
                      label="Work-order history available"
                      value={intake.historyAvailable}
                      placeholder="Select data history"
                      required
                      options={historyOptions}
                      onChange={(value) =>
                        updateField("historyAvailable", value)
                      }
                    />
                    <SelectField
                      label="Data readiness"
                      value={intake.dataReadiness}
                      options={[
                        "Sanitized export can be shared",
                        "Need help shaping export",
                        "Secure workspace required first",
                      ]}
                      onChange={(value) => updateField("dataReadiness", value)}
                    />
                    <SelectField
                      label="Security / NDA"
                      value={intake.securityNeed}
                      options={[
                        "NDA not required for first proof",
                        "NDA preferred before data share",
                        "Security review required",
                      ]}
                      onChange={(value) => updateField("securityNeed", value)}
                    />
                    <div className="sm:col-span-2">
                      <SelectField
                        label="Preferred path after value is proven"
                        value={intake.commercialModel}
                        options={commercialOptions}
                        onChange={(value) =>
                          updateField("commercialModel", value)
                        }
                      />
                    </div>
                  </div>
                )}

                {intakeStep === 3 && (
                  <div className="mt-6">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <TextField
                        label="Name"
                        value={intake.name}
                        required
                        onChange={(value) => updateField("name", value)}
                      />
                      <TextField
                        label="Work email"
                        type="email"
                        value={intake.email}
                        required
                        onChange={(value) => updateField("email", value)}
                      />
                      <div className="sm:col-span-2">
                        <TextField
                          label="Company"
                          value={intake.company}
                          required
                          onChange={(value) => updateField("company", value)}
                        />
                      </div>
                    </div>
                    <TextArea
                      label="Anything we should know? (optional)"
                      value={intake.notes}
                      onChange={(value) => updateField("notes", value)}
                    />
                    <div className="mt-4 flex items-start gap-3 rounded-lg border border-teal-300/15 bg-teal-300/[0.06] p-3">
                      <LockKeyhole
                        size={16}
                        className="mt-0.5 shrink-0 text-teal-300"
                      />
                      <p className="text-xs leading-[1.5] text-slate-400">
                        You are requesting a scope review, not purchasing a
                        subscription. We will confirm the proof boundary before
                        any customer data is shared.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {submitStatus === "error" && (
                <div className="mt-4 rounded-lg border border-amber-300/20 bg-amber-300/[0.08] p-3 text-sm leading-[1.6] text-amber-100">
                  We could not save the intake request automatically. Your
                  answers are still here, and the email handoff is ready.
                  <a href={mailtoHref} className="ml-1 font-semibold underline">
                    Send it by email.
                  </a>
                </div>
              )}

              <div className="mt-5 flex items-center gap-3">
                {intakeStep > 1 && (
                  <button
                    type="button"
                    onClick={() => setIntakeStep((current) => current - 1)}
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-white/[0.09] px-4 text-sm font-semibold text-slate-300 transition-colors hover:bg-white/[0.05]"
                  >
                    <ArrowLeft size={16} />
                    Back
                  </button>
                )}
                <button
                  type="submit"
                  disabled={!canContinue || submitStatus === "submitting"}
                  className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-teal-400 px-5 text-sm font-semibold text-slate-950 shadow-lg shadow-teal-950/20 transition-colors hover:bg-teal-300 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {submitStatus === "submitting"
                    ? "Submitting request..."
                    : intakeStep === 3
                      ? "Request 48-hour value proof"
                      : "Continue"}
                  <ArrowRight size={16} />
                </button>
              </div>
            </form>
          )}
        </section>
      </section>

      <GovernedEngineeringLoop />

      <section
        id="proof-deliverables"
        className="scroll-mt-20 border-y border-white/[0.06] bg-black/20 px-4 py-14 sm:px-6"
      >
        <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[1fr_0.9fr]">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-teal-300">
              <ClipboardCheck size={17} />
              What the proof delivers
            </div>
            <h2 className="mt-3 text-2xl font-bold">
              A governed decision packet, not a generic AI answer.
            </h2>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {deliverables.map((item) => (
                <div
                  key={item}
                  className="flex gap-3 rounded-lg border border-white/[0.06] bg-white/[0.03] p-4 text-sm text-slate-300"
                >
                  <CheckCircle2
                    size={17}
                    className="mt-0.5 shrink-0 text-teal-300"
                  />
                  {item}
                </div>
              ))}
            </div>
          </div>
          <div className="space-y-4">
            <div className="overflow-hidden rounded-xl border border-teal-300/20 bg-[#080C11] shadow-2xl shadow-black/30">
              <div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-4">
                <div>
                  <div className="text-xs font-semibold text-teal-300">
                    Sample decision packet
                  </div>
                  <div className="mt-1 text-base font-bold text-slate-100">
                    P-101 chronic seal failures
                  </div>
                </div>
                <span className="rounded-lg border border-amber-300/20 bg-amber-300/10 px-2.5 py-1 text-xs font-semibold text-amber-100">
                  High priority
                </span>
              </div>
              <div className="grid grid-cols-2 border-b border-white/[0.07]">
                <div className="border-r border-white/[0.07] p-5">
                  <div className="text-xs text-slate-500">Value exposure</div>
                  <div className="mt-1 text-2xl font-bold text-slate-100">
                    CAD 187k
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    90-day hypothesis
                  </div>
                </div>
                <div className="p-5">
                  <div className="text-xs text-slate-500">Confidence</div>
                  <div className="mt-1 text-2xl font-bold text-slate-100">
                    Medium
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    2 evidence gaps
                  </div>
                </div>
              </div>
              <div className="space-y-4 p-5">
                <div className="flex items-start gap-3">
                  <Target size={17} className="mt-0.5 shrink-0 text-teal-300" />
                  <div>
                    <div className="text-xs font-semibold text-slate-500">
                      Recommended next action
                    </div>
                    <p className="mt-1 text-sm leading-[1.55] text-slate-200">
                      Validate solids ingress and startup conditions before
                      changing the seal strategy.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <TrendingUp
                    size={17}
                    className="mt-0.5 shrink-0 text-sky-300"
                  />
                  <div>
                    <div className="text-xs font-semibold text-slate-500">
                      Value verification
                    </div>
                    <p className="mt-1 text-sm leading-[1.55] text-slate-200">
                      Track avoided downtime, repeat failures, and action cost
                      for 90 days after approval.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-5">
              <div className="flex items-center gap-2 text-sm font-semibold text-amber-200">
                <ShieldCheck size={17} />
                Trust and engineering boundary
              </div>
              <p className="mt-3 text-sm leading-[1.6] text-amber-50">
                SyncAI starts with sanitized, non-sensitive data for the 48-hour
                proof. Safety, environmental, regulatory, OEM-limit,
                operating-envelope, and production-critical decisions remain
                with qualified customer approvers.
              </p>
              <div className="mt-5 flex items-center gap-2 text-sm font-semibold text-[#E6EDF3]">
                <FileText size={17} className="text-teal-300" />
                Best fit
              </div>
              <div className="mt-3 space-y-2">
                {fitSignals.map((item) => (
                  <div key={item} className="flex gap-2 text-sm text-slate-300">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-300" />
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="onboarding" className="scroll-mt-20 px-4 py-14 sm:px-6">
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-8 lg:grid-cols-[0.9fr_1fr] lg:items-start">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-teal-300">
                <PackageCheck size={17} />
                One-click automated onboarding
              </div>
              <h2 className="mt-3 text-2xl font-bold">
                Turn the proof into a controlled working loop.
              </h2>
              <p className="mt-3 text-sm leading-[1.6] text-slate-400">
                After the intake is captured, SyncAI generates the baseline,
                asset-state request, evidence checklist, authority map,
                governance gates, execution handoff, and value-verification path
                from the proof scope.
              </p>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {onboardingItems.map((item) => {
                  const Icon = item.icon;

                  return (
                    <div
                      key={item.title}
                      className="flex gap-3 rounded-xl border border-white/[0.06] bg-white/[0.03] p-4"
                    >
                      <Icon
                        size={18}
                        className="mt-0.5 shrink-0 text-teal-300"
                      />
                      <div>
                        <div className="text-sm font-semibold text-[#E6EDF3]">
                          {item.title}
                        </div>
                        <p className="mt-1 text-xs leading-[1.45] text-slate-400">
                          {item.detail}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-teal-300">
                <Gauge size={17} />
                Customer path
              </div>
              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                {proofSteps.map((step) => (
                  <button
                    type="button"
                    key={step.label}
                    onClick={() => chooseJourneyStep(step)}
                    className="group rounded-xl border border-white/[0.06] bg-white/[0.03] p-5 text-left transition-colors hover:border-teal-300/25 hover:bg-white/[0.05]"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-xs font-semibold uppercase text-teal-300">
                        {step.label}
                      </div>
                      <ArrowRight
                        size={15}
                        className="text-slate-600 transition-colors group-hover:text-teal-300"
                      />
                    </div>
                    <div className="mt-3 text-lg font-bold">{step.title}</div>
                    <p className="mt-2 text-sm leading-[1.6] text-slate-400">
                      {step.detail}
                    </p>
                  </button>
                ))}
              </div>
              <a
                href="#value-proof-intake"
                className="mt-5 inline-flex items-center gap-2 rounded-lg bg-teal-500 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-teal-400"
              >
                Start proof, then generate onboarding
                <ArrowRight size={16} />
              </a>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

function TextField({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label className="space-y-1">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <input
        type={type}
        value={value}
        required={required}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-white/[0.08] bg-black/20 px-3 py-2 text-sm text-[#E6EDF3] outline-none transition-colors placeholder:text-slate-600 focus:border-teal-500/60"
      />
    </label>
  );
}

function TextArea({
  label,
  value,
  onChange,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  return (
    <label className="mt-3 block space-y-1">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <textarea
        value={value}
        required={required}
        rows={3}
        onChange={(event) => onChange(event.target.value)}
        className="w-full resize-none rounded-lg border border-white/[0.08] bg-black/20 px-3 py-2 text-sm leading-[1.6] text-[#E6EDF3] outline-none transition-colors placeholder:text-slate-600 focus:border-teal-500/60"
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
  placeholder,
  required = false,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label className="space-y-1">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <select
        value={value}
        required={required}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-white/[0.08] bg-black/20 px-3 py-2 text-sm text-[#E6EDF3] outline-none transition-colors focus:border-teal-500/60"
      >
        {placeholder && (
          <option value="" disabled className="bg-[#080C11] text-slate-500">
            {placeholder}
          </option>
        )}
        {options.map((option) => (
          <option key={option} value={option} className="bg-[#080C11]">
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-white/[0.06] bg-white/[0.03] p-3 sm:p-5">
      <Icon size={17} className="text-teal-300" />
      <div className="mt-3 text-[10px] font-semibold uppercase text-slate-500 sm:mt-4 sm:text-xs">
        {label}
      </div>
      <div className="mt-1 break-words text-sm font-bold leading-[1.35] sm:text-2xl">
        {value}
      </div>
    </div>
  );
}
