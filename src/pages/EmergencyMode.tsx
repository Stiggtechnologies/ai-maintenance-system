import { useState } from "react";
import {
  TriangleAlert as AlertTriangle,
  Radio,
  Shield,
  Clock,
  Users,
  Activity,
  Phone,
  CircleCheck as CheckCircle,
  Target,
} from "lucide-react";
import { motion } from "framer-motion";
import { supabase } from "../lib/supabase";
import { useAsyncData } from "../hooks/useAsyncData";
import { LoadingState } from "../components/ui/AsyncStates";

interface CriticalAlert {
  id: string;
  title: string | null;
  description: string | null;
  created_at: string;
}

async function getActiveCriticalAlerts(): Promise<CriticalAlert[]> {
  const { data, error } = await supabase
    .from("system_alerts")
    .select("id,title,description,created_at")
    .eq("severity", "critical")
    .eq("resolved", false)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data as CriticalAlert[]) ?? [];
}

type IncidentSeverity = "critical" | "major" | "moderate";

interface ActiveIncident {
  id: string;
  title: string;
  severity: IncidentSeverity;
  startTime: string;
  elapsed: string;
  affectedAssets: string[];
  missionImpact: string;
  status: string;
  owner: string;
  escalationLevel: number;
}

const activeIncident: ActiveIncident = {
  id: "INC-2026-0847",
  title: "Critical Bearing Failure — Conveyor C-22 Drive Assembly",
  severity: "major",
  startTime: "2026-05-30 04:12 UTC",
  elapsed: "2h 18min",
  affectedAssets: [
    "Conveyor C-22",
    "Crusher Feed System",
    "Processing Plant Line 2",
  ],
  missionImpact: "Line 2 production halted — $180K/hr exposure",
  status: "Active — Recovery in progress",
  owner: "Maintenance Manager",
  escalationLevel: 2,
};

const timeline = [
  {
    time: "04:12",
    event: "Vibration alarm triggered — Drive End bearing",
    type: "detection",
    agent: "Condition Monitoring",
  },
  {
    time: "04:13",
    event: "AI confirmed failure signature — 97% confidence",
    type: "analysis",
    agent: "Reliability Engineering",
  },
  {
    time: "04:14",
    event: "Emergency work order created automatically",
    type: "action",
    agent: "Work Order Management",
  },
  {
    time: "04:15",
    event: "Maintenance Manager notified (escalation level 1)",
    type: "escalation",
    agent: "System",
  },
  {
    time: "04:18",
    event: "Conveyor shut down — safety interlock activated",
    type: "safety",
    agent: "Operations",
  },
  {
    time: "04:22",
    event: "Parts availability confirmed — bearing kit in warehouse",
    type: "logistics",
    agent: "Inventory Management",
  },
  {
    time: "04:25",
    event: "Technician dispatched — ETA 35 min",
    type: "action",
    agent: "Maintenance Operations",
  },
  {
    time: "04:45",
    event: "Operations Manager notified (escalation level 2)",
    type: "escalation",
    agent: "System",
  },
  {
    time: "05:00",
    event: "Technician on-site — assessment in progress",
    type: "action",
    agent: "Technician",
  },
  {
    time: "05:30",
    event: "Bearing replacement initiated — est. completion 07:30",
    type: "action",
    agent: "Technician",
  },
];

const recoverySteps = [
  { step: "Bearing replacement", status: "in_progress", eta: "07:30" },
  { step: "Alignment verification", status: "pending", eta: "07:45" },
  { step: "Run-in test (30 min)", status: "pending", eta: "08:15" },
  { step: "Vibration baseline check", status: "pending", eta: "08:30" },
  { step: "Return to service authorization", status: "pending", eta: "08:45" },
];

const criticalControls = [
  { control: "LOTO verified", status: true },
  { control: "Isolation confirmed", status: true },
  { control: "JSA completed", status: true },
  { control: "Spotter assigned", status: true },
  { control: "Rescue plan current", status: true },
];

