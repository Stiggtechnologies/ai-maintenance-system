import { useState } from "react";
import {
  BookOpen,
  Target,
  Wrench,
  Shield,
  TriangleAlert as AlertTriangle,
  Zap,
  Brain,
  FileText,
  ChevronRight,
  Users,
  Clock,
  CircleCheck as CheckCircle,
  Play,
} from "lucide-react";
import { motion } from "framer-motion";

interface Playbook {
  id: string;
  title: string;
  objective: string;
  icon: React.ElementType;
  color: string;
  agents: string[];
  steps: number;
  outputs: string[];
  triggerConditions: string;
  successMetrics: string;
  lastRun?: string;
  timesRun: number;
}

const playbooks: Playbook[] = [
  {
    id: "pb-1",
    title: "Bad Actor Elimination",
    objective: "Identify and eliminate chronic problem assets from the fleet",
    icon: Target,
    color: "red",
    agents: [
      "Reliability Engineering",
      "Data Analytics",
      "Maintenance Strategy",
    ],
    steps: 8,
    outputs: ["Bad actor report", "Elimination plan", "Cost-benefit analysis"],
    triggerConditions: "Asset exceeds 3 failures in 90 days",
    successMetrics: "Failures reduced by 50% within 6 months",
    lastRun: "2026-05-22",
    timesRun: 4,
  },
  {
    id: "pb-2",
    title: "PM Optimization",
    objective:
      "Optimize preventive maintenance intervals using failure and cost data",
    icon: Wrench,
    color: "blue",
    agents: [
      "Maintenance Strategy",
      "Data Analytics",
      "Reliability Engineering",
    ],
    steps: 6,
    outputs: ["Optimized PM schedule", "Cost analysis", "Risk assessment"],
    triggerConditions: "PM effectiveness below 65% or cost/benefit degraded",
    successMetrics: "PM effectiveness > 75%, reduced total cost",
    lastRun: "2026-05-28",
    timesRun: 7,
  },
  {
    id: "pb-3",
    title: "Shutdown Readiness",
    objective: "Validate readiness for planned shutdown or turnaround",
    icon: Shield,
    color: "cyan",
    agents: [
      "Planning & Scheduling",
      "Inventory Management",
      "Asset Management",
      "Compliance & Auditing",
    ],
    steps: 12,
    outputs: [
      "Readiness report",
      "Risk register",
      "Resource plan",
      "Go/no-go assessment",
    ],
    triggerConditions: "30 days before planned shutdown",
    successMetrics: "Zero critical scope additions during shutdown",
    lastRun: "2026-04-15",
    timesRun: 2,
  },
  {
    id: "pb-4",
    title: "RCA Playbook",
    objective: "Structured root cause analysis for significant failures",
    icon: Brain,
    color: "amber",
    agents: ["Reliability Engineering", "Quality Assurance", "Data Analytics"],
    steps: 7,
    outputs: ["RCA report", "Corrective actions", "Strategy updates"],
    triggerConditions: "Any Criticality A asset failure or repeat failure",
    successMetrics: "No repeat failure within 12 months",
    lastRun: "2026-05-27",
    timesRun: 12,
  },
  {
    id: "pb-5",
    title: "Critical Spares Optimization",
    objective:
      "Optimize critical spare parts inventory based on risk and usage",
    icon: AlertTriangle,
    color: "amber",
    agents: [
      "Inventory Management",
      "Financial & Contract",
      "Reliability Engineering",
    ],
    steps: 5,
    outputs: [
      "Spares optimization report",
      "Purchase recommendations",
      "Risk assessment",
    ],
    triggerConditions: "Quarterly review or stockout event",
    successMetrics: "Zero critical stockouts, inventory cost reduced 15%",
    timesRun: 3,
  },
  {
    id: "pb-6",
    title: "Asset Onboarding",
    objective: "Onboard new assets with complete strategy and monitoring setup",
    icon: Zap,
    color: "teal",
    agents: [
      "Asset Management",
      "Maintenance Strategy",
      "Condition Monitoring",
    ],
    steps: 9,
    outputs: [
      "Asset record",
      "PM strategy",
      "Monitoring plan",
      "Criticality assessment",
    ],
    triggerConditions: "New asset commissioned or acquired",
    successMetrics: "Full strategy deployed within 5 business days",
    timesRun: 8,
  },
  {
    id: "pb-7",
    title: "Reliability Program Setup",
    objective: "Build a complete reliability program from scratch",
    icon: Target,
    color: "teal",
    agents: [
      "Reliability Engineering",
      "Maintenance Strategy",
      "Data Analytics",
      "Training & Workforce",
    ],
    steps: 14,
    outputs: [
      "Reliability policy",
      "FMEA library",
      "PM program",
      "KPI framework",
      "Training plan",
    ],
    triggerConditions: "New site deployment or maturity gap identified",
    successMetrics: "Maturity level 3 within 12 months",
    timesRun: 1,
  },
  {
    id: "pb-8",
    title: "ISO 55000 Maturity Improvement",
    objective: "Improve asset management maturity aligned to ISO 55000",
    icon: FileText,
    color: "blue",
    agents: [
      "Compliance & Auditing",
      "Asset Management",
      "Continuous Improvement",
    ],
    steps: 10,
    outputs: [
      "Gap analysis",
      "Improvement roadmap",
      "Evidence package",
      "Audit report",
    ],
    triggerConditions: "Annual maturity assessment or audit preparation",
    successMetrics: "One maturity level improvement per year",
    timesRun: 2,
  },
  {
    id: "pb-9",
    title: "Emergency Response",
    objective:
      "Structured response to critical asset failure or safety incident",
    icon: AlertTriangle,
    color: "red",
    agents: [
      "Maintenance Operations",
      "Asset Management",
      "Compliance & Auditing",
    ],
    steps: 8,
    outputs: [
      "Incident report",
      "Recovery plan",
      "Root cause preliminary",
      "Lessons learned",
    ],
    triggerConditions: "Critical safety event or unplanned major failure",
    successMetrics: "Return to service within target MTTR",
    lastRun: "2026-05-30",
    timesRun: 3,
  },
  {
    id: "pb-10",
    title: "Mission Readiness Review",
    objective:
      "Comprehensive go/no-go assessment for mission-critical operations",
    icon: Shield,
    color: "green",
    agents: [
      "Asset Management",
      "Reliability Engineering",
      "Compliance & Auditing",
      "Maintenance Operations",
    ],
    steps: 11,
    outputs: [
      "Readiness report",
      "Risk register",
      "Go/no-go decision",
      "Contingency plans",
    ],
    triggerConditions: "Pre-mission or pre-production ramp-up",
    successMetrics: "Mission readiness score > 90%",
    lastRun: "2026-05-26",
    timesRun: 5,
  },
  {
    id: "pb-11",
    title: "Compliance Audit Playbook",
    objective:
      "Prepare evidence and documentation for regulatory or internal audits",
    icon: CheckCircle,
    color: "green",
    agents: ["Compliance & Auditing", "Quality Assurance", "Asset Management"],
    steps: 7,
    outputs: [
      "Audit evidence package",
      "Non-conformance report",
      "Action plan",
    ],
    triggerConditions: "Scheduled audit or regulatory notification",
    successMetrics: "Zero major non-conformances",
    timesRun: 4,
  },
];

