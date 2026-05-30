import { TrendingUp, TrendingDown, CircleCheck as CheckCircle, Circle as XCircle, ChartBar as BarChart2, Brain, Zap, ArrowUpRight, RefreshCw, BookOpen, Target } from "lucide-react";
import { motion } from "framer-motion";

const learningStats = [
  { label: "Recommendations Accepted", value: 84, suffix: "%", trend: "+4%", up: true, color: "teal" },
  { label: "False Positive Rate", value: 3, suffix: "%", trend: "-1%", up: true, color: "teal" },
  { label: "Savings Verified (MTD)", value: "$1.8M", suffix: "", trend: "+$0.3M", up: true, color: "blue" },
  { label: "Downtime Avoided (MTD)", value: "142 hr", suffix: "", trend: "+18 hr", up: true, color: "teal" },
  { label: "Model Confidence (Avg)", value: 88, suffix: "%", trend: "+2%", up: true, color: "teal" },
  { label: "Human Overrides", value: 4, suffix: "", trend: "-2", up: true, color: "amber" },
];

const recentLearnings = [
  {
    id: 1,
    type: "strategy_update",
    title: "Updated PM interval for Conveyor drive assemblies",
    source: "RCA finding — bearing failure root cause: under-lubrication",
    impact: "Reduced failure probability by 34%",
    agent: "Reliability Engineering",
    date: "2026-05-28",
    confidence: 91,
  },
  {
    id: 2,
    type: "model_improvement",
    title: "Improved seal failure prediction model for Pump P-101 class",
    source: "5 historical seal failures cross-correlated with process data",
    impact: "Prediction accuracy improved from 72% to 87%",
    agent: "Data Analytics",
    date: "2026-05-27",
    confidence: 87,
  },
  {
    id: 3,
    type: "false_positive_resolved",
    title: "Resolved false alarm on Compressor K-05 temperature sensor",
    source: "Human override — seasonal ambient temperature correlation identified",
    impact: "Model recalibrated — adjusted baseline for summer operation",
    agent: "Condition Monitoring",
    date: "2026-05-25",
    confidence: 95,
  },
  {
    id: 4,
    type: "rca_closed",
    title: "Closed RCA for Heat Exchanger HX-08 efficiency loss",
    source: "Root cause: fouling from upstream process change",
    impact: "New monitoring rule added — fouling index now tracked",
    agent: "Reliability Engineering",
    date: "2026-05-22",
    confidence: 89,
  },
];

const confidenceTrend = [78, 80, 81, 83, 84, 85, 86, 87, 88];
const acceptanceTrend = [74, 75, 77, 79, 80, 81, 83, 84, 84];

const typeConfig: Record<string, { color: string; bg: string; label: string }> = {
  strategy_update: { color: "text-teal-400", bg: "bg-teal-500/10", label: "Strategy Update" },
  model_improvement: { color: "text-blue-400", bg: "bg-blue-500/10", label: "Model Improvement" },
  false_positive_resolved: { color: "text-amber-400", bg: "bg-amber-500/10", label: "False Positive Fixed" },
  rca_closed: { color: "text-green-400", bg: "bg-green-500/10", label: "RCA Closed" },
};

