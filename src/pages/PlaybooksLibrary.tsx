import { useState } from "react";
import { useNavigate } from "react-router-dom";
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
  CircleCheck as CheckCircle,
  Play,
  ClipboardList,
} from "lucide-react";
import { motion } from "framer-motion";
import { useAsyncData } from "../hooks/useAsyncData";
import {
  getRecommendations,
  getWorkOrders,
} from "../services/operatingLoopService";
import {
  LoadingState,
  ErrorState,
  EmptyState,
} from "../components/ui/AsyncStates";

/**
 * Playbook TEMPLATES — static best-practice reference content (methodology),
 * clearly presented as templates rather than org-specific live playbooks.
 * The live element on this page is the open-work context pulled from
 * recommendations and work_orders; activating a template routes to the live
 * work board.
 */
interface PlaybookTemplate {
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
  /** When true, the live critical-work count is surfaced on the card. */
  criticalScope?: boolean;
}

const templates: PlaybookTemplate[] = [
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
    criticalScope: true,
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
    criticalScope: true,
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
    criticalScope: true,
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

const CLOSED_WO_STATUSES = new Set([
  "done",
  "completed",
  "closed",
  "cancelled",
]);

interface LiveWorkContext {
  openRecommendations: number;
  criticalRecommendations: number;
  openWorkOrders: number;
  criticalWorkOrders: number;
}

function PlaybookCard({
  template,
  index,
  criticalOpenItems,
  onActivate,
}: {
  template: PlaybookTemplate;
  index: number;
  /** Live count of critical open recs + WOs; null while unavailable. */
  criticalOpenItems: number | null;
  onActivate: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const Icon = template.icon;
  const c = colorMap[template.color];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04 }}
      className={`bg-[#0D1520] border ${c.border} rounded-xl overflow-hidden cursor-pointer hover:border-white/12 transition-colors`}
      onClick={() => setExpanded(!expanded)}
    >
      <div className="p-4 flex items-start gap-3">
        <div className={`p-2 rounded-lg ${c.bg} shrink-0`}>
          <Icon className={`w-4 h-4 ${c.text}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-bold text-white">{template.title}</h4>
            <span className="text-xs px-1.5 py-0.5 rounded-full bg-white/6 border border-white/8 text-slate-300 font-semibold">
              Template
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">{template.objective}</p>
          <div className="flex items-center gap-3 mt-2 text-xs text-slate-400">
            <span className="flex items-center gap-1">
              <Users className="w-3 h-3" />
              {template.agents.length} agents
            </span>
            <span>{template.steps} steps</span>
            <span>{template.outputs.length} outputs</span>
            {template.criticalScope &&
              criticalOpenItems !== null &&
              criticalOpenItems > 0 && (
                <span className="flex items-center gap-1 text-red-400 font-semibold">
                  <AlertTriangle className="w-3 h-3" />
                  {criticalOpenItems} critical item
                  {criticalOpenItems === 1 ? "" : "s"} open now
                </span>
              )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onActivate();
            }}
            title="Template — activate to bind to live work"
            className={`flex items-center gap-1 px-3 py-1.5 ${c.bg} border ${c.border} ${c.text} text-xs font-medium rounded-lg hover:opacity-80 transition-opacity`}
          >
            <Play className="w-3 h-3" /> Activate
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
        <div className="px-4 pb-4 pt-0 border-t border-white/4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-3">
            <div>
              <div className="text-xs text-slate-400 uppercase tracking-wider mb-1">
                Trigger Conditions
              </div>
              <p className="text-xs text-slate-300">
                {template.triggerConditions}
              </p>
            </div>
            <div>
              <div className="text-xs text-slate-400 uppercase tracking-wider mb-1">
                Success Metrics
              </div>
              <p className="text-xs text-slate-300">
                {template.successMetrics}
              </p>
            </div>
            <div>
              <div className="text-xs text-slate-400 uppercase tracking-wider mb-1">
                Output Artifacts
              </div>
              <div className="flex flex-wrap gap-1">
                {template.outputs.map((o) => (
                  <span
                    key={o}
                    className="text-xs px-2 py-0.5 rounded-full bg-white/4 border border-white/6 text-slate-400"
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
              {template.agents.map((a) => (
                <span
                  key={a}
                  className={`text-xs px-2 py-0.5 rounded-full ${c.bg} ${c.text} font-medium`}
                >
                  {a}
                </span>
              ))}
            </div>
          </div>
          <div className="mt-3 text-xs text-slate-400">
            Template — activate to bind to live work on the Work Action Board.
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

export function PlaybooksLibrary() {
  const [search, setSearch] = useState("");
  const navigate = useNavigate();
  const { data, loading, error, refetch } = useAsyncData(
    () => Promise.all([getRecommendations(), getWorkOrders()]),
    [],
  );

  const filtered = search.trim()
    ? templates.filter(
        (p) =>
          p.title.toLowerCase().includes(search.toLowerCase()) ||
          p.objective.toLowerCase().includes(search.toLowerCase()),
      )
    : templates;

  let context: LiveWorkContext | null = null;
  if (data) {
    const [recs, wos] = data;
    const openRecs = recs.filter((r) => r.status === "pending");
    const openWos = wos.filter((w) => !CLOSED_WO_STATUSES.has(w.status));
    context = {
      openRecommendations: openRecs.length,
      criticalRecommendations: openRecs.filter((r) => r.urgency === "critical")
        .length,
      openWorkOrders: openWos.length,
      criticalWorkOrders: openWos.filter((w) => w.priority === "critical")
        .length,
    };
  }
  const criticalOpenItems = context
    ? context.criticalRecommendations + context.criticalWorkOrders
    : null;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            Playbooks
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Best-practice workflow templates — activate one to bind it to live
            work
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <BookOpen className="w-4 h-4 text-teal-400" />
          <span>{templates.length} templates available</span>
        </div>
      </div>

      {/* Live work context — from recommendations + work_orders */}
      {loading ? (
        <LoadingState label="Loading live work context…" />
      ) : error ? (
        <ErrorState message={error} onRetry={refetch} />
      ) : context &&
        context.openRecommendations === 0 &&
        context.openWorkOrders === 0 ? (
        <EmptyState message="No open work yet — templates activate against the live work board once recommendations or work orders exist." />
      ) : (
        context && (
          <div className="bg-[#0D1520] border border-white/6 rounded-xl p-4 flex flex-wrap items-center gap-x-6 gap-y-2">
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <ClipboardList className="w-4 h-4 text-teal-400" />
              <span className="font-bold text-slate-200 uppercase tracking-wider">
                Live work context
              </span>
            </div>
            <div className="text-sm text-slate-300">
              <span className="font-bold text-teal-400">
                {context.openRecommendations}
              </span>{" "}
              pending recommendation
              {context.openRecommendations === 1 ? "" : "s"}
              {context.criticalRecommendations > 0 && (
                <span className="text-red-400">
                  {" "}
                  ({context.criticalRecommendations} critical)
                </span>
              )}
            </div>
            <div className="text-sm text-slate-300">
              <span className="font-bold text-blue-400">
                {context.openWorkOrders}
              </span>{" "}
              open work order{context.openWorkOrders === 1 ? "" : "s"}
              {context.criticalWorkOrders > 0 && (
                <span className="text-red-400">
                  {" "}
                  ({context.criticalWorkOrders} critical priority)
                </span>
              )}
            </div>
            <button
              onClick={() => navigate("/work")}
              className="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-teal-500/10 border border-teal-500/20 rounded-lg text-xs font-medium text-teal-400 hover:bg-teal-500/20 transition-colors"
            >
              Open work board <ChevronRight className="w-3 h-3" />
            </button>
          </div>
        )
      )}

      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search templates..."
        className="w-full px-4 py-2.5 bg-[#0D1520] border border-white/6 rounded-xl text-sm text-white placeholder-slate-400 focus:outline-hidden focus:border-teal-500/40 transition-colors"
      />

      <div className="space-y-3">
        {filtered.map((pb, i) => (
          <PlaybookCard
            key={pb.id}
            template={pb}
            index={i}
            criticalOpenItems={criticalOpenItems}
            onActivate={() => navigate("/work")}
          />
        ))}
      </div>

      <div className="bg-[#0D1520] border border-teal-500/10 rounded-xl p-4 flex items-start gap-3">
        <BookOpen className="w-4 h-4 text-teal-400 shrink-0 mt-0.5" />
        <div>
          <div className="text-sm font-bold text-teal-400">
            Industrial Playbook Templates
          </div>
          <p className="text-xs text-slate-400 mt-1 leading-relaxed">
            These are reference templates that codify best-practice workflows
            for maintenance and reliability — not yet bound to this
            organization's history. The open-work counts above are live from
            your recommendations and work orders; activating a template takes
            you to the Work Action Board where that work lives.
          </p>
        </div>
      </div>
    </div>
  );
}
