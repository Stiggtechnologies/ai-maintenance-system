import { useState, useEffect } from "react";
import {
  Brain,
  TrendingUp,
  AlertTriangle,
  CheckCircle,
  Zap,
} from "lucide-react";
import { supabase } from "../lib/supabase";

interface AgentStats {
  total_conversations: number;
  avg_confidence: number;
  total_decisions: number;
  auto_executed: number;
  avg_response_time: number;
}

export function AIAnalyticsDashboard() {
  const [stats, setStats] = useState<AgentStats | null>(null);
  const [recentDecisions, setRecentDecisions] = useState<
    Array<{
      id: string;
      decision_type: string;
      status: string;
      confidence_score: number;
      requires_approval: boolean;
      created_at: string;
    }>
  >([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadAnalytics();
  }, []);

  const loadAnalytics = async () => {
    try {
      const [decisionsRes] = await Promise.all([
        supabase
          .from("autonomous_decisions")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(20),
      ]);

      const decisions = decisionsRes.data || [];
      setRecentDecisions(decisions);

      const autoExec = decisions.filter(
        (d) => d.status === "auto_executed",
      ).length;
      const avgConf =
        decisions.length > 0
          ? decisions.reduce((sum, d) => sum + (d.confidence_score || 0), 0) /
            decisions.length
          : 0;

      setStats({
        total_conversations: 0,
        avg_confidence: Math.round(avgConf),
        total_decisions: decisions.length,
        auto_executed: autoExec,
        avg_response_time: 0,
      });
    } catch (error) {
      console.error("Error loading AI analytics:", error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-slate-400">Loading AI analytics...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-[#E6EDF3] flex items-center gap-2">
          <Brain size={24} className="text-purple-600" /> AI Analytics
        </h2>
        <p className="text-sm text-slate-500 mt-1">
          Autonomous decision intelligence and performance
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-[#11161D] border border-[#232A33] rounded-xl p-4">
          <Zap size={18} className="text-purple-500 mb-2" />
          <div className="text-2xl font-bold text-[#E6EDF3]">
            {stats?.total_decisions || 0}
          </div>
          <div className="text-xs text-slate-500">Total Decisions</div>
        </div>
        <div className="bg-[#11161D] border border-[#232A33] rounded-xl p-4">
          <CheckCircle size={18} className="text-green-500 mb-2" />
          <div className="text-2xl font-bold text-[#E6EDF3]">
            {stats?.auto_executed || 0}
          </div>
          <div className="text-xs text-slate-500">Auto-Executed</div>
        </div>
        <div className="bg-[#11161D] border border-[#232A33] rounded-xl p-4">
          <TrendingUp size={18} className="text-blue-500 mb-2" />
          <div className="text-2xl font-bold text-[#E6EDF3]">
            {stats?.avg_confidence || 0}%
          </div>
          <div className="text-xs text-slate-500">Avg Confidence</div>
        </div>
        <div className="bg-[#11161D] border border-[#232A33] rounded-xl p-4">
          <AlertTriangle size={18} className="text-yellow-500 mb-2" />
          <div className="text-2xl font-bold text-[#E6EDF3]">
            {recentDecisions.filter((d) => d.requires_approval).length}
          </div>
          <div className="text-xs text-slate-500">Required Approval</div>
        </div>
      </div>

      {/* Recent Decisions */}
      <div className="bg-[#11161D] border border-[#232A33] rounded-xl p-6">
        <h3 className="text-lg font-semibold text-[#E6EDF3] mb-4">
          Recent Autonomous Decisions
        </h3>
        {recentDecisions.length === 0 ? (
          <p className="text-slate-500 text-center py-8">
            No autonomous decisions recorded yet
          </p>
        ) : (
          <div className="space-y-3">
            {recentDecisions.map((d) => (
              <div
                key={d.id}
                className="flex items-center justify-between p-3 bg-[#0B0F14] rounded-lg"
              >
                <div className="flex-1">
                  <div className="text-sm font-medium text-[#E6EDF3]">
                    {d.decision_type?.replace(/_/g, " ")}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {new Date(d.created_at).toLocaleString()} | Confidence:{" "}
                    {d.confidence_score}%
                  </div>
                </div>
                <span
                  className={`text-xs px-2 py-1 rounded-full ${
                    d.status === "auto_executed"
                      ? "bg-green-100 text-green-800"
                      : d.status === "approved"
                        ? "bg-blue-100 text-blue-800"
                        : d.status === "rejected"
                          ? "bg-red-100 text-red-800"
                          : "bg-yellow-100 text-yellow-800"
                  }`}
                >
                  {d.status?.replace(/_/g, " ")}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
