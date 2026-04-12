import { useState, useEffect } from "react";
import {
  FlaskConical,
  Play,
  CheckCircle,
  XCircle,
  TrendingUp,
  ArrowRight,
  Eye,
} from "lucide-react";
import { supabase } from "../lib/supabase";

interface ResearchProgram {
  id: string;
  program_code: string;
  program_name: string;
  description: string;
  domain: string;
  active: boolean;
  max_experiment_duration_minutes: number;
}

interface ResearchRun {
  id: string;
  program_id: string;
  variant_id: string;
  benchmark_id: string;
  run_number: number;
  status: string;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  research_variants?: {
    variant_code: string;
    description: string;
    status: string;
  };
}

interface ResearchResult {
  id: string;
  run_id: string;
  metric_name: string;
  metric_value: number;
  baseline_value: number | null;
  improvement_pct: number | null;
  improved: boolean;
}

interface PromotionCandidate {
  id: string;
  variant_id: string;
  program_id: string;
  net_improvement_pct: number | null;
  benchmarks_passed: number;
  benchmarks_total: number;
  review_status: string;
  review_comments: string | null;
  created_at: string;
  research_variants?: {
    variant_code: string;
    description: string;
    change_payload: Record<string, unknown>;
  };
  research_programs?: { program_name: string; domain: string };
}

