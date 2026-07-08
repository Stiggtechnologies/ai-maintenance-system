import { useState } from "react";
import {
  Plug,
  Database as DatabaseIcon,
  RefreshCw,
  Server,
  Radio,
  ChevronRight,
  Zap,
  Cpu,
  Layers,
} from "lucide-react";
import { motion } from "framer-motion";
import { useAsyncData } from "../hooks/useAsyncData";
import { getIntegrations } from "../services/operatingLoopService";
import { supabase } from "../lib/supabase";
import type { IntegrationRow } from "../types/operating";
import {
  LoadingState,
  ErrorState,
  EmptyState,
} from "../components/ui/AsyncStates";

type IntegrationStatus = "healthy" | "degraded" | "down" | "maintenance";

interface LiveIntegration {
  id: string;
  name: string;
  category: string;
  status: IntegrationStatus;
  description: string;
  icon: React.ElementType;
  /** Real timestamp of last sync/run; null when the source has none. */
  lastSyncAt: string | null;
  /** Honest label used when there is no timestamp to show. */
  lastSyncFallback: string;
  recordsSynced: number | null;
  connectedSince: string | null;
}

interface LoopStats {
  loopRecommendations: number;
  latestLoopRecAt: string | null;
  latestRun: {
    status: string;
    summary: string | null;
    started_at: string | null;
    completed_at: string | null;
  } | null;
}

async function getLoopStats(): Promise<LoopStats> {
  const [recsRes, runsRes] = await Promise.all([
    supabase
      .from("recommendations")
      .select("id, created_at")
      .like("rationale", "Raised by the continuous%")
      .order("created_at", { ascending: false }),
    supabase
      .from("agent_runs")
      .select("status, summary, started_at, completed_at")
      .order("started_at", { ascending: false })
      .limit(1),
  ]);
  if (recsRes.error) throw new Error(recsRes.error.message);
  if (runsRes.error) throw new Error(runsRes.error.message);
  const recs = recsRes.data ?? [];
  const runs = runsRes.data ?? [];
  return {
    loopRecommendations: recs.length,
    latestLoopRecAt: recs[0]?.created_at ?? null,
    latestRun: runs[0] ?? null,
  };
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diffMs = Date.now() - then;
  if (diffMs < 0) return new Date(iso).toLocaleString();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function mapStatus(status: string): IntegrationStatus {
  const s = status.toLowerCase();
  if (s === "connected" || s === "active" || s === "healthy") return "healthy";
  if (s === "degraded") return "degraded";
  if (s === "down" || s === "error" || s === "disconnected" || s === "failed")
    return "down";
  return "maintenance";
}

function categoryIcon(category: string): React.ElementType {
  const c = category.toLowerCase();
  if (c.includes("cmms")) return DatabaseIcon;
  if (c.includes("historian")) return Radio;
  if (c.includes("condition")) return Cpu;
  if (c.includes("native")) return Zap;
  return Server;
}

const NATIVE_CATEGORY = "SyncAI Native";

function buildLiveIntegrations(
  rows: IntegrationRow[],
  loop: LoopStats,
): LiveIntegration[] {
  const external: LiveIntegration[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    category: row.category ?? "Uncategorized",
    status: mapStatus(row.status),
    description: `${row.category ?? "External"} connector`,
    icon: categoryIcon(row.category ?? ""),
    lastSyncAt: row.last_sync,
    lastSyncFallback: "Sync telemetry connects with the live connector",
    recordsSynced: row.records_synced,
    connectedSince: row.created_at,
  }));

  const loopHealthy =
    loop.latestRun !== null && loop.latestRun.status !== "failed";
  const native: LiveIntegration[] = [
    {
      id: "native-supabase",
      name: "Supabase Data Plane",
      category: NATIVE_CATEGORY,
      status: "healthy",
      description:
        "This workspace's own database — it served the live data on this page",
      icon: DatabaseIcon,
      lastSyncAt: null,
      lastSyncFallback: "Live — serving this session",
      recordsSynced: null,
      connectedSince: null,
    },
    {
      id: "native-agent-loop",
      name: "Continuous Agent Loop (pg_cron)",
      category: NATIVE_CATEGORY,
      status:
        loop.latestRun === null && loop.loopRecommendations === 0
          ? "maintenance"
          : loopHealthy
            ? "healthy"
            : "degraded",
      description: `Scheduled agent loop — ${loop.loopRecommendations} recommendation${loop.loopRecommendations === 1 ? "" : "s"} raised autonomously`,
      icon: Zap,
      lastSyncAt:
        loop.latestRun?.completed_at ??
        loop.latestRun?.started_at ??
        loop.latestLoopRecAt,
      lastSyncFallback: "No loop runs recorded yet",
      recordsSynced: null,
      connectedSince: null,
    },
  ];

  return [...external, ...native];
}

