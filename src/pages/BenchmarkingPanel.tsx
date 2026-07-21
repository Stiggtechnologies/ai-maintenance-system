import { TrendingUp, Target, Activity, Plug } from "lucide-react";
import { motion } from "framer-motion";
import { useAsyncData } from "../hooks/useAsyncData";
import {
  LoadingState,
  ErrorState,
  EmptyState,
} from "../components/ui/AsyncStates";
import { getAssets, getWorkOrders } from "../services/operatingLoopService";
import type { AssetRow, WorkOrderRow } from "../types/operating";

interface FleetRow {
  asset: AssetRow;
  healthDelta: number;
  percentile: number;
  openWorkOrders: number;
  totalWorkOrders: number;
  serviceYears: number | null;
  wosPerYear: number | null;
  status: "above" | "at" | "below";
}

interface FleetData {
  assets: AssetRow[];
  workOrders: WorkOrderRow[];
}

interface Insight {
  text: string;
  type: "positive" | "negative" | "neutral";
}

const statusColors: Record<string, { text: string; bg: string }> = {
  above: { text: "text-teal-400", bg: "bg-teal-500/10" },
  at: { text: "text-blue-400", bg: "bg-blue-500/10" },
  below: { text: "text-amber-400", bg: "bg-amber-500/10" },
};

const OPEN_WO_STATUSES = new Set([
  "pending",
  "approval",
  "scheduled",
  "in_progress",
  "blocked",
  "critical",
]);

function serviceYearsOf(asset: AssetRow): number | null {
  if (!asset.installed_date) return null;
  const installed = new Date(asset.installed_date).getTime();
  if (Number.isNaN(installed)) return null;
  const years = (Date.now() - installed) / (365.25 * 24 * 3600 * 1000);
  return years > 0 ? years : null;
}

function buildRows(data: FleetData): {
  rows: FleetRow[];
  fleetAvgHealth: number;
  fleetAvgRisk: number;
} {
  const { assets, workOrders } = data;
  const fleetAvgHealth =
    assets.reduce((s, a) => s + a.health_score, 0) / assets.length;
  const fleetAvgRisk =
    assets.reduce((s, a) => s + a.risk_score, 0) / assets.length;

  const rows: FleetRow[] = assets.map((asset) => {
    const assetWos = workOrders.filter((w) => w.asset_id === asset.id);
    const openWorkOrders = assetWos.filter((w) =>
      OPEN_WO_STATUSES.has(w.status),
    ).length;
    const healthDelta = asset.health_score - fleetAvgHealth;
    // Percentile of this asset's health within the fleet (rank-based).
    const below = assets.filter(
      (a) => a.health_score < asset.health_score,
    ).length;
    const percentile = Math.round(
      (below / Math.max(assets.length - 1, 1)) * 100,
    );
    const serviceYears = serviceYearsOf(asset);
    const wosPerYear =
      serviceYears && serviceYears > 0 ? assetWos.length / serviceYears : null;
    return {
      asset,
      healthDelta,
      percentile,
      openWorkOrders,
      totalWorkOrders: assetWos.length,
      serviceYears,
      wosPerYear,
      status: healthDelta >= 2 ? "above" : healthDelta <= -2 ? "below" : "at",
    };
  });

  rows.sort((a, b) => b.asset.health_score - a.asset.health_score);
  return { rows, fleetAvgHealth, fleetAvgRisk };
}

function buildInsights(
  rows: FleetRow[],
  fleetAvgHealth: number,
  workOrders: WorkOrderRow[],
): Insight[] {
  const insights: Insight[] = [];
  if (rows.length === 0) return insights;

  const best = rows[0];
  const worst = rows[rows.length - 1];
  if (best.asset.id !== worst.asset.id) {
    insights.push({
      text: `${best.asset.name} has the highest health in the fleet (${best.asset.health_score} vs fleet average ${fleetAvgHealth.toFixed(1)}).`,
      type: "positive",
    });
    insights.push({
      text: `${worst.asset.name} is ${Math.abs(worst.healthDelta).toFixed(1)} pts below fleet average health (${worst.asset.health_score} vs ${fleetAvgHealth.toFixed(1)}).`,
      type: "negative",
    });
  }

  const topRisk = [...rows].sort(
    (a, b) => b.asset.risk_score - a.asset.risk_score,
  )[0];
  insights.push({
    text: `${topRisk.asset.name} carries the highest modelled risk score (${topRisk.asset.risk_score}/100, criticality: ${topRisk.asset.criticality}).`,
    type: topRisk.asset.risk_score >= 70 ? "negative" : "neutral",
  });

  const safetyOpen = workOrders.filter(
    (w) => w.safety_flag && w.status !== "completed",
  ).length;
  if (safetyOpen > 0) {
    insights.push({
      text: `${safetyOpen} open work order${safetyOpen === 1 ? " is" : "s are"} safety-flagged across the fleet.`,
      type: "negative",
    });
  }

  const blocked = workOrders.filter((w) => w.status === "blocked").length;
  if (blocked > 0) {
    insights.push({
      text: `${blocked} work order${blocked === 1 ? "" : "s"} currently blocked — a schedule-compliance constraint.`,
      type: "neutral",
    });
  }

  return insights;
}

