import { CircleCheck as CheckCircle, Circle, Lock, Zap, Eye, Users, Bot, ArrowRight } from "lucide-react";
import { motion } from "framer-motion";

interface MaturityLevel {
  level: number;
  title: string;
  subtitle: string;
  description: string;
  capabilities: string[];
  icon: React.ElementType;
  color: string;
  status: "completed" | "current" | "locked";
}

const maturityLevels: MaturityLevel[] = [
  {
    level: 1,
    title: "Visibility",
    subtitle: "Dashboards & Insights",
    description: "Full visibility into asset health, maintenance performance, and operational risk through integrated dashboards.",
    capabilities: ["Asset health monitoring", "KPI dashboards", "Alert management", "Integration with source systems", "Historical analysis"],
    icon: Eye,
    color: "green",
    status: "completed",
  },
  {
    level: 2,
    title: "Assisted",
    subtitle: "AI Recommendations",
    description: "AI analyzes data and provides recommendations, but all actions require human initiation.",
    capabilities: ["Predictive failure alerts", "AI recommendations", "Evidence-based insights", "Risk scoring", "Anomaly detection"],
    icon: Zap,
    color: "green",
    status: "completed",
  },
  {
    level: 3,
    title: "Human-in-the-Loop",
    subtitle: "AI Prepares, Human Approves",
    description: "AI prepares actions, creates work orders, and optimizes plans. Humans approve before execution.",
    capabilities: ["Auto-generated work orders", "PM optimization", "Scheduling recommendations", "Parts ordering (with approval)", "Automated reports"],
    icon: Users,
    color: "teal",
    status: "current",
  },
  {
    level: 4,
    title: "Controlled Autonomy",
    subtitle: "AI Executes Approved Classes",
    description: "AI executes defined classes of work autonomously based on confidence thresholds and governance rules.",
    capabilities: ["Autonomous inspections", "Auto-scheduling", "Auto-parts ordering (under limit)", "Self-optimizing PMs", "Autonomous monitoring adjustments"],
    icon: Bot,
    color: "blue",
    status: "locked",
  },
  {
    level: 5,
    title: "Autonomous M&R",
    subtitle: "AI-Run Maintenance Organization",
    description: "AI manages major portions of the maintenance and reliability function with minimal human intervention.",
    capabilities: ["Full autonomous maintenance", "Self-healing operations", "Predictive capital planning", "Autonomous reliability engineering", "Human oversight only"],
    icon: Bot,
    color: "cyan",
    status: "locked",
  },
];

const colorMap: Record<string, { text: string; bg: string; border: string; ring: string }> = {
  green: { text: "text-green-400", bg: "bg-green-500/10", border: "border-green-500/20", ring: "ring-green-500/30" },
  teal: { text: "text-teal-400", bg: "bg-teal-500/10", border: "border-teal-500/20", ring: "ring-teal-500/40" },
  blue: { text: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/20", ring: "ring-blue-500/20" },
  cyan: { text: "text-cyan-400", bg: "bg-cyan-500/10", border: "border-cyan-500/20", ring: "ring-cyan-500/20" },
};

export function AutonomyMaturity() {
  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Autonomy Maturity</h1>
          <p className="text-sm text-slate-500 mt-0.5">Your journey from visibility to autonomous maintenance and reliability</p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 bg-teal-500/10 border border-teal-500/20 rounded-lg">
          <span className="text-xs font-bold text-teal-400">Current: Level 3 — Human-in-the-Loop</span>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="bg-[#0D1520] border border-white/[0.06] rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-4">
          {maturityLevels.map((level, i) => (
            <div key={level.level} className="flex items-center flex-1">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-black ${
                level.status === "completed" ? "bg-green-500/20 text-green-400 ring-2 ring-green-500/30" :
                level.status === "current" ? "bg-teal-500/20 text-teal-400 ring-2 ring-teal-500/40 animate-pulse" :
                "bg-white/[0.05] text-slate-600 ring-1 ring-white/[0.08]"
              }`}>{level.level}</div>
              {i < maturityLevels.length - 1 && (
                <div className={`flex-1 h-0.5 mx-2 rounded-full ${
                  level.status === "completed" ? "bg-green-500/40" :
                  level.status === "current" ? "bg-gradient-to-r from-teal-500/40 to-white/[0.05]" :
                  "bg-white/[0.05]"
                }`} />
              )}
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between text-[10px] text-slate-600">
          {maturityLevels.map(l => <span key={l.level} className="text-center">{l.title}</span>)}
        </div>
      </div>

      {/* Level Cards */}
      <div className="space-y-4">
        {maturityLevels.map((level, i) => {
          const Icon = level.icon;
          const c = colorMap[level.color];
          const isLocked = level.status === "locked";

          return (
            <motion.div
              key={level.level}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08 }}
              className={`bg-[#0D1520] border rounded-2xl p-5 ${
                level.status === "current" ? `${c.border} ring-1 ${c.ring}` :
                isLocked ? "border-white/[0.04] opacity-70" : "border-white/[0.06]"
              }`}
            >
              <div className="flex items-start gap-4">
                <div className={`p-3 rounded-xl ${c.bg} flex-shrink-0 relative`}>
                  <Icon className={`w-5 h-5 ${c.text}`} />
                  {level.status === "completed" && (
                    <CheckCircle className="w-3.5 h-3.5 text-green-400 absolute -top-1 -right-1" />
                  )}
                  {isLocked && (
                    <Lock className="w-3 h-3 text-slate-500 absolute -top-1 -right-1" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-1">
                    <span className={`text-[10px] font-black uppercase tracking-wider ${c.text}`}>Level {level.level}</span>
                    <h3 className="text-base font-bold text-white">{level.title}</h3>
                    <span className="text-xs text-slate-500">— {level.subtitle}</span>
                    {level.status === "current" && (
                      <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full bg-teal-500/20 text-teal-400 font-bold">CURRENT</span>
                    )}
                  </div>
                  <p className="text-sm text-slate-400 leading-relaxed">{level.description}</p>
                  <div className="flex flex-wrap gap-2 mt-3">
                    {level.capabilities.map((cap) => (
                      <span key={cap} className={`text-[10px] px-2 py-0.5 rounded-full border ${isLocked ? "bg-white/[0.02] border-white/[0.05] text-slate-600" : `${c.bg} ${c.border} ${c.text}`}`}>
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
          <div className="text-sm font-bold text-teal-400">Progressive Adoption</div>
          <p className="text-xs text-slate-400 mt-1 leading-relaxed">
            SyncAI is designed for conservative enterprise adoption. Advance at your own pace — each level builds trust through demonstrated accuracy, governance, and value delivery before unlocking greater autonomy.
          </p>
        </div>
      </div>
    </div>
  );
}
