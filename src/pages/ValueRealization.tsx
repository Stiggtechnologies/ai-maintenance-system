import { TrendingUp, DollarSign, Clock, Shield, Zap, Target, Activity, ChevronRight, ArrowUpRight } from "lucide-react";
import { motion } from "framer-motion";

const valueSummary = {
  totalSavings: "$6.8M",
  downtimeAvoided: "384 hr",
  riskReduced: "$12.4M",
  productivityGain: "23%",
  annualizedValue: "$28.2M",
  roi: "14.2x",
};

const valueCategories = [
  { label: "Downtime Cost Avoided", value: "$4.2M", trend: "+$0.8M", icon: Clock, color: "teal", breakdown: "142 predicted failures intercepted before downtime" },
  { label: "Maintenance Cost Savings", value: "$1.4M", trend: "+$0.3M", icon: DollarSign, color: "blue", breakdown: "PM optimization + reduced emergency work" },
  { label: "Production Loss Prevented", value: "$890K", trend: "+$120K", icon: Activity, color: "amber", breakdown: "Proactive interventions preserving production schedule" },
  { label: "Risk Exposure Reduced", value: "$12.4M", trend: "-$2.1M", icon: Shield, color: "cyan", breakdown: "Active risk mitigation across top 20 critical assets" },
  { label: "Planner Productivity", value: "+23%", trend: "+4%", icon: Zap, color: "teal", breakdown: "AI-generated work plans and scheduling optimization" },
  { label: "Reliability Improvement", value: "+18%", trend: "+3%", icon: Target, color: "green", breakdown: "MTBF improvement from optimized strategies" },
];

const monthlyTrend = [
  { month: "Jan", value: 3.2 },
  { month: "Feb", value: 3.8 },
  { month: "Mar", value: 4.4 },
  { month: "Apr", value: 5.1 },
  { month: "May", value: 6.8 },
];

const verifiedSavings = [
  { id: 1, event: "Prevented Conveyor C-22 bearing failure", value: "$2.4M", date: "2026-05-28", verifiedBy: "Operations Manager", type: "downtime_avoided" },
  { id: 2, event: "Optimized PM intervals — 12 assets", value: "$340K", date: "2026-05-22", verifiedBy: "Reliability Engineer", type: "cost_savings" },
  { id: 3, event: "Early detection — Pump P-101 seal degradation", value: "$1.1M", date: "2026-05-20", verifiedBy: "Maintenance Manager", type: "downtime_avoided" },
  { id: 4, event: "Eliminated 3 bad actors from fleet", value: "$680K", date: "2026-05-15", verifiedBy: "Site Director", type: "reliability" },
  { id: 5, event: "Automated 28 inspection work orders", value: "$45K", date: "2026-05-12", verifiedBy: "Planning Lead", type: "productivity" },
];

const colorMap: Record<string, { text: string; bg: string }> = {
  teal: { text: "text-teal-400", bg: "bg-teal-500/10" },
  blue: { text: "text-blue-400", bg: "bg-blue-500/10" },
  amber: { text: "text-amber-400", bg: "bg-amber-500/10" },
  cyan: { text: "text-cyan-400", bg: "bg-cyan-500/10" },
  green: { text: "text-green-400", bg: "bg-green-500/10" },
};

function ValueTrendChart() {
  const values = monthlyTrend.map(d => d.value);
  const max = Math.max(...values);
  const h = 80;
  const w = 280;
  const step = w / (values.length - 1);
  const points = values.map((v, i) => `${i * step},${h - (v / max) * h}`).join(" ");
  const area = `0,${h} ${points} ${(values.length - 1) * step},${h}`;

  return (
    <svg width={w} height={h} className="overflow-visible">
      <defs>
        <linearGradient id="value-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#14b8a6" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#14b8a6" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill="url(#value-grad)" />
      <polyline points={points} fill="none" stroke="#14b8a6" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
      {values.map((v, i) => (
        <circle key={i} cx={i * step} cy={h - (v / max) * h} r={i === values.length - 1 ? 5 : 3} fill={i === values.length - 1 ? "#14b8a6" : "#0f766e"} />
      ))}
    </svg>
  );
}

