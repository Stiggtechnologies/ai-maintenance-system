import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import {
  Activity,
  CircleCheck as CheckCircle,
  Clock,
  Shield,
  ChevronRight,
  ArrowLeft,
  Sparkles,
  Circle as XCircle,
  Loader as Loader2,
  Search,
  Filter,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RunSummary {
  id: string;
  decision_type: string;
  status: string;
  confidence_score: number;
  requires_approval: boolean;
  correlation_id: string | null;
  asset_id: string | null;
  work_order_id: string | null;
  autonomy_level: string | null;
  duration_ms: number | null;
  created_at: string;
  // Joined
  approval_status: string | null;
  action_status: string | null;
}

interface AuditChain {
  correlation_id: string;
  decisions: Array<Record<string, unknown>>;
  approvals: Array<Record<string, unknown>>;
  actions: Array<Record<string, unknown>>;
  intelligence_runs: Array<Record<string, unknown>>;
  sessions: Array<Record<string, unknown>>;
  total_cost_usd: number;
}

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

function deriveDisplayStatus(run: RunSummary): string {
  if (run.status === "failed") return "Failed";
  if (run.action_status === "true" || run.action_status === "success")
    return "Executed";
  if (run.status === "approved") return "Approved";
  if (run.approval_status === "pending" && run.requires_approval)
    return "Pending Approval";
  if (run.status === "pending") return "Pending";
  return "Completed";
}

function statusColor(display: string): string {
  switch (display) {
    case "Failed":
      return "bg-red-100 text-red-700";
    case "Executed":
      return "bg-green-100 text-green-800";
    case "Approved":
      return "bg-emerald-100 text-emerald-700";
    case "Pending Approval":
      return "bg-orange-100 text-orange-800";
    case "Pending":
      return "bg-yellow-100 text-yellow-800";
    default:
      return "bg-blue-100 text-blue-800";
  }
}

function statusIcon(display: string) {
  switch (display) {
    case "Failed":
      return <XCircle size={14} className="text-red-600" />;
    case "Executed":
      return <CheckCircle size={14} className="text-green-600" />;
    case "Approved":
      return <CheckCircle size={14} className="text-emerald-600" />;
    case "Pending Approval":
      return <Clock size={14} className="text-orange-600" />;
    default:
      return <Activity size={14} className="text-blue-600" />;
  }
}

function riskColor(level: string): string {
  switch (level) {
    case "critical":
      return "text-red-700 bg-red-50";
    case "high":
      return "text-orange-700 bg-orange-50";
    case "medium":
      return "text-yellow-700 bg-yellow-50";
    default:
      return "text-green-700 bg-green-50";
  }
}

function taskLabel(code: string): string {
  return code.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function RunsAuditPage() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRun, setSelectedRun] = useState<RunSummary | null>(null);
  const [auditChain, setAuditChain] = useState<AuditChain | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [capabilityFilter, setCapabilityFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Load recent runs from autonomous_decisions (canonical governance source)
  const loadRuns = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase
        .from("autonomous_decisions")
        .select(
          `
          id, decision_type, status, confidence_score, requires_approval,
          correlation_id, asset_id, work_order_id, autonomy_level,
          duration_ms, created_at
        `,
        )
        .order("created_at", { ascending: false })
        .limit(50);

      if (statusFilter !== "all") {
        query = query.eq("status", statusFilter);
      }
      if (capabilityFilter !== "all") {
        query = query.eq("decision_type", capabilityFilter);
      }

      const { data: decisions } = await query;

      if (!decisions) {
        setRuns([]);
        return;
      }

      // Batch-fetch approval and action status for all decisions
      const decisionIds = decisions.map((d) => d.id);

      const [approvalRes, actionRes] = await Promise.all([
        supabase
          .from("approval_workflows")
          .select("decision_id, status")
          .in("decision_id", decisionIds),
        supabase
          .from("autonomous_actions")
          .select("decision_id, success")
          .in("decision_id", decisionIds)
          .eq("success", true),
      ]);

      const approvalMap = new Map<string, string>();
      (approvalRes.data || []).forEach((a) =>
        approvalMap.set(a.decision_id as string, a.status as string),
      );

      const actionMap = new Map<string, string>();
      (actionRes.data || []).forEach((a) =>
        actionMap.set(a.decision_id as string, String(a.success)),
      );

      const enriched: RunSummary[] = decisions.map((d) => ({
        ...d,
        approval_status: approvalMap.get(d.id) || null,
        action_status: actionMap.get(d.id) || null,
      }));

      setRuns(enriched);
    } catch (error) {
      console.error("Error loading runs:", error);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, capabilityFilter]);

  useEffect(() => {
    loadRuns();
  }, [loadRuns]);

  // Load full audit chain for a selected run
  const loadAuditChain = useCallback(async (correlationId: string) => {
    setAuditLoading(true);
    setAuditChain(null);
    try {
      const { data, error } = await supabase.rpc("get_full_audit_chain", {
        p_correlation_id: correlationId,
      });
      if (!error && data) {
        setAuditChain(data as AuditChain);
      }
    } catch (error) {
      console.error("Error loading audit chain:", error);
    } finally {
      setAuditLoading(false);
    }
  }, []);

  const handleSelectRun = (run: RunSummary) => {
    setSelectedRun(run);
    if (run.correlation_id) {
      loadAuditChain(run.correlation_id);
    }
  };

  // Filter runs by search query (client-side for simplicity)
  const filteredRuns = runs.filter((r) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      r.decision_type.toLowerCase().includes(q) ||
      r.correlation_id?.toLowerCase().includes(q) ||
      r.work_order_id?.toLowerCase().includes(q) ||
      r.asset_id?.toLowerCase().includes(q)
    );
  });

  // ---------------------------------------------------------------------------
  // Drill-down panel
  // ---------------------------------------------------------------------------
  if (selectedRun) {
    const display = deriveDisplayStatus(selectedRun);
    const decision = auditChain?.decisions?.[0] as
      | Record<string, unknown>
      | undefined;
    const approval = auditChain?.approvals?.[0] as
      | Record<string, unknown>
      | undefined;
    const action = auditChain?.actions?.[0] as
      | Record<string, unknown>
      | undefined;
    const intelligenceRun = auditChain?.intelligence_runs?.[0] as
      | Record<string, unknown>
      | undefined;

    // Extract decision_data for evidence/summary
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- decision_data is untyped jsonb
    const decisionData = (decision as any)?.decision_data as
      | Record<string, unknown>
      | undefined;

    return (
      <div className="space-y-6">
        <button
          onClick={() => {
            setSelectedRun(null);
            setAuditChain(null);
          }}
          className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
        >
          <ArrowLeft size={16} /> Back to Runs
        </button>

        {/* Header */}
        <div className="glass border border-white/[0.06] rounded-xl p-6">
          <div className="flex items-center gap-3 mb-3">
            <Sparkles size={20} className="text-blue-600" />
            <h1 className="text-xl font-bold text-[#E6EDF3]">
              {taskLabel(selectedRun.decision_type)}
            </h1>
            <span
              className={`px-2.5 py-1 text-xs font-semibold rounded-full ${statusColor(display)}`}
            >
              {display}
            </span>
          </div>
          <div className="flex items-center gap-4 text-sm text-slate-500 flex-wrap">
            <span>{formatTime(selectedRun.created_at)}</span>
            {selectedRun.duration_ms && (
              <span className="flex items-center gap-1">
                <Clock size={12} /> {selectedRun.duration_ms}ms
              </span>
            )}
            <span className="flex items-center gap-1">
              <Shield size={12} /> {selectedRun.autonomy_level || "conditional"}
            </span>
            {selectedRun.correlation_id && (
              <span className="font-mono text-xs text-slate-400">
                {selectedRun.correlation_id.slice(0, 12)}...
              </span>
            )}
          </div>
        </div>

        {auditLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
          </div>
        ) : (
          <>
            {/* Summary + Confidence */}
            {decisionData && (
              <div className="glass border border-white/[0.06] rounded-xl p-6">
                <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">
                  Decision Summary
                </h2>
                <p className="text-sm text-slate-700 mb-3">
                  {(decisionData.raw_summary as string) ||
                    (decisionData.summary as string) ||
                    "No summary available"}
                </p>
                <div className="flex items-center gap-4 flex-wrap">
                  <span className="text-sm text-slate-400">
                    Confidence: <strong>{selectedRun.confidence_score}%</strong>
                  </span>
                  {typeof decisionData.risk_level === "string" && (
                    <span
                      className={`px-2 py-0.5 text-xs font-medium rounded ${riskColor(decisionData.risk_level as string)}`}
                    >
                      Risk: {taskLabel(String(decisionData.risk_level))}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Evidence */}
            {decisionData?.evidence &&
              Array.isArray(decisionData.evidence) &&
              (decisionData.evidence as Array<Record<string, unknown>>).length >
                0 && (
                <div className="glass border border-white/[0.06] rounded-xl p-6">
                  <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">
                    Evidence
                  </h2>
                  <div className="space-y-2">
                    {(
                      decisionData.evidence as Array<Record<string, string>>
                    ).map((e, i) => (
                      <div
                        key={i}
                        className="flex items-start gap-3 p-2 bg-[#0B0F14] rounded"
                      >
                        <span className="px-1.5 py-0.5 text-xs bg-slate-200 text-slate-400 rounded font-mono whitespace-nowrap">
                          {e.source_type}
                        </span>
                        <span className="text-sm text-slate-700">{e.note}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            {/* Approval Trail */}
            <div className="glass border border-white/[0.06] rounded-xl p-6">
              <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">
                Governance Trail
              </h2>
              <div className="space-y-3">
                {/* Intelligence */}
                <TrailStep
                  label="Intelligence Run"
                  status={(intelligenceRun?.status as string) || "unknown"}
                  detail={`${(intelligenceRun?.workflow_definition_code as string) || "—"} • ${(intelligenceRun?.prompt_version as string) || "—"}`}
                  time={intelligenceRun?.started_at as string}
                  duration={intelligenceRun?.duration_ms as number}
                />
                {/* Decision */}
                <TrailStep
                  label="Decision Created"
                  status={(decision?.status as string) || "unknown"}
                  detail={`Type: ${(decision?.decision_type as string) || "—"}`}
                  time={decision?.created_at as string}
                />
                {/* Approval */}
                {approval && (
                  <TrailStep
                    label="Approval"
                    status={(approval.status as string) || "pending"}
                    detail={
                      approval.responded_at
                        ? `Responded: ${formatTime(approval.responded_at as string)}`
                        : "Awaiting response"
                    }
                    time={approval.created_at as string}
                  />
                )}
                {/* Execution */}
                {action && (
                  <TrailStep
                    label="Execution"
                    status={(action.success as boolean) ? "success" : "failed"}
                    detail={`Action: ${(action.action_type as string) || "—"}`}
                    time={action.executed_at as string}
                  />
                )}
              </div>
            </div>

            {/* Execution Result */}
            {action && (action as Record<string, unknown>).execution_result && (
              <div className="glass border border-white/[0.06] rounded-xl p-6">
                <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">
                  Execution Result
                </h2>
                {(() => {
                  const result = (action as Record<string, unknown>)
                    .execution_result as Record<string, unknown>;
                  return (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        {result.status === "success" ? (
                          <CheckCircle size={16} className="text-green-600" />
                        ) : (
                          <XCircle size={16} className="text-red-600" />
                        )}
                        <span className="text-sm font-medium text-[#E6EDF3]">
                          {result.message as string}
                        </span>
                      </div>
                      {typeof result.duration_ms === "number" && (
                        <span className="text-xs text-slate-500">
                          Duration: {result.duration_ms}ms
                        </span>
                      )}
                      {(result.affected_records as string[])?.length > 0 && (
                        <div>
                          <span className="text-xs text-slate-500">
                            Affected:{" "}
                          </span>
                          {(result.affected_records as string[]).map((r, i) => (
                            <span
                              key={i}
                              className="text-xs font-mono text-slate-400"
                            >
                              {r}
                              {i <
                                (result.affected_records as string[]).length -
                                  1 && ", "}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Cost */}
            {auditChain && auditChain.total_cost_usd > 0 && (
              <div className="text-xs text-slate-400 text-right">
                Total cost: ${auditChain.total_cost_usd.toFixed(4)}
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // List view
  // ---------------------------------------------------------------------------
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#E6EDF3]">Governed Runs</h1>
        <p className="text-slate-400 mt-1">
          Intelligence decisions, approvals, and executions across the platform
        </p>
      </div>

      {/* Quick Action Options */}
      <div className="bg-gradient-to-r from-blue-50 to-slate-50 border border-blue-200 rounded-xl p-6">
        <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-4">
          Start New Governed Workflow
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <a
            href="/work-dashboard"
            className="flex items-start gap-3 p-3 bg-[#11161D] rounded-lg border border-[#232A33] hover:border-teal-500/30 hover:bg-[#161C24] transition-colors"
          >
            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-100 text-blue-700 font-semibold text-sm flex-shrink-0">
              1
            </div>
            <div>
              <div className="font-medium text-sm text-[#E6EDF3]">
                Select Work Order
              </div>
              <div className="text-xs text-slate-500">
                Choose asset and create work order
              </div>
            </div>
          </a>

          <a
            href="/work-dashboard"
            className="flex items-start gap-3 p-3 bg-[#11161D] rounded-lg border border-[#232A33] hover:border-teal-500/30 hover:bg-[#161C24] transition-colors"
          >
            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-100 text-blue-700 font-semibold text-sm flex-shrink-0">
              2
            </div>
            <div>
              <div className="font-medium text-sm text-[#E6EDF3]">
                Draft Assessment
              </div>
              <div className="text-xs text-slate-500">
                Trigger AI reliability analysis
              </div>
            </div>
          </a>

          <a
            href="/work-dashboard"
            className="flex items-start gap-3 p-3 bg-[#11161D] rounded-lg border border-[#232A33] hover:border-teal-500/30 hover:bg-[#161C24] transition-colors"
          >
            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-100 text-blue-700 font-semibold text-sm flex-shrink-0">
              3
            </div>
            <div>
              <div className="font-medium text-sm text-[#E6EDF3]">
                Review & Approve
              </div>
              <div className="text-xs text-slate-500">
                Check confidence, approve decision
              </div>
            </div>
          </a>

          <a
            href="/work-dashboard"
            className="flex items-start gap-3 p-3 bg-[#11161D] rounded-lg border border-[#232A33] hover:border-teal-500/30 hover:bg-[#161C24] transition-colors"
          >
            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-100 text-blue-700 font-semibold text-sm flex-shrink-0">
              4
            </div>
            <div>
              <div className="font-medium text-sm text-[#E6EDF3]">
                Execute Action
              </div>
              <div className="text-xs text-slate-500">
                Apply recommendation & log result
              </div>
            </div>
          </a>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            type="text"
            placeholder="Search by type, correlation, WO, asset..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <Filter size={14} className="text-slate-400" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="text-sm border border-slate-200 rounded-lg px-2 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All statuses</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="failed">Failed</option>
          </select>
          <select
            value={capabilityFilter}
            onChange={(e) => setCapabilityFilter(e.target.value)}
            className="text-sm border border-slate-200 rounded-lg px-2 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All capabilities</option>
            <option value="reliability_recommendation">
              Reliability Assessment
            </option>
            <option value="failure_mode_classification">
              Failure Mode Classification
            </option>
          </select>
        </div>
      </div>

      {/* Runs table */}
      <div className="glass border border-white/[0.06] rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
          </div>
        ) : filteredRuns.length === 0 ? (
          <div className="text-center text-slate-500 py-16">
            No governed runs found
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200 bg-[#0B0F14]">
                <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase">
                  Time
                </th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase">
                  Capability
                </th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase">
                  Status
                </th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase">
                  Confidence
                </th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase">
                  Duration
                </th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase">
                  Correlation
                </th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody>
              {filteredRuns.map((run) => {
                const display = deriveDisplayStatus(run);
                return (
                  <tr
                    key={run.id}
                    onClick={() => handleSelectRun(run)}
                    className={`border-b border-slate-100 hover:bg-[#0B0F14] cursor-pointer transition-colors ${
                      display === "Failed" ? "bg-red-50/30" : ""
                    }`}
                  >
                    <td className="py-3 px-4 text-sm text-slate-400">
                      {formatTime(run.created_at)}
                    </td>
                    <td className="py-3 px-4">
                      <span className="text-sm font-medium text-[#E6EDF3]">
                        {taskLabel(run.decision_type)}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full ${statusColor(display)}`}
                      >
                        {statusIcon(display)}
                        {display}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-sm text-slate-400">
                      {run.confidence_score}%
                    </td>
                    <td className="py-3 px-4 text-sm text-slate-500">
                      {run.duration_ms ? `${run.duration_ms}ms` : "—"}
                    </td>
                    <td className="py-3 px-4">
                      <span className="text-xs font-mono text-slate-400">
                        {run.correlation_id?.slice(0, 8) || "—"}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <ChevronRight size={14} className="text-slate-300" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Trail step (used in governance trail)
// ---------------------------------------------------------------------------

function TrailStep({
  label,
  status,
  detail,
  time,
  duration,
}: {
  label: string;
  status: string;
  detail: string;
  time?: string;
  duration?: number;
}) {
  const isGood =
    status === "completed" || status === "approved" || status === "success";
  const isBad = status === "failed" || status === "error";

  return (
    <div className="flex items-start gap-3 p-3 bg-[#0B0F14] rounded-lg">
      <div className="mt-0.5">
        {isGood ? (
          <CheckCircle size={16} className="text-green-500" />
        ) : isBad ? (
          <XCircle size={16} className="text-red-500" />
        ) : (
          <Clock size={16} className="text-yellow-500" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-[#E6EDF3]">{label}</div>
        <div className="text-xs text-slate-500">{detail}</div>
        <div className="flex items-center gap-3 mt-1 text-xs text-slate-400">
          {time && <span>{formatTime(time)}</span>}
          {duration && (
            <span className="flex items-center gap-1">
              <Clock size={10} /> {duration}ms
            </span>
          )}
          <span
            className={`px-1.5 py-0.5 rounded text-xs ${isGood ? "bg-green-100 text-green-700" : isBad ? "bg-red-100 text-red-700" : "bg-yellow-100 text-yellow-700"}`}
          >
            {status}
          </span>
        </div>
      </div>
    </div>
  );
}
