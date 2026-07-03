import { useState } from "react";
import {
  TrendingUp,
  DollarSign,
  Clock,
  Shield,
  Zap,
  Target,
  Activity,
  Layers,
  CircleCheck as CheckCircle,
  Circle as XCircle,
  Loader2,
  Rocket,
} from "lucide-react";
import { motion } from "framer-motion";
import { useOnboardingOperatingLoop } from "../hooks/useOnboardingOperatingLoop";
import { useAsyncData } from "../hooks/useAsyncData";
import {
  getValueMetrics,
  verifyValueMetric,
  getPilotScorecard,
  type PilotScorecard,
} from "../services/operatingLoopService";
import type { ValueMetricRow } from "../types/operating";
import {
  LoadingState,
  ErrorState,
  EmptyState,
} from "../components/ui/AsyncStates";

const colorMap: Record<string, { text: string; bg: string }> = {
  teal: { text: "text-teal-400", bg: "bg-teal-500/10" },
  blue: { text: "text-blue-400", bg: "bg-blue-500/10" },
  amber: { text: "text-amber-400", bg: "bg-amber-500/10" },
  cyan: { text: "text-cyan-400", bg: "bg-cyan-500/10" },
  green: { text: "text-green-400", bg: "bg-green-500/10" },
};

const METRIC_META: Record<
  string,
  { label: string; icon: typeof Clock; color: string }
> = {
  downtime_avoided: { label: "Downtime Avoided", icon: Clock, color: "teal" },
  maintenance_cost_savings: {
    label: "Maintenance Cost Savings",
    icon: DollarSign,
    color: "blue",
  },
  avoided_production_loss: {
    label: "Avoided Production Loss",
    icon: Activity,
    color: "amber",
  },
  risk_exposure_reduced: {
    label: "Risk Exposure Reduced",
    icon: Shield,
    color: "cyan",
  },
  recommendations_accepted: {
    label: "Recommendations Accepted",
    icon: Target,
    color: "green",
  },
  autonomous_actions_executed: {
    label: "Autonomous Actions Executed",
    icon: Zap,
    color: "teal",
  },
  projected_annualized_value: {
    label: "Projected Annualized Value",
    icon: TrendingUp,
    color: "cyan",
  },
};

function fmt(value: number, unit: string | null): string {
  if (unit === "usd") {
    if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
    return `$${value}`;
  }
  if (unit === "hours") return `${value} hr`;
  if (unit === "percent") return `${value}%`;
  return `${value}`;
}

const monthlyTrend = [3.2, 3.8, 4.4, 5.1, 6.8];

