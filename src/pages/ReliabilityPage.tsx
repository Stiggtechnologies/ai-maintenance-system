import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  TrendingUp,
  TrendingDown,
  TriangleAlert as AlertTriangle,
  Activity,
  Search,
  ChevronRight,
  Zap,
  ChartBar as BarChart2,
  Clock,
  Layers,
} from "lucide-react";
import { motion } from "framer-motion";
import { useOnboardingOperatingLoop } from "../hooks/useOnboardingOperatingLoop";

const badActors = [
  {
    id: "ba1",
    asset: "Conveyor C-22",
    failures: 4,
    period: "12 months",
    mtbf: "68 days",
    cost: "$340K",
    trend: "worsening",
    rcaStatus: "In Progress",
  },
  {
    id: "ba2",
    asset: "Pump P-101",
    failures: 3,
    period: "12 months",
    mtbf: "94 days",
    cost: "$180K",
    trend: "stable",
    rcaStatus: "Completed",
  },
  {
    id: "ba3",
    asset: "Compressor K-05",
    failures: 2,
    period: "6 months",
    mtbf: "74 days",
    cost: "$290K",
    trend: "worsening",
    rcaStatus: "Open",
  },
  {
    id: "ba4",
    asset: "Motor M-14",
    failures: 2,
    period: "12 months",
    mtbf: "142 days",
    cost: "$95K",
    trend: "stable",
    rcaStatus: "Completed",
  },
];

const openRCAs = [
  {
    id: "r1",
    asset: "Conveyor C-22",
    title: "Repeated bearing failure — root cause investigation",
    status: "in_progress",
    daysOpen: 8,
    owner: "R. Smith",
    priority: "High",
  },
  {
    id: "r2",
    asset: "Compressor K-05",
    title: "Temperature exceedance — contributing factors",
    status: "open",
    daysOpen: 3,
    owner: "K. Patel",
    priority: "Medium",
  },
  {
    id: "r3",
    asset: "Pump P-101",
    title: "Seal failure recurrence analysis",
    status: "completed",
    daysOpen: 0,
    owner: "J. Lee",
    priority: "High",
  },
];

const reliabilityMetrics = [
  {
    label: "Fleet MTBF",
    value: "2,847 hr",
    trend: "+142 hr",
    up: true,
    note: "vs 2,705 hr last period",
  },
  {
    label: "Fleet MTTR",
    value: "4.2 hr",
    trend: "-0.8 hr",
    up: true,
    note: "vs 5.0 hr last period",
  },
  {
    label: "PM Effectiveness",
    value: "83%",
    trend: "+5%",
    up: true,
    note: "failures prevented by PM",
  },
  {
    label: "Bad Actors",
    value: "7 assets",
    trend: "-1",
    up: true,
    note: "eliminated 1 this period",
  },
  {
    label: "Repeated Failures",
    value: "4",
    trend: "-2",
    up: true,
    note: "vs 6 last period",
  },
  {
    label: "Reliability Growth",
    value: "+12%",
    trend: "+4%",
    up: true,
    note: "MTBF improvement YOY",
  },
];

