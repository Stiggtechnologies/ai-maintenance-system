import { useState } from "react";
import {
  Target,
  Activity,
  Package,
  Bot,
  Shield,
  TriangleAlert as AlertTriangle,
  CircleCheck as CheckCircle,
  ChevronRight,
  Radio,
  ClipboardCheck,
} from "lucide-react";
import { motion } from "framer-motion";
import { supabase } from "../lib/supabase";
import { useAsyncData } from "../hooks/useAsyncData";
import {
  getAssets,
  getAgents,
  getRecommendations,
  getWorkOrders,
  getApprovals,
} from "../services/operatingLoopService";
import {
  LoadingState,
  ErrorState,
  EmptyState,
} from "../components/ui/AsyncStates";

/* -------------------------------------------------------------------------- */
/* Page-local queries (tables without a shared service function)              */
/* -------------------------------------------------------------------------- */

interface SensorLite {
  id: string;
  name: string;
  status: string | null;
}

interface SystemAlertLite {
  id: string;
  severity: string | null;
  title: string | null;
  description: string | null;
  alert_type: string | null;
  resolved: boolean | null;
}

interface OnboardingLite {
  asset_id: string;
  status: string;
  completion_pct: number;
  human_required_count: number;
}

async function getSensorsLite(): Promise<SensorLite[]> {
  const { data, error } = await supabase
    .from("sensors")
    .select("id,name,status")
    .returns<SensorLite[]>();
  if (error) throw new Error(`Could not load sensors: ${error.message}`);
  return data ?? [];
}

async function getSystemAlertsLite(): Promise<SystemAlertLite[]> {
  const { data, error } = await supabase
    .from("system_alerts")
    .select("id,severity,title,description,alert_type,resolved")
    .eq("resolved", false)
    .returns<SystemAlertLite[]>();
  if (error) throw new Error(`Could not load system alerts: ${error.message}`);
  return data ?? [];
}

async function getOnboardingLite(): Promise<OnboardingLite[]> {
  const { data, error } = await supabase
    .from("asset_onboarding_state")
    .select("asset_id,status,completion_pct,human_required_count")
    .returns<OnboardingLite[]>();
  if (error)
    throw new Error(`Could not load onboarding state: ${error.message}`);
  return data ?? [];
}

/* -------------------------------------------------------------------------- */
/* Readiness model — every figure below is computed from queried rows         */
/* -------------------------------------------------------------------------- */

interface FactorItem {
  label: string;
  value: string;
  ok: boolean;
}

interface ReadinessArea {
  id: string;
  label: string;
  score: number;
  icon: React.ElementType;
  color: string;
  status: string;
  items: FactorItem[];
}

interface ReadinessGap {
  issue: string;
  action: string;
  owner: string;
  urgency: "red" | "amber";
}

interface ReadinessData {
  areas: ReadinessArea[];
  gaps: ReadinessGap[];
  hasAnyData: boolean;
}

const CLOSED_WO_STATUSES = new Set(["completed", "closed", "cancelled"]);

function scoreColor(score: number): string {
  if (score >= 95) return "green";
  if (score >= 85) return "teal";
  if (score >= 70) return "blue";
  return "amber";
}

function scoreStatus(score: number): string {
  if (score >= 90) return "Ready";
  if (score >= 75) return "Watch";
  if (score >= 60) return "Caution";
  return "Critical";
}

