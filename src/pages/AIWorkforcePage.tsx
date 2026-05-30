import { useState } from "react";
import { Bot, Activity, CircleCheck as CheckCircle, CircleAlert as AlertCircle, Clock, Zap, ChevronRight, Eye, Settings, TrendingUp, User, Shield, ChartBar as BarChart2, RefreshCw, Play, Pause } from "lucide-react";
import { motion } from "framer-motion";

type AutonomyMode = "Human-Led" | "Human-in-the-Loop" | "Autonomous";
type AgentStatus = "active" | "idle" | "processing" | "waiting";

interface Agent {
  id: string;
  name: string;
  purpose: string;
  status: AgentStatus;
  autonomyMode: AutonomyMode;
  currentTask: string;
  recommendationsGenerated: number;
  actionsExecuted: number;
  approvalRequired: boolean;
  confidence: number;
  supervisor: string;
  lastAction: string;
  icon: React.ElementType;
}

const agents: Agent[] = [
  {
    id: "msd",
    name: "Maintenance Strategy Development",
    purpose: "Develops and optimizes maintenance strategies using RCM principles",
    status: "active",
    autonomyMode: "Human-in-the-Loop",
    currentTask: "Reviewing PM strategy for Conveyor C-22",
    recommendationsGenerated: 34,
    actionsExecuted: 12,
    approvalRequired: true,
    confidence: 89,
    supervisor: "Reliability Manager",
    lastAction: "Updated PM frequency for Pump P-101 bearings",
    icon: Settings,
  },
  {
    id: "ama",
    name: "Asset Management",
    purpose: "Manages asset lifecycle, criticality ranking, and replacement planning",
    status: "processing",
    autonomyMode: "Human-in-the-Loop",
    currentTask: "Analyzing asset health scores across 487 assets",
    recommendationsGenerated: 21,
    actionsExecuted: 8,
    approvalRequired: false,
    confidence: 92,
    supervisor: "Asset Manager",
    lastAction: "Flagged Heat Exchanger HX-08 for condition assessment",
    icon: BarChart2,
  },
  {
    id: "rea",
    name: "Reliability Engineering",
    purpose: "Conducts RCA, FMEA, and identifies bad actors for elimination",
    status: "active",
    autonomyMode: "Human-in-the-Loop",
    currentTask: "Completing RCA for Conveyor C-22 bearing failure",
    recommendationsGenerated: 18,
    actionsExecuted: 6,
    approvalRequired: true,
    confidence: 87,
    supervisor: "Reliability Engineer",
    lastAction: "Identified root cause: inadequate lubrication schedule",
    icon: TrendingUp,
  },
  {
    id: "psa",
    name: "Planning & Scheduling",
    purpose: "Optimizes work order scheduling and resource allocation",
    status: "active",
    autonomyMode: "Autonomous",
    currentTask: "Optimizing 2-week rolling schedule",
    recommendationsGenerated: 56,
    actionsExecuted: 41,
    approvalRequired: false,
    confidence: 94,
    supervisor: "Maintenance Planner",
    lastAction: "Rescheduled 3 PMs to avoid production conflict",
    icon: Clock,
  },
  {
    id: "woma",
    name: "Work Order Management",
    purpose: "Creates, prioritizes, and tracks work orders autonomously",
    status: "processing",
    autonomyMode: "Autonomous",
    currentTask: "Creating 4 inspection work orders from sensor alerts",
    recommendationsGenerated: 89,
    actionsExecuted: 77,
    approvalRequired: false,
    confidence: 96,
    supervisor: "Maintenance Supervisor",
    lastAction: "Auto-created WO #4821 for Pump P-101 seal inspection",
    icon: CheckCircle,
  },
  {
    id: "cma",
    name: "Condition Monitoring",
    purpose: "Analyzes sensor data and detects anomalies before failure",
    status: "active",
    autonomyMode: "Autonomous",
    currentTask: "Monitoring 1,240 sensor channels in real time",
    recommendationsGenerated: 142,
    actionsExecuted: 98,
    approvalRequired: false,
    confidence: 91,
    supervisor: "Reliability Engineer",
    lastAction: "Detected vibration anomaly on Conveyor C-22",
    icon: Activity,
  },
  {
    id: "ima",
    name: "Inventory Management",
    purpose: "Manages spare parts, reorder points, and critical spares strategy",
    status: "idle",
    autonomyMode: "Human-in-the-Loop",
    currentTask: "Monitoring reorder levels",
    recommendationsGenerated: 14,
    actionsExecuted: 9,
    approvalRequired: true,
    confidence: 85,
    supervisor: "Storeroom Manager",
    lastAction: "Created PO for Pump P-101 seal kit ($4,200)",
    icon: Zap,
  },
  {
    id: "moa",
    name: "Maintenance Operations",
    purpose: "Coordinates field execution, technician assignments, and field feedback",
    status: "active",
    autonomyMode: "Human-Led",
    currentTask: "Tracking 8 active work orders in the field",
    recommendationsGenerated: 28,
    actionsExecuted: 0,
    approvalRequired: true,
    confidence: 88,
    supervisor: "Maintenance Supervisor",
    lastAction: "Assigned WO #4819 to Technician J. Morrison",
    icon: User,
  },
  {
    id: "qaa",
    name: "Quality Assurance",
    purpose: "Validates work quality, inspections, and maintenance standards",
    status: "idle",
    autonomyMode: "Human-Led",
    currentTask: "No active tasks",
    recommendationsGenerated: 7,
    actionsExecuted: 2,
    approvalRequired: true,
    confidence: 82,
    supervisor: "QA Manager",
    lastAction: "Reviewed inspection report for Heat Exchanger HX-08",
    icon: CheckCircle,
  },
  {
    id: "caa",
    name: "Compliance & Auditing",
    purpose: "Ensures regulatory compliance, audit readiness, and documentation",
    status: "active",
    autonomyMode: "Human-in-the-Loop",
    currentTask: "Monitoring critical control compliance",
    recommendationsGenerated: 11,
    actionsExecuted: 4,
    approvalRequired: false,
    confidence: 97,
    supervisor: "HSE Manager",
    lastAction: "Verified critical control documentation up to date",
    icon: Shield,
  },
  {
    id: "esga",
    name: "Sustainability & ESG",
    purpose: "Tracks emissions, energy, and sustainability KPIs for ESG reporting",
    status: "idle",
    autonomyMode: "Human-Led",
    currentTask: "No active tasks",
    recommendationsGenerated: 5,
    actionsExecuted: 1,
    approvalRequired: true,
    confidence: 79,
    supervisor: "Sustainability Officer",
    lastAction: "Generated monthly ESG maintenance performance report",
    icon: RefreshCw,
  },
  {
    id: "daa",
    name: "Data Analytics",
    purpose: "Performs advanced analytics, pattern recognition, and trend analysis",
    status: "processing",
    autonomyMode: "Autonomous",
    currentTask: "Running failure pattern analysis across 5-year dataset",
    recommendationsGenerated: 67,
    actionsExecuted: 45,
    approvalRequired: false,
    confidence: 93,
    supervisor: "Data Engineer",
    lastAction: "Identified correlation between high ambient temp and K-05 failures",
    icon: BarChart2,
  },
  {
    id: "cia",
    name: "Continuous Improvement",
    purpose: "Identifies improvement opportunities, tracks lessons learned, and optimizes processes",
    status: "active",
    autonomyMode: "Human-in-the-Loop",
    currentTask: "Analyzing PM effectiveness scores",
    recommendationsGenerated: 23,
    actionsExecuted: 11,
    approvalRequired: true,
    confidence: 84,
    supervisor: "Reliability Manager",
    lastAction: "Recommended PM interval change for Conveyor drive assemblies",
    icon: TrendingUp,
  },
  {
    id: "twa",
    name: "Training & Workforce",
    purpose: "Manages technician competency, training needs, and knowledge transfer",
    status: "idle",
    autonomyMode: "Human-Led",
    currentTask: "No active tasks",
    recommendationsGenerated: 4,
    actionsExecuted: 0,
    approvalRequired: true,
    confidence: 76,
    supervisor: "Training Manager",
    lastAction: "Identified training gap for vibration analysis",
    icon: User,
  },
  {
    id: "fca",
    name: "Financial & Contract",
    purpose: "Analyzes maintenance costs, contractor performance, and budget optimization",
    status: "active",
    autonomyMode: "Human-in-the-Loop",
    currentTask: "Calculating cost-per-repair for Q1 review",
    recommendationsGenerated: 16,
    actionsExecuted: 5,
    approvalRequired: true,
    confidence: 88,
    supervisor: "Finance Manager",
    lastAction: "Flagged contractor invoice discrepancy — $12,400 variance",
    icon: BarChart2,
  },
];

