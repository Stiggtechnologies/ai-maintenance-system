import { useState } from "react";
import {
  Brain,
  Target,
  Wrench,
  Shield,
  FileText,
  Zap,
  ChevronRight,
  Plus,
  Clock,
  Bot,
  Send,
  Layers,
  Rocket,
  TriangleAlert as AlertTriangle,
  CircleCheck as CheckCircle,
} from "lucide-react";
import { motion } from "framer-motion";
import { useOnboardingOperatingLoop } from "../hooks/useOnboardingOperatingLoop";
import type { DerivedWorkspace } from "../services/onboardingOperatingLoop";
import { useAsyncData } from "../hooks/useAsyncData";
import {
  getCoworkWorkspaces,
  createCoworkWorkspaceFromObjective,
  getCoworkMessages,
  sendCoworkMessage,
} from "../services/operatingLoopService";
import type { CoworkMessageRow } from "../types/operating";
import type { CoworkWorkspaceRow } from "../types/operating";
import { LoadingState, ErrorState } from "../components/ui/AsyncStates";

function rowToWorkspace(row: CoworkWorkspaceRow): Workspace {
  return {
    id: row.id,
    title: row.title,
    objective: row.objective ?? "",
    status: (["active", "completed", "draft"].includes(row.status)
      ? row.status
      : "active") as WorkspaceStatus,
    agents: row.agents ?? [],
    progress: row.progress,
    artifacts: row.artifacts,
    created: row.created_at.slice(0, 10),
    lastActivity: row.updated_at.slice(0, 10),
    icon: Layers,
    color: "cyan",
    nextAction: row.next_action ?? undefined,
  };
}

type WorkspaceStatus = "active" | "completed" | "draft";

interface Workspace {
  id: string;
  title: string;
  objective: string;
  status: WorkspaceStatus;
  agents: string[];
  progress: number;
  artifacts: number;
  created: string;
  lastActivity: string;
  icon: React.ElementType;
  color: string;
  nextAction?: string;
}

function derivedWorkspaceToWorkspace(workspace: DerivedWorkspace): Workspace {
  return {
    id: workspace.id,
    title: workspace.title,
    objective: workspace.objective,
    status: workspace.status,
    agents: workspace.agents,
    progress: workspace.progress,
    artifacts: workspace.artifacts,
    created: workspace.createdAt.slice(0, 10),
    lastActivity: workspace.updatedAt.slice(0, 10),
    icon: Layers,
    color: "cyan",
    nextAction: workspace.nextAction,
  };
}

const workspaceTemplates = [
  {
    id: "t-1",
    label: "Reliability Program Builder",
    icon: Target,
    description:
      "Build a complete reliability program for a site or asset class",
  },
  {
    id: "t-2",
    label: "RCA Copilot",
    icon: Brain,
    description: "Structured root cause analysis with AI evidence gathering",
  },
  {
    id: "t-3",
    label: "PM Optimization Workspace",
    icon: Wrench,
    description: "Optimize PM intervals using failure data and cost analysis",
  },
  {
    id: "t-4",
    label: "Shutdown Readiness",
    icon: Shield,
    description: "Prepare and validate shutdown/turnaround readiness",
  },
  {
    id: "t-5",
    label: "Executive Briefing Builder",
    icon: FileText,
    description: "Generate executive asset performance briefings",
  },
  {
    id: "t-6",
    label: "Asset Onboarding",
    icon: Layers,
    description: "Onboard new assets with strategy and PM setup",
  },
  {
    id: "t-7",
    label: "Continuous Improvement",
    icon: Zap,
    description: "90-day maintenance improvement plans",
  },
  {
    id: "t-8",
    label: "Mission Readiness",
    icon: Rocket,
    description: "Go / no-go readiness assessments",
  },
  {
    id: "t-9",
    label: "Compliance Audit",
    icon: CheckCircle,
    description: "Prepare for ISO 55000 or regulatory audits",
  },
  {
    id: "t-10",
    label: "Emergency Recovery",
    icon: AlertTriangle,
    description: "Post-incident recovery and return-to-service planning",
  },
];

const statusConfig: Record<
  WorkspaceStatus,
  { color: string; bg: string; label: string }
> = {
  active: { color: "text-teal-400", bg: "bg-teal-500/10", label: "Active" },
  completed: {
    color: "text-green-400",
    bg: "bg-green-500/10",
    label: "Completed",
  },
  draft: { color: "text-slate-400", bg: "bg-slate-500/10", label: "Draft" },
};

