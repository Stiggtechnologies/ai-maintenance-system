import {
  Brain,
  Zap,
  RefreshCw,
  Target,
} from "lucide-react";
import { motion } from "framer-motion";
import { useOnboardingOperatingLoop } from "../hooks/useOnboardingOperatingLoop";
import { useAsyncData } from "../hooks/useAsyncData";
import { getLearningEvents } from "../services/operatingLoopService";
import type { LearningEventRow } from "../types/operating";
import {
  LoadingState,
  ErrorState,
  EmptyState,
} from "../components/ui/AsyncStates";

/**
 * DELETED: `learningStats`, `confidenceTrend`, `acceptanceTrend`.
 *
 * Six hand-typed tiles with hand-typed month-over-month deltas — "Recommendations
 * Accepted 84% (+4%)", "False Positive Rate 3% (-1%)", "Savings Verified (MTD)
 * $1.8M (+$0.3M)", "Downtime Avoided (MTD) 142 hr (+18 hr)", "Model Confidence
 * (Avg) 88% (+2%)", "Human Overrides 4 (-2)" — plus two nine-element arrays
 * rendered as line charts under the captions "Last 9 weeks · Fleet average
 * confidence" and "Last 9 weeks · Approved / total recommendations".
 *
 * Nothing measured any of it. A literal array captioned as a nine-week measured
 * series is a stronger claim than a wrong number: it asserts that a measurement
 * was taken every week for nine weeks. And "Savings Verified" uses the one word
 * the platform's own verification loop cannot currently produce —
 * `record_verification_result` has no callers, so loop closure is structurally
 * zero and nothing has been verified by anybody.
 *
 * The 142 hours here is the same 142 already deleted from `value_metrics` as
 * `autonomous_actions_executed`; deleting the row did not remove the claim,
 * because the claim had also been typed into this page.
 *
 * The Recent Learning Events list below is real — it reads `learning_events`,
 * which `operatingLoopService` genuinely writes — so the page keeps it and
 * loses the headline it could not support.
 */

const typeConfig: Record<string, { color: string; bg: string; label: string }> =
  {
    strategy_update: {
      color: "text-teal-400",
      bg: "bg-teal-500/10",
      label: "Strategy Update",
    },
    model_improvement: {
      color: "text-signal-cyan",
      bg: "bg-signal-cyan/10",
      label: "Model Improvement",
    },
    false_positive_resolved: {
      color: "text-amber-400",
      bg: "bg-amber-500/10",
      label: "False Positive Fixed",
    },
    rca_closed: {
      color: "text-green-400",
      bg: "bg-green-500/10",
      label: "RCA Closed",
    },
    onboarding_started: {
      color: "text-cyan-400",
      bg: "bg-cyan-500/10",
      label: "Onboarding Started",
    },
    step_completed: {
      color: "text-teal-400",
      bg: "bg-teal-500/10",
      label: "Step Completed",
    },
    package_exported: {
      color: "text-signal-cyan",
      bg: "bg-signal-cyan/10",
      label: "Package Exported",
    },
    recommendation_approved: {
      color: "text-green-400",
      bg: "bg-green-500/10",
      label: "Recommendation Approved",
    },
    recommendation_rejected: {
      color: "text-red-400",
      bg: "bg-red-500/10",
      label: "Recommendation Rejected",
    },
    work_action_created: {
      color: "text-amber-400",
      bg: "bg-amber-500/10",
      label: "Work Action Created",
    },
    recommendation_accepted: {
      color: "text-green-400",
      bg: "bg-green-500/10",
      label: "Recommendation Accepted",
    },
    work_completed: {
      color: "text-teal-400",
      bg: "bg-teal-500/10",
      label: "Work Completed",
    },
    false_positive: {
      color: "text-amber-400",
      bg: "bg-amber-500/10",
      label: "False Positive",
    },
    false_negative: {
      color: "text-red-400",
      bg: "bg-red-500/10",
      label: "False Negative",
    },
    lesson_learned: {
      color: "text-signal-cyan",
      bg: "bg-signal-cyan/10",
      label: "Lesson Learned",
    },
    model_confidence: {
      color: "text-teal-400",
      bg: "bg-teal-500/10",
      label: "Model Confidence",
    },
  };


