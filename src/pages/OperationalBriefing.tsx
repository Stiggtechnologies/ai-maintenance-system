import { useState } from "react";
import {
  Sun,
  Clock,
  Zap,
  TrendingUp,
  Users,
  Shield,
  ChevronRight,
  Radio,
  Calendar,
  Target,
} from "lucide-react";
import { motion } from "framer-motion";
import { supabase } from "../lib/supabase";
import { useAsyncData } from "../hooks/useAsyncData";
import {
  getRecommendations,
  getWorkOrders,
  getDecisions,
  getValueMetrics,
  getLearningEvents,
  getIntegrations,
} from "../services/operatingLoopService";
import type { IntegrationRow, ValueMetricRow } from "../types/operating";
import {
  LoadingState,
  ErrorState,
  EmptyState,
} from "../components/ui/AsyncStates";

type BriefingType = "shift" | "daily" | "weekly" | "executive";

interface BriefingKpi {
  label: string;
  value: string;
  trend?: string;
  up?: boolean;
}

interface BriefingCard {
  id: string;
  type: BriefingType;
  title: string;
  time: string;
  audience: string;
  status: "live" | "completed";
  highlights: string[];
  kpiSummary: BriefingKpi[];
}

interface BriefingData {
  briefings: BriefingCard[];
  integrations: IntegrationRow[];
  hasAnyData: boolean;
}

/* -------------------------------------------------------------------------- */
/* Formatting helpers — all values derived from real row timestamps           */
/* -------------------------------------------------------------------------- */

const HOUR = 3_600_000;

function relTime(iso: string, now: number): string {
  const diff = now - new Date(iso).getTime();
  if (diff < 60_000) return "just now";
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function fmtUsd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}

function fmtMetric(m: ValueMetricRow): string {
  const value = Number(m.value);
  if (m.unit === "usd") return fmtUsd(value);
  if (m.unit === "hours") return `${value} hr`;
  if (m.unit === "percent") return `${value}%`;
  return `${value}`;
}

function inWindow(iso: string | null, now: number, ms: number): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t >= now - ms && t <= now;
}

function inPriorWindow(iso: string | null, now: number, ms: number): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t >= now - 2 * ms && t < now - ms;
}

function delta(current: number, prior: number): { trend: string; up: boolean } {
  const d = current - prior;
  return { trend: `${d >= 0 ? "+" : ""}${d} vs prior window`, up: d >= 0 };
}

/* -------------------------------------------------------------------------- */
/* Loader — every briefing line is assembled from queried rows                */
/* -------------------------------------------------------------------------- */

interface SensorAlarmRow {
  id: string;
  name: string;
  status: string | null;
  last_value: number | null;
  threshold: number | null;
  unit: string | null;
  asset: { name: string } | null;
}

interface SystemAlertRow {
  id: string;
  severity: string | null;
  title: string | null;
  description: string | null;
  created_at: string;
}

async function getAlarmSensors(): Promise<SensorAlarmRow[]> {
  const { data, error } = await supabase
    .from("sensors")
    .select("id,name,status,last_value,threshold,unit,asset:assets(name)")
    .eq("status", "alarm")
    .returns<SensorAlarmRow[]>();
  if (error) throw new Error(`Could not load sensor alarms: ${error.message}`);
  return data ?? [];
}

async function getOpenCriticalAlerts(): Promise<SystemAlertRow[]> {
  const { data, error } = await supabase
    .from("system_alerts")
    .select("id,severity,title,description,created_at")
    .eq("resolved", false)
    .eq("severity", "critical")
    .returns<SystemAlertRow[]>();
  if (error) throw new Error(`Could not load system alerts: ${error.message}`);
  return data ?? [];
}

const CLOSED_WO_STATUSES = new Set(["completed", "closed", "cancelled"]);

