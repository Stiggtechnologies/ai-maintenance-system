import { Shield, Eye, Database, Brain, Lock, BookOpen } from "lucide-react";
import { motion } from "framer-motion";
import { useAsyncData } from "../hooks/useAsyncData";
import {
  LoadingState,
  ErrorState,
  EmptyState,
} from "../components/ui/AsyncStates";
import {
  getAgents,
  getDecisions,
  getLearningEvents,
} from "../services/operatingLoopService";
import { supabase } from "../lib/supabase";
import type {
  AgentRow,
  DecisionRow,
  LearningEventRow,
} from "../types/operating";

interface RecLite {
  id: string;
  status: string;
  enriched_at: string | null;
  enrichment_model: string | null;
}

interface EvidenceLite {
  id: string;
  data_quality: string;
  source_system: string | null;
}

interface TrustData {
  agents: AgentRow[];
  decisions: DecisionRow[];
  learningEvents: LearningEventRow[];
  recommendations: RecLite[];
  evidence: EvidenceLite[];
  kbChunkCount: number;
}

async function loadTrustData(): Promise<TrustData> {
  const [agents, decisions, learningEvents, recRes, evRes, kbRes] =
    await Promise.all([
      getAgents(),
      getDecisions(),
      getLearningEvents(),
      supabase
        .from("recommendations")
        .select("id,status,enriched_at,enrichment_model")
        .returns<RecLite[]>(),
      supabase
        .from("evidence_items")
        .select("id,data_quality,source_system")
        .returns<EvidenceLite[]>(),
      supabase
        .from("reliability_kb_chunks")
        .select("id", { count: "exact", head: true }),
    ]);
  if (recRes.error)
    throw new Error(`Could not load recommendations: ${recRes.error.message}`);
  if (evRes.error)
    throw new Error(`Could not load evidence items: ${evRes.error.message}`);
  if (kbRes.error)
    throw new Error(`Could not load knowledge base: ${kbRes.error.message}`);
  return {
    agents,
    decisions,
    learningEvents,
    recommendations: recRes.data ?? [],
    evidence: evRes.data ?? [],
    kbChunkCount: kbRes.count ?? 0,
  };
}

const colorMap: Record<string, { text: string; bg: string }> = {
  teal: { text: "text-teal-400", bg: "bg-teal-500/10" },
  blue: { text: "text-blue-400", bg: "bg-blue-500/10" },
  amber: { text: "text-amber-400", bg: "bg-amber-500/10" },
  green: { text: "text-green-400", bg: "bg-green-500/10" },
};

const approvalColors: Record<string, string> = {
  approved: "text-teal-400 bg-teal-500/10",
  autonomous: "text-blue-400 bg-blue-500/10",
  rejected: "text-red-400 bg-red-500/10",
  pending: "text-amber-400 bg-amber-500/10",
};

interface TrustMetric {
  label: string;
  value: string;
  sub: string;
  color: string;
}

