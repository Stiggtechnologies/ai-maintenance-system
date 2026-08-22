import { useMemo, useState } from "react";
import {
  Activity,
  ArrowRight,
  BadgeCheck,
  BookOpenCheck,
  BrainCircuit,
  ChartNoAxesCombined,
  ChevronRight,
  CircleGauge,
  Clock3,
  ClipboardCheck,
  Database,
  Factory,
  FileWarning,
  Gauge,
  GitBranch,
  Info,
  Layers3,
  Network,
  Plus,
  RefreshCw,
  Scale,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Target,
  TimerReset,
  TriangleAlert,
  Users,
  Workflow,
  X,
} from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import {
  ANALYSIS_METHODS,
  CONSEQUENCE_DIMENSIONS,
  ISO_31000_PRINCIPLES,
  RISK_ENGINE_ARCHITECTURE,
  detectStakeholderDisagreement,
  getIndustryRiskFocus,
  type RiskDecision,
  type RiskKind,
} from "../lib/risk-operating-system";
import {
  acceptResidualRisk,
  adoptRiskContext,
  adoptRiskCriteria,
  configureRiskCriteria,
  configureRiskAuthorityRequirements,
  configureRiskControl,
  configureRiskIndicator,
  createRiskAssessment,
  createRiskCriteriaVersion,
  createRiskTreatment,
  decideRiskDecision,
  getRiskAudienceView,
  getRiskOperatingCockpit,
  getRiskParticipants,
  ingestRiskEvidence,
  recordRiskAnalysis,
  recordRiskControlTest,
  recordRiskDecision,
  recordRiskIndicatorObservation,
  recordRiskOutcome,
  recordRiskFrameworkReview,
  recordRiskMaturityAssessment,
  recordRiskValueOfInformation,
  recordStakeholderView,
  startIso31000Implementation,
  linkRisks,
  upsertRiskContext,
} from "../services/riskOperatingService";
import { getAssets } from "../services/operatingLoopService";
import type { AssetRow } from "../types/operating";
import type {
  RiskAssessmentDraft,
  RiskCockpit,
  RiskCriteriaProfile,
  RiskParticipant,
  RiskRecord,
} from "../types/risk";
import { ErrorState, LoadingState } from "../components/ui/AsyncStates";
import { RiskConsequence as AssetRiskSignals } from "./RiskConsequence";
import { AssetInterdependency } from "../components/AssetInterdependency";
import { ConfigurationControl } from "../components/ConfigurationControl";
import { ProcessSafety } from "../components/ProcessSafety";
import {
  EnterpriseRiskArchitecturePanel,
  RiskDecisionOperationsPanel,
} from "../components/risk/RiskEnterprisePanels";

type Tab =
  | "cockpit"
  | "portfolio"
  | "controls"
  | "context"
  | "decision-ops"
  | "enterprise"
  | "maturity"
  | "asset-signals";
type ActionKind =
  | "evidence"
  | "view"
  | "analysis"
  | "decision"
  | "treatment"
  | "outcome"
  | "information"
  | "configure_indicator"
  | "configure_control"
  | "link"
  | "decision_approval"
  | "indicator"
  | "control";

type GovernanceAction =
  "context" | "framework" | "maturity" | "audience" | "authority";

interface PageData {
  cockpit: RiskCockpit;
  participants: RiskParticipant[];
  assets: AssetRow[];
}

