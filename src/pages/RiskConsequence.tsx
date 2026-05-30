import { useState } from "react";
import { TriangleAlert as AlertTriangle, TrendingDown, DollarSign, Clock, Activity, Shield, ChevronRight, ChartBar as BarChart2, Target, Zap, ArrowUpRight } from "lucide-react";
import { motion } from "framer-motion";

interface RiskItem {
  id: string;
  asset: string;
  area: string;
  failureProbability: number;
  failureWindow: string;
  consequence: "Catastrophic" | "Critical" | "High" | "Medium" | "Low";
  missionImpact: "High" | "Medium" | "Low";
  downtimeExposure: string;
  safetyRisk: "High" | "Medium" | "Low";
  environmentalRisk: "High" | "Medium" | "Low";
  financialExposure: string;
  recommendedIntervention: string;
  interventionWindow: string;
  riskScore: number;
}

const risks: RiskItem[] = [
  {
    id: "r1",
    asset: "Conveyor C-22",
    area: "Processing Plant A",
    failureProbability: 82,
    failureWindow: "9 days",
    consequence: "Critical",
    missionImpact: "High",
    downtimeExposure: "$2.4M",
    safetyRisk: "Medium",
    environmentalRisk: "Low",
    financialExposure: "$2.4M",
    recommendedIntervention: "Advance PM — bearing replacement",
    interventionWindow: "Within 36 hours",
    riskScore: 94,
  },
  {
    id: "r2",
    asset: "Pump P-101",
    area: "Cooling Circuit",
    failureProbability: 67,
    failureWindow: "14 days",
    consequence: "High",
    missionImpact: "High",
    downtimeExposure: "$1.1M",
    safetyRisk: "High",
    environmentalRisk: "Medium",
    financialExposure: "$1.1M",
    recommendedIntervention: "Seal replacement — schedule immediately",
    interventionWindow: "Within 72 hours",
    riskScore: 81,
  },
  {
    id: "r3",
    asset: "Compressor K-05",
    area: "Gas Handling",
    failureProbability: 44,
    failureWindow: "21 days",
    consequence: "High",
    missionImpact: "Medium",
    downtimeExposure: "$680K",
    safetyRisk: "High",
    environmentalRisk: "High",
    financialExposure: "$680K",
    recommendedIntervention: "Increase monitoring — prepare parts",
    interventionWindow: "Within 7 days",
    riskScore: 68,
  },
  {
    id: "r4",
    asset: "Heat Exchanger HX-08",
    area: "Utility Block",
    failureProbability: 31,
    failureWindow: "30 days",
    consequence: "Medium",
    missionImpact: "Low",
    downtimeExposure: "$290K",
    safetyRisk: "Low",
    environmentalRisk: "Medium",
    financialExposure: "$290K",
    recommendedIntervention: "Schedule for next planned outage",
    interventionWindow: "Within 30 days",
    riskScore: 42,
  },
  {
    id: "r5",
    asset: "Motor M-14",
    area: "Production Line 2",
    failureProbability: 28,
    failureWindow: "35 days",
    consequence: "Medium",
    missionImpact: "Medium",
    downtimeExposure: "$210K",
    safetyRisk: "Low",
    environmentalRisk: "Low",
    financialExposure: "$210K",
    recommendedIntervention: "Thermal scan — verify cooling",
    interventionWindow: "Within 14 days",
    riskScore: 36,
  },
  {
    id: "r6",
    asset: "Valve V-33",
    area: "Water Treatment",
    failureProbability: 18,
    failureWindow: "45 days",
    consequence: "Low",
    missionImpact: "Low",
    downtimeExposure: "$85K",
    safetyRisk: "Low",
    environmentalRisk: "Medium",
    financialExposure: "$85K",
    recommendedIntervention: "Inspect on next area walkdown",
    interventionWindow: "Within 45 days",
    riskScore: 21,
  },
];

