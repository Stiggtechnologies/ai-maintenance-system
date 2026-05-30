import { useState } from "react";
import { Target, TriangleAlert as AlertTriangle, CircleCheck as CheckCircle, Clock, TrendingUp, TrendingDown, Activity, Zap, DollarSign, Shield, Package, Users, Bot, ChevronRight, Eye, ThumbsUp, ArrowUpRight, Cpu, Radio, ChartBar as BarChart2, Swords } from "lucide-react";
import { motion } from "framer-motion";
import { EvidenceDrawer } from "../components/EvidenceDrawer";
import { ChallengeAIModal } from "../components/ChallengeAIModal";

const readinessScore = 87;
const readinessStatus = "Watch";
const readinessReason = "Parts risk and repeated conveyor failures threaten production plan.";

const readinessFactors = [
  { label: "Asset Health", score: 91, icon: Activity, color: "teal", trend: "up" },
  { label: "Maintenance Readiness", score: 84, icon: CheckCircle, color: "blue", trend: "down" },
  { label: "Parts Availability", score: 76, icon: Package, color: "amber", trend: "down" },
  { label: "Workforce Readiness", score: 93, icon: Users, color: "teal", trend: "up" },
  { label: "Safety Controls", score: 98, icon: Shield, color: "green", trend: "stable" },
  { label: "Operational Risk", score: 82, icon: AlertTriangle, color: "amber", trend: "down" },
];

const topRisks = [
  {
    id: 1,
    asset: "Conveyor C-22",
    probability: 82,
    failureWindow: "9 days",
    exposure: "$2.4M",
    missionImpact: "High",
    recommendedAction: "Intervention within 36 hours",
    urgency: "critical",
  },
  {
    id: 2,
    asset: "Pump P-101",
    probability: 67,
    failureWindow: "14 days",
    exposure: "$1.1M",
    missionImpact: "High",
    recommendedAction: "Schedule inspection within 72 hours",
    urgency: "action",
  },
  {
    id: 3,
    asset: "Compressor K-05",
    probability: 44,
    failureWindow: "21 days",
    exposure: "$680K",
    missionImpact: "Medium",
    recommendedAction: "Increase monitoring frequency",
    urgency: "advisory",
  },
  {
    id: 4,
    asset: "Heat Exchanger HX-08",
    probability: 31,
    failureWindow: "30 days",
    exposure: "$290K",
    missionImpact: "Low",
    recommendedAction: "Include in next planned shutdown",
    urgency: "advisory",
  },
];

const aiRecommendations = [
  {
    id: 1,
    title: "Reschedule PM on Conveyor C-22",
    asset: "Conveyor C-22",
    issue: "Vibration signature indicates bearing wear — 82% failure probability",
    action: "Advance PM from Day 14 to Day 3",
    impact: "$2.4M downtime risk mitigation",
    confidence: 91,
    urgency: "critical",
    approvalRequired: "Maintenance Manager",
    accountable: "Maintenance Manager",
    responsible: "Planner",
    consulted: "Operations Manager",
    informed: "Reliability Engineer",
  },
  {
    id: 2,
    title: "Order replacement seal kit for P-101",
    asset: "Pump P-101",
    issue: "Seal degradation detected — high probability of failure in 14 days",
    action: "Create purchase order for seal kit — est. $4,200",
    impact: "Prevents $1.1M unplanned downtime",
    confidence: 87,
    urgency: "action",
    approvalRequired: "Autonomous (< $5K)",
    accountable: "Planner",
    responsible: "Inventory",
    consulted: "Maintenance Lead",
    informed: "Site Manager",
  },
  {
    id: 3,
    title: "Increase sensor polling on K-05",
    asset: "Compressor K-05",
    issue: "Temperature deviation detected — early-stage anomaly",
    action: "Increase polling interval from 5min to 1min for 72 hours",
    impact: "Early detection reduces risk by 60%",
    confidence: 78,
    urgency: "advisory",
    approvalRequired: "Autonomous",
    accountable: "Reliability Engineer",
    responsible: "AI Agent",
    consulted: "Maintenance Lead",
    informed: "Technician",
  },
];

const aiStats = {
  actionsExecuted: 142,
  pendingApprovals: 7,
  recommendationsToday: 23,
  autonomousRate: 68,
};