function splitList(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function score(value: number | null): string {
  return value == null ? "—" : Math.round(value).toString();
}

function money(value: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

const levelTone: Record<string, string> = {
  Critical: "border-red-500/35 bg-red-500/10 text-red-300",
  High: "border-orange-500/35 bg-orange-500/10 text-orange-300",
  Medium: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  Low: "border-cyan-500/30 bg-cyan-500/10 text-cyan-300",
  "Very Low": "border-slate-500/25 bg-slate-500/10 text-slate-300",
};

function Pill({
  children,
  tone = "border-white/8 bg-white/3 text-slate-300",
}: {
  children: React.ReactNode;
  tone?: string;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${tone}`}
    >
      {children}
    </span>
  );
}

function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
  alert = false,
}: {
  label: string;
  value: React.ReactNode;
  detail: string;
  icon: React.ElementType;
  alert?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-4 ${alert ? "border-red-500/25 bg-red-500/6" : "border-white/7 bg-[#0D1520]"}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
            {label}
          </p>
          <p
            className={`mt-2 text-2xl font-black tabular-nums ${alert ? "text-red-300" : "text-white"}`}
          >
            {value}
          </p>
        </div>
        <div
          className={`rounded-xl p-2 ${alert ? "bg-red-500/12 text-red-300" : "bg-teal-500/10 text-teal-300"}`}
        >
          <Icon className="h-4 w-4" aria-hidden />
        </div>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-slate-400">{detail}</p>
    </div>
  );
}

function RiskFlow() {
  const stages = [
    "Objective",
    "Context",
    "Risk",
    "Control",
    "Decision",
    "Treatment",
    "Work",
    "Outcome",
    "Learning",
  ];
  return (
    <div className="overflow-x-auto rounded-2xl border border-white/7 bg-[#0D1520] p-4">
      <div className="flex min-w-[880px] items-center gap-2">
        {stages.map((stage, index) => (
          <div key={stage} className="contents">
            <div
              className={`flex-1 rounded-xl border px-3 py-3 text-center ${index === 0 ? "border-teal-500/35 bg-teal-500/10 text-teal-200" : index === stages.length - 1 ? "border-violet-500/35 bg-violet-500/10 text-violet-200" : "border-white/7 bg-white/3 text-slate-300"}`}
            >
              <div className="text-[10px] font-mono text-slate-500">
                {String(index + 1).padStart(2, "0")}
              </div>
              <div className="mt-0.5 text-xs font-semibold">{stage}</div>
            </div>
            {index < stages.length - 1 && (
              <ArrowRight
                className="h-3.5 w-3.5 shrink-0 text-slate-600"
                aria-hidden
              />
            )}
          </div>
        ))}
        <div className="ml-1 flex items-center gap-1 rounded-full border border-violet-500/25 bg-violet-500/8 px-3 py-1.5 text-[10px] font-semibold text-violet-300">
          <RefreshCw className="h-3 w-3" aria-hidden /> Updated risk
        </div>
      </div>
    </div>
  );
}

function RiskCard({
  risk,
  selected,
  onSelect,
}: {
  risk: RiskRecord;
  selected: boolean;
  onSelect: () => void;
}) {
  const velocity = risk.velocity ?? 0;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-xl border p-3.5 text-left transition ${selected ? "border-teal-500/40 bg-teal-500/8" : "border-white/7 bg-[#0D1520] hover:border-white/14"}`}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Pill tone={levelTone[risk.current_risk_level ?? ""]}>
              {risk.current_risk_level ?? "Unrated"}
            </Pill>
            <Pill>{risk.kind}</Pill>
            {velocity > 0 && (
              <Pill tone="border-orange-500/25 bg-orange-500/8 text-orange-300">
                +{Math.round(velocity)} velocity
              </Pill>
            )}
          </div>
          <h3 className="mt-2 truncate text-sm font-semibold text-white">
            {risk.title}
          </h3>
          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-400">
            {risk.objective ?? "Objective not recorded"}
          </p>
        </div>
        <div className="text-right">
          <div className="text-xl font-black tabular-nums text-white">
            {score(risk.current_risk_score)}
          </div>
          <div className="text-[10px] uppercase text-slate-500">current</div>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-white/5 pt-2 text-[11px] text-slate-500">
        <span>{risk.context?.name ?? "No context"}</span>
        <span className="flex items-center gap-1 text-slate-400">
          {risk.decision_action ?? "INVESTIGATE"}
          <ChevronRight className="h-3 w-3" />
        </span>
      </div>
    </button>
  );
}

function Driver({
  label,
  value,
  suffix = "%",
}: {
  label: string;
  value: number | null;
  suffix?: string;
}) {
  const width = Math.max(0, Math.min(100, value ?? 0));
  return (
    <div>
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-slate-400">{label}</span>
        <span className="font-mono text-slate-300">
          {value == null ? "—" : `${Math.round(value)}${suffix}`}
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/5">
        <div
          className="h-full rounded-full bg-linear-to-r from-teal-500 to-cyan-400"
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  );
}

function RiskDetail({
  risk,
  onAction,
}: {
  risk: RiskRecord;
  onAction: (action: ActionKind, targetId?: string) => void;
}) {
  const views = risk.stakeholder_views
    .filter((view) => view.likelihood != null && view.consequence != null)
    .map((view) => ({
      stakeholder: view.stakeholder,
      likelihood: view.likelihood!,
      consequence: view.consequence!,
    }));
  const disagreement = detectStakeholderDisagreement(views);
  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-white/7 bg-[#0D1520] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone={levelTone[risk.current_risk_level ?? ""]}>
                {risk.current_risk_level ?? "Unrated"}
              </Pill>
              <Pill>{risk.status.replaceAll("_", " ")}</Pill>
              <Pill>
                {risk.analysis_level?.replaceAll("_", " ") ?? "not analyzed"}
              </Pill>
            </div>
            <h2 className="mt-3 text-xl font-bold text-white">{risk.title}</h2>
            <p className="mt-1 text-sm text-slate-300">
              {risk.objective ?? "Objective not recorded"}
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              { label: "Current", value: risk.current_risk_score },
              { label: "Residual", value: risk.residual_risk_score },
              { label: "Target", value: risk.target_risk_score },
            ].map((item) => (
              <div
                key={item.label}
                className="min-w-16 rounded-xl border border-white/7 bg-white/3 px-3 py-2"
              >
                <div className="text-lg font-black text-white">
                  {score(item.value)}
                </div>
                <div className="text-[9px] uppercase tracking-wide text-slate-500">
                  {item.label}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-white/6 bg-white/2 p-3">
            <p className="text-[10px] uppercase tracking-wider text-slate-500">
              Risk source
            </p>
            <p className="mt-1 text-xs leading-relaxed text-slate-300">
              {risk.risk_source ?? "Not recorded"}
            </p>
          </div>
          <div className="rounded-xl border border-white/6 bg-white/2 p-3">
            <p className="text-[10px] uppercase tracking-wider text-slate-500">
              Event
            </p>
            <p className="mt-1 text-xs leading-relaxed text-slate-300">
              {risk.event ?? "Not recorded"}
            </p>
          </div>
          <div className="rounded-xl border border-white/6 bg-white/2 p-3">
            <p className="text-[10px] uppercase tracking-wider text-slate-500">
              Decision
            </p>
            <p className="mt-1 text-sm font-bold text-teal-300">
              {risk.decision_action ?? "INVESTIGATE"}
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="space-y-2.5 rounded-xl border border-white/6 bg-white/2 p-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Analysis drivers
            </h3>
            <Driver
              label="Control effectiveness"
              value={risk.control_effectiveness}
            />
            <Driver label="Exposure" value={risk.exposure} />
            <Driver label="Uncertainty" value={risk.uncertainty} />
            <Driver label="Connectivity" value={risk.connectivity} />
            <Driver label="Capacity load" value={risk.capacity_load} />
            <Driver label="Confidence" value={risk.confidence} />
          </div>
          <div className="rounded-xl border border-white/6 bg-white/2 p-3 text-xs">
            <h3 className="font-semibold uppercase tracking-wider text-slate-400">
              Ownership & scope
            </h3>
            <dl className="mt-3 space-y-2">
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Risk owner</dt>
                <dd className="text-right text-slate-300">
                  {risk.risk_owner?.name ?? "Not assigned"}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Decision owner</dt>
                <dd className="text-right text-slate-300">
                  {risk.decision_owner?.name ?? "Not assigned"}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Context</dt>
                <dd className="text-right text-slate-300">
                  {risk.context?.name ?? "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Asset</dt>
                <dd className="text-right text-slate-300">
                  {risk.asset?.name ?? "Enterprise / activity"}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Review</dt>
                <dd className="text-right text-slate-300">
                  {risk.review_date ?? "Not scheduled"}
                </dd>
              </div>
              <div className="border-t border-white/5 pt-2">
                <dt className="text-slate-500">Reassessment trigger</dt>
                <dd className="mt-1 leading-relaxed text-slate-300">
                  {risk.escalation_threshold ?? "Not recorded"}
                </dd>
              </div>
            </dl>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {(
            [
              "evidence",
              "view",
              "analysis",
              "information",
              "decision",
              "treatment",
              "link",
              "outcome",
            ] as ActionKind[]
          ).map((action) => (
            <button
              key={action}
              type="button"
              onClick={() => onAction(action)}
              className="rounded-lg border border-white/9 bg-white/4 px-3 py-1.5 text-xs font-medium capitalize text-slate-300 hover:border-teal-500/35 hover:text-teal-300"
            >
              {action === "view"
                ? "Stakeholder view"
                : action === "information"
                  ? "Value of information"
                  : action === "link"
                    ? "Risk connection"
                    : action}
            </button>
          ))}
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-2xl border border-white/7 bg-[#0D1520] p-4">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
              <Activity className="h-4 w-4 text-teal-300" />
              Leading indicators
            </h3>
            <div className="flex items-center gap-2">
              <Pill>{risk.indicators.length}</Pill>
              <button
                type="button"
                onClick={() => onAction("configure_indicator")}
                className="text-[10px] font-semibold text-teal-300"
              >
                + Bind indicator
              </button>
            </div>
          </div>
          <div className="mt-3 space-y-2">
            {risk.indicators.length === 0 && (
              <p className="text-xs text-slate-500">
                No indicator is bound. Dynamic monitoring is not active for this
                risk.
              </p>
            )}
            {risk.indicators.map((indicator) => (
              <div
                key={indicator.id}
                className="flex items-center gap-3 rounded-xl border border-white/6 bg-white/2 p-3"
              >
                <div
                  className={`h-2.5 w-2.5 rounded-full ${indicator.state === "critical" ? "bg-red-400" : indicator.state === "warning" ? "bg-amber-400" : indicator.state === "normal" ? "bg-emerald-400" : "bg-slate-500"}`}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-slate-200">
                    {indicator.name}
                  </p>
                  <p className="text-[10px] text-slate-500">
                    {indicator.source} ·{" "}
                    {indicator.observed_at
                      ? new Date(indicator.observed_at).toLocaleString()
                      : "awaiting data"}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-sm font-bold text-white">
                    {indicator.value ?? "—"} {indicator.unit}
                  </p>
                  <button
                    type="button"
                    onClick={() => onAction("indicator", indicator.id)}
                    className="text-[10px] font-medium text-teal-300 hover:text-teal-200"
                  >
                    Record reading
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-white/7 bg-[#0D1520] p-4">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
              <ShieldCheck className="h-4 w-4 text-cyan-300" />
              Controls
            </h3>
            <div className="flex items-center gap-2">
              <Pill>{risk.controls.length}</Pill>
              <button
                type="button"
                onClick={() => onAction("configure_control")}
                className="text-[10px] font-semibold text-teal-300"
              >
                + Add control
              </button>
            </div>
          </div>
          <div className="mt-3 space-y-2">
            {risk.controls.length === 0 && (
              <p className="text-xs text-slate-500">
                No control is linked. Existing-control effectiveness is unknown.
              </p>
            )}
            {risk.controls.map((control) => (
              <div
                key={control.id}
                className="rounded-xl border border-white/6 bg-white/2 p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium text-slate-200">
                      {control.name}
                    </p>
                    <p className="mt-0.5 text-[10px] text-slate-500">
                      Owner: {control.owner ?? "not assigned"} · next test{" "}
                      {control.next_test_due ?? "not scheduled"}
                    </p>
                  </div>
                  <Pill
                    tone={
                      control.effectiveness === "effective"
                        ? "border-emerald-500/25 bg-emerald-500/8 text-emerald-300"
                        : control.effectiveness === "weak" ||
                            control.effectiveness === "ineffective"
                          ? "border-red-500/25 bg-red-500/8 text-red-300"
                          : "border-white/8 bg-white/3 text-slate-300"
                    }
                  >
                    {control.effectiveness}
                  </Pill>
                </div>
                <div className="mt-2 flex items-center justify-between text-[10px]">
                  <span className="text-slate-500">Trend: {control.trend}</span>
                  <button
                    type="button"
                    onClick={() => onAction("control", control.id)}
                    className="font-medium text-teal-300 hover:text-teal-200"
                  >
                    Record test
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section
        className={`rounded-2xl border p-4 ${disagreement.material ? "border-amber-500/30 bg-amber-500/6" : "border-white/7 bg-[#0D1520]"}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
              <Users className="h-4 w-4 text-amber-300" />
              Consultation & disagreement
            </h3>
            <p className="mt-1 text-xs text-slate-400">
              {disagreement.questionToResolve}
            </p>
          </div>
          {disagreement.material && (
            <Pill tone="border-amber-500/30 bg-amber-500/10 text-amber-300">
              Material disagreement
            </Pill>
          )}
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {risk.stakeholder_views.map((view) => (
            <div
              key={view.id}
              className="rounded-xl border border-white/6 bg-white/2 p-3"
            >
              <div className="flex justify-between gap-3">
                <div>
                  <p className="text-xs font-medium text-slate-200">
                    {view.stakeholder}
                  </p>
                  <p className="text-[10px] text-slate-500">
                    {view.role ?? view.kind}
                  </p>
                </div>
                <p className="font-mono text-[11px] text-slate-300">
                  L{view.likelihood ?? "—"} / C{view.consequence ?? "—"}
                </p>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-slate-400">
                {view.rationale}
              </p>
            </div>
          ))}
          {risk.stakeholder_views.length === 0 && (
            <p className="text-xs text-slate-500">
              No stakeholder views recorded; consultation has not yet been
              evidenced.
            </p>
          )}
        </div>
      </section>

      {(risk.pending_decisions.length > 0 || risk.links.length > 0) && (
        <section className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-violet-500/20 bg-violet-500/5 p-4">
            <h3 className="text-sm font-semibold text-white">
              Pending accountable decisions
            </h3>
            <div className="mt-3 space-y-2">
              {risk.pending_decisions.map((decision) => (
                <div
                  key={decision.id}
                  className="rounded-xl border border-white/7 bg-black/10 p-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold text-violet-200">
                        {decision.action}
                      </p>
                      <p className="mt-1 text-[10px] text-slate-500">
                        Required role: {decision.required_role}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onAction("decision_approval", decision.id)}
                      className="text-[10px] font-semibold text-teal-300"
                    >
                      Review
                    </button>
                  </div>
                </div>
              ))}
              {risk.pending_decisions.length === 0 && (
                <p className="text-xs text-slate-500">No pending decision.</p>
              )}
            </div>
          </div>
          <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4">
            <h3 className="text-sm font-semibold text-white">
              Connected and cascading risk
            </h3>
            <div className="mt-3 space-y-2">
              {risk.links.map((link) => (
                <div key={link.id} className="text-xs text-slate-400">
                  <Pill>{link.relationship.replaceAll("_", " ")}</Pill>{" "}
                  {link.dependency_key ?? link.related_risk_id}
                </div>
              ))}
              {risk.links.length === 0 && (
                <p className="text-xs text-slate-500">
                  No inter-risk connection recorded.
                </p>
              )}
            </div>
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-white/7 bg-[#0D1520] p-4">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
            <Scale className="h-4 w-4 text-violet-300" />
            Treatment alternatives
          </h3>
          <Pill>{risk.treatments.length}</Pill>
        </div>
        <div className="mt-3 overflow-x-auto">
          {risk.treatments.length === 0 ? (
            <p className="text-xs text-slate-500">
              No alternative has been compared yet.
            </p>
          ) : (
            <table className="w-full min-w-[700px] text-left text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="pb-2">Option</th>
                  <th className="pb-2">Strategy</th>
                  <th className="pb-2">Residual</th>
                  <th className="pb-2">Net change</th>
                  <th className="pb-2">Production</th>
                  <th className="pb-2">Cost</th>
                  <th className="pb-2">Asset life</th>
                  <th className="pb-2">Readiness</th>
                </tr>
              </thead>
              <tbody>
                {risk.treatments.map((item) => (
                  <tr key={item.id} className="border-t border-white/6">
                    <td className="py-2.5 pr-3 text-slate-200">
                      {item.label}
                      {item.selected && (
                        <span className="ml-2 text-[9px] text-teal-300">
                          SELECTED
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 text-slate-400">
                      {item.strategy.replaceAll("_", " ")}
                    </td>
                    <td className="py-2.5 pr-3 font-mono text-slate-300">
                      {score(item.residual_risk)}
                    </td>
                    <td className="py-2.5 pr-3 font-mono text-teal-300">
                      {score(item.net_risk_change)}
                    </td>
                    <td className="py-2.5 pr-3 text-slate-300">
                      {item.objective_tradeoffs.production ?? "—"}
                    </td>
                    <td className="py-2.5 pr-3 text-slate-300">
                      {money(item.cost)}
                    </td>
                    <td className="py-2.5 pr-3 text-slate-300">
                      {item.asset_life_impact ?? "—"}
                    </td>
                    <td className="py-2.5">
                      <Pill
                        tone={
                          item.executable
                            ? "border-emerald-500/25 bg-emerald-500/8 text-emerald-300"
                            : "border-red-500/25 bg-red-500/8 text-red-300"
                        }
                      >
                        {item.executable
                          ? "Executable"
                          : `${item.readiness_gaps.length} gap(s)`}
                      </Pill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-white/7 bg-[#0D1520] p-4">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
            <Database className="h-4 w-4 text-cyan-300" />
            Evidence, assumptions & limitations
          </h3>
          <Pill>{risk.evidence.length} evidence item(s)</Pill>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-slate-500">
              Latest evidence
            </p>
            {risk.evidence.slice(0, 3).map((item) => (
              <p
                key={item.id}
                className="mt-2 text-xs leading-relaxed text-slate-400"
              >
                <span className="text-slate-300">{item.source}:</span>{" "}
                {item.description}
              </p>
            ))}
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-slate-500">
              Assumptions
            </p>
            <ul className="mt-2 space-y-1 text-xs text-slate-400">
              {risk.assumptions.map((item) => (
                <li key={item}>• {item}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-slate-500">
              Bias review
            </p>
            <ul className="mt-2 space-y-1 text-xs text-slate-400">
              {risk.biases.map((item) => (
                <li key={item}>• {item}</li>
              ))}
              {risk.biases.length === 0 && (
                <li>
                  {risk.bias_review_complete
                    ? "No material bias identified"
                    : "Not reviewed"}
                </li>
              )}
            </ul>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-slate-500">
              Method limitations
            </p>
            <ul className="mt-2 space-y-1 text-xs text-slate-400">
              {risk.method_limitations.map((item) => (
                <li key={item}>• {item}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-slate-500">
              Information decision
            </p>
            <p className="mt-2 text-xs leading-relaxed text-slate-400">
              {String(
                risk.value_of_information.recommendation ??
                  "No value-of-information analysis",
              ).replaceAll("_", " ")}
            </p>
            <p className="mt-2 text-[10px] text-slate-500">
              Reporting: {risk.reporting_profile.frequency ?? "not set"} ·{" "}
              {risk.reporting_profile.method ?? "method not set"}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

function Modal({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-2xl border border-white/10 bg-[#09111b] shadow-2xl"
      >
        <div className="sticky top-0 z-10 flex items-start justify-between border-b border-white/7 bg-[#09111b]/95 px-5 py-4 backdrop-blur">
          <div>
            <h2 className="text-lg font-bold text-white">{title}</h2>
            <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-white/5 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  required = false,
  min,
  max,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  required?: boolean;
  min?: number;
  max?: number;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-medium text-slate-400">
        {label}
        {required && <span className="text-red-300"> *</span>}
      </span>
      <input
        type={type}
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
        className="mt-1 w-full rounded-lg border border-white/9 bg-white/4 px-3 py-2 text-sm text-white outline-none placeholder:text-slate-600 focus:border-teal-500/45"
      />
    </label>
  );
}

function TextArea({
  label,
  value,
  onChange,
  placeholder,
  required = false,
  rows = 3,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  rows?: number;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-medium text-slate-400">
        {label}
        {required && <span className="text-red-300"> *</span>}
      </span>
      <textarea
        rows={rows}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
        className="mt-1 w-full resize-y rounded-lg border border-white/9 bg-white/4 px-3 py-2 text-sm text-white outline-none placeholder:text-slate-600 focus:border-teal-500/45"
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-medium text-slate-400">
        {label}
        {required && <span className="text-red-300"> *</span>}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        className="mt-1 w-full rounded-lg border border-white/9 bg-[#0D1520] px-3 py-2 text-sm text-white outline-none focus:border-teal-500/45"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function SubmitBar({
  busy,
  error,
  label,
}: {
  busy: boolean;
  error: string | null;
  label: string;
}) {
  return (
    <div className="mt-5 flex items-center justify-between gap-3 border-t border-white/7 pt-4">
      <p className="text-xs text-red-300">{error}</p>
      <button
        type="submit"
        disabled={busy}
        className="ml-auto rounded-lg bg-teal-500 px-4 py-2 text-sm font-bold text-[#04100f] hover:bg-teal-400 disabled:opacity-50"
      >
        {busy ? "Working…" : label}
      </button>
    </div>
  );
}

function ImplementationModal({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => void;
}) {
  const [form, setForm] = useState({
    industry_code: "mining",
    objectives: "",
    critical_services: "",
    stakeholders: "",
    obligations: "",
    existing_systems: "CMMS, historian",
    risk_owner_role: "",
    acceptance_authority: "",
    decision_points: "Maintenance deferral, shutdown scope, capital project",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const industryFocus = getIndustryRiskFocus(form.industry_code);
  const set = (key: keyof typeof form) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await startIso31000Implementation({
        industry_code: form.industry_code,
        objectives: splitList(form.objectives),
        critical_services: splitList(form.critical_services),
        stakeholders: splitList(form.stakeholders),
        obligations: splitList(form.obligations),
        existing_systems: splitList(form.existing_systems),
        risk_owner_role: form.risk_owner_role,
        acceptance_authority: form.acceptance_authority,
        decision_points: splitList(form.decision_points),
        dependencies: industryFocus?.riskObjects ?? [],
        industry_risk_objects: industryFocus?.riskObjects ?? [],
      });
      onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Setup failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="ISO 31000 implementation copilot"
      subtitle="Creates draft context and criteria only. Leadership adoption remains mandatory."
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/6 p-3 text-xs leading-relaxed text-amber-100/80">
          <strong>Controlled setup:</strong> SyncAI will assess the current
          state, name gaps and create a roadmap. It will not claim certification
          or adopt risk policy for the organization.
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <SelectField
            label="Industry pack"
            value={form.industry_code}
            onChange={set("industry_code")}
            options={[
              "mining",
              "oil_gas",
              "utilities",
              "manufacturing",
              "transportation_logistics",
              "buildings_infrastructure",
            ].map((value) => ({ value, label: value.replaceAll("_", " ") }))}
          />
          <div className="rounded-xl border border-white/7 bg-white/3 p-3 text-xs text-slate-400">
            <p className="font-semibold text-slate-200">Pack risk focus</p>
            <p className="mt-1 leading-relaxed">
              {industryFocus?.riskObjects.join(" · ") ||
                "No governed industry focus is available."}
            </p>
            {(industryFocus?.proseOnly.length ?? 0) > 0 && (
              <p className="mt-2 text-[10px] text-amber-300">
                {industryFocus?.proseOnly.length} profile item(s) remain prose
                guidance and are not counted as executable policy.
              </p>
            )}
          </div>
          <TextArea
            label="Mission and objectives"
            value={form.objectives}
            onChange={set("objectives")}
            placeholder="Safe production, service continuity"
            required
          />
          <TextArea
            label="Critical services"
            value={form.critical_services}
            onChange={set("critical_services")}
            placeholder="Mine haulage, process water"
            required
          />
          <TextArea
            label="Stakeholders"
            value={form.stakeholders}
            onChange={set("stakeholders")}
            placeholder="Operations, maintenance, safety, community"
            required
          />
          <TextArea
            label="Regulatory and contractual obligations"
            value={form.obligations}
            onChange={set("obligations")}
            required
          />
          <TextArea
            label="Existing systems and data"
            value={form.existing_systems}
            onChange={set("existing_systems")}
            required
          />
          <Field
            label="Accountable risk-owner role"
            value={form.risk_owner_role}
            onChange={set("risk_owner_role")}
            required
          />
          <Field
            label="Risk-acceptance authority source"
            value={form.acceptance_authority}
            onChange={set("acceptance_authority")}
            placeholder="Approved delegation of authority"
            required
          />
          <TextArea
            label="Where important decisions are made"
            value={form.decision_points}
            onChange={set("decision_points")}
            required
          />
        </div>
        <SubmitBar
          busy={busy}
          error={error}
          label="Create controlled implementation draft"
        />
      </form>
    </Modal>
  );
}

function AssessmentModal({
  cockpit,
  participants,
  assets,
  onClose,
  onDone,
}: {
  cockpit: RiskCockpit;
  participants: RiskParticipant[];
  assets: AssetRow[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [form, setForm] = useState<Record<string, string>>({
    title: "",
    kind: "threat",
    context_id: cockpit.contexts[0]?.id ?? "",
    criteria_profile_id: cockpit.criteria[0]?.id ?? "",
    asset_id: "",
    objective_at_risk: "",
    risk_source: "",
    event_description: "",
    causes: "",
    stakeholders: "",
    scope_decision: "",
    scope_expected_outcome: "",
    scope_inclusions: "",
    scope_exclusions: "",
    time_horizon: "",
    location_scope: "",
    resource_scope: "",
    responsibility_scope: "",
    relationship_scope: "",
    assumptions: "",
    biases: "",
    bias_review_complete: "true",
    method_limitations: "",
    data_quality: "unknown",
    risk_owner_id: participants[0]?.id ?? "",
    decision_owner_id: participants[0]?.id ?? "",
    existing_controls_summary: "",
    analysis_level: "semi_quantitative",
    analysis_method: "risk_matrix",
    analysis_model_reference: "",
    likelihood: "3",
    control_effectiveness: "0",
    uncertainty: "50",
    confidence: "50",
    complexity: "50",
    connectivity: "50",
    exposure: "50",
    capacity_load: "0",
    risk_velocity: "0",
    value_at_risk: "0",
    value_currency: "USD",
    reporting_audiences: "technician, supervisor, manager, executive, board",
    reporting_frequency: "on material change",
    reporting_method: "in-app cockpit",
    reporting_timeliness: "immediate for threshold breach",
    reporting_cost_limit: "0",
    information_sensitivity: "internal",
    ...Object.fromEntries(
      CONSEQUENCE_DIMENSIONS.map((dimension) => [
        `consequence_${dimension}`,
        "1",
      ]),
    ),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (key: string) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const selectedAsset = assets.find((item) => item.id === form.asset_id);
      const draft: RiskAssessmentDraft = {
        title: form.title,
        kind: form.kind as RiskKind,
        context_id: form.context_id,
        criteria_profile_id: form.criteria_profile_id,
        asset_id: form.asset_id || undefined,
        site_id: selectedAsset?.site_id ?? undefined,
        objective_at_risk: form.objective_at_risk,
        risk_source: form.risk_source,
        event_description: form.event_description,
        causes: splitList(form.causes),
        consequences: Object.fromEntries(
          CONSEQUENCE_DIMENSIONS.map((dimension) => [
            dimension,
            Number(form[`consequence_${dimension}`]),
          ]),
        ),
        likelihood: Number(form.likelihood),
        existing_controls_summary: form.existing_controls_summary,
        analysis_level:
          form.analysis_level as RiskAssessmentDraft["analysis_level"],
        analysis_method: form.analysis_method,
        analysis_model_reference: form.analysis_model_reference || undefined,
        control_effectiveness: Number(form.control_effectiveness),
        uncertainty: Number(form.uncertainty),
        confidence: Number(form.confidence),
        complexity: Number(form.complexity),
        connectivity: Number(form.connectivity),
        exposure: Number(form.exposure),
        capacity_load: Number(form.capacity_load),
        risk_velocity: Number(form.risk_velocity),
        risk_owner_id: form.risk_owner_id,
        decision_owner_id: form.decision_owner_id,
        stakeholders: splitList(form.stakeholders),
        scope_decision: form.scope_decision,
        scope_expected_outcome: form.scope_expected_outcome,
        scope_inclusions: splitList(form.scope_inclusions),
        scope_exclusions: splitList(form.scope_exclusions),
        time_horizon: form.time_horizon,
        location_scope: form.location_scope,
        resource_scope: splitList(form.resource_scope),
        responsibility_scope: splitList(form.responsibility_scope),
        relationship_scope: splitList(form.relationship_scope),
        assumptions: splitList(form.assumptions),
        biases: splitList(form.biases),
        bias_review_complete: form.bias_review_complete === "true",
        method_limitations: splitList(form.method_limitations),
        data_quality: form.data_quality,
        value_at_risk: Number(form.value_at_risk),
        value_currency: form.value_currency,
        reporting_profile: {
          audiences: splitList(form.reporting_audiences),
          frequency: form.reporting_frequency,
          method: form.reporting_method,
          timeliness: form.reporting_timeliness,
          cost_limit: Number(form.reporting_cost_limit),
        },
        information_sensitivity:
          form.information_sensitivity as RiskAssessmentDraft["information_sensitivity"],
        status: "identified",
      };
      await createRiskAssessment(draft);
      onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Assessment failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="New risk assessment"
      subtitle="Scope → identify → analyze → evaluate. Every required boundary and assumption stays explicit."
      onClose={onClose}
    >
      <form onSubmit={submit} className="space-y-5">
        <section>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
            <Target className="h-4 w-4 text-teal-300" />
            1. Decision scope
          </h3>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <Field
              label="Assessment title"
              value={form.title}
              onChange={set("title")}
              required
            />
            <SelectField
              label="Threat or opportunity"
              value={form.kind}
              onChange={set("kind")}
              options={[
                { value: "threat", label: "Threat" },
                { value: "opportunity", label: "Opportunity" },
                { value: "both", label: "Both" },
              ]}
            />
            <SelectField
              label="Context"
              value={form.context_id}
              onChange={set("context_id")}
              options={cockpit.contexts.map((item) => ({
                value: item.id,
                label: `${item.kind}: ${item.name}`,
              }))}
              required
            />
            <SelectField
              label="Criteria profile"
              value={form.criteria_profile_id}
              onChange={set("criteria_profile_id")}
              options={cockpit.criteria.map((item) => ({
                value: item.id,
                label: `${item.name} (${item.status})`,
              }))}
              required
            />
            <SelectField
              label="Asset (optional)"
              value={form.asset_id}
              onChange={set("asset_id")}
              options={[
                { value: "", label: "Enterprise / activity risk" },
                ...assets.map((item) => ({
                  value: item.id,
                  label: `${item.tag ?? "—"} · ${item.name}`,
                })),
              ]}
            />
            <Field
              label="Objective at risk"
              value={form.objective_at_risk}
              onChange={set("objective_at_risk")}
              required
            />
            <TextArea
              label="Decision being supported"
              value={form.scope_decision}
              onChange={set("scope_decision")}
              required
            />
            <TextArea
              label="Expected decision outcome"
              value={form.scope_expected_outcome}
              onChange={set("scope_expected_outcome")}
              required
            />
            <TextArea
              label="Inside the assessment"
              value={form.scope_inclusions}
              onChange={set("scope_inclusions")}
              required
            />
            <TextArea
              label="Outside the assessment"
              value={form.scope_exclusions}
              onChange={set("scope_exclusions")}
              required
            />
            <Field
              label="Time horizon"
              value={form.time_horizon}
              onChange={set("time_horizon")}
              placeholder="Next 90 days / current shutdown"
              required
            />
            <Field
              label="Location"
              value={form.location_scope}
              onChange={set("location_scope")}
              required
            />
            <Field
              label="Estimated value at risk"
              type="number"
              min={0}
              value={form.value_at_risk}
              onChange={set("value_at_risk")}
            />
            <Field
              label="Value currency"
              value={form.value_currency}
              onChange={set("value_currency")}
              required
            />
            <TextArea
              label="Reporting audiences"
              value={form.reporting_audiences}
              onChange={set("reporting_audiences")}
              required
            />
            <Field
              label="Reporting frequency"
              value={form.reporting_frequency}
              onChange={set("reporting_frequency")}
              required
            />
            <Field
              label="Reporting method"
              value={form.reporting_method}
              onChange={set("reporting_method")}
              required
            />
            <Field
              label="Required reporting timeliness"
              value={form.reporting_timeliness}
              onChange={set("reporting_timeliness")}
              required
            />
            <Field
              label="Reporting cost limit"
              type="number"
              min={0}
              value={form.reporting_cost_limit}
              onChange={set("reporting_cost_limit")}
            />
            <SelectField
              label="Information sensitivity"
              value={form.information_sensitivity}
              onChange={set("information_sensitivity")}
              options={["public", "internal", "confidential", "restricted"].map(
                (value) => ({ value, label: value }),
              )}
            />
          </div>
        </section>
        <section>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
            <FileWarning className="h-4 w-4 text-amber-300" />
            2. Identification & governance
          </h3>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <Field
              label="Risk source"
              value={form.risk_source}
              onChange={set("risk_source")}
              required
            />
            <TextArea
              label="Uncertain event"
              value={form.event_description}
              onChange={set("event_description")}
              required
            />
            <TextArea
              label="Causes"
              value={form.causes}
              onChange={set("causes")}
              required
            />
            <TextArea
              label="Stakeholders"
              value={form.stakeholders}
              onChange={set("stakeholders")}
              required
            />
            <SelectField
              label="Named risk owner"
              value={form.risk_owner_id}
              onChange={set("risk_owner_id")}
              options={participants.map((item) => ({
                value: item.id,
                label: `${item.full_name ?? item.id} · ${item.role ?? "no role"}`,
              }))}
              required
            />
            <SelectField
              label="Named decision owner"
              value={form.decision_owner_id}
              onChange={set("decision_owner_id")}
              options={participants.map((item) => ({
                value: item.id,
                label: `${item.full_name ?? item.id} · ${item.role ?? "no role"}`,
              }))}
              required
            />
            <TextArea
              label="Required resources"
              value={form.resource_scope}
              onChange={set("resource_scope")}
              required
            />
            <TextArea
              label="Responsibilities"
              value={form.responsibility_scope}
              onChange={set("responsibility_scope")}
              required
            />
            <TextArea
              label="Relationships to other activities"
              value={form.relationship_scope}
              onChange={set("relationship_scope")}
              required
            />
            <TextArea
              label="Existing controls"
              value={form.existing_controls_summary}
              onChange={set("existing_controls_summary")}
            />
            <TextArea
              label="Assumptions"
              value={form.assumptions}
              onChange={set("assumptions")}
              required
            />
            <TextArea
              label="Known biases, beliefs or framing effects (empty means none identified)"
              value={form.biases}
              onChange={set("biases")}
            />
            <SelectField
              label="Bias review completed?"
              value={form.bias_review_complete}
              onChange={set("bias_review_complete")}
              options={[
                { value: "true", label: "Yes — explicitly reviewed" },
                { value: "false", label: "No — keep as draft" },
              ]}
            />
            <TextArea
              label="Method limitations"
              value={form.method_limitations}
              onChange={set("method_limitations")}
              required
            />
            <Field
              label="Data quality"
              value={form.data_quality}
              onChange={set("data_quality")}
              required
            />
          </div>
        </section>
        <section>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
            <ChartNoAxesCombined className="h-4 w-4 text-cyan-300" />
            3. Initial analysis inputs
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            These inputs are recorded; an authoritative evaluation still
            requires adopted criteria and a separate human decision.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3">
            <SelectField
              label="Analysis level"
              value={form.analysis_level}
              onChange={set("analysis_level")}
              options={["qualitative", "semi_quantitative", "quantitative"].map(
                (value) => ({
                  value,
                  label: value.replaceAll("_", " "),
                }),
              )}
            />
            <SelectField
              label="Analysis method"
              value={form.analysis_method}
              onChange={set("analysis_method")}
              options={ANALYSIS_METHODS.map((item) => ({
                value: item.key,
                label: `${item.key.replaceAll("_", " ")} · ${item.level}`,
              }))}
            />
            <Field
              label="Model / calculation reference"
              value={form.analysis_model_reference}
              onChange={set("analysis_model_reference")}
              placeholder="Workbook, model run, report or dataset ID"
            />
            {CONSEQUENCE_DIMENSIONS.map((dimension) => (
              <Field
                key={dimension}
                label={`${dimension.replaceAll("_", " ")} consequence`}
                type="number"
                min={1}
                max={5}
                value={form[`consequence_${dimension}`]}
                onChange={set(`consequence_${dimension}`)}
              />
            ))}
            <Field
              label="Likelihood"
              type="number"
              min={1}
              max={5}
              value={form.likelihood}
              onChange={set("likelihood")}
            />
            <Field
              label="Control effectiveness %"
              type="number"
              min={0}
              max={100}
              value={form.control_effectiveness}
              onChange={set("control_effectiveness")}
            />
            <Field
              label="Uncertainty %"
              type="number"
              min={0}
              max={100}
              value={form.uncertainty}
              onChange={set("uncertainty")}
            />
            <Field
              label="Confidence %"
              type="number"
              min={0}
              max={100}
              value={form.confidence}
              onChange={set("confidence")}
            />
            <Field
              label="Complexity %"
              type="number"
              min={0}
              max={100}
              value={form.complexity}
              onChange={set("complexity")}
            />
            <Field
              label="Connectivity %"
              type="number"
              min={0}
              max={100}
              value={form.connectivity}
              onChange={set("connectivity")}
            />
            <Field
              label="Exposure %"
              type="number"
              min={0}
              max={100}
              value={form.exposure}
              onChange={set("exposure")}
            />
            <Field
              label="Capacity load"
              type="number"
              min={0}
              max={100}
              value={form.capacity_load}
              onChange={set("capacity_load")}
            />
            <Field
              label="Velocity"
              type="number"
              min={-100}
              max={100}
              value={form.risk_velocity}
              onChange={set("risk_velocity")}
            />
          </div>
        </section>
        <SubmitBar busy={busy} error={error} label="Create identified risk" />
      </form>
    </Modal>
  );
}

function ActionModal({
  risk,
  allRisks,
  participants,
  kind,
  targetId,
  onClose,
  onDone,
}: {
  risk: RiskRecord;
  allRisks: RiskRecord[];
  participants: RiskParticipant[];
  kind: ActionKind;
  targetId?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [form, setForm] = useState<Record<string, string>>({
    source_system: "",
    signal_kind: "inspection",
    description: "",
    data_quality: "good",
    stakeholder_name: "",
    stakeholder_role: "",
    view_kind: "technical",
    likelihood: "3",
    consequence: "3",
    concern_level: "medium",
    rationale: "",
    information_to_resolve: "",
    analysis_level: "semi_quantitative",
    analysis_method: "risk_matrix",
    analysis_model_reference: "",
    control_effectiveness: String(risk.control_effectiveness ?? 0),
    uncertainty: String(risk.uncertainty ?? 50),
    confidence: String(risk.confidence ?? 50),
    complexity: String(risk.complexity ?? 50),
    connectivity: String(risk.connectivity ?? 50),
    exposure: String(risk.exposure ?? 50),
    capacity_load: String(risk.capacity_load ?? 0),
    velocity: String(risk.velocity ?? 0),
    time_to_unacceptable_days: "",
    opportunity_value: String(risk.opportunity_score ?? 0),
    action: risk.decision_action ?? "INVESTIGATE",
    residual_risk_score: String(
      risk.residual_risk_score ?? risk.current_risk_score ?? 0,
    ),
    residual_risk_level:
      risk.residual_risk_level ?? risk.current_risk_level ?? "Medium",
    review_date: risk.review_date ?? "",
    reassessment_trigger: risk.escalation_threshold ?? "",
    strategy: "change_likelihood",
    label: "",
    cost: "0",
    introduced_risk: "0",
    introduced_risks: "",
    production_impact: "",
    safety_impact: "",
    financial_impact: "",
    asset_life_impact: "",
    downtime_impact: "",
    required_resources: "",
    available_resources: "",
    required_competencies: "",
    treatment_owner_id: participants[0]?.id ?? "",
    required_approver_role: "",
    verification_method: "",
    alternatives_considered: "",
    consequence_summary: "",
    required_completion_date: "",
    select: "false",
    result: "achieved",
    measurement: "",
    observed_risk_score: String(risk.current_risk_score ?? 0),
    observed_risk_level: risk.current_risk_level ?? "Medium",
    value: "",
    test_method: "",
    test_result: "passed",
    intended_effect_observed: "true",
    failures_despite_control: "0",
    note: "",
    compensating_controls: "",
    expires_at: "",
    information_action: "",
    information_cost: "0",
    decision_cost_if_wrong: String(risk.value_at_risk ?? 0),
    uncertainty_reduction: "0.5",
    probability_decision_changes: "0.5",
    control_name: "",
    control_type: "preventive",
    intended_effect: "",
    intended_modifier: "likelihood",
    control_owner_id: participants[0]?.id ?? "",
    assurance_method: "",
    test_frequency_days: "30",
    claimed_reduction: "",
    evidence_basis: "",
    design_status: "draft",
    indicator_name: "",
    source_system_indicator: "",
    signal_key: "",
    unit: "",
    direction: "higher_is_worse",
    warning_threshold: "",
    critical_threshold: "",
    low_threshold: "",
    high_threshold: "",
    refresh_interval_minutes: "60",
    target_risk_id: allRisks.find((item) => item.id !== risk.id)?.id ?? "",
    relationship: "common_dependency",
    dependency_key: "",
    strength: "50",
    link_rationale: "",
    approval_action: "approve",
    approval_note: "",
    ...Object.fromEntries(
      CONSEQUENCE_DIMENSIONS.map((dimension) => [
        `consequence_${dimension}`,
        String(Number(risk.consequences[dimension] ?? 1)),
      ]),
    ),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (key: string) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (kind === "evidence")
        await ingestRiskEvidence(risk.id, {
          source_system: form.source_system,
          signal_kind: form.signal_kind,
          description: form.description,
          data_quality: form.data_quality,
          evidence_type: form.signal_kind,
          provenance: { entered_via: "risk_cockpit" },
        });
      if (kind === "view")
        await recordStakeholderView(risk.id, {
          stakeholder_name: form.stakeholder_name,
          stakeholder_role: form.stakeholder_role,
          view_kind: form.view_kind,
          perceived_likelihood: Number(form.likelihood),
          perceived_consequence: Number(form.consequence),
          concern_level: form.concern_level,
          rationale: form.rationale,
          information_to_resolve: form.information_to_resolve,
          assumptions: [],
        });
      if (kind === "analysis")
        await recordRiskAnalysis(risk.id, {
          analysis_level: form.analysis_level,
          analysis_method: form.analysis_method,
          analysis_model_reference: form.analysis_model_reference || null,
          likelihood: Number(form.likelihood),
          consequences: Object.fromEntries(
            CONSEQUENCE_DIMENSIONS.map((dimension) => [
              dimension,
              Number(form[`consequence_${dimension}`]),
            ]),
          ),
          control_effectiveness: Number(form.control_effectiveness),
          uncertainty: Number(form.uncertainty),
          confidence: Number(form.confidence),
          complexity: Number(form.complexity),
          connectivity: Number(form.connectivity),
          exposure: Number(form.exposure),
          capacity_load: Number(form.capacity_load),
          velocity: Number(form.velocity),
          time_to_unacceptable_days: form.time_to_unacceptable_days
            ? Number(form.time_to_unacceptable_days)
            : null,
          opportunity_value: Number(form.opportunity_value),
        });
      if (kind === "information")
        await recordRiskValueOfInformation(risk.id, {
          information_action: form.information_action,
          information_cost: Number(form.information_cost),
          decision_cost_if_wrong: Number(form.decision_cost_if_wrong),
          uncertainty_reduction: Number(form.uncertainty_reduction),
          probability_decision_changes: Number(
            form.probability_decision_changes,
          ),
          currency: risk.value_currency,
        });
      if (kind === "decision") {
        await recordRiskDecision({
          riskId: risk.id,
          action: form.action,
          rationale: form.rationale,
          residualRiskScore: Number(form.residual_risk_score),
          residualRiskLevel: form.residual_risk_level,
          reviewDate: form.review_date || null,
          reassessmentTrigger: form.reassessment_trigger || null,
        });
        if (form.action === "ACCEPT" && form.expires_at)
          await acceptResidualRisk({
            riskId: risk.id,
            riskLevel: form.residual_risk_level,
            rationale: form.rationale,
            compensatingControls: form.compensating_controls,
            expiresAt: new Date(form.expires_at).toISOString(),
            reassessmentTrigger: form.reassessment_trigger,
          });
      }
      if (kind === "treatment")
        await createRiskTreatment(
          risk.id,
          {
            key: form.strategy,
            label: form.label,
            strategy: form.strategy,
            cost: Number(form.cost),
            residual_risk: Number(form.residual_risk_score),
            introduced_risk: Number(form.introduced_risk),
            introduced_risks: splitList(form.introduced_risks),
            production_impact: form.production_impact,
            safety_risk: form.safety_impact,
            financial_exposure: form.financial_impact,
            asset_life_impact: form.asset_life_impact,
            downtime_impact: form.downtime_impact,
            objective_tradeoffs: {
              production: form.production_impact,
              risk: form.residual_risk_level,
              cost: form.financial_impact || form.cost,
              asset_life: form.asset_life_impact,
            },
            confidence: Number(form.confidence),
            required_resources: splitList(form.required_resources),
            available_resources: splitList(form.available_resources),
            required_competencies: splitList(form.required_competencies),
            treatment_owner_id: form.treatment_owner_id,
            required_approver_role: form.required_approver_role,
            verification_method: form.verification_method,
            alternatives_considered: form.alternatives_considered,
            consequence_summary: form.consequence_summary,
            required_completion_date: form.required_completion_date,
            rationale: form.rationale,
            action: form.label,
          },
          form.select === "true",
        );
      if (kind === "outcome")
        await recordRiskOutcome(risk.id, {
          result: form.result,
          measurement: form.measurement,
          observed_risk_score: Number(form.observed_risk_score),
          observed_risk_level: form.observed_risk_level,
        });
      if (kind === "configure_control")
        await configureRiskControl(risk.id, {
          name: form.control_name,
          control_type: form.control_type,
          intended_effect: form.intended_effect,
          intended_modifier: form.intended_modifier,
          control_owner_id: form.control_owner_id,
          assurance_method: form.assurance_method,
          test_frequency_days: Number(form.test_frequency_days),
          claimed_reduction: form.claimed_reduction
            ? Number(form.claimed_reduction)
            : null,
          evidence_basis: form.evidence_basis,
          design_status: form.design_status,
        });
      if (kind === "configure_indicator") {
        const thresholds =
          form.direction === "outside_band"
            ? {
                low: Number(form.low_threshold),
                high: Number(form.high_threshold),
              }
            : form.direction === "state_change"
              ? {}
              : {
                  warning: Number(form.warning_threshold),
                  critical: Number(form.critical_threshold),
                };
        await configureRiskIndicator(risk.id, {
          name: form.indicator_name,
          source_system: form.source_system_indicator,
          signal_key: form.signal_key,
          unit: form.unit,
          direction: form.direction,
          thresholds,
          refresh_interval_minutes: Number(form.refresh_interval_minutes),
        });
      }
      if (kind === "link")
        await linkRisks({
          sourceRiskId: risk.id,
          targetRiskId: form.target_risk_id,
          relationship: form.relationship,
          dependencyKey: form.dependency_key,
          strength: Number(form.strength),
          rationale: form.link_rationale,
        });
      if (kind === "decision_approval" && targetId)
        await decideRiskDecision(
          targetId,
          form.approval_action === "approve",
          form.approval_note,
        );
      if (kind === "indicator" && targetId)
        await recordRiskIndicatorObservation({
          indicatorId: targetId,
          value: Number(form.value),
          observedAt: new Date().toISOString(),
          dataQuality: form.data_quality,
        });
      if (kind === "control" && targetId)
        await recordRiskControlTest(targetId, {
          test_method: form.test_method,
          result: form.test_result,
          intended_effect_observed: form.intended_effect_observed === "true",
          failures_despite_control: Number(form.failures_despite_control),
          note: form.note,
        });
      onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }
  const levelOptions = ["Very Low", "Low", "Medium", "High", "Critical"].map(
    (value) => ({ value, label: value }),
  );
  return (
    <Modal
      title={`${kind === "view" ? "Stakeholder view" : kind.charAt(0).toUpperCase() + kind.slice(1)} · ${risk.title}`}
      subtitle="The action is tenant-scoped, evidence-traced and cannot bypass human approval."
      onClose={onClose}
    >
      <form onSubmit={submit} className="space-y-3">
        {kind === "evidence" && (
          <div className="grid gap-3 md:grid-cols-2">
            <Field
              label="Source system"
              value={form.source_system}
              onChange={set("source_system")}
              required
            />
            <SelectField
              label="Signal kind"
              value={form.signal_kind}
              onChange={set("signal_kind")}
              options={[
                "work_order",
                "reliability_history",
                "condition_monitoring",
                "process_historian",
                "inspection",
                "audit",
                "incident",
                "near_miss",
                "engineering_change",
                "supplier",
                "regulatory",
                "production_loss",
                "weather",
                "market",
                "workforce",
                "cyber",
                "other",
              ].map((value) => ({ value, label: value.replaceAll("_", " ") }))}
            />
            <TextArea
              label="Evidence observed"
              value={form.description}
              onChange={set("description")}
              required
            />
            <Field
              label="Data quality"
              value={form.data_quality}
              onChange={set("data_quality")}
              required
            />
          </div>
        )}
        {kind === "view" && (
          <div className="grid gap-3 md:grid-cols-2">
            <Field
              label="Stakeholder"
              value={form.stakeholder_name}
              onChange={set("stakeholder_name")}
              required
            />
            <Field
              label="Role / perspective"
              value={form.stakeholder_role}
              onChange={set("stakeholder_role")}
            />
            <SelectField
              label="View type"
              value={form.view_kind}
              onChange={set("view_kind")}
              options={[
                "technical",
                "operational",
                "financial",
                "stakeholder_concern",
                "oversight",
              ].map((value) => ({ value, label: value.replaceAll("_", " ") }))}
            />
            <Field
              label="Perceived likelihood"
              type="number"
              min={1}
              max={5}
              value={form.likelihood}
              onChange={set("likelihood")}
            />
            <Field
              label="Perceived consequence"
              type="number"
              min={1}
              max={5}
              value={form.consequence}
              onChange={set("consequence")}
            />
            <SelectField
              label="Concern"
              value={form.concern_level}
              onChange={set("concern_level")}
              options={["low", "medium", "high", "critical"].map((value) => ({
                value,
                label: value,
              }))}
            />
            <TextArea
              label="Rationale"
              value={form.rationale}
              onChange={set("rationale")}
              required
            />
            <TextArea
              label="Information that would resolve disagreement"
              value={form.information_to_resolve}
              onChange={set("information_to_resolve")}
            />
          </div>
        )}
        {kind === "analysis" && (
          <div>
            <div className="grid gap-3 md:grid-cols-2">
              <SelectField
                label="Analysis level"
                value={form.analysis_level}
                onChange={set("analysis_level")}
                options={[
                  "qualitative",
                  "semi_quantitative",
                  "quantitative",
                ].map((value) => ({
                  value,
                  label: value.replaceAll("_", " "),
                }))}
              />
              <SelectField
                label="Method"
                value={form.analysis_method}
                onChange={set("analysis_method")}
                options={ANALYSIS_METHODS.map((item) => ({
                  value: item.key,
                  label: `${item.key.replaceAll("_", " ")} · ${item.level}`,
                }))}
              />
              <Field
                label="Model / calculation reference"
                value={form.analysis_model_reference}
                onChange={set("analysis_model_reference")}
                placeholder="Model run, report, dataset or notebook ID"
              />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3">
              {CONSEQUENCE_DIMENSIONS.map((dimension) => (
                <Field
                  key={dimension}
                  label={dimension.replaceAll("_", " ")}
                  type="number"
                  min={1}
                  max={5}
                  value={form[`consequence_${dimension}`]}
                  onChange={set(`consequence_${dimension}`)}
                />
              ))}
              <Field
                label="Likelihood"
                type="number"
                min={1}
                max={5}
                value={form.likelihood}
                onChange={set("likelihood")}
              />
              {[
                "control_effectiveness",
                "uncertainty",
                "confidence",
                "complexity",
                "connectivity",
                "exposure",
                "capacity_load",
                "velocity",
              ].map((key) => (
                <Field
                  key={key}
                  label={key.replaceAll("_", " ")}
                  type="number"
                  min={key === "velocity" ? -100 : 0}
                  max={100}
                  value={form[key]}
                  onChange={set(key)}
                />
              ))}
              <Field
                label="Days to unacceptable"
                type="number"
                min={0}
                value={form.time_to_unacceptable_days}
                onChange={set("time_to_unacceptable_days")}
              />
              {risk.kind !== "threat" && (
                <Field
                  label="Opportunity value (0–100)"
                  type="number"
                  min={0}
                  max={100}
                  value={form.opportunity_value}
                  onChange={set("opportunity_value")}
                />
              )}
            </div>
          </div>
        )}
        {kind === "information" && (
          <div className="grid gap-3 md:grid-cols-2">
            <TextArea
              label="Inspection, test or enquiry being valued"
              value={form.information_action}
              onChange={set("information_action")}
              required
            />
            <Field
              label="Information cost"
              type="number"
              min={0}
              value={form.information_cost}
              onChange={set("information_cost")}
            />
            <Field
              label="Cost if the decision is wrong"
              type="number"
              min={0}
              value={form.decision_cost_if_wrong}
              onChange={set("decision_cost_if_wrong")}
            />
            <Field
              label="Uncertainty reduction (0–1)"
              type="number"
              min={0}
              max={1}
              value={form.uncertainty_reduction}
              onChange={set("uncertainty_reduction")}
            />
            <Field
              label="Probability the decision changes (0–1)"
              type="number"
              min={0}
              max={1}
              value={form.probability_decision_changes}
              onChange={set("probability_decision_changes")}
            />
          </div>
        )}
        {kind === "decision" && (
          <div className="grid gap-3 md:grid-cols-2">
            <SelectField
              label="Decision"
              value={form.action}
              onChange={set("action")}
              options={(
                [
                  "ACCEPT",
                  "MONITOR",
                  "INVESTIGATE",
                  "TREAT",
                  "ESCALATE",
                  "STOP",
                ] as RiskDecision[]
              ).map((value) => ({ value, label: value }))}
            />
            <TextArea
              label="Evidence and trade-off rationale"
              value={form.rationale}
              onChange={set("rationale")}
              required
            />
            <Field
              label="Residual score"
              type="number"
              min={0}
              max={100}
              value={form.residual_risk_score}
              onChange={set("residual_risk_score")}
            />
            <SelectField
              label="Residual level"
              value={form.residual_risk_level}
              onChange={set("residual_risk_level")}
              options={levelOptions}
            />
            <Field
              label="Review date"
              type="date"
              value={form.review_date}
              onChange={set("review_date")}
            />
            <TextArea
              label="Measurable reassessment trigger"
              value={form.reassessment_trigger}
              onChange={set("reassessment_trigger")}
            />
            {form.action === "ACCEPT" && (
              <>
                <TextArea
                  label="Compensating controls"
                  value={form.compensating_controls}
                  onChange={set("compensating_controls")}
                  required
                />
                <Field
                  label="Acceptance expiry"
                  type="date"
                  value={form.expires_at}
                  onChange={set("expires_at")}
                  required
                />
              </>
            )}
          </div>
        )}
        {kind === "treatment" && (
          <div className="grid gap-3 md:grid-cols-2">
            <Field
              label="Option label"
              value={form.label}
              onChange={set("label")}
              required
            />
            <SelectField
              label="Strategy"
              value={form.strategy}
              onChange={set("strategy")}
              options={[
                "avoid",
                "pursue_opportunity",
                "remove_source",
                "change_likelihood",
                "change_consequence",
                "share",
                "retain",
              ].map((value) => ({ value, label: value.replaceAll("_", " ") }))}
            />
            <Field
              label="Cost"
              type="number"
              min={0}
              value={form.cost}
              onChange={set("cost")}
            />
            <Field
              label="Expected residual score"
              type="number"
              min={0}
              max={100}
              value={form.residual_risk_score}
              onChange={set("residual_risk_score")}
            />
            <Field
              label="Introduced-risk score"
              type="number"
              min={0}
              max={100}
              value={form.introduced_risk}
              onChange={set("introduced_risk")}
            />
            <TextArea
              label="New risks introduced (empty is an explicit assessment)"
              value={form.introduced_risks}
              onChange={set("introduced_risks")}
            />
            <Field
              label="Production objective impact"
              value={form.production_impact}
              onChange={set("production_impact")}
            />
            <Field
              label="Safety objective impact"
              value={form.safety_impact}
              onChange={set("safety_impact")}
            />
            <Field
              label="Financial objective impact"
              value={form.financial_impact}
              onChange={set("financial_impact")}
            />
            <Field
              label="Asset-life impact"
              value={form.asset_life_impact}
              onChange={set("asset_life_impact")}
            />
            <Field
              label="Downtime impact"
              value={form.downtime_impact}
              onChange={set("downtime_impact")}
            />
            <TextArea
              label="Required resources"
              value={form.required_resources}
              onChange={set("required_resources")}
            />
            <TextArea
              label="Available resources"
              value={form.available_resources}
              onChange={set("available_resources")}
            />
            <TextArea
              label="Required competency keys"
              value={form.required_competencies}
              onChange={set("required_competencies")}
            />
            <SelectField
              label="Treatment owner"
              value={form.treatment_owner_id}
              onChange={set("treatment_owner_id")}
              options={participants.map((item) => ({
                value: item.id,
                label: `${item.full_name ?? item.id} · ${item.role ?? "no role"}`,
              }))}
            />
            <Field
              label="Required approver role"
              value={form.required_approver_role}
              onChange={set("required_approver_role")}
            />
            <Field
              label="Completion date"
              type="date"
              value={form.required_completion_date}
              onChange={set("required_completion_date")}
            />
            <TextArea
              label="Rationale"
              value={form.rationale}
              onChange={set("rationale")}
            />
            <TextArea
              label="Consequence of being wrong"
              value={form.consequence_summary}
              onChange={set("consequence_summary")}
            />
            <TextArea
              label="Alternatives considered"
              value={form.alternatives_considered}
              onChange={set("alternatives_considered")}
            />
            <TextArea
              label="Verification method"
              value={form.verification_method}
              onChange={set("verification_method")}
            />
            <SelectField
              label="Select and route for approval?"
              value={form.select}
              onChange={set("select")}
              options={[
                { value: "false", label: "Compare only" },
                {
                  value: "true",
                  label: "Select and create governed recommendation",
                },
              ]}
            />
          </div>
        )}
        {kind === "outcome" && (
          <div className="grid gap-3 md:grid-cols-2">
            <SelectField
              label="Result"
              value={form.result}
              onChange={set("result")}
              options={[
                "achieved",
                "not_achieved",
                "inconclusive",
                "risk_realized",
                "opportunity_realized",
              ].map((value) => ({ value, label: value.replaceAll("_", " ") }))}
            />
            <TextArea
              label="What was measured, against what, and when"
              value={form.measurement}
              onChange={set("measurement")}
              required
            />
            <Field
              label="Observed risk score"
              type="number"
              min={0}
              max={100}
              value={form.observed_risk_score}
              onChange={set("observed_risk_score")}
            />
            <SelectField
              label="Observed risk level"
              value={form.observed_risk_level}
              onChange={set("observed_risk_level")}
              options={levelOptions}
            />
          </div>
        )}
        {kind === "configure_control" && (
          <div className="grid gap-3 md:grid-cols-2">
            <Field
              label="Control name"
              value={form.control_name}
              onChange={set("control_name")}
              required
            />
            <SelectField
              label="Control type"
              value={form.control_type}
              onChange={set("control_type")}
              options={[
                "engineered",
                "preventive",
                "detective",
                "procedural",
                "administrative",
                "mitigative",
                "recovery",
                "compensating",
                "governance",
              ].map((value) => ({ value, label: value }))}
            />
            <TextArea
              label="Intended modifying effect"
              value={form.intended_effect}
              onChange={set("intended_effect")}
              required
            />
            <SelectField
              label="Risk driver modified"
              value={form.intended_modifier}
              onChange={set("intended_modifier")}
              options={[
                "likelihood",
                "consequence",
                "exposure",
                "detectability",
                "recovery",
                "uncertainty",
              ].map((value) => ({ value, label: value }))}
            />
            <SelectField
              label="Named control owner"
              value={form.control_owner_id}
              onChange={set("control_owner_id")}
              options={participants.map((item) => ({
                value: item.id,
                label: `${item.full_name ?? item.id} · ${item.role ?? "no role"}`,
              }))}
              required
            />
            <Field
              label="Assurance method"
              value={form.assurance_method}
              onChange={set("assurance_method")}
              required
            />
            <Field
              label="Test frequency (days)"
              type="number"
              min={1}
              value={form.test_frequency_days}
              onChange={set("test_frequency_days")}
            />
            <Field
              label="Claimed reduction % (requires evidence)"
              type="number"
              min={0}
              max={100}
              value={form.claimed_reduction}
              onChange={set("claimed_reduction")}
            />
            <TextArea
              label="Evidence basis"
              value={form.evidence_basis}
              onChange={set("evidence_basis")}
            />
            <SelectField
              label="Design status"
              value={form.design_status}
              onChange={set("design_status")}
              options={["draft", "implemented"].map((value) => ({
                value,
                label: value,
              }))}
            />
          </div>
        )}
        {kind === "configure_indicator" && (
          <div className="grid gap-3 md:grid-cols-2">
            <Field
              label="Indicator name"
              value={form.indicator_name}
              onChange={set("indicator_name")}
              required
            />
            <Field
              label="Source system"
              value={form.source_system_indicator}
              onChange={set("source_system_indicator")}
              required
            />
            <Field
              label="Signal key"
              value={form.signal_key}
              onChange={set("signal_key")}
            />
            <Field label="Unit" value={form.unit} onChange={set("unit")} />
            <SelectField
              label="Direction"
              value={form.direction}
              onChange={set("direction")}
              options={[
                "higher_is_worse",
                "lower_is_worse",
                "outside_band",
                "state_change",
              ].map((value) => ({ value, label: value.replaceAll("_", " ") }))}
            />
            {form.direction !== "outside_band" &&
              form.direction !== "state_change" && (
                <>
                  <Field
                    label="Warning threshold"
                    type="number"
                    value={form.warning_threshold}
                    onChange={set("warning_threshold")}
                    required
                  />
                  <Field
                    label="Critical threshold"
                    type="number"
                    value={form.critical_threshold}
                    onChange={set("critical_threshold")}
                    required
                  />
                </>
              )}
            {form.direction === "outside_band" && (
              <>
                <Field
                  label="Low limit"
                  type="number"
                  value={form.low_threshold}
                  onChange={set("low_threshold")}
                  required
                />
                <Field
                  label="High limit"
                  type="number"
                  value={form.high_threshold}
                  onChange={set("high_threshold")}
                  required
                />
              </>
            )}
            <Field
              label="Refresh interval (minutes)"
              type="number"
              min={1}
              value={form.refresh_interval_minutes}
              onChange={set("refresh_interval_minutes")}
            />
          </div>
        )}
        {kind === "link" && (
          <div className="grid gap-3 md:grid-cols-2">
            <SelectField
              label="Related risk"
              value={form.target_risk_id}
              onChange={set("target_risk_id")}
              options={allRisks
                .filter((item) => item.id !== risk.id)
                .map((item) => ({ value: item.id, label: item.title }))}
              required
            />
            <SelectField
              label="Relationship"
              value={form.relationship}
              onChange={set("relationship")}
              options={[
                "causes",
                "amplifies",
                "cascades_to",
                "common_dependency",
                "common_control",
                "opportunity_tradeoff",
                "sequence",
              ].map((value) => ({ value, label: value.replaceAll("_", " ") }))}
            />
            <Field
              label="Dependency key"
              value={form.dependency_key}
              onChange={set("dependency_key")}
            />
            <Field
              label="Strength %"
              type="number"
              min={0}
              max={100}
              value={form.strength}
              onChange={set("strength")}
            />
            <TextArea
              label="Causal or dependency basis"
              value={form.link_rationale}
              onChange={set("link_rationale")}
              required
            />
          </div>
        )}
        {kind === "decision_approval" && (
          <div className="grid gap-3 md:grid-cols-2">
            <SelectField
              label="Disposition"
              value={form.approval_action}
              onChange={set("approval_action")}
              options={[
                {
                  value: "approve",
                  label: "Approve within my adopted authority",
                },
                { value: "reject", label: "Reject and reopen analysis" },
              ]}
            />
            <TextArea
              label="Approval or rejection basis"
              value={form.approval_note}
              onChange={set("approval_note")}
              required
            />
          </div>
        )}
        {kind === "indicator" && (
          <div className="grid gap-3 md:grid-cols-2">
            <Field
              label="Observed value"
              type="number"
              value={form.value}
              onChange={set("value")}
              required
            />
            <Field
              label="Data quality"
              value={form.data_quality}
              onChange={set("data_quality")}
              required
            />
          </div>
        )}
        {kind === "control" && (
          <div className="grid gap-3 md:grid-cols-2">
            <Field
              label="Test method"
              value={form.test_method}
              onChange={set("test_method")}
              required
            />
            <SelectField
              label="Result"
              value={form.test_result}
              onChange={set("test_result")}
              options={[
                "passed",
                "failed",
                "inconclusive",
                "not_exercised",
              ].map((value) => ({ value, label: value.replaceAll("_", " ") }))}
            />
            <SelectField
              label="Intended effect observed?"
              value={form.intended_effect_observed}
              onChange={set("intended_effect_observed")}
              options={[
                { value: "true", label: "Yes" },
                { value: "false", label: "No" },
              ]}
            />
            <Field
              label="Failures despite control"
              type="number"
              min={0}
              value={form.failures_despite_control}
              onChange={set("failures_despite_control")}
            />
            <TextArea
              label="Evidence note"
              value={form.note}
              onChange={set("note")}
              required
            />
          </div>
        )}
        <SubmitBar busy={busy} error={error} label={`Record ${kind}`} />
      </form>
    </Modal>
  );
}

function GovernanceModal({
  kind,
  cockpit,
  participants,
  assets,
  onClose,
  onDone,
}: {
  kind: GovernanceAction;
  cockpit: RiskCockpit;
  participants: RiskParticipant[];
  assets: AssetRow[];
  onClose: () => void;
  onDone: () => void;
}) {
  const principleKeys = ISO_31000_PRINCIPLES.map((item) => item.key);
  const frameworkKeys = [
    "leadership",
    "integration",
    "design",
    "implementation",
    "evaluation",
    "improvement",
  ];
  const processKeys = [
    "scope_context_criteria",
    "identify",
    "analyze",
    "evaluate",
    "treat",
    "monitor_review",
    "communicate_consult",
    "record_report",
  ];
  const draftAuthorities = cockpit.authority_profiles.filter(
    (item) => item.status === "draft",
  );
  const [form, setForm] = useState<Record<string, string>>({
    scope_kind: "enterprise",
    parent_id: "",
    asset_id: "",
    name: "",
    mission_or_service: "",
    objectives: "",
    stakeholders: "",
    regulations: "",
    financial_constraints: "",
    safety_requirements: "",
    environmental_obligations: "",
    operating_limits: "",
    policies: "",
    dependencies: "",
    risk_owner_role: "",
    decision_owner_role: "",
    acceptance_role: "",
    trigger_type: "scheduled",
    trigger_detail: "",
    material: "false",
    context_id: cockpit.contexts[0]?.id ?? "",
    owner_id: participants[0]?.id ?? "",
    due_date: "",
    findings: "",
    actions: "",
    maturity_level: "0",
    evidence_summary: "",
    gaps: "",
    roadmap: "",
    next_review: "",
    risk_id: cockpit.risks[0]?.id ?? "",
    audience: "manager",
    authority_limit_id: draftAuthorities[0]?.id ?? "",
    risk_kinds: "threat, opportunity, both",
    required_competency_keys: "",
    max_exposure: "100",
    authority_basis: "",
    ...Object.fromEntries(
      [...principleKeys, ...frameworkKeys, ...processKeys].map((key) => [
        `score_${key}`,
        "0",
      ]),
    ),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [audienceResult, setAudienceResult] = useState<Record<
    string,
    unknown
  > | null>(null);
  const set = (key: string) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));
  const scoreMap = (keys: string[]) =>
    Object.fromEntries(keys.map((key) => [key, Number(form[`score_${key}`])]));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (kind === "context") {
        const asset = assets.find((item) => item.id === form.asset_id);
        await upsertRiskContext({
          scope_kind: form.scope_kind,
          parent_id: form.parent_id || null,
          site_id: asset?.site_id ?? null,
          asset_id: form.asset_id || null,
          name: form.name,
          mission_or_service: form.mission_or_service,
          objectives: splitList(form.objectives),
          stakeholders: splitList(form.stakeholders),
          regulations: splitList(form.regulations),
          financial_constraints: splitList(form.financial_constraints),
          safety_requirements: splitList(form.safety_requirements),
          environmental_obligations: splitList(form.environmental_obligations),
          operating_limits: splitList(form.operating_limits),
          policies: splitList(form.policies),
          dependencies: splitList(form.dependencies),
          decision_authority: {
            risk_owner_role: form.risk_owner_role,
            decision_owner_role: form.decision_owner_role,
            acceptance_role: form.acceptance_role,
          },
        });
      }
      if (kind === "framework")
        await recordRiskFrameworkReview({
          context_id: form.context_id || null,
          trigger_type: form.trigger_type,
          trigger_detail: form.trigger_detail,
          material: form.material === "true",
          owner_id: form.owner_id || null,
          due_date: form.due_date || null,
          findings: splitList(form.findings),
          actions: splitList(form.actions),
        });
      if (kind === "maturity")
        await recordRiskMaturityAssessment({
          context_id: form.context_id || null,
          maturity_level: Number(form.maturity_level),
          principle_scores: scoreMap(principleKeys),
          framework_scores: scoreMap(frameworkKeys),
          process_scores: scoreMap(processKeys),
          evidence_summary: form.evidence_summary,
          gaps: splitList(form.gaps),
          roadmap: splitList(form.roadmap),
          next_review: form.next_review || null,
        });
      if (kind === "authority")
        await configureRiskAuthorityRequirements(form.authority_limit_id, {
          risk_kinds: splitList(form.risk_kinds),
          required_competency_keys: splitList(form.required_competency_keys),
          max_exposure: Number(form.max_exposure),
          basis: form.authority_basis,
        });
      if (kind === "audience") {
        const result = await getRiskAudienceView(form.risk_id, form.audience);
        setAudienceResult(result);
        return;
      }
      onDone();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Governance action failed",
      );
    } finally {
      setBusy(false);
    }
  }

  const title = {
    context: "Create governed context",
    framework: "Record framework adaptation trigger",
    maturity: "Record evidence-based maturity",
    audience: "Generate audience-specific risk view",
    authority: "Configure draft risk authority",
  }[kind];
  return (
    <Modal
      title={title}
      subtitle="The record remains tenant-scoped, evidence-traced and subject to its explicit adoption or approval gate."
      onClose={onClose}
    >
      <form onSubmit={submit} className="space-y-4">
        {kind === "context" && (
          <div className="grid gap-3 md:grid-cols-2">
            <SelectField
              label="Context level"
              value={form.scope_kind}
              onChange={set("scope_kind")}
              options={[
                "enterprise",
                "business_unit",
                "site",
                "mission",
                "system",
                "asset",
                "decision",
                "activity",
              ].map((value) => ({ value, label: value.replaceAll("_", " ") }))}
            />
            <SelectField
              label="Parent context"
              value={form.parent_id}
              onChange={set("parent_id")}
              options={[
                { value: "", label: "No parent / enterprise root" },
                ...cockpit.contexts.map((item) => ({
                  value: item.id,
                  label: `${item.kind}: ${item.name}`,
                })),
              ]}
            />
            <SelectField
              label="Linked asset (optional)"
              value={form.asset_id}
              onChange={set("asset_id")}
              options={[
                { value: "", label: "No linked asset" },
                ...assets.map((item) => ({
                  value: item.id,
                  label: `${item.tag ?? "—"} · ${item.name}`,
                })),
              ]}
            />
            <Field
              label="Context name"
              value={form.name}
              onChange={set("name")}
              required
            />
            <TextArea
              label="Mission or service"
              value={form.mission_or_service}
              onChange={set("mission_or_service")}
            />
            <TextArea
              label="Objectives"
              value={form.objectives}
              onChange={set("objectives")}
              required
            />
            <TextArea
              label="Stakeholders"
              value={form.stakeholders}
              onChange={set("stakeholders")}
              required
            />
            <TextArea
              label="Regulatory / contractual obligations"
              value={form.regulations}
              onChange={set("regulations")}
            />
            <TextArea
              label="Financial constraints"
              value={form.financial_constraints}
              onChange={set("financial_constraints")}
            />
            <TextArea
              label="Safety requirements"
              value={form.safety_requirements}
              onChange={set("safety_requirements")}
            />
            <TextArea
              label="Environmental obligations"
              value={form.environmental_obligations}
              onChange={set("environmental_obligations")}
            />
            <TextArea
              label="Operating limits"
              value={form.operating_limits}
              onChange={set("operating_limits")}
            />
            <TextArea
              label="Policies"
              value={form.policies}
              onChange={set("policies")}
            />
            <TextArea
              label="Dependencies"
              value={form.dependencies}
              onChange={set("dependencies")}
            />
            <Field
              label="Risk-owner role"
              value={form.risk_owner_role}
              onChange={set("risk_owner_role")}
              required
            />
            <Field
              label="Decision-owner role"
              value={form.decision_owner_role}
              onChange={set("decision_owner_role")}
              required
            />
            <Field
              label="Residual-risk acceptance role"
              value={form.acceptance_role}
              onChange={set("acceptance_role")}
              required
            />
          </div>
        )}
        {kind === "framework" && (
          <div className="grid gap-3 md:grid-cols-2">
            <SelectField
              label="Adaptation trigger"
              value={form.trigger_type}
              onChange={set("trigger_type")}
              options={[
                "scheduled",
                "regulation_change",
                "organizational_restructure",
                "acquisition",
                "new_technology",
                "new_asset_type",
                "weather_change",
                "supply_chain_deterioration",
                "workforce_loss",
                "major_incident",
                "new_operating_regime",
              ].map((value) => ({ value, label: value.replaceAll("_", " ") }))}
            />
            <SelectField
              label="Affected context"
              value={form.context_id}
              onChange={set("context_id")}
              options={cockpit.contexts.map((item) => ({
                value: item.id,
                label: item.name,
              }))}
            />
            <TextArea
              label="What changed?"
              value={form.trigger_detail}
              onChange={set("trigger_detail")}
              required
            />
            <SelectField
              label="Material change?"
              value={form.material}
              onChange={set("material")}
              options={[
                { value: "true", label: "Yes — force criteria review" },
                { value: "false", label: "No — record and monitor" },
              ]}
            />
            <SelectField
              label="Accountable owner"
              value={form.owner_id}
              onChange={set("owner_id")}
              options={participants.map((item) => ({
                value: item.id,
                label: `${item.full_name ?? item.id} · ${item.role ?? "no role"}`,
              }))}
            />
            <Field
              label="Due date"
              type="date"
              value={form.due_date}
              onChange={set("due_date")}
            />
            <TextArea
              label="Initial findings"
              value={form.findings}
              onChange={set("findings")}
            />
            <TextArea
              label="Required actions"
              value={form.actions}
              onChange={set("actions")}
            />
          </div>
        )}
        {kind === "maturity" && (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <SelectField
                label="Assessment context"
                value={form.context_id}
                onChange={set("context_id")}
                options={cockpit.contexts.map((item) => ({
                  value: item.id,
                  label: item.name,
                }))}
              />
              <Field
                label="Overall maturity (0–5)"
                type="number"
                min={0}
                max={5}
                value={form.maturity_level}
                onChange={set("maturity_level")}
              />
              <TextArea
                label="Evidence summary"
                value={form.evidence_summary}
                onChange={set("evidence_summary")}
                required
              />
              <TextArea
                label="Evidence-backed gaps"
                value={form.gaps}
                onChange={set("gaps")}
              />
              <TextArea
                label="Improvement roadmap"
                value={form.roadmap}
                onChange={set("roadmap")}
              />
              <Field
                label="Next review"
                type="date"
                value={form.next_review}
                onChange={set("next_review")}
              />
            </div>
            {[
              { label: "Eight principles", keys: principleKeys },
              { label: "Framework", keys: frameworkKeys },
              { label: "Process", keys: processKeys },
            ].map((group) => (
              <section key={group.label}>
                <h3 className="text-xs font-semibold text-slate-300">
                  {group.label} scores (0–5)
                </h3>
                <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4">
                  {group.keys.map((key) => (
                    <Field
                      key={key}
                      label={key.replaceAll("_", " ")}
                      type="number"
                      min={0}
                      max={5}
                      value={form[`score_${key}`]}
                      onChange={set(`score_${key}`)}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
        {kind === "authority" && (
          <div className="grid gap-3 md:grid-cols-2">
            <SelectField
              label="Draft authority profile"
              value={form.authority_limit_id}
              onChange={set("authority_limit_id")}
              options={draftAuthorities.map((item) => ({
                value: item.id,
                label: `${item.role} · ${item.tier} · v${item.version}`,
              }))}
              required
            />
            <TextArea
              label="Permitted risk kinds"
              value={form.risk_kinds}
              onChange={set("risk_kinds")}
              required
            />
            <TextArea
              label="Required competency keys"
              value={form.required_competency_keys}
              onChange={set("required_competency_keys")}
            />
            <Field
              label="Maximum exposure"
              type="number"
              min={0}
              value={form.max_exposure}
              onChange={set("max_exposure")}
            />
            <TextArea
              label="Approved delegation basis"
              value={form.authority_basis}
              onChange={set("authority_basis")}
              required
            />
          </div>
        )}
        {kind === "audience" && (
          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <SelectField
                label="Risk"
                value={form.risk_id}
                onChange={set("risk_id")}
                options={cockpit.risks.map((item) => ({
                  value: item.id,
                  label: item.title,
                }))}
              />
              <SelectField
                label="Audience"
                value={form.audience}
                onChange={set("audience")}
                options={[
                  "technician",
                  "supervisor",
                  "manager",
                  "executive",
                  "board",
                  "oversight",
                ].map((value) => ({ value, label: value }))}
              />
            </div>
            {audienceResult && (
              <pre className="max-h-80 overflow-auto rounded-xl border border-white/7 bg-black/20 p-3 text-xs leading-relaxed text-slate-300">
                {JSON.stringify(audienceResult, null, 2)}
              </pre>
            )}
          </div>
        )}
        <SubmitBar
          busy={busy}
          error={error}
          label={
            kind === "audience"
              ? "Generate governed view"
              : "Save governed record"
          }
        />
      </form>
    </Modal>
  );
}

function CriteriaModal({
  criteria,
  onClose,
  onDone,
}: {
  criteria: RiskCriteriaProfile;
  onClose: () => void;
  onDone: () => void;
}) {
  const [form, setForm] = useState({
    dimensions:
      "safety, environment, production, financial, regulatory, asset_integrity, reputation, customer, cybersecurity",
    likelihood_labels: "Rare, Unlikely, Possible, Likely, Almost certain",
    low: "20",
    medium: "40",
    high: "60",
    critical: "80",
    accept: "20",
    monitor: "40",
    investigate: "55",
    treat: "70",
    escalate: "85",
    inherent: "0.55",
    exposure: "0.10",
    uncertainty: "0.10",
    connectivity: "0.10",
    velocity: "0.05",
    capacity: "0.10",
    time_weight: "0.10",
    capacity_limit: "100",
    committed_capacity: "0",
    tolerances: "",
    basis: criteria.basis,
    jurisdiction: criteria.jurisdiction ?? "",
    review_date: criteria.review_date ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof typeof form) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const labels = splitList(form.likelihood_labels);
      await configureRiskCriteria(criteria.id, {
        consequence_dimensions: splitList(form.dimensions).map((key) => ({
          key,
          label: key.replaceAll("_", " "),
          scale: [1, 2, 3, 4, 5],
        })),
        likelihood_scale: labels.map((label, index) => ({
          score: index + 1,
          label,
        })),
        thresholds: {
          low: Number(form.low),
          medium: Number(form.medium),
          high: Number(form.high),
          critical: Number(form.critical),
        },
        decision_thresholds: {
          accept: Number(form.accept),
          monitor: Number(form.monitor),
          investigate: Number(form.investigate),
          treat: Number(form.treat),
          escalate: Number(form.escalate),
        },
        scoring_weights: {
          inherent: Number(form.inherent),
          exposure: Number(form.exposure),
          uncertainty: Number(form.uncertainty),
          connectivity: Number(form.connectivity),
          velocity: Number(form.velocity),
          capacity: Number(form.capacity),
        },
        risk_capacity: {
          capacity_limit: Number(form.capacity_limit),
          current_committed_capacity: Number(form.committed_capacity),
        },
        aggregate_rules: {
          concurrency: true,
          common_dependencies: true,
          cascades: true,
        },
        time_factors: { weight: Number(form.time_weight) },
        tolerance_statements: splitList(form.tolerances),
        basis: form.basis,
        jurisdiction: form.jurisdiction,
        review_date: form.review_date,
      });
      onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Configuration failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={`Configure draft criteria · ${criteria.name}`}
      subtitle="Example values are editable draft inputs, not adopted policy or engineering limits."
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/6 p-3 text-xs text-amber-100/80">
          Replace every example with organization-approved scales, tolerances,
          capacity and authority. Saving does not adopt the profile.
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <TextArea
            label="Consequence dimensions"
            value={form.dimensions}
            onChange={set("dimensions")}
            required
          />
          <TextArea
            label="Likelihood labels (ordered low → high)"
            value={form.likelihood_labels}
            onChange={set("likelihood_labels")}
            required
          />
          {["low", "medium", "high", "critical"].map((key) => (
            <Field
              key={key}
              label={`${key} risk threshold`}
              type="number"
              min={0}
              max={100}
              value={form[key as keyof typeof form]}
              onChange={set(key as keyof typeof form)}
            />
          ))}
          {["accept", "monitor", "investigate", "treat", "escalate"].map(
            (key) => (
              <Field
                key={key}
                label={`${key} decision threshold`}
                type="number"
                min={0}
                max={100}
                value={form[key as keyof typeof form]}
                onChange={set(key as keyof typeof form)}
              />
            ),
          )}
          {[
            "inherent",
            "exposure",
            "uncertainty",
            "connectivity",
            "velocity",
            "capacity",
            "time_weight",
          ].map((key) => (
            <Field
              key={key}
              label={`${key.replaceAll("_", " ")} weight`}
              type="number"
              min={0}
              max={1}
              value={form[key as keyof typeof form]}
              onChange={set(key as keyof typeof form)}
            />
          ))}
          <Field
            label="Risk capacity limit"
            type="number"
            min={0}
            value={form.capacity_limit}
            onChange={set("capacity_limit")}
          />
          <Field
            label="Currently committed capacity"
            type="number"
            min={0}
            value={form.committed_capacity}
            onChange={set("committed_capacity")}
          />
          <TextArea
            label="Tolerance statements"
            value={form.tolerances}
            onChange={set("tolerances")}
            required
          />
          <TextArea
            label="Authority and evidence basis"
            value={form.basis}
            onChange={set("basis")}
            required
          />
          <Field
            label="Jurisdiction"
            value={form.jurisdiction}
            onChange={set("jurisdiction")}
          />
          <Field
            label="Review date"
            type="date"
            value={form.review_date}
            onChange={set("review_date")}
          />
        </div>
        <SubmitBar busy={busy} error={error} label="Save configuration draft" />
      </form>
    </Modal>
  );
}

export function RiskOperatingSystemPage() {
  const [tab, setTab] = useState<Tab>("cockpit");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [assessmentOpen, setAssessmentOpen] = useState(false);
  const [governanceAction, setGovernanceAction] =
    useState<GovernanceAction | null>(null);
  const [action, setAction] = useState<{
    kind: ActionKind;
    targetId?: string;
  } | null>(null);
  const [criteriaConfig, setCriteriaConfig] =
    useState<RiskCriteriaProfile | null>(null);
  const [filter, setFilter] = useState("all");
  const { data, loading, error, refetch } = useAsyncData<PageData>(async () => {
    const [cockpit, participants, assets] = await Promise.all([
      getRiskOperatingCockpit(),
      getRiskParticipants(),
      getAssets(),
    ]);
    return { cockpit, participants, assets };
  }, []);
  const selected =
    data?.cockpit.risks.find(
      (risk) => risk.id === (selectedId ?? data.cockpit.risks[0]?.id),
    ) ?? null;
  const risks = useMemo(
    () =>
      data?.cockpit.risks.filter(
        (risk) =>
          filter === "all" ||
          risk.kind === filter ||
          risk.current_risk_level === filter ||
          risk.status === filter,
      ) ?? [],
    [data, filter],
  );
  if (loading)
    return <LoadingState label="Loading the risk operating system…" />;
  if (error || !data)
    return (
      <div className="space-y-5 p-6">
        <div className="rounded-2xl border border-amber-500/25 bg-amber-500/7 p-4">
          <h1 className="text-xl font-bold text-white">
            Risk Operating System
          </h1>
          <p className="mt-1 text-sm text-amber-100/75">
            The ISO 31000 extension is not available in the connected database
            yet. Existing asset-risk functionality remains available below.
          </p>
        </div>
        <ErrorState
          message={error ?? "Risk cockpit unavailable"}
          onRetry={refetch}
        />
        <AssetRiskSignals />
      </div>
    );
  const { cockpit, participants, assets } = data;
  const open = cockpit.risks.filter(
    (risk) => !["closed", "archived"].includes(risk.status),
  );
  const critical = open.filter(
    (risk) => risk.current_risk_level === "Critical",
  ).length;
  const accelerating = open.filter((risk) => (risk.velocity ?? 0) > 0).length;
  const weakControls = open
    .flatMap((risk) => risk.controls)
    .filter((control) =>
      ["weak", "ineffective"].includes(control.effectiveness),
    ).length;
  async function controlled(actionFn: () => Promise<unknown>) {
    try {
      await actionFn();
      refetch();
    } catch (cause) {
      window.alert(cause instanceof Error ? cause.message : "Action failed");
    }
  }
  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="rounded-xl bg-linear-to-br from-teal-500 to-cyan-400 p-2 text-[#04100f]">
              <Network className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-black tracking-tight text-white">
                Risk Operating System
              </h1>
              <p className="text-sm text-slate-400">
                Continuous risk-informed decisions from enterprise objective to
                verified work outcome
              </p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Pill tone="border-teal-500/25 bg-teal-500/8 text-teal-300">
              ISO 31000 aligned operating grammar
            </Pill>
            <Pill>Principles → Framework → Process</Pill>
            <span className="text-[10px] text-slate-600">
              Not a certification claim
            </span>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setGovernanceAction("audience")}
            disabled={cockpit.risks.length === 0}
            className="rounded-lg border border-white/10 bg-white/4 px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-white/7 disabled:opacity-40"
          >
            <Users className="mr-1.5 inline h-3.5 w-3.5" />
            Audience view
          </button>
          <button
            type="button"
            onClick={() => setSetupOpen(true)}
            className="rounded-lg border border-white/10 bg-white/4 px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-white/7"
          >
            <Sparkles className="mr-1.5 inline h-3.5 w-3.5" />
            Implementation copilot
          </button>
          <button
            type="button"
            onClick={() => setAssessmentOpen(true)}
            disabled={
              cockpit.contexts.length === 0 ||
              cockpit.criteria.length === 0 ||
              participants.length === 0
            }
            className="rounded-lg bg-teal-500 px-3 py-2 text-xs font-bold text-[#04100f] hover:bg-teal-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Plus className="mr-1.5 inline h-3.5 w-3.5" />
            New assessment
          </button>
        </div>
      </header>
      <RiskFlow />
      <nav
        aria-label="Risk operating views"
        className="flex gap-1 overflow-x-auto rounded-xl border border-white/7 bg-[#0D1520] p-1"
      >
        {(
          [
            { id: "cockpit", label: "Leadership cockpit", icon: CircleGauge },
            { id: "portfolio", label: "Risk portfolio", icon: Layers3 },
            {
              id: "decision-ops",
              label: "Decision operations",
              icon: ClipboardCheck,
            },
            {
              id: "controls",
              label: "Controls & assurance",
              icon: ShieldCheck,
            },
            { id: "context", label: "Context & criteria", icon: GitBranch },
            {
              id: "enterprise",
              label: "Enterprise architecture",
              icon: Network,
            },
            {
              id: "maturity",
              label: "Maturity & oversight",
              icon: BookOpenCheck,
            },
            { id: "asset-signals", label: "Asset risk signals", icon: Factory },
          ] as { id: Tab; label: string; icon: React.ElementType }[]
        ).map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold ${tab === item.id ? "bg-teal-500/15 text-teal-300" : "text-slate-400 hover:bg-white/4 hover:text-slate-200"}`}
          >
            <item.icon className="h-3.5 w-3.5" />
            {item.label}
          </button>
        ))}
      </nav>
      {tab === "cockpit" && (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <MetricCard
              label="Live risks"
              value={open.length}
              detail="Threats and opportunities under active management"
              icon={Layers3}
            />
            <MetricCard
              label="Critical"
              value={critical}
              detail="At or above adopted critical criteria"
              icon={ShieldAlert}
              alert={critical > 0}
            />
            <MetricCard
              label="Accelerating"
              value={accelerating}
              detail="Positive risk velocity recorded"
              icon={Activity}
              alert={accelerating > 0}
            />
            <MetricCard
              label="Weak controls"
              value={weakControls}
              detail="Weak or ineffective operating effect"
              icon={TriangleAlert}
              alert={weakControls > 0}
            />
            <MetricCard
              label="Effectiveness"
              value={
                cockpit.effectiveness.effectiveness_index == null
                  ? "Insufficient evidence"
                  : `${cockpit.effectiveness.effectiveness_index}%`
              }
              detail={cockpit.effectiveness.basis}
              icon={Gauge}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <MetricCard
              label="Risk-to-action cycle"
              value={
                cockpit.effectiveness.average_risk_to_action_cycle_hours == null
                  ? "No started treatment"
                  : `${score(cockpit.effectiveness.average_risk_to_action_cycle_hours)} h`
              }
              detail="Average time from risk identification to treatment work starting"
              icon={TimerReset}
            />
            <MetricCard
              label="Treatment effectiveness"
              value={
                cockpit.effectiveness.treatment_effectiveness_rate == null
                  ? "No verified treatments"
                  : `${score(cockpit.effectiveness.treatment_effectiveness_rate)}%`
              }
              detail="Verified-effective treatments divided by completed verifications"
              icon={BadgeCheck}
            />
            <MetricCard
              label="Decision cycle"
              value={
                cockpit.effectiveness.average_decision_cycle_hours == null
                  ? "No risk decisions"
                  : `${score(cockpit.effectiveness.average_decision_cycle_hours)} h`
              }
              detail="Average time from risk identification to accountable decision record"
              icon={Clock3}
            />
          </div>
          <div className="grid gap-5 xl:grid-cols-[1.25fr_.75fr]">
            <section className="rounded-2xl border border-white/7 bg-[#0D1520] p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
                    <Network className="h-4 w-4 text-teal-300" />
                    Aggregate exposure
                  </h2>
                  <p className="mt-1 text-xs text-slate-500">
                    Common dependencies, concurrent exposure and organizational
                    capacity
                  </p>
                </div>
                <Pill
                  tone={
                    cockpit.aggregate.within_capacity
                      ? "border-emerald-500/25 bg-emerald-500/8 text-emerald-300"
                      : "border-red-500/25 bg-red-500/8 text-red-300"
                  }
                >
                  {cockpit.aggregate.within_capacity
                    ? "Within capacity"
                    : "Capacity exceeded"}
                </Pill>
              </div>
              <div className="mt-5 grid grid-cols-3 gap-3 text-center">
                <div>
                  <p className="text-2xl font-black text-white">
                    {Math.round(cockpit.aggregate.individual_exposure)}
                  </p>
                  <p className="text-[10px] uppercase text-slate-500">
                    Individual
                  </p>
                </div>
                <div>
                  <p className="text-2xl font-black text-orange-300">
                    {Math.round(cockpit.aggregate.combined_exposure)}
                  </p>
                  <p className="text-[10px] uppercase text-slate-500">
                    Combined
                  </p>
                </div>
                <div>
                  <p
                    className={`text-2xl font-black ${cockpit.aggregate.capacity_remaining < 0 ? "text-red-300" : "text-emerald-300"}`}
                  >
                    {Math.round(cockpit.aggregate.capacity_remaining)}
                  </p>
                  <p className="text-[10px] uppercase text-slate-500">
                    Capacity left
                  </p>
                </div>
              </div>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/5">
                <div
                  className={`h-full rounded-full ${cockpit.aggregate.within_capacity ? "bg-teal-400" : "bg-red-400"}`}
                  style={{
                    width: `${Math.min(100, (100 * cockpit.aggregate.combined_exposure) / Math.max(cockpit.aggregate.capacity_limit, 1))}%`,
                  }}
                />
              </div>
              <p className="mt-3 text-xs leading-relaxed text-slate-400">
                {cockpit.aggregate.basis}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {cockpit.aggregate.common_dependencies.map((item) => (
                  <Pill key={item.dependency_key}>
                    {item.dependency_key} · {item.risks} risks
                  </Pill>
                ))}
              </div>
            </section>
            <section className="rounded-2xl border border-white/7 bg-[#0D1520] p-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
                <ClipboardCheck className="h-4 w-4 text-violet-300" />
                Leadership attention
              </h2>
              <div className="mt-4 space-y-3">
                {[
                  {
                    label: "Overdue treatments",
                    value: cockpit.effectiveness.overdue_treatments,
                  },
                  {
                    label: "Control failures",
                    value: cockpit.effectiveness.repeated_control_failures,
                  },
                  {
                    label: "Accepted risk exceeded",
                    value:
                      cockpit.effectiveness.accepted_risks_above_acceptance,
                  },
                  {
                    label: "Overdue reviews",
                    value: cockpit.effectiveness.overdue_risk_reviews,
                  },
                  {
                    label: "Emerging risks detected",
                    value: cockpit.effectiveness.emerging_risks_detected,
                  },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="flex items-center justify-between rounded-xl border border-white/6 bg-white/2 px-3 py-2"
                  >
                    <span className="text-xs text-slate-400">{item.label}</span>
                    <span
                      className={`font-mono text-sm font-bold ${item.value > 0 ? "text-amber-300" : "text-slate-300"}`}
                    >
                      {item.value}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          </div>
          <section className="rounded-2xl border border-white/7 bg-[#0D1520] p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-white">
                  Portfolio value and objective exposure
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  Values remain separated by currency; risk scores are not
                  presented as money.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Pill>
                  {score(cockpit.portfolio_breakdown.risk_reduction_achieved)}{" "}
                  risk reduction
                </Pill>
                <Pill>
                  {cockpit.portfolio_breakdown.accepted_risks} accepted
                </Pill>
                {cockpit.portfolio_breakdown.value_at_risk_by_currency.map(
                  (item) => (
                    <Pill key={item.currency}>
                      {money(item.value_at_risk, item.currency)} at risk
                    </Pill>
                  ),
                )}
              </div>
            </div>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div>
                <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                  By site
                </h3>
                <div className="mt-2 space-y-2">
                  {cockpit.portfolio_breakdown.by_site.map((item) => (
                    <div
                      key={item.site}
                      className="flex justify-between rounded-lg border border-white/6 bg-white/2 px-3 py-2 text-xs"
                    >
                      <span className="text-slate-300">{item.site}</span>
                      <span className="font-mono text-slate-500">
                        {item.risks} risks · {score(item.exposure)} exposure
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                  By objective
                </h3>
                <div className="mt-2 space-y-2">
                  {cockpit.portfolio_breakdown.by_objective.map(
                    (item, index) => (
                      <div
                        key={`${item.objective ?? "unassigned"}-${index}`}
                        className="flex justify-between rounded-lg border border-white/6 bg-white/2 px-3 py-2 text-xs"
                      >
                        <span className="text-slate-300">
                          {item.objective ?? "Objective unassigned"}
                        </span>
                        <span className="font-mono text-slate-500">
                          {item.risks} risks · {score(item.exposure)} exposure
                        </span>
                      </div>
                    ),
                  )}
                </div>
              </div>
            </div>
          </section>
          <section>
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-white">
                  Priority objective exposure
                </h2>
                <p className="text-xs text-slate-500">
                  Current score, residual position, velocity and decision
                  requirement
                </p>
              </div>
              <button
                type="button"
                onClick={() => setTab("portfolio")}
                className="text-xs font-semibold text-teal-300"
              >
                Open portfolio →
              </button>
            </div>
            <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
              {open.slice(0, 6).map((risk) => (
                <RiskCard
                  key={risk.id}
                  risk={risk}
                  selected={false}
                  onSelect={() => {
                    setSelectedId(risk.id);
                    setTab("portfolio");
                  }}
                />
              ))}
              {open.length === 0 && (
                <div className="col-span-full rounded-2xl border border-dashed border-white/10 p-8 text-center">
                  <Target className="mx-auto h-6 w-6 text-slate-600" />
                  <p className="mt-2 text-sm text-slate-400">
                    No universal risk records yet.
                  </p>
                  <p className="mt-1 text-xs text-slate-600">
                    Run controlled implementation setup, then create the first
                    scoped assessment.
                  </p>
                </div>
              )}
            </div>
          </section>
        </div>
      )}
      {tab === "portfolio" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-500">Filter:</span>
            {[
              "all",
              "threat",
              "opportunity",
              "both",
              "Critical",
              "High",
              "Medium",
              "identified",
              "analyzed",
              "evaluated",
              "monitoring",
            ].map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setFilter(item)}
                className={`rounded-full border px-2.5 py-1 text-[11px] capitalize ${filter === item ? "border-teal-500/30 bg-teal-500/10 text-teal-300" : "border-white/7 bg-white/2 text-slate-500"}`}
              >
                {item}
              </button>
            ))}
          </div>
          <div className="grid gap-4 xl:grid-cols-[330px_1fr]">
            <aside className="space-y-2">
              {risks.map((risk) => (
                <RiskCard
                  key={risk.id}
                  risk={risk}
                  selected={selected?.id === risk.id}
                  onSelect={() => setSelectedId(risk.id)}
                />
              ))}
              {risks.length === 0 && (
                <p className="rounded-xl border border-white/7 p-4 text-xs text-slate-500">
                  No risks match this filter.
                </p>
              )}
            </aside>
            <main>
              {selected ? (
                <RiskDetail
                  risk={selected}
                  onAction={(kind, targetId) => setAction({ kind, targetId })}
                />
              ) : (
                <div className="rounded-2xl border border-dashed border-white/10 p-10 text-center text-sm text-slate-500">
                  Select a risk to inspect the full object.
                </div>
              )}
            </main>
          </div>
          <AssetInterdependency />
        </div>
      )}
      {tab === "decision-ops" && (
        <RiskDecisionOperationsPanel
          risks={cockpit.risks}
          participants={participants}
          contexts={cockpit.contexts}
          authorityProfiles={cockpit.authority_profiles}
          onChanged={refetch}
        />
      )}
      {tab === "controls" && (
        <div className="space-y-5">
          <div className="grid gap-3 md:grid-cols-3">
            {[
              {
                label: "Effective",
                value: cockpit.risks
                  .flatMap((risk) => risk.controls)
                  .filter((item) => item.effectiveness === "effective").length,
                tone: "text-emerald-300",
              },
              {
                label: "Weak / ineffective",
                value: weakControls,
                tone: "text-red-300",
              },
              {
                label: "Unknown",
                value: cockpit.risks
                  .flatMap((risk) => risk.controls)
                  .filter((item) => item.effectiveness === "unknown").length,
                tone: "text-slate-300",
              },
            ].map((item) => (
              <div
                key={item.label}
                className="rounded-2xl border border-white/7 bg-[#0D1520] p-4"
              >
                <p className={`text-2xl font-black ${item.tone}`}>
                  {item.value}
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  {item.label} controls
                </p>
              </div>
            ))}
          </div>
          <div className="rounded-2xl border border-white/7 bg-[#0D1520] p-4">
            <h2 className="text-sm font-semibold text-white">
              Control ownership and operating effect
            </h2>
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              {cockpit.risks
                .flatMap((risk) =>
                  risk.controls.map((control) => ({ risk, control })),
                )
                .map(({ risk, control }) => (
                  <div
                    key={`${risk.id}-${control.id}`}
                    className="rounded-xl border border-white/6 bg-white/2 p-3"
                  >
                    <div className="flex justify-between gap-3">
                      <div>
                        <p className="text-xs font-medium text-slate-200">
                          {control.name}
                        </p>
                        <p className="mt-1 text-[10px] text-slate-500">
                          {risk.title} · owner {control.owner ?? "unassigned"}
                        </p>
                      </div>
                      <Pill>{control.effectiveness}</Pill>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-[10px] text-slate-500">
                      <span>
                        {control.trend} · score {score(control.score)}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedId(risk.id);
                          setAction({ kind: "control", targetId: control.id });
                        }}
                        className="text-teal-300"
                      >
                        Record test
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          </div>
          <ProcessSafety />
        </div>
      )}
      {tab === "context" && (
        <div className="space-y-5">
          <div className="grid gap-5 xl:grid-cols-2">
            <section className="rounded-2xl border border-white/7 bg-[#0D1520] p-5">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
                    <GitBranch className="h-4 w-4 text-teal-300" />
                    Organizational context
                  </h2>
                  <p className="mt-1 text-xs text-slate-500">
                    Enterprise → business unit → site → mission → system → asset
                    → decision
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Pill>{cockpit.contexts.length}</Pill>
                  <button
                    type="button"
                    onClick={() => setGovernanceAction("context")}
                    className="text-[10px] font-semibold text-teal-300"
                  >
                    + Add context
                  </button>
                </div>
              </div>
              <div className="mt-4 space-y-2">
                {cockpit.contexts.map((context) => (
                  <div
                    key={context.id}
                    className="rounded-xl border border-white/6 bg-white/2 p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <Pill>{context.kind}</Pill>
                          <Pill
                            tone={
                              context.status === "adopted"
                                ? "border-emerald-500/25 bg-emerald-500/8 text-emerald-300"
                                : "border-amber-500/25 bg-amber-500/8 text-amber-300"
                            }
                          >
                            {context.status}
                          </Pill>
                        </div>
                        <p className="mt-2 text-sm font-semibold text-slate-200">
                          {context.name}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {context.objectives.length} objectives ·{" "}
                          {context.stakeholders.length} stakeholders ·{" "}
                          {context.regulations.length} obligations
                        </p>
                      </div>
                      {context.status === "draft" && (
                        <button
                          type="button"
                          onClick={() => {
                            const note = window.prompt(
                              "Record the authority and basis for adopting this context (20+ characters):",
                            );
                            if (note)
                              controlled(() =>
                                adoptRiskContext(context.id, note),
                              );
                          }}
                          className="text-[10px] font-semibold text-teal-300"
                        >
                          Adopt
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {cockpit.contexts.length === 0 && (
                  <p className="text-xs text-slate-500">
                    No context configured.
                  </p>
                )}
              </div>
            </section>
            <section className="rounded-2xl border border-white/7 bg-[#0D1520] p-5">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
                    <Scale className="h-4 w-4 text-violet-300" />
                    Executable criteria
                  </h2>
                  <p className="mt-1 text-xs text-slate-500">
                    Dimensions, likelihood, tolerance, time and capacity are
                    customer-owned policy.
                  </p>
                </div>
                <Pill>{cockpit.criteria.length}</Pill>
              </div>
              <div className="mt-4 space-y-2">
                {cockpit.criteria.map((criteria) => (
                  <div
                    key={criteria.id}
                    className="rounded-xl border border-white/6 bg-white/2 p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <Pill
                            tone={
                              criteria.status === "adopted"
                                ? "border-emerald-500/25 bg-emerald-500/8 text-emerald-300"
                                : "border-amber-500/25 bg-amber-500/8 text-amber-300"
                            }
                          >
                            {criteria.status}
                          </Pill>
                          <span className="font-mono text-[10px] text-slate-600">
                            v{criteria.version}
                          </span>
                        </div>
                        <p className="mt-2 text-sm font-semibold text-slate-200">
                          {criteria.name}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {criteria.industry_code ?? "custom"} ·{" "}
                          {criteria.jurisdiction ?? "jurisdiction not set"}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        {criteria.status === "draft" ? (
                          <>
                            <button
                              type="button"
                              onClick={() => setCriteriaConfig(criteria)}
                              className="text-[10px] font-semibold text-cyan-300"
                            >
                              Configure
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                const note = window.prompt(
                                  "Record the approved policy and authority basis (20+ characters):",
                                );
                                if (note)
                                  controlled(() =>
                                    adoptRiskCriteria(criteria.id, note),
                                  );
                              }}
                              className="text-[10px] font-semibold text-teal-300"
                            >
                              Adopt
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() =>
                              controlled(() =>
                                createRiskCriteriaVersion(criteria.id),
                              )
                            }
                            className="text-[10px] font-semibold text-cyan-300"
                          >
                            New version
                          </button>
                        )}
                      </div>
                    </div>
                    <p className="mt-2 line-clamp-2 text-[10px] leading-relaxed text-slate-500">
                      {criteria.basis}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          </div>
          <ConfigurationControl />
          <section className="rounded-2xl border border-white/7 bg-[#0D1520] p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-white">
                  Risk authority and competency
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  Risk kind, exposure, level and competency gates extend the
                  canonical authority model.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setGovernanceAction("authority")}
                disabled={
                  !cockpit.authority_profiles.some(
                    (item) => item.status === "draft",
                  )
                }
                className="text-xs font-semibold text-teal-300 disabled:text-slate-600"
              >
                Configure draft
              </button>
            </div>
            <div className="mt-4 grid gap-2 md:grid-cols-2">
              {cockpit.authority_profiles.map((profile) => (
                <div
                  key={profile.id}
                  className="rounded-xl border border-white/6 bg-white/2 p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-slate-200">
                      {profile.role} · {profile.tier}
                    </p>
                    <Pill>
                      {profile.status} v{profile.version}
                    </Pill>
                  </div>
                  <p className="mt-2 text-[11px] text-slate-500">
                    Up to {profile.max_risk_level ?? "configured level"} /
                    exposure {profile.max_exposure ?? "not set"} ·{" "}
                    {profile.risk_kinds.join(", ") || "risk kinds not set"}
                  </p>
                  <p className="mt-1 text-[10px] text-slate-600">
                    Competencies:{" "}
                    {profile.required_competencies.join(", ") ||
                      "none recorded"}
                  </p>
                </div>
              ))}
            </div>
          </section>
          <section className="rounded-2xl border border-white/7 bg-[#0D1520] p-5">
            <h2 className="text-sm font-semibold text-white">
              Twelve coordinated engines
            </h2>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {RISK_ENGINE_ARCHITECTURE.map((engine, index) => (
                <div
                  key={engine.key}
                  className="rounded-xl border border-white/6 bg-white/2 p-3"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] text-teal-400">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="text-xs font-semibold capitalize text-slate-200">
                      {engine.key.replaceAll("_", " ")}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                    {engine.purpose}
                  </p>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
      {tab === "enterprise" && (
        <EnterpriseRiskArchitecturePanel
          risks={cockpit.risks}
          participants={participants}
          contexts={cockpit.contexts}
          authorityProfiles={cockpit.authority_profiles}
          onChanged={refetch}
        />
      )}
      {tab === "maturity" && (
        <div className="space-y-5">
          <div className="grid gap-5 xl:grid-cols-[.7fr_1.3fr]">
            <section className="rounded-2xl border border-white/7 bg-[#0D1520] p-5">
              <div className="flex items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
                  <BrainCircuit className="h-4 w-4 text-violet-300" />
                  Implementation maturity
                </h2>
                <button
                  type="button"
                  onClick={() => setGovernanceAction("maturity")}
                  className="text-[10px] font-semibold text-teal-300"
                >
                  Record assessment
                </button>
              </div>
              {cockpit.maturity ? (
                <>
                  <div className="mt-5 flex items-end gap-3">
                    <span className="text-5xl font-black text-white">
                      {cockpit.maturity.level}
                    </span>
                    <span className="pb-1 text-sm text-slate-400">/ 5</span>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-slate-400">
                    {cockpit.maturity.evidence_summary}
                  </p>
                  <div className="mt-4 space-y-2">
                    {["principles", "framework", "process"].map((key) => {
                      const values = Object.values(
                        cockpit.maturity![
                          key as "principles" | "framework" | "process"
                        ],
                      );
                      const avg = values.length
                        ? values.reduce((sum, value) => sum + value, 0) /
                          values.length
                        : 0;
                      return <Driver key={key} label={key} value={avg * 20} />;
                    })}
                  </div>
                </>
              ) : (
                <div className="mt-6 rounded-xl border border-dashed border-white/10 p-5 text-center">
                  <p className="text-sm text-slate-400">
                    No evidence-based maturity assessment recorded.
                  </p>
                  <p className="mt-1 text-xs text-slate-600">
                    Level 0–5 is never inferred from feature presence.
                  </p>
                </div>
              )}
            </section>
            <section className="rounded-2xl border border-white/7 bg-[#0D1520] p-5">
              <h2 className="text-sm font-semibold text-white">
                Eight principles as software behavior
              </h2>
              <div className="mt-4 grid gap-2 md:grid-cols-2">
                {ISO_31000_PRINCIPLES.map((principle) => (
                  <div
                    key={principle.key}
                    className="rounded-xl border border-white/6 bg-white/2 p-3"
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold capitalize text-slate-200">
                        {principle.key.replaceAll("_", " ")}
                      </p>
                      <span className="font-mono text-[10px] text-teal-300">
                        {cockpit.maturity?.principles[principle.key] ?? "—"}/5
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                      {principle.capability}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          </div>
          <section className="rounded-2xl border border-white/7 bg-[#0D1520] p-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
                  <Workflow className="h-4 w-4 text-cyan-300" />
                  Framework adaptation triggers
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  Material context changes force review; an annual calendar is
                  not the only trigger.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Pill>
                  {
                    cockpit.framework_reviews.filter(
                      (item) => item.criteria_review_required,
                    ).length
                  }{" "}
                  criteria review(s)
                </Pill>
                <button
                  type="button"
                  onClick={() => setGovernanceAction("framework")}
                  className="text-[10px] font-semibold text-teal-300"
                >
                  + Record change
                </button>
              </div>
            </div>
            <div className="mt-4 grid gap-2 md:grid-cols-2">
              {cockpit.framework_reviews.map((review) => (
                <div
                  key={review.id}
                  className={`rounded-xl border p-3 ${review.material ? "border-amber-500/25 bg-amber-500/6" : "border-white/6 bg-white/2"}`}
                >
                  <div className="flex items-center justify-between">
                    <Pill>{review.trigger_type.replaceAll("_", " ")}</Pill>
                    <span className="text-[10px] text-slate-500">
                      {review.due_date ?? "no due date"}
                    </span>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-slate-400">
                    {review.detail}
                  </p>
                </div>
              ))}
              {cockpit.framework_reviews.length === 0 && (
                <p className="text-xs text-slate-500">
                  No material context changes recorded.
                </p>
              )}
            </div>
          </section>
          <section className="rounded-2xl border border-white/7 bg-[#0D1520] p-5">
            <h2 className="text-sm font-semibold text-white">
              Management vs oversight
            </h2>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-teal-500/20 bg-teal-500/5 p-4">
                <h3 className="text-xs font-semibold text-teal-300">
                  Management
                </h3>
                <p className="mt-2 text-xs text-slate-400">
                  Execute decisions, treatments, work, resources and
                  verification within adopted authority.
                </p>
              </div>
              <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-4">
                <h3 className="text-xs font-semibold text-violet-300">
                  Oversight
                </h3>
                <p className="mt-2 text-xs text-slate-400">
                  Inspect whether management identifies, evaluates, treats,
                  accepts and reports risk appropriately. No operational
                  execution authority.
                </p>
              </div>
            </div>
          </section>
        </div>
      )}
      {tab === "asset-signals" && <AssetRiskSignals />}
      {setupOpen && (
        <ImplementationModal
          onClose={() => setSetupOpen(false)}
          onDone={() => {
            setSetupOpen(false);
            refetch();
          }}
        />
      )}
      {assessmentOpen && (
        <AssessmentModal
          cockpit={cockpit}
          participants={participants}
          assets={assets}
          onClose={() => setAssessmentOpen(false)}
          onDone={() => {
            setAssessmentOpen(false);
            refetch();
          }}
        />
      )}
      {action && selected && (
        <ActionModal
          risk={selected}
          allRisks={cockpit.risks}
          participants={participants}
          kind={action.kind}
          targetId={action.targetId}
          onClose={() => setAction(null)}
          onDone={() => {
            setAction(null);
            refetch();
          }}
        />
      )}
      {criteriaConfig && (
        <CriteriaModal
          criteria={criteriaConfig}
          onClose={() => setCriteriaConfig(null)}
          onDone={() => {
            setCriteriaConfig(null);
            refetch();
          }}
        />
      )}
      {governanceAction && (
        <GovernanceModal
          kind={governanceAction}
          cockpit={cockpit}
          participants={participants}
          assets={assets}
          onClose={() => setGovernanceAction(null)}
          onDone={() => {
            setGovernanceAction(null);
            refetch();
          }}
        />
      )}
      <div className="flex items-start gap-3 rounded-xl border border-cyan-500/15 bg-cyan-500/5 p-4">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" />
        <p className="text-xs leading-relaxed text-slate-400">
          <span className="font-semibold text-cyan-200">
            Governance boundary:
          </span>{" "}
          SyncAI assembles evidence, calculates against adopted criteria,
          compares alternatives, monitors changing exposure and routes
          accountable decisions. It does not certify ISO 31000 implementation,
          invent engineering limits, accept residual risk, or approve
          safety-critical work autonomously.
        </p>
      </div>
    </div>
  );
}