const statusConfig: Record<
  IntegrationStatus,
  { color: string; bg: string; border: string; dot: string; label: string }
> = {
  healthy: {
    color: "text-teal-400",
    bg: "bg-teal-500/10",
    border: "border-teal-500/20",
    dot: "bg-teal-400",
    label: "Healthy",
  },
  degraded: {
    color: "text-amber-400",
    bg: "bg-amber-500/10",
    border: "border-amber-500/20",
    dot: "bg-amber-400 animate-pulse",
    label: "Degraded",
  },
  down: {
    color: "text-red-400",
    bg: "bg-red-500/10",
    border: "border-red-500/20",
    dot: "bg-red-400 animate-pulse",
    label: "Down",
  },
  maintenance: {
    color: "text-blue-400",
    bg: "bg-blue-500/10",
    border: "border-blue-500/20",
    dot: "bg-blue-400",
    label: "Standby",
  },
};

function IntegrationCard({
  integration,
  index,
}: {
  integration: LiveIntegration;
  index: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const sc = statusConfig[integration.status];
  const Icon = integration.icon;
  const lastSyncLabel = integration.lastSyncAt
    ? timeAgo(integration.lastSyncAt)
    : integration.lastSyncFallback;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      className={`border ${sc.border} rounded-xl overflow-hidden bg-[#0D1520] cursor-pointer hover:border-white/[0.12] transition-colors`}
      onClick={() => setExpanded(!expanded)}
    >
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className={`p-2 rounded-lg ${sc.bg} flex-shrink-0`}>
              <Icon className={`w-4 h-4 ${sc.color}`} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-semibold text-slate-200">
                  {integration.name}
                </h4>
                <span
                  className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${sc.bg} ${sc.color}`}
                >
                  {sc.label}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                {integration.description}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <div className="text-right hidden sm:block">
              <div className="text-xs font-mono text-slate-300">
                {integration.lastSyncAt
                  ? lastSyncLabel
                  : integration.id === "native-supabase"
                    ? "live"
                    : "—"}
              </div>
              <div className="text-xs text-slate-400">last sync</div>
            </div>
            <ChevronRight
              className={`w-3.5 h-3.5 text-slate-400 transition-transform ${expanded ? "rotate-90" : ""}`}
            />
          </div>
        </div>
      </div>

      <motion.div
        initial={false}
        animate={{ height: expanded ? "auto" : 0, opacity: expanded ? 1 : 0 }}
        transition={{ duration: 0.15 }}
        className="overflow-hidden"
      >
        <div className="px-4 pb-4 pt-0">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-3 border-t border-white/[0.06]">
            <div>
              <div className="text-xs text-slate-400">Last Sync</div>
              <div className="text-sm font-bold text-slate-200 mt-0.5">
                {lastSyncLabel}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-400">Records Synced</div>
              <div className="text-sm font-bold text-blue-400 mt-0.5">
                {integration.recordsSynced !== null
                  ? integration.recordsSynced.toLocaleString()
                  : "—"}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-400">Connected Since</div>
              <div className="text-sm font-bold text-slate-200 mt-0.5">
                {integration.connectedSince
                  ? new Date(integration.connectedSince).toLocaleDateString()
                  : "Built-in"}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-400">Category</div>
              <div className="text-sm font-bold text-slate-200 mt-0.5">
                {integration.category}
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

export function IntegrationHealthPanel() {
  const [filter, setFilter] = useState<string>("all");
  const { data, loading, error, refetch } = useAsyncData(
    () => Promise.all([getIntegrations(), getLoopStats()]),
    [],
  );

  const header = (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight">
          Integration Health
        </h1>
        <p className="text-sm text-slate-400 mt-0.5">
          Live status of connected systems, from the integrations registry
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={refetch}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-white/[0.04] border border-white/[0.08] rounded-lg text-xs text-slate-400 hover:bg-white/[0.08] transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Refresh All
        </button>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="p-6 space-y-6">
        {header}
        <LoadingState label="Loading integration health…" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 space-y-6">
        {header}
        <ErrorState message={error} onRetry={refetch} />
      </div>
    );
  }

  const [rows, loop] = data ?? [[], null];
  const integrations = buildLiveIntegrations(
    rows,
    loop ?? { loopRecommendations: 0, latestLoopRecAt: null, latestRun: null },
  );

  const healthy = integrations.filter((i) => i.status === "healthy").length;
  const degraded = integrations.filter((i) => i.status === "degraded").length;
  const down = integrations.filter((i) => i.status === "down").length;
  const totalRecords = rows.reduce(
    (sum, r) => sum + (r.records_synced ?? 0),
    0,
  );

  const categories = Array.from(
    new Set(integrations.map((i) => i.category)),
  ).sort();
  const filtered =
    filter === "all"
      ? integrations
      : integrations.filter((i) => i.category === filter);

  return (
    <div className="p-6 space-y-6">
      {header}

      {/* Health Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-[#0D1520] border border-white/[0.06] rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-2 h-2 rounded-full bg-teal-400" />
            <span className="text-xs text-slate-400">Healthy</span>
          </div>
          <div className="text-3xl font-black text-teal-400">{healthy}</div>
          <div className="text-xs text-slate-400 mt-0.5">integrations</div>
        </div>
        <div className="bg-[#0D1520] border border-white/[0.06] rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-2 h-2 rounded-full bg-amber-400" />
            <span className="text-xs text-slate-400">Degraded</span>
          </div>
          <div className="text-3xl font-black text-amber-400">{degraded}</div>
          <div className="text-xs text-slate-400 mt-0.5">integrations</div>
        </div>
        <div className="bg-[#0D1520] border border-white/[0.06] rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-2 h-2 rounded-full bg-red-400" />
            <span className="text-xs text-slate-400">Down</span>
          </div>
          <div className="text-3xl font-black text-red-400">{down}</div>
          <div className="text-xs text-slate-400 mt-0.5">integrations</div>
        </div>
        <div className="bg-[#0D1520] border border-white/[0.06] rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Layers className="w-3.5 h-3.5 text-blue-400" />
            <span className="text-xs text-slate-400">Records Synced</span>
          </div>
          <div className="text-3xl font-black text-blue-400">
            {totalRecords.toLocaleString()}
          </div>
          <div className="text-xs text-slate-400 mt-0.5">
            across {rows.length} external connector
            {rows.length === 1 ? "" : "s"}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {[
          { value: "all", label: "All Systems" },
          ...categories.map((c) => ({ value: c, label: c })),
        ].map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
              filter === f.value
                ? "bg-teal-500/20 border border-teal-500/30 text-teal-400"
                : "bg-white/[0.04] border border-white/[0.08] text-slate-400 hover:bg-white/[0.08]"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Integration Cards */}
      <div className="space-y-3">
        {filtered.map((integration, i) => (
          <IntegrationCard
            key={integration.id}
            integration={integration}
            index={i}
          />
        ))}
      </div>

      {rows.length === 0 && (
        <EmptyState message="No external integrations connected yet — connect a CMMS, historian, or condition-monitoring system to see live sync health here." />
      )}

      {/* Data Pipeline Status */}
      <div className="bg-[#0D1520] border border-teal-500/10 rounded-xl p-4 flex items-start gap-3">
        <Plug className="w-4 h-4 text-teal-400 flex-shrink-0 mt-0.5" />
        <div>
          <div className="text-sm font-bold text-teal-400">
            Data Pipeline Health
          </div>
          <p className="text-xs text-slate-400 mt-1 leading-relaxed">
            Status, last-sync timestamps, and record counts above come directly
            from the integrations registry. SyncAI-native services (the Supabase
            data plane and the continuous agent loop) report their own live
            activity. Latency and throughput telemetry connects when live
            connectors stream metrics.
          </p>
        </div>
      </div>
    </div>
  );
}
