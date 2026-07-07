import { Shield, Eye, Database, Brain, Lock } from "lucide-react";
import { motion } from "framer-motion";

const trustMetrics = [
  { label: "Avg Model Confidence", value: "88%", color: "teal" },
  { label: "Data Quality Score", value: "94%", color: "teal" },
  { label: "Human Override Rate", value: "16%", color: "amber" },
  { label: "Recommendation Accuracy", value: "91%", color: "teal" },
  { label: "Audit Trail Coverage", value: "100%", color: "green" },
  { label: "Explainability Score", value: "87%", color: "blue" },
];

const recentDecisions = [
  {
    id: 1,
    title: "Reschedule PM on Conveyor C-22",
    confidence: 91,
    dataQuality: 96,
    sources: 5,
    model: "bearing-failure-rf-v4.2",
    outcome: "Approved",
    uncertainty: "Low",
    overrideHistory: 0,
  },
  {
    id: 2,
    title: "Order seal kit for Pump P-101",
    confidence: 87,
    dataQuality: 92,
    sources: 4,
    model: "seal-degradation-v3.1",
    outcome: "Auto-executed",
    uncertainty: "Low",
    overrideHistory: 1,
  },
  {
    id: 3,
    title: "Increase monitoring on K-05",
    confidence: 78,
    dataQuality: 88,
    sources: 3,
    model: "thermal-anomaly-v2.4",
    outcome: "Approved",
    uncertainty: "Medium",
    overrideHistory: 0,
  },
  {
    id: 4,
    title: "Defer PM on Pump P-203",
    confidence: 72,
    dataQuality: 85,
    sources: 3,
    model: "pm-optimization-v5.0",
    outcome: "Rejected",
    uncertainty: "Medium",
    overrideHistory: 2,
  },
  {
    id: 5,
    title: "Replace idler on Conveyor C-15",
    confidence: 94,
    dataQuality: 97,
    sources: 6,
    model: "idler-failure-rf-v3.8",
    outcome: "Auto-executed",
    uncertainty: "Low",
    overrideHistory: 0,
  },
];

const colorMap: Record<string, { text: string; bg: string }> = {
  teal: { text: "text-teal-400", bg: "bg-teal-500/10" },
  blue: { text: "text-blue-400", bg: "bg-blue-500/10" },
  amber: { text: "text-amber-400", bg: "bg-amber-500/10" },
  green: { text: "text-green-400", bg: "bg-green-500/10" },
};

const outcomeColors: Record<string, string> = {
  Approved: "text-teal-400 bg-teal-500/10",
  "Auto-executed": "text-blue-400 bg-blue-500/10",
  Rejected: "text-red-400 bg-red-500/10",
};

