import {
  CircleCheck as CheckCircle,
  Lock,
  Zap,
  Eye,
  Users,
  Bot,
  ArrowRight,
  Activity,
  ShieldCheck,
} from "lucide-react";
import { motion } from "framer-motion";
import { useAsyncData } from "../hooks/useAsyncData";
import { getAgents, getDecisions } from "../services/operatingLoopService";
import type { AgentRow, DecisionRow } from "../types/operating";
import {
  LoadingState,
  ErrorState,
  EmptyState,
} from "../components/ui/AsyncStates";

type AutonomyMode = "advisory" | "conditional" | "controlled";

interface MaturityLevelDef {
  level: number;
  title: string;
  subtitle: string;
  description: string;
  capabilities: string[];
  icon: React.ElementType;
  color: string;
  /** Which live ai_agents.autonomy_mode maps onto this level (if any). */
  mode?: AutonomyMode;
}

type LevelStatus = "completed" | "current" | "locked";

/**
 * Static methodology content (the maturity framework itself). Every statistic
 * shown alongside it is computed live from ai_agents and decisions.
 */
const maturityLevels: MaturityLevelDef[] = [
  {
    level: 1,
    title: "Visibility",
    subtitle: "Dashboards & Insights",
    description:
      "Full visibility into asset health, maintenance performance, and operational risk through integrated dashboards.",
    capabilities: [
      "Asset health monitoring",
      "KPI dashboards",
      "Alert management",
      "Integration with source systems",
      "Historical analysis",
    ],
    icon: Eye,
    color: "green",
  },
  {
    level: 2,
    title: "Assisted",
    subtitle: "AI Recommendations",
    description:
      "AI analyzes data and provides recommendations, but all actions require human initiation.",
    capabilities: [
      "Predictive failure alerts",
      "AI recommendations",
      "Evidence-based insights",
      "Risk scoring",
      "Anomaly detection",
    ],
    icon: Zap,
    color: "green",
    mode: "advisory",
  },
  {
    level: 3,
    title: "Human-in-the-Loop",
    subtitle: "AI Prepares, Human Approves",
    description:
      "AI prepares actions, creates work orders, and optimizes plans. Humans approve before execution.",
    capabilities: [
      "Auto-generated work orders",
      "PM optimization",
      "Scheduling recommendations",
      "Parts ordering (with approval)",
      "Automated reports",
    ],
    icon: Users,
    color: "teal",
    mode: "conditional",
  },
  {
    level: 4,
    title: "Controlled Autonomy",
    subtitle: "AI Executes Approved Classes",
    description:
      "AI executes defined classes of work autonomously based on confidence thresholds and governance rules.",
    capabilities: [
      "Autonomous inspections",
      "Auto-scheduling",
      "Auto-parts ordering (under limit)",
      "Self-optimizing PMs",
      "Autonomous monitoring adjustments",
    ],
    icon: Bot,
    color: "blue",
    mode: "controlled",
  },
  {
    level: 5,
    title: "Autonomous M&R",
    subtitle: "AI-Run Maintenance Organization",
    description:
      "AI manages major portions of the maintenance and reliability function with minimal human intervention.",
    capabilities: [
      "Full autonomous maintenance",
      "Self-healing operations",
      "Predictive capital planning",
      "Autonomous reliability engineering",
      "Human oversight only",
    ],
    icon: Bot,
    color: "cyan",
  },
];

const MODE_LABELS: Record<AutonomyMode, string> = {
  advisory: "advisory",
  conditional: "conditional",
  controlled: "controlled",
};

const colorMap: Record<
  string,
  { text: string; bg: string; border: string; ring: string }
