import { useState } from "react";
import {
  Sun,
  Clock,
  Zap,
  TrendingUp,
  Users,
  Wrench,
  Shield,
  ChevronRight,
  Radio,
  Calendar,
  Target,
} from "lucide-react";
import { motion } from "framer-motion";

type BriefingType = "shift" | "daily" | "weekly" | "executive";

interface BriefingCard {
  id: string;
  type: BriefingType;
  title: string;
  time: string;
  audience: string;
  status: "live" | "upcoming" | "completed";
  highlights: string[];
  kpiSummary: { label: string; value: string; trend: string; up: boolean }[];
}

const briefings: BriefingCard[] = [
  {
    id: "sb-day",
    type: "shift",
    title: "Day Shift Handover Brief",
    time: "06:00 — Starts in 23 min",
    audience: "Maintenance, Operations, Supervisors",
    status: "upcoming",
    highlights: [
      "Conveyor C-22 intervention scheduled for 08:00 — PM advanced per AI recommendation",
      "Pump P-101 seal kit arriving today — plan installation during next window",
      "Compressor K-05 monitoring elevated — no action required yet",
      "2 technicians on leave — resource adjusted in planner",
    ],
    kpiSummary: [
      { label: "Mission Readiness", value: "87%", trend: "+2", up: true },
      { label: "Open Work Orders", value: "34", trend: "-3", up: true },
      { label: "Pending Approvals", value: "7", trend: "+2", up: false },
      { label: "Safety Incidents", value: "0", trend: "0", up: true },
    ],
  },
  {
    id: "di-today",
    type: "daily",
    title: "Daily Intelligence Brief",
    time: "07:30 — Auto-generated",
    audience: "Site Leadership, Reliability, Planning",
    status: "live",
    highlights: [
      "Overall asset availability 94.2% (target 97%) — driven by unplanned downtime on Crusher line",
      "AI detected 3 new anomalies overnight — 1 critical, 2 advisory",
      "Parts delivery delayed for valve actuator — ETA revised to Thursday",
      "Weekly PM compliance trending at 88% — 2 overdue PMs need scheduling",
      "Cost exposure: $2.4M active risk from top 4 assets under watch",
    ],
    kpiSummary: [
      { label: "Availability", value: "94.2%", trend: "+0.4%", up: true },
      { label: "OEE", value: "81.4%", trend: "+1.2%", up: true },
      { label: "MTTR", value: "4.2 hr", trend: "-0.8", up: true },
      { label: "AI Confidence", value: "88%", trend: "+2%", up: true },
    ],
  },
  {
    id: "wk-review",
    type: "weekly",
    title: "Weekly Reliability Review",
    time: "Monday 09:00 — Last: May 27",
    audience: "Reliability Engineers, Maintenance Managers",
    status: "completed",
    highlights: [
      "MTBF improved 142 hr fleet-wide — driven by PM optimization on conveyor class",
      "3 RCAs closed this week with verified corrective actions",
      "Bad actor list updated — Pump P-201 promoted to watch list",
      "Learning loop acceptance rate at 84% (+4% WoW)",
    ],
    kpiSummary: [
      { label: "MTBF", value: "2,847 hr", trend: "+142", up: true },
      { label: "PM Effectiveness", value: "72%", trend: "+5%", up: true },
      { label: "Repeat Failures", value: "2", trend: "-1", up: true },
      { label: "RCAs Closed", value: "3", trend: "+1", up: true },
    ],
  },
  {
    id: "ex-monthly",
    type: "executive",
    title: "Executive Asset Health Summary",
    time: "1st of Month — Next: Jun 1",
    audience: "VP Operations, CFO, Site Directors",
    status: "upcoming",
    highlights: [
      "Total maintenance spend: $4.2M (budget: $4.8M) — 12% under budget",
      "Downtime cost avoided by AI: $6.8M (verified savings)",
      "Autonomous action rate reached 68% — up from 52% last month",
      "3 capital replacements deferred through condition-based strategies",
    ],
    kpiSummary: [
      { label: "Savings (MTD)", value: "$6.8M", trend: "+$1.2M", up: true },
      { label: "Budget Var", value: "-12%", trend: "improved", up: true },
      { label: "Autonomous Rate", value: "68%", trend: "+16%", up: true },
      { label: "Risk Exposure", value: "$4.5M", trend: "-$0.8M", up: true },
    ],
  },
];

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
  upcoming: {
    color: "text-amber-400",
    bg: "bg-amber-500/10",
    dot: "bg-amber-400",
    label: "Upcoming",
  },
  completed: {
    color: "text-slate-400",
    bg: "bg-slate-500/10",
    dot: "bg-slate-400",
    label: "Completed",
  },
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
                  className={`text-[10px] font-bold uppercase tracking-wider ${tc.color}`}
                >
                  {tc.label}
                </span>
                <div
                  className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full ${sc.bg}`}
                >
                  <div className={`w-1.5 h-1.5 rounded-full ${sc.dot}`} />
                  <span className={`text-[10px] font-semibold ${sc.color}`}>
                    {sc.label}
                  </span>
                </div>
              </div>
              <h3 className="text-base font-bold text-white">
                {briefing.title}
              </h3>
              <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
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
            className={`w-4 h-4 text-slate-600 transition-transform flex-shrink-0 mt-2 ${expanded ? "rotate-90" : ""}`}
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
                <div className="text-[10px] text-slate-500">{kpi.label}</div>
                <div className="text-lg font-black text-slate-200 mt-0.5">
                  {kpi.value}
                </div>
                <div
                  className={`text-[10px] mt-0.5 flex items-center gap-1 ${kpi.up ? "text-teal-400" : "text-amber-400"}`}
                >
                  <TrendingUp className="w-2.5 h-2.5" />
                  {kpi.trend}
                </div>
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
                    highlight.toLowerCase().includes("risk")
                      ? "bg-amber-400"
                      : "bg-teal-400"
                  }`}
                />
                <span className="leading-relaxed">{highlight}</span>
              </div>
            ))}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 mt-4 pt-4 border-t border-white/[0.06]">
            {briefing.status === "live" && (
              <button className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-500/20 border border-teal-500/30 text-teal-400 text-xs font-medium rounded-lg hover:bg-teal-500/30 transition-colors">
                <Radio className="w-3 h-3" /> View Live Brief
              </button>
            )}
            {briefing.status === "upcoming" && (
              <button className="flex items-center gap-1.5 px-3 py-1.5 bg-white/[0.04] border border-white/[0.08] text-slate-400 text-xs font-medium rounded-lg hover:bg-white/[0.08] transition-colors">
                <Clock className="w-3 h-3" /> Set Reminder
              </button>
            )}
            <button className="flex items-center gap-1.5 px-3 py-1.5 bg-white/[0.04] border border-white/[0.08] text-slate-400 text-xs font-medium rounded-lg hover:bg-white/[0.08] transition-colors">
              View Full Report
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

