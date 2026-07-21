import { TrendingUp, TrendingDown, ChartBar as BarChart2 } from "lucide-react";
import { motion } from "framer-motion";

const kpis = [
  {
    label: "Mission Readiness",
    value: "87%",
    trend: "+2%",
    trendUp: true,
    target: "95%",
    category: "Mission",
    color: "teal",
  },
  {
    label: "Asset Availability",
    value: "94.2%",
    trend: "+0.4%",
    trendUp: true,
    target: "97%",
    category: "Asset",
    color: "teal",
  },
  {
    label: "OEE",
    value: "81.4%",
    trend: "+1.2%",
    trendUp: true,
    target: "85%",
    category: "Production",
    color: "blue",
  },
  {
    label: "MTBF (Fleet Avg)",
    value: "2,847 hr",
    trend: "+142 hr",
    trendUp: true,
    target: "3,000 hr",
    category: "Reliability",
    color: "teal",
  },
  {
    label: "MTTR (Fleet Avg)",
    value: "4.2 hr",
    trend: "-0.8 hr",
    trendUp: true,
    target: "3.0 hr",
    category: "Reliability",
    color: "teal",
  },
  {
    label: "PM Compliance",
    value: "88%",
    trend: "+3%",
    trendUp: true,
    target: "95%",
    category: "Maintenance",
    color: "blue",
  },
  {
    label: "Schedule Compliance",
    value: "79%",
    trend: "-2%",
    trendUp: false,
    target: "90%",
    category: "Maintenance",
    color: "amber",
  },
  {
    label: "Emergency Work %",
    value: "12%",
    trend: "-2%",
    trendUp: true,
    target: "<10%",
    category: "Maintenance",
    color: "amber",
  },
  {
    label: "Maintenance Cost / RAV",
    value: "3.1%",
    trend: "-0.2%",
    trendUp: true,
    target: "<2.5%",
    category: "Financial",
    color: "amber",
  },
  {
    label: "Downtime Cost (MTD)",
    value: "$2.1M",
    trend: "-$0.4M",
    trendUp: true,
    target: "<$1.5M",
    category: "Financial",
    color: "red",
  },
  {
    label: "Critical Control Compliance",
    value: "98%",
    trend: "0%",
    trendUp: true,
    target: "100%",
    category: "Safety",
    color: "green",
  },
  {
    label: "AI Actions Executed (MTD)",
    value: "142",
    trend: "+28",
    trendUp: true,
    target: "200",
    category: "AI",
    color: "blue",
  },
  {
    label: "AI Recommendation Acceptance",
    value: "84%",
    trend: "+4%",
    trendUp: true,
    target: "90%",
    category: "AI",
    color: "blue",
  },
  {
    label: "Autonomous Maintenance Rate",
    value: "68%",
    trend: "+8%",
    trendUp: true,
    target: "80%",
    category: "AI",
    color: "teal",
  },
  {
    label: "Closed-Loop Learning Score",
    value: "76/100",
    trend: "+5",
    trendUp: true,
    target: "90/100",
    category: "AI",
    color: "blue",
  },
  {
    label: "Asset Risk Index",
    value: "23.4",
    trend: "-1.8",
    trendUp: true,
    target: "<20",
    category: "Risk",
    color: "amber",
  },
];

const trendData = [
  { month: "Jan", availability: 92.1, mtbf: 2640, oee: 79.2, pmCompliance: 82 },
  { month: "Feb", availability: 93.0, mtbf: 2710, oee: 79.8, pmCompliance: 84 },
  { month: "Mar", availability: 92.8, mtbf: 2695, oee: 80.1, pmCompliance: 83 },
  { month: "Apr", availability: 93.5, mtbf: 2780, oee: 80.7, pmCompliance: 86 },
  { month: "May", availability: 94.2, mtbf: 2847, oee: 81.4, pmCompliance: 88 },
];

const colorMap: Record<string, { text: string; bg: string; bar: string }> = {
  teal: { text: "text-teal-400", bg: "bg-teal-500/10", bar: "bg-teal-500" },
  blue: { text: "text-blue-400", bg: "bg-blue-500/10", bar: "bg-blue-500" },
  amber: { text: "text-amber-400", bg: "bg-amber-500/10", bar: "bg-amber-500" },
  green: { text: "text-green-400", bg: "bg-green-500/10", bar: "bg-green-500" },
  red: { text: "text-red-400", bg: "bg-red-500/10", bar: "bg-red-500" },
};