const severityConfig: Record<
  IncidentSeverity,
  { color: string; bg: string; border: string; label: string }
> = {
  critical: {
    color: "text-red-400",
    bg: "bg-red-500/10",
    border: "border-red-500/30",
    label: "CRITICAL",
  },
  major: {
    color: "text-amber-400",
    bg: "bg-amber-500/10",
    border: "border-amber-500/30",
    label: "MAJOR",
  },
  moderate: {
    color: "text-blue-400",
    bg: "bg-blue-500/10",
    border: "border-blue-500/20",
    label: "MODERATE",
  },
};

const typeColors: Record<string, string> = {
  detection: "bg-red-500",
  analysis: "bg-blue-500",
  action: "bg-teal-500",
  escalation: "bg-amber-500",
  safety: "bg-red-500",
  logistics: "bg-cyan-500",
};

export function EmergencyMode() {
  const [showAllTimeline, setShowAllTimeline] = useState(false);
  const { data: alerts, loading } = useAsyncData<CriticalAlert[]>(
    () => getActiveCriticalAlerts(),
    [],
  );

  if (loading) return <LoadingState label="Checking for active incidents…" />;

  if (!alerts || alerts.length === 0) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold text-white tracking-tight">
          Emergency Mode
        </h1>
        <p className="text-sm text-slate-400 mt-0.5 mb-6">
          Incident command view — activates automatically when a critical system
          alert is raised.
        </p>
        <div className="bg-[#0D1520] border border-teal-500/20 rounded-2xl p-10 text-center">
          <div className="text-teal-400 text-lg font-semibold">
            No active incidents
          </div>
          <p className="text-sm text-slate-400 mt-2 max-w-md mx-auto">
            All critical alerts are resolved. When an unresolved critical alert
            exists, this view becomes the incident command center with timeline,
            affected assets, and recovery tracking.
          </p>
        </div>
      </div>
    );
  }

  // Bind headline to the real alert; the recovery template below structures the response.
  activeIncident.title = alerts[0].title ?? activeIncident.title;
  activeIncident.id = `ALERT-${alerts[0].id.slice(0, 8)}`;
  activeIncident.startTime = new Date(alerts[0].created_at).toLocaleString();

  const sc = severityConfig[activeIncident.severity];
  const visibleTimeline = showAllTimeline ? timeline : timeline.slice(-6);

  return (
    <div className="p-6 space-y-6">
      {/* Emergency Header */}
      <div className="bg-gradient-to-r from-red-500/10 via-amber-500/5 to-transparent border border-red-500/20 rounded-2xl p-5">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-xl bg-red-500/20 animate-pulse">
              <AlertTriangle className="w-6 h-6 text-red-400" />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span
                  className={`text-xs font-black uppercase tracking-wider ${sc.color}`}
                >
                  {sc.label} INCIDENT
                </span>
                <span className="text-xs text-slate-400 font-mono">
                  {activeIncident.id}
                </span>
              </div>
              <h1 className="text-xl font-bold text-white">
                {activeIncident.title}
              </h1>
              <p className="text-sm text-red-300 mt-1">
                {activeIncident.missionImpact}
              </p>
              <div className="flex items-center gap-4 mt-3 text-xs text-slate-400">
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" /> Started:{" "}
                  {activeIncident.startTime}
                </span>
                <span className="flex items-center gap-1">
                  <Activity className="w-3 h-3 text-amber-400" /> Elapsed:{" "}
                  {activeIncident.elapsed}
                </span>
                <span className="flex items-center gap-1">
                  <Users className="w-3 h-3" /> Owner: {activeIncident.owner}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div
              className={`px-3 py-1.5 rounded-lg ${sc.bg} ${sc.border} border`}
            >
              <span className={`text-xs font-bold ${sc.color}`}>
                Escalation Level {activeIncident.escalationLevel}
              </span>
            </div>
            <button className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/20 border border-red-500/30 text-red-400 text-xs font-bold rounded-lg">
              <Phone className="w-3 h-3" /> Escalate
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Timeline */}
        <div className="lg:col-span-2 bg-[#0D1520] border border-white/[0.06] rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
              <Radio className="w-4 h-4 text-teal-400 animate-pulse" /> Live
              Event Timeline
            </h3>
            <button
              onClick={() => setShowAllTimeline(!showAllTimeline)}
              className="text-[11px] text-teal-400 hover:text-teal-300"
            >
              {showAllTimeline ? "Show Recent" : "Show All"}
            </button>
          </div>
          <div className="space-y-3">
            {visibleTimeline.map((event, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.04 }}
                className="flex items-start gap-3"
              >
                <div className="flex flex-col items-center flex-shrink-0">
                  <div
                    className={`w-2.5 h-2.5 rounded-full ${typeColors[event.type] || "bg-slate-500"}`}
                  />
                  {i < visibleTimeline.length - 1 && (
                    <div className="w-px h-8 bg-white/[0.06] mt-1" />
                  )}
                </div>
                <div className="flex-1 min-w-0 pb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-slate-400">
                      {event.time}
                    </span>
                    <span className="text-xs px-1.5 py-0.5 rounded-full bg-white/[0.04] text-slate-400">
                      {event.agent}
                    </span>
                  </div>
                  <p className="text-sm text-slate-200 mt-0.5">{event.event}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>

        {/* Right Panel */}
        <div className="space-y-4">
          {/* Affected Assets */}
          <div className="bg-[#0D1520] border border-white/[0.06] rounded-2xl p-5">
            <h3 className="text-sm font-semibold text-slate-200 mb-3">
              Affected Assets
            </h3>
            <div className="space-y-2">
              {activeIncident.affectedAssets.map((asset, i) => (
                <div
                  key={asset}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/5 border border-red-500/10"
                >
                  <div className="w-1.5 h-1.5 rounded-full bg-red-400" />
                  <span className="text-xs text-slate-200">{asset}</span>
                  {i === 0 && (
                    <span className="ml-auto text-xs text-red-400 font-bold">
                      Primary
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Critical Controls */}
          <div className="bg-[#0D1520] border border-white/[0.06] rounded-2xl p-5">
            <h3 className="text-sm font-semibold text-slate-200 mb-3 flex items-center gap-2">
              <Shield className="w-4 h-4 text-green-400" /> Critical Controls
            </h3>
            <div className="space-y-2">
              {criticalControls.map((ctrl) => (
                <div key={ctrl.control} className="flex items-center gap-2">
                  <CheckCircle
                    className={`w-3.5 h-3.5 ${ctrl.status ? "text-green-400" : "text-red-400"}`}
                  />
                  <span className="text-xs text-slate-300">{ctrl.control}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Recovery Plan */}
          <div className="bg-[#0D1520] border border-white/[0.06] rounded-2xl p-5">
            <h3 className="text-sm font-semibold text-slate-200 mb-3 flex items-center gap-2">
              <Target className="w-4 h-4 text-teal-400" /> Recovery Plan
            </h3>
            <div className="space-y-2">
              {recoverySteps.map((step, i) => (
                <div
                  key={step.step}
                  className="flex items-center gap-3 text-xs"
                >
                  <div
                    className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${
                      step.status === "in_progress"
                        ? "bg-teal-500/20 text-teal-400 ring-1 ring-teal-500/40"
                        : step.status === "completed"
                          ? "bg-green-500/20 text-green-400"
                          : "bg-white/[0.05] text-slate-400"
                    }`}
                  >
                    {i + 1}
                  </div>
                  <span
                    className={`flex-1 ${step.status === "in_progress" ? "text-teal-400 font-medium" : "text-slate-400"}`}
                  >
                    {step.step}
                  </span>
                  <span className="text-slate-400 font-mono">{step.eta}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 pt-3 border-t border-white/[0.06] text-xs text-slate-400">
              Estimated return to service: 08:45 UTC
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