export function BenchmarkingPanel() {
  const { data, loading, error, refetch, isEmpty } = useAsyncData<FleetData>(
    async () => {
      const [assets, workOrders] = await Promise.all([
        getAssets(),
        getWorkOrders(),
      ]);
      return { assets, workOrders };
    },
    [],
    { isEmpty: (d) => !d || d.assets.length === 0 },
  );

  if (loading) return <LoadingState label="Loading fleet benchmark…" />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;
  if (isEmpty || !data)
    return (
      <EmptyState message="No assets yet — fleet benchmarking populates once assets are onboarded." />
    );

  const { rows, fleetAvgHealth, fleetAvgRisk } = buildRows(data);
  const insights = buildInsights(rows, fleetAvgHealth, data.workOrders);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            Benchmarking
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Each asset vs your fleet average — internal benchmark from live data
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <Target className="w-4 h-4 text-teal-400" />
          <span>
            Fleet: {rows.length} assets · avg health {fleetAvgHealth.toFixed(1)}{" "}
            · avg risk {fleetAvgRisk.toFixed(1)}
          </span>
        </div>
      </div>

      {/* Fleet Benchmark Table */}
      <div className="bg-[#0D1520] border border-white/6 rounded-2xl p-5">
        <h3 className="text-sm font-semibold text-slate-200 mb-4 flex items-center gap-2">
          <Activity className="w-4 h-4 text-teal-400" /> Asset vs Fleet Average
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/6">
                <th className="text-left py-3 px-3 text-slate-400 font-semibold">
                  Asset
                </th>
                <th className="text-center py-3 px-3 text-slate-400 font-semibold">
                  Health
                </th>
                <th className="text-center py-3 px-3 text-slate-400 font-semibold">
                  Fleet Avg
                </th>
                <th className="text-center py-3 px-3 text-slate-400 font-semibold">
                  Fleet Percentile
                </th>
                <th className="text-center py-3 px-3 text-slate-400 font-semibold">
                  Risk
                </th>
                <th className="text-center py-3 px-3 text-slate-400 font-semibold">
                  Open WOs
                </th>
                <th className="text-center py-3 px-3 text-slate-400 font-semibold">
                  WOs / Service Yr*
                </th>
                <th className="text-center py-3 px-3 text-slate-400 font-semibold">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const sc = statusColors[r.status];
                return (
                  <motion.tr
                    key={r.asset.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: i * 0.04 }}
                    className="border-b border-white/4 hover:bg-white/2 transition-colors"
                  >
                    <td className="py-3 px-3 text-slate-200 font-medium">
                      {r.asset.name}
                      {r.asset.tag && (
                        <span className="ml-2 font-mono text-slate-400">
                          {r.asset.tag}
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-center font-mono text-slate-200">
                      {r.asset.health_score}
                    </td>
                    <td className="py-3 px-3 text-center font-mono text-slate-400">
                      {fleetAvgHealth.toFixed(1)}{" "}
                      <span className={sc.text}>
                        ({r.healthDelta >= 0 ? "+" : ""}
                        {r.healthDelta.toFixed(1)})
                      </span>
                    </td>
                    <td className="py-3 px-3 text-center">
                      <div className="flex items-center gap-2 justify-center">
                        <div className="w-16 h-1.5 bg-white/5 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${r.percentile >= 70 ? "bg-teal-500" : r.percentile >= 40 ? "bg-amber-500" : "bg-red-500"}`}
                            style={{ width: `${Math.max(r.percentile, 4)}%` }}
                          />
                        </div>
                        <span className="font-mono text-slate-400 w-8 text-right">
                          {r.percentile}
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-3 text-center font-mono text-slate-200">
                      {r.asset.risk_score}
                    </td>
                    <td className="py-3 px-3 text-center font-mono text-slate-200">
                      {r.openWorkOrders}
                    </td>
                    <td className="py-3 px-3 text-center font-mono text-slate-400">
                      {r.wosPerYear != null
                        ? `${r.wosPerYear.toFixed(2)} (${r.totalWorkOrders} in ${r.serviceYears!.toFixed(1)} yr)`
                        : "—"}
                    </td>
                    <td className="py-3 px-3 text-center">
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-bold capitalize ${sc.bg} ${sc.text}`}
                      >
                        {r.status}
                      </span>
                    </td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-400 mt-3 leading-relaxed">
          *MTBF-style proxy: work orders recorded in SyncAI divided by years
          since installation. It reflects only work captured in this system, not
          full maintenance history.
        </p>
      </div>

      {/* Fleet Insights (computed from live data) */}
      <div className="bg-[#0D1520] border border-white/6 rounded-2xl p-5">
        <h3 className="text-sm font-semibold text-slate-200 mb-4 flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-teal-400" /> Fleet Insights
        </h3>
        {insights.length === 0 ? (
          <EmptyState message="Not enough data to compute fleet insights yet." />
        ) : (
          <div className="space-y-2">
            {insights.map((insight, i) => (
              <motion.div
                key={insight.text}
                initial={{ opacity: 0, x: -5 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.06 }}
                className="flex items-start gap-2 p-3 rounded-xl bg-white/2 border border-white/4"
              >
                <div
                  className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${
                    insight.type === "positive"
                      ? "bg-teal-400"
                      : insight.type === "negative"
                        ? "bg-amber-400"
                        : "bg-blue-400"
                  }`}
                />
                <span className="text-sm text-slate-300 leading-relaxed">
                  {insight.text}
                </span>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* External benchmarks — honest connect state */}
      <div className="bg-[#0D1520] border border-white/6 rounded-xl p-4 flex items-start gap-3">
        <Plug className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
        <div>
          <div className="text-sm font-medium text-blue-400">
            External Industry Benchmarks
          </div>
          <p className="text-xs text-slate-400 mt-1 leading-relaxed">
            This page shows a{" "}
            <span className="text-slate-200">fleet internal benchmark</span>{" "}
            computed from your live asset and work-order data. External industry
            benchmarks (availability, MTBF, MTTR, cost/RAV, OEE peer
            percentiles) connect via CMMS / historian integrations and are not
            yet configured.
          </p>
        </div>
      </div>
    </div>
  );
}