export function ResearchDashboard() {
  const [programs, setPrograms] = useState<ResearchProgram[]>([]);
  const [recentRuns, setRecentRuns] = useState<ResearchRun[]>([]);
  const [promotions, setPromotions] = useState<PromotionCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<
    "overview" | "runs" | "promotions"
  >("overview");
  const [selectedRunResults, setSelectedRunResults] = useState<
    ResearchResult[]
  >([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [programsRes, runsRes, promotionsRes] = await Promise.all([
        supabase
          .from("research_programs")
          .select("*")
          .eq("active", true)
          .order("program_name"),
        supabase
          .from("research_runs")
          .select("*, research_variants(variant_code, description, status)")
          .order("started_at", { ascending: false })
          .limit(50),
        supabase
          .from("promotion_candidates")
          .select(
            "*, research_variants(variant_code, description, change_payload), research_programs(program_name, domain)",
          )
          .order("created_at", { ascending: false })
          .limit(20),
      ]);

      if (programsRes.data) setPrograms(programsRes.data);
      if (runsRes.data) setRecentRuns(runsRes.data);
      if (promotionsRes.data) setPromotions(promotionsRes.data);
    } catch (error) {
      console.error("Error loading research data:", error);
    } finally {
      setLoading(false);
    }
  };

  const viewRunResults = async (runId: string) => {
    setSelectedRunId(runId);
    const { data } = await supabase
      .from("research_results")
      .select("*")
      .eq("run_id", runId)
      .order("metric_name");
    if (data) setSelectedRunResults(data);
  };

  const triggerExperimentLoop = async (
    programId: string,
    benchmarkId?: string,
  ) => {
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      const response = await fetch(
        `${supabaseUrl}/functions/v1/research-orchestrator`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${supabaseKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "run_loop",
            data: {
              program_id: programId,
              benchmark_id: benchmarkId,
              iterations: 3,
            },
          }),
        },
      );
      if (response.ok) {
        loadData();
      }
    } catch (error) {
      console.error("Error triggering experiment:", error);
    }
  };

  const updatePromotionStatus = async (
    promotionId: string,
    status: string,
    comments?: string,
  ) => {
    await supabase
      .from("promotion_candidates")
      .update({
        review_status: status,
        reviewed_at: new Date().toISOString(),
        review_comments: comments || null,
      })
      .eq("id", promotionId);
    loadData();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-slate-400">Loading research data...</div>
      </div>
    );
  }

  const stats = {
    activePrograms: programs.length,
    totalRuns: recentRuns.length,
    successfulRuns: recentRuns.filter((r) => r.status === "completed").length,
    pendingPromotions: promotions.filter((p) => p.review_status === "pending")
      .length,
  };

  const tabs = [
    { id: "overview" as const, label: "Programs" },
    { id: "runs" as const, label: "Experiment Runs", count: stats.totalRuns },
    {
      id: "promotions" as const,
      label: "Promotion Queue",
      count: stats.pendingPromotions,
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#E6EDF3] flex items-center gap-2">
          <FlaskConical size={24} className="text-purple-600" />
          Research Orchestrator
        </h1>
        <p className="text-slate-400 mt-1">
          Internal experimentation system for optimizing intelligence
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="glass border border-white/[0.06] rounded-xl p-4">
          <div className="text-sm text-slate-500">Active Programs</div>
          <div className="text-2xl font-bold text-[#E6EDF3]">
            {stats.activePrograms}
          </div>
        </div>
        <div className="glass border border-white/[0.06] rounded-xl p-4">
          <div className="text-sm text-slate-500">Recent Runs</div>
          <div className="text-2xl font-bold text-[#E6EDF3]">
            {stats.totalRuns}
          </div>
        </div>
        <div className="glass border border-white/[0.06] rounded-xl p-4">
          <div className="text-sm text-slate-500">Successful</div>
          <div className="text-2xl font-bold text-green-600">
            {stats.successfulRuns}
          </div>
        </div>
        <div className="glass border border-white/[0.06] rounded-xl p-4">
          <div className="text-sm text-slate-500">Pending Promotions</div>
          <div className="text-2xl font-bold text-orange-600">
            {stats.pendingPromotions}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-[#232A33]">
        <nav className="flex gap-6">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors ${activeTab === tab.id ? "border-purple-600 text-purple-600" : "border-transparent text-slate-500 hover:text-slate-300"}`}
            >
              {tab.label}
              {tab.count !== undefined && tab.count > 0 && (
                <span className="ml-2 text-xs bg-purple-100 text-purple-800 px-1.5 py-0.5 rounded-full">
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* Programs Tab */}
      {activeTab === "overview" && (
        <div className="space-y-4">
          {programs.length === 0 ? (
            <div className="glass border border-white/[0.06] rounded-xl p-12 text-center">
              <FlaskConical size={48} className="mx-auto text-slate-300 mb-4" />
              <h3 className="text-lg font-semibold text-slate-300">
                No Research Programs
              </h3>
              <p className="text-sm text-slate-500 mt-2">
                Create research programs to start optimizing SyncAI
                intelligence.
              </p>
            </div>
          ) : (
            programs.map((program) => {
              const programRuns = recentRuns.filter(
                (r) => r.program_id === program.id,
              );
              const successRate =
                programRuns.length > 0
                  ? Math.round(
                      (programRuns.filter((r) => r.status === "completed")
                        .length /
                        programRuns.length) *
                        100,
                    )
                  : 0;

              return (
                <div
                  key={program.id}
                  className="glass border border-white/[0.06] rounded-xl p-6"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-[#E6EDF3]">
                        {program.program_name}
                      </h3>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-xs px-2 py-1 bg-purple-100 text-purple-800 rounded-full">
                          {program.domain}
                        </span>
                        <span className="text-xs text-slate-500">
                          {program.max_experiment_duration_minutes} min budget
                        </span>
                      </div>
                      {program.description && (
                        <p className="text-sm text-slate-400 mt-2">
                          {program.description}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => triggerExperimentLoop(program.id)}
                      className="flex items-center gap-1 px-3 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 text-sm font-medium"
                    >
                      <Play size={14} /> Run Experiment
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t border-[#1A2030]">
                    <div>
                      <div className="text-xs text-slate-500">Total Runs</div>
                      <div className="text-lg font-bold text-[#E6EDF3]">
                        {programRuns.length}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500">Success Rate</div>
                      <div className="text-lg font-bold text-[#E6EDF3]">
                        {successRate}%
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500">Last Run</div>
                      <div className="text-sm text-slate-300">
                        {programRuns[0]
                          ? new Date(
                              programRuns[0].started_at,
                            ).toLocaleDateString()
                          : "Never"}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Runs Tab */}
      {activeTab === "runs" && (
        <div className="space-y-4">
          {recentRuns.length === 0 ? (
            <div className="text-center py-12 text-slate-500">
              No experiment runs yet
            </div>
          ) : (
            <div className="glass border border-white/[0.06] rounded-xl overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="text-left text-xs text-slate-500 bg-[#0B0F14] border-b border-[#232A33]">
                    <th className="px-4 py-3">Run #</th>
                    <th className="px-4 py-3">Variant</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Duration</th>
                    <th className="px-4 py-3">Started</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {recentRuns.map((run) => (
                    <tr
                      key={run.id}
                      className="border-b border-[#1A2030] hover:bg-[#0B0F14]"
                    >
                      <td className="px-4 py-3 text-sm font-mono text-[#E6EDF3]">
                        #{run.run_number}
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm font-medium text-[#E6EDF3]">
                          {run.research_variants?.variant_code || "-"}
                        </div>
                        <div className="text-xs text-slate-500 truncate max-w-xs">
                          {run.research_variants?.description || ""}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`text-xs px-2 py-1 rounded-full ${
                            run.status === "completed"
                              ? "bg-green-100 text-green-800"
                              : run.status === "running"
                                ? "bg-blue-100 text-blue-800"
                                : run.status === "failed"
                                  ? "bg-red-100 text-red-800"
                                  : "bg-white/[0.04] text-slate-500"
                          }`}
                        >
                          {run.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-400">
                        {run.duration_ms
                          ? `${(run.duration_ms / 1000).toFixed(1)}s`
                          : "-"}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-500">
                        {new Date(run.started_at).toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => viewRunResults(run.id)}
                          className="text-xs text-purple-600 hover:text-purple-700 font-medium flex items-center gap-1"
                        >
                          <Eye size={12} /> Results
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Results detail panel */}
          {selectedRunId && selectedRunResults.length > 0 && (
            <div className="bg-[#11161D] border border-purple-200 rounded-xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-[#E6EDF3]">
                  Run Results
                </h3>
                <button
                  onClick={() => {
                    setSelectedRunId(null);
                    setSelectedRunResults([]);
                  }}
                  className="text-xs text-slate-500 hover:text-slate-300"
                >
                  Close
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {selectedRunResults.map((result) => (
                  <div
                    key={result.id}
                    className={`border rounded-lg p-4 ${result.improved ? "border-green-200 bg-green-50" : "border-[#232A33]"}`}
                  >
                    <div className="text-sm font-medium text-[#E6EDF3]">
                      {result.metric_name}
                    </div>
                    <div className="flex items-baseline gap-2 mt-1">
                      <span className="text-2xl font-bold text-[#E6EDF3]">
                        {result.metric_value.toFixed(1)}
                      </span>
                      {result.baseline_value != null && (
                        <span className="text-xs text-slate-500">
                          vs {result.baseline_value.toFixed(1)} baseline
                        </span>
                      )}
                    </div>
                    {result.improvement_pct != null && (
                      <div
                        className={`text-sm font-medium mt-1 flex items-center gap-1 ${result.improved ? "text-green-600" : "text-red-600"}`}
                      >
                        <TrendingUp size={14} />
                        {result.improvement_pct > 0 ? "+" : ""}
                        {result.improvement_pct.toFixed(1)}%
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Promotions Tab */}
      {activeTab === "promotions" && (
        <div className="space-y-4">
          {promotions.length === 0 ? (
            <div className="text-center py-12 text-slate-500">
              No promotion candidates yet
            </div>
          ) : (
            promotions.map((promo) => (
              <div
                key={promo.id}
                className={`bg-[#11161D] border rounded-xl p-6 ${promo.review_status === "pending" ? "border-orange-200" : "border-[#232A33]"}`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-[#E6EDF3]">
                        {promo.research_variants?.variant_code}
                      </h3>
                      <span className="text-xs px-2 py-1 bg-purple-100 text-purple-800 rounded-full">
                        {promo.research_programs?.domain}
                      </span>
                    </div>
                    <p className="text-sm text-slate-400 mt-1">
                      {promo.research_variants?.description}
                    </p>
                    <div className="flex items-center gap-4 mt-2 text-xs text-slate-500">
                      <span>
                        Benchmarks: {promo.benchmarks_passed}/
                        {promo.benchmarks_total} passed
                      </span>
                      {promo.net_improvement_pct != null && (
                        <span className="text-green-600 font-medium">
                          +{promo.net_improvement_pct.toFixed(1)}% improvement
                        </span>
                      )}
                      <span>
                        {new Date(promo.created_at).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  <span
                    className={`text-xs px-2 py-1 rounded-full ${
                      promo.review_status === "pending"
                        ? "bg-orange-100 text-orange-800"
                        : promo.review_status === "approved"
                          ? "bg-green-100 text-green-800"
                          : promo.review_status === "promoted_to_staging"
                            ? "bg-blue-100 text-blue-800"
                            : promo.review_status === "rejected"
                              ? "bg-red-100 text-red-800"
                              : "bg-white/[0.04] text-slate-500"
                    }`}
                  >
                    {promo.review_status?.replace(/_/g, " ")}
                  </span>
                </div>

                {promo.review_status === "pending" && (
                  <div className="flex gap-2 mt-4 pt-4 border-t border-[#1A2030]">
                    <button
                      onClick={() =>
                        updatePromotionStatus(
                          promo.id,
                          "approved",
                          "Approved for staging deployment",
                        )
                      }
                      className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white text-sm font-medium rounded hover:bg-green-700"
                    >
                      <CheckCircle size={14} /> Approve
                    </button>
                    <button
                      onClick={() =>
                        updatePromotionStatus(promo.id, "promoted_to_staging")
                      }
                      className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700"
                    >
                      <ArrowRight size={14} /> Promote to Staging
                    </button>
                    <button
                      onClick={() =>
                        updatePromotionStatus(
                          promo.id,
                          "rejected",
                          "Does not meet quality bar",
                        )
                      }
                      className="flex items-center gap-1 px-3 py-1.5 bg-slate-200 text-slate-300 text-sm font-medium rounded hover:bg-slate-300"
                    >
                      <XCircle size={14} /> Reject
                    </button>
                  </div>
                )}

                {promo.review_comments && (
                  <div className="mt-3 text-xs text-slate-500 italic">
                    Review: {promo.review_comments}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