function buildMetrics(d: TrustData): TrustMetric[] {
  const avgAgentConfidence = d.agents.length
    ? Math.round(
        d.agents.reduce((s, a) => s + a.confidence, 0) / d.agents.length,
      )
    : null;

  const decidedRecs = d.recommendations.filter((r) =>
    ["approved", "rejected", "dismissed"].includes(r.status),
  );
  const approvedRecs = decidedRecs.filter((r) => r.status === "approved");
  const acceptanceRate = decidedRecs.length
    ? Math.round((approvedRecs.length / decidedRecs.length) * 100)
    : null;

  const autonomousDecisions = d.decisions.filter(
    (dec) => dec.approval_status === "autonomous",
  ).length;
  const humanReviewed = d.decisions.length - autonomousDecisions;

  const challenges = d.learningEvents.filter(
    (e) => e.event_type === "false_positive",
  ).length;

  const enriched = d.recommendations.filter(
    (r) => r.enriched_at != null,
  ).length;
  const enrichmentPct = d.recommendations.length
    ? Math.round((enriched / d.recommendations.length) * 100)
    : null;

  const highQualityEvidence = d.evidence.filter(
    (e) => e.data_quality === "high",
  ).length;
  const evidenceQualityPct = d.evidence.length
    ? Math.round((highQualityEvidence / d.evidence.length) * 100)
    : null;

  return [
    {
      label: "Avg Agent Confidence",
      value: avgAgentConfidence != null ? `${avgAgentConfidence}%` : "—",
      sub: `across ${d.agents.length} AI agents`,
      color: "teal",
    },
    {
      label: "Recommendation Acceptance",
      value: acceptanceRate != null ? `${acceptanceRate}%` : "—",
      sub:
        decidedRecs.length > 0
          ? `${approvedRecs.length} of ${decidedRecs.length} decided (${d.recommendations.length - decidedRecs.length} pending)`
          : "no recommendations decided yet",
      color: "teal",
    },
    {
      label: "Autonomous Decision Share",
      value: d.decisions.length
        ? `${Math.round((autonomousDecisions / d.decisions.length) * 100)}%`
        : "—",
      sub: d.decisions.length
        ? `${autonomousDecisions} autonomous / ${humanReviewed} human-reviewed`
        : "no decisions logged yet",
      color: "blue",
    },
    {
      label: "AI Challenges Logged",
      value: String(challenges),
      sub: "operator false-positive flags",
      color: challenges > 0 ? "amber" : "green",
    },
    {
      label: "Enrichment Coverage",
      value: enrichmentPct != null ? `${enrichmentPct}%` : "—",
      sub: `${enriched} of ${d.recommendations.length} recommendations LLM-enriched`,
      color: enrichmentPct != null && enrichmentPct > 0 ? "teal" : "amber",
    },
    {
      label: "High-Quality Evidence",
      value: evidenceQualityPct != null ? `${evidenceQualityPct}%` : "—",
      sub: d.evidence.length
        ? `${highQualityEvidence} of ${d.evidence.length} evidence items rated high`
        : "no evidence items yet",
      color: "blue",
    },
  ];
}