const colorMap: Record<string, string> = {
  teal: "text-teal-400 bg-teal-500/10 border-teal-500/20",
  blue: "text-blue-400 bg-blue-500/10 border-blue-500/20",
  amber: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  cyan: "text-cyan-400 bg-cyan-500/10 border-cyan-500/20",
  green: "text-green-400 bg-green-500/10 border-green-500/20",
};

function WorkspaceCard({
  workspace,
  index,
}: {
  workspace: Workspace;
  index: number;
}) {
  const Icon = workspace.icon;
  const sc = statusConfig[workspace.status];
  const cm = colorMap[workspace.color];
  const [textColor] = cm.split(" ");

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      className="bg-[#0D1520] border border-white/[0.06] rounded-2xl p-5 hover:border-white/[0.12] transition-all cursor-pointer group"
    >
      <div className="flex items-start gap-4">
        <div
          className={`p-2.5 rounded-xl ${cm.split(" ").slice(1, 2).join(" ")} border ${cm.split(" ").slice(2).join(" ")} flex-shrink-0`}
        >
          <Icon className={`w-5 h-5 ${textColor}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-bold text-white truncate">
              {workspace.title}
            </h3>
            <span
              className={`text-xs px-2 py-0.5 rounded-full font-semibold ${sc.bg} ${sc.color}`}
            >
              {sc.label}
            </span>
          </div>
          <p className="text-xs text-slate-400 leading-relaxed">
            {workspace.objective}
          </p>

          <div className="flex items-center gap-4 mt-3">
            <div className="flex-1">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-slate-400">Progress</span>
                <span className="text-xs font-bold text-slate-400">
                  {workspace.progress}%
                </span>
              </div>
              <div className="h-1.5 bg-white/[0.05] rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${workspace.status === "completed" ? "bg-green-500" : "bg-teal-500"}`}
                  style={{ width: `${workspace.progress}%` }}
                />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4 mt-3 text-xs text-slate-400">
            <span className="flex items-center gap-1">
              <Bot className="w-3 h-3" />
              {workspace.agents.length} agents
            </span>
            <span className="flex items-center gap-1">
              <FileText className="w-3 h-3" />
              {workspace.artifacts} artifacts
            </span>
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {workspace.lastActivity}
            </span>
          </div>

          <div className="flex flex-wrap gap-1.5 mt-3">
            {workspace.agents.slice(0, 3).map((a) => (
              <span
                key={a}
                className="text-xs px-2 py-0.5 rounded-full bg-white/[0.04] border border-white/[0.06] text-slate-400"
              >
                {a}
              </span>
            ))}
            {workspace.agents.length > 3 && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-white/[0.04] border border-white/[0.06] text-slate-400">
                +{workspace.agents.length - 3}
              </span>
            )}
          </div>

          {workspace.nextAction && (
            <div className="mt-3 flex items-start gap-1.5 text-xs text-teal-400">
              <Zap className="w-3 h-3 flex-shrink-0 mt-0.5" />
              <span>
                <span className="text-slate-400">Next action: </span>
                {workspace.nextAction}
              </span>
            </div>
          )}
        </div>
        <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-teal-400 transition-colors flex-shrink-0 mt-1" />
      </div>
    </motion.div>
  );
}

