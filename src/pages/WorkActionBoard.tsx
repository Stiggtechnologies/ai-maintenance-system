import { useState } from "react";
import { TrendingUp, TrendingDown, TriangleAlert as AlertTriangle, CircleCheck as CheckCircle, Activity, ChevronRight, ChartBar as BarChart2, Zap, Search, Filter, Plus, Clock, User, Package, ArrowUpRight, Bot } from "lucide-react";
import { motion } from "framer-motion";

type WorkStatus = "pending" | "in_progress" | "blocked" | "scheduled" | "critical" | "approval" | "completed";
type WorkPriority = "critical" | "high" | "medium" | "low";

interface WorkItem {
  id: string;
  woNumber: string;
  title: string;
  asset: string;
  area: string;
  status: WorkStatus;
  priority: WorkPriority;
  type: "ai_generated" | "human_created";
  assignee?: string;
  scheduledDate: string;
  estimatedHours: number;
  partsReady: boolean;
  riskScore: number;
  financialExposure: string;
  productionImpact: "High" | "Medium" | "Low" | "None";
  safetyFlag: boolean;
  approvalRequired: boolean;
  description: string;
}

const workItems: WorkItem[] = [
  {
    id: "wo1",
    woNumber: "WO-4821",
    title: "Pump P-101 seal inspection & replacement",
    asset: "Pump P-101",
    area: "Cooling Circuit",
    status: "critical",
    priority: "critical",
    type: "ai_generated",
    assignee: "J. Morrison",
    scheduledDate: "2026-05-30",
    estimatedHours: 6,
    partsReady: true,
    riskScore: 81,
    financialExposure: "$1.1M",
    productionImpact: "High",
    safetyFlag: true,
    approvalRequired: false,
    description: "AI-detected seal degradation. Replace mechanical seal — all parts staged.",
  },
  {
    id: "wo2",
    woNumber: "WO-4822",
    title: "Conveyor C-22 bearing replacement",
    asset: "Conveyor C-22",
    area: "Processing Plant A",
    status: "approval",
    priority: "critical",
    type: "ai_generated",
    scheduledDate: "2026-05-31",
    estimatedHours: 8,
    partsReady: true,
    riskScore: 94,
    financialExposure: "$2.4M",
    productionImpact: "High",
    safetyFlag: false,
    approvalRequired: true,
    description: "Vibration-triggered PM advancement. Bearing replacement required.",
  },
  {
    id: "wo3",
    woNumber: "WO-4815",
    title: "Monthly PM — Compressor K-05",
    asset: "Compressor K-05",
    area: "Gas Handling",
    status: "scheduled",
    priority: "high",
    type: "human_created",
    assignee: "K. Patel",
    scheduledDate: "2026-06-04",
    estimatedHours: 4,
    partsReady: true,
    riskScore: 68,
    financialExposure: "$680K",
    productionImpact: "Medium",
    safetyFlag: true,
    approvalRequired: false,
    description: "Scheduled quarterly compression PM. Filters and oil change.",
  },
  {
    id: "wo4",
    woNumber: "WO-4818",
    title: "Heat Exchanger HX-08 tube cleaning",
    asset: "Heat Exchanger HX-08",
    area: "Utility Block",
    status: "blocked",
    priority: "medium",
    type: "human_created",
    scheduledDate: "2026-05-30",
    estimatedHours: 12,
    partsReady: false,
    riskScore: 42,
    financialExposure: "$290K",
    productionImpact: "Low",
    safetyFlag: false,
    approvalRequired: false,
    description: "Thermal efficiency degradation. Blocked — cleaning chemicals not in stock.",
  },
  {
    id: "wo5",
    woNumber: "WO-4819",
    title: "Motor M-14 thermal scan & inspection",
    asset: "Motor M-14",
    area: "Production Line 2",
    status: "in_progress",
    priority: "medium",
    type: "ai_generated",
    assignee: "T. Johnson",
    scheduledDate: "2026-05-30",
    estimatedHours: 2,
    partsReady: true,
    riskScore: 36,
    financialExposure: "$210K",
    productionImpact: "Medium",
    safetyFlag: false,
    approvalRequired: false,
    description: "Thermal anomaly detected. Inspect cooling fan and check winding resistance.",
  },
  {
    id: "wo6",
    woNumber: "WO-4820",
    title: "Valve V-33 walk-down inspection",
    asset: "Valve V-33",
    area: "Water Treatment",
    status: "scheduled",
    priority: "low",
    type: "ai_generated",
    scheduledDate: "2026-06-07",
    estimatedHours: 1,
    partsReady: true,
    riskScore: 21,
    financialExposure: "$85K",
    productionImpact: "None",
    safetyFlag: false,
    approvalRequired: false,
    description: "Routine inspection — minor leak reported. Include in area walkdown.",
  },
  {
    id: "wo7",
    woNumber: "WO-4816",
    title: "Safety-critical PSV test — Site A",
    asset: "Pressure Safety Valve PSV-01",
    area: "Process Plant",
    status: "critical",
    priority: "critical",
    type: "human_created",
    scheduledDate: "2026-05-30",
    estimatedHours: 3,
    partsReady: true,
    riskScore: 89,
    financialExposure: "Safety Critical",
    productionImpact: "High",
    safetyFlag: true,
    approvalRequired: false,
    description: "Mandatory regulatory PSV test — 6 months overdue. Safety non-compliance risk.",
  },
];

