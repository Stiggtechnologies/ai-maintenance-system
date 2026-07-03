import { useState } from "react";
import {
  Bot,
  Activity,
  CircleCheck as CheckCircle,
  CircleAlert as AlertCircle,
  Clock,
  Zap,
  Eye,
  Settings,
  TrendingUp,
  Shield,
  RefreshCw,
  Play,
  Pause,
} from "lucide-react";
import { motion } from "framer-motion";
import { useAsyncData } from "../hooks/useAsyncData";
import { getAgents } from "../services/operatingLoopService";
import type { AgentRow } from "../types/operating";
import {
  LoadingState,
  ErrorState,
  EmptyState,
} from "../components/ui/AsyncStates";

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

const AUTONOMY_MAP: Record<string, AutonomyMode> = {
  advisory: "Human-Led",
  conditional: "Human-in-the-Loop",
  controlled: "Autonomous",
};
const STATUS_MAP: Record<string, AgentStatus> = {
  active: "active",
  idle: "idle",
  paused: "waiting",
  error: "processing",
};
const CATEGORY_ICON: Record<string, React.ElementType> = {
  strategic: Shield,
  operational: Activity,
  quality: CheckCircle,
  intelligence: TrendingUp,
};

function agentRowToAgent(row: AgentRow): Agent {
  return {
    id: row.id,
    name: row.name,
    purpose: `Specialized ${row.category ?? "M&R"} agent`,
    status: STATUS_MAP[row.status] ?? "idle",
    autonomyMode: AUTONOMY_MAP[row.autonomy_mode] ?? "Human-in-the-Loop",
    currentTask: row.current_task ?? "Idle",
    recommendationsGenerated: row.recommendations_generated,
    actionsExecuted: row.actions_executed,
    approvalRequired: row.approvals_pending > 0,
    confidence: row.confidence,
    supervisor: row.supervisor ?? "—",
    lastAction: row.last_action ?? "—",
    icon: CATEGORY_ICON[row.category ?? ""] ?? Bot,
  };
}

const statusConfig: Record<
  AgentStatus,
  {
    label: string;
    color: string;
    bg: string;
    dot: string;
    icon: React.ElementType;
  }
> = {
  active: {
    label: "Active",
    color: "text-teal-400",
    bg: "bg-teal-500/10",
    dot: "bg-teal-400",
    icon: Play,
  },
  processing: {
    label: "Processing",
    color: "text-blue-400",
    bg: "bg-blue-500/10",
    dot: "bg-blue-400",
    icon: RefreshCw,
  },
  idle: {
    label: "Idle",
    color: "text-slate-500",
    bg: "bg-slate-500/10",
    dot: "bg-slate-600",
    icon: Pause,
  },
  waiting: {
    label: "Waiting Approval",
    color: "text-amber-400",
    bg: "bg-amber-500/10",
    dot: "bg-amber-400",
    icon: Clock,
  },
};

const autonomyColors: Record<AutonomyMode, string> = {
  "Human-Led": "text-slate-400 bg-slate-500/10 border-slate-500/20",
  "Human-in-the-Loop": "text-amber-400 bg-amber-500/10 border-amber-500/20",
  Autonomous: "text-teal-400 bg-teal-500/10 border-teal-500/20",
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
          <div
            className={`w-9 h-9 rounded-xl ${status.bg} flex items-center justify-center flex-shrink-0`}
          >
            <Icon className={`w-4 h-4 ${status.color}`} />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-slate-200 leading-tight">
                  {agent.name}
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">
                  {agent.purpose}
                </p>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <div
                  className={`w-1.5 h-1.5 rounded-full ${status.dot} ${agent.status === "processing" ? "animate-pulse" : ""}`}
                />
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
                <div className="text-sm font-bold text-slate-200">
                  {agent.recommendationsGenerated}
                </div>
                <div className="text-[10px] text-slate-600">Recs</div>
              </div>
              <div className="text-center">
                <div className="text-sm font-bold text-slate-200">
                  {agent.actionsExecuted}
                </div>
                <div className="text-[10px] text-slate-600">Actions</div>
              </div>
              <div className="text-center">
                <div className="text-sm font-bold text-slate-200">
                  {agent.confidence}%
                </div>
                <div className="text-[10px] text-slate-600">Confidence</div>
              </div>
              <div
                className={`ml-auto px-2 py-0.5 rounded-full border text-[10px] font-semibold ${autonomyColors[agent.autonomyMode]}`}
              >
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
            <span className="text-slate-600">Last action: </span>
            {agent.lastAction}
          </div>
          <div className="text-[11px] text-slate-400">
            <span className="text-slate-600">Supervisor: </span>
            {agent.supervisor}
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
  const [autonomyFilter, setAutonomyFilter] = useState<"all" | AutonomyMode>(
    "all",
  );
  const { data, loading, error, refetch } = useAsyncData<AgentRow[]>(
    () => getAgents(),
    [],
  );
  const agents = (data ?? []).map(agentRowToAgent);

  const filtered = agents.filter((a) => {
    const statusMatch = filter === "all" || a.status === filter;
    const autonomyMatch =
      autonomyFilter === "all" || a.autonomyMode === autonomyFilter;
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
          <h1 className="text-2xl font-bold text-white tracking-tight">
            AI Workforce
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            15 specialized agents · Your digital M&R department
          </p>
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
          <div
            key={s.label}
            className="bg-[#0D1520] border border-white/[0.06] rounded-xl p-3 text-center"
          >
            <div
              className={`text-xl font-black ${s.color === "teal" ? "text-teal-400" : s.color === "blue" ? "text-blue-400" : "text-slate-300"}`}
            >
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
        {(["all", "Human-Led", "Human-in-the-Loop", "Autonomous"] as const).map(
          (f) => (
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
          ),
        )}
      </div>

      {/* Agent Grid */}
      {loading && <LoadingState label="Loading AI workforce…" />}
      {error && <ErrorState message={error} onRetry={refetch} />}
      {!loading && !error && agents.length === 0 && (
        <EmptyState message="No agents configured for this organization." />
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {!loading &&
          !error &&
          filtered.map((agent, i) => (
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
          <div className="text-sm font-medium text-teal-400">
            AI Workforce Active
          </div>
          <p className="text-xs text-slate-400 mt-1 leading-relaxed">
            SyncAI's 15 specialized agents are operating as your digital
            Maintenance & Reliability department. Together they have generated{" "}
            <span className="text-slate-200 font-semibold">
              445 recommendations
            </span>{" "}
            and executed{" "}
            <span className="text-slate-200 font-semibold">319 actions</span>{" "}
            this period. Human oversight is maintained via the Approval Queue
            and Decision Governance module.
          </p>
        </div>
      </div>
    </div>
  );
}
