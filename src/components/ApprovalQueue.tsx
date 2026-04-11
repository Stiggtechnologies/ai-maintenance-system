/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import {
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  MessageSquare,
  CreditCard as Edit,
  ArrowUp,
} from "lucide-react";

interface Decision {
  id: string;
  decision_type: string;
  decision_data: any;
  confidence_score: number;
  status: string;
  created_at: string;
  approval_deadline: string;
  workflows: Array<{
    id: string;
    approval_level: number;
    status: string;
    comments: string;
  }>;
}

export function ApprovalQueue() {
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedDecision, setExpandedDecision] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [editMode, setEditMode] = useState<string | null>(null);
  const [editedData, setEditedData] = useState<any>(null);
  const [escalationReason, setEscalationReason] = useState("");

  useEffect(() => {
    loadDecisions();
    const interval = setInterval(loadDecisions, 30000);
    return () => clearInterval(interval);
  }, []);

  async function loadDecisions() {
    try {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) return;

      const { data, error } = await supabase
        .from("autonomous_decisions")
        .select(
          `
          *,
          workflows:approval_workflows(*)
        `,
        )
        .eq("status", "pending")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setDecisions(data || []);
    } catch (error) {
      console.error("Error loading decisions:", error);
    } finally {
      setLoading(false);
    }
  }

  async function handleApprove(decisionId: string) {
    setProcessingId(decisionId);
    try {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) return;

      await supabase
        .from("autonomous_decisions")
        .update({
          status: "approved",
          approved_by: user.user.id,
          executed_at: new Date().toISOString(),
        })
        .eq("id", decisionId);

      if (comment) {
        await supabase
          .from("approval_workflows")
          .update({
            status: "approved",
            comments: comment,
            responded_at: new Date().toISOString(),
          })
          .eq("decision_id", decisionId);
      }

      await supabase.rpc("broadcast_to_channel", {
        p_channel_name: "approvals.pending",
        p_message_type: "decision_approved",
        p_payload: { decision_id: decisionId },
        p_sender_id: user.user.id,
        p_priority: "high",
      });

      setComment("");
      await loadDecisions();
    } catch (error) {
      console.error("Error approving decision:", error);
    } finally {
      setProcessingId(null);
    }
  }

  async function handleReject(decisionId: string) {
    if (!comment) {
      alert("Please provide a reason for rejection");
      return;
    }

    setProcessingId(decisionId);
    try {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) return;

      await supabase
        .from("autonomous_decisions")
        .update({
          status: "rejected",
          approved_by: user.user.id,
        })
        .eq("id", decisionId);

      await supabase
        .from("approval_workflows")
        .update({
          status: "rejected",
          comments: comment,
          responded_at: new Date().toISOString(),
        })
        .eq("decision_id", decisionId);

      await supabase.rpc("broadcast_to_channel", {
        p_channel_name: "approvals.pending",
        p_message_type: "decision_rejected",
        p_payload: { decision_id: decisionId, reason: comment },
        p_sender_id: user.user.id,
        p_priority: "high",
      });

      setComment("");
      await loadDecisions();
    } catch (error) {
      console.error("Error rejecting decision:", error);
    } finally {
      setProcessingId(null);
    }
  }

  async function handleEscalate(decisionId: string) {
    if (!escalationReason) {
      alert("Please provide a reason for escalation");
      return;
    }

    setProcessingId(decisionId);
    try {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) return;

      const { data, error } = await supabase.rpc("escalate_approval", {
        p_approval_id: decisionId,
        p_reason: escalationReason,
      });

      if (error) throw error;

      await supabase.rpc("broadcast_to_channel", {
        p_channel_name: "approvals.pending",
        p_message_type: "decision_escalated",
        p_payload: { decision_id: decisionId, ...data },
        p_sender_id: user.user.id,
        p_priority: "high",
      });

      setEscalationReason("");
      await loadDecisions();
    } catch (error) {
      console.error("Error escalating decision:", error);
      alert("Failed to escalate: " + (error as Error).message);
    } finally {
      setProcessingId(null);
    }
  }

  async function handleEditAndApprove(decisionId: string) {
    if (!editedData) {
      alert("No changes made");
      return;
    }

    setProcessingId(decisionId);
    try {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) return;

      await supabase
        .from("autonomous_decisions")
        .update({
          decision_data: editedData,
          status: "approved",
          approved_by: user.user.id,
          executed_at: new Date().toISOString(),
          modified_before_approval: true,
        })
        .eq("id", decisionId);

      await supabase
        .from("approval_workflows")
        .update({
          status: "approved",
          comments: comment || "Modified and approved",
          responded_at: new Date().toISOString(),
        })
        .eq("decision_id", decisionId);

      await supabase.rpc("broadcast_to_channel", {
        p_channel_name: "approvals.pending",
        p_message_type: "decision_modified_approved",
        p_payload: { decision_id: decisionId, modifications: editedData },
        p_sender_id: user.user.id,
        p_priority: "high",
      });

      setEditMode(null);
      setEditedData(null);
      setComment("");
      await loadDecisions();
    } catch (error) {
      console.error("Error editing and approving decision:", error);
    } finally {
      setProcessingId(null);
    }
  }

  function startEdit(decision: Decision) {
    setEditMode(decision.id);
    setEditedData(JSON.parse(JSON.stringify(decision.decision_data)));
  }

  function getDecisionIcon(type: string) {
    switch (type) {
      case "create_work_order":
        return "📋";
      case "schedule_maintenance":
        return "🔧";
      case "order_parts":
        return "📦";
      case "escalate_alert":
        return "🚨";
      default:
        return "⚙️";
    }
  }

  function getUrgencyColor(deadline: string) {
    const hoursRemaining =
      (new Date(deadline).getTime() - Date.now()) / (1000 * 60 * 60);
    if (hoursRemaining < 2) return "text-red-600";
    if (hoursRemaining < 6) return "text-orange-600";
    return "text-slate-400";
  }

  function formatTimeRemaining(deadline: string) {
    const msRemaining = new Date(deadline).getTime() - Date.now();
    const hoursRemaining = Math.floor(msRemaining / (1000 * 60 * 60));
    const minutesRemaining = Math.floor(
      (msRemaining % (1000 * 60 * 60)) / (1000 * 60),
    );

    if (hoursRemaining < 0) return "Expired";
    if (hoursRemaining === 0) return `${minutesRemaining}m remaining`;
    return `${hoursRemaining}h ${minutesRemaining}m remaining`;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading approvals...</div>
      </div>
    );
  }

  if (decisions.length === 0) {
    return (
      <div className="bg-[#11161D] rounded-lg shadow p-8 text-center">
        <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
        <h3 className="text-xl font-semibold text-[#E6EDF3] mb-2">
          All Clear!
        </h3>
        <p className="text-slate-400">No pending approvals at this time.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-[#E6EDF3]">Approval Queue</h2>
        <div className="flex items-center space-x-2">
          <AlertTriangle className="w-5 h-5 text-orange-500" />
          <span className="text-lg font-semibold text-slate-300">
            {decisions.length} pending
          </span>
        </div>
      </div>

      {decisions.map((decision) => (
        <div
          key={decision.id}
          className="bg-[#11161D] rounded-lg shadow-md border border-[#232A33] overflow-hidden"
        >
          <div className="p-6">
            <div className="flex items-start justify-between">
              <div className="flex items-start space-x-4 flex-1">
                <div className="text-4xl">
                  {getDecisionIcon(decision.decision_type)}
                </div>
                <div className="flex-1">
                  <div className="flex items-center space-x-2 mb-2">
                    <h3 className="text-lg font-semibold text-[#E6EDF3]">
                      {decision.decision_type.replace(/_/g, " ").toUpperCase()}
                    </h3>
                    <span className="px-2 py-1 text-xs font-medium bg-teal-500/10 text-teal-400 border border-teal-500/20 rounded-full">
                      {Math.round(decision.confidence_score)}% confidence
                    </span>
                  </div>

                  <div className="text-sm text-slate-400 space-y-1">
                    {Object.entries(decision.decision_data).map(
                      ([key, value]) => (
                        <div key={key}>
                          <span className="font-medium">
                            {key.replace(/_/g, " ")}:
                          </span>{" "}
                          <span>{JSON.stringify(value)}</span>
                        </div>
                      ),
                    )}
                  </div>

                  <div className="flex items-center space-x-4 mt-3 text-sm">
                    <div className="flex items-center space-x-1 text-gray-500">
                      <Clock className="w-4 h-4" />
                      <span>
                        {new Date(decision.created_at).toLocaleString()}
                      </span>
                    </div>
                    <div
                      className={`flex items-center space-x-1 font-medium ${getUrgencyColor(decision.approval_deadline)}`}
                    >
                      <AlertTriangle className="w-4 h-4" />
                      <span>
                        {formatTimeRemaining(decision.approval_deadline)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <button
                onClick={() =>
                  setExpandedDecision(
                    expandedDecision === decision.id ? null : decision.id,
                  )
                }
                className="ml-4 p-2 hover:bg-[#161C24] rounded-lg transition-colors"
              >
                {expandedDecision === decision.id ? (
                  <ChevronUp className="w-5 h-5 text-slate-400" />
                ) : (
                  <ChevronDown className="w-5 h-5 text-slate-400" />
                )}
              </button>
            </div>

            {expandedDecision === decision.id && (
              <div className="mt-6 pt-6 border-t border-[#232A33]">
                <div className="space-y-4">
                  <div>
                    <label className="flex items-center space-x-2 text-sm font-medium text-slate-300 mb-2">
                      <MessageSquare className="w-4 h-4" />
                      <span>Comment (required for rejection)</span>
                    </label>
                    <textarea
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      placeholder="Add your comments or reason for decision..."
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500/40 focus:border-transparent"
                      rows={3}
                    />
                  </div>

                  <div className="flex items-center flex-wrap gap-3">
                    <button
                      onClick={() => handleApprove(decision.id)}
                      disabled={processingId === decision.id}
                      className="flex items-center space-x-2 px-6 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
                    >
                      <CheckCircle className="w-5 h-5" />
                      <span>
                        {processingId === decision.id
                          ? "Processing..."
                          : "Approve"}
                      </span>
                    </button>

                    <button
                      onClick={() => startEdit(decision)}
                      disabled={processingId === decision.id}
                      className="flex items-center space-x-2 px-6 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-500 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
                    >
                      <Edit className="w-5 h-5" />
                      <span>Edit & Approve</span>
                    </button>

                    <button
                      onClick={() => handleReject(decision.id)}
                      disabled={processingId === decision.id}
                      className="flex items-center space-x-2 px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
                    >
                      <XCircle className="w-5 h-5" />
                      <span>
                        {processingId === decision.id
                          ? "Processing..."
                          : "Reject"}
                      </span>
                    </button>

                    <button
                      onClick={() => {
                        const reason = prompt("Enter escalation reason:");
                        if (reason) {
                          setEscalationReason(reason);
                          handleEscalate(decision.id);
                        }
                      }}
                      disabled={processingId === decision.id}
                      className="flex items-center space-x-2 px-6 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
                    >
                      <ArrowUp className="w-5 h-5" />
                      <span>Escalate</span>
                    </button>

                    <button
                      onClick={() => {
                        setExpandedDecision(null);
                        setComment("");
                        setEditMode(null);
                        setEditedData(null);
                      }}
                      className="px-6 py-2 border border-gray-300 text-slate-300 rounded-lg hover:bg-[#0B0F14] transition-colors"
                    >
                      Cancel
                    </button>
                  </div>

                  {editMode === decision.id && editedData && (
                    <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                      <h4 className="font-semibold text-blue-900 mb-3">
                        Edit Decision Data
                      </h4>
                      <textarea
                        value={JSON.stringify(editedData, null, 2)}
                        onChange={(e) => {
                          try {
                            setEditedData(JSON.parse(e.target.value));
                          } catch (err) {
                            // Invalid JSON, keep current value
                          }
                        }}
                        className="w-full px-3 py-2 border border-blue-300 rounded-lg font-mono text-sm"
                        rows={8}
                      />
                      <div className="flex items-center gap-3 mt-3">
                        <button
                          onClick={() => handleEditAndApprove(decision.id)}
                          disabled={processingId === decision.id}
                          className="flex items-center space-x-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-500"
                        >
                          <CheckCircle className="w-4 h-4" />
                          <span>Save & Approve</span>
                        </button>
                        <button
                          onClick={() => {
                            setEditMode(null);
                            setEditedData(null);
                          }}
                          className="px-4 py-2 border border-gray-300 text-slate-300 rounded-lg hover:bg-[#0B0F14]"
                        >
                          Cancel Edit
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
