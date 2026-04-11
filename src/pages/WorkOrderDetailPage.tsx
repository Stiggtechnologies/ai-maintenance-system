import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { AgentErrorBoundary } from "../components/AgentErrorBoundary";
import {
  ArrowLeft,
  Wrench,
  Clock,
  User,
  AlertTriangle,
  CheckCircle,
  Calendar,
  FileText,
  Sparkles,
  Shield,
  Loader2,
} from "lucide-react";

type TabKey = "details" | "tasks" | "history";

// Reliability assessment state from the three-plane flow
interface ReliabilityAssessment {
  correlation_id: string;
  decision_id: string | null;
  approval_status: string;
  confidence: number;
  risk_level: string;
  raw_summary: string;
  likely_causes: string[];
  recommended_actions: string[];
  requires_human_review: boolean;
}

interface FailureModeClassification {
  correlation_id: string;
  decision_id: string | null;
  approval_status: string;
  confidence: number;
  risk_level: string;
  raw_summary: string;
  failure_mode: string;
  failure_mode_family: string;
  likely_cause_family: string;
  recommended_next_diagnostic_step: string;
}

export function WorkOrderDetailPage() {
  const { workOrderId } = useParams<{ workOrderId: string }>();
  const navigate = useNavigate();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pre-existing; typed WO interface deferred
  const [workOrder, setWorkOrder] = useState<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pre-existing
  const [statusHistory, setStatusHistory] = useState<any[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pre-existing
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabKey>("details");
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [assessment, setAssessment] = useState<ReliabilityAssessment | null>(
    null,
  );
  const [assessmentLoading, setAssessmentLoading] = useState(false);
  const [assessmentError, setAssessmentError] = useState<string | null>(null);
  const [assessmentCorrelationId, setAssessmentCorrelationId] = useState<
    string | null
  >(null);

  const [approvalLoading, setApprovalLoading] = useState(false);

  const [classification, setClassification] =
    useState<FailureModeClassification | null>(null);
  const [classificationLoading, setClassificationLoading] = useState(false);
  const [classificationError, setClassificationError] = useState<string | null>(
    null,
  );
  const [classificationCorrelationId, setClassificationCorrelationId] =
    useState<string | null>(null);

  // Draft Reliability Assessment — single backend call.
  // ai-agent-processor handles the full three-plane flow internally:
  //   1. OpenClaw intelligence trace (sir_orchestration_runs)
  //   2. SIR interaction logging (sir_sessions/messages/costs)
  //   3. Autonomous decision + approval (autonomous_decisions/approval_workflows)
  // Correlation ID is generated server-side — frontend never sources it.
  const handleDraftAssessment = useCallback(async () => {
    if (!workOrder || !workOrderId) return;
    setAssessmentLoading(true);
    setAssessmentError(null);
    setAssessmentCorrelationId(null);

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
    const assetId = workOrder.asset_id;
    const tenantId =
      workOrder.organization_id || "00000000-0000-0000-0000-000000000001";

    try {
      const res = await fetch(
        `${supabaseUrl}/functions/v1/ai-agent-processor`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${supabaseKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            task_code: "draft_reliability_assessment",
            agent_code: "reliability_engineer",
            tenant_id: tenantId,
            autonomy_level: "conditional",
            idempotency_key: `${workOrderId}:draft_reliability_assessment:1.0.0`,
            input_schema_version: "1.0.0",
            prompt_version: "1.0.0",
            input: {
              work_order_id: workOrderId,
              asset_id: assetId,
              trigger_reason: "manual_request",
            },
          }),
        },
      );

      if (!res.ok) {
        const err = await res
          .json()
          .catch(() => ({ error: "Request failed", correlation_id: null }));
        if (err.correlation_id) setAssessmentCorrelationId(err.correlation_id);
        throw new Error(err.error || `Assessment failed: ${res.status}`);
      }

      const result = await res.json();
      setAssessmentCorrelationId(result.correlation_id);

      setAssessment({
        correlation_id: result.correlation_id,
        decision_id: result.decision_id || null,
        approval_status: result.approval_status || "pending",
        confidence: result.confidence,
        risk_level: result.output?.risk_level || "medium",
        raw_summary: result.raw_summary,
        likely_causes: result.output?.likely_causes || [],
        recommended_actions: result.output?.recommended_actions || [],
        requires_human_review: result.requires_human_review,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      setAssessmentError(errorMessage);
    } finally {
      setAssessmentLoading(false);
    }
  }, [workOrder, workOrderId]);

  // Approve & Execute — closes the governance loop via backend.
  const handleApproveAndExecute = useCallback(async () => {
    if (!assessment?.decision_id) return;
    setApprovalLoading(true);

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

    try {
      const res = await fetch(
        `${supabaseUrl}/functions/v1/autonomous-orchestrator`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${supabaseKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "approve_and_execute_decision",
            data: {
              decision_id: assessment.decision_id,
              approver_id: "00000000-0000-0000-0000-000000000000",
              action_type: "append_work_order_note",
            },
          }),
        },
      );

      if (!res.ok) {
        const err = await res
          .json()
          .catch(() => ({ error: "Approval failed" }));
        throw new Error(err.error || `Approval failed: ${res.status}`);
      }

      // Update local state to reflect approval
      setAssessment((prev) =>
        prev
          ? {
              ...prev,
              approval_status: "approved",
              requires_human_review: false,
            }
          : null,
      );

      // Reload work order data to show the new status history note
      if (workOrderId) {
        loadWorkOrderData(workOrderId);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Approval failed";
      setAssessmentError(msg);
    } finally {
      setApprovalLoading(false);
    }
  }, [assessment, workOrderId]);

  // Classify Failure Mode — same single-call pattern, different task_code.
  const handleClassifyFailureMode = useCallback(async () => {
    if (!workOrder || !workOrderId) return;
    setClassificationLoading(true);
    setClassificationError(null);
    setClassificationCorrelationId(null);

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
    const assetId = workOrder.asset_id;
    const tenantId =
      workOrder.organization_id || "00000000-0000-0000-0000-000000000001";

    try {
      const res = await fetch(
        `${supabaseUrl}/functions/v1/ai-agent-processor`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${supabaseKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            task_code: "classify_failure_mode",
            agent_code: "failure_mode_analyst",
            tenant_id: tenantId,
            autonomy_level: "advisory",
            idempotency_key: `${workOrderId}:classify_failure_mode:1.0.0`,
            input_schema_version: "1.0.0",
            prompt_version: "1.0.0",
            input: {
              work_order_id: workOrderId,
              asset_id: assetId,
              trigger_reason: "manual_request",
            },
          }),
        },
      );

      if (!res.ok) {
        const err = await res
          .json()
          .catch(() => ({ error: "Request failed", correlation_id: null }));
        if (err.correlation_id)
          setClassificationCorrelationId(err.correlation_id);
        throw new Error(err.error || `Classification failed: ${res.status}`);
      }

      const result = await res.json();
      setClassificationCorrelationId(result.correlation_id);

      setClassification({
        correlation_id: result.correlation_id,
        decision_id: result.decision_id || null,
        approval_status: result.approval_status || "pending",
        confidence: result.confidence,
        risk_level: result.output?.risk_level || "medium",
        raw_summary: result.raw_summary,
        failure_mode: result.output?.failure_mode || "Unknown",
        failure_mode_family: result.output?.failure_mode_family || "unknown",
        likely_cause_family: result.output?.likely_cause_family || "unknown",
        recommended_next_diagnostic_step:
          result.output?.recommended_next_diagnostic_step ||
          "No recommendation",
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      setClassificationError(errorMessage);
    } finally {
      setClassificationLoading(false);
    }
  }, [workOrder, workOrderId]);

  useEffect(() => {
    if (workOrderId) {
      loadWorkOrderData(workOrderId);
    }
  }, [workOrderId]);

  const loadWorkOrderData = async (id: string) => {
    try {
      setLoading(true);
      const [woResult, historyResult, tasksResult] = await Promise.all([
        supabase
          .from("work_orders")
          .select("*, assets(name, asset_tag), sites(name)")
          .eq("id", id)
          .single(),
        supabase
          .from("work_order_status_history")
          .select("*")
          .eq("work_order_id", id)
          .order("changed_at", { ascending: false }),
        supabase
          .from("work_order_tasks")
          .select("*")
          .eq("work_order_id", id)
          .order("task_sequence"),
      ]);

      if (woResult.data) setWorkOrder(woResult.data);
      if (historyResult.data) setStatusHistory(historyResult.data);
      if (tasksResult.data) setTasks(tasksResult.data);
    } catch (error) {
      console.error("Error loading work order:", error);
    } finally {
      setLoading(false);
    }
  };

  const updateStatus = async (newStatus: string) => {
    if (!workOrder || !workOrderId) return;
    setUpdatingStatus(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      await supabase
        .from("work_orders")
        .update({
          status: newStatus,
          updated_at: new Date().toISOString(),
          ...(newStatus === "completed"
            ? { completed_at: new Date().toISOString() }
            : {}),
        })
        .eq("id", workOrderId);

      await supabase.from("work_order_status_history").insert({
        work_order_id: workOrderId,
        status_from: workOrder.status,
        status_to: newStatus,
        changed_by: user?.id,
        changed_at: new Date().toISOString(),
      });

      loadWorkOrderData(workOrderId);
    } catch (error) {
      console.error("Error updating status:", error);
    } finally {
      setUpdatingStatus(false);
    }
  };

  const statusColors: Record<string, string> = {
    new: "bg-blue-100 text-blue-800",
    pending: "bg-slate-100 text-slate-700",
    in_progress: "bg-yellow-100 text-yellow-800",
    pending_approval: "bg-orange-100 text-orange-800",
    completed: "bg-green-100 text-green-800",
    cancelled: "bg-slate-100 text-slate-400",
  };

  const priorityColors: Record<string, string> = {
    critical: "bg-red-100 text-red-700",
    high: "bg-orange-100 text-orange-700",
    medium: "bg-blue-100 text-blue-700",
    low: "bg-slate-100 text-slate-400",
  };

  const formatDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return "--";
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatLabel = (str: string) =>
    str.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-slate-400">Loading work order...</div>
      </div>
    );
  }

  if (!workOrder) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <div className="text-slate-500">Work order not found</div>
        <button
          onClick={() => navigate("/work")}
          className="text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
        >
          <ArrowLeft size={16} />
          Back to Work Management
        </button>
      </div>
    );
  }

  const nextStatus: Record<string, string> = {
    new: "in_progress",
    pending: "in_progress",
    in_progress: "completed",
  };

  const nextStatusLabel: Record<string, string> = {
    new: "Start Work",
    pending: "Start Work",
    in_progress: "Mark Completed",
  };

  const tabs: { key: TabKey; label: string }[] = [
    { key: "details", label: "Details" },
    { key: "tasks", label: "Tasks" },
    { key: "history", label: "Status History" },
  ];

  return (
    <div className="space-y-6">
      {/* Back button */}
      <button
        onClick={() => navigate("/work")}
        className="flex items-center gap-1.5 text-slate-400 hover:text-[#E6EDF3] transition-colors font-medium text-sm"
      >
        <ArrowLeft size={16} />
        Back to Work Management
      </button>

      {/* Header */}
      <div className="glass border border-white/[0.06] rounded-xl p-6">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex items-center gap-3 flex-1">
            <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
              <Wrench size={20} className="text-blue-600" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-[#E6EDF3]">
                {workOrder.wo_number || `WO-${workOrder.id?.slice(0, 8)}`}
              </h1>
              <p className="text-slate-400 text-sm">{workOrder.title}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`px-2.5 py-1 text-xs font-semibold rounded-full ${
                statusColors[workOrder.status] || "bg-slate-100 text-slate-400"
              }`}
            >
              {formatLabel(workOrder.status || "unknown")}
            </span>
            {workOrder.priority && (
              <span
                className={`px-2.5 py-1 text-xs font-semibold rounded-full ${
                  priorityColors[workOrder.priority] ||
                  "bg-slate-100 text-slate-400"
                }`}
              >
                {formatLabel(workOrder.priority)}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Info Grid */}
      <div className="glass border border-white/[0.06] rounded-xl p-6">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          <InfoItem
            icon={<Wrench size={16} className="text-slate-400" />}
            label="Asset"
            value={
              workOrder.assets
                ? `${workOrder.assets.name}${workOrder.assets.asset_tag ? ` (${workOrder.assets.asset_tag})` : ""}`
                : "--"
            }
          />
          <InfoItem
            icon={<AlertTriangle size={16} className="text-slate-400" />}
            label="Site"
            value={workOrder.sites?.name || "--"}
          />
          <InfoItem
            icon={<User size={16} className="text-slate-400" />}
            label="Assigned To"
            value={workOrder.assigned_to || "--"}
          />
          <InfoItem
            icon={<Calendar size={16} className="text-slate-400" />}
            label="Created"
            value={formatDate(workOrder.created_at)}
          />
          <InfoItem
            icon={<Calendar size={16} className="text-slate-400" />}
            label="Due Date"
            value={formatDate(workOrder.due_date)}
          />
          <InfoItem
            icon={<Clock size={16} className="text-slate-400" />}
            label="Estimated Hours"
            value={
              workOrder.estimated_hours != null
                ? `${workOrder.estimated_hours}h`
                : "--"
            }
          />
          <InfoItem
            icon={<Clock size={16} className="text-slate-400" />}
            label="Actual Hours"
            value={
              workOrder.actual_hours != null
                ? `${workOrder.actual_hours}h`
                : "--"
            }
          />
        </div>
      </div>

      {/* Status Action Buttons */}
      {nextStatus[workOrder.status] && (
        <div className="glass border border-white/[0.06] rounded-xl p-6">
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-400 font-medium">
              Update Status:
            </span>
            <button
              onClick={() => updateStatus(nextStatus[workOrder.status])}
              disabled={updatingStatus}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 ${
                nextStatus[workOrder.status] === "completed"
                  ? "bg-green-600 text-white hover:bg-green-700"
                  : "bg-blue-600 text-white hover:bg-blue-700"
              }`}
            >
              {updatingStatus
                ? "Updating..."
                : nextStatusLabel[workOrder.status]}
            </button>
          </div>
        </div>
      )}

      {/* Reliability Assessment — three-plane governed flow */}
      <AgentErrorBoundary correlationId={assessmentCorrelationId || undefined}>
        <div className="glass border border-white/[0.06] rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Sparkles size={18} className="text-blue-600" />
              <h2 className="text-lg font-semibold text-[#E6EDF3]">
                Reliability Assessment
              </h2>
            </div>
            {!assessment && (
              <button
                onClick={handleDraftAssessment}
                disabled={assessmentLoading}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {assessmentLoading ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Analyzing...
                  </>
                ) : (
                  <>
                    <Sparkles size={14} />
                    Draft Reliability Assessment
                  </>
                )}
              </button>
            )}
          </div>

          {assessmentError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg mb-3">
              <div className="flex items-center gap-2 text-red-700 text-sm font-medium mb-1">
                <AlertTriangle size={14} />
                Assessment Failed
              </div>
              <p className="text-sm text-red-600">{assessmentError}</p>
              {assessmentCorrelationId && (
                <p className="text-xs text-red-400 mt-1 font-mono">
                  Correlation: {assessmentCorrelationId}
                </p>
              )}
            </div>
          )}

          {assessment && (
            <div className="space-y-4">
              {/* Status + confidence bar */}
              <div className="flex items-center gap-3 flex-wrap">
                <span
                  className={`px-2.5 py-1 text-xs font-semibold rounded-full ${
                    assessment.approval_status === "pending"
                      ? "bg-orange-100 text-orange-800"
                      : assessment.approval_status === "approved"
                        ? "bg-green-100 text-green-800"
                        : "bg-slate-100 text-slate-400"
                  }`}
                >
                  {assessment.requires_human_review &&
                  assessment.approval_status !== "approved"
                    ? "Pending Approval"
                    : assessment.approval_status === "approved"
                      ? "Approved & Executed"
                      : assessment.approval_status}
                </span>
                <span
                  className={`px-2.5 py-1 text-xs font-semibold rounded-full ${
                    assessment.risk_level === "critical"
                      ? "bg-red-100 text-red-700"
                      : assessment.risk_level === "high"
                        ? "bg-orange-100 text-orange-700"
                        : assessment.risk_level === "medium"
                          ? "bg-yellow-100 text-yellow-700"
                          : "bg-green-100 text-green-700"
                  }`}
                >
                  Risk: {formatLabel(assessment.risk_level)}
                </span>
                <span className="text-xs text-slate-500">
                  Confidence: {Math.round(assessment.confidence * 100)}%
                </span>
                <span className="text-xs text-slate-400 font-mono">
                  {assessment.correlation_id.slice(0, 8)}
                </span>
              </div>

              {/* Summary */}
              <p className="text-sm text-slate-700">{assessment.raw_summary}</p>

              {/* Likely causes */}
              {assessment.likely_causes.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                    Likely Causes
                  </h4>
                  <ul className="text-sm text-slate-700 list-disc list-inside space-y-0.5">
                    {assessment.likely_causes.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Recommended actions */}
              {assessment.recommended_actions.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                    Recommended Actions
                  </h4>
                  <ul className="text-sm text-slate-700 list-disc list-inside space-y-0.5">
                    {assessment.recommended_actions.map((a, i) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Approve & Execute button (visible only when pending) */}
              {assessment.requires_human_review &&
                assessment.approval_status !== "approved" &&
                assessment.decision_id && (
                  <div className="pt-3 border-t border-[#1A2030]">
                    <button
                      onClick={handleApproveAndExecute}
                      disabled={approvalLoading}
                      className="px-4 py-2 text-sm font-medium rounded-lg bg-green-600 text-white hover:bg-green-700 transition-colors disabled:opacity-50 flex items-center gap-2"
                    >
                      {approvalLoading ? (
                        <>
                          <Loader2 size={14} className="animate-spin" />
                          Approving...
                        </>
                      ) : (
                        <>
                          <CheckCircle size={14} />
                          Approve &amp; Execute Recommendation
                        </>
                      )}
                    </button>
                    <p className="text-xs text-slate-400 mt-1">
                      Appends the recommendation as a governed note on this work
                      order.
                    </p>
                  </div>
                )}

              {/* Governance trail */}
              <div className="pt-3 border-t border-[#1A2030] flex items-center gap-4 text-xs text-slate-400">
                <span className="flex items-center gap-1">
                  <Shield size={12} /> Governed by Autonomous
                </span>
                {assessment.decision_id && (
                  <span>Decision: {assessment.decision_id.slice(0, 8)}</span>
                )}
                {assessment.approval_status === "approved" && (
                  <span className="text-green-600 font-medium">Executed</span>
                )}
              </div>
            </div>
          )}

          {!assessment && !assessmentLoading && !assessmentError && (
            <p className="text-sm text-slate-500">
              Request an AI-powered reliability assessment for this work order.
              The recommendation will require manager approval before any action
              is taken.
            </p>
          )}
        </div>
      </AgentErrorBoundary>

      {/* Failure Mode Classification — same governed pattern, advisory mode */}
      <AgentErrorBoundary
        correlationId={classificationCorrelationId || undefined}
      >
        <div className="glass border border-white/[0.06] rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <AlertTriangle size={18} className="text-orange-600" />
              <h2 className="text-lg font-semibold text-[#E6EDF3]">
                Failure Mode Classification
              </h2>
            </div>
            {!classification && (
              <button
                onClick={handleClassifyFailureMode}
                disabled={classificationLoading}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-orange-600 text-white hover:bg-orange-700 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {classificationLoading ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Classifying...
                  </>
                ) : (
                  <>
                    <AlertTriangle size={14} />
                    Classify Failure Mode
                  </>
                )}
              </button>
            )}
          </div>

          {classificationError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg mb-3">
              <div className="flex items-center gap-2 text-red-700 text-sm font-medium mb-1">
                <AlertTriangle size={14} />
                Classification Failed
              </div>
              <p className="text-sm text-red-600">{classificationError}</p>
              {classificationCorrelationId && (
                <p className="text-xs text-red-400 mt-1 font-mono">
                  Correlation: {classificationCorrelationId}
                </p>
              )}
            </div>
          )}

          {classification && (
            <div className="space-y-4">
              {/* Classification header */}
              <div className="flex items-center gap-3 flex-wrap">
                <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800">
                  Advisory
                </span>
                <span
                  className={`px-2.5 py-1 text-xs font-semibold rounded-full ${
                    classification.risk_level === "critical"
                      ? "bg-red-100 text-red-700"
                      : classification.risk_level === "high"
                        ? "bg-orange-100 text-orange-700"
                        : classification.risk_level === "medium"
                          ? "bg-yellow-100 text-yellow-700"
                          : "bg-green-100 text-green-700"
                  }`}
                >
                  Risk:{" "}
                  {classification.risk_level.charAt(0).toUpperCase() +
                    classification.risk_level.slice(1)}
                </span>
                <span className="text-xs text-slate-500">
                  Confidence: {Math.round(classification.confidence * 100)}%
                </span>
                <span className="text-xs text-slate-400 font-mono">
                  {classification.correlation_id.slice(0, 8)}
                </span>
              </div>

              {/* Summary */}
              <p className="text-sm text-slate-700">
                {classification.raw_summary}
              </p>

              {/* Classification details */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="bg-[#0B0F14] rounded-lg p-3">
                  <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                    Failure Mode
                  </div>
                  <div className="text-sm font-medium text-[#E6EDF3]">
                    {classification.failure_mode}
                  </div>
                </div>
                <div className="bg-[#0B0F14] rounded-lg p-3">
                  <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                    Family
                  </div>
                  <div className="text-sm font-medium text-[#E6EDF3] capitalize">
                    {classification.failure_mode_family}
                  </div>
                </div>
                <div className="bg-[#0B0F14] rounded-lg p-3">
                  <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                    Cause Family
                  </div>
                  <div className="text-sm font-medium text-[#E6EDF3] capitalize">
                    {classification.likely_cause_family}
                  </div>
                </div>
                <div className="bg-[#0B0F14] rounded-lg p-3 sm:col-span-2">
                  <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                    Next Diagnostic Step
                  </div>
                  <div className="text-sm text-slate-700">
                    {classification.recommended_next_diagnostic_step}
                  </div>
                </div>
              </div>

              {/* Governance trail */}
              <div className="pt-3 border-t border-[#1A2030] flex items-center gap-4 text-xs text-slate-400">
                <span className="flex items-center gap-1">
                  <Shield size={12} /> Governed by Autonomous
                </span>
                {classification.decision_id && (
                  <span>
                    Decision: {classification.decision_id.slice(0, 8)}
                  </span>
                )}
              </div>
            </div>
          )}

          {!classification &&
            !classificationLoading &&
            !classificationError && (
              <p className="text-sm text-slate-500">
                Classify the likely failure mode using FMEA/RCM methodology for
                FRACAS and reliability reporting.
              </p>
            )}
        </div>
      </AgentErrorBoundary>

      {/* Tab Bar */}
      <div className="border-b border-[#232A33]">
        <div className="flex gap-6">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`pb-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === "details" && (
        <div className="glass border border-white/[0.06] rounded-xl p-6 space-y-5">
          {workOrder.work_type && (
            <div>
              <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-1">
                Work Type
              </h3>
              <p className="text-[#E6EDF3]">
                {formatLabel(workOrder.work_type)}
              </p>
            </div>
          )}
          <div>
            <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-1">
              Description
            </h3>
            <p className="text-slate-700 whitespace-pre-wrap">
              {workOrder.description || "No description provided."}
            </p>
          </div>
          {workOrder.closeout_notes && (
            <div>
              <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-1">
                Closeout Notes
              </h3>
              <p className="text-slate-700 whitespace-pre-wrap">
                {workOrder.closeout_notes}
              </p>
            </div>
          )}
        </div>
      )}

      {activeTab === "tasks" && (
        <div className="glass border border-white/[0.06] rounded-xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <FileText size={18} className="text-slate-500" />
            <h2 className="text-lg font-semibold text-[#E6EDF3]">Tasks</h2>
            <span className="ml-auto px-2 py-0.5 bg-slate-100 text-slate-400 text-xs font-medium rounded">
              {tasks.length}
            </span>
          </div>
          {tasks.length === 0 ? (
            <p className="text-slate-500 text-sm">
              No tasks for this work order.
            </p>
          ) : (
            <div className="space-y-2">
              {tasks.map((task) => (
                <div
                  key={task.id}
                  className="flex items-start gap-3 p-3 bg-[#0B0F14] rounded-lg"
                >
                  <div className="mt-0.5">
                    {task.status === "completed" ? (
                      <CheckCircle size={18} className="text-green-500" />
                    ) : (
                      <div className="w-4.5 h-4.5 border-2 border-slate-300 rounded-full" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400 font-mono">
                        #{task.task_sequence}
                      </span>
                      <span
                        className={`font-medium text-sm ${
                          task.status === "completed"
                            ? "text-slate-400 line-through"
                            : "text-[#E6EDF3]"
                        }`}
                      >
                        {task.description}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
                      <span
                        className={`px-1.5 py-0.5 rounded ${
                          statusColors[task.status] ||
                          "bg-slate-100 text-slate-400"
                        }`}
                      >
                        {formatLabel(task.status || "pending")}
                      </span>
                      {task.estimated_hours != null && (
                        <span className="flex items-center gap-1">
                          <Clock size={12} />
                          {task.estimated_hours}h est
                        </span>
                      )}
                      {task.actual_hours != null && (
                        <span className="flex items-center gap-1">
                          <Clock size={12} />
                          {task.actual_hours}h actual
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === "history" && (
        <div className="glass border border-white/[0.06] rounded-xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <Clock size={18} className="text-slate-500" />
            <h2 className="text-lg font-semibold text-[#E6EDF3]">
              Status History
            </h2>
          </div>
          {statusHistory.length === 0 ? (
            <p className="text-slate-500 text-sm">
              No status changes recorded.
            </p>
          ) : (
            <div className="relative">
              <div className="absolute left-3 top-2 bottom-2 w-px bg-slate-200" />
              <div className="space-y-4">
                {statusHistory.map((entry) => (
                  <div key={entry.id} className="flex gap-4 relative">
                    <div className="w-6 h-6 bg-white border-2 border-slate-300 rounded-full flex items-center justify-center z-10 mt-0.5">
                      <div className="w-2 h-2 bg-slate-400 rounded-full" />
                    </div>
                    <div className="flex-1 pb-1">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span
                          className={`px-2 py-0.5 rounded text-xs font-medium ${
                            statusColors[entry.status_from] ||
                            "bg-slate-100 text-slate-400"
                          }`}
                        >
                          {formatLabel(entry.status_from || "unknown")}
                        </span>
                        <span className="text-slate-400">-&gt;</span>
                        <span
                          className={`px-2 py-0.5 rounded text-xs font-medium ${
                            statusColors[entry.status_to] ||
                            "bg-slate-100 text-slate-400"
                          }`}
                        >
                          {formatLabel(entry.status_to || "unknown")}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
                        <span>{formatDate(entry.changed_at)}</span>
                        {entry.changed_by && (
                          <span className="flex items-center gap-1">
                            <User size={12} />
                            {entry.changed_by}
                          </span>
                        )}
                      </div>
                      {entry.comments && (
                        <p className="text-sm text-slate-400 mt-1.5 bg-[#0B0F14] rounded-lg p-2">
                          {entry.comments}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function InfoItem({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-2">
      <div className="mt-0.5">{icon}</div>
      <div>
        <div className="text-xs text-slate-500 font-medium">{label}</div>
        <div className="text-sm text-[#E6EDF3] font-medium">{value}</div>
      </div>
    </div>
  );
}