function avg(values: number[]): number {
  if (values.length === 0) return 100;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

async function loadReadiness(): Promise<ReadinessData> {
  const [
    assets,
    agents,
    recs,
    workOrders,
    approvals,
    sensors,
    alerts,
    onboarding,
  ] = await Promise.all([
    getAssets(),
    getAgents(),
    getRecommendations(),
    getWorkOrders(),
    getApprovals(),
    getSensorsLite(),
    getSystemAlertsLite(),
    getOnboardingLite(),
  ]);

  const today = new Date().toISOString().slice(0, 10);
  const openWOs = workOrders.filter((w) => !CLOSED_WO_STATUSES.has(w.status));
  const blockedWOs = openWOs.filter((w) => w.status === "blocked");
  const overdueWOs = openWOs.filter(
    (w) => w.scheduled_date != null && w.scheduled_date < today,
  );
  const approvalGatedWOs = openWOs.filter((w) => w.approval_required);
  const pendingRecs = recs.filter(
    (r) => r.status === "pending" || r.status === "escalated",
  );
  const pendingApprovals = approvals.filter(
    (a) => a.status === "required" || a.status === "pending",
  );
  const highRiskAssets = assets.filter((a) => a.risk_score >= 70);
  const criticalStatusAssets = assets.filter((a) => a.status === "critical");
  const sensorsAlarm = sensors.filter((s) => s.status === "alarm");
  const sensorsWarning = sensors.filter((s) => s.status === "warning");
  const criticalAlerts = alerts.filter((a) => a.severity === "critical");
  const activeAgents = agents.filter((a) => a.status === "active");
  const humanRequired = onboarding.reduce(
    (sum, o) => sum + o.human_required_count,
    0,
  );
  const liveAssets = onboarding.filter((o) => o.status === "live").length;
  const readyForGolive = onboarding.filter(
    (o) => o.status === "ready_for_golive",
  ).length;

  const assetHealth = avg(assets.map((a) => a.health_score));
  const maintenanceReadiness = openWOs.length
    ? Math.round(((openWOs.length - blockedWOs.length) / openWOs.length) * 100)
    : 100;
  const partsReadiness = openWOs.length
    ? Math.round(
        (openWOs.filter((w) => w.parts_ready).length / openWOs.length) * 100,
      )
    : 100;
  const alertPosture = sensors.length
    ? Math.round(
        ((sensors.length - sensorsAlarm.length) / sensors.length) * 100,
      )
    : 100;
  const aiWorkforce = agents.length
    ? Math.round((activeAgents.length / agents.length) * 100)
    : 100;
  const onboardingCompletion = onboarding.length
    ? avg(onboarding.map((o) => o.completion_pct))
    : 100;

  const areas: ReadinessArea[] = [
    {
      id: "asset",
      label: "Asset Health",
      score: assetHealth,
      icon: Activity,
      color: scoreColor(assetHealth),
      status: scoreStatus(assetHealth),
      items: [
        {
          label: "Assets monitored",
          value: `${assets.length}`,
          ok: assets.length > 0,
        },
        {
          label: "High-risk assets (risk ≥ 70)",
          value: `${highRiskAssets.length}`,
          ok: highRiskAssets.length === 0,
        },
        {
          label: "Assets in critical status",
          value: `${criticalStatusAssets.length}`,
          ok: criticalStatusAssets.length === 0,
        },
        {
          label: "Average risk score",
          value: assets.length
            ? `${avg(assets.map((a) => a.risk_score))}`
            : "—",
          ok: assets.length > 0 && avg(assets.map((a) => a.risk_score)) < 45,
        },
      ],
    },
    {
      id: "maintenance",
      label: "Maintenance Readiness",
      score: maintenanceReadiness,
      icon: CheckCircle,
      color: scoreColor(maintenanceReadiness),
      status: scoreStatus(maintenanceReadiness),
      items: [
        {
          label: "Open work orders",
          value: `${openWOs.length}`,
          ok: true,
        },
        {
          label: "Blocked work orders",
          value: `${blockedWOs.length}`,
          ok: blockedWOs.length === 0,
        },
        {
          label: "Past scheduled date",
          value: `${overdueWOs.length}`,
          ok: overdueWOs.length === 0,
        },
        {
          label: "Awaiting approval gate",
          value: `${approvalGatedWOs.length}`,
          ok: approvalGatedWOs.length === 0,
        },
      ],
    },
    {
      id: "parts",
      label: "Parts Availability",
      score: partsReadiness,
      icon: Package,
      color: scoreColor(partsReadiness),
      status: scoreStatus(partsReadiness),
      items: [
        {
          label: "Open WOs with parts ready",
          value: `${openWOs.filter((w) => w.parts_ready).length} of ${openWOs.length}`,
          ok: openWOs.length === 0 || openWOs.every((w) => w.parts_ready),
        },
        {
          label: "Open WOs awaiting parts",
          value: `${openWOs.filter((w) => !w.parts_ready).length}`,
          ok: openWOs.filter((w) => !w.parts_ready).length === 0,
        },
        {
          label: "Safety-flagged WOs awaiting parts",
          value: `${openWOs.filter((w) => w.safety_flag && !w.parts_ready).length}`,
          ok:
            openWOs.filter((w) => w.safety_flag && !w.parts_ready).length === 0,
        },
      ],
    },
    {
      id: "alerts",
      label: "Alert Posture",
      score: alertPosture,
      icon: Shield,
      color: scoreColor(alertPosture),
      status: scoreStatus(alertPosture),
      items: [
        {
          label: "Sensors in alarm",
          value: `${sensorsAlarm.length} of ${sensors.length}`,
          ok: sensorsAlarm.length === 0,
        },
        {
          label: "Sensors in warning",
          value: `${sensorsWarning.length}`,
          ok: sensorsWarning.length === 0,
        },
        {
          label: "Unresolved critical alerts",
          value: `${criticalAlerts.length}`,
          ok: criticalAlerts.length === 0,
        },
        {
          label: "Unresolved alerts (all)",
          value: `${alerts.length}`,
          ok: alerts.length === 0,
        },
      ],
    },
    {
      id: "ai-workforce",
      label: "AI Workforce",
      score: aiWorkforce,
      icon: Bot,
      color: scoreColor(aiWorkforce),
      status: scoreStatus(aiWorkforce),
      items: [
        {
          label: "Agents active",
          value: `${activeAgents.length} of ${agents.length}`,
          ok: agents.length > 0 && activeAgents.length === agents.length,
        },
        {
          label: "Average agent confidence",
          value: agents.length
            ? `${avg(agents.map((a) => a.confidence))}%`
            : "—",
          ok: agents.length > 0 && avg(agents.map((a) => a.confidence)) >= 80,
        },
        {
          label: "Recommendations pending review",
          value: `${pendingRecs.length}`,
          ok: pendingRecs.length === 0,
        },
        {
          label: "Approvals pending",
          value: `${pendingApprovals.length}`,
          ok: pendingApprovals.length === 0,
        },
      ],
    },
    {
      id: "onboarding",
      label: "Onboarding Completion",
      score: onboardingCompletion,
      icon: ClipboardCheck,
      color: scoreColor(onboardingCompletion),
      status: scoreStatus(onboardingCompletion),
      items: [
        {
          label: "Assets live",
          value: `${liveAssets} of ${onboarding.length}`,
          ok: onboarding.length > 0 && liveAssets === onboarding.length,
        },
        {
          label: "Ready for go-live",
          value: `${readyForGolive}`,
          ok: readyForGolive > 0 || liveAssets === onboarding.length,
        },
        {
          label: "Still in progress",
          value: `${onboarding.filter((o) => o.status === "in_progress").length}`,
          ok: onboarding.filter((o) => o.status === "in_progress").length === 0,
        },
        {
          label: "Human actions required",
          value: `${humanRequired}`,
          ok: humanRequired === 0,
        },
      ],
    },
  ];

  // Readiness gaps — assembled from real pending recommendations, blocked
  // work orders and unresolved critical alerts. No invented items.
  const gaps: ReadinessGap[] = [
    ...pendingRecs
      .filter((r) => r.urgency === "critical" || r.urgency === "action")
      .map((r) => ({
        issue: r.title,
        action: r.action ?? r.issue ?? "Review recommendation",
        owner: r.accountable ?? "Unassigned",
        urgency: (r.urgency === "critical" ? "red" : "amber") as
          | "red"
          | "amber",
      })),
    ...blockedWOs.map((w) => ({
      issue: `Work order ${w.wo_number ?? ""} blocked — ${w.title}`,
      action: "Resolve blocker and reschedule",
      owner: w.assignee ?? "Unassigned",
      urgency: (w.safety_flag ? "red" : "amber") as "red" | "amber",
    })),
    ...criticalAlerts.map((a) => ({
      issue: a.title ?? "Critical alert",
      action: a.description ?? "Investigate and resolve alert",
      owner: a.alert_type ? `${a.alert_type} monitoring` : "Operations",
      urgency: "red" as const,
    })),
  ]
    .sort((a, b) =>
      a.urgency === b.urgency ? 0 : a.urgency === "red" ? -1 : 1,
    )
    .slice(0, 8);

  const hasAnyData =
    assets.length > 0 ||
    workOrders.length > 0 ||
    agents.length > 0 ||
    sensors.length > 0 ||
    onboarding.length > 0;

  return { areas, gaps, hasAnyData };
}

/* -------------------------------------------------------------------------- */
/* Presentation                                                               */
/* -------------------------------------------------------------------------- */

const colorMap: Record<
  string,
  { text: string; bg: string; bar: string; ring: string }
> = {
  teal: {
    text: "text-teal-400",
    bg: "bg-teal-500/10",
    bar: "bg-teal-500",
    ring: "ring-teal-500/30",
  },
  blue: {
    text: "text-blue-400",
    bg: "bg-blue-500/10",
    bar: "bg-blue-500",
    ring: "ring-blue-500/30",
  },
  amber: {
    text: "text-amber-400",
    bg: "bg-amber-500/10",
    bar: "bg-amber-500",
    ring: "ring-amber-500/30",
  },
  green: {
    text: "text-green-400",
    bg: "bg-green-500/10",
    bar: "bg-green-500",
    ring: "ring-green-500/30",
  },
};

const statusColors: Record<string, string> = {
  Ready: "text-teal-400 bg-teal-500/10 border-teal-500/20",
  Watch: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  Caution: "text-amber-400 bg-amber-500/10 border-amber-500/30",
  Critical: "text-red-400 bg-red-500/10 border-red-500/20",
};

function ReadinessCard({ area }: { area: ReadinessArea }) {
  const [expanded, setExpanded] = useState(false);
  const Icon = area.icon;
  const c = colorMap[area.color];

  return (
    <motion.div
      layout
      className={`bg-[#0D1520] border border-white/[0.06] rounded-xl overflow-hidden cursor-pointer hover:border-white/[0.12] transition-colors`}
      onClick={() => setExpanded(!expanded)}
    >
      <div className="p-4">
        <div className="flex items-center gap-3 mb-3">
          <div
            className={`w-9 h-9 rounded-xl ${c.bg} flex items-center justify-center flex-shrink-0`}
          >
            <Icon className={`w-4 h-4 ${c.text}`} />
          </div>
          <div className="flex-1">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-200">
                {area.label}
              </span>
              <span
                className={`text-xs px-1.5 py-0.5 rounded-full border font-bold ${statusColors[area.status]}`}
              >
                {area.status}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <div className="flex-1 h-1.5 bg-white/[0.05] rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${area.score}%` }}
                  transition={{ duration: 0.8 }}
                  className={`h-full rounded-full ${c.bar}`}
                />
              </div>
              <span className={`text-sm font-black ${c.text}`}>
                {area.score}%
              </span>
            </div>
          </div>
        </div>

        {expanded && (
          <div className="pt-3 border-t border-white/[0.05] space-y-2">
            {area.items.map((item) => (
              <div
                key={item.label}
                className="flex items-center justify-between text-xs"
              >
                <span className="text-slate-400 flex items-center gap-1.5">
                  {item.ok ? (
                    <CheckCircle className="w-3 h-3 text-teal-400" />
                  ) : (
                    <AlertTriangle className="w-3 h-3 text-amber-400" />
                  )}
                  {item.label}
                </span>
                <span
                  className={`font-medium ${item.ok ? "text-teal-400" : "text-amber-400"}`}
                >
                  {item.value}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}

export function ReadinessPage() {
  const { data, loading, error, refetch } = useAsyncData(loadReadiness);

  if (loading) {
    return (
      <div className="p-6">
        <LoadingState label="Computing readiness from live operating data…" />
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
        <EmptyState message="No operating data yet — readiness connects once assets, work orders and agents are onboarded." />
      </div>
    );
  }

  const overallScore = Math.round(
    data.areas.reduce((acc, a) => acc + a.score, 0) / data.areas.length,
  );
  const statusLabel =
    overallScore >= 90 ? "Ready" : overallScore >= 75 ? "Watch" : "Caution";
  const statusColor =
    overallScore >= 90
      ? "text-teal-400"
      : overallScore >= 75
        ? "text-amber-400"
        : "text-red-400";

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-[11px] text-slate-400 mb-1">
            <Radio className="w-3 h-3 text-teal-400" />
            <span className="text-teal-400">LIVE</span>
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            Readiness
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Operational readiness computed from live assets, work orders,
            sensors and agents
          </p>
        </div>
        <div className="text-right">
          <div className={`text-4xl font-black ${statusColor}`}>
            {overallScore}%
          </div>
          <div className={`text-sm font-bold mt-1 ${statusColor}`}>
            {statusLabel}
          </div>
        </div>
      </div>

      {/* Readiness Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {data.areas.map((area, i) => (
          <motion.div
            key={area.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.07 }}
          >
            <ReadinessCard area={area} />
          </motion.div>
        ))}
      </div>

      {/* Readiness Gap Insights */}
      <div className="bg-[#0D1520] border border-white/[0.06] rounded-2xl p-5">
        <h3 className="text-sm font-semibold text-slate-200 mb-4 flex items-center gap-2">
          <Target className="w-4 h-4 text-teal-400" /> Readiness Gaps —
          Recommended Actions
        </h3>
        {data.gaps.length === 0 ? (
          <EmptyState message="No readiness gaps open — no pending critical recommendations, blocked work orders or unresolved critical alerts." />
        ) : (
          <div className="space-y-2">
            {data.gaps.map((gap, i) => (
              <div
                key={i}
                className={`flex items-start gap-3 p-3 rounded-xl border ${gap.urgency === "red" ? "border-red-500/20 bg-red-500/5" : "border-amber-500/20 bg-amber-500/5"}`}
              >
                <AlertTriangle
                  className={`w-4 h-4 flex-shrink-0 mt-0.5 ${gap.urgency === "red" ? "text-red-400" : "text-amber-400"}`}
                />
                <div className="flex-1">
                  <div className="text-xs font-semibold text-slate-200">
                    {gap.issue}
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    {gap.action}
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    Owner: {gap.owner}
                  </div>
                </div>
                <button className="text-teal-400 hover:text-teal-300 text-xs flex items-center gap-1 flex-shrink-0">
                  Act <ChevronRight className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