export function LearningLoop() {
  const { learningEvents } = useOnboardingOperatingLoop();
  const { data, loading, error, refetch } = useAsyncData<LearningEventRow[]>(
    () => getLearningEvents(),
    [],
  );

  const onboardingLearnings = learningEvents.map((event) => ({
    id: event.id,
    type: event.type,
    title: event.title,
    source: event.detail,
    impact: "Closed-loop onboarding signal",
    agent: event.agent,
    date: event.createdAt.slice(0, 10),
    confidence: event.confidence,
  }));
  const dbLearnings = (data ?? []).map((event) => ({
    id: event.id,
    type: event.event_type,
    title: event.title ?? event.event_type,
    source: event.detail ?? "",
    impact: event.verified_value
      ? `Verified value $${Number(event.verified_value).toLocaleString()}`
      : "Closed-loop signal",
    agent: "Learning Loop",
    date: event.created_at.slice(0, 10),
    confidence: event.model_confidence ?? 80,
  }));
  const learnings = [...onboardingLearnings, ...dbLearnings];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            Learning Loop
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">
            SyncAI improves with every recommendation, outcome, and override
          </p>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-500/10 border border-teal-500/20 rounded-lg text-xs text-teal-400 font-medium">
          <RefreshCw className="w-3.5 h-3.5" />
          Active Learning
        </div>
      </div>

      {/*
        The two trend charts and the six stat tiles above them stood here. They
        were literals, and they are gone rather than zeroed: a chart captioned
        "Last 9 weeks" showing a flat line is still claiming nine weeks of
        measurement happened.
      */}
      <div className="bg-[#0D1520] border border-white/6 rounded-2xl p-5">
        <h3 className="text-sm font-semibold text-slate-200 mb-2 flex items-center gap-2">
          <Target className="w-4 h-4 text-slate-500" /> Loop performance
        </h3>
        <p className="text-xs text-amber-300/90">
          Not measured yet.
        </p>
        <p className="text-xs text-slate-400 mt-2">
          Acceptance rate, false-positive rate, model confidence and verified
          savings need a closed verification loop to compute, and the loop does
          not close today: <code>record_verification_result</code> has no
          callers, so no recommendation outcome is ever recorded against its
          prediction. Until it does, this page reports the learning events it
          holds and claims nothing about their effect.
        </p>
      </div>

      {/* Recent Learnings */}
      <div className="bg-[#0D1520] border border-white/6 rounded-2xl p-5">
        <h3 className="text-sm font-semibold text-slate-200 mb-4 flex items-center gap-2">
          <Brain className="w-4 h-4 text-teal-400" /> Recent Learning Events
        </h3>
        {loading && <LoadingState label="Loading learning events…" />}
        {error && <ErrorState message={error} onRetry={refetch} />}
        {!loading && !error && learnings.length === 0 && (
          <EmptyState message="No learning events yet — approve or reject recommendations to start the loop." />
        )}
        <div className="space-y-3">
          {learnings.map((item, i) => {
            const tc = typeConfig[item.type];
            return (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.07 }}
                className="flex items-start gap-3 p-3 bg-white/2 rounded-xl border border-white/4"
              >
                <div
                  className={`px-2 py-0.5 rounded-full text-xs font-semibold ${tc.bg} ${tc.color} whitespace-nowrap shrink-0`}
                >
                  {tc.label}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-slate-200">
                    {item.title}
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    {item.source}
                  </div>
                  <div className="flex items-center gap-3 mt-1.5 text-xs">
                    <span className="text-teal-400 font-medium">
                      {item.impact}
                    </span>
                    <span className="text-slate-400">·</span>
                    <span className="text-slate-400">{item.agent}</span>
                    <span className="text-slate-400">·</span>
                    <span className="text-slate-400">{item.date}</span>
                    <span className="ml-auto font-mono text-slate-400">
                      {item.confidence}% conf
                    </span>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Learning Loop Explanation */}
      <div className="bg-[#0D1520] border border-teal-500/20 rounded-xl p-4 flex items-start gap-3">
        <Zap className="w-4 h-4 text-teal-400 shrink-0 mt-0.5" />
        <div>
          <div className="text-sm font-bold text-teal-400">
            Closed-Loop Learning
          </div>
          <p className="text-xs text-slate-400 mt-1 leading-relaxed">
            Every approved recommendation, rejected override, and verified
            outcome feeds back into SyncAI's models. Over time, the system
            becomes smarter about your specific assets, failure modes, and
            operating conditions.
            <span className="text-slate-200">
              {" "}
              This is what separates SyncAI from a static rule-based CMMS.
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}
