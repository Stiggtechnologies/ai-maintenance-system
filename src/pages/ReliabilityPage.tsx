/**
 * Reliability — the department surface, assembled only from panels that can
 * show where their numbers came from.
 *
 * Every figure below is either computed by the validated engines in
 * src/lib/reliability from the customer's own work-order history, or derived
 * from persisted asset-onboarding sessions. Nothing here is illustrative. A
 * fleet MTBF, a bad-actor repair cost or an RCA owner that no query can
 * produce is indistinguishable, to the person reading the screen, from one
 * that can — and this product is sold on the difference.
 */
import { useState } from "react";
import { ReliabilityAnalytics } from "../components/ReliabilityAnalytics";
import { ModellingStudio } from "../components/ModellingStudio";
import { CaEffectivenessPanel } from "../components/CaEffectivenessPanel";
import { ConditionMonitoring } from "../components/ConditionMonitoring";
import { MonitoringCoverageGaps } from "../components/MonitoringCoverageGaps";
import { FailureCoding } from "../components/FailureCoding";
import { LifecycleDecisions } from "../components/LifecycleDecisions";
import { IntervalOptimization } from "../components/IntervalOptimization";
import { useNavigate } from "react-router-dom";
import {
  TriangleAlert as AlertTriangle,
  Activity,
  ChartBar as BarChart2,
  Layers,
} from "lucide-react";
import { useOnboardingOperatingLoop } from "../hooks/useOnboardingOperatingLoop";

export function Reliability() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<"rca" | "fmea" | "pm">("rca");
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
        <p className="text-sm text-slate-400 mt-0.5">
          AI-powered reliability engineering department
        </p>
      </div>

      <ReliabilityAnalytics />
      <ModellingStudio />

      <ConditionMonitoring />

      <IntervalOptimization />

      <LifecycleDecisions />

      <FailureCoding />

      <MonitoringCoverageGaps />

      <CaEffectivenessPanel />

      {/* Tabs */}
      <div className="flex gap-1 border-b border-white/6">
        {(
          [
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
                : "border-transparent text-slate-400 hover:text-slate-300"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

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
                  className={`ml-auto text-xs px-1.5 py-0.5 rounded-full font-semibold ${item.fracasIntakeReady ? "bg-teal-500/10 text-teal-400" : "bg-amber-500/10 text-amber-400"}`}
                >
                  {item.fracasIntakeReady ? "Intake ready" : "Intake pending"}
                </span>
              </div>
              <div className="text-xs text-slate-400 mb-1">
                RCA triggers configured from onboarding:
              </div>
              <div className="flex flex-wrap gap-1.5">
                {item.rcaTriggers.map((trigger) => (
                  <span
                    key={trigger}
                    className="text-xs px-2 py-0.5 rounded-full bg-white/4 border border-white/6 text-slate-400"
                  >
                    {trigger}
                  </span>
                ))}
              </div>
            </div>
          ))}
          {reliability.length === 0 && (
            <div className="bg-[#0D1520] border border-white/6 rounded-xl p-6 text-center">
              <Layers className="w-10 h-10 mx-auto mb-3 text-slate-400" />
              <div className="text-slate-400 text-sm font-medium">
                RCA Workflow
              </div>
              <p className="text-xs text-slate-400 mt-2 max-w-sm mx-auto">
                RCA trigger criteria and FRACAS intake readiness are derived
                from completed asset onboarding sessions. None have been
                recorded for this organization yet.
              </p>
              <button
                onClick={() => navigate("/pilot/reliability")}
                className="mt-4 px-4 py-2 bg-teal-500/10 border border-teal-500/20 text-teal-400 text-xs rounded-lg hover:bg-teal-500/20 transition-colors"
              >
                Start Asset Onboarding
              </button>
            </div>
          )}
        </div>
      )}

      {tab === "fmea" && (
        <div className="space-y-4">
          {reliability.map((item) => (
            <div
              key={`fmea-${item.sessionId}`}
              className="bg-[#0D1520] border border-white/6 rounded-xl p-5"
            >
              <div className="flex items-center gap-2 mb-3">
                <Layers className="w-4 h-4 text-cyan-400" />
                <h3 className="text-sm font-semibold text-slate-200">
                  {item.assetId} · {item.classLabel}
                </h3>
                <span className="text-xs px-1.5 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 ml-auto">
                  From onboarding
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/6 text-slate-400">
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
                        className="border-b border-white/4"
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
                  <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                    Maintenance Strategy Recommendations
                  </div>
                  <div className="space-y-2">
                    {item.strategyRecommendations.map((rec, i) => (
                      <div
                        key={i}
                        className="p-3 rounded-lg bg-white/2 border border-white/5 text-xs"
                      >
                        <div className="text-slate-200 font-medium">
                          {rec.recommendation}
                        </div>
                        <div className="text-slate-400 mt-1">
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
            <div className="bg-[#0D1520] border border-white/6 rounded-xl p-6 text-center">
              <BarChart2 className="w-10 h-10 mx-auto mb-3 text-slate-400" />
              <div className="text-slate-400 text-sm font-medium">
                FMEA / RCM Module
              </div>
              <p className="text-xs text-slate-400 mt-2 max-w-sm mx-auto">
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
                <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 ml-auto">
                  From onboarding
                </span>
              </div>
              <ul className="space-y-1.5">
                {item.pmOptimizationBlockers.map((blocker) => (
                  <li
                    key={blocker}
                    className="flex items-start gap-2 text-xs text-slate-400"
                  >
                    <span className="w-1 h-1 rounded-full bg-amber-400 mt-1.5 shrink-0" />
                    {blocker}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <div className="bg-[#0D1520] border border-white/6 rounded-xl p-6 text-center">
            <Activity className="w-10 h-10 mx-auto mb-3 text-slate-400" />
            <div className="text-slate-400 text-sm font-medium">
              PM Strategy Optimization
            </div>
            <p className="text-xs text-slate-400 mt-2 max-w-sm mx-auto">
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
