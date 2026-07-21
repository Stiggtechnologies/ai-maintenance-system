import { useState, useCallback } from "react";
import {
  TriangleAlert as AlertTriangle,
  Clock,
  TrendingUp,
  TrendingDown,
  Zap,
  DollarSign,
  Package,
  ChevronRight,
  Eye,
  ThumbsUp,
  ThumbsDown,
  Cpu,
  Radio,
  Swords,
  Layers,
  X,
  Loader2,
  FlaskConical,
  Pencil,
  ArrowUpCircle,
} from "lucide-react";
import { motion } from "framer-motion";
import { ChallengeAIModal } from "../components/ChallengeAIModal";
import {
  LoadingState,
  ErrorState,
  EmptyState,
} from "../components/ui/AsyncStates";
import { useAsyncData } from "../hooks/useAsyncData";
import { useRealtimeRefetch } from "../hooks/useRealtimeRefetch";
import { LiveBadge } from "../components/ui/LiveBadge";
import { useAuth } from "../components/AuthProvider";
import { useOnboardingOperatingLoop } from "../hooks/useOnboardingOperatingLoop";
import {
  getMissionControl,
  getEvidence,
  getScenarios,
  approveRecommendation,
  setRecommendationStatus,
  createWorkOrderFromRecommendation,
  submitChallengeFeedback,
  type RecommendationAction,
} from "../services/operatingLoopService";
import type {
  RecommendationRow,
  EvidenceItemRow,
  ScenarioRow,
} from "../types/operating";

const alertLevels: Record<
  string,
  { color: string; bg: string; border: string; dot: string }
> = {
  critical: {
    color: "text-red-400",
    bg: "bg-red-500/10",
    border: "border-red-500/30",
    dot: "bg-red-500",
  },
  action: {
    color: "text-amber-400",
    bg: "bg-amber-500/10",
    border: "border-amber-500/30",
    dot: "bg-amber-500",
  },
  advisory: {
    color: "text-blue-400",
    bg: "bg-blue-500/10",
    border: "border-blue-500/30",
    dot: "bg-blue-400",
  },
};

function ScoreRing({ score, size = 140 }: { score: number; size?: number }) {
  const r = (size - 16) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  const color = score >= 90 ? "#10b981" : score >= 75 ? "#f59e0b" : "#ef4444";
  return (
    <svg width={size} height={size} className="transform -rotate-90">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="#1e2d3d"
        strokeWidth={8}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={8}
        strokeDasharray={circ}
        strokeDashoffset={offset}
        strokeLinecap="round"
        style={{ filter: `drop-shadow(0 0 6px ${color})` }}
      />
    </svg>
  );
}

