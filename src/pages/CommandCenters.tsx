import { useState } from "react";
import { Users, Target, Wrench, Calendar, Shield, HardHat, Settings, Bot, TrendingUp, TriangleAlert as AlertTriangle, CircleCheck as CheckCircle, Clock, DollarSign, Activity, ChartBar as BarChart2, ChevronRight, Zap, ArrowUpRight } from "lucide-react";
import { motion } from "framer-motion";

type CommandCenterId =
  | "executive"
  | "asset"
  | "reliability"
  | "maintenance"
  | "planning"
  | "operations"
  | "hse"
  | "technician"
  | "ai-admin";

interface CommandCenter {
  id: CommandCenterId;
  name: string;
  role: string;
  icon: React.ElementType;
  color: string;
  description: string;
  kpis: { label: string; value: string; trend: "up" | "down" | "stable"; unit?: string }[];
  alerts: { text: string; level: "critical" | "action" | "advisory" }[];
  actions: string[];
}

const commandCenters: CommandCenter[] = [
  {
    id: "executive",
    name: "Executive Command Center",
    role: "C-Suite / Senior Leadership",
    icon: Target,
    color: "teal",
    description: "Enterprise mission readiness, financial exposure, and strategic risk overview.",
    kpis: [
      { label: "Mission Readiness", value: "87%", trend: "up" },
      { label: "Asset Availability", value: "94.2%", trend: "up" },
      { label: "Maintenance Cost / RAV", value: "3.1%", trend: "down" },
      { label: "Downtime Exposure", value: "$4.8M", trend: "down" },
      { label: "AI Actions Executed", value: "142", trend: "up" },
      { label: "Autonomous Rate", value: "68%", trend: "up" },
    ],
    alerts: [
      { text: "Conveyor C-22 poses $2.4M downtime risk — action within 36 hours", level: "critical" },
      { text: "Parts availability at 76% — 4 critical spares below reorder point", level: "action" },
    ],
    actions: ["View Mission Readiness Report", "Approve Capital Request", "Review AI Performance"],
  },
  {
    id: "asset",
    name: "Asset Management Command Center",
    role: "Asset Manager / Lifecycle Manager",
    icon: Settings,
    color: "blue",
    description: "Asset health, lifecycle status, criticality rankings, and replacement planning.",
    kpis: [
      { label: "Assets Monitored", value: "487", trend: "stable" },
      { label: "Critical Assets", value: "62", trend: "stable" },
      { label: "Asset Health Score", value: "91%", trend: "up" },
      { label: "Overdue Inspections", value: "8", trend: "down" },
      { label: "End-of-Life Assets", value: "14", trend: "stable" },
      { label: "Digital Twin Coverage", value: "34%", trend: "up" },
    ],
    alerts: [
      { text: "Heat Exchanger HX-08 approaching end-of-useful-life", level: "advisory" },
      { text: "8 assets overdue for mandatory inspection", level: "action" },
    ],
    actions: ["Review Asset Registry", "Approve Replacement Plan", "Update Criticality Rankings"],
  },
  {
    id: "reliability",
    name: "Reliability Command Center",
    role: "Reliability Engineer / RCM Specialist",
    icon: TrendingUp,
    color: "teal",
    description: "Bad actors, failure analysis, PM strategy, and reliability growth tracking.",
    kpis: [
      { label: "MTBF (Fleet)", value: "2,847 hr", trend: "up" },
      { label: "MTTR (Fleet)", value: "4.2 hr", trend: "down" },
      { label: "Bad Actors", value: "7", trend: "down" },
      { label: "Open RCAs", value: "3", trend: "stable" },
      { label: "PM Effectiveness", value: "83%", trend: "up" },
      { label: "Repeated Failures", value: "4", trend: "down" },
    ],
    alerts: [
      { text: "Conveyor C-22 is a bad actor — 4th bearing failure in 12 months", level: "critical" },
      { text: "RCA for Pump P-101 overdue by 3 days", level: "action" },
    ],
    actions: ["Open RCA Workflow", "Review Bad Actor List", "Update FMEA"],
  },
  {
    id: "maintenance",
    name: "Maintenance Command Center",
    role: "Maintenance Manager / Supervisor",
    icon: Wrench,
    color: "amber",
    description: "Work order execution, backlog management, and maintenance team performance.",
    kpis: [
      { label: "Open Work Orders", value: "34", trend: "stable" },
      { label: "Overdue WOs", value: "6", trend: "down" },
      { label: "PM Compliance", value: "88%", trend: "up" },
      { label: "Emergency Work %", value: "12%", trend: "down" },
      { label: "Backlog Hours", value: "218 hr", trend: "down" },
      { label: "Schedule Compliance", value: "79%", trend: "up" },
    ],
    alerts: [
      { text: "6 work orders overdue — risk of safety non-compliance", level: "action" },
      { text: "Emergency work % trending upward — investigate root cause", level: "advisory" },
    ],
    actions: ["View Work Board", "Assign Technicians", "Approve Overtime"],
  },
  {
    id: "planning",
    name: "Planning & Scheduling Command Center",
    role: "Planner / Scheduler",
    icon: Calendar,
    color: "blue",
    description: "2-week rolling schedule, resource loading, parts readiness, and schedule optimization.",
    kpis: [
      { label: "Scheduled WOs", value: "18", trend: "stable" },
      { label: "Parts Ready", value: "76%", trend: "down" },
      { label: "Resource Loading", value: "91%", trend: "up" },
      { label: "Schedule Compliance", value: "79%", trend: "up" },
      { label: "Awaiting Parts", value: "5 WOs", trend: "stable" },
      { label: "AI-Planned WOs", value: "11", trend: "up" },
    ],
    alerts: [
      { text: "5 work orders blocked — parts not yet received", level: "action" },
      { text: "Resource loading at 91% — consider contractor support", level: "advisory" },
    ],
    actions: ["View 2-Week Schedule", "Identify Parts Gaps", "Optimize Schedule"],
  },
  {
    id: "operations",
    name: "Operations Command Center",
    role: "Operations Manager / Shift Supervisor",
    icon: Activity,
    color: "teal",
    description: "Production impact, equipment availability, and operations/maintenance interface.",
    kpis: [
      { label: "Production Availability", value: "96.1%", trend: "up" },
      { label: "Planned Downtime", value: "4.2 hr", trend: "stable" },
      { label: "Unplanned Downtime", value: "1.8 hr", trend: "down" },
      { label: "OEE", value: "81.4%", trend: "up" },
      { label: "Critical Deferrals", value: "2", trend: "stable" },
      { label: "Maintenance Requests", value: "9", trend: "stable" },
    ],
    alerts: [
      { text: "Conveyor C-22 PM deferral increases risk to production plan", level: "critical" },
      { text: "2 maintenance requests awaiting Operations approval", level: "action" },
    ],
    actions: ["Approve Deferrals", "View Production Impact", "Release Equipment"],
  },
  {
    id: "hse",
    name: "HSE / Compliance Command Center",
    role: "HSE Manager / Safety Officer",
    icon: Shield,
    color: "green",
    description: "Critical control compliance, safety work orders, regulatory status, and incident tracking.",
    kpis: [
      { label: "Critical Controls Compliant", value: "98%", trend: "up" },
      { label: "Overdue Safety WOs", value: "2", trend: "down" },
      { label: "Open Safety Actions", value: "7", trend: "stable" },
      { label: "LOTO Compliance", value: "100%", trend: "stable" },
      { label: "Inspections Due", value: "4", trend: "stable" },
      { label: "Regulatory Actions", value: "1", trend: "stable" },
    ],
    alerts: [
      { text: "2 safety-critical work orders overdue — immediate attention required", level: "critical" },
      { text: "Regulatory inspection due in 14 days — documentation review needed", level: "action" },
    ],
    actions: ["Review Safety WOs", "Audit Critical Controls", "Generate Compliance Report"],
  },
  {
    id: "technician",
    name: "Technician Command Center",
    role: "Maintenance Technician / Field Technician",
    icon: HardHat,
    color: "amber",
    description: "My assigned work orders, step-by-step job instructions, parts, and safety requirements.",
    kpis: [
      { label: "My Open WOs", value: "4", trend: "stable" },
      { label: "Due Today", value: "2", trend: "stable" },
      { label: "Parts Ready", value: "3 of 4", trend: "stable" },
      { label: "Overdue", value: "0", trend: "stable" },
      { label: "Completed Today", value: "1", trend: "up" },
      { label: "Approvals Needed", value: "0", trend: "stable" },
    ],
    alerts: [
      { text: "WO #4821 — Pump P-101 seal inspection due by 14:00 today", level: "action" },
      { text: "Parts for WO #4823 not yet picked from storeroom", level: "advisory" },
    ],
    actions: ["Start WO #4821", "View Job Instructions", "Record Readings"],
  },
  {
    id: "ai-admin",
    name: "AI Admin Command Center",
    role: "AI Administrator / System Admin",
    icon: Bot,
    color: "teal",
    description: "Agent performance, autonomy configuration, model health, and system governance.",
    kpis: [
      { label: "Agents Online", value: "15/15", trend: "stable" },
      { label: "Actions Executed", value: "142", trend: "up" },
      { label: "Avg Confidence", value: "88%", trend: "up" },
      { label: "False Positives", value: "3%", trend: "down" },
      { label: "Autonomy Rate", value: "68%", trend: "up" },
      { label: "Human Overrides", value: "4", trend: "down" },
    ],
    alerts: [
      { text: "Condition Monitoring agent confidence dropped 4% — review sensor data quality", level: "advisory" },
      { text: "4 human overrides this week — review for model improvement", level: "advisory" },
    ],
    actions: ["Configure Autonomy", "Review Agent Logs", "Tune Thresholds"],
  },
];