const statusConfig: Record<WorkStatus, { label: string; color: string; bg: string; border: string; dot: string }> = {
  critical: { label: "Critical", color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/30", dot: "bg-red-500" },
  approval: { label: "Awaiting Approval", color: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/30", dot: "bg-amber-500" },
  in_progress: { label: "In Progress", color: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/20", dot: "bg-blue-400" },
  scheduled: { label: "Scheduled", color: "text-teal-400", bg: "bg-teal-500/10", border: "border-teal-500/20", dot: "bg-teal-400" },
  blocked: { label: "Blocked", color: "text-slate-400", bg: "bg-slate-500/10", border: "border-slate-500/20", dot: "bg-slate-500" },
  pending: { label: "Pending", color: "text-slate-400", bg: "bg-slate-500/10", border: "border-slate-500/20", dot: "bg-slate-500" },
  completed: { label: "Completed", color: "text-green-400", bg: "bg-green-500/10", border: "border-green-500/20", dot: "bg-green-400" },
};

const priorityColors: Record<WorkPriority, string> = {
  critical: "text-red-400",
  high: "text-amber-400",
  medium: "text-blue-400",
  low: "text-slate-500",
};

function WorkCard({ item }: { item: WorkItem }) {
  const [expanded, setExpanded] = useState(false);
  const status = statusConfig[item.status];

  return (
    <motion.div
      layout
      className={`bg-[#0D1520] border ${status.border} rounded-xl overflow-hidden cursor-pointer`}
      onClick={() => setExpanded(!expanded)}
    >
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 mt-1">
            <div className={`w-2 h-2 rounded-full ${status.dot} ${item.status === "in_progress" ? "animate-pulse" : ""}`} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-slate-500 font-mono">{item.woNumber}</span>
                {item.type === "ai_generated" && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 flex items-center gap-1">
                    <Bot className="w-2.5 h-2.5" /> AI
                  </span>
                )}
                {item.safetyFlag && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20">
                    Safety
                  </span>
                )}
              </div>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${status.bg} ${status.color} border ${status.border}`}>
                {status.label}
              </span>
            </div>
            <h4 className="text-sm font-semibold text-slate-200 mt-1">{item.title}</h4>
            <div className="text-[11px] text-slate-500 mt-0.5">{item.asset} · {item.area}</div>
            <div className="flex items-center gap-3 mt-2 text-xs flex-wrap">
              <span className={`font-bold ${priorityColors[item.priority]} capitalize`}>{item.priority}</span>
              <span className="text-slate-600">·</span>
              <span className="text-slate-500">{item.scheduledDate}</span>
              <span className="text-slate-600">·</span>
              <span className="text-slate-500">{item.estimatedHours}h estimated</span>
              {item.assignee && (
                <>
                  <span className="text-slate-600">·</span>
                  <span className="flex items-center gap-1 text-slate-400"><User className="w-3 h-3" />{item.assignee}</span>
                </>
              )}
              <span className={`ml-auto flex items-center gap-1 ${item.partsReady ? "text-teal-400" : "text-amber-400"}`}>
                <Package className="w-3 h-3" />
                {item.partsReady ? "Parts Ready" : "Parts Needed"}
              </span>
            </div>

            {expanded && (
              <div className="mt-3 pt-3 border-t border-white/[0.05] space-y-2">
                <div className="text-xs text-slate-400">{item.description}</div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div><span className="text-slate-600">Financial Exposure: </span><span className={`font-bold ${priorityColors[item.priority]}`}>{item.financialExposure}</span></div>
                  <div><span className="text-slate-600">Production Impact: </span><span className="text-slate-300">{item.productionImpact}</span></div>
                  <div><span className="text-slate-600">Risk Score: </span><span className="text-slate-300">{item.riskScore}/100</span></div>
                  <div><span className="text-slate-600">Approval Required: </span><span className="text-slate-300">{item.approvalRequired ? "Yes" : "No"}</span></div>
                </div>
                <div className="flex gap-2 mt-2">
                  {item.approvalRequired ? (
                    <button className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-500/20 border border-teal-500/30 text-teal-400 text-xs font-medium rounded-lg hover:bg-teal-500/30 transition-colors">
                      <CheckCircle className="w-3 h-3" /> Approve
                    </button>
                  ) : (
                    <button className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-500/20 border border-teal-500/30 text-teal-400 text-xs font-medium rounded-lg hover:bg-teal-500/30 transition-colors">
                      <ArrowUpRight className="w-3 h-3" /> Open WO
                    </button>
                  )}
                  <button className="flex items-center gap-1.5 px-3 py-1.5 bg-white/[0.04] border border-white/[0.08] text-slate-400 text-xs rounded-lg hover:bg-white/[0.08] transition-colors">
                    <User className="w-3 h-3" /> Assign
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

export function WorkActionBoard() {
  const [filter, setFilter] = useState<"all" | WorkStatus>("all");
  const [sortBy, setSortBy] = useState<"risk" | "date" | "priority">("risk");
  const [search, setSearch] = useState("");

  const filtered = workItems
    .filter((w) => filter === "all" || w.status === filter)
    .filter((w) => !search || w.title.toLowerCase().includes(search.toLowerCase()) || w.asset.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (sortBy === "risk") return b.riskScore - a.riskScore;
      if (sortBy === "priority") {
        const order: Record<WorkPriority, number> = { critical: 0, high: 1, medium: 2, low: 3 };
        return order[a.priority] - order[b.priority];
      }
      return a.scheduledDate.localeCompare(b.scheduledDate);
    });

  const counts = {
    critical: workItems.filter((w) => w.status === "critical" || w.priority === "critical").length,
    approval: workItems.filter((w) => w.status === "approval").length,
    blocked: workItems.filter((w) => w.status === "blocked").length,
    aiGenerated: workItems.filter((w) => w.type === "ai_generated").length,
    total: workItems.length,
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Work Action Board</h1>
          <p className="text-sm text-slate-500 mt-0.5">Ranked by risk, consequence, and mission impact</p>
        </div>
        <button className="px-4 py-2 bg-teal-500/20 border border-teal-500/30 rounded-lg text-xs text-teal-400 font-medium hover:bg-teal-500/30 transition-colors flex items-center gap-1.5">
          <Plus className="w-3.5 h-3.5" /> New Work Order
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: "Total Work", value: counts.total, color: "slate" },
          { label: "Critical / Safety", value: counts.critical, color: "red" },
          { label: "Awaiting Approval", value: counts.approval, color: "amber" },
          { label: "Blocked", value: counts.blocked, color: "slate" },
          { label: "AI Generated", value: counts.aiGenerated, color: "blue" },
        ].map((s) => {
          const c: Record<string, string> = { red: "text-red-400", amber: "text-amber-400", blue: "text-blue-400", slate: "text-slate-300" };
          return (
            <div key={s.label} className="bg-[#0D1520] border border-white/[0.06] rounded-xl p-3 text-center">
              <div className={`text-xl font-black ${c[s.color]}`}>{s.value}</div>
              <div className="text-[10px] text-slate-600 mt-0.5">{s.label}</div>
            </div>
          );
        })}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-600" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search work orders..."
            className="w-full pl-8 pr-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-lg text-xs text-slate-300 placeholder-slate-600 outline-none focus:border-teal-500/40"
          />
        </div>

        <div className="flex items-center gap-1">
          {(["all", "critical", "approval", "in_progress", "blocked", "scheduled"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2.5 py-1 rounded-lg text-[11px] transition-colors ${
                filter === f
                  ? "bg-teal-500/20 text-teal-400 border border-teal-500/30"
                  : "bg-white/[0.02] border border-white/[0.06] text-slate-500 hover:text-slate-300"
              }`}
            >
              {f === "all" ? "All" : f.replace("_", " ").charAt(0).toUpperCase() + f.replace("_", " ").slice(1)}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 ml-auto">
          <span className="text-[11px] text-slate-600">Sort:</span>
          {(["risk", "priority", "date"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSortBy(s)}
              className={`px-2.5 py-1 rounded-lg text-[11px] transition-colors ${sortBy === s ? "bg-teal-500/20 text-teal-400 border border-teal-500/30" : "bg-white/[0.02] border border-white/[0.06] text-slate-500"}`}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Work List */}
      <div className="space-y-3">
        {filtered.map((item, i) => (
          <motion.div key={item.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
            <WorkCard item={item} />
          </motion.div>
        ))}
        {filtered.length === 0 && (
          <div className="text-center py-16 text-slate-600">
            <Activity className="w-10 h-10 mx-auto mb-3 opacity-50" />
            <p className="text-sm">No work orders match the current filters</p>
          </div>
        )}
      </div>

      {/* AI Note */}
      <div className="bg-[#0D1520] border border-teal-500/20 rounded-xl p-4 flex items-start gap-3">
        <Zap className="w-4 h-4 text-teal-400 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-slate-400 leading-relaxed">
          Work is ranked by <span className="text-slate-200">risk score, consequence, and mission impact</span> — not work order number or date created.
          <span className="text-teal-400 font-medium"> {counts.aiGenerated} of {counts.total} work orders</span> were generated autonomously by SyncAI agents.
        </p>
      </div>
    </div>
  );
}