async function loadBriefings(): Promise<BriefingData> {
  const [
    recs,
    workOrders,
    decisions,
    valueMetrics,
    learningEvents,
    integrations,
    alarms,
    criticalAlerts,
  ] = await Promise.all([
    getRecommendations(),
    getWorkOrders(),
    getDecisions(),
    getValueMetrics(),
    getLearningEvents(),
    getIntegrations(),
    getAlarmSensors(),
    getOpenCriticalAlerts(),
  ]);

  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  const generatedAt = new Date(now).toLocaleString();

  const pendingRecs = recs.filter(
    (r) => r.status === "pending" || r.status === "escalated",
  );
  const openWOs = workOrders.filter((w) => !CLOSED_WO_STATUSES.has(w.status));
  const dueWOs = openWOs.filter(
    (w) => w.scheduled_date != null && w.scheduled_date <= today,
  );

  const alarmLines = alarms.map((s) => {
    const reading =
      s.last_value != null && s.threshold != null
        ? ` (${s.last_value}${s.unit ? ` ${s.unit}` : ""} vs ${s.threshold} threshold)`
        : "";
    return `${s.name}${s.asset ? ` on ${s.asset.name}` : ""} currently in alarm${reading}`;
  });

  const briefings: BriefingCard[] = [];

  /* Shift brief — last 8 hours */
  {
    const win = 8 * HOUR;
    const recsIn = recs.filter((r) => inWindow(r.created_at, now, win));
    const recsPrior = recs.filter((r) => inPriorWindow(r.created_at, now, win));
    const decIn = decisions.filter((d) => inWindow(d.created_at, now, win));
    const decPrior = decisions.filter((d) =>
      inPriorWindow(d.created_at, now, win),
    );
    const recDelta = delta(recsIn.length, recsPrior.length);
    const decDelta = delta(decIn.length, decPrior.length);
    const windowLabel = `${new Date(now - win).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} — ${new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;

    const highlights = [
      ...recsIn.map(
        (r) =>
          `New ${r.urgency} recommendation — ${r.title} (${relTime(r.created_at, now)})`,
      ),
      ...decIn.map(
        (d) =>
          `Decision logged: ${d.action_taken ?? d.decision_type ?? "decision"} (${relTime(d.created_at, now)})`,
      ),
      ...alarmLines,
    ];

    briefings.push({
      id: "shift-8h",
      type: "shift",
      title: "Shift Handover Brief",
      time: `Window ${windowLabel} (last 8 hours)`,
      audience: "Maintenance, Operations, Supervisors",
      status: recsIn.length + decIn.length > 0 ? "live" : "completed",
      highlights:
        highlights.length > 0
          ? highlights
          : [
              "No new recommendations, decisions or alarms in the last 8 hours.",
            ],
      kpiSummary: [
        {
          label: "New Recommendations",
          value: `${recsIn.length}`,
          ...recDelta,
        },
        { label: "Decisions Logged", value: `${decIn.length}`, ...decDelta },
        { label: "Sensor Alarms Open", value: `${alarms.length}` },
        { label: "Pending Recommendations", value: `${pendingRecs.length}` },
      ],
    });
  }

  /* Daily brief — last 24 hours */
  {
    const win = 24 * HOUR;
    const recsIn = recs.filter((r) => inWindow(r.created_at, now, win));
    const recsPrior = recs.filter((r) => inPriorWindow(r.created_at, now, win));
    const decIn = decisions.filter((d) => inWindow(d.created_at, now, win));
    const decPrior = decisions.filter((d) =>
      inPriorWindow(d.created_at, now, win),
    );
    const recDelta = delta(recsIn.length, recsPrior.length);
    const decDelta = delta(decIn.length, decPrior.length);

    const highlights = [
      ...recsIn.map(
        (r) =>
          `New ${r.urgency} recommendation — ${r.title} (${relTime(r.created_at, now)})`,
      ),
      ...dueWOs.map(
        (w) =>
          `${w.wo_number ?? "Work order"} — ${w.title}: scheduled ${w.scheduled_date}${w.scheduled_date && w.scheduled_date < today ? " (past scheduled date)" : " (due today)"}`,
      ),
      ...criticalAlerts.map(
        (a) =>
          `Critical alert: ${a.title ?? "unnamed"}${a.description ? ` — ${a.description}` : ""} (${relTime(a.created_at, now)})`,
      ),
      ...alarmLines,
    ];

    briefings.push({
      id: "daily-24h",
      type: "daily",
      title: "Daily Operations Brief",
      time: `Last 24 hours — generated ${generatedAt}`,
      audience: "Site Leadership, Reliability, Planning",
      status: recsIn.length + decIn.length > 0 ? "live" : "completed",
      highlights:
        highlights.length > 0
          ? highlights
          : ["No new events recorded in the last 24 hours."],
      kpiSummary: [
        {
          label: "New Recommendations",
          value: `${recsIn.length}`,
          ...recDelta,
        },
        { label: "Decisions Logged", value: `${decIn.length}`, ...decDelta },
        { label: "WOs Due / Past Date", value: `${dueWOs.length}` },
        { label: "Critical Alerts Open", value: `${criticalAlerts.length}` },
      ],
    });
  }

  /* Weekly brief — last 7 days */
  {
    const win = 7 * 24 * HOUR;
    const recsIn = recs.filter((r) => inWindow(r.created_at, now, win));
    const decIn = decisions.filter((d) => inWindow(d.created_at, now, win));
    const learnIn = learningEvents.filter((e) =>
      inWindow(e.created_at, now, win),
    );
    const verifiedIn = valueMetrics.filter(
      (m) =>
        m.status === "verified" &&
        m.unit === "usd" &&
        inWindow(m.created_at, now, win),
    );
    const verifiedSum = verifiedIn.reduce((s, m) => s + Number(m.value), 0);

    const highlights = [
      ...learnIn.map(
        (e) => `${e.title ?? e.event_type} (${relTime(e.created_at, now)})`,
      ),
      ...verifiedIn.map(
        (m) => `Value verified: ${m.label ?? m.metric_type} — ${fmtMetric(m)}`,
      ),
    ];

    briefings.push({
      id: "weekly-7d",
      type: "weekly",
      title: "Weekly Reliability Review",
      time: `Last 7 days — generated ${generatedAt}`,
      audience: "Reliability Engineers, Maintenance Managers",
      status: learnIn.length + verifiedIn.length > 0 ? "live" : "completed",
      highlights:
        highlights.length > 0
          ? highlights
          : [
              "No learning events or verified value recorded in the last 7 days.",
            ],
      kpiSummary: [
        { label: "Recommendations (7d)", value: `${recsIn.length}` },
        { label: "Decisions (7d)", value: `${decIn.length}` },
        { label: "Learning Events (7d)", value: `${learnIn.length}` },
        { label: "Value Verified (7d)", value: fmtUsd(verifiedSum) },
      ],
    });
  }

  /* Executive brief — all recorded value metrics */
  {
    const verifiedUsd = valueMetrics.filter(
      (m) => m.status === "verified" && m.unit === "usd",
    );
    const projectedUsd = valueMetrics.filter(
      (m) => m.status === "projected" && m.unit === "usd",
    );
    const verifiedSum = verifiedUsd.reduce((s, m) => s + Number(m.value), 0);
    const projectedSum = projectedUsd.reduce((s, m) => s + Number(m.value), 0);
    const downtimeAvoided = valueMetrics
      .filter(
        (m) => m.metric_type === "downtime_avoided" && m.status === "verified",
      )
      .reduce((s, m) => s + Number(m.value), 0);
    const autonomousActions = valueMetrics
      .filter((m) => m.metric_type === "autonomous_actions_executed")
      .reduce((s, m) => s + Number(m.value), 0);

    const highlights = verifiedUsd.map(
      (m) =>
        `${m.label ?? m.metric_type} — ${fmtMetric(m)} verified${m.period ? ` (${m.period})` : ""}`,
    );

    briefings.push({
      id: "exec-value",
      type: "executive",
      title: "Executive Value Summary",
      time: `All recorded periods — generated ${generatedAt}`,
      audience: "Executives, Site Directors, Finance",
      status: valueMetrics.some((m) =>
        inWindow(m.created_at, now, 7 * 24 * HOUR),
      )
        ? "live"
        : "completed",
      highlights:
        highlights.length > 0
          ? highlights
          : [
              "No verified value recorded yet — connects as value metrics are verified.",
            ],
      kpiSummary: [
        { label: "Value Verified", value: fmtUsd(verifiedSum) },
        { label: "Value Projected", value: fmtUsd(projectedSum) },
        { label: "Downtime Avoided", value: `${downtimeAvoided} hr` },
        { label: "Autonomous Actions", value: `${autonomousActions}` },
      ],
    });
  }

  const hasAnyData =
    recs.length > 0 ||
    workOrders.length > 0 ||
    decisions.length > 0 ||
    valueMetrics.length > 0 ||
    learningEvents.length > 0;

  return { briefings, integrations, hasAnyData };
}

/* -------------------------------------------------------------------------- */
/* Presentation                                                               */
/* -------------------------------------------------------------------------- */

const typeConfig: Record<
  BriefingType,
  {
    icon: React.ElementType;
    color: string;
    bg: string;
    border: string;
    label: string;
  }
> = {
  shift: {
    icon: Sun,
    color: "text-amber-400",
    bg: "bg-amber-500/10",
    border: "border-amber-500/20",
    label: "Shift Brief",
  },
  daily: {
    icon: Zap,
    color: "text-teal-400",
    bg: "bg-teal-500/10",
    border: "border-teal-500/20",
    label: "Daily Intelligence",
  },
  weekly: {
    icon: Calendar,
    color: "text-blue-400",
    bg: "bg-blue-500/10",
    border: "border-blue-500/20",
    label: "Weekly Review",
  },
  executive: {
    icon: Target,
    color: "text-cyan-400",
    bg: "bg-cyan-500/10",
    border: "border-cyan-500/20",
    label: "Executive",
  },
};

const statusConfig: Record<
  string,
  { color: string; bg: string; dot: string; label: string }
> = {
  live: {
    color: "text-teal-400",
    bg: "bg-teal-500/10",
    dot: "bg-teal-400 animate-pulse",
    label: "LIVE",
  },
  completed: {
    color: "text-slate-400",
    bg: "bg-slate-500/10",
    dot: "bg-slate-400",
    label: "Quiet",
  },
};

const integrationStatusColor: Record<string, string> = {
  connected: "text-teal-400",
  degraded: "text-amber-400",
  disconnected: "text-red-400",
};

function BriefCard({
  briefing,
  index,
}: {
  briefing: BriefingCard;
  index: number;
}) {
  const [expanded, setExpanded] = useState(briefing.status === "live");
  const tc = typeConfig[briefing.type];
  const sc = statusConfig[briefing.status];
  const Icon = tc.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.08 }}
      className={`border ${tc.border} rounded-2xl overflow-hidden bg-[#0D1520]`}
    >
      {/* Card Header */}
      <div
        className="p-5 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className={`p-2.5 rounded-xl ${tc.bg} flex-shrink-0`}>
              <Icon className={`w-5 h-5 ${tc.color}`} />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-0.5">
                <span
                  className={`text-xs font-bold uppercase tracking-wider ${tc.color}`}
                >
                  {tc.label}
                </span>
                <div
                  className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full ${sc.bg}`}
                >
                  <div className={`w-1.5 h-1.5 rounded-full ${sc.dot}`} />
                  <span className={`text-xs font-semibold ${sc.color}`}>
                    {sc.label}
                  </span>
                </div>
              </div>
              <h3 className="text-base font-bold text-white">
                {briefing.title}
              </h3>
              <div className="flex items-center gap-3 mt-1 text-xs text-slate-400">
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {briefing.time}
                </span>
                <span className="flex items-center gap-1">
                  <Users className="w-3 h-3" />
                  {briefing.audience}
                </span>
              </div>
            </div>
          </div>
          <ChevronRight
            className={`w-4 h-4 text-slate-400 transition-transform flex-shrink-0 mt-2 ${expanded ? "rotate-90" : ""}`}
          />
        </div>
      </div>

      {/* Expanded Content */}
      <motion.div
        initial={false}
        animate={{ height: expanded ? "auto" : 0, opacity: expanded ? 1 : 0 }}
        transition={{ duration: 0.2 }}
        className="overflow-hidden"
      >
        <div className="px-5 pb-5 pt-0">
          {/* KPI Summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            {briefing.kpiSummary.map((kpi) => (
              <div
                key={kpi.label}
                className="bg-white/[0.03] border border-white/[0.05] rounded-xl p-3"
              >
                <div className="text-xs text-slate-400">{kpi.label}</div>
                <div className="text-lg font-black text-slate-200 mt-0.5">
                  {kpi.value}
                </div>
                {kpi.trend && (
                  <div
                    className={`text-xs mt-0.5 flex items-center gap-1 ${kpi.up ? "text-teal-400" : "text-amber-400"}`}
                  >
                    <TrendingUp className="w-2.5 h-2.5" />
                    {kpi.trend}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Highlights */}
          <div className="space-y-2">
            <div className="text-xs font-semibold text-slate-400 mb-2">
              Key Highlights
            </div>
            {briefing.highlights.map((highlight, i) => (
              <div
                key={i}
                className="flex items-start gap-2 text-sm text-slate-300"
              >
                <div
                  className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${
                    highlight.toLowerCase().includes("critical") ||
                    highlight.toLowerCase().includes("alarm")
                      ? "bg-amber-400"
                      : "bg-teal-400"
                  }`}
                />
                <span className="leading-relaxed">{highlight}</span>
              </div>
            ))}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