function TrendLine({ data, color }: { data: number[]; color: string }) {
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const h = 50;
  const w = 200;
  const step = w / (data.length - 1);
  const points = data.map((v, i) => `${i * step},${h - ((v - min) / range) * h}`).join(" ");
  const areaPoints = `0,${h} ${points} ${(data.length - 1) * step},${h}`;
  return (
    <svg width={w} height={h} className="overflow-visible">
      <defs>
        <linearGradient id={`grad-${color}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={areaPoints} fill={`url(#grad-${color})`} />
      <polyline points={points} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={(data.length - 1) * step} cy={h - ((data[data.length - 1] - min) / range) * h} r={4} fill={color} />
    </svg>
  );
}

export function LearningLoop() {
  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Learning Loop</h1>
          <p className="text-sm text-slate-500 mt-0.5">SyncAI improves with every recommendation, outcome, and override</p>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-500/10 border border-teal-500/20 rounded-lg text-xs text-teal-400 font-medium">
          <RefreshCw className="w-3.5 h-3.5" />
          Active Learning
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {learningStats.map((s) => {
          const c: Record<string, string> = { teal: "text-teal-400 bg-teal-500/10", blue: "text-blue-400 bg-blue-500/10", amber: "text-amber-400 bg-amber-500/10" };
          const [textColor] = c[s.color].split(" ");
          return (
            <div key={s.label} className="bg-[#0D1520] border border-white/[0.06] rounded-xl p-4">
              <div className="text-[10px] text-slate-500 mb-1 leading-tight">{s.label}</div>
              <div className={`text-xl font-black ${textColor}`}>
                {s.value}{s.suffix}
              </div>
              <div className={`flex items-center gap-1 text-[11px] mt-1 ${s.up ? "text-teal-400" : "text-amber-400"}`}>
                {s.up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                {s.trend}
              </div>
            </div>
          );
        })}
      </div>

      {/* Trend Charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-[#0D1520] border border-white/[0.06] rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
              <Target className="w-4 h-4 text-teal-400" /> Model Confidence Trend
            </h3>
            <span className="text-xl font-black text-teal-400">88%</span>
          </div>
          <TrendLine data={confidenceTrend} color="#14b8a6" />
          <div className="mt-2 text-[10px] text-slate-600">Last 9 weeks · Fleet average confidence</div>
        </div>
        <div className="bg-[#0D1520] border border-white/[0.06] rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-blue-400" /> Recommendation Acceptance Rate
            </h3>
            <span className="text-xl font-black text-blue-400">84%</span>
          </div>
          <TrendLine data={acceptanceTrend} color="#3b82f6" />
          <div className="mt-2 text-[10px] text-slate-600">Last 9 weeks · Approved / total recommendations</div>
        </div>
      </div>

      {/* Recent Learnings */}
      <div className="bg-[#0D1520] border border-white/[0.06] rounded-2xl p-5">
        <h3 className="text-sm font-semibold text-slate-200 mb-4 flex items-center gap-2">
          <Brain className="w-4 h-4 text-teal-400" /> Recent Learning Events
        </h3>
        <div className="space-y-3">
          {recentLearnings.map((item, i) => {
            const tc = typeConfig[item.type];
            return (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.07 }}
                className="flex items-start gap-3 p-3 bg-white/[0.02] rounded-xl border border-white/[0.04]"
              >
                <div className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${tc.bg} ${tc.color} whitespace-nowrap flex-shrink-0`}>
                  {tc.label}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-slate-200">{item.title}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{item.source}</div>
                  <div className="flex items-center gap-3 mt-1.5 text-xs">
                    <span className="text-teal-400 font-medium">{item.impact}</span>
                    <span className="text-slate-600">·</span>
                    <span className="text-slate-500">{item.agent}</span>
                    <span className="text-slate-600">·</span>
                    <span className="text-slate-600">{item.date}</span>
                    <span className="ml-auto font-mono text-slate-500">{item.confidence}% conf</span>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Learning Loop Explanation */}
      <div className="bg-[#0D1520] border border-teal-500/20 rounded-xl p-4 flex items-start gap-3">
        <Zap className="w-4 h-4 text-teal-400 flex-shrink-0 mt-0.5" />
        <div>
          <div className="text-sm font-bold text-teal-400">Closed-Loop Learning</div>
          <p className="text-xs text-slate-400 mt-1 leading-relaxed">
            Every approved recommendation, rejected override, and verified outcome feeds back into SyncAI's models.
            Over time, the system becomes smarter about your specific assets, failure modes, and operating conditions.
            <span className="text-slate-200"> This is what separates SyncAI from a static rule-based CMMS.</span>
          </p>
        </div>
      </div>
    </div>
  );
}
