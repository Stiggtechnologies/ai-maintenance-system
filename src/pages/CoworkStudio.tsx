import { useState } from "react";
import { Brain, Target, Wrench, Shield, FileText, Zap, Users, ChevronRight, Plus, Clock, Bot, Send, Layers, Rocket, TriangleAlert as AlertTriangle, CircleCheck as CheckCircle, Activity } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

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
}

const workspaces: Workspace[] = [
  { id: "ws-1", title: "Reliability Program Builder", objective: "Build a reliability program for Fort McMurray Site A", status: "active", agents: ["Reliability Engineering", "Data Analytics", "Maintenance Strategy"], progress: 62, artifacts: 4, created: "2026-05-25", lastActivity: "2 hr ago", icon: Target, color: "teal" },
  { id: "ws-2", title: "RCA Copilot — Pump P-101", objective: "Root cause analysis for repeated seal failures on P-101 class pumps", status: "active", agents: ["Reliability Engineering", "Condition Monitoring", "Quality Assurance"], progress: 78, artifacts: 3, created: "2026-05-27", lastActivity: "35 min ago", icon: Brain, color: "blue" },
  { id: "ws-3", title: "PM Optimization — Conveyor Class", objective: "Optimize preventive maintenance intervals for all belt conveyors", status: "active", agents: ["Maintenance Strategy", "Data Analytics", "Planning & Scheduling"], progress: 45, artifacts: 2, created: "2026-05-28", lastActivity: "4 hr ago", icon: Wrench, color: "amber" },
  { id: "ws-4", title: "Shutdown Readiness Plan Q3", objective: "Prepare shutdown readiness for July turnaround", status: "draft", agents: ["Planning & Scheduling", "Inventory Management", "Asset Management"], progress: 15, artifacts: 1, created: "2026-05-29", lastActivity: "1 day ago", icon: Shield, color: "cyan" },
  { id: "ws-5", title: "Executive Briefing — May", objective: "Prepare monthly executive asset performance briefing", status: "completed", agents: ["Data Analytics", "Financial & Contract", "Asset Management"], progress: 100, artifacts: 6, created: "2026-05-20", lastActivity: "3 days ago", icon: FileText, color: "green" },
  { id: "ws-6", title: "Mission Readiness Review", objective: "Prepare go / no-go readiness assessment for production ramp-up", status: "active", agents: ["Asset Management", "Reliability Engineering", "Compliance & Auditing", "Maintenance Operations"], progress: 55, artifacts: 3, created: "2026-05-26", lastActivity: "1 hr ago", icon: Rocket, color: "teal" },
];

const workspaceTemplates = [
  { id: "t-1", label: "Reliability Program Builder", icon: Target, description: "Build a complete reliability program for a site or asset class" },
  { id: "t-2", label: "RCA Copilot", icon: Brain, description: "Structured root cause analysis with AI evidence gathering" },
  { id: "t-3", label: "PM Optimization Workspace", icon: Wrench, description: "Optimize PM intervals using failure data and cost analysis" },
  { id: "t-4", label: "Shutdown Readiness", icon: Shield, description: "Prepare and validate shutdown/turnaround readiness" },
  { id: "t-5", label: "Executive Briefing Builder", icon: FileText, description: "Generate executive asset performance briefings" },
  { id: "t-6", label: "Asset Onboarding", icon: Layers, description: "Onboard new assets with strategy and PM setup" },
  { id: "t-7", label: "Continuous Improvement", icon: Zap, description: "90-day maintenance improvement plans" },
  { id: "t-8", label: "Mission Readiness", icon: Rocket, description: "Go / no-go readiness assessments" },
  { id: "t-9", label: "Compliance Audit", icon: CheckCircle, description: "Prepare for ISO 55000 or regulatory audits" },
  { id: "t-10", label: "Emergency Recovery", icon: AlertTriangle, description: "Post-incident recovery and return-to-service planning" },
];

