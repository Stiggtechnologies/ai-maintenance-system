import { useState } from "react";
import {
  TriangleAlert as AlertTriangle,
  DollarSign,
  Clock,
  Shield,
  ChartBar as BarChart2,
  Target,
  Wrench,
} from "lucide-react";
import { motion } from "framer-motion";
import { useAsyncData } from "../hooks/useAsyncData";
import {
  LoadingState,
  ErrorState,
  EmptyState,
} from "../components/ui/AsyncStates";
import {
  getAssets,
  getRecommendations,
  getWorkOrders,
} from "../services/operatingLoopService";
import type {
  AssetRow,
  RecommendationRow,
  WorkOrderRow,
} from "../types/operating";

/** Parse a dollar figure out of free-text like "$2.4M risk mitigation". */
function parseMoney(text: string | null): number {
  if (!text) return 0;
  const match = text.replace(/,/g, "").match(/\$\s*([\d.]+)\s*([mMkK])?/);
  if (!match) return 0;
  const base = parseFloat(match[1]);
  const scale =
    match[2]?.toLowerCase() === "m"
      ? 1_000_000
      : match[2]?.toLowerCase() === "k"
        ? 1_000
        : 1;
  return Math.round(base * scale);
}

function formatMoney(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}K`;
  return `$${value}`;
}

interface RiskEntry {
  asset: AssetRow;
  openRecs: RecommendationRow[];
  safetyWorkOrders: WorkOrderRow[];
  citedExposureUsd: number;
}

interface RiskData {
  assets: AssetRow[];
  recommendations: RecommendationRow[];
  workOrders: WorkOrderRow[];
}

const OPEN_REC_STATUSES = new Set(["pending", "escalated"]);
const CRITICALITY_LEVELS = ["low", "medium", "high", "critical"] as const;

const criticalityColors: Record<
  string,
  { color: string; bg: string; border: string }
> = {
  critical: {
    color: "text-red-400",
    bg: "bg-red-500/10",
    border: "border-red-500/30",
  },
  high: {
    color: "text-amber-400",
    bg: "bg-amber-500/10",
    border: "border-amber-500/30",
  },
  medium: {
    color: "text-blue-400",
    bg: "bg-blue-500/10",
    border: "border-blue-500/30",
  },
  low: {
    color: "text-slate-400",
    bg: "bg-slate-500/10",
    border: "border-slate-500/20",
  },
};

function criticalityStyle(criticality: string) {
  return criticalityColors[criticality] ?? criticalityColors.medium;
}

function RiskMatrix({ entries }: { entries: RiskEntry[] }) {
  const riskBuckets = [
    { label: "Very High (80–100)", min: 80 },
    { label: "High (60–80)", min: 60 },
    { label: "Medium (40–60)", min: 40 },
    { label: "Low (20–40)", min: 20 },
    { label: "Very Low (<20)", min: 0 },
  ];

  const getColor = (bucketMin: number, criticalityIndex: number) => {
    const score = (bucketMin / 100) * (criticalityIndex + 1);
    if (score > 2.4) return "bg-red-500/30 border-red-500/40";
    if (score > 1.2) return "bg-amber-500/20 border-amber-500/30";
    if (score > 0.4) return "bg-blue-500/10 border-blue-500/20";
    return "bg-white/[0.02] border-white/[0.04]";
  };

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[500px]">
        <div className="flex items-center gap-2 mb-2">
          <div className="text-xs text-slate-400 uppercase tracking-wider w-36 text-right">
            Risk Score
          </div>
          <div className="flex-1 grid grid-cols-4 gap-1 text-xs text-slate-400 text-center capitalize">
            {CRITICALITY_LEVELS.map((c) => (
              <div key={c}>{c}</div>
            ))}
          </div>
        </div>
        {riskBuckets.map((bucket, bi) => (
          <div key={bucket.label} className="flex items-center gap-2 mb-1">
            <div className="text-xs text-slate-400 w-36 text-right">
              {bucket.label}
            </div>
            <div className="flex-1 grid grid-cols-4 gap-1">
              {CRITICALITY_LEVELS.map((crit, ci) => {
                const inCell = entries.filter(
                  (e) =>
                    e.asset.risk_score >= bucket.min &&
                    (bi === 0 ||
                      e.asset.risk_score < riskBuckets[bi - 1].min) &&
                    e.asset.criticality === crit,
                );
                return (
                  <div
                    key={crit}
                    title={inCell.map((e) => e.asset.name).join(", ")}
                    className={`h-10 rounded border ${getColor(bucket.min, ci)} flex items-center justify-center text-xs font-bold text-white`}
                  >
                    {inCell.length > 0 ? inCell.length : ""}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        <div className="flex items-center gap-2 mt-1">
          <div className="w-36" />
          <div className="flex-1 text-xs text-slate-400 text-center">
            Asset Criticality
          </div>
        </div>
      </div>
    </div>
  );
}

function RiskCard({ entry }: { entry: RiskEntry }) {
  const [expanded, setExpanded] = useState(false);
  const { asset, openRecs, safetyWorkOrders, citedExposureUsd } = entry;
  const c = criticalityStyle(asset.criticality);
  const barColor =
    asset.risk_score >= 70
      ? "bg-red-500"
      : asset.risk_score >= 45
        ? "bg-amber-500"
        : asset.risk_score >= 20
          ? "bg-blue-500"
          : "bg-slate-500";
  const topRec = openRecs[0];

  return (
    <motion.div
      layout
      className={`bg-[#0D1520] border ${c.border} rounded-xl overflow-hidden cursor-pointer`}
      onClick={() => setExpanded(!expanded)}
    >
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span
                className={`text-xs font-bold px-1.5 py-0.5 rounded-full capitalize ${c.bg} ${c.color} border ${c.border}`}
              >
                {asset.criticality}
              </span>
              {asset.area && (
                <span className="text-xs text-slate-400">{asset.area}</span>
              )}
            </div>
            <h3 className="text-sm font-bold text-slate-200">
              {asset.name}
              {asset.tag && (
                <span className="ml-2 text-xs font-mono text-slate-400">
                  {asset.tag}
                </span>
              )}
            </h3>
            <div className="text-xs text-slate-400 mt-0.5">
              {topRec
                ? (topRec.action ?? topRec.title)
                : "No open recommendations"}
            </div>
          </div>
          <div className="text-right flex-shrink-0">
            <div className={`text-xl font-black ${c.color}`}>
              {asset.risk_score}
            </div>
            <div className="text-xs text-slate-400">Risk Score</div>
          </div>
        </div>

        <div className="mt-3 space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400">Risk score (AI-modelled)</span>
            <span className="text-slate-300 font-medium">
              {asset.risk_score}/100 · health {asset.health_score}/100
            </span>
          </div>
          <div className="h-1.5 bg-white/[0.05] rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${asset.risk_score}%` }}
              transition={{ duration: 0.8 }}
              className={`h-full rounded-full ${barColor}`}
            />
          </div>
        </div>

        <div className="mt-3 flex items-center gap-4 text-xs">
          <div>
            <span className="text-slate-400">Cited exposure: </span>
            <span className={`font-bold ${c.color}`}>
              {citedExposureUsd > 0 ? formatMoney(citedExposureUsd) : "—"}
            </span>
          </div>
          <div>
            <span className="text-slate-400">Open recs: </span>
            <span className="text-slate-300">{openRecs.length}</span>
          </div>
          <div className="ml-auto flex gap-2">
            {safetyWorkOrders.length > 0 && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20 font-semibold">
                {safetyWorkOrders.length} Safety WO
                {safetyWorkOrders.length === 1 ? "" : "s"}
              </span>
            )}
            <span className="text-xs px-1.5 py-0.5 rounded bg-white/[0.04] text-slate-300 border border-white/[0.08] capitalize">
              {asset.status}
            </span>
          </div>
        </div>

        {expanded && (
          <div className="mt-3 pt-3 border-t border-white/[0.05] space-y-3 text-xs">
            <div>
              <div className="text-slate-400 uppercase tracking-wider mb-1.5">
                Open Recommendations
              </div>
              {openRecs.length === 0 ? (
                <div className="text-slate-400">None open for this asset.</div>
              ) : (
                <div className="space-y-1.5">
                  {openRecs.map((r) => (
                    <div
                      key={r.id}
                      className="flex items-center justify-between gap-2 p-2 rounded-lg bg-white/[0.02] border border-white/[0.04]"
                    >
                      <span className="text-slate-200">{r.title}</span>
                      <span className="flex items-center gap-2 flex-shrink-0">
                        <span
                          className={`px-1.5 py-0.5 rounded-full font-bold capitalize ${
                            r.urgency === "critical"
                              ? "bg-red-500/10 text-red-400"
                              : r.urgency === "action"
                                ? "bg-amber-500/10 text-amber-400"
                                : "bg-blue-500/10 text-blue-400"
                          }`}
                        >
                          {r.urgency}
                        </span>
                        <span className="font-mono text-slate-400">
                          {r.confidence}%
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <div className="text-slate-400 uppercase tracking-wider mb-1.5">
                Safety-Flagged Work Orders
              </div>
              {safetyWorkOrders.length === 0 ? (
                <div className="text-slate-400">
                  No safety-flagged work orders.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {safetyWorkOrders.map((w) => (
                    <div
                      key={w.id}
                      className="flex items-center justify-between gap-2 p-2 rounded-lg bg-red-500/[0.04] border border-red-500/10"
                    >
                      <span className="text-slate-200 flex items-center gap-1.5">
                        <Wrench className="w-3 h-3 text-red-400 flex-shrink-0" />
                        {w.title}
                      </span>
                      <span className="text-slate-400 capitalize flex-shrink-0">
                        {w.status} · {w.priority}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}

export function RiskConsequence() {
  const [view, setView] = useState<"list" | "matrix">("list");
  const [sortBy, setSortBy] = useState<"riskScore" | "health" | "exposure">(
    "riskScore",
  );

  const { data, loading, error, refetch, isEmpty } = useAsyncData<RiskData>(
    async () => {
      const [assets, recommendations, workOrders] = await Promise.all([
        getAssets(),
        getRecommendations(),
        getWorkOrders(),
      ]);
      return { assets, recommendations, workOrders };
    },
    [],
    { isEmpty: (d) => !d || d.assets.length === 0 },
  );

  if (loading) return <LoadingState label="Loading risk register…" />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;
  if (isEmpty || !data)
    return (
      <EmptyState message="No assets yet — the risk register populates once assets are onboarded from your CMMS." />
    );

  const entries: RiskEntry[] = data.assets.map((asset) => {
    const openRecs = data.recommendations.filter(
      (r) => r.asset_id === asset.id && OPEN_REC_STATUSES.has(r.status),
    );
    const safetyWorkOrders = data.workOrders.filter(
      (w) =>
        w.asset_id === asset.id && w.safety_flag && w.status !== "completed",
    );
    const citedExposureUsd = openRecs.reduce(
      (sum, r) => sum + parseMoney(r.financial_impact),
      0,
    );
    return { asset, openRecs, safetyWorkOrders, citedExposureUsd };
  });

  const totalCitedExposure = entries.reduce(
    (sum, e) => sum + e.citedExposureUsd,
    0,
  );

  const sorted = [...entries].sort((a, b) => {
    if (sortBy === "riskScore") return b.asset.risk_score - a.asset.risk_score;
    if (sortBy === "health") return a.asset.health_score - b.asset.health_score;
    return b.citedExposureUsd - a.citedExposureUsd;
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            Risk & Consequence
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Live asset risk register — prioritized by consequence, not just work
            order priority
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setView("list")}
            className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${view === "list" ? "bg-teal-500/20 border-teal-500/30 text-teal-400" : "bg-white/[0.04] border-white/[0.08] text-slate-400"}`}
          >
            Risk List
          </button>
          <button
            onClick={() => setView("matrix")}
            className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${view === "matrix" ? "bg-teal-500/20 border-teal-500/30 text-teal-400" : "bg-white/[0.04] border-white/[0.08] text-slate-400"}`}
          >
            Risk Matrix
          </button>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          {
            label: "Cited Exposure (open recs)",
            value:
              totalCitedExposure > 0 ? formatMoney(totalCitedExposure) : "—",
            icon: DollarSign,
            color: "red",
          },
          {
            label: "Critical Risk (≥70)",
            value: entries.filter((e) => e.asset.risk_score >= 70).length,
            icon: AlertTriangle,
            color: "red",
          },
          {
            label: "Action Required (45–69)",
            value: entries.filter(
              (e) => e.asset.risk_score >= 45 && e.asset.risk_score < 70,
            ).length,
            icon: Clock,
            color: "amber",
          },
          {
            label: "Advisory (<45)",
            value: entries.filter((e) => e.asset.risk_score < 45).length,
            icon: BarChart2,
            color: "blue",
          },
        ].map((s) => {
          const Icon = s.icon;
          const colorMap: Record<string, string> = {
            red: "text-red-400 bg-red-500/10",
            amber: "text-amber-400 bg-amber-500/10",
            blue: "text-blue-400 bg-blue-500/10",
          };
          return (
            <div
              key={s.label}
              className="bg-[#0D1520] border border-white/[0.06] rounded-xl p-4"
            >
              <div
                className={`w-8 h-8 rounded-lg ${colorMap[s.color]} flex items-center justify-center mb-2`}
              >
                <Icon className="w-4 h-4" />
              </div>
              <div
                className={`text-2xl font-black ${colorMap[s.color].split(" ")[0]}`}
              >
                {s.value}
              </div>
              <div className="text-xs text-slate-400 mt-0.5">{s.label}</div>
            </div>
          );
        })}
      </div>

      {view === "list" ? (
        <>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">Sort by:</span>
            {(["riskScore", "health", "exposure"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSortBy(s)}
                className={`px-3 py-1 rounded-full text-xs transition-colors ${sortBy === s ? "bg-teal-500/20 text-teal-400 border border-teal-500/30" : "bg-white/[0.03] border border-white/[0.06] text-slate-400"}`}
              >
                {s === "riskScore"
                  ? "Risk Score"
                  : s === "health"
                    ? "Health (worst first)"
                    : "Cited Exposure"}
              </button>
            ))}
          </div>
          <div className="space-y-3">
            {sorted.map((entry, i) => (
              <motion.div
                key={entry.asset.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.06 }}
              >
                <RiskCard entry={entry} />
              </motion.div>
            ))}
          </div>
        </>
      ) : (
        <div className="bg-[#0D1520] border border-white/[0.06] rounded-2xl p-6">
          <h3 className="text-sm font-semibold text-slate-200 mb-4 flex items-center gap-2">
            <Target className="w-4 h-4 text-teal-400" />
            Risk Score vs Asset Criticality Matrix
          </h3>
          <RiskMatrix entries={entries} />
          <div className="mt-4 flex items-center gap-4 text-xs">
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded bg-red-500/30 border border-red-500/40" />
              <span className="text-slate-400">Critical / Unacceptable</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded bg-amber-500/20 border border-amber-500/30" />
              <span className="text-slate-400">Action Required</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded bg-blue-500/10 border border-blue-500/20" />
              <span className="text-slate-400">Advisory</span>
            </div>
          </div>
        </div>
      )}

      {/* Risk Prioritization Note */}
      <div className="bg-[#0D1520] border border-white/[0.06] rounded-xl p-4 flex items-start gap-3">
        <Shield className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
        <div>
          <div className="text-sm font-medium text-blue-400">
            Consequence-First Prioritization
          </div>
          <p className="text-xs text-slate-400 mt-1 leading-relaxed">
            SyncAI prioritizes by{" "}
            <span className="text-slate-200">
              modelled risk score × asset criticality
            </span>
            , not work order number. Cited exposure is the sum of dollar figures
            referenced in this asset's open recommendations — no figures are
            estimated outside the data. This approach reflects ISO 55000 asset
            criticality principles.
          </p>
        </div>
      </div>
    </div>
  );
}