const colorMap: Record<string, { text: string; bg: string; border: string }> = {
  teal: {
    text: "text-teal-400",
    bg: "bg-teal-500/10",
    border: "border-teal-500/20",
  },
  blue: {
    text: "text-blue-400",
    bg: "bg-blue-500/10",
    border: "border-blue-500/20",
  },
  amber: {
    text: "text-amber-400",
    bg: "bg-amber-500/10",
    border: "border-amber-500/20",
  },
  cyan: {
    text: "text-cyan-400",
    bg: "bg-cyan-500/10",
    border: "border-cyan-500/20",
  },
  green: {
    text: "text-green-400",
    bg: "bg-green-500/10",
    border: "border-green-500/20",
  },
  red: {
    text: "text-red-400",
    bg: "bg-red-500/10",
    border: "border-red-500/20",
  },
};

function PlaybookCard({
  playbook,
  index,
}: {
  playbook: Playbook;
  index: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const Icon = playbook.icon;
  const c = colorMap[playbook.color];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04 }}
      className={`bg-[#0D1520] border ${c.border} rounded-xl overflow-hidden cursor-pointer hover:border-white/[0.12] transition-colors`}
      onClick={() => setExpanded(!expanded)}
    >
      <div className="p-4 flex items-start gap-3">
        <div className={`p-2 rounded-lg ${c.bg} flex-shrink-0`}>
          <Icon className={`w-4 h-4 ${c.text}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-bold text-white">{playbook.title}</h4>
            <span className="text-xs text-slate-400 font-mono">
              x{playbook.timesRun} runs
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">{playbook.objective}</p>
          <div className="flex items-center gap-3 mt-2 text-xs text-slate-400">
            <span className="flex items-center gap-1">
              <Users className="w-3 h-3" />
              {playbook.agents.length} agents
            </span>
            <span>{playbook.steps} steps</span>
            <span>{playbook.outputs.length} outputs</span>
            {playbook.lastRun && (
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                Last: {playbook.lastRun}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={(e) => {
              e.stopPropagation();
            }}
            className={`flex items-center gap-1 px-3 py-1.5 ${c.bg} border ${c.border} ${c.text} text-xs font-medium rounded-lg hover:opacity-80 transition-opacity`}
          >
            <Play className="w-3 h-3" /> Run
          </button>
          <ChevronRight
            className={`w-3.5 h-3.5 text-slate-400 transition-transform ${expanded ? "rotate-90" : ""}`}
          />
        </div>
      </div>

      <motion.div
        initial={false}
        animate={{ height: expanded ? "auto" : 0, opacity: expanded ? 1 : 0 }}
        transition={{ duration: 0.15 }}
        className="overflow-hidden"
      >
        <div className="px-4 pb-4 pt-0 border-t border-white/[0.04]">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-3">
            <div>
              <div className="text-xs text-slate-400 uppercase tracking-wider mb-1">
                Trigger Conditions
              </div>
              <p className="text-xs text-slate-300">
                {playbook.triggerConditions}
              </p>
            </div>
            <div>
              <div className="text-xs text-slate-400 uppercase tracking-wider mb-1">
                Success Metrics
              </div>
              <p className="text-xs text-slate-300">
                {playbook.successMetrics}
              </p>
            </div>
            <div>
              <div className="text-xs text-slate-400 uppercase tracking-wider mb-1">
                Output Artifacts
              </div>
              <div className="flex flex-wrap gap-1">
                {playbook.outputs.map((o) => (
                  <span
                    key={o}
                    className="text-xs px-2 py-0.5 rounded-full bg-white/[0.04] border border-white/[0.06] text-slate-400"
                  >
                    {o}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div className="mt-3">
            <div className="text-xs text-slate-400 uppercase tracking-wider mb-1">
              Assigned Agents
            </div>
            <div className="flex flex-wrap gap-1.5">
              {playbook.agents.map((a) => (
                <span
                  key={a}
                  className={`text-xs px-2 py-0.5 rounded-full ${c.bg} ${c.text} font-medium`}
                >
                  {a}
                </span>
              ))}
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

export function PlaybooksLibrary() {
  const [search, setSearch] = useState("");
  const filtered = search.trim()
    ? playbooks.filter(
        (p) =>
          p.title.toLowerCase().includes(search.toLowerCase()) ||
          p.objective.toLowerCase().includes(search.toLowerCase()),
      )
    : playbooks;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            Playbooks
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Reusable industrial workflows powered by AI agents
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <BookOpen className="w-4 h-4 text-teal-400" />
          <span>{playbooks.length} playbooks available</span>
        </div>
      </div>

      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search playbooks..."
        className="w-full px-4 py-2.5 bg-[#0D1520] border border-white/[0.06] rounded-xl text-sm text-white placeholder-slate-600 focus:outline-none focus:border-teal-500/40 transition-colors"
      />

      <div className="space-y-3">
        {filtered.map((pb, i) => (
          <PlaybookCard key={pb.id} playbook={pb} index={i} />
        ))}
      </div>

      <div className="bg-[#0D1520] border border-teal-500/10 rounded-xl p-4 flex items-start gap-3">
        <BookOpen className="w-4 h-4 text-teal-400 flex-shrink-0 mt-0.5" />
        <div>
          <div className="text-sm font-bold text-teal-400">
            Industrial Playbooks
          </div>
          <p className="text-xs text-slate-400 mt-1 leading-relaxed">
            Playbooks codify best-practice workflows for maintenance and
            reliability. Each playbook assigns the right AI agents, gathers
            evidence, and produces actionable artifacts. Run them on-demand or
            configure automatic triggers.
          </p>
        </div>
      </div>
    </div>
  );
}