const agentThread = [
  { agent: "Reliability Engineering", message: "Analyzed 847 failure records for belt conveyor class. Identified 3 dominant failure modes: bearing defects (42%), belt splice failures (28%), and idler seizures (18%).", time: "14:22", confidence: 91 },
  { agent: "Data Analytics", message: "Cross-referenced vibration data with failure events. Current PM interval of 90 days is suboptimal — data suggests 65-day interval reduces bearing failures by 34% with minimal cost increase.", time: "14:28", confidence: 87 },
  { agent: "Maintenance Strategy", message: "Proposed revised PM strategy: reduce interval to 70 days for critical conveyors (Criticality A), maintain 90 days for B-class. Estimated annual cost increase: $42K. Estimated downtime savings: $1.8M.", time: "14:35", confidence: 84 },
];

const statusConfig: Record<WorkspaceStatus, { color: string; bg: string; label: string }> = {
  active: { color: "text-teal-400", bg: "bg-teal-500/10", label: "Active" },
  completed: { color: "text-green-400", bg: "bg-green-500/10", label: "Completed" },
  draft: { color: "text-slate-400", bg: "bg-slate-500/10", label: "Draft" },
};

const colorMap: Record<string, string> = {
  teal: "text-teal-400 bg-teal-500/10 border-teal-500/20",
  blue: "text-blue-400 bg-blue-500/10 border-blue-500/20",
  amber: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  cyan: "text-cyan-400 bg-cyan-500/10 border-cyan-500/20",
  green: "text-green-400 bg-green-500/10 border-green-500/20",
};

function WorkspaceCard({ workspace, index }: { workspace: Workspace; index: number }) {
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
        <div className={`p-2.5 rounded-xl ${cm.split(" ").slice(1, 2).join(" ")} border ${cm.split(" ").slice(2).join(" ")} flex-shrink-0`}>
          <Icon className={`w-5 h-5 ${textColor}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-bold text-white truncate">{workspace.title}</h3>
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${sc.bg} ${sc.color}`}>{sc.label}</span>
          </div>
          <p className="text-xs text-slate-400 leading-relaxed">{workspace.objective}</p>

          <div className="flex items-center gap-4 mt-3">
            <div className="flex-1">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] text-slate-600">Progress</span>
                <span className="text-[10px] font-bold text-slate-400">{workspace.progress}%</span>
              </div>
              <div className="h-1.5 bg-white/[0.05] rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${workspace.status === "completed" ? "bg-green-500" : "bg-teal-500"}`} style={{ width: `${workspace.progress}%` }} />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4 mt-3 text-[10px] text-slate-500">
            <span className="flex items-center gap-1"><Bot className="w-3 h-3" />{workspace.agents.length} agents</span>
            <span className="flex items-center gap-1"><FileText className="w-3 h-3" />{workspace.artifacts} artifacts</span>
            <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{workspace.lastActivity}</span>
          </div>

          <div className="flex flex-wrap gap-1.5 mt-3">
            {workspace.agents.slice(0, 3).map((a) => (
              <span key={a} className="text-[10px] px-2 py-0.5 rounded-full bg-white/[0.04] border border-white/[0.06] text-slate-400">{a}</span>
            ))}
            {workspace.agents.length > 3 && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/[0.04] border border-white/[0.06] text-slate-500">+{workspace.agents.length - 3}</span>
            )}
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-slate-700 group-hover:text-teal-400 transition-colors flex-shrink-0 mt-1" />
      </div>
    </motion.div>
  );
}