export function CoworkStudio() {
  const [view, setView] = useState<"workspaces" | "new" | "thread">(
    "workspaces",
  );
  const [activeWs, setActiveWs] = useState<Workspace | null>(null);
  const [threadMsgs, setThreadMsgs] = useState<CoworkMessageRow[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [chatText, setChatText] = useState("");
  const [sending, setSending] = useState(false);

  const isDbWs = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}/.test(id);

  const openThread = async (ws: Workspace) => {
    setActiveWs(ws);
    setView("thread");
    if (!isDbWs(ws.id)) {
      setThreadMsgs([]);
      return;
    }
    setThreadLoading(true);
    try {
      setThreadMsgs(await getCoworkMessages(ws.id));
    } finally {
      setThreadLoading(false);
    }
  };

  const handleSend = async () => {
    const text = chatText.trim();
    if (!text || !activeWs || sending) return;
    if (!isDbWs(activeWs.id)) return;
    setSending(true);
    setChatText("");
    try {
      await sendCoworkMessage(activeWs.id, activeWs.objective, text);
      setThreadMsgs(await getCoworkMessages(activeWs.id));
    } finally {
      setSending(false);
    }
  };
  const [filter, setFilter] = useState<WorkspaceStatus | "all">("all");
  const [objective, setObjective] = useState("");
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const { workspaces: onboardingWorkspaces } = useOnboardingOperatingLoop();
  const {
    data: rows,
    loading,
    error,
    refetch,
  } = useAsyncData<CoworkWorkspaceRow[]>(() => getCoworkWorkspaces(), []);

  const allWorkspaces: Workspace[] = [
    ...onboardingWorkspaces.map(derivedWorkspaceToWorkspace),
    ...(rows ?? []).map(rowToWorkspace),
  ];
  const filtered =
    filter === "all"
      ? allWorkspaces
      : allWorkspaces.filter((w) => w.status === filter);

  const handleStart = async (text: string) => {
    const obj = text.trim();
    if (!obj || creating) return;
    setCreating(true);
    setNotice(null);
    try {
      await createCoworkWorkspaceFromObjective(obj);
      setObjective("");
      setView("workspaces");
      setNotice(
        "Workspace created — agents assigned, starter artifact and recommended action generated.",
      );
      refetch();
      window.setTimeout(() => setNotice(null), 4000);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Could not create workspace.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            Cowork Studio
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Collaborative AI workspaces for maintenance, reliability, and
            mission assurance
          </p>
        </div>
        <button
          onClick={() => setView(view === "new" ? "workspaces" : "new")}
          className="flex items-center gap-1.5 px-4 py-2 bg-teal-500/20 border border-teal-500/30 text-teal-400 text-xs font-medium rounded-lg hover:bg-teal-500/30 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> New Workspace
        </button>
      </div>

      {notice && (
        <div className="bg-[#0D1520] border border-teal-500/30 rounded-xl px-4 py-3 text-xs text-teal-200">
          {notice}
        </div>
      )}

      {view === "new" && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-4"
        >
          {/* Objective Input */}
          <div className="bg-[#0D1520] border border-teal-500/20 rounded-2xl p-5">
            <h3 className="text-sm font-semibold text-slate-200 mb-3">
              Start with an objective
            </h3>
            <div className="flex gap-3">
              <input
                type="text"
                value={objective}
                onChange={(e) => setObjective(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleStart(objective);
                }}
                placeholder="e.g., Create RCA for Pump P-101 with 5 seal failures in 9 months."
                className="flex-1 px-4 py-3 bg-white/[0.03] border border-white/[0.06] rounded-xl text-sm text-white placeholder-slate-600 focus:outline-none focus:border-teal-500/40 transition-colors"
              />
              <button
                onClick={() => handleStart(objective)}
                disabled={creating}
                className="flex items-center gap-1.5 px-4 py-3 bg-teal-500/20 border border-teal-500/30 text-teal-400 text-sm font-medium rounded-xl hover:bg-teal-500/30 transition-colors disabled:opacity-50"
              >
                <Send className="w-4 h-4" /> {creating ? "Creating…" : "Start"}
              </button>
            </div>
          </div>

          {/* Templates */}
          <div>
            <h3 className="text-sm font-semibold text-slate-400 mb-3">
              Or choose a workspace template
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
              {workspaceTemplates.map((t) => {
                const TIcon = t.icon;
                return (
                  <button
                    key={t.id}
                    onClick={() => handleStart(t.label)}
                    className="text-left p-4 bg-[#0D1520] border border-white/[0.06] rounded-xl hover:border-teal-500/30 hover:bg-teal-500/5 transition-all group"
                  >
                    <TIcon className="w-5 h-5 text-slate-400 group-hover:text-teal-400 transition-colors mb-2" />
                    <div className="text-xs font-semibold text-slate-200 mb-1">
                      {t.label}
                    </div>
                    <div className="text-xs text-slate-400 leading-relaxed">
                      {t.description}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </motion.div>
      )}

      {view === "thread" && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="space-y-4"
        >
          {/* Active Workspace Thread */}
          <div className="bg-[#0D1520] border border-white/[0.06] rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Wrench className="w-5 h-5 text-amber-400" />
                <div>
                  <h3 className="text-sm font-bold text-white">
                    {activeWs?.title ?? "Workspace"}
                  </h3>
                  <p className="text-xs text-slate-400">
                    {activeWs?.agents.length ?? 0} agents collaborating ·{" "}
                    {activeWs?.objective}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setView("workspaces")}
                className="text-xs text-slate-400 hover:text-white transition-colors"
              >
                Back to workspaces
              </button>
            </div>

            <div className="p-5 space-y-4 max-h-[400px] overflow-y-auto">
              {threadLoading && (
                <p className="text-xs text-slate-400">Loading thread…</p>
              )}
              {!threadLoading && threadMsgs.length === 0 && (
                <p className="text-xs text-slate-400">
                  No messages yet — direct the agents below to begin.
                </p>
              )}
              {threadMsgs.map((msg) => (
                <div key={msg.id} className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-teal-500/10 border border-teal-500/20 flex items-center justify-center flex-shrink-0">
                    <Bot className="w-4 h-4 text-teal-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className={`text-xs font-bold ${msg.role === "user" ? "text-slate-200" : "text-teal-400"}`}
                      >
                        {msg.agent}
                      </span>
                      <span className="text-xs text-slate-400">
                        {new Date(msg.created_at).toLocaleTimeString()}
                      </span>
                      {msg.confidence != null && (
                        <span className="text-xs font-mono text-slate-400 ml-auto">
                          {msg.confidence}% conf
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-slate-300 leading-relaxed">
                      {msg.message}
                    </p>
                  </div>
                </div>
              ))}
              {sending && (
                <p className="text-xs text-teal-400 animate-pulse">
                  Reliability Engineering agent is thinking…
                </p>
              )}
            </div>

            <div className="px-5 py-4 border-t border-white/[0.06] flex gap-3">
              <input
                type="text"
                value={chatText}
                onChange={(e) => setChatText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSend();
                }}
                placeholder="Ask the agents a question or provide direction..."
                className="flex-1 px-4 py-2.5 bg-white/[0.03] border border-white/[0.06] rounded-xl text-sm text-white placeholder-slate-600 focus:outline-none focus:border-teal-500/40 transition-colors"
              />
              <button
                onClick={handleSend}
                disabled={sending}
                aria-label="Send message"
                className="px-4 py-2.5 bg-teal-500/20 border border-teal-500/30 text-teal-400 text-xs font-medium rounded-xl hover:bg-teal-500/30 transition-colors disabled:opacity-50"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </motion.div>
      )}

      {view === "workspaces" && (
        <>
          {/* Filters */}
          <div className="flex items-center gap-2">
            {[
              { value: "all", label: "All Workspaces" },
              { value: "active", label: "Active" },
              { value: "draft", label: "Drafts" },
              { value: "completed", label: "Completed" },
            ].map((f) => (
              <button
                key={f.value}
                onClick={() => setFilter(f.value as WorkspaceStatus | "all")}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  filter === f.value
                    ? "bg-teal-500/20 border border-teal-500/30 text-teal-400"
                    : "bg-white/[0.04] border border-white/[0.08] text-slate-400 hover:bg-white/[0.08]"
                }`}
              >
                {f.label}
              </button>
            ))}
            <button
              onClick={() => {
                const first = allWorkspaces.find((w) => isDbWs(w.id));
                if (first) openThread(first);
              }}
              className="ml-auto px-3 py-1.5 rounded-lg text-xs font-medium bg-white/[0.04] border border-white/[0.08] text-slate-400 hover:bg-white/[0.08] transition-colors"
            >
              View Active Thread
            </button>
          </div>

          {/* Workspace Grid */}
          {loading && <LoadingState label="Loading workspaces…" />}
          {error && <ErrorState message={error} onRetry={refetch} />}
          <div className="space-y-3">
            {!loading &&
              !error &&
              filtered.map((ws, i) => (
                <div key={ws.id} onClick={() => openThread(ws)}>
                  <WorkspaceCard workspace={ws} index={i} />
                </div>
              ))}
          </div>

          {/* Cowork Explanation */}
          <div className="bg-[#0D1520] border border-teal-500/10 rounded-xl p-4 flex items-start gap-3">
            <Brain className="w-4 h-4 text-teal-400 flex-shrink-0 mt-0.5" />
            <div>
              <div className="text-sm font-bold text-teal-400">
                AI-Powered Collaboration
              </div>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                Cowork Studio connects you with SyncAI's 15 specialized agents.
                Start with a plain-language objective and the right agents will
                collaborate to produce actionable artifacts — RCA reports, PM
                plans, executive briefings, and more.
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
