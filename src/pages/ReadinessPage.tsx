import { useState } from "react";
import {
  Target,
  Activity,
  Package,
  Users,
  Shield,
  TriangleAlert as AlertTriangle,
  CircleCheck as CheckCircle,
  ChevronRight,
  Radio,
} from "lucide-react";
import { motion } from "framer-motion";

const readinessAreas = [
  {
    id: "asset",
    label: "Asset Health",
    score: 91,
    icon: Activity,
    color: "teal",
    status: "Ready",
    items: [
      { label: "Critical assets at risk", value: "2 of 62", ok: false },
      { label: "Assets monitored", value: "487", ok: true },
      { label: "Overdue inspections", value: "8", ok: false },
      { label: "Digital twin coverage", value: "34%", ok: true },
    ],
  },
  {
    id: "maintenance",
    label: "Maintenance Readiness",
    score: 84,
    icon: CheckCircle,
    color: "blue",
    status: "Watch",
    items: [
      { label: "Open work orders", value: "34", ok: true },
      { label: "Overdue WOs", value: "6", ok: false },
      { label: "PM Compliance", value: "88%", ok: true },
      { label: "Critical PMs due 7d", value: "4", ok: true },
    ],
  },
  {
    id: "parts",
    label: "Parts Availability",
    score: 76,
    icon: Package,
    color: "amber",
    status: "Caution",
    items: [
      { label: "Critical spares below reorder", value: "4", ok: false },
      { label: "Parts ready for scheduled WOs", value: "76%", ok: false },
      { label: "Open purchase orders", value: "12", ok: true },
      { label: "Average lead time", value: "8 days", ok: true },
    ],
  },
  {
    id: "workforce",
    label: "Workforce Readiness",
    score: 93,
    icon: Users,
    color: "teal",
    status: "Ready",
    items: [
      { label: "Technicians on shift", value: "8 of 8", ok: true },
      { label: "Certified for critical tasks", value: "7 of 8", ok: true },
      { label: "Training gaps identified", value: "2", ok: false },
      { label: "AI agents active", value: "15 of 15", ok: true },
    ],
  },
  {
    id: "safety",
    label: "Safety & Critical Controls",
    score: 98,
    icon: Shield,
    color: "green",
    status: "Ready",
    items: [
      { label: "Critical controls compliant", value: "98%", ok: true },
      { label: "Safety WOs overdue", value: "2", ok: false },
      { label: "LOTO compliance", value: "100%", ok: true },
      { label: "Open safety actions", value: "7", ok: true },
    ],
  },
  {
    id: "risk",
    label: "Operational Risk",
    score: 82,
    icon: AlertTriangle,
    color: "amber",
    status: "Watch",
    items: [
      { label: "Critical risk items", value: "2", ok: false },
      { label: "Total exposure", value: "$4.8M", ok: false },
      { label: "Overdue mitigations", value: "1", ok: false },
      { label: "Risk trend", value: "Improving", ok: true },
    ],
  },
];

const colorMap: Record<
  string,
  { text: string; bg: string; bar: string; ring: string }
> = {
  teal: {
    text: "text-teal-400",
    bg: "bg-teal-500/10",
    bar: "bg-teal-500",
    ring: "ring-teal-500/30",
  },
  blue: {
    text: "text-blue-400",
    bg: "bg-blue-500/10",
    bar: "bg-blue-500",
    ring: "ring-blue-500/30",
  },
  amber: {
    text: "text-amber-400",
    bg: "bg-amber-500/10",
    bar: "bg-amber-500",
    ring: "ring-amber-500/30",
  },
  green: {
    text: "text-green-400",
    bg: "bg-green-500/10",
    bar: "bg-green-500",
    ring: "ring-green-500/30",
  },
};

const statusColors: Record<string, string> = {
  Ready: "text-teal-400 bg-teal-500/10 border-teal-500/20",
  Watch: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  Caution: "text-amber-400 bg-amber-500/10 border-amber-500/30",
  Critical: "text-red-400 bg-red-500/10 border-red-500/20",
};

