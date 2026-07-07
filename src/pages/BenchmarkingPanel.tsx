import { TrendingUp, Target, Activity } from "lucide-react";
import { motion } from "framer-motion";

interface BenchmarkItem {
  metric: string;
  yourValue: string;
  benchmark: string;
  percentile: number;
  status: "above" | "at" | "below";
  gap: string;
}

const benchmarks: BenchmarkItem[] = [
  {
    metric: "Asset Availability",
    yourValue: "94.2%",
    benchmark: "96.5%",
    percentile: 42,
    status: "below",
    gap: "-2.3%",
  },
  {
    metric: "MTBF (Fleet Avg)",
    yourValue: "2,847 hr",
    benchmark: "2,400 hr",
    percentile: 72,
    status: "above",
    gap: "+447 hr",
  },
  {
    metric: "MTTR (Fleet Avg)",
    yourValue: "4.2 hr",
    benchmark: "3.8 hr",
    percentile: 38,
    status: "below",
    gap: "+0.4 hr",
  },
  {
    metric: "PM Compliance",
    yourValue: "88%",
    benchmark: "90%",
    percentile: 55,
    status: "at",
    gap: "-2%",
  },
  {
    metric: "Emergency Work %",
    yourValue: "12%",
    benchmark: "8%",
    percentile: 32,
    status: "below",
    gap: "+4%",
  },
  {
    metric: "Maintenance Cost / RAV",
    yourValue: "3.1%",
    benchmark: "2.8%",
    percentile: 40,
    status: "below",
    gap: "+0.3%",
  },
  {
    metric: "OEE",
    yourValue: "81.4%",
    benchmark: "84%",
    percentile: 48,
    status: "below",
    gap: "-2.6%",
  },
  {
    metric: "Schedule Compliance",
    yourValue: "79%",
    benchmark: "85%",
    percentile: 35,
    status: "below",
    gap: "-6%",
  },
  {
    metric: "AI Adoption Rate",
    yourValue: "84%",
    benchmark: "—",
    percentile: 95,
    status: "above",
    gap: "Top 5%",
  },
  {
    metric: "Reliability Growth",
    yourValue: "+18%",
    benchmark: "+8%",
    percentile: 88,
    status: "above",
    gap: "+10%",
  },
];

const insights = [
  {
    text: "Your haul truck MTBF is 18% above industry benchmark — driven by optimized PM intervals.",
    type: "positive",
  },
  {
    text: "Emergency work rate of 12% is above peer range (target < 8%). Focus on proactive planning.",
    type: "negative",
  },
  {
    text: "PM compliance is strong but schedule compliance gap suggests resource/planning constraint.",
    type: "neutral",
  },
  {
    text: "AI adoption rate places you in top 5% of SyncAI customers globally.",
    type: "positive",
  },
  {
    text: "Maintenance cost / RAV trending toward benchmark — projected to reach peer range by Q3.",
    type: "neutral",
  },
];

const statusColors: Record<string, { text: string; bg: string }> = {
  above: { text: "text-teal-400", bg: "bg-teal-500/10" },
  at: { text: "text-blue-400", bg: "bg-blue-500/10" },
  below: { text: "text-amber-400", bg: "bg-amber-500/10" },
};

export function BenchmarkingPanel() {
  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            Benchmarking
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Performance vs. industry benchmarks and peer organizations
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <Target className="w-4 h-4 text-teal-400" />
          <span>Industry: Oil Sands / Mining</span>
        </div>
      </div>

      {/* Benchmark Table */}
      <div className="bg-[#0D1520] border border-white/[0.06] rounded-2xl p-5">
        <h3 className="text-sm font-semibold text-slate-200 mb-4 flex items-center gap-2">
          <Activity className="w-4 h-4 text-teal-400" /> Performance vs.
          Benchmark
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/[0.06]">
                <th className="text-left py-3 px-3 text-slate-400 font-semibold">
                  Metric
                </th>
                <th className="text-center py-3 px-3 text-slate-400 font-semibold">
                  Your Value
                </th>
                <th className="text-center py-3 px-3 text-slate-400 font-semibold">
                  Benchmark
                </th>
                <th className="text-center py-3 px-3 text-slate-400 font-semibold">
                  Percentile
                </th>
                <th className="text-center py-3 px-3 text-slate-400 font-semibold">
                  Gap
                </th>
                <th className="text-center py-3 px-3 text-slate-400 font-semibold">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {benchmarks.map((b, i) => {
                const sc = statusColors[b.status];
                return (
                  <motion.tr
                    key={b.metric}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: i * 0.04 }}
                    className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors"
                  >
                    <td className="py-3 px-3 text-slate-200 font-medium">
                      {b.metric}
                    </td>
                    <td className="py-3 px-3 text-center font-mono text-slate-200">
                      {b.yourValue}
                    </td>
                    <td className="py-3 px-3 text-center font-mono text-slate-400">
                      {b.benchmark}
                    </td>
                    <td className="py-3 px-3 text-center">
                      <div className="flex items-center gap-2 justify-center">
                        <div className="w-16 h-1.5 bg-white/[0.05] rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${b.percentile >= 70 ? "bg-teal-500" : b.percentile >= 40 ? "bg-amber-500" : "bg-red-500"}`}
                            style={{ width: `${b.percentile}%` }}
                          />
                        </div>
                        <span className="font-mono text-slate-400 w-8 text-right">
                          {b.percentile}
                        </span>
                      </div>
                    </td>
                    <td
                      className={`py-3 px-3 text-center font-mono ${sc.text}`}
                    >
                      {b.gap}
                    </td>
                    <td className="py-3 px-3 text-center">
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-bold capitalize ${sc.bg} ${sc.text}`}
                      >
                        {b.status}
                      </span>
                    </td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* AI Insights */}
      <div className="bg-[#0D1520] border border-white/[0.06] rounded-2xl p-5">
        <h3 className="text-sm font-semibold text-slate-200 mb-4 flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-teal-400" /> Benchmark Insights
        </h3>
        <div className="space-y-2">
          {insights.map((insight, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -5 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.06 }}
              className="flex items-start gap-2 p-3 rounded-xl bg-white/[0.02] border border-white/[0.04]"
            >
              <div
                className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${
                  insight.type === "positive"
                    ? "bg-teal-400"
                    : insight.type === "negative"
                      ? "bg-amber-400"
                      : "bg-blue-400"
                }`}
              />
              <span className="text-sm text-slate-300 leading-relaxed">
                {insight.text}
              </span>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}
