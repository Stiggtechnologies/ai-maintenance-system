import { useMemo, useState } from "react";
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  Gauge,
  Mail,
  PackageCheck,
  ShieldCheck,
  Sparkles,
  Upload,
  Users,
  Wrench,
} from "lucide-react";
import {
  createPilotOnboardingPackage,
  submitPilotIntake,
} from "../services/pilotIntake";

const deliverables = [
  "Bad actor and risk-to-value ranking",
  "Recommended next-dollar action with approval boundary",
  "Evidence gaps and data-quality score",
  "Value hypothesis with verification window",
  "Executive-ready decision packet",
  "10-day secure workspace path if the proof is useful",
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
      "See where to spend, what risk to address, what action to take, and how to verify value.",
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
      "Move qualified opportunities into tenant-isolated analysis with your team.",
  },
];

const roleOutcomes = [
  "Plant manager: ranked downtime and production exposure",
  "Reliability leader: governed RCA / FRACAS starter pack",
  "Maintenance owner: action list tied to work-order evidence",
  "Executive / finance sponsor: value hypothesis and proof trail",
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
    title: "Workspace shell",
    detail: "Company, pilot scope, asset/system name, and value owner.",
    icon: PackageCheck,
  },
  {
    title: "Data request",
    detail:
      "CMMS/EAM export checklist for work orders, downtime, costs, failure codes, and asset hierarchy.",
    icon: Upload,
  },
  {
    title: "Role invites",
    detail:
      "Reliability, maintenance, operations, finance, security, and approval owners.",
    icon: Users,
  },
  {
    title: "Governance gates",
    detail:
      "Safety, environmental, regulatory, OEM-limit, and production-critical approval boundaries.",
    icon: ShieldCheck,
  },
  {
    title: "Agent usage path",
    detail:
      "Choose proof-first, pay-per-use agent packets, secure pilot, or enterprise rollout.",
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
  const [intakeRequestId, setIntakeRequestId] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [onboardingStarted, setOnboardingStarted] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<
    "idle" | "submitting" | "error"
  >("idle");
  const [onboardingStatus, setOnboardingStatus] = useState<
    "idle" | "saving" | "saved" | "local"
  >("idle");

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

  const updateField = (key: keyof IntakeData, value: string) => {
    setIntake((current) => ({ ...current, [key]: value }));
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
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
      <section className="mx-auto grid min-h-screen max-w-7xl gap-8 px-6 py-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(460px,0.7fr)] lg:items-center">
        <div>
          <div className="inline-flex items-center gap-2 rounded-lg border border-teal-500/20 bg-teal-500/10 px-3 py-1 text-xs font-semibold text-teal-300">
            <Wrench size={14} />
            First 3 design partners
          </div>
          <h1 className="mt-5 max-w-4xl text-[2rem] font-bold leading-[1.12] sm:text-5xl md:text-6xl">
            See your first reliability value proof in 48 hours.
          </h1>
          <p className="mt-5 max-w-3xl text-base leading-[1.7] text-slate-300 sm:text-lg sm:leading-[1.75]">
            SyncAI turns a small sanitized work-order export into a governed
            decision packet: where to spend the next dollar, which risk to
            address first, what action to take, and whether that action created
            measurable value.
          </p>
          <div className="mt-7 grid gap-3 sm:grid-cols-3">
            <Metric icon={Gauge} label="First proof" value="48 hours" />
            <Metric icon={BarChart3} label="Secure pilot" value="10 days" />
            <Metric
              icon={ShieldCheck}
              label="Mode"
              value="Governed decisions"
            />
          </div>
          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            {roleOutcomes.map((item) => (
              <div
                key={item}
                className="flex gap-3 rounded-lg border border-white/[0.06] bg-white/[0.03] p-4 text-sm text-slate-300"
              >
                <Sparkles size={17} className="mt-0.5 shrink-0 text-teal-300" />
                {item}
              </div>
            ))}
          </div>
        </div>

        <section
          aria-labelledby="value-proof-intake"
          className="rounded-2xl border border-white/[0.08] bg-[#080C11] p-5 shadow-2xl shadow-black/30"
        >
          {submitted ? (
            <div className="flex min-h-[620px] flex-col justify-center">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-lg bg-teal-500/15 text-teal-300">
                <CheckCircle2 size={24} />
              </div>
              <h2 id="value-proof-intake" className="mt-5 text-2xl font-bold">
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
                  href={mailtoHref}
                  className="inline-flex items-center gap-2 rounded-lg bg-teal-500 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-teal-400"
                >
                  <Mail size={16} />
                  Send intake by email
                </a>
                <a
                  href="/demo/copilot"
                  className="inline-flex items-center gap-2 rounded-lg border border-white/[0.08] px-5 py-3 text-sm font-semibold text-slate-200 transition-colors hover:bg-white/[0.05]"
                >
                  Return to live demo
                </a>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <div className="flex items-center gap-2 text-sm font-semibold text-teal-300">
                <ClipboardCheck size={17} />
                48-hour value proof intake
              </div>
              <h2 id="value-proof-intake" className="mt-2 text-2xl font-bold">
                Start with one decision worth proving.
              </h2>
              <p className="mt-2 text-sm leading-[1.6] text-slate-400">
                Use sanitized, non-sensitive context here. Company-sensitive
                data belongs in the secure workspace after scope and access are
                confirmed.
              </p>

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
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
                <TextField
                  label="Company"
                  value={intake.company}
                  required
                  onChange={(value) => updateField("company", value)}
                />
                <SelectField
                  label="Role"
                  value={intake.role}
                  placeholder="Select role"
                  options={roleOptions}
                  onChange={(value) => updateField("role", value)}
                />
                <SelectField
                  label="Industry"
                  value={intake.industry}
                  placeholder="Select industry"
                  options={industryOptions}
                  onChange={(value) => updateField("industry", value)}
                />
                <SelectField
                  label="CMMS / EAM"
                  value={intake.systemOfRecord}
                  placeholder="Select system"
                  options={systemOptions}
                  onChange={(value) => updateField("systemOfRecord", value)}
                />
              </div>

              <div className="mt-3 grid gap-3">
                <TextField
                  label="Asset or system in scope"
                  value={intake.assetScope}
                  required
                  onChange={(value) => updateField("assetScope", value)}
                />
                <SelectField
                  label="Work-order history available"
                  value={intake.historyAvailable}
                  placeholder="Select data history"
                  options={historyOptions}
                  onChange={(value) => updateField("historyAvailable", value)}
                />
                <SelectField
                  label="Primary reliability pain"
                  value={intake.primaryPain}
                  placeholder="Select primary pain"
                  required
                  options={painOptions}
                  onChange={(value) => updateField("primaryPain", value)}
                />
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
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
                <SelectField
                  label="Preferred buying path"
                  value={intake.commercialModel}
                  options={commercialOptions}
                  onChange={(value) => updateField("commercialModel", value)}
                />
              </div>

              <TextArea
                label="Anything SyncAI should know?"
                value={intake.notes}
                onChange={(value) => updateField("notes", value)}
              />

              {submitStatus === "error" && (
                <div className="mt-4 rounded-lg border border-amber-300/20 bg-amber-300/[0.08] p-3 text-sm leading-[1.6] text-amber-100">
                  We could not save the intake request automatically. Your
                  answers are still here, and the email handoff is ready.
                  <a href={mailtoHref} className="ml-1 font-semibold underline">
                    Send it by email.
                  </a>
                </div>
              )}

              <button
                type="submit"
                disabled={submitStatus === "submitting"}
                className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-teal-500 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-teal-400"
              >
                {submitStatus === "submitting"
                  ? "Submitting value proof request..."
                  : "Request 48-hour value proof"}
                <ArrowRight size={16} />
              </button>
            </form>
          )}
        </section>
      </section>

      <section className="border-y border-white/[0.06] bg-black/20 px-6 py-12">
        <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[1fr_0.9fr]">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-teal-300">
              <ClipboardCheck size={17} />
              What the proof delivers
            </div>
            <h2 className="mt-3 text-2xl font-bold">
              Concrete outputs, not a generic AI demo.
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
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-amber-200">
              <ShieldCheck size={17} />
              Trust and engineering boundary
            </div>
            <p className="mt-3 text-sm leading-[1.6] text-amber-50">
              SyncAI starts with sanitized, non-sensitive data for the 48-hour
              proof. Safety, environmental, regulatory, OEM-limit,
              operating-envelope, and production-critical decisions remain with
              qualified customer approvers.
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
      </section>

      <section id="onboarding" className="px-6 py-12">
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-8 lg:grid-cols-[0.9fr_1fr] lg:items-start">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-teal-300">
                <PackageCheck size={17} />
                One-click automated onboarding
              </div>
              <h2 className="mt-3 text-2xl font-bold">
                Turn the proof into a working pilot without a setup drag.
              </h2>
              <p className="mt-3 text-sm leading-[1.6] text-slate-400">
                After the intake is captured, SyncAI generates the secure pilot
                setup package from the proof scope so the team can move from
                interest to action quickly.
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
                  <div
                    key={step.label}
                    className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-5"
                  >
                    <div className="text-xs font-semibold uppercase text-teal-300">
                      {step.label}
                    </div>
                    <div className="mt-3 text-lg font-bold">{step.title}</div>
                    <p className="mt-2 text-sm leading-[1.6] text-slate-400">
                      {step.detail}
                    </p>
                  </div>
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
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-5">
      <Icon size={18} className="text-teal-300" />
      <div className="mt-4 text-xs font-semibold uppercase text-slate-500">
        {label}
      </div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
    </div>
  );
}