function KPICard({ kpi, index }: { kpi: (typeof kpis)[0]; index: number }) {
  const c = colorMap[kpi.color];
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.03 }}
      className="bg-[#0D1520] border border-white/6 rounded-xl p-4 hover:border-white/12 transition-colors"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="text-xs text-slate-400 leading-tight">{kpi.label}</div>
        <span
          className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${c.bg} ${c.text}`}
        >
          {kpi.category}
        </span>
      </div>
      <div className={`text-2xl font-black ${c.text}`}>{kpi.value}</div>
      <div className="flex items-center justify-between mt-2">
        <div
          className={`flex items-center gap-1 text-xs ${kpi.trendUp ? "text-teal-400" : "text-amber-400"}`}
        >
          {kpi.trendUp ? (
            <TrendingUp className="w-3 h-3" />
          ) : (
            <TrendingDown className="w-3 h-3" />
          )}
          {kpi.trend}
        </div>
        <div className="text-xs text-slate-400">Target: {kpi.target}</div>
      </div>
    </motion.div>
  );
}

function MiniSparkline({
  data,
  field,
}: {
  data: typeof trendData;
  field: keyof (typeof trendData)[0];
}) {
  const values = data.map((d) => d[field] as number);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const height = 40;
  const width = 120;
  const step = width / (values.length - 1);
  const points = values
    .map((v, i) => `${i * step},${height - ((v - min) / range) * height}`)
    .join(" ");
  return (
    <svg width={width} height={height} className="overflow-visible">
      <polyline
        points={points}
        fill="none"
        stroke="#14b8a6"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {values.map((v, i) => (
        <circle
          key={i}
          cx={i * step}
          cy={height - ((v - min) / range) * height}
          r={i === values.length - 1 ? 3 : 2}
          fill={i === values.length - 1 ? "#14b8a6" : "#0f766e"}
        />
      ))}
    </svg>
  );
}

export function PerformanceDashboard() {
  const categories = [...new Set(kpis.map((k) => k.category))];
  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            Performance
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">
            ISO 55000-aligned KPIs · Month to date
          </p>
        </div>
        <div className="flex items-center gap-2">
          {["MTD", "QTD", "YTD"].map((p) => (
            <button
              key={p}
              className="px-3 py-1.5 bg-white/4 border border-white/8 rounded-lg text-xs text-slate-400 hover:bg-white/8 transition-colors"
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          {
            label: "Asset Availability Trend",
            field: "availability" as keyof (typeof trendData)[0],
            current: "94.2%",
            color: "teal",
          },
          {
            label: "MTBF Trend (hr)",
            field: "mtbf" as keyof (typeof trendData)[0],
            current: "2,847",
            color: "blue",
          },
          {
            label: "OEE Trend",
            field: "oee" as keyof (typeof trendData)[0],
            current: "81.4%",
            color: "teal",
          },
          {
            label: "PM Compliance Trend",
            field: "pmCompliance" as keyof (typeof trendData)[0],
            current: "88%",
            color: "amber",
          },
        ].map((t) => {
          const c = colorMap[t.color];
          return (
            <div
              key={t.label}
              className="bg-[#0D1520] border border-white/6 rounded-xl p-4"
            >
              <div className="text-xs text-slate-400 mb-1">{t.label}</div>
              <div className={`text-xl font-black ${c.text} mb-2`}>
                {t.current}
              </div>
              <MiniSparkline data={trendData} field={t.field} />
              <div className="text-xs text-slate-400 mt-1">5-month trend</div>
            </div>
          );
        })}
      </div>

      {categories.map((category) => (
        <div key={category}>
          <h3 className="text-sm font-semibold text-slate-400 mb-3 flex items-center gap-2">
            <BarChart2 className="w-3.5 h-3.5" />
            {category} KPIs
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
            {kpis
              .filter((k) => k.category === category)
              .map((kpi, i) => (
                <KPICard key={kpi.label} kpi={kpi} index={i} />
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}
