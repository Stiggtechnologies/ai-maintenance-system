import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CircleCheck as CheckCircle,
  Activity,
  Zap,
  Search,
  Plus,
  User,
  Package,
  ArrowUpRight,
  Bot,
} from "lucide-react";
import { motion } from "framer-motion";
import { useOnboardingOperatingLoop } from "../hooks/useOnboardingOperatingLoop";
import type { DerivedWorkAction } from "../services/onboardingOperatingLoop";
import { useAsyncData } from "../hooks/useAsyncData";
import { useRealtimeRefetch } from "../hooks/useRealtimeRefetch";
import { LiveBadge } from "../components/ui/LiveBadge";
import {
  getWorkOrders,
  approveWorkOrder,
  assignWorkOrder,
  createHumanWorkOrder,
} from "../services/operatingLoopService";
import type { WorkOrderRow } from "../types/operating";
import { LoadingState, ErrorState } from "../components/ui/AsyncStates";

const WORK_STATUSES: WorkStatus[] = [
  "pending",
  "in_progress",
  "blocked",
  "scheduled",
  "critical",
  "approval",
  "completed",
];

function workOrderRowToItem(row: WorkOrderRow): WorkItem {
  const status = (
    WORK_STATUSES.includes(row.status as WorkStatus) ? row.status : "pending"
  ) as WorkStatus;
  const priority = (
    ["critical", "high", "medium", "low"].includes(row.priority)
      ? row.priority
      : "medium"
  ) as WorkPriority;
  const impact = (
    ["High", "Medium", "Low", "None"].includes(row.production_impact)
      ? row.production_impact
      : "Low"
  ) as WorkItem["productionImpact"];
  return {
    id: row.id,
    woNumber: row.wo_number ?? "WO-—",
    title: row.title,
    asset: row.asset?.name ?? "—",
    area: row.asset?.area ?? "—",
    status,
    priority,
    type: row.type === "human_created" ? "human_created" : "ai_generated",
    assignee: row.assignee ?? undefined,
    scheduledDate: row.scheduled_date ?? "Unscheduled",
    estimatedHours: Number(row.estimated_hours),
    partsReady: row.parts_ready,
    riskScore: row.risk_score,
    financialExposure: row.financial_exposure ?? "—",
    productionImpact: impact,
    safetyFlag: row.safety_flag,
    approvalRequired: row.approval_required,
    description: row.description ?? "",
  };
}

type WorkStatus =
  | "pending"
  | "in_progress"
  | "blocked"
  | "scheduled"
  | "critical"
  | "approval"
  | "completed";
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

const PRODUCTION_IMPACT_BY_PRIORITY: Record<
  WorkPriority,
  WorkItem["productionImpact"]
> = {
  critical: "High",
  high: "High",
  medium: "Medium",
  low: "Low",
};

function derivedWorkActionToItem(action: DerivedWorkAction): WorkItem {
  return {
    id: action.id,
    woNumber: action.woNumber,
    title: action.title,
    asset: action.asset,
    area: action.area,
    status: action.status,
    priority: action.priority,
    type: "ai_generated",
    scheduledDate: "Unscheduled",
    estimatedHours: 0,
    partsReady: false,
    riskScore: action.riskScore,
    financialExposure: "Baseline pending",
    productionImpact: PRODUCTION_IMPACT_BY_PRIORITY[action.priority],
    safetyFlag: action.safetyFlag,
    approvalRequired: action.approvalRequired,
    description: action.description,
  };
}

const statusConfig: Record<
  WorkStatus,
  { label: string; color: string; bg: string; border: string; dot: string }
> = {
  critical: {
    label: "Critical",
    color: "text-red-400",
    bg: "bg-red-500/10",
    border: "border-red-500/30",
    dot: "bg-red-500",
  },
  approval: {
    label: "Awaiting Approval",
    color: "text-amber-400",
    bg: "bg-amber-500/10",
    border: "border-amber-500/30",
    dot: "bg-amber-500",
  },
  in_progress: {
    label: "In Progress",
    color: "text-blue-400",
    bg: "bg-blue-500/10",
    border: "border-blue-500/20",
    dot: "bg-blue-400",
  },
  scheduled: {
    label: "Scheduled",
    color: "text-teal-400",
    bg: "bg-teal-500/10",
    border: "border-teal-500/20",
    dot: "bg-teal-400",
  },
  blocked: {
    label: "Blocked",
    color: "text-slate-400",
    bg: "bg-slate-500/10",
    border: "border-slate-500/20",
    dot: "bg-slate-500",
  },
  pending: {
    label: "Pending",
    color: "text-slate-400",
    bg: "bg-slate-500/10",
    border: "border-slate-500/20",
    dot: "bg-slate-500",
  },
  completed: {
    label: "Completed",
    color: "text-green-400",
    bg: "bg-green-500/10",
    border: "border-green-500/20",
    dot: "bg-green-400",
  },
};