> = {
  green: {
    text: "text-green-400",
    bg: "bg-green-500/10",
    border: "border-green-500/20",
    ring: "ring-green-500/30",
  },
  teal: {
    text: "text-teal-400",
    bg: "bg-teal-500/10",
    border: "border-teal-500/20",
    ring: "ring-teal-500/40",
  },
  blue: {
    text: "text-blue-400",
    bg: "bg-blue-500/10",
    border: "border-blue-500/20",
    ring: "ring-blue-500/20",
  },
  cyan: {
    text: "text-cyan-400",
    bg: "bg-cyan-500/10",
    border: "border-cyan-500/20",
    ring: "ring-cyan-500/20",
  },
};

interface LiveMaturity {
  totalAgents: number;
  modeCounts: Record<AutonomyMode, number>;
  actionsExecuted: number;
  approvalsPending: number;
  recommendationsGenerated: number;
  totalDecisions: number;
  humanDecisions: number;
  /** Level of the dominant live autonomy mode; null when no agents exist. */
  currentLevel: number | null;
  currentTitle: string | null;
  dominantMode: AutonomyMode | null;
}

function deriveMaturity(
  agents: AgentRow[],
  decisions: DecisionRow[],
): LiveMaturity {
  const modeCounts: Record<AutonomyMode, number> = {
    advisory: 0,
    conditional: 0,
    controlled: 0,
  };
  let actionsExecuted = 0;
  let approvalsPending = 0;
  let recommendationsGenerated = 0;
  for (const a of agents) {
    if (a.autonomy_mode in modeCounts) {
      modeCounts[a.autonomy_mode as AutonomyMode] += 1;
    }
    actionsExecuted += a.actions_executed ?? 0;
    approvalsPending += a.approvals_pending ?? 0;
    recommendationsGenerated += a.recommendations_generated ?? 0;
  }

  // Dominant autonomy mode drives the current level. Ties resolve to the more
  // conservative (lower) level.
  let dominantMode: AutonomyMode | null = null;
  for (const mode of ["advisory", "conditional", "controlled"] as const) {
    if (
      modeCounts[mode] > 0 &&
      (dominantMode === null || modeCounts[mode] > modeCounts[dominantMode])
    ) {
      dominantMode = mode;
    }
  }
  const levelDef = dominantMode
    ? maturityLevels.find((l) => l.mode === dominantMode)
    : undefined;

  const humanDecisions = decisions.filter(
    (d) => d.approval_status !== "autonomous",
  ).length;

  return {
    totalAgents: agents.length,
    modeCounts,
    actionsExecuted,
    approvalsPending,
    recommendationsGenerated,
    totalDecisions: decisions.length,
    humanDecisions,
    currentLevel: levelDef?.level ?? null,
    currentTitle: levelDef?.title ?? null,
    dominantMode,
  };
}

function levelStatus(level: number, currentLevel: number | null): LevelStatus {
  // Level 1 (Visibility) is delivered by this workspace's live dashboards.
  if (currentLevel === null) return level === 1 ? "completed" : "locked";
  if (level < currentLevel) return "completed";
  if (level === currentLevel) return "current";
  return "locked";
}