export function Reliability() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<"bad-actors" | "rca" | "fmea" | "pm">(
    "bad-actors",
  );
  const [search, setSearch] = useState("");
  const { reliability } = useOnboardingOperatingLoop();
  const onboardingPmBlockers = reliability.filter(
    (item) => item.pmOptimizationBlockers.length > 0,
  );

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight">
          Reliability
        </h1>
        <p className="text-sm text-slate-500 mt-0.5">
          AI-powered reliability engineering department
        </p>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {reliabilityMetrics.map((m) => (
          <div
            key={m.label}
            className="bg-[#0D1520] border border-white/[0.06] rounded-xl p-4"
          >
            <div className="text-[10px] text-slate-500 mb-1 leading-tight">
              {m.label}
            </div>
            <div className="text-lg font-black text-teal-400">{m.value}</div>
            <div
              className={`flex items-center gap-1 text-[11px] mt-1 ${m.up ? "text-teal-400" : "text-amber-400"}`}
            >
              {m.up ? (
                <TrendingUp className="w-3 h-3" />
              ) : (
                <TrendingDown className="w-3 h-3" />
              )}
              {m.trend}
            </div>
            <div className="text-[10px] text-slate-600 mt-0.5">{m.note}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-white/[0.06]">
        {(
          [
            { id: "bad-actors", label: "Bad Actors" },
            { id: "rca", label: "RCA Workflow" },
            { id: "fmea", label: "FMEA / RCM" },
            { id: "pm", label: "PM Optimization" },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === t.id
                ? "border-teal-400 text-teal-400"
                : "border-transparent text-slate-500 hover:text-slate-300"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "bad-actors" && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-600" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search assets..."
                className="w-full pl-8 pr-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-lg text-xs text-slate-300 placeholder-slate-600 outline-none focus:border-teal-500/40"
              />
            </div>
          </div>
          {badActors
            .filter(
              (b) =>
                !search || b.asset.toLowerCase().includes(search.toLowerCase()),
            )
            .map((ba, i) => (
              <motion.div
                key={ba.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.07 }}
                className="bg-[#0D1520] border border-red-500/20 rounded-xl p-4 flex items-start gap-4"
              >
                <div className="flex-shrink-0 w-6 h-6 flex items-center justify-center">
                  <span className="text-sm font-black text-red-400">
                    {i + 1}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-3">
                    <h4 className="text-sm font-bold text-slate-200">
                      {ba.asset}
                    </h4>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded-full border font-semibold ${ba.trend === "worsening" ? "text-red-400 bg-red-500/10 border-red-500/20" : "text-amber-400 bg-amber-500/10 border-amber-500/20"}`}
                    >
                      {ba.trend}
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-3 mt-2 text-xs">
                    <div>
                      <span className="text-slate-600">Failures: </span>
                      <span className="text-red-400 font-bold">
                        {ba.failures}
                      </span>
                      <span className="text-slate-600"> in {ba.period}</span>
                    </div>
                    <div>
                      <span className="text-slate-600">MTBF: </span>
                      <span className="text-slate-300">{ba.mtbf}</span>
                    </div>
                    <div>
                      <span className="text-slate-600">Total Cost: </span>
                      <span className="text-amber-400 font-bold">
                        {ba.cost}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-600">RCA: </span>
                      <span
                        className={
                          ba.rcaStatus === "Completed"
                            ? "text-teal-400"
                            : ba.rcaStatus === "In Progress"
                              ? "text-blue-400"
                              : "text-amber-400"
                        }
                      >
                        {ba.rcaStatus}
                      </span>
                    </div>
                  </div>
                </div>
                <button className="text-teal-400 hover:text-teal-300 flex items-center gap-1 text-xs flex-shrink-0">
                  View <ChevronRight className="w-3 h-3" />
                </button>
              </motion.div>
            ))}
        </div>
      )}

      {tab === "rca" && (
        <div className="space-y-3">
          {reliability.map((item) => (
            <div
              key={`fracas-${item.sessionId}`}
              className="bg-[#0D1520] border border-cyan-500/20 rounded-xl p-4"
            >
              <div className="flex items-center gap-2 mb-2">
                <Layers className="w-4 h-4 text-cyan-400" />
                <h4 className="text-sm font-semibold text-slate-200">
                  {item.assetId} · FRACAS readiness
                </h4>
                <span
                  className={`ml-auto text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${item.fracasIntakeReady ? "bg-teal-500/10 text-teal-400" : "bg-amber-500/10 text-amber-400"}`}
                >
                  {item.fracasIntakeReady ? "Intake ready" : "Intake pending"}
                </span>
              </div>
              <div className="text-[11px] text-slate-500 mb-1">
                RCA triggers configured from onboarding:
              </div>
              <div className="flex flex-wrap gap-1.5">
                {item.rcaTriggers.map((trigger) => (
                  <span
                    key={trigger}
                    className="text-[10px] px-2 py-0.5 rounded-full bg-white/[0.04] border border-white/[0.06] text-slate-400"
                  >
                    {trigger}
                  </span>
                ))}
              </div>
            </div>
          ))}
          {openRCAs.map((rca, i) => (
            <motion.div
              key={rca.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08 }}
              className={`bg-[#0D1520] border rounded-xl p-4 ${rca.status === "completed" ? "border-teal-500/20" : rca.status === "in_progress" ? "border-blue-500/20" : "border-amber-500/20"}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${rca.status === "completed" ? "bg-teal-500/10 text-teal-400" : rca.status === "in_progress" ? "bg-blue-500/10 text-blue-400" : "bg-amber-500/10 text-amber-400"}`}
                    >
                      {rca.status === "in_progress"
                        ? "In Progress"
                        : rca.status === "completed"
                          ? "Completed"
                          : "Open"}
                    </span>
                    <span className="text-[10px] text-slate-600">
                      {rca.asset}
                    </span>
                  </div>
                  <h4 className="text-sm font-semibold text-slate-200">
                    {rca.title}
                  </h4>
                  <div className="flex gap-3 mt-1 text-xs text-slate-500">
                    <span>Owner: {rca.owner}</span>
                    <span>
                      Priority:{" "}
                      <span
                        className={
                          rca.priority === "High"
                            ? "text-amber-400"
                            : "text-blue-400"
                        }
                      >
                        {rca.priority}
                      </span>
                    </span>
                    {rca.daysOpen > 0 && (
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {rca.daysOpen} days open
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => navigate("/cowork")}
                  className="flex items-center gap-1 text-xs text-teal-400 hover:text-teal-300 flex-shrink-0"
                >
                  {rca.status === "completed" ? "View" : "Continue"}{" "}
                  <ChevronRight className="w-3 h-3" />
                </button>
              </div>
            </motion.div>
          ))}
          <button className="w-full py-3 border border-dashed border-white/[0.08] rounded-xl text-xs text-slate-600 hover:text-slate-400 hover:border-white/[0.14] transition-colors flex items-center justify-center gap-2">
            <Zap className="w-3.5 h-3.5" /> AI can auto-initiate RCA from
            failure events
          </button>
        </div>
      )}

      {tab === "fmea" && (
        <div className="space-y-4">
          {reliability.map((item) => (
            <div
              key={`fmea-${item.sessionId}`}
              className="bg-[#0D1520] border border-white/[0.06] rounded-xl p-5"
            >
              <div className="flex items-center gap-2 mb-3">
                <Layers className="w-4 h-4 text-cyan-400" />
                <h3 className="text-sm font-semibold text-slate-200">
                  {item.assetId} · {item.classLabel}
                </h3>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 ml-auto">
                  From onboarding
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/[0.06] text-slate-500">
                      <th className="text-left py-2 px-2 font-semibold">
                        Failure Mode
                      </th>
                      <th className="text-left py-2 px-2 font-semibold">
                        Mechanism
                      </th>
                      <th className="text-left py-2 px-2 font-semibold">
                        Effect
                      </th>
                      <th className="text-left py-2 px-2 font-semibold">
                        Detection
                      </th>
                      <th className="text-left py-2 px-2 font-semibold">
                        Recommended Control
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {item.failureModes.map((fm) => (
                      <tr
                        key={fm.failureMode}
                        className="border-b border-white/[0.04]"
                      >
                        <td className="py-2 px-2 text-slate-200 font-medium">
                          {fm.failureMode}
                        </td>
                        <td className="py-2 px-2 text-slate-400">
                          {fm.failureMechanism}
                        </td>
                        <td className="py-2 px-2 text-slate-400">
                          {fm.effect}
                        </td>
                        <td className="py-2 px-2 text-slate-400">
                          {fm.detectionMethod}
                        </td>
                        <td className="py-2 px-2 text-slate-400">
                          {fm.recommendedControls}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {item.strategyRecommendations.length > 0 && (
                <div className="mt-4">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
                    Maintenance Strategy Recommendations
                  </div>
                  <div className="space-y-2">
                    {item.strategyRecommendations.map((rec, i) => (
                      <div
                        key={i}
                        className="p-3 rounded-lg bg-white/[0.02] border border-white/[0.05] text-xs"
                      >
                        <div className="text-slate-200 font-medium">
                          {rec.recommendation}
                        </div>
                        <div className="text-slate-500 mt-1">
                          Addresses: {rec.failureModeAddressed} · Confidence:{" "}
                          {rec.confidence} · Approval: {rec.requiredApproval}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
          {reliability.length === 0 && (
            <div className="bg-[#0D1520] border border-white/[0.06] rounded-xl p-6 text-center">
              <BarChart2 className="w-10 h-10 mx-auto mb-3 text-slate-700" />
              <div className="text-slate-400 text-sm font-medium">
                FMEA / RCM Module
              </div>
              <p className="text-xs text-slate-600 mt-2 max-w-sm mx-auto">
                AI-assisted Failure Mode & Effects Analysis and Reliability
                Centered Maintenance. SyncAI generates and maintains FMEA tables
                from asset failure history and maintenance data.
              </p>
              <button
                onClick={() => navigate("/pilot/reliability")}
                className="mt-4 px-4 py-2 bg-teal-500/10 border border-teal-500/20 text-teal-400 text-xs rounded-lg hover:bg-teal-500/20 transition-colors"
              >
                Launch FMEA Wizard
              </button>
            </div>
          )}
        </div>
      )}

      {tab === "pm" && (
        <div className="space-y-4">
          {onboardingPmBlockers.map((item) => (
            <div
              key={`pm-${item.sessionId}`}
              className="bg-[#0D1520] border border-amber-500/20 rounded-xl p-5"
            >
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                <h3 className="text-sm font-semibold text-slate-200">
                  {item.assetId} · PM optimization blocked
                </h3>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 ml-auto">
                  From onboarding
                </span>
              </div>
              <ul className="space-y-1.5">
                {item.pmOptimizationBlockers.map((blocker) => (
                  <li
                    key={blocker}
                    className="flex items-start gap-2 text-xs text-slate-400"
                  >
                    <span className="w-1 h-1 rounded-full bg-amber-400 mt-1.5 flex-shrink-0" />
                    {blocker}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <div className="bg-[#0D1520] border border-white/[0.06] rounded-xl p-6 text-center">
            <Activity className="w-10 h-10 mx-auto mb-3 text-slate-700" />
            <div className="text-slate-400 text-sm font-medium">
              PM Strategy Optimization
            </div>
            <p className="text-xs text-slate-600 mt-2 max-w-sm mx-auto">
              SyncAI continuously analyzes PM task effectiveness and recommends
              interval adjustments based on failure history, condition data, and
              cost optimization principles.
            </p>
            <button
              onClick={() => navigate("/work?filter=approval")}
              className="mt-4 px-4 py-2 bg-teal-500/10 border border-teal-500/20 text-teal-400 text-xs rounded-lg hover:bg-teal-500/20 transition-colors"
            >
              Review PM Recommendations
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