const priorityColors: Record<WorkPriority, string> = {
  critical: "text-red-400",
  high: "text-amber-400",
  medium: "text-blue-400",
  low: "text-slate-400",
};

const isDbRow = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}/.test(id);

function WorkCard({
  item,
  onApprove,
  onAssign,
  onOpen,
}: {
  item: WorkItem;
  onApprove: (item: WorkItem) => void;
  onAssign: (item: WorkItem) => void;
  onOpen: (item: WorkItem) => void;
}) {
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
            <div
              className={`w-2 h-2 rounded-full ${status.dot} ${item.status === "in_progress" ? "animate-pulse" : ""}`}
            />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400 font-mono">
                  {item.woNumber}
                </span>
                {item.type === "ai_generated" && (
                  <span className="text-xs px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 flex items-center gap-1">
                    <Bot className="w-2.5 h-2.5" /> AI
                  </span>
                )}
                {item.safetyFlag && (
                  <span className="text-xs px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20">
                    Safety
                  </span>
                )}
              </div>
              <span
                className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${status.bg} ${status.color} border ${status.border}`}
              >
                {status.label}
              </span>
            </div>
            <h4 className="text-sm font-semibold text-slate-200 mt-1">
              {item.title}
            </h4>
            <div className="text-xs text-slate-400 mt-0.5">
              {item.asset} · {item.area}
            </div>
            <div className="flex items-center gap-3 mt-2 text-xs flex-wrap">
              <span
                className={`font-bold ${priorityColors[item.priority]} capitalize`}
              >
                {item.priority}
              </span>
              <span className="text-slate-400">·</span>
              <span className="text-slate-400">{item.scheduledDate}</span>
              <span className="text-slate-400">·</span>
              <span className="text-slate-400">
                {item.estimatedHours}h estimated
              </span>
              {item.assignee && (
                <>
                  <span className="text-slate-400">·</span>
                  <span className="flex items-center gap-1 text-slate-400">
                    <User className="w-3 h-3" />
                    {item.assignee}
                  </span>
                </>
              )}
              <span
                className={`ml-auto flex items-center gap-1 ${item.partsReady ? "text-teal-400" : "text-amber-400"}`}
              >
                <Package className="w-3 h-3" />
                {item.partsReady ? "Parts Ready" : "Parts Needed"}
              </span>
            </div>

            {expanded && (
              <div className="mt-3 pt-3 border-t border-white/[0.05] space-y-2">
                <div className="text-xs text-slate-400">{item.description}</div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-slate-400">Financial Exposure: </span>
                    <span
                      className={`font-bold ${priorityColors[item.priority]}`}
                    >
                      {item.financialExposure}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400">Production Impact: </span>
                    <span className="text-slate-300">
                      {item.productionImpact}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400">Risk Score: </span>
                    <span className="text-slate-300">{item.riskScore}/100</span>
                  </div>
                  <div>
                    <span className="text-slate-400">Approval Required: </span>
                    <span className="text-slate-300">
                      {item.approvalRequired ? "Yes" : "No"}
                    </span>
                  </div>
                </div>
                <div className="flex gap-2 mt-2">
                  {item.approvalRequired ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onApprove(item);
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-500/20 border border-teal-500/30 text-teal-400 text-xs font-medium rounded-lg hover:bg-teal-500/30 transition-colors"
                    >
                      <CheckCircle className="w-3 h-3" /> Approve
                    </button>
                  ) : (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpen(item);
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-500/20 border border-teal-500/30 text-teal-400 text-xs font-medium rounded-lg hover:bg-teal-500/30 transition-colors"
                    >
                      <ArrowUpRight className="w-3 h-3" /> Open WO
                    </button>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onAssign(item);
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-white/[0.04] border border-white/[0.08] text-slate-400 text-xs rounded-lg hover:bg-white/[0.08] transition-colors"
                  >
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
  const navigate = useNavigate();
  const [filter, setFilter] = useState<"all" | WorkStatus>("all");
  const [sortBy, setSortBy] = useState<"risk" | "date" | "priority">("risk");
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [showNewWo, setShowNewWo] = useState(false);
  const [newWoTitle, setNewWoTitle] = useState("");
  const [newWoPriority, setNewWoPriority] = useState("medium");
  const { workActions } = useOnboardingOperatingLoop();
  const {
    data: rows,
    loading,
    error,
    refetch,
  } = useAsyncData<WorkOrderRow[]>(() => getWorkOrders(), []);
  const { live } = useRealtimeRefetch(
    ["work_orders", "recommendations", "approvals"],
    refetch,
  );

  const flash = (m: string) => {
    setToast(m);
    window.setTimeout(() => setToast(null), 4000);
  };

  const handleApprove = async (item: WorkItem) => {
    if (!isDbRow(item.id)) {
      flash(
        "This draft comes from asset onboarding — approve its gate in Decision Governance first.",
      );
      return;
    }
    try {
      await approveWorkOrder(item.id, item.title);
      flash(`Approved ${item.woNumber} — now scheduled. Decision logged.`);
      refetch();
    } catch (e) {
      flash(e instanceof Error ? e.message : "Approval failed.");
    }
  };

  const handleAssign = async (item: WorkItem) => {
    if (!isDbRow(item.id)) {
      flash("Onboarding drafts can be assigned once converted to work orders.");
      return;
    }
    const assignee = window.prompt(
      `Assign ${item.woNumber} to:`,
      item.assignee ?? "",
    );
    if (!assignee) return;
    try {
      await assignWorkOrder(item.id, assignee);
      flash(`${item.woNumber} assigned to ${assignee}.`);
      refetch();
    } catch (e) {
      flash(e instanceof Error ? e.message : "Assignment failed.");
    }
  };

  const handleOpen = (item: WorkItem) => {
    if (isDbRow(item.id)) navigate(`/work/${item.id}`);
    else flash("Onboarding drafts have no work-order detail yet.");
  };

  const handleCreate = async () => {
    if (!newWoTitle.trim()) return;
    try {
      await createHumanWorkOrder({
        title: newWoTitle.trim(),
        assetId: null,
        priority: newWoPriority,
      });
      setShowNewWo(false);
      setNewWoTitle("");
      flash("Work order created.");
      refetch();
    } catch (e) {
      flash(e instanceof Error ? e.message : "Could not create work order.");
    }
  };

  const allWorkItems: WorkItem[] = [
    ...workActions.map(derivedWorkActionToItem),
    ...(rows ?? []).map(workOrderRowToItem),
  ];

  const filtered = allWorkItems
    .filter((w) => filter === "all" || w.status === filter)
    .filter(
      (w) =>
        !search ||
        w.title.toLowerCase().includes(search.toLowerCase()) ||
        w.asset.toLowerCase().includes(search.toLowerCase()),
    )
    .sort((a, b) => {
      if (sortBy === "risk") return b.riskScore - a.riskScore;
      if (sortBy === "priority") {
        const order: Record<WorkPriority, number> = {
          critical: 0,
          high: 1,
          medium: 2,
          low: 3,
        };
        return order[a.priority] - order[b.priority];
      }
      return a.scheduledDate.localeCompare(b.scheduledDate);
    });

  const counts = {
    critical: allWorkItems.filter(
      (w) => w.status === "critical" || w.priority === "critical",
    ).length,
    approval: allWorkItems.filter((w) => w.status === "approval").length,
    blocked: allWorkItems.filter((w) => w.status === "blocked").length,
    aiGenerated: allWorkItems.filter((w) => w.type === "ai_generated").length,
    total: allWorkItems.length,
  };

  return (
    <div className="p-6 space-y-6">
      {toast && (
        <div className="fixed top-4 right-4 z-[60] max-w-sm bg-[#0D1520] border border-teal-500/30 rounded-xl px-4 py-3 text-xs text-teal-200 shadow-xl shadow-black/40">
          {toast}
        </div>
      )}
      {showNewWo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setShowNewWo(false)}
          />
          <div className="relative w-full max-w-md bg-[#0D1520] border border-white/[0.1] rounded-2xl p-5">
            <h3 className="text-sm font-semibold text-slate-200 mb-3">
              New Work Order
            </h3>
            <label
              className="block text-xs text-slate-400 mb-1"
              htmlFor="new-wo-title"
            >
              Title
            </label>
            <input
              id="new-wo-title"
              value={newWoTitle}
              onChange={(e) => setNewWoTitle(e.target.value)}
              placeholder="e.g. Inspect HX-08 bypass valve"
              className="w-full px-3 py-2 mb-3 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm text-white placeholder-slate-600 focus:outline-none focus:border-teal-500/40"
            />
            <label
              className="block text-xs text-slate-400 mb-1"
              htmlFor="new-wo-priority"
            >
              Priority
            </label>
            <select
              id="new-wo-priority"
              value={newWoPriority}
              onChange={(e) => setNewWoPriority(e.target.value)}
              className="w-full px-3 py-2 mb-4 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm text-white focus:outline-none focus:border-teal-500/40"
            >
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowNewWo(false)}
                className="px-3 py-1.5 text-xs text-slate-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                className="px-3 py-1.5 bg-teal-500/20 border border-teal-500/30 text-teal-400 text-xs font-medium rounded-lg hover:bg-teal-500/30"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-white tracking-tight">
              Work Action Board
            </h1>
            <LiveBadge live={live} />
          </div>
          <p className="text-sm text-slate-400 mt-0.5">
            Ranked by risk, consequence, and mission impact
          </p>
        </div>
        <button
          onClick={() => setShowNewWo(true)}
          className="px-4 py-2 bg-teal-500/20 border border-teal-500/30 rounded-lg text-xs text-teal-400 font-medium hover:bg-teal-500/30 transition-colors flex items-center gap-1.5"
        >
          <Plus className="w-3.5 h-3.5" /> New Work Order
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: "Total Work", value: counts.total, color: "slate" },
          { label: "Critical / Safety", value: counts.critical, color: "red" },
          {
            label: "Awaiting Approval",
            value: counts.approval,
            color: "amber",
          },
          { label: "Blocked", value: counts.blocked, color: "slate" },
          { label: "AI Generated", value: counts.aiGenerated, color: "blue" },
        ].map((s) => {
          const c: Record<string, string> = {
            red: "text-red-400",
            amber: "text-amber-400",
            blue: "text-blue-400",
            slate: "text-slate-300",
          };
          return (
            <div
              key={s.label}
              className="bg-[#0D1520] border border-white/[0.06] rounded-xl p-3 text-center"
            >
              <div className={`text-xl font-black ${c[s.color]}`}>
                {s.value}
              </div>
              <div className="text-xs text-slate-400 mt-0.5">{s.label}</div>
            </div>
          );
        })}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search work orders..."
            className="w-full pl-8 pr-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-lg text-xs text-slate-300 placeholder-slate-600 outline-none focus:border-teal-500/40"
          />
        </div>

        <div className="flex items-center gap-1">
          {(
            [
              "all",
              "critical",
              "approval",
              "in_progress",
              "blocked",
              "scheduled",
            ] as const
          ).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2.5 py-1 rounded-lg text-xs transition-colors ${
                filter === f
                  ? "bg-teal-500/20 text-teal-400 border border-teal-500/30"
                  : "bg-white/[0.02] border border-white/[0.06] text-slate-400 hover:text-slate-300"
              }`}
            >
              {f === "all"
                ? "All"
                : f.replace("_", " ").charAt(0).toUpperCase() +
                  f.replace("_", " ").slice(1)}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 ml-auto">
          <span className="text-xs text-slate-400">Sort:</span>
          {(["risk", "priority", "date"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSortBy(s)}
              className={`px-2.5 py-1 rounded-lg text-xs transition-colors ${sortBy === s ? "bg-teal-500/20 text-teal-400 border border-teal-500/30" : "bg-white/[0.02] border border-white/[0.06] text-slate-400"}`}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Work List */}
      {loading && <LoadingState label="Loading work orders…" />}
      {error && <ErrorState message={error} onRetry={refetch} />}
      <div className="space-y-3">
        {!loading &&
          !error &&
          filtered.map((item, i) => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
            >
              <WorkCard
                item={item}
                onApprove={handleApprove}
                onAssign={handleAssign}
                onOpen={handleOpen}
              />
            </motion.div>
          ))}
        {!loading && !error && filtered.length === 0 && (
          <div className="text-center py-16 text-slate-400">
            <Activity className="w-10 h-10 mx-auto mb-3 opacity-50" />
            <p className="text-sm">No work orders match the current filters</p>
          </div>
        )}
      </div>

      {/* AI Note */}
      <div className="bg-[#0D1520] border border-teal-500/20 rounded-xl p-4 flex items-start gap-3">
        <Zap className="w-4 h-4 text-teal-400 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-slate-400 leading-relaxed">
          Work is ranked by{" "}
          <span className="text-slate-200">
            risk score, consequence, and mission impact
          </span>{" "}
          — not work order number or date created.
          <span className="text-teal-400 font-medium">
            {" "}
            {counts.aiGenerated} of {counts.total} work orders
          </span>{" "}
          were generated autonomously by SyncAI agents.
        </p>
      </div>
    </div>
  );
}