export function OperationalBriefing() {
  const [filter, setFilter] = useState<BriefingType | "all">("all");
  const { data, loading, error, refetch } = useAsyncData(loadBriefings);

  if (loading) {
    return (
      <div className="p-6">
        <LoadingState label="Assembling briefings from live operating data…" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="p-6">
        <ErrorState message={error} onRetry={refetch} />
      </div>
    );
  }
  if (!data || !data.hasAnyData) {
    return (
      <div className="p-6">
        <EmptyState message="No operating data yet — briefings connect once recommendations, work orders and decisions start flowing." />
      </div>
    );
  }

  const filtered =
    filter === "all"
      ? data.briefings
      : data.briefings.filter((b) => b.type === filter);
  const liveCount = data.briefings.filter((b) => b.status === "live").length;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            Operational Briefing
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Briefings assembled live from recommendations, work orders,
            decisions and value metrics
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-500/10 border border-teal-500/20 rounded-lg text-xs text-teal-400 font-medium">
            <Radio className="w-3.5 h-3.5 animate-pulse" />
            {liveCount} Active Brief{liveCount === 1 ? "" : "s"}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {[
          { value: "all", label: "All Briefings" },
          { value: "shift", label: "Shift Handover" },
          { value: "daily", label: "Daily Intelligence" },
          { value: "weekly", label: "Weekly Review" },
          { value: "executive", label: "Executive" },
        ].map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value as BriefingType | "all")}
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

      {/* Data Sources */}
      <div className="bg-[#0D1520] border border-white/[0.06] rounded-2xl p-5">
        <h3 className="text-sm font-semibold text-slate-200 mb-3 flex items-center gap-2">
          <Shield className="w-4 h-4 text-teal-400" /> Briefing Data Sources
        </h3>
        {data.integrations.length === 0 ? (
          <EmptyState message="No integrations configured yet — briefings currently draw from SyncAI operating data only." />
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {data.integrations.map((integration) => (
              <div
                key={integration.id}
                className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.05]"
              >
                <Zap
                  className={`w-4 h-4 mb-2 ${integrationStatusColor[integration.status] ?? "text-slate-400"}`}
                />
                <div className="text-xs font-semibold text-slate-200">
                  {integration.name}
                </div>
                <div
                  className={`text-xs mt-0.5 capitalize ${integrationStatusColor[integration.status] ?? "text-slate-400"}`}
                >
                  {integration.status}
                </div>
                <div className="text-xs text-slate-400 mt-0.5">
                  {integration.records_synced.toLocaleString()} records synced
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Briefing Cards */}
      <div className="space-y-4">
        {filtered.map((briefing, i) => (
          <BriefCard key={briefing.id} briefing={briefing} index={i} />
        ))}
      </div>

      {/* Footer Note */}
      <div className="bg-[#0D1520] border border-teal-500/10 rounded-xl p-4 flex items-start gap-3">
        <Zap className="w-4 h-4 text-teal-400 flex-shrink-0 mt-0.5" />
        <div>
          <div className="text-sm font-bold text-teal-400">
            Live-Data Briefings
          </div>
          <p className="text-xs text-slate-400 mt-1 leading-relaxed">
            Every figure and highlight above is computed at load time from
            recommendations, work orders, decisions, sensor alarms, learning
            events and value metrics recorded in SyncAI — nothing is
            pre-written.
          </p>
        </div>
      </div>
    </div>
  );
}