export function CoworkStudio() {
  const [view, setView] = useState<"workspaces" | "new" | "thread">("workspaces");
  const [filter, setFilter] = useState<WorkspaceStatus | "all">("all");

  const filtered = filter === "all" ? workspaces : workspaces.filter(w => w.status === filter);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Cowork Studio</h1>
          <p className="text-sm text-slate-500 mt-0.5">Collaborative AI workspaces for maintenance, reliability, and mission assurance</p>
        </div>
        <button
          onClick={() => setView(view === "new" ? "workspaces" : "new")}
          className="flex items-center gap-1.5 px-4 py-2 bg-teal-500/20 border border-teal-500/30 text-teal-400 text-xs font-medium rounded-lg hover:bg-teal-500/30 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> New Workspace
        </button>
      </div>

      {view === "new" && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          {/* Objective Input */}
          <div className="bg-[#0D1520] border border-teal-500/20 rounded-2xl p-5">
            <h3 className="text-sm font-semibold text-slate-200 mb-3">Start with an objective</h3>
            <div className="flex gap-3">
              <input
                type="text"
                placeholder="e.g., Build a reliability program for this site..."
                className="flex-1 px-4 py-3 bg-white/[0.03] border border-white/[0.06] rounded-xl text-sm text-white placeholder-slate-600 focus:outline-none focus:border-teal-500/40 transition-colors"
              />
              <button className="flex items-center gap-1.5 px-4 py-3 bg-teal-500/20 border border-teal-500/30 text-teal-400 text-sm font-medium rounded-xl hover:bg-teal-500/30 transition-colors">
                <Send className="w-4 h-4" /> Start
              </button>
            </div>
          </div>

          {/* Templates */}
          <div>
            <h3 className="text-sm font-semibold text-slate-400 mb-3">Or choose a workspace template</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
              {workspaceTemplates.map((t) => {
                const TIcon = t.icon;
                return (
                  <button key={t.id} className="text-left p-4 bg-[#0D1520] border border-white/[0.06] rounded-xl hover:border-teal-500/30 hover:bg-teal-500/5 transition-all group">
                    <TIcon className="w-5 h-5 text-slate-500 group-hover:text-teal-400 transition-colors mb-2" />
                    <div className="text-xs font-semibold text-slate-200 mb-1">{t.label}</div>
                    <div className="text-[10px] text-slate-500 leading-relaxed">{t.description}</div>
                  </button>
                );
              })}
            </div>
          </div>
        </motion.div>
      )}

      {view === "thread" && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
          {/* Active Workspace Thread */}
          <div className="bg-[#0D1520] border border-white/[0.06] rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Wrench className="w-5 h-5 text-amber-400" />
                <div>
                  <h3 className="text-sm font-bold text-white">PM Optimization — Conveyor Class</h3>
                  <p className="text-[11px] text-slate-500">3 agents collaborating</p>
                </div>
              </div>
              <button onClick={() => setView("workspaces")} className="text-xs text-slate-500 hover:text-white transition-colors">Back to workspaces</button>
            </div>

            <div className="p-5 space-y-4 max-h-[400px] overflow-y-auto">
              {agentThread.map((msg, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.1 }}
                  className="flex items-start gap-3"
                >
                  <div className="w-8 h-8 rounded-lg bg-teal-500/10 border border-teal-500/20 flex items-center justify-center flex-shrink-0">
                    <Bot className="w-4 h-4 text-teal-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-bold text-teal-400">{msg.agent}</span>
                      <span className="text-[10px] text-slate-600">{msg.time}</span>
                      <span className="text-[10px] font-mono text-slate-500 ml-auto">{msg.confidence}% conf</span>
                    </div>
                    <p className="text-sm text-slate-300 leading-relaxed">{msg.message}</p>
                  </div>
                </motion.div>
              ))}
            </div>

            <div className="px-5 py-4 border-t border-white/[0.06] flex gap-3">
              <input
                type="text"
                placeholder="Ask the agents a question or provide direction..."
                className="flex-1 px-4 py-2.5 bg-white/[0.03] border border-white/[0.06] rounded-xl text-sm text-white placeholder-slate-600 focus:outline-none focus:border-teal-500/40 transition-colors"
              />
              <button className="px-4 py-2.5 bg-teal-500/20 border border-teal-500/30 text-teal-400 text-xs font-medium rounded-xl hover:bg-teal-500/30 transition-colors">
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
              onClick={() => setView("thread")}
              className="ml-auto px-3 py-1.5 rounded-lg text-xs font-medium bg-white/[0.04] border border-white/[0.08] text-slate-400 hover:bg-white/[0.08] transition-colors"
            >
              View Active Thread
            </button>
          </div>

          {/* Workspace Grid */}
          <div className="space-y-3">
            {filtered.map((ws, i) => (
              <WorkspaceCard key={ws.id} workspace={ws} index={i} />
            ))}
          </div>

          {/* Cowork Explanation */}
          <div className="bg-[#0D1520] border border-teal-500/10 rounded-xl p-4 flex items-start gap-3">
            <Brain className="w-4 h-4 text-teal-400 flex-shrink-0 mt-0.5" />
            <div>
              <div className="text-sm font-bold text-teal-400">AI-Powered Collaboration</div>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                Cowork Studio connects you with SyncAI's 15 specialized agents. Start with a plain-language objective and the right agents will collaborate to produce actionable artifacts — RCA reports, PM plans, executive briefings, and more.
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