function ReadinessCard({ area }: { area: (typeof readinessAreas)[0] }) {
  const [expanded, setExpanded] = useState(false);
  const Icon = area.icon;
  const c = colorMap[area.color];

  return (
    <motion.div
      layout
      className={`bg-[#0D1520] border border-white/[0.06] rounded-xl overflow-hidden cursor-pointer hover:border-white/[0.12] transition-colors`}
      onClick={() => setExpanded(!expanded)}
    >
      <div className="p-4">
        <div className="flex items-center gap-3 mb-3">
          <div
            className={`w-9 h-9 rounded-xl ${c.bg} flex items-center justify-center flex-shrink-0`}
          >
            <Icon className={`w-4 h-4 ${c.text}`} />
          </div>
          <div className="flex-1">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-200">
                {area.label}
              </span>
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded-full border font-bold ${statusColors[area.status]}`}
              >
                {area.status}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <div className="flex-1 h-1.5 bg-white/[0.05] rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${area.score}%` }}
                  transition={{ duration: 0.8 }}
                  className={`h-full rounded-full ${c.bar}`}
                />
              </div>
              <span className={`text-sm font-black ${c.text}`}>
                {area.score}%
              </span>
            </div>
          </div>
        </div>

        {expanded && (
          <div className="pt-3 border-t border-white/[0.05] space-y-2">
            {area.items.map((item) => (
              <div
                key={item.label}
                className="flex items-center justify-between text-xs"
              >
                <span className="text-slate-500 flex items-center gap-1.5">
                  {item.ok ? (
                    <CheckCircle className="w-3 h-3 text-teal-400" />
                  ) : (
                    <AlertTriangle className="w-3 h-3 text-amber-400" />
                  )}
                  {item.label}
                </span>
                <span
                  className={`font-medium ${item.ok ? "text-teal-400" : "text-amber-400"}`}
                >
                  {item.value}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}

export function ReadinessPage() {
  const overallScore = Math.round(
    readinessAreas.reduce((acc, a) => acc + a.score, 0) / readinessAreas.length,
  );
  const statusLabel =
    overallScore >= 90 ? "Ready" : overallScore >= 80 ? "Watch" : "Caution";
  const statusColor =
    overallScore >= 90
      ? "text-teal-400"
      : overallScore >= 80
        ? "text-amber-400"
        : "text-red-400";

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-[11px] text-slate-600 mb-1">
            <Radio className="w-3 h-3 text-teal-400" />
            <span className="text-teal-400">LIVE</span>
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            Readiness
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Operational readiness across all dimensions
          </p>
        </div>
        <div className="text-right">
          <div className={`text-4xl font-black ${statusColor}`}>
            {overallScore}%
          </div>
          <div className={`text-sm font-bold mt-1 ${statusColor}`}>
            {statusLabel}
          </div>
        </div>
      </div>

      {/* Readiness Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {readinessAreas.map((area, i) => (
          <motion.div
            key={area.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.07 }}
          >
            <ReadinessCard area={area} />
          </motion.div>
        ))}
      </div>

      {/* Readiness Gap Insights */}
      <div className="bg-[#0D1520] border border-white/[0.06] rounded-2xl p-5">
        <h3 className="text-sm font-semibold text-slate-200 mb-4 flex items-center gap-2">
          <Target className="w-4 h-4 text-teal-400" /> Readiness Gaps —
          Recommended Actions
        </h3>
        <div className="space-y-2">
          {[
            {
              issue: "Parts below reorder point",
              action: "Trigger emergency procurement for 4 critical spares",
              owner: "Planner",
              urgency: "amber",
            },
            {
              issue: "8 assets with overdue inspections",
              action: "Schedule inspection work orders immediately",
              owner: "Maintenance Supervisor",
              urgency: "amber",
            },
            {
              issue: "2 critical assets at elevated risk",
              action: "Review and advance preventive maintenance",
              owner: "Maintenance Manager",
              urgency: "red",
            },
            {
              issue: "2 overdue safety work orders",
              action: "Assign and complete today — compliance risk",
              owner: "HSE Manager",
              urgency: "red",
            },
          ].map((gap, i) => (
            <div
              key={i}
              className={`flex items-start gap-3 p-3 rounded-xl border ${gap.urgency === "red" ? "border-red-500/20 bg-red-500/5" : "border-amber-500/20 bg-amber-500/5"}`}
            >
              <AlertTriangle
                className={`w-4 h-4 flex-shrink-0 mt-0.5 ${gap.urgency === "red" ? "text-red-400" : "text-amber-400"}`}
              />
              <div className="flex-1">
                <div className="text-xs font-semibold text-slate-200">
                  {gap.issue}
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  {gap.action}
                </div>
                <div className="text-[10px] text-slate-600 mt-0.5">
                  Owner: {gap.owner}
                </div>
              </div>
              <button className="text-teal-400 hover:text-teal-300 text-xs flex items-center gap-1 flex-shrink-0">
                Act <ChevronRight className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