export function TrustExplainability() {
  const { data, loading, error, refetch } = useAsyncData<TrustData>(
    loadTrustData,
    [],
    { isEmpty: () => false },
  );

  if (loading) return <LoadingState label="Loading trust metrics…" />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;
  if (!data)
    return (
      <EmptyState message="No trust data yet — metrics populate as agents generate recommendations and decisions." />
    );

  const metrics = buildMetrics(data);
  const evidenceSources = [
    ...new Set(
      data.evidence.map((e) => e.source_system).filter((s): s is string => !!s),
    ),
  ];

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
          <Lock className="w-3.5 h-3.5" /> {data.decisions.length} decision
          {data.decisions.length === 1 ? "" : "s"} in audit trail
        </div>
      </div>

      {/* Trust Metrics — each computed from live tables */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {metrics.map((m) => {
          const c = colorMap[m.color];
          return (
            <div
              key={m.label}
              className="bg-[#0D1520] border border-white/[0.06] rounded-xl p-4"
            >
              <div className="text-xs text-slate-400 mb-1">{m.label}</div>
              <div className={`text-xl font-black ${c.text}`}>{m.value}</div>
              <div className="text-xs text-slate-400 mt-1 leading-snug">
                {m.sub}
              </div>
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
            description: data.evidence.length
              ? `Evidence is traceable to source systems (${evidenceSources.join(", ")}) with data quality ratings on every item.`
              : "Evidence lineage populates as agents attach evidence items to recommendations.",
            color: "blue",
          },
          {
            icon: Shield,
            title: "Immutable Audit Trail",
            description:
              "Every decision, override, and outcome is logged with actor, autonomy mode, and rationale.",
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

      {/* Decision Trace Table — live decisions log */}
      <div className="bg-[#0D1520] border border-white/[0.06] rounded-2xl p-5">
        <h3 className="text-sm font-semibold text-slate-200 mb-4 flex items-center gap-2">
          <Brain className="w-4 h-4 text-teal-400" /> Decision Traces
        </h3>
        {data.decisions.length === 0 ? (
          <EmptyState message="No decisions logged yet — traces appear as recommendations are approved, rejected, or executed autonomously." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  <th className="text-left py-3 px-3 text-slate-400 font-semibold">
                    Decision
                  </th>
                  <th className="text-left py-3 px-2 text-slate-400 font-semibold">
                    Asset
                  </th>
                  <th className="text-left py-3 px-2 text-slate-400 font-semibold">
                    Agent
                  </th>
                  <th className="text-center py-3 px-2 text-slate-400 font-semibold">
                    Confidence
                  </th>
                  <th className="text-center py-3 px-2 text-slate-400 font-semibold">
                    Autonomy
                  </th>
                  <th className="text-center py-3 px-2 text-slate-400 font-semibold">
                    Actor
                  </th>
                  <th className="text-center py-3 px-2 text-slate-400 font-semibold">
                    Approval
                  </th>
                  <th className="text-center py-3 px-2 text-slate-400 font-semibold">
                    Outcome
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.decisions.map((d, i) => (
                  <motion.tr
                    key={d.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: i * 0.05 }}
                    className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors"
                  >
                    <td className="py-3 px-3 text-slate-200 font-medium">
                      {d.action_taken ?? d.decision_type ?? "—"}
                    </td>
                    <td className="py-3 px-2 text-slate-400">
                      {d.asset?.name ?? "—"}
                    </td>
                    <td className="py-3 px-2 text-slate-400">
                      {d.agent?.name ?? "—"}
                    </td>
                    <td className="py-3 px-2 text-center">
                      <span
                        className={`font-mono font-bold ${d.confidence_score >= 85 ? "text-teal-400" : d.confidence_score >= 75 ? "text-amber-400" : "text-red-400"}`}
                      >
                        {d.confidence_score}%
                      </span>
                    </td>
                    <td className="py-3 px-2 text-center text-slate-400 capitalize">
                      {d.autonomy_mode}
                    </td>
                    <td className="py-3 px-2 text-center">
                      <span
                        className={`px-1.5 py-0.5 rounded-full text-xs font-bold ${d.human_actor ? "bg-teal-500/10 text-teal-400" : "bg-blue-500/10 text-blue-400"}`}
                      >
                        {d.human_actor ? "Human" : "AI"}
                      </span>
                    </td>
                    <td className="py-3 px-2 text-center">
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-bold capitalize ${approvalColors[d.approval_status] ?? "text-slate-300 bg-white/[0.05]"}`}
                      >
                        {d.approval_status}
                      </span>
                    </td>
                    <td className="py-3 px-2 text-center text-slate-400 capitalize">
                      {d.outcome_status}
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Knowledge-base grounding — honest state */}
      <div className="bg-[#0D1520] border border-white/[0.06] rounded-xl p-4 flex items-start gap-3">
        <BookOpen className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
        <div>
          <div className="text-sm font-medium text-blue-400">
            Knowledge-Base Grounding
          </div>
          <p className="text-xs text-slate-400 mt-1 leading-relaxed">
            {data.kbChunkCount > 0 ? (
              <>
                Copilot answers are grounded in{" "}
                <span className="text-slate-200">
                  {data.kbChunkCount.toLocaleString()} reliability
                  knowledge-base chunks
                </span>{" "}
                with source citations (document, page range).
              </>
            ) : (
              <>
                No reliability knowledge-base documents ingested yet — copilot
                citations connect when reference documents are loaded into the
                knowledge base.
              </>
            )}
          </p>
        </div>
      </div>

      <div className="bg-[#0D1520] border border-teal-500/10 rounded-xl p-4 flex items-start gap-3">
        <Shield className="w-4 h-4 text-teal-400 flex-shrink-0 mt-0.5" />
        <div>
          <div className="text-sm font-bold text-teal-400">
            Enterprise-Grade Trust
          </div>
          <p className="text-xs text-slate-400 mt-1 leading-relaxed">
            SyncAI is built for the explainability and auditability requirements
            of mission-critical operations. Every metric on this page is
            computed live from the decisions, recommendations, learning events,
            and evidence logged in your workspace — nothing is estimated.
          </p>
        </div>
      </div>
    </div>
  );
}