export function ValueRealization() {
  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Value Realization</h1>
          <p className="text-sm text-slate-500 mt-0.5">What has SyncAI saved, improved, protected, and accelerated?</p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 bg-teal-500/10 border border-teal-500/20 rounded-lg">
          <DollarSign className="w-3.5 h-3.5 text-teal-400" />
          <span className="text-xs font-bold text-teal-400">ROI: {valueSummary.roi}</span>
        </div>
      </div>

      {/* Hero Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {[
          { label: "Verified Savings (MTD)", value: valueSummary.totalSavings, color: "teal" },
          { label: "Downtime Avoided", value: valueSummary.downtimeAvoided, color: "blue" },
          { label: "Risk Exposure Reduced", value: valueSummary.riskReduced, color: "amber" },
          { label: "Productivity Gain", value: valueSummary.productivityGain, color: "teal" },
          { label: "Annualized Value", value: valueSummary.annualizedValue, color: "cyan" },
          { label: "Platform ROI", value: valueSummary.roi, color: "green" },
        ].map((s) => {
          const c = colorMap[s.color];
          return (
            <div key={s.label} className="bg-[#0D1520] border border-white/[0.06] rounded-xl p-4">
              <div className="text-[10px] text-slate-500 mb-1">{s.label}</div>
              <div className={`text-xl font-black ${c.text}`}>{s.value}</div>
            </div>
          );
        })}
      </div>

      {/* Value Trend + Categories */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-[#0D1520] border border-white/[0.06] rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-slate-200">Cumulative Value (MTD)</h3>
            <span className="text-xl font-black text-teal-400">{valueSummary.totalSavings}</span>
          </div>
          <ValueTrendChart />
          <div className="flex items-center justify-between mt-3 text-[10px] text-slate-600">
            {monthlyTrend.map(d => <span key={d.month}>{d.month}</span>)}
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-xs text-teal-400">
            <ArrowUpRight className="w-3 h-3" />
            <span>+113% vs same period last year</span>
          </div>
        </div>

        <div className="lg:col-span-2 space-y-3">
          {valueCategories.map((cat, i) => {
            const Icon = cat.icon;
            const c = colorMap[cat.color];
            return (
              <motion.div
                key={cat.label}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                className="bg-[#0D1520] border border-white/[0.06] rounded-xl p-4 flex items-center gap-4"
              >
                <div className={`p-2.5 rounded-xl ${c.bg} flex-shrink-0`}>
                  <Icon className={`w-5 h-5 ${c.text}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-slate-200">{cat.label}</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">{cat.breakdown}</div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className={`text-lg font-black ${c.text}`}>{cat.value}</div>
                  <div className="text-[10px] text-teal-400 flex items-center gap-0.5 justify-end">
                    <TrendingUp className="w-2.5 h-2.5" />{cat.trend}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Verified Savings Log */}
      <div className="bg-[#0D1520] border border-white/[0.06] rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
            <Shield className="w-4 h-4 text-teal-400" /> Verified Savings Log
          </h3>
          <button className="text-[11px] text-teal-400 hover:text-teal-300 flex items-center gap-1">
            Export <ChevronRight className="w-3 h-3" />
          </button>
        </div>
        <div className="space-y-2">
          {verifiedSavings.map((item, i) => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="flex items-center gap-4 p-3 rounded-xl bg-white/[0.02] border border-white/[0.04]"
            >
              <div className="w-8 h-8 rounded-lg bg-teal-500/10 flex items-center justify-center flex-shrink-0">
                <DollarSign className="w-4 h-4 text-teal-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-slate-200">{item.event}</div>
                <div className="text-[10px] text-slate-500 mt-0.5">Verified by {item.verifiedBy} · {item.date}</div>
              </div>
              <div className="text-base font-black text-teal-400 flex-shrink-0">{item.value}</div>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}