const colorMap: Record<string, { card: string; badge: string; text: string; icon: string }> = {
  teal: { card: "border-teal-500/20 hover:border-teal-500/40", badge: "bg-teal-500/10 text-teal-400", text: "text-teal-400", icon: "bg-teal-500/10" },
  blue: { card: "border-blue-500/20 hover:border-blue-500/40", badge: "bg-blue-500/10 text-blue-400", text: "text-blue-400", icon: "bg-blue-500/10" },
  amber: { card: "border-amber-500/20 hover:border-amber-500/40", badge: "bg-amber-500/10 text-amber-400", text: "text-amber-400", icon: "bg-amber-500/10" },
  green: { card: "border-green-500/20 hover:border-green-500/40", badge: "bg-green-500/10 text-green-400", text: "text-green-400", icon: "bg-green-500/10" },
};

const alertColors = {
  critical: "text-red-400 bg-red-500/10 border-red-500/20",
  action: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  advisory: "text-blue-400 bg-blue-500/10 border-blue-500/20",
};

function CommandCenterCard({ cc, onOpen }: { cc: CommandCenter; onOpen: (id: CommandCenterId) => void }) {
  const Icon = cc.icon;
  const c = colorMap[cc.color];
  const criticalAlert = cc.alerts.find((a) => a.level === "critical");

  return (
    <motion.div
      className={`bg-[#0D1520] border ${c.card} rounded-2xl p-5 cursor-pointer transition-all group`}
      whileHover={{ y: -2 }}
      onClick={() => onOpen(cc.id)}
    >
      <div className="flex items-start gap-3 mb-4">
        <div className={`w-10 h-10 rounded-xl ${c.icon} flex items-center justify-center flex-shrink-0`}>
          <Icon className={`w-5 h-5 ${c.text}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-200 leading-tight">{cc.name}</h3>
            <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-teal-400 transition-colors" />
          </div>
          <div className={`text-[10px] font-semibold mt-0.5 ${c.text}`}>{cc.role}</div>
        </div>
      </div>

      <p className="text-xs text-slate-500 mb-4 leading-relaxed">{cc.description}</p>

      {/* KPI Grid */}
      <div className="grid grid-cols-2 gap-2 mb-4">
        {cc.kpis.slice(0, 4).map((kpi) => (
          <div key={kpi.label} className="bg-white/[0.02] rounded-lg p-2">
            <div className="text-[10px] text-slate-600 truncate">{kpi.label}</div>
            <div className="flex items-center gap-1 mt-0.5">
              <span className="text-sm font-bold text-slate-200">{kpi.value}</span>
              {kpi.trend === "up" && <TrendingUp className="w-2.5 h-2.5 text-teal-400" />}
              {kpi.trend === "down" && <ArrowUpRight className="w-2.5 h-2.5 text-amber-400 rotate-180" />}
            </div>
          </div>
        ))}
      </div>

      {/* Critical Alert */}
      {criticalAlert && (
        <div className={`text-[11px] px-2.5 py-2 rounded-lg border ${alertColors[criticalAlert.level]} mb-3`}>
          <AlertTriangle className="w-3 h-3 inline mr-1" />
          {criticalAlert.text}
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-1.5">
        {cc.actions.slice(0, 2).map((action) => (
          <span key={action} className="text-[10px] px-2 py-1 bg-white/[0.03] border border-white/[0.06] rounded-full text-slate-500">
            {action}
          </span>
        ))}
      </div>
    </motion.div>
  );
}

function CommandCenterDetail({ cc, onBack }: { cc: CommandCenter; onBack: () => void }) {
  const Icon = cc.icon;
  const c = colorMap[cc.color];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="text-slate-500 hover:text-slate-200 transition-colors text-xs flex items-center gap-1">
          <ChevronRight className="w-3 h-3 rotate-180" /> Command Centers
        </button>
        <ChevronRight className="w-3 h-3 text-slate-700" />
        <span className="text-xs text-slate-400">{cc.name}</span>
      </div>

      <div className="flex items-start gap-4">
        <div className={`w-12 h-12 rounded-xl ${c.icon} flex items-center justify-center flex-shrink-0`}>
          <Icon className={`w-6 h-6 ${c.text}`} />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">{cc.name}</h1>
          <div className={`text-sm font-semibold mt-0.5 ${c.text}`}>{cc.role}</div>
          <p className="text-sm text-slate-500 mt-1">{cc.description}</p>
        </div>
      </div>

      {/* All KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {cc.kpis.map((kpi) => (
          <div key={kpi.label} className="bg-[#0D1520] border border-white/[0.06] rounded-xl p-3 text-center">
            <div className="text-[10px] text-slate-600">{kpi.label}</div>
            <div className={`text-xl font-black mt-1 ${c.text}`}>{kpi.value}</div>
            <div className="flex items-center justify-center gap-1 mt-1">
              {kpi.trend === "up" && <TrendingUp className="w-3 h-3 text-teal-400" />}
              {kpi.trend === "down" && <ArrowUpRight className="w-3 h-3 text-amber-400 rotate-180" />}
              {kpi.trend === "stable" && <BarChart2 className="w-3 h-3 text-slate-600" />}
            </div>
          </div>
        ))}
      </div>

      {/* Alerts */}
      <div className="bg-[#0D1520] border border-white/[0.06] rounded-xl p-5">
        <h3 className="text-sm font-semibold text-slate-200 mb-3 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-400" /> Active Alerts
        </h3>
        <div className="space-y-2">
          {cc.alerts.map((alert, i) => (
            <div key={i} className={`flex items-start gap-2.5 p-3 rounded-lg border ${alertColors[alert.level]} text-xs`}>
              <div className={`w-1.5 h-1.5 rounded-full mt-0.5 flex-shrink-0 ${alert.level === "critical" ? "bg-red-500" : alert.level === "action" ? "bg-amber-500" : "bg-blue-400"}`} />
              {alert.text}
            </div>
          ))}
        </div>
      </div>

      {/* Recommended Actions */}
      <div className="bg-[#0D1520] border border-white/[0.06] rounded-xl p-5">
        <h3 className="text-sm font-semibold text-slate-200 mb-3 flex items-center gap-2">
          <Zap className="w-4 h-4 text-teal-400" /> Recommended Actions
        </h3>
        <div className="space-y-2">
          {cc.actions.map((action) => (
            <button key={action} className="w-full flex items-center gap-3 px-4 py-3 bg-white/[0.03] border border-white/[0.06] rounded-lg text-sm text-slate-300 hover:bg-white/[0.06] hover:text-white transition-colors text-left">
              <CheckCircle className="w-4 h-4 text-teal-400 flex-shrink-0" />
              {action}
              <ChevronRight className="w-3.5 h-3.5 text-slate-600 ml-auto" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function CommandCenters() {
  const [selected, setSelected] = useState<CommandCenterId | null>(null);

  const selectedCC = commandCenters.find((cc) => cc.id === selected);

  return (
    <div className="p-6 space-y-6">
      {!selectedCC ? (
        <>
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight">Command Centers</h1>
            <p className="text-sm text-slate-500 mt-0.5">Role-based intelligence views — select your command center</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {commandCenters.map((cc, i) => (
              <motion.div key={cc.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}>
                <CommandCenterCard cc={cc} onOpen={(id) => setSelected(id)} />
              </motion.div>
            ))}
          </div>

          {/* RACI Note */}
          <div className="bg-[#0D1520] border border-white/[0.06] rounded-xl p-4 flex items-start gap-3">
            <Users className="w-4 h-4 text-teal-400 flex-shrink-0 mt-0.5" />
            <div>
              <div className="text-sm font-medium text-teal-400">RACI-Aware Interface</div>
              <p className="text-xs text-slate-400 mt-1">
                Each command center adapts to your role, decision authority, and RACI responsibility.
                Every KPI, recommendation, and alert identifies who is Accountable, Responsible, Consulted, and Informed.
              </p>
            </div>
          </div>
        </>
      ) : (
        <CommandCenterDetail cc={selectedCC} onBack={() => setSelected(null)} />
      )}
    </div>
  );
}