function FactorBar({
  label,
  score,
  trend,
}: {
  label: string;
  score: number;
  trend: string;
}) {
  const color = score >= 85 ? "teal" : score >= 70 ? "amber" : "red";
  const colorMap: Record<string, string> = {
    teal: "bg-teal-500",
    amber: "bg-amber-500",
    red: "bg-red-500",
  };
  return (
    <div className="flex items-center gap-3 py-1.5">
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-slate-400">{label}</span>
          <div className="flex items-center gap-1.5">
            {trend === "up" && <TrendingUp className="w-3 h-3 text-teal-400" />}
            {trend === "down" && (
              <TrendingDown className="w-3 h-3 text-amber-400" />
            )}
            <span className="text-xs font-bold text-slate-200">{score}%</span>
          </div>
        </div>
        <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${score}%` }}
            transition={{ duration: 0.7 }}
            className={`h-full rounded-full ${colorMap[color]}`}
          />
        </div>
      </div>
    </div>
  );
}

function money(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n}`;
}

/* ---- Evidence slide-over (real evidence_items) --------------------------- */
function EvidenceDrawer({
  rec,
  onClose,
}: {
  rec: RecommendationRow;
  onClose: () => void;
}) {
  const { data, loading, error, refetch } = useAsyncData<EvidenceItemRow[]>(
    () => getEvidence(rec.id),
    [rec.id],
  );
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-md h-full bg-[#0D1520] border-l border-white/8 overflow-y-auto p-5">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-semibold text-slate-200">Evidence</h3>
          <button
            aria-label="Close"
            onClick={onClose}
            className="text-slate-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-xs text-slate-400 mb-4">
          {rec.title} · {rec.asset?.name ?? "—"}
        </p>
        {loading && <LoadingState label="Loading evidence…" />}
        {error && <ErrorState message={error} onRetry={refetch} />}
        {!loading && !error && (data?.length ?? 0) === 0 && (
          <EmptyState message="No evidence recorded for this recommendation." />
        )}
        <div className="space-y-3">
          {(data ?? []).map((e) => (
            <div
              key={e.id}
              className="rounded-xl border border-white/6 bg-black/20 p-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-200">
                  {e.evidence_type}
                </span>
                <span className="text-xs font-mono text-teal-400">
                  +{e.confidence_contribution}% conf
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1">{e.description}</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2 text-xs text-slate-400">
                <div>
                  Source:{" "}
                  <span className="text-slate-400">{e.source_system}</span>
                </div>
                <div>
                  Data quality:{" "}
                  <span className="text-slate-400">{e.data_quality}</span>
                </div>
                <div>
                  Related asset:{" "}
                  <span className="text-slate-400">
                    {e.related_asset ?? rec.asset?.name}
                  </span>
                </div>
                <div>
                  Captured:{" "}
                  <span className="text-slate-400">
                    {new Date(e.ts).toLocaleString()}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---- Scenario comparison modal (real scenarios) -------------------------- */
function ScenarioModal({
  rec,
  onClose,
  onApprove,
}: {
  rec: RecommendationRow;
  onClose: () => void;
  onApprove: () => void;
}) {
  const { data, loading, error, refetch } = useAsyncData<ScenarioRow[]>(
    () => getScenarios(rec.id),
    [rec.id],
  );
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-4xl max-h-[85vh] overflow-y-auto bg-[#0D1520] border border-white/10 rounded-2xl p-5">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
            <FlaskConical className="w-4 h-4 text-teal-400" /> Scenario
            comparison
          </h3>
          <button
            aria-label="Close"
            onClick={onClose}
            className="text-slate-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-xs text-slate-400 mb-4">
          {rec.title} · {rec.asset?.name ?? "—"}
        </p>
        {loading && <LoadingState label="Modeling scenarios…" />}
        {error && <ErrorState message={error} onRetry={refetch} />}
        {!loading && !error && (data?.length ?? 0) === 0 && (
          <EmptyState message="No scenarios modeled for this recommendation." />
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {(data ?? []).map((s) => (
            <div
              key={s.id}
              className={`rounded-xl border p-4 ${s.recommended ? "border-teal-500/40 bg-teal-500/6" : "border-white/6 bg-black/20"}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-200">
                  {s.label}
                </span>
                {s.recommended && (
                  <span className="text-xs px-1.5 py-0.5 rounded-full bg-teal-500/20 text-teal-400">
                    Recommended
                  </span>
                )}
              </div>
              <div className="text-lg font-black text-white mt-1">
                {money(Number(s.cost))}
              </div>
              <div className="mt-2 space-y-1 text-xs text-slate-400">
                <div>
                  Downtime:{" "}
                  <span className="text-slate-300">{s.downtime_impact}</span>
                </div>
                <div>
                  Production:{" "}
                  <span className="text-slate-300">{s.production_impact}</span>
                </div>
                <div>
                  Safety risk:{" "}
                  <span className="text-slate-300">{s.safety_risk}</span>
                </div>
                <div>
                  Environmental:{" "}
                  <span className="text-slate-300">{s.environmental_risk}</span>
                </div>
                <div>
                  Exposure:{" "}
                  <span className="text-slate-300">{s.financial_exposure}</span>
                </div>
                <div>
                  Readiness:{" "}
                  <span className="text-slate-300">
                    {s.mission_readiness_impact}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-slate-400 hover:text-white"
          >
            Close
          </button>
          <button
            onClick={onApprove}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-500/20 border border-teal-500/30 text-teal-400 text-xs font-medium rounded-lg hover:bg-teal-500/30"
          >
            <ThumbsUp className="w-3 h-3" /> Approve recommended option
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---- Recommendation card with full action set ---------------------------- */
function RecommendationCard({
  rec,
  busy,
  onApprove,
  onAction,
  onEvidence,
  onScenarios,
  onChallenge,
  onCreateWO,
}: {
  rec: RecommendationRow;
  busy: boolean;
  onApprove: (r: RecommendationRow) => void;
  onAction: (
    r: RecommendationRow,
    a: Exclude<RecommendationAction, "approved">,
  ) => void;
  onEvidence: (r: RecommendationRow) => void;
  onScenarios: (r: RecommendationRow) => void;
  onChallenge: (r: RecommendationRow) => void;
  onCreateWO: (r: RecommendationRow) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const level = alertLevels[rec.urgency] ?? alertLevels.advisory;
  const autonomous = (rec.approval_required ?? "")
    .toLowerCase()
    .startsWith("autonomous");
  return (
    <motion.div
      layout
      className={`border ${level.border} ${level.bg} rounded-xl p-4`}
    >
      <div
        className="flex items-start gap-3 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div
          className={`mt-2 w-2 h-2 rounded-full ${level.dot} shrink-0 animate-pulse`}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h4 className={`text-sm font-semibold ${level.color}`}>
              {rec.title}
            </h4>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs text-slate-400 font-mono">
                {rec.confidence}% conf
              </span>
              <ChevronRight
                className={`w-3.5 h-3.5 text-slate-400 transition-transform ${expanded ? "rotate-90" : ""}`}
              />
            </div>
          </div>
          <div className="text-xs text-slate-400 mt-0.5">
            {rec.asset?.name ?? "—"} · {rec.issue}
          </div>
          <div className="flex items-center gap-3 mt-2">
            <span className="text-xs text-teal-400 font-medium">
              {rec.impact}
            </span>
            <span
              className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${autonomous ? "bg-teal-500/20 text-teal-400" : "bg-amber-500/20 text-amber-400"}`}
            >
              {rec.approval_required}
            </span>
          </div>
        </div>
      </div>
      {expanded && (
        <div className="mt-3 pt-3 border-t border-white/6 space-y-2">
          <div className="text-xs text-slate-300">
            <span className="text-slate-400">Recommended: </span>
            {rec.action}
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-slate-400">Accountable: </span>
              <span className="text-slate-300">{rec.accountable}</span>
            </div>
            <div>
              <span className="text-slate-400">Responsible: </span>
              <span className="text-slate-300">{rec.responsible}</span>
            </div>
            <div>
              <span className="text-slate-400">Consulted: </span>
              <span className="text-slate-300">{rec.consulted}</span>
            </div>
            <div>
              <span className="text-slate-400">Informed: </span>
              <span className="text-slate-300">{rec.informed}</span>
            </div>
          </div>
          <div className="flex gap-2 mt-3 flex-wrap">
            <button
              disabled={busy}
              onClick={() => onApprove(rec)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-500/20 border border-teal-500/30 text-teal-400 text-xs font-medium rounded-lg hover:bg-teal-500/30 disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <ThumbsUp className="w-3 h-3" />
              )}{" "}
              Approve
            </button>
            <button
              onClick={() => onEvidence(rec)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white/4 border border-white/8 text-slate-400 text-xs rounded-lg hover:bg-white/8"
            >
              <Eye className="w-3 h-3" /> Evidence
            </button>
            <button
              onClick={() => onScenarios(rec)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white/4 border border-white/8 text-slate-400 text-xs rounded-lg hover:bg-white/8"
            >
              <FlaskConical className="w-3 h-3" /> Compare Scenarios
            </button>
            <button
              onClick={() => onChallenge(rec)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white/4 border border-white/8 text-amber-400 text-xs rounded-lg hover:bg-amber-500/10"
            >
              <Swords className="w-3 h-3" /> Challenge
            </button>
            <button
              onClick={() => onCreateWO(rec)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white/4 border border-white/8 text-slate-400 text-xs rounded-lg hover:bg-white/8"
            >
              <Package className="w-3 h-3" /> Create Work Order
            </button>
            <button
              onClick={() => onAction(rec, "modified")}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white/4 border border-white/8 text-slate-400 text-xs rounded-lg hover:bg-white/8"
            >
              <Pencil className="w-3 h-3" /> Modify
            </button>
            <button
              onClick={() => onAction(rec, "escalated")}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white/4 border border-white/8 text-slate-400 text-xs rounded-lg hover:bg-white/8"
            >
              <ArrowUpCircle className="w-3 h-3" /> Escalate
            </button>
            <button
              onClick={() => onAction(rec, "dismissed")}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white/4 border border-white/8 text-slate-400 text-xs rounded-lg hover:bg-white/8"
            >
              <ThumbsDown className="w-3 h-3" /> Dismiss
            </button>
          </div>
        </div>
      )}
    </motion.div>
  );
}

const ROLE_LABEL: Record<string, string> = {
  executive: "Executive",
  maintenance_manager: "Maintenance Manager",
  reliability_engineer: "Reliability Engineer",
  planner: "Planner",
  technician: "Technician",
  ai_admin: "AI Admin",
};

export function MissionControl() {
  const { profile } = useAuth();
  const role = (profile?.role as string) ?? "reliability_engineer";
  const { missionSignals } = useOnboardingOperatingLoop();
  const { data, loading, error, refetch } = useAsyncData(
    () => getMissionControl(),
    [],
  );
  const { live } = useRealtimeRefetch(
    ["sensors", "recommendations", "work_orders", "value_metrics"],
    refetch,
  );

  const [evidenceRec, setEvidenceRec] = useState<RecommendationRow | null>(
    null,
  );
  const [scenarioRec, setScenarioRec] = useState<RecommendationRow | null>(
    null,
  );
  const [challengeRec, setChallengeRec] = useState<RecommendationRow | null>(
    null,
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 4000);
  }, []);

  const handleApprove = useCallback(
    async (rec: RecommendationRow) => {
      setBusyId(rec.id);
      try {
        const result = await approveRecommendation(rec);
        flash(
          `Approved ${rec.title} → work action ${result.workOrderId ? "created" : "queued"}, decision logged, value + learning updated.`,
        );
        setScenarioRec(null);
        refetch();
      } catch (e) {
        flash(e instanceof Error ? e.message : "Approval failed.");
      } finally {
        setBusyId(null);
      }
    },
    [flash, refetch],
  );

  const handleAction = useCallback(
    async (
      rec: RecommendationRow,
      action: Exclude<RecommendationAction, "approved">,
    ) => {
      setBusyId(rec.id);
      try {
        await setRecommendationStatus(rec, action);
        flash(`Recommendation ${action}: ${rec.title}`);
        refetch();
      } catch (e) {
        flash(e instanceof Error ? e.message : "Action failed.");
      } finally {
        setBusyId(null);
      }
    },
    [flash, refetch],
  );

  const handleCreateWO = useCallback(
    async (rec: RecommendationRow) => {
      try {
        await createWorkOrderFromRecommendation(rec);
        flash(`Work order created for ${rec.asset?.name ?? rec.title}.`);
        refetch();
      } catch (e) {
        flash(e instanceof Error ? e.message : "Could not create work order.");
      }
    },
    [flash, refetch],
  );

  const scoreColor = (s: number) =>
    s >= 90 ? "text-green-400" : s >= 75 ? "text-amber-400" : "text-red-400";

  return (
    <div className="p-6 space-y-6 min-h-full">
      {toast && (
        <div className="fixed top-4 right-4 z-60 max-w-sm bg-[#0D1520] border border-teal-500/30 rounded-xl px-4 py-3 text-xs text-teal-200 shadow-xl shadow-black/40">
          {toast}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
            <Radio className="w-3 h-3 text-teal-400" />
            <LiveBadge live={live} />
            <span>· Mission Control · {ROLE_LABEL[role] ?? role} view</span>
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            Mission Control
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Can we safely and reliably deliver the production plan?
          </p>
        </div>
      </div>

      {loading && <LoadingState label="Loading mission readiness…" />}
      {error && <ErrorState message={error} onRetry={refetch} />}

      {!loading && !error && data && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-1 bg-[#0D1520] border border-white/6 rounded-2xl p-6 flex flex-col items-center justify-center">
              <div className="text-xs text-slate-400 uppercase tracking-widest mb-4">
                Mission Readiness
              </div>
              <div className="relative">
                <ScoreRing score={data.readinessScore} />
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span
                    className={`text-4xl font-black ${scoreColor(data.readinessScore)}`}
                  >
                    {data.readinessScore}
                  </span>
                  <span className="text-xs text-slate-400 font-medium">
                    / 100
                  </span>
                </div>
              </div>
              <div
                className={`mt-4 px-3 py-1.5 rounded-full border text-xs font-bold ${data.readinessScore >= 90 ? "bg-green-500/20 text-green-400 border-green-500/30" : data.readinessScore >= 75 ? "bg-amber-500/20 text-amber-400 border-amber-500/30" : "bg-red-500/20 text-red-400 border-red-500/30"}`}
              >
                {data.readinessStatus}
              </div>
              <p className="mt-3 text-xs text-slate-400 text-center leading-relaxed max-w-[220px]">
                {data.readinessReason}
              </p>
            </div>

            <div className="lg:col-span-2 bg-[#0D1520] border border-white/6 rounded-2xl p-6">
              <h2 className="text-sm font-semibold text-slate-200 mb-4">
                Readiness Factors
              </h2>
              <div className="space-y-1">
                {data.factors.map((f) => (
                  <FactorBar
                    key={f.label}
                    label={f.label}
                    score={f.score}
                    trend={f.trend}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              {
                label: "AI Actions Executed",
                value: data.stats.actionsExecuted,
                icon: Cpu,
                sub: "by 15 agents",
              },
              {
                label: "Pending Approvals",
                value: data.stats.pendingApprovals,
                icon: Clock,
                sub: "require human",
              },
              {
                label: "Recommendations",
                value: data.stats.recommendationsToday,
                icon: Zap,
                sub: "active",
              },
              {
                label: "Value Created",
                value: money(data.valueCreated),
                icon: DollarSign,
                sub: "verified MTD",
              },
            ].map((s) => {
              const Icon = s.icon;
              return (
                <div
                  key={s.label}
                  className="bg-[#0D1520] border border-white/6 rounded-xl p-4"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <div className="p-1.5 rounded-lg text-teal-400 bg-teal-500/10">
                      <Icon className="w-3.5 h-3.5" />
                    </div>
                    <span className="text-xs text-slate-400">{s.label}</span>
                  </div>
                  <div className="text-2xl font-black text-teal-400">
                    {s.value}
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">{s.sub}</div>
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <div className="bg-[#0D1520] border border-white/6 rounded-2xl p-6">
              <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2 mb-4">
                <AlertTriangle className="w-4 h-4 text-amber-400" /> Top Mission
                Risks
              </h2>
              <div className="space-y-3">
                {data.topRisks.map((risk, i) => {
                  const level = alertLevels[risk.urgency];
                  return (
                    <div
                      key={risk.id}
                      className={`flex items-start gap-3 p-3 rounded-xl border ${level.border} ${level.bg}`}
                    >
                      <span
                        className={`text-xs font-black ${level.color} w-6 text-center`}
                      >
                        {i + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold text-slate-200">
                            {risk.asset}
                          </span>
                          <span className={`text-xs font-bold ${level.color}`}>
                            {risk.exposure}
                          </span>
                        </div>
                        <div className="text-xs text-slate-400 mt-0.5">
                          {risk.probability}% risk score · {risk.missionImpact}{" "}
                          impact
                        </div>
                        <div className="text-xs text-slate-400 mt-1">
                          {risk.recommendedAction}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {data.topRisks.length === 0 && (
                  <EmptyState message="No assets at risk." />
                )}
              </div>
            </div>

            <div className="bg-[#0D1520] border border-white/6 rounded-2xl p-6">
              <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2 mb-4">
                <Zap className="w-4 h-4 text-teal-400" /> Top AI Recommendations
              </h2>
              <div className="space-y-3">
                {data.topRecommendations.map((rec) => (
                  <RecommendationCard
                    key={rec.id}
                    rec={rec}
                    busy={busyId === rec.id}
                    onApprove={handleApprove}
                    onAction={handleAction}
                    onEvidence={setEvidenceRec}
                    onScenarios={setScenarioRec}
                    onChallenge={setChallengeRec}
                    onCreateWO={handleCreateWO}
                  />
                ))}
                {data.topRecommendations.length === 0 && (
                  <EmptyState message="No open recommendations — all caught up." />
                )}
              </div>
            </div>
          </div>

          {missionSignals.length > 0 && (
            <div className="bg-[#0D1520] border border-amber-500/20 rounded-2xl p-6">
              <div className="flex items-center gap-2 mb-4">
                <Layers className="w-4 h-4 text-amber-400" />
                <h2 className="text-sm font-semibold text-slate-200">
                  Onboarding Readiness Risks
                </h2>
                <span className="text-xs text-slate-400 ml-auto">
                  Newly onboarded assets not yet reliability-ready
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {missionSignals.map((signal) => {
                  const level = alertLevels[signal.urgency];
                  return (
                    <div
                      key={signal.sessionId}
                      className={`p-4 rounded-xl border ${level.border} ${level.bg}`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-slate-200">
                          {signal.assetId} · {signal.classLabel}
                        </span>
                        <span
                          className={`text-xs px-1.5 py-0.5 rounded-full border ${level.border} ${level.color} font-semibold capitalize`}
                        >
                          {signal.urgency}
                        </span>
                      </div>
                      <div className="text-xs text-slate-400 mt-1">
                        {signal.completionScore}% onboarded · {signal.readiness}{" "}
                        readiness
                      </div>
                      <ul className="mt-2 space-y-1">
                        {signal.reasons.map((reason) => (
                          <li
                            key={reason}
                            className="flex items-start gap-1.5 text-xs text-slate-400"
                          >
                            <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0 mt-0.5" />
                            {reason}
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="bg-[#0D1520] border border-white/6 rounded-2xl p-6">
            <div className="flex items-center gap-2 mb-4">
              <DollarSign className="w-4 h-4 text-teal-400" />
              <h2 className="text-sm font-semibold text-slate-200">
                Top Financial Exposures
              </h2>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {data.financialExposures.map((item) => (
                <div
                  key={item.asset}
                  className="p-4 rounded-xl bg-white/2 border border-white/5"
                >
                  <div className="text-xs text-slate-400 mb-1 truncate">
                    {item.asset}
                  </div>
                  <div className="text-xl font-black text-amber-400">
                    {item.exposure}
                  </div>
                  <div className="mt-2 h-1.5 bg-white/5 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-amber-500"
                      style={{ width: `${item.probability}%` }}
                    />
                  </div>
                  <div className="text-xs text-slate-400 mt-1">
                    {item.probability}% risk score
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {evidenceRec && (
        <EvidenceDrawer
          rec={evidenceRec}
          onClose={() => setEvidenceRec(null)}
        />
      )}
      {scenarioRec && (
        <ScenarioModal
          rec={scenarioRec}
          onClose={() => setScenarioRec(null)}
          onApprove={() => handleApprove(scenarioRec)}
        />
      )}
      <ChallengeAIModal
        open={!!challengeRec}
        onClose={() => setChallengeRec(null)}
        onSubmit={async (reason, notes) => {
          if (!challengeRec) return;
          await submitChallengeFeedback(
            { title: challengeRec.title, asset: challengeRec.asset?.name },
            reason,
            notes,
          );
          flash("Challenge logged to the Learning Loop as model feedback.");
        }}
        recommendation={
          challengeRec
            ? {
                title: challengeRec.title,
                confidence: challengeRec.confidence,
                asset: challengeRec.asset?.name ?? "",
                action: challengeRec.action ?? "",
              }
            : undefined
        }
      />
    </div>
  );
}