const statusConfig: Record<AgentStatus, { label: string; color: string; bg: string; dot: string; icon: React.ElementType }> = {
  active: { label: "Active", color: "text-teal-400", bg: "bg-teal-500/10", dot: "bg-teal-400", icon: Play },
  processing: { label: "Processing", color: "text-blue-400", bg: "bg-blue-500/10", dot: "bg-blue-400", icon: RefreshCw },
  idle: { label: "Idle", color: "text-slate-500", bg: "bg-slate-500/10", dot: "bg-slate-600", icon: Pause },
  waiting: { label: "Waiting Approval", color: "text-amber-400", bg: "bg-amber-500/10", dot: "bg-amber-400", icon: Clock },
};

const autonomyColors: Record<AutonomyMode, string> = {
  "Human-Led": "text-slate-400 bg-slate-500/10 border-slate-500/20",
  "Human-in-the-Loop": "text-amber-400 bg-amber-500/10 border-amber-500/20",
  "Autonomous": "text-teal-400 bg-teal-500/10 border-teal-500/20",
};

function AgentCard({ agent }: { agent: Agent }) {
  const [expanded, setExpanded] = useState(false);
  const Icon = agent.icon;
  const status = statusConfig[agent.status];
  const StatusIcon = status.icon;

  return (
    <motion.div
      layout
      className={`bg-[#0D1520] border border-white/[0.06] rounded-xl overflow-hidden hover:border-white/[0.12] transition-colors cursor-pointer`}
      onClick={() => setExpanded(!expanded)}
    >
      <div className="p-4">
        <div className="flex items-start gap-3">
          {/* Icon */}
          <div className={`w-9 h-9 rounded-xl ${status.bg} flex items-center justify-center flex-shrink-0`}>
            <Icon className={`w-4 h-4 ${status.color}`} />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-slate-200 leading-tight">{agent.name}</h3>
                <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">{agent.purpose}</p>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <div className={`w-1.5 h-1.5 rounded-full ${status.dot} ${agent.status === "processing" ? "animate-pulse" : ""}`} />
                <StatusIcon className={`w-3 h-3 ${status.color}`} />
              </div>
            </div>

            {/* Current Task */}
            <div className="mt-2 text-[11px] text-slate-400 bg-white/[0.03] rounded-lg px-2 py-1.5 border border-white/[0.04]">
              {agent.currentTask}
            </div>

            {/* Stats Row */}
            <div className="mt-3 flex items-center gap-4">
              <div className="text-center">
                <div className="text-sm font-bold text-slate-200">{agent.recommendationsGenerated}</div>
                <div className="text-[10px] text-slate-600">Recs</div>
              </div>
              <div className="text-center">
                <div className="text-sm font-bold text-slate-200">{agent.actionsExecuted}</div>
                <div className="text-[10px] text-slate-600">Actions</div>
              </div>
              <div className="text-center">
                <div className="text-sm font-bold text-slate-200">{agent.confidence}%</div>
                <div className="text-[10px] text-slate-600">Confidence</div>
              </div>
              <div className={`ml-auto px-2 py-0.5 rounded-full border text-[10px] font-semibold ${autonomyColors[agent.autonomyMode]}`}>
                {agent.autonomyMode}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Expanded */}
      <motion.div
        initial={false}
        animate={{ height: expanded ? "auto" : 0, opacity: expanded ? 1 : 0 }}
        transition={{ duration: 0.2 }}
        style={{ overflow: "hidden" }}
      >
        <div className="px-4 pb-4 border-t border-white/[0.05] pt-3 space-y-2">
          <div className="text-[11px] text-slate-400">
            <span className="text-slate-600">Last action: </span>{agent.lastAction}
          </div>
          <div className="text-[11px] text-slate-400">
            <span className="text-slate-600">Supervisor: </span>{agent.supervisor}
          </div>
          {agent.approvalRequired && (
            <div className="flex items-center gap-1.5 text-[11px] text-amber-400">
              <AlertCircle className="w-3 h-3" />
              Approval required for next action
            </div>
          )}
          <div className="flex gap-2 mt-3">
            <button className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-500/10 border border-teal-500/20 text-teal-400 text-xs rounded-lg hover:bg-teal-500/20 transition-colors">
              <Eye className="w-3 h-3" /> Audit Trail
            </button>
            <button className="flex items-center gap-1.5 px-3 py-1.5 bg-white/[0.04] border border-white/[0.08] text-slate-400 text-xs rounded-lg hover:bg-white/[0.08] transition-colors">
              <Settings className="w-3 h-3" /> Configure
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

export function AIWorkforce() {
  const [filter, setFilter] = useState<"all" | AgentStatus>("all");
  const [autonomyFilter, setAutonomyFilter] = useState<"all" | AutonomyMode>("all");

  const filtered = agents.filter((a) => {
    const statusMatch = filter === "all" || a.status === filter;
    const autonomyMatch = autonomyFilter === "all" || a.autonomyMode === autonomyFilter;
    return statusMatch && autonomyMatch;
  });

  const counts = {
    active: agents.filter((a) => a.status === "active").length,
    processing: agents.filter((a) => a.status === "processing").length,
    idle: agents.filter((a) => a.status === "idle").length,
    total: agents.length,
    autonomous: agents.filter((a) => a.autonomyMode === "Autonomous").length,
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">AI Workforce</h1>
          <p className="text-sm text-slate-500 mt-0.5">15 specialized agents · Your digital M&R department</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-500/10 border border-teal-500/20 rounded-lg text-xs text-teal-400 font-medium">
            <div className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-pulse" />
            {counts.active + counts.processing} Active
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-white/[0.04] border border-white/[0.08] rounded-lg text-xs text-slate-400">
            {counts.autonomous} Autonomous
          </div>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: "Total Agents", value: counts.total, color: "slate" },
          { label: "Active", value: counts.active, color: "teal" },
          { label: "Processing", value: counts.processing, color: "blue" },
          { label: "Idle", value: counts.idle, color: "slate" },
          { label: "Autonomous", value: counts.autonomous, color: "teal" },
        ].map((s) => (
          <div key={s.label} className="bg-[#0D1520] border border-white/[0.06] rounded-xl p-3 text-center">
            <div className={`text-xl font-black ${s.color === "teal" ? "text-teal-400" : s.color === "blue" ? "text-blue-400" : "text-slate-300"}`}>
              {s.value}
            </div>
            <div className="text-[10px] text-slate-600 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-slate-600">Status:</span>
        {(["all", "active", "processing", "idle"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              filter === f
                ? "bg-teal-500/20 text-teal-400 border border-teal-500/30"
                : "bg-white/[0.03] border border-white/[0.06] text-slate-500 hover:text-slate-300"
            }`}
          >
            {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
        <span className="text-xs text-slate-600 ml-4">Autonomy:</span>
        {(["all", "Human-Led", "Human-in-the-Loop", "Autonomous"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setAutonomyFilter(f)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              autonomyFilter === f
                ? "bg-teal-500/20 text-teal-400 border border-teal-500/30"
                : "bg-white/[0.03] border border-white/[0.06] text-slate-500 hover:text-slate-300"
            }`}
          >
            {f === "all" ? "All" : f}
          </button>
        ))}
      </div>

      {/* Agent Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filtered.map((agent, i) => (
          <motion.div
            key={agent.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04 }}
          >
            <AgentCard agent={agent} />
          </motion.div>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-16 text-slate-600">
          <Bot className="w-10 h-10 mx-auto mb-3 opacity-50" />
          <p className="text-sm">No agents match the selected filters</p>
        </div>
      )}

      {/* Workforce Summary Note */}
      <div className="bg-[#0D1520] border border-teal-500/20 rounded-xl p-4 flex items-start gap-3">
        <Zap className="w-4 h-4 text-teal-400 flex-shrink-0 mt-0.5" />
        <div>
          <div className="text-sm font-medium text-teal-400">AI Workforce Active</div>
          <p className="text-xs text-slate-400 mt-1 leading-relaxed">
            SyncAI's 15 specialized agents are operating as your digital Maintenance & Reliability department.
            Together they have generated <span className="text-slate-200 font-semibold">445 recommendations</span> and executed{" "}
            <span className="text-slate-200 font-semibold">319 actions</span> this period.
            Human oversight is maintained via the Approval Queue and Decision Governance module.
          </p>
        </div>
      </div>
    </div>
  );
}