const alertLevels: Record<string, { color: string; bg: string; border: string; dot: string }> = {
  critical: { color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/30", dot: "bg-red-500" },
  action: { color: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/30", dot: "bg-amber-500" },
  advisory: { color: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/30", dot: "bg-blue-400" },
};

function ScoreRing({ score, size = 120 }: { score: number; size?: number }) {
  const r = (size - 16) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  const color = score >= 90 ? "#10b981" : score >= 75 ? "#f59e0b" : "#ef4444";

  return (
    <svg width={size} height={size} className="transform -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1e2d3d" strokeWidth={8} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={8}
        strokeDasharray={circ}
        strokeDashoffset={offset}
        strokeLinecap="round"
        style={{ filter: `drop-shadow(0 0 6px ${color})` }}
      />
    </svg>
  );
}

function FactorBar({ factor }: { factor: (typeof readinessFactors)[0] }) {
  const Icon = factor.icon;
  const colorMap: Record<string, string> = {
    teal: "bg-teal-500",
    blue: "bg-blue-500",
    amber: "bg-amber-500",
    green: "bg-green-500",
    red: "bg-red-500",
  };

  return (
    <div className="flex items-center gap-3 py-1.5">
      <Icon className={`w-4 h-4 flex-shrink-0 text-${factor.color}-400`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-slate-400">{factor.label}</span>
          <div className="flex items-center gap-1.5">
            {factor.trend === "up" && <TrendingUp className="w-3 h-3 text-teal-400" />}
            {factor.trend === "down" && <TrendingDown className="w-3 h-3 text-amber-400" />}
            <span className="text-xs font-bold text-slate-200">{factor.score}%</span>
          </div>
        </div>
        <div className="h-1.5 bg-white/[0.05] rounded-full overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${factor.score}%` }}
            transition={{ duration: 0.8, ease: "easeOut", delay: 0.1 }}
            className={`h-full rounded-full ${colorMap[factor.color]}`}
            style={{ boxShadow: `0 0 8px ${factor.color === "teal" ? "rgba(20,184,166,0.5)" : factor.color === "amber" ? "rgba(245,158,11,0.5)" : "rgba(59,130,246,0.5)"}` }}
          />
        </div>
      </div>
    </div>
  );
}

function RecommendationCard({ rec, onEvidence, onChallenge }: { rec: (typeof aiRecommendations)[0]; onEvidence: () => void; onChallenge: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const level = alertLevels[rec.urgency];

  return (
    <motion.div
      layout
      className={`border ${level.border} ${level.bg} rounded-xl p-4 cursor-pointer`}
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 w-2 h-2 rounded-full ${level.dot} flex-shrink-0 mt-2 animate-pulse`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h4 className={`text-sm font-semibold ${level.color}`}>{rec.title}</h4>
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="text-[10px] text-slate-500 font-mono">
                {rec.confidence}% conf
              </span>
              <ChevronRight className={`w-3.5 h-3.5 text-slate-600 transition-transform ${expanded ? "rotate-90" : ""}`} />
            </div>
          </div>
          <div className="text-xs text-slate-400 mt-0.5">{rec.asset} · {rec.issue}</div>
          <div className="flex items-center gap-3 mt-2">
            <span className="text-xs text-teal-400 font-medium">{rec.impact}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${rec.approvalRequired.startsWith("Autonomous") ? "bg-teal-500/20 text-teal-400" : "bg-amber-500/20 text-amber-400"}`}>
              {rec.approvalRequired}
            </span>
          </div>

          <AnimatePresenceInline show={expanded}>
            <div className="mt-3 pt-3 border-t border-white/[0.06] space-y-2">
              <div className="text-xs text-slate-300">
                <span className="text-slate-500">Recommended: </span>{rec.action}
              </div>
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div>
                  <span className="text-slate-600">Accountable: </span>
                  <span className="text-slate-300">{rec.accountable}</span>
                </div>
                <div>
                  <span className="text-slate-600">Responsible: </span>
                  <span className="text-slate-300">{rec.responsible}</span>
                </div>
                <div>
                  <span className="text-slate-600">Consulted: </span>
                  <span className="text-slate-300">{rec.consulted}</span>
                </div>
                <div>
                  <span className="text-slate-600">Informed: </span>
                  <span className="text-slate-300">{rec.informed}</span>
                </div>
              </div>
              <div className="flex gap-2 mt-3">
                <button className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-500/20 border border-teal-500/30 text-teal-400 text-xs font-medium rounded-lg hover:bg-teal-500/30 transition-colors">
                  <ThumbsUp className="w-3 h-3" /> Approve
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onEvidence(); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-white/[0.04] border border-white/[0.08] text-slate-400 text-xs font-medium rounded-lg hover:bg-white/[0.08] transition-colors"
                >
                  <Eye className="w-3 h-3" /> Evidence
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onChallenge(); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-white/[0.04] border border-white/[0.08] text-amber-400 text-xs font-medium rounded-lg hover:bg-amber-500/10 transition-colors"
                >
                  <Swords className="w-3 h-3" /> Challenge
                </button>
              </div>
            </div>
          </AnimatePresenceInline>
        </div>
      </div>
    </motion.div>
  );
}

function AnimatePresenceInline({ show, children }: { show: boolean; children: React.ReactNode }) {
  return (
    <motion.div
      initial={false}
      animate={{ height: show ? "auto" : 0, opacity: show ? 1 : 0 }}
      transition={{ duration: 0.2 }}
      style={{ overflow: "hidden" }}
    >
      {children}
    </motion.div>
  );
}

export function MissionControl() {
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [challengeOpen, setChallengeOpen] = useState(false);
  const [selectedRec, setSelectedRec] = useState<(typeof aiRecommendations)[0] | null>(null);
  const scoreColor = readinessScore >= 90 ? "text-green-400" : readinessScore >= 75 ? "text-amber-400" : "text-red-400";
  const statusColor = readinessScore >= 90 ? "bg-green-500/20 text-green-400 border-green-500/30" : readinessScore >= 75 ? "bg-amber-500/20 text-amber-400 border-amber-500/30" : "bg-red-500/20 text-red-400 border-red-500/30";

  return (
    <div className="p-6 space-y-6 min-h-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-[11px] text-slate-600 mb-1">
            <Radio className="w-3 h-3 text-teal-400" />
            <span className="text-teal-400 font-medium">LIVE</span>
            <span>· Mission Control · SyncAI v3.0</span>
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Mission Control</h1>
          <p className="text-sm text-slate-500 mt-0.5">Can we safely and reliably deliver the production plan?</p>
        </div>
        <div className="flex items-center gap-2">
          <button className="px-4 py-2 bg-white/[0.04] border border-white/[0.08] rounded-lg text-xs text-slate-400 hover:bg-white/[0.08] transition-colors">
            Shift Brief
          </button>
          <button className="px-4 py-2 bg-teal-500/20 border border-teal-500/30 rounded-lg text-xs text-teal-400 font-medium hover:bg-teal-500/30 transition-colors flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5" /> Emergency Mode
          </button>
        </div>
      </div>

      {/* Mission Readiness Hero */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Readiness Score */}
        <div className="lg:col-span-1 bg-[#0D1520] border border-white/[0.06] rounded-2xl p-6 flex flex-col items-center justify-center relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-teal-500/5 to-transparent pointer-events-none" />
          <div className="text-xs text-slate-500 uppercase tracking-widest mb-4">Mission Readiness</div>
          <div className="relative">
            <ScoreRing score={readinessScore} size={140} />
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className={`text-4xl font-black ${scoreColor}`}>{readinessScore}</span>
              <span className="text-xs text-slate-500 font-medium">/ 100</span>
            </div>
          </div>
          <div className={`mt-4 px-3 py-1.5 rounded-full border text-xs font-bold ${statusColor}`}>
            {readinessStatus}
          </div>
          <p className="mt-3 text-xs text-slate-400 text-center leading-relaxed max-w-[200px]">
            {readinessReason}
          </p>
          <div className="mt-4 flex items-center gap-4 text-xs text-slate-500">
            <div className="flex items-center gap-1">
              <ArrowUpRight className="w-3 h-3 text-teal-400" />
              <span>+2 pts today</span>
            </div>
            <div className="flex items-center gap-1">
              <BarChart2 className="w-3 h-3 text-slate-500" />
              <span>vs 85 yesterday</span>
            </div>
          </div>
        </div>

        {/* Readiness Factors */}
        <div className="lg:col-span-2 bg-[#0D1520] border border-white/[0.06] rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-200">Readiness Factors</h2>
            <span className="text-[10px] text-slate-600">Updated 2 min ago</span>
          </div>
          <div className="space-y-1">
            {readinessFactors.map((factor) => (
              <FactorBar key={factor.label} factor={factor} />
            ))}
          </div>
        </div>
      </div>

      {/* AI Stats Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "AI Actions Executed", value: aiStats.actionsExecuted, icon: Cpu, color: "teal", sub: "last 24h" },
          { label: "Pending Approvals", value: aiStats.pendingApprovals, icon: Clock, color: "amber", sub: "require human" },
          { label: "Recommendations Today", value: aiStats.recommendationsToday, icon: Zap, color: "blue", sub: "across 15 agents" },
          { label: "Autonomous Rate", value: `${aiStats.autonomousRate}%`, icon: Bot, color: "teal", sub: "actions auto-executed" },
        ].map((stat) => {
          const Icon = stat.icon;
          const colorMap: Record<string, string> = {
            teal: "text-teal-400 bg-teal-500/10",
            amber: "text-amber-400 bg-amber-500/10",
            blue: "text-blue-400 bg-blue-500/10",
          };
          return (
            <div key={stat.label} className="bg-[#0D1520] border border-white/[0.06] rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className={`p-1.5 rounded-lg ${colorMap[stat.color]}`}>
                  <Icon className="w-3.5 h-3.5" />
                </div>
                <span className="text-[11px] text-slate-500">{stat.label}</span>
              </div>
              <div className={`text-2xl font-black ${colorMap[stat.color].split(" ")[0]}`}>{stat.value}</div>
              <div className="text-[10px] text-slate-600 mt-0.5">{stat.sub}</div>
            </div>
          );
        })}
      </div>

      {/* Top Risks + Recommendations */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Top Mission Risks */}
        <div className="bg-[#0D1520] border border-white/[0.06] rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              Top Mission Risks
            </h2>
            <button className="text-[11px] text-teal-400 hover:text-teal-300 flex items-center gap-1 transition-colors">
              View All <ChevronRight className="w-3 h-3" />
            </button>
          </div>
          <div className="space-y-3">
            {topRisks.map((risk, i) => {
              const level = alertLevels[risk.urgency];
              return (
                <motion.div
                  key={risk.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.08 }}
                  className={`flex items-start gap-3 p-3 rounded-xl border ${level.border} ${level.bg}`}
                >
                  <div className="flex-shrink-0 w-6 h-6 flex items-center justify-center">
                    <span className={`text-xs font-black ${level.color}`}>{i + 1}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-slate-200">{risk.asset}</span>
                      <span className={`text-xs font-bold ${level.color}`}>{risk.exposure}</span>
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {risk.probability}% failure probability · {risk.failureWindow} window
                    </div>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${level.border} ${level.color} font-semibold`}>
                        {risk.missionImpact} Impact
                      </span>
                      <span className="text-[10px] text-slate-500">{risk.recommendedAction}</span>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>

        {/* AI Recommendations */}
        <div className="bg-[#0D1520] border border-white/[0.06] rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
              <Zap className="w-4 h-4 text-teal-400" />
              Top AI Recommendations
            </h2>
            <button className="text-[11px] text-teal-400 hover:text-teal-300 flex items-center gap-1 transition-colors">
              View All <ChevronRight className="w-3 h-3" />
            </button>
          </div>
          <div className="space-y-3">
            {aiRecommendations.map((rec) => (
              <RecommendationCard
                key={rec.id}
                rec={rec}
                onEvidence={() => { setSelectedRec(rec); setEvidenceOpen(true); }}
                onChallenge={() => { setSelectedRec(rec); setChallengeOpen(true); }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Financial Exposure Row */}
      <div className="bg-[#0D1520] border border-white/[0.06] rounded-2xl p-6">
        <div className="flex items-center gap-2 mb-4">
          <DollarSign className="w-4 h-4 text-teal-400" />
          <h2 className="text-sm font-semibold text-slate-200">Top Financial Exposures</h2>
          <span className="text-[10px] text-slate-600 ml-auto">Based on failure probability × downtime cost</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { asset: "Conveyor C-22", exposure: "$2.4M", probability: 82, color: "red" },
            { asset: "Pump P-101", exposure: "$1.1M", probability: 67, color: "amber" },
            { asset: "Compressor K-05", exposure: "$680K", probability: 44, color: "blue" },
            { asset: "Heat Exchanger HX-08", exposure: "$290K", probability: 31, color: "slate" },
          ].map((item) => {
            const colorMap: Record<string, { text: string; bar: string; bg: string }> = {
              red: { text: "text-red-400", bar: "bg-red-500", bg: "bg-red-500/10" },
              amber: { text: "text-amber-400", bar: "bg-amber-500", bg: "bg-amber-500/10" },
              blue: { text: "text-blue-400", bar: "bg-blue-500", bg: "bg-blue-500/10" },
              slate: { text: "text-slate-400", bar: "bg-slate-500", bg: "bg-slate-500/10" },
            };
            const c = colorMap[item.color];
            return (
              <div key={item.asset} className={`p-4 rounded-xl ${c.bg} border border-white/[0.05]`}>
                <div className="text-xs text-slate-400 mb-1 truncate">{item.asset}</div>
                <div className={`text-xl font-black ${c.text}`}>{item.exposure}</div>
                <div className="mt-2 h-1.5 bg-white/[0.05] rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${c.bar}`}
                    style={{ width: `${item.probability}%` }}
                  />
                </div>
                <div className="text-[10px] text-slate-500 mt-1">{item.probability}% failure risk</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Evidence Drawer */}
      <EvidenceDrawer
        open={evidenceOpen}
        onClose={() => setEvidenceOpen(false)}
        title={selectedRec?.title || ""}
        asset={selectedRec?.asset}
      />

      {/* Challenge AI Modal */}
      <ChallengeAIModal
        open={challengeOpen}
        onClose={() => setChallengeOpen(false)}
        recommendation={selectedRec ? {
          title: selectedRec.title,
          confidence: selectedRec.confidence,
          asset: selectedRec.asset,
          action: selectedRec.action,
        } : undefined}
      />
    </div>
  );
}