export function AutonomyMaturity() {
  const { data, loading, error, refetch } = useAsyncData(
    () => Promise.all([getAgents(), getDecisions()]),
    [],
    { isEmpty: (d) => !d || d[0].length === 0 },
  );

  const header = (
    <div>
      <h1 className="text-2xl font-bold text-white tracking-tight">
        Autonomy Maturity
      </h1>
      <p className="text-sm text-slate-400 mt-0.5">
        Your journey from visibility to autonomous maintenance and reliability
      </p>
    </div>
  );

  if (loading) {
    return (
      <div className="p-6 space-y-6">
        {header}
        <LoadingState label="Loading live autonomy data…" />
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

  const [agents, decisions] = data ?? [[], []];
  const live = deriveMaturity(agents, decisions);
  const hasAgents = live.totalAgents > 0;

  const approvalRate =
    live.totalDecisions > 0
      ? Math.round((live.humanDecisions / live.totalDecisions) * 100)
      : null;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        {header}
        {hasAgents && live.currentLevel !== null ? (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-teal-500/10 border border-teal-500/20 rounded-lg">
            <span className="text-xs font-bold text-teal-400">
              Current: Level {live.currentLevel} — {live.currentTitle}
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-white/[0.04] border border-white/[0.08] rounded-lg">
            <span className="text-xs font-bold text-slate-300">
              No live agents yet
            </span>
          </div>
        )}
      </div>

      {/* Live statistics — computed from ai_agents and decisions */}
      {hasAgents ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-[#0D1520] border border-white/[0.06] rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Bot className="w-3.5 h-3.5 text-teal-400" />
              <span className="text-xs text-slate-400">Agent Autonomy Mix</span>
            </div>
            <div className="text-sm font-bold text-slate-200 leading-relaxed">
              <span className="text-green-400">
                {live.modeCounts.advisory} advisory
              </span>
              {" · "}
              <span className="text-teal-400">
                {live.modeCounts.conditional} conditional
              </span>
              {" · "}
              <span className="text-blue-400">
                {live.modeCounts.controlled} controlled
              </span>
            </div>
            <div className="text-xs text-slate-400 mt-0.5">
              {live.totalAgents} agents total
            </div>
          </div>
          <div className="bg-[#0D1520] border border-white/[0.06] rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Activity className="w-3.5 h-3.5 text-blue-400" />
              <span className="text-xs text-slate-400">Actions Executed</span>
            </div>
            <div className="text-3xl font-black text-blue-400">
              {live.actionsExecuted}
            </div>
            <div className="text-xs text-slate-400 mt-0.5">
              from {live.recommendationsGenerated} recommendations generated
            </div>
          </div>
          <div className="bg-[#0D1520] border border-white/[0.06] rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Users className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-xs text-slate-400">Approvals Pending</span>
            </div>
            <div className="text-3xl font-black text-amber-400">
              {live.approvalsPending}
            </div>
            <div className="text-xs text-slate-400 mt-0.5">
              awaiting human review
            </div>
          </div>
          <div className="bg-[#0D1520] border border-white/[0.06] rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <ShieldCheck className="w-3.5 h-3.5 text-teal-400" />
              <span className="text-xs text-slate-400">
                Human Approval Rate
              </span>
            </div>
            {approvalRate !== null ? (
              <>
                <div className="text-3xl font-black text-teal-400">
                  {approvalRate}
                  <span className="text-sm text-slate-400">%</span>
                </div>
                <div className="text-xs text-slate-400 mt-0.5">
                  {live.humanDecisions} of {live.totalDecisions} logged
                  decisions involved a human
                </div>
              </>
            ) : (
              <div className="text-sm text-slate-400">
                No decisions logged yet
              </div>
            )}
          </div>
        </div>
      ) : (
        <EmptyState message="No AI agents provisioned yet — live maturity statistics connect when agents are running." />
      )}

      {/* Progress Bar */}
      <div className="bg-[#0D1520] border border-white/[0.06] rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-4">
          {maturityLevels.map((level, i) => {
            const status = levelStatus(level.level, live.currentLevel);
            return (
              <div key={level.level} className="flex items-center flex-1">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-black ${
                    status === "completed"
                      ? "bg-green-500/20 text-green-400 ring-2 ring-green-500/30"
                      : status === "current"
                        ? "bg-teal-500/20 text-teal-400 ring-2 ring-teal-500/40 animate-pulse"
                        : "bg-white/[0.05] text-slate-400 ring-1 ring-white/[0.08]"
                  }`}
                >
                  {level.level}
                </div>
                {i < maturityLevels.length - 1 && (
                  <div
                    className={`flex-1 h-0.5 mx-2 rounded-full ${
                      status === "completed"
                        ? "bg-green-500/40"
                        : status === "current"
                          ? "bg-gradient-to-r from-teal-500/40 to-white/[0.05]"
                          : "bg-white/[0.05]"
                    }`}
                  />
                )}
              </div>
            );
          })}
        </div>
        <div className="flex items-center justify-between text-xs text-slate-400">
          {maturityLevels.map((l) => (
            <span key={l.level} className="text-center">
              {l.title}
            </span>
          ))}
        </div>
        {hasAgents && live.dominantMode && live.currentLevel !== null && (
          <div className="mt-4 pt-3 border-t border-white/[0.06] text-xs text-slate-400">
            Level derived from live agent autonomy modes:{" "}
            <span className="text-slate-300 font-semibold">
              {live.modeCounts[live.dominantMode]} of {live.totalAgents} agents
            </span>{" "}
            operate in {MODE_LABELS[live.dominantMode]} mode, making{" "}
            <span className="text-teal-400 font-semibold">
              Level {live.currentLevel} — {live.currentTitle}
            </span>{" "}
            the dominant operating posture.
          </div>
        )}
      </div>

      {/* Level Cards */}
      <div className="space-y-4">
        {maturityLevels.map((level, i) => {
          const Icon = level.icon;
          const c = colorMap[level.color];
          const status = levelStatus(level.level, live.currentLevel);
          const isLocked = status === "locked";
          const liveCount = level.mode ? live.modeCounts[level.mode] : null;

          return (
            <motion.div
              key={level.level}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08 }}
              className={`bg-[#0D1520] border rounded-2xl p-5 ${
                status === "current"
                  ? `${c.border} ring-1 ${c.ring}`
                  : isLocked
                    ? "border-white/[0.04] opacity-70"
                    : "border-white/[0.06]"
              }`}
            >
              <div className="flex items-start gap-4">
                <div
                  className={`p-3 rounded-xl ${c.bg} flex-shrink-0 relative`}
                >
                  <Icon className={`w-5 h-5 ${c.text}`} />
                  {status === "completed" && (
                    <CheckCircle className="w-3.5 h-3.5 text-green-400 absolute -top-1 -right-1" />
                  )}
                  {isLocked && (
                    <Lock className="w-3 h-3 text-slate-400 absolute -top-1 -right-1" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-1">
                    <span
                      className={`text-xs font-black uppercase tracking-wider ${c.text}`}
                    >
                      Level {level.level}
                    </span>
                    <h3 className="text-base font-bold text-white">
                      {level.title}
                    </h3>
                    <span className="text-xs text-slate-400">
                      — {level.subtitle}
                    </span>
                    {status === "current" && (
                      <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-teal-500/20 text-teal-400 font-bold">
                        CURRENT
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-slate-400 leading-relaxed">
                    {level.description}
                  </p>
                  {level.mode && hasAgents && (
                    <div className="mt-2 text-xs text-slate-300">
                      <span className={`font-bold ${c.text}`}>
                        {liveCount} of {live.totalAgents}
                      </span>{" "}
                      agents currently operate in {MODE_LABELS[level.mode]} mode
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2 mt-3">
                    {level.capabilities.map((cap) => (
                      <span
                        key={cap}
                        className={`text-xs px-2 py-0.5 rounded-full border ${isLocked ? "bg-white/[0.02] border-white/[0.05] text-slate-400" : `${c.bg} ${c.border} ${c.text}`}`}
                      >
                        {cap}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>

      <div className="bg-[#0D1520] border border-teal-500/10 rounded-xl p-4 flex items-start gap-3">
        <ArrowRight className="w-4 h-4 text-teal-400 flex-shrink-0 mt-0.5" />
        <div>
          <div className="text-sm font-bold text-teal-400">
            Progressive Adoption
          </div>
          <p className="text-xs text-slate-400 mt-1 leading-relaxed">
            SyncAI is designed for conservative enterprise adoption. Advance at
            your own pace — each level builds trust through demonstrated
            accuracy, governance, and value delivery before unlocking greater
            autonomy. Level placement above is derived live from the autonomy
            mode of each provisioned agent.
          </p>
        </div>
      </div>
    </div>
  );
}