const consequenceColors: Record<string, { color: string; bg: string; border: string }> = {
  Catastrophic: { color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/30" },
  Critical: { color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/30" },
  High: { color: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/30" },
  Medium: { color: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/30" },
  Low: { color: "text-slate-400", bg: "bg-slate-500/10", border: "border-slate-500/20" },
};

function RiskMatrix() {
  const cells: { prob: string; conseq: string; items: RiskItem[] }[] = [];
  const probBuckets = [
    { label: "Very High (80–100%)", min: 80 },
    { label: "High (60–80%)", min: 60 },
    { label: "Medium (40–60%)", min: 40 },
    { label: "Low (20–40%)", min: 20 },
    { label: "Very Low (<20%)", min: 0 },
  ];
  const consLevels = ["Low", "Medium", "High", "Critical", "Catastrophic"];

  const getColor = (prob: number, consIndex: number) => {
    const score = (prob / 100) * consIndex;
    if (score > 3) return "bg-red-500/30 border-red-500/40";
    if (score > 2) return "bg-amber-500/20 border-amber-500/30";
    if (score > 1) return "bg-blue-500/10 border-blue-500/20";
    return "bg-white/[0.02] border-white/[0.04]";
  };

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[500px]">
        <div className="flex items-center gap-2 mb-2">
          <div className="text-[10px] text-slate-600 uppercase tracking-wider w-32 text-right">Probability</div>
          <div className="flex-1 grid grid-cols-5 gap-1 text-[10px] text-slate-600 text-center">
            {consLevels.map((c) => <div key={c}>{c}</div>)}
          </div>
        </div>
        {probBuckets.map((bucket, pi) => (
          <div key={bucket.label} className="flex items-center gap-2 mb-1">
            <div className="text-[10px] text-slate-600 w-32 text-right">{bucket.label}</div>
            <div className="flex-1 grid grid-cols-5 gap-1">
              {consLevels.map((cons, ci) => {
                const inCell = risks.filter(
                  (r) =>
                    r.failureProbability >= bucket.min &&
                    (pi === 0 || r.failureProbability < probBuckets[pi - 1].min) &&
                    r.consequence === cons
                );
                return (
                  <div
                    key={cons}
                    className={`h-10 rounded border ${getColor(bucket.min, ci)} flex items-center justify-center text-xs font-bold text-white`}
                  >
                    {inCell.length > 0 ? inCell.length : ""}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        <div className="flex items-center gap-2 mt-1">
          <div className="w-32" />
          <div className="flex-1 text-[10px] text-slate-600 text-center">Consequence</div>
        </div>
      </div>
    </div>
  );
}

function RiskCard({ risk }: { risk: RiskItem }) {
  const [expanded, setExpanded] = useState(false);
  const c = consequenceColors[risk.consequence];
  const barColor = risk.riskScore >= 80 ? "bg-red-500" : risk.riskScore >= 60 ? "bg-amber-500" : risk.riskScore >= 40 ? "bg-blue-500" : "bg-slate-500";

  return (
    <motion.div
      layout
      className={`bg-[#0D1520] border ${c.border} rounded-xl overflow-hidden cursor-pointer`}
      onClick={() => setExpanded(!expanded)}
    >
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${c.bg} ${c.color} border ${c.border}`}>
                {risk.consequence}
              </span>
              <span className="text-[10px] text-slate-600">{risk.area}</span>
            </div>
            <h3 className="text-sm font-bold text-slate-200">{risk.asset}</h3>
            <div className="text-xs text-slate-500 mt-0.5">{risk.recommendedIntervention}</div>
          </div>
          <div className="text-right flex-shrink-0">
            <div className={`text-xl font-black ${c.color}`}>{risk.riskScore}</div>
            <div className="text-[10px] text-slate-600">Risk Score</div>
          </div>
        </div>

        <div className="mt-3 space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-600">Failure probability</span>
            <span className="text-slate-300 font-medium">{risk.failureProbability}% in {risk.failureWindow}</span>
          </div>
          <div className="h-1.5 bg-white/[0.05] rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${risk.failureProbability}%` }}
              transition={{ duration: 0.8 }}
              className={`h-full rounded-full ${barColor}`}
            />
          </div>
        </div>

        <div className="mt-3 flex items-center gap-4 text-xs">
          <div>
            <span className="text-slate-600">Exposure: </span>
            <span className={`font-bold ${c.color}`}>{risk.financialExposure}</span>
          </div>
          <div>
            <span className="text-slate-600">Act by: </span>
            <span className="text-slate-300">{risk.interventionWindow}</span>
          </div>
          <div className="ml-auto flex gap-2">
            {risk.safetyRisk === "High" && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20 font-semibold">
                Safety Risk
              </span>
            )}
            {risk.environmentalRisk === "High" && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-400 border border-green-500/20 font-semibold">
                Env Risk
              </span>
            )}
          </div>
        </div>

        {expanded && (
          <div className="mt-3 pt-3 border-t border-white/[0.05] grid grid-cols-2 gap-2 text-xs">
            <div><span className="text-slate-600">Mission Impact: </span><span className="text-slate-300">{risk.missionImpact}</span></div>
            <div><span className="text-slate-600">Safety Risk: </span><span className="text-slate-300">{risk.safetyRisk}</span></div>
            <div><span className="text-slate-600">Environmental: </span><span className="text-slate-300">{risk.environmentalRisk}</span></div>
            <div><span className="text-slate-600">Downtime Exposure: </span><span className="text-slate-300">{risk.downtimeExposure}</span></div>
            <div className="col-span-2">
              <button className="mt-2 w-full px-4 py-2 bg-teal-500/10 border border-teal-500/20 text-teal-400 text-xs font-medium rounded-lg hover:bg-teal-500/20 transition-colors flex items-center gap-2 justify-center">
                <Zap className="w-3 h-3" /> Create Intervention Work Order
              </button>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}

export function RiskConsequence() {
  const [view, setView] = useState<"list" | "matrix">("list");
  const [sortBy, setSortBy] = useState<"riskScore" | "probability" | "exposure">("riskScore");

  const totalExposure = risks.reduce((acc, r) => {
    const val = parseFloat(r.financialExposure.replace(/[^0-9.]/g, ""));
    const mult = r.financialExposure.includes("M") ? 1000000 : 1000;
    return acc + val * mult;
  }, 0);

  const sorted = [...risks].sort((a, b) => {
    if (sortBy === "riskScore") return b.riskScore - a.riskScore;
    if (sortBy === "probability") return b.failureProbability - a.failureProbability;
    return 0;
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Risk & Consequence</h1>
          <p className="text-sm text-slate-500 mt-0.5">Prioritized by consequence, not just work order priority</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setView("list")}
            className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${view === "list" ? "bg-teal-500/20 border-teal-500/30 text-teal-400" : "bg-white/[0.04] border-white/[0.08] text-slate-400"}`}
          >
            Risk List
          </button>
          <button
            onClick={() => setView("matrix")}
            className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${view === "matrix" ? "bg-teal-500/20 border-teal-500/30 text-teal-400" : "bg-white/[0.04] border-white/[0.08] text-slate-400"}`}
          >
            Risk Matrix
          </button>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total Exposure", value: `$${(totalExposure / 1000000).toFixed(1)}M`, icon: DollarSign, color: "red" },
          { label: "Critical Risks", value: risks.filter((r) => r.riskScore >= 80).length, icon: AlertTriangle, color: "red" },
          { label: "Action Required", value: risks.filter((r) => r.riskScore >= 60 && r.riskScore < 80).length, icon: Clock, color: "amber" },
          { label: "Advisory", value: risks.filter((r) => r.riskScore < 60).length, icon: BarChart2, color: "blue" },
        ].map((s) => {
          const Icon = s.icon;
          const colorMap: Record<string, string> = { red: "text-red-400 bg-red-500/10", amber: "text-amber-400 bg-amber-500/10", blue: "text-blue-400 bg-blue-500/10" };
          return (
            <div key={s.label} className="bg-[#0D1520] border border-white/[0.06] rounded-xl p-4">
              <div className={`w-8 h-8 rounded-lg ${colorMap[s.color]} flex items-center justify-center mb-2`}>
                <Icon className="w-4 h-4" />
              </div>
              <div className={`text-2xl font-black ${colorMap[s.color].split(" ")[0]}`}>{s.value}</div>
              <div className="text-[10px] text-slate-600 mt-0.5">{s.label}</div>
            </div>
          );
        })}
      </div>

      {view === "list" ? (
        <>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-600">Sort by:</span>
            {(["riskScore", "probability", "exposure"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSortBy(s)}
                className={`px-3 py-1 rounded-full text-xs transition-colors ${sortBy === s ? "bg-teal-500/20 text-teal-400 border border-teal-500/30" : "bg-white/[0.03] border border-white/[0.06] text-slate-500"}`}
              >
                {s === "riskScore" ? "Risk Score" : s === "probability" ? "Probability" : "Exposure"}
              </button>
            ))}
          </div>
          <div className="space-y-3">
            {sorted.map((risk, i) => (
              <motion.div key={risk.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.06 }}>
                <RiskCard risk={risk} />
              </motion.div>
            ))}
          </div>
        </>
      ) : (
        <div className="bg-[#0D1520] border border-white/[0.06] rounded-2xl p-6">
          <h3 className="text-sm font-semibold text-slate-200 mb-4 flex items-center gap-2">
            <Target className="w-4 h-4 text-teal-400" />
            Probability vs Consequence Matrix
          </h3>
          <RiskMatrix />
          <div className="mt-4 flex items-center gap-4 text-[11px]">
            <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded bg-red-500/30 border border-red-500/40" /><span className="text-slate-500">Critical / Unacceptable</span></div>
            <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded bg-amber-500/20 border border-amber-500/30" /><span className="text-slate-500">Action Required</span></div>
            <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded bg-blue-500/10 border border-blue-500/20" /><span className="text-slate-500">Advisory</span></div>
          </div>
        </div>
      )}

      {/* Risk Prioritization Note */}
      <div className="bg-[#0D1520] border border-white/[0.06] rounded-xl p-4 flex items-start gap-3">
        <Shield className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
        <div>
          <div className="text-sm font-medium text-blue-400">Consequence-First Prioritization</div>
          <p className="text-xs text-slate-400 mt-1 leading-relaxed">
            SyncAI prioritizes by <span className="text-slate-200">consequence × probability × time sensitivity</span>, not work order number.
            High-probability / low-consequence items rank below low-probability / catastrophic-consequence items.
            This approach reflects ISO 55000 asset criticality principles.
          </p>
        </div>
      </div>
    </div>
  );
}
