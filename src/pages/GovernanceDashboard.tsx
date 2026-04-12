/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect } from "react";
import {
  Shield,
  CheckCircle,
  XCircle,
  Clock,
  Lightbulb,
  AlertTriangle,
  TrendingUp,
} from "lucide-react";
import { governanceService } from "../services/governance";
import { recommendationService } from "../services/syncaiDataService";
import { platformService } from "../services/platform";

export function GovernanceDashboard() {
  const [approvals, setApprovals] = useState<any[]>([]);
  const [auditEvents, setAuditEvents] = useState<any[]>([]);
  const [recommendations, setRecommendations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<
    "approvals" | "recommendations" | "audit"
  >("approvals");

  useEffect(() => {
    loadGovernanceData();
  }, []);

  const loadGovernanceData = async () => {
    try {
      const userContext = await platformService.getCurrentUserContext();
      if (!userContext) {
        setLoading(false);
        return;
      }

      const [approvalsData, auditData, recsData] = await Promise.all([
        governanceService.getApprovals(userContext.organization_id),
        governanceService.getAuditEvents(userContext.organization_id, 50),
        recommendationService.getRecommendations(userContext.organization_id),
      ]);

      setApprovals(approvalsData);
      setAuditEvents(auditData);
      setRecommendations(recsData);
    } catch (error) {
      console.error("Error loading governance data:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (recommendationId: string) => {
    const result = await governanceService.approveRecommendation(
      recommendationId,
      "Approved via dashboard",
    );
    if (result.success) {
      loadGovernanceData();
    }
  };

  const handleReject = async (recommendationId: string) => {
    const result = await governanceService.rejectRecommendation(
      recommendationId,
      "Rejected via dashboard",
    );
    if (result.success) {
      loadGovernanceData();
    }
  };

  const handleAcceptRec = async (recId: string) => {
    await recommendationService.acceptRecommendation(recId);
    loadGovernanceData();
  };

  const handleDismissRec = async (recId: string) => {
    await recommendationService.dismissRecommendation(recId);
    loadGovernanceData();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-slate-400">Loading governance data...</div>
      </div>
    );
  }

  const pendingApprovals = approvals.filter((a) => a.status === "pending");
  const pendingRecs = recommendations.filter((r) => r.status === "pending");

  const tabs = [
    {
      id: "approvals" as const,
      label: "Approvals",
      count: pendingApprovals.length,
    },
    {
      id: "recommendations" as const,
      label: "AI Recommendations",
      count: pendingRecs.length,
    },
    { id: "audit" as const, label: "Audit Trail" },
  ];

  const priorityColors: Record<string, string> = {
    critical: "bg-red-500/10 text-red-400 border border-red-500/20",
    high: "bg-orange-500/10 text-orange-400 border border-orange-500/20",
    medium: "bg-teal-500/10 text-teal-400 border border-teal-500/20",
    low: "bg-white/[0.04] text-slate-500",
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#E6EDF3]">
          Governance & Compliance
        </h1>
        <p className="text-slate-400 mt-1">
          Approvals, AI recommendations, and audit trail
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="glass border border-white/[0.06] rounded-xl p-4">
          <div className="text-sm text-slate-500">Pending Approvals</div>
          <div className="text-2xl font-bold text-[#E6EDF3]">
            {pendingApprovals.length}
          </div>
        </div>
        <div className="glass border border-white/[0.06] rounded-xl p-4">
          <div className="text-sm text-slate-500">AI Recommendations</div>
          <div className="text-2xl font-bold text-[#E6EDF3]">
            {pendingRecs.length}
          </div>
        </div>
        <div className="glass border border-white/[0.06] rounded-xl p-4">
          <div className="text-sm text-slate-500">Audit Events (7d)</div>
          <div className="text-2xl font-bold text-[#E6EDF3]">
            {auditEvents.length}
          </div>
        </div>
        <div className="glass border border-white/[0.06] rounded-xl p-4">
          <div className="text-sm text-slate-500">Approval Rate</div>
          <div className="text-2xl font-bold text-[#E6EDF3]">
            {approvals.length > 0
              ? Math.round(
                  (approvals.filter((a) => a.status === "approved").length /
                    approvals.length) *
                    100,
                )
              : 0}
            %
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
              className={`pb-3 text-sm font-medium border-b-2 transition-colors ${activeTab === tab.id ? "border-teal-500 text-teal-400" : "border-transparent text-slate-500 hover:text-slate-300"}`}
            >
              {tab.label}
              {tab.count !== undefined && tab.count > 0 && (
                <span className="ml-2 text-xs bg-orange-500/10 text-orange-400 border border-orange-500/20 px-1.5 py-0.5 rounded-full">
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* Approvals Tab */}
      {activeTab === "approvals" && (
        <div className="glass border border-white/[0.06] rounded-xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <Clock size={20} className="text-slate-400" />
            <h2 className="text-lg font-semibold text-[#E6EDF3]">
              Pending Approvals
            </h2>
          </div>
          <div className="space-y-3">
            {pendingApprovals.length > 0 ? (
              pendingApprovals.map((approval) => (
                <div
                  key={approval.id}
                  className="border border-[#232A33] rounded-lg p-4"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="font-medium text-[#E6EDF3]">
                        {approval.entity_type}
                      </div>
                      <div className="text-sm text-slate-400 mt-1">
                        Created {new Date(approval.created_at).toLocaleString()}
                      </div>
                    </div>
                    <span className="px-2 py-1 bg-orange-500/10 text-orange-400 border border-orange-500/20 text-xs font-medium rounded">
                      {approval.status}
                    </span>
                  </div>
                  {approval.recommendations && (
                    <div className="text-sm text-slate-300 mb-3 p-3 bg-[#0B0F14] rounded">
                      {approval.recommendations.recommendation_text ||
                        "No description available"}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleApprove(approval.entity_id)}
                      className="flex items-center gap-1 px-3 py-1.5 bg-emerald-600 text-white text-sm font-medium rounded hover:bg-emerald-500"
                    >
                      <CheckCircle size={16} /> Approve
                    </button>
                    <button
                      onClick={() => handleReject(approval.entity_id)}
                      className="flex items-center gap-1 px-3 py-1.5 bg-red-600 text-white text-sm font-medium rounded hover:bg-red-700"
                    >
                      <XCircle size={16} /> Reject
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center text-slate-500 py-8">
                No pending approvals
              </div>
            )}
          </div>
        </div>
      )}

      {/* Recommendations Tab */}
      {activeTab === "recommendations" && (
        <div className="glass border border-white/[0.06] rounded-xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <Lightbulb size={20} className="text-yellow-500" />
            <h2 className="text-lg font-semibold text-[#E6EDF3]">
              AI Recommendations
            </h2>
          </div>
          <div className="space-y-3">
            {recommendations.length > 0 ? (
              recommendations.map((rec) => (
                <div
                  key={rec.id}
                  className="border border-[#232A33] rounded-lg p-4"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1">
                      <div className="font-medium text-[#E6EDF3]">
                        {rec.title}
                      </div>
                      {rec.assets?.name && (
                        <div className="text-xs text-slate-500 mt-1">
                          Asset: {rec.assets.name} ({rec.assets.asset_tag})
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {rec.confidence_score && (
                        <span className="text-xs text-slate-500 flex items-center gap-1">
                          <TrendingUp size={12} /> {rec.confidence_score}%
                          confidence
                        </span>
                      )}
                      <span
                        className={`px-2 py-1 text-xs font-medium rounded ${priorityColors[rec.priority] || "bg-white/[0.04] text-slate-500"}`}
                      >
                        {rec.priority}
                      </span>
                    </div>
                  </div>
                  <p className="text-sm text-slate-400 mb-3">{rec.summary}</p>
                  {rec.risk_score && (
                    <div className="flex items-center gap-1 text-xs text-slate-500 mb-3">
                      <AlertTriangle size={12} /> Risk score: {rec.risk_score}
                    </div>
                  )}
                  {rec.status === "pending" && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleAcceptRec(rec.id)}
                        className="flex items-center gap-1 px-3 py-1.5 bg-teal-600 text-white text-sm font-medium rounded hover:bg-teal-500"
                      >
                        <CheckCircle size={16} /> Accept
                      </button>
                      <button
                        onClick={() => handleDismissRec(rec.id)}
                        className="flex items-center gap-1 px-3 py-1.5 bg-slate-200 text-slate-300 text-sm font-medium rounded hover:bg-slate-300"
                      >
                        Dismiss
                      </button>
                    </div>
                  )}
                  {rec.status !== "pending" && (
                    <span
                      className={`text-xs px-2 py-1 rounded ${rec.status === "accepted" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-white/[0.04] text-slate-500"}`}
                    >
                      {rec.status}
                    </span>
                  )}
                </div>
              ))
            ) : (
              <div className="text-center text-slate-500 py-8">
                No AI recommendations at this time
              </div>
            )}
          </div>
        </div>
      )}

      {/* Audit Trail Tab */}
      {activeTab === "audit" && (
        <div className="glass border border-white/[0.06] rounded-xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <Shield size={20} className="text-slate-400" />
            <h2 className="text-lg font-semibold text-[#E6EDF3]">
              Audit Trail
            </h2>
          </div>
          <div className="space-y-2">
            {auditEvents.length > 0 ? (
              auditEvents.map((event) => (
                <div
                  key={event.id}
                  className="flex items-start gap-3 p-3 bg-white/[0.02] rounded-lg"
                >
                  <div className="w-2 h-2 bg-blue-500 rounded-full mt-2" />
                  <div className="flex-1">
                    <div className="text-sm text-[#E6EDF3]">
                      <span className="font-medium">{event.event_type}</span> on{" "}
                      <span className="font-medium">{event.entity_type}</span>
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      {new Date(
                        event.event_time || event.created_at,
                      ).toLocaleString()}{" "}
                      {event.actor_id && `by ${event.actor_type}`}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center text-slate-500 py-8">
                No audit events found
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