export function TrustExplainability() {
  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            Trust & Explainability
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Every AI decision is traceable, explainable, and auditable
          </p>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-green-500/10 border border-green-500/20 rounded-lg text-xs text-green-400 font-medium">
          <Lock className="w-3.5 h-3.5" /> Full Audit Trail
        </div>
      </div>

      {/* Trust Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {trustMetrics.map((m) => {
          const c = colorMap[m.color];
          return (
            <div
              key={m.label}
              className="bg-[#0D1520] border border-white/[0.06] rounded-xl p-4"
            >
              <div className="text-xs text-slate-400 mb-1">{m.label}</div>
              <div className={`text-xl font-black ${c.text}`}>{m.value}</div>
            </div>
          );
        })}
      </div>

      {/* Explainability Principles */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          {
            icon: Eye,
            title: "Transparent Reasoning",
            description:
              "Every recommendation shows the data, assumptions, and models used. No black boxes.",
            color: "teal",
          },
          {
            icon: Database,
            title: "Source Lineage",
            description:
              "All evidence is traceable to source systems with data quality scores and freshness timestamps.",
            color: "blue",
          },
          {
            icon: Shield,
            title: "Immutable Audit Trail",
            description:
              "Every decision, override, and outcome is permanently logged and cannot be modified after the fact.",
            color: "green",
          },
        ].map((p) => {
          const Icon = p.icon;
          const c = colorMap[p.color];
          return (
            <div
              key={p.title}
              className="bg-[#0D1520] border border-white/[0.06] rounded-2xl p-5"
            >
              <div className={`p-2.5 rounded-xl ${c.bg} w-fit mb-3`}>
                <Icon className={`w-5 h-5 ${c.text}`} />
              </div>
              <h3 className="text-sm font-bold text-white mb-1">{p.title}</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                {p.description}
              </p>
            </div>
          );
        })}
      </div>

      {/* Decision Trace Table */}
      <div className="bg-[#0D1520] border border-white/[0.06] rounded-2xl p-5">
        <h3 className="text-sm font-semibold text-slate-200 mb-4 flex items-center gap-2">
          <Brain className="w-4 h-4 text-teal-400" /> Recent Decision Traces
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/[0.06]">
                <th className="text-left py-3 px-3 text-slate-400 font-semibold">
                  Decision
                </th>
                <th className="text-center py-3 px-2 text-slate-400 font-semibold">
                  Confidence
                </th>
                <th className="text-center py-3 px-2 text-slate-400 font-semibold">
                  Data Quality
                </th>
                <th className="text-center py-3 px-2 text-slate-400 font-semibold">
                  Sources
                </th>
                <th className="text-center py-3 px-2 text-slate-400 font-semibold">
                  Uncertainty
                </th>
                <th className="text-center py-3 px-2 text-slate-400 font-semibold">
                  Model
                </th>
                <th className="text-center py-3 px-2 text-slate-400 font-semibold">
                  Overrides
                </th>
                <th className="text-center py-3 px-2 text-slate-400 font-semibold">
                  Outcome
                </th>
              </tr>
            </thead>
            <tbody>
              {recentDecisions.map((d, i) => (
                <motion.tr
                  key={d.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.05 }}
                  className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors"
                >
                  <td className="py-3 px-3 text-slate-200 font-medium">
                    {d.title}
                  </td>
                  <td className="py-3 px-2 text-center">
                    <span
                      className={`font-mono font-bold ${d.confidence >= 85 ? "text-teal-400" : d.confidence >= 75 ? "text-amber-400" : "text-red-400"}`}
                    >
                      {d.confidence}%
                    </span>
                  </td>
                  <td className="py-3 px-2 text-center text-slate-300 font-mono">
                    {d.dataQuality}%
                  </td>
                  <td className="py-3 px-2 text-center text-slate-400">
                    {d.sources}
                  </td>
                  <td className="py-3 px-2 text-center">
                    <span
                      className={`px-1.5 py-0.5 rounded-full text-xs font-bold ${d.uncertainty === "Low" ? "bg-teal-500/10 text-teal-400" : "bg-amber-500/10 text-amber-400"}`}
                    >
                      {d.uncertainty}
                    </span>
                  </td>
                  <td className="py-3 px-2 text-center text-slate-400 font-mono text-xs">
                    {d.model}
                  </td>
                  <td className="py-3 px-2 text-center text-slate-400">
                    {d.overrideHistory}
                  </td>
                  <td className="py-3 px-2 text-center">
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-bold ${outcomeColors[d.outcome]}`}
                    >
                      {d.outcome}
                    </span>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-[#0D1520] border border-teal-500/10 rounded-xl p-4 flex items-start gap-3">
        <Shield className="w-4 h-4 text-teal-400 flex-shrink-0 mt-0.5" />
        <div>
          <div className="text-sm font-bold text-teal-400">
            Enterprise-Grade Trust
          </div>
          <p className="text-xs text-slate-400 mt-1 leading-relaxed">
            SyncAI meets the explainability and auditability requirements of
            Suncor, Shell, military, SpaceX, and other mission-critical
            environments. Every recommendation can be traced from decision to
            source data.
          </p>
        </div>
      </div>
    </div>
  );
}