export function OperationalBriefing() {
  const [filter, setFilter] = useState<BriefingType | "all">("all");
  const filtered =
    filter === "all" ? briefings : briefings.filter((b) => b.type === filter);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            Operational Briefing
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            AI-generated briefings aligned to operational cadence
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-500/10 border border-teal-500/20 rounded-lg text-xs text-teal-400 font-medium">
            <Radio className="w-3.5 h-3.5 animate-pulse" />1 Active Brief
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

      {/* Cadence Overview */}
      <div className="bg-[#0D1520] border border-white/[0.06] rounded-2xl p-5">
        <h3 className="text-sm font-semibold text-slate-200 mb-3 flex items-center gap-2">
          <Calendar className="w-4 h-4 text-teal-400" /> Operational Cadence
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            {
              label: "Shift Handover",
              frequency: "Every 8 hours",
              next: "06:00 today",
              icon: Sun,
              color: "amber",
            },
            {
              label: "Daily Intelligence",
              frequency: "Daily at 07:30",
              next: "07:30 today",
              icon: Zap,
              color: "teal",
            },
            {
              label: "Weekly Reliability",
              frequency: "Monday 09:00",
              next: "Jun 2",
              icon: Wrench,
              color: "blue",
            },
            {
              label: "Executive Summary",
              frequency: "1st of month",
              next: "Jun 1",
              icon: Shield,
              color: "cyan",
            },
          ].map((c) => {
            const CIcon = c.icon;
            return (
              <div
                key={c.label}
                className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.05]"
              >
                <CIcon className={`w-4 h-4 text-${c.color}-400 mb-2`} />
                <div className="text-xs font-semibold text-slate-200">
                  {c.label}
                </div>
                <div className="text-[10px] text-slate-500 mt-0.5">
                  {c.frequency}
                </div>
                <div className="text-[10px] text-slate-600 mt-0.5">
                  Next: {c.next}
                </div>
              </div>
            );
          })}
        </div>
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
            AI-Generated Briefings
          </div>
          <p className="text-xs text-slate-400 mt-1 leading-relaxed">
            All briefings are automatically generated by SyncAI based on
            real-time system data, overnight events, and predictive analytics.
            Content is tailored to the audience role and operational context.
          </p>
        </div>
      </div>
    </div>
  );
}