function ValueTrendChart() {
  const max = Math.max(...monthlyTrend);
  const h = 80,
    w = 280;
  const step = w / (monthlyTrend.length - 1);
  const points = monthlyTrend
    .map((v, i) => `${i * step},${h - (v / max) * h}`)
    .join(" ");
  const area = `0,${h} ${points} ${(monthlyTrend.length - 1) * step},${h}`;
  return (
    <svg width={w} height={h} className="overflow-visible">
      <defs>
        <linearGradient id="value-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#14b8a6" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#14b8a6" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill="url(#value-grad)" />
      <polyline
        points={points}
        fill="none"
        stroke="#14b8a6"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ValueRealization() {
  const { valueBaselines } = useOnboardingOperatingLoop();
  const { data, loading, error, refetch } = useAsyncData<ValueMetricRow[]>(
    () => getValueMetrics(),
    [],
  );
  const scorecard = useAsyncData<PilotScorecard>(() => getPilotScorecard(), []);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const handleVerify = async (m: ValueMetricRow, isVerified: boolean) => {
    setBusyId(m.id);
    try {
      await verifyValueMetric(m.id, isVerified);
      setToast(
        isVerified
          ? `Verified ${fmt(Number(m.value), m.unit)} — ${m.label ?? m.metric_type}. Learning Loop updated.`
          : `Rejected ${m.label ?? m.metric_type} — logged as false positive for model feedback.`,
      );
      refetch();
      scorecard.refetch();
      window.setTimeout(() => setToast(null), 5000);
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Verification failed.");
    } finally {
      setBusyId(null);
    }
  };

  const metrics = data ?? [];
  const projected = metrics.filter((m) => m.status === "projected");
  const verified = metrics.filter((m) => m.status === "verified");
  const usdVerified = verified.filter((m) => m.unit === "usd");
  const totalSavings = usdVerified.reduce((s, m) => s + Number(m.value), 0);
  const byType = (t: string) => metrics.find((m) => m.metric_type === t);

  const hero = [
    { label: "Verified Savings", value: fmt(totalSavings, "usd") },
    {
      label: "Downtime Avoided",
      value: byType("downtime_avoided")
        ? fmt(Number(byType("downtime_avoided")!.value), "hours")
        : "—",
    },
    {
      label: "Risk Exposure Reduced",
      value: byType("risk_exposure_reduced")
        ? fmt(Number(byType("risk_exposure_reduced")!.value), "usd")
        : "—",
    },
    {
      label: "Recommendations Accepted",
      value: byType("recommendations_accepted")
        ? fmt(Number(byType("recommendations_accepted")!.value), "percent")
        : "—",
    },
    {
      label: "Annualized Value",
      value: byType("projected_annualized_value")
        ? fmt(Number(byType("projected_annualized_value")!.value), "usd")
        : "—",
    },
    {
      label: "Autonomous Actions",
      value: byType("autonomous_actions_executed")
        ? fmt(Number(byType("autonomous_actions_executed")!.value), "count")
        : "—",
    },
  ];

  const categories = usdVerified.map((m) => ({
    meta: METRIC_META[m.metric_type] ?? {
      label: m.label ?? m.metric_type,
      icon: DollarSign,
      color: "teal",
    },
    value: fmt(Number(m.value), m.unit),
    breakdown: m.label ?? m.metric_type,
    id: m.id,
  }));

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            Value Realization
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            What has SyncAI saved, improved, protected, and accelerated?
          </p>
        </div>
      </div>

      {toast && (
        <div className="fixed top-4 right-4 z-[60] max-w-sm bg-[#0D1520] border border-teal-500/30 rounded-xl px-4 py-3 text-xs text-teal-200 shadow-xl shadow-black/40">
          {toast}
        </div>
      )}

      {loading && <LoadingState label="Loading value metrics…" />}
      {error && <ErrorState message={error} onRetry={refetch} />}

      {!loading && !error && (
        <>
          {/* 90-day pilot scorecard — live, derived from real operating data */}
          {scorecard.data && (
            <div className="bg-[#0D1520] border border-teal-500/20 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <Rocket className="w-4 h-4 text-teal-400" />
                <h3 className="text-sm font-semibold text-slate-200">
                  90-Day Pilot Scorecard
                </h3>
                <span className="text-[10px] text-slate-600 ml-auto">
                  Live · derived from operating data · started{" "}
                  {scorecard.data.pilot_started_at.slice(0, 10)}
                </span>
              </div>
              <div className="mb-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] text-slate-600">
                    Day {scorecard.data.pilot_day} of{" "}
                    {scorecard.data.pilot_length_days}
                  </span>
                  <span className="text-[10px] font-bold text-teal-400">
                    {Math.round(
                      (scorecard.data.pilot_day /
                        scorecard.data.pilot_length_days) *
                        100,
                    )}
                    %
                  </span>
                </div>
                <div className="h-1.5 bg-white/[0.05] rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full bg-teal-500"
                    style={{
                      width: `${(scorecard.data.pilot_day / scorecard.data.pilot_length_days) * 100}%`,
                    }}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3 text-center">
                {[
                  {
                    label: "Recommendations",
                    value: scorecard.data.recommendations_total,
                  },
                  {
                    label: "From Agent Loop",
                    value: scorecard.data.recommendations_from_agent_loop,
                  },
                  {
                    label: "Acceptance Rate",
                    value: `${scorecard.data.acceptance_rate_pct}%`,
                  },
                  {
                    label: "Autonomous Actions",
                    value: scorecard.data.autonomous_actions_executed,
                  },
                  {
                    label: "Work Orders",
                    value: scorecard.data.work_orders_total,
                  },
                  {
                    label: "Approval-Gated",
                    value: scorecard.data.work_orders_approval_gated,
                  },
                  {
                    label: "Value Verified",
                    value: fmt(scorecard.data.value_verified_usd, "usd"),
                  },
                  {
                    label: "Value Projected",
                    value: fmt(scorecard.data.value_projected_usd, "usd"),
                  },
                ].map((s) => (
                  <div
                    key={s.label}
                    className="p-2.5 rounded-xl bg-white/[0.02] border border-white/[0.05]"
                  >
                    <div className="text-lg font-black text-teal-400">
                      {s.value}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5">
                      {s.label}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Pending verification — human sign-off closes the value loop */}
          {projected.length > 0 && (
            <div className="bg-[#0D1520] border border-amber-500/20 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <Clock className="w-4 h-4 text-amber-400" />
                <h3 className="text-sm font-semibold text-slate-200">
                  Pending Verification
                </h3>
                <span className="text-[10px] text-slate-600 ml-auto">
                  Projected value requires operator sign-off before it counts
                </span>
              </div>
              <div className="space-y-2">
                {projected.map((m) => (
                  <div
                    key={m.id}
                    className="flex items-center gap-4 p-3 rounded-xl bg-white/[0.02] border border-white/[0.04]"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-slate-200">
                        {m.label ?? m.metric_type}
                      </div>
                      <div className="text-[10px] text-slate-500 mt-0.5">
                        {m.period ?? "—"} · projected
                      </div>
                    </div>
                    <div className="text-base font-black text-amber-400">
                      {fmt(Number(m.value), m.unit)}
                    </div>
                    <div className="flex gap-2">
                      <button
                        disabled={busyId === m.id}
                        onClick={() => handleVerify(m, true)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-500/20 border border-teal-500/30 text-teal-400 text-xs font-medium rounded-lg hover:bg-teal-500/30 disabled:opacity-50"
                      >
                        {busyId === m.id ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <CheckCircle className="w-3 h-3" />
                        )}
                        Verify
                      </button>
                      <button
                        disabled={busyId === m.id}
                        onClick={() => handleVerify(m, false)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-medium rounded-lg hover:bg-red-500/20 disabled:opacity-50"
                      >
                        <XCircle className="w-3 h-3" /> Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            {hero.map((s) => (
              <div
                key={s.label}
                className="bg-[#0D1520] border border-white/[0.06] rounded-xl p-4"
              >
                <div className="text-[10px] text-slate-500 mb-1">{s.label}</div>
                <div className="text-xl font-black text-teal-400">
                  {s.value}
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="bg-[#0D1520] border border-white/[0.06] rounded-2xl p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-slate-200">
                  Cumulative Value (MTD)
                </h3>
                <span className="text-xl font-black text-teal-400">
                  {fmt(totalSavings, "usd")}
                </span>
              </div>
              <ValueTrendChart />
            </div>

            <div className="lg:col-span-2 space-y-3">
              {categories.length === 0 && (
                <EmptyState message="No verified value yet — approve recommendations to realize value." />
              )}
              {categories.map((cat, i) => {
                const Icon = cat.meta.icon;
                const c = colorMap[cat.meta.color] ?? colorMap.teal;
                return (
                  <motion.div
                    key={cat.id}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className="bg-[#0D1520] border border-white/[0.06] rounded-xl p-4 flex items-center gap-4"
                  >
                    <div className={`p-2.5 rounded-xl ${c.bg} flex-shrink-0`}>
                      <Icon className={`w-5 h-5 ${c.text}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-slate-200">
                        {cat.meta.label}
                      </div>
                      <div className="text-[10px] text-slate-500 mt-0.5">
                        {cat.breakdown}
                      </div>
                    </div>
                    <div className={`text-lg font-black ${c.text}`}>
                      {cat.value}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </div>

          {valueBaselines.length > 0 && (
            <div className="bg-[#0D1520] border border-cyan-500/20 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <Layers className="w-4 h-4 text-cyan-400" />
                <h3 className="text-sm font-semibold text-slate-200">
                  Onboarding Value Baselines
                </h3>
                <span className="text-[10px] text-amber-400 ml-auto font-medium">
                  Baseline · pending validation
                </span>
              </div>
              <div className="space-y-3">
                {valueBaselines.map((baseline) => (
                  <div
                    key={baseline.sessionId}
                    className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.05]"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-slate-200">
                        {baseline.assetId} · {baseline.classLabel}
                      </span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 font-semibold">
                        baseline_pending_validation
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 mt-3 text-xs">
                      <div>
                        <span className="text-slate-600">
                          Risk exposure baseline:{" "}
                        </span>
                        <span className="text-slate-300">
                          {baseline.riskExposureBaseline}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-600">
                          Downtime exposure:{" "}
                        </span>
                        <span className="text-slate-300">
                          {baseline.downtimeExposurePlaceholder}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-600">
                          Maintenance cost baseline:{" "}
                        </span>
                        <span className="text-slate-300">
                          {baseline.maintenanceCostLabel}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-600">
                          Projected annualized value:{" "}
                        </span>
                        <span className="text-slate-300">
                          {baseline.projectedAnnualizedValuePlaceholder}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="bg-[#0D1520] border border-white/[0.06] rounded-2xl p-5">
            <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2 mb-4">
              <Shield className="w-4 h-4 text-teal-400" /> Verified Savings Log
            </h3>
            {verified.length === 0 && (
              <EmptyState message="No verified savings recorded yet." />
            )}
            <div className="space-y-2">
              {verified.map((m, i) => (
                <motion.div
                  key={m.id}
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="flex items-center gap-4 p-3 rounded-xl bg-white/[0.02] border border-white/[0.04]"
                >
                  <div className="w-8 h-8 rounded-lg bg-teal-500/10 flex items-center justify-center flex-shrink-0">
                    <DollarSign className="w-4 h-4 text-teal-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-slate-200">
                      {m.label ?? m.metric_type}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5">
                      {m.period ?? "—"} · {m.status}
                    </div>
                  </div>
                  <div className="text-base font-black text-teal-400 flex-shrink-0">
                    {fmt(Number(m.value), m.unit)}
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
