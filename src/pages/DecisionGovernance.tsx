import { useState } from "react";
import {
  Shield,
  CircleCheck as CheckCircle,
  Circle as XCircle,
  Clock,
  ChevronRight,
  Eye,
  ThumbsUp,
  ThumbsDown,
  User,
  Bot,
  BookOpen,
  Filter,
} from "lucide-react";
import { motion } from "framer-motion";
import { useOnboardingOperatingLoop } from "../hooks/useOnboardingOperatingLoop";
import { useOnboardingStore } from "../store/onboardingStore";
import type { DerivedGovernanceRecord } from "../services/onboardingOperatingLoop";
import { useAsyncData } from "../hooks/useAsyncData";
import {
  getDecisions,
  decideDecision,
  downloadCsv,
} from "../services/operatingLoopService";
import type { DecisionRow } from "../types/operating";
import { LoadingState, ErrorState } from "../components/ui/AsyncStates";

const DECISION_STATUSES: DecisionStatus[] = [
  "pending",
  "approved",
  "rejected",
  "autonomous",
];

function decisionRowToLog(row: DecisionRow): DecisionLog {
  const status = (
    DECISION_STATUSES.includes(row.approval_status as DecisionStatus)
      ? row.approval_status
      : "pending"
  ) as DecisionStatus;
  return {
    id: row.id,
    title: row.action_taken ?? row.decision_type ?? "Decision",
    agent: row.agent?.name ?? "AI Agent",
    asset: row.asset?.name ?? "—",
    action: row.action_taken ?? "",
    status,
    timestamp: new Date(row.created_at).toLocaleString(),
    confidence: row.confidence_score,
    financialImpact: row.decision_type ?? "Decision",
    riskImpact: "Medium",
    reasoning: row.rationale ?? "",
    outcome: row.outcome_status,
    accountable: row.human_actor ?? "AI Agent (autonomous)",
    dbDecisionId: row.id,
  };
}

type DecisionStatus = "pending" | "approved" | "rejected" | "autonomous";

interface DecisionLog {
  id: string;
  title: string;
  agent: string;
  asset: string;
  action: string;
  status: DecisionStatus;
  timestamp: string;
  approver?: string;
  confidence: number;
  financialImpact: string;
  riskImpact: "High" | "Medium" | "Low";
  reasoning: string;
  outcome?: string;
  accountable: string;
  ownerRole?: string;
  consequenceOfWrong?: string;
  requiredValidation?: string;
  onboardingSessionId?: string;
  dbDecisionId?: string;
}

const GOVERNANCE_STATUS_TO_DECISION: Record<
  DerivedGovernanceRecord["status"],
  DecisionStatus
> = {
  required: "pending",
  approved: "approved",
  rejected: "rejected",
};

function governanceRecordToDecision(
  record: DerivedGovernanceRecord,
): DecisionLog {
  return {
    id: record.id,
    title: `Onboarding approval gate — ${record.requiredApproval}`,
    agent: "Asset Onboarding",
    asset: record.assetId,
    action: record.requiredApproval,
    status: GOVERNANCE_STATUS_TO_DECISION[record.status],
    timestamp: "Pending validation",
    confidence: 70,
    financialImpact: "Onboarding readiness gate",
    riskImpact: record.safetyCritical ? "High" : "Medium",
    reasoning: record.reason,
    accountable: record.ownerRole,
    ownerRole: record.ownerRole,
    consequenceOfWrong: record.consequenceOfWrong,
    requiredValidation: record.requiredValidation,
    onboardingSessionId: record.sessionId,
  };
}

const statusConfig: Record<
  DecisionStatus,
  { label: string; color: string; bg: string; icon: React.ElementType }
> = {
  pending: {
    label: "Pending Approval",
    color: "text-amber-400",
    bg: "bg-amber-500/10 border-amber-500/20",
    icon: Clock,
  },
  approved: {
    label: "Approved",
    color: "text-teal-400",
    bg: "bg-teal-500/10 border-teal-500/20",
    icon: CheckCircle,
  },
  rejected: {
    label: "Rejected",
    color: "text-red-400",
    bg: "bg-red-500/10 border-red-500/20",
    icon: XCircle,
  },
  autonomous: {
    label: "Autonomous",
    color: "text-blue-400",
    bg: "bg-blue-500/10 border-blue-500/20",
    icon: Bot,
  },
};

const autonomyRules = [
  {
    action: "Create inspection work order",
    mode: "Autonomous",
    threshold: ">85% confidence",
    limit: "—",
  },
  {
    action: "Reschedule non-critical PM",
    mode: "Autonomous",
    threshold: ">90% confidence",
    limit: "No critical assets",
  },
  {
    action: "Order parts",
    mode: "Autonomous",
    threshold: ">85% confidence",
    limit: "< $5,000",
  },
  {
    action: "Increase sensor polling",
    mode: "Autonomous",
    threshold: ">75% confidence",
    limit: "Monitoring only",
  },
  {
    action: "Defer PM on critical asset",
    mode: "Manager Approval",
    threshold: "Any",
    limit: "All cases",
  },
  {
    action: "Shutdown critical system",
    mode: "Executive Approval",
    threshold: "Any",
    limit: "All cases",
  },
  {
    action: "Override safety control",
    mode: "Not Allowed",
    threshold: "—",
    limit: "—",
  },
  {
    action: "Capital expenditure",
    mode: "Manager Approval",
    threshold: ">$5,000",
    limit: "Budget review",
  },
];

function DecisionCard({
  d,
  onDecision,
}: {
  d: DecisionLog;
  onDecision?: (decision: "approved" | "rejected") => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const status = statusConfig[d.status];
  const StatusIcon = status.icon;

  return (
    <motion.div
      layout
      className={`bg-[#0D1520] rounded-xl border ${status.bg} cursor-pointer`}
      onClick={() => setExpanded(!expanded)}
    >
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div
            className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${status.bg}`}
          >
            <StatusIcon className={`w-4 h-4 ${status.color}`} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-semibold text-slate-200">
                {d.title}
              </h4>
              <ChevronRight
                className={`w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
              />
            </div>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span
                className={`text-xs font-semibold px-1.5 py-0.5 rounded-full border ${status.bg} ${status.color}`}
              >
                {status.label}
              </span>
              <span className="text-xs text-slate-400">{d.agent}</span>
              <span className="text-xs text-slate-400">·</span>
              <span className="text-xs text-slate-400">{d.timestamp}</span>
            </div>
            <div className="text-xs text-slate-400 mt-1.5">{d.action}</div>
            <div className="flex items-center gap-3 mt-2 text-xs">
              <span className="text-teal-400 font-medium">
                {d.financialImpact}
              </span>
              <span className="text-slate-400">·</span>
              <span className="text-slate-400 font-mono">
                {d.confidence}% confidence
              </span>
              <span className="text-slate-400">·</span>
              <span className="text-slate-400">
                Accountable:{" "}
                <span className="text-slate-300">{d.accountable}</span>
              </span>
            </div>
          </div>
        </div>

        {expanded && (
          <div className="mt-3 pt-3 border-t border-white/5 space-y-2">
            <div className="text-xs text-slate-400">
              <span className="text-slate-400">Reasoning: </span>
              {d.reasoning}
            </div>
            {d.ownerRole && (
              <div className="text-xs text-slate-400">
                <span className="text-slate-400">Owner role: </span>
                {d.ownerRole}
              </div>
            )}
            {d.consequenceOfWrong && (
              <div className="text-xs text-slate-400">
                <span className="text-slate-400">
                  Consequence of being wrong:{" "}
                </span>
                {d.consequenceOfWrong}
              </div>
            )}
            {d.requiredValidation && (
              <div className="text-xs text-slate-400">
                <span className="text-slate-400">Required validation: </span>
                {d.requiredValidation}
              </div>
            )}
            {d.outcome && (
              <div className="text-xs text-slate-400">
                <span className="text-slate-400">Outcome: </span>
                {d.outcome}
              </div>
            )}
            {d.approver && (
              <div className="text-xs text-slate-400">
                <span className="text-slate-400">Actioned by: </span>
                <span className="flex items-center gap-1 inline-flex">
                  <User className="w-3 h-3" />
                  {d.approver}
                </span>
              </div>
            )}
            {d.status === "pending" && (
              <div className="flex gap-2 mt-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDecision?.("approved");
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-500/20 border border-teal-500/30 text-teal-400 text-xs font-medium rounded-lg hover:bg-teal-500/30 transition-colors"
                >
                  <ThumbsUp className="w-3 h-3" /> Approve
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDecision?.("rejected");
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-medium rounded-lg hover:bg-red-500/20 transition-colors"
                >
                  <ThumbsDown className="w-3 h-3" /> Reject
                </button>
                <button className="flex items-center gap-1.5 px-3 py-1.5 bg-white/4 border border-white/8 text-slate-400 text-xs rounded-lg hover:bg-white/8 transition-colors">
                  <Eye className="w-3 h-3" /> Evidence
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}

export function DecisionGovernance() {
  const [tab, setTab] = useState<"log" | "rules" | "raci">("log");
  const [statusFilter, setStatusFilter] = useState<"all" | DecisionStatus>(
    "all",
  );
  const { governance } = useOnboardingOperatingLoop();
  const sessions = useOnboardingStore((state) => state.sessions);
  const recordRecommendationDecision = useOnboardingStore(
    (state) => state.recordRecommendationDecision,
  );

  const {
    data: rows,
    loading,
    error,
    refetch,
  } = useAsyncData<DecisionRow[]>(() => getDecisions(), []);

  const onboardingDecisions = governance.map(governanceRecordToDecision);
  const allDecisions: DecisionLog[] = [
    ...onboardingDecisions,
    ...(rows ?? []).map(decisionRowToLog),
  ];

  const handleDecision = async (
    d: DecisionLog,
    decision: "approved" | "rejected",
  ) => {
    if (d.dbDecisionId) {
      await decideDecision(d.dbDecisionId, decision === "approved");
      refetch();
      return;
    }
    if (!d.onboardingSessionId) return;
    const session = sessions.find((s) => s.sessionId === d.onboardingSessionId);
    if (!session) return;
    recordRecommendationDecision(d.id, session, decision, d.action);
  };

  const exportAuditLog = () => {
    downloadCsv(
      allDecisions.map((d) => ({
        title: d.title,
        agent: d.agent,
        asset: d.asset,
        action: d.action,
        status: d.status,
        timestamp: d.timestamp,
        confidence: d.confidence,
        accountable: d.accountable,
        reasoning: d.reasoning,
        outcome: d.outcome ?? "",
      })),
      `syncai-decision-audit-${new Date().toISOString().slice(0, 10)}.csv`,
    );
  };

  const filtered = allDecisions.filter(
    (d) => statusFilter === "all" || d.status === statusFilter,
  );
  const pending = allDecisions.filter((d) => d.status === "pending").length;
  const autonomous = allDecisions.filter(
    (d) => d.status === "autonomous",
  ).length;
  const approved = allDecisions.filter((d) => d.status === "approved").length;
  const rejected = allDecisions.filter((d) => d.status === "rejected").length;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            Decision Governance
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Every AI decision is logged, traceable, and auditable
          </p>
        </div>
        <button
          onClick={exportAuditLog}
          className="px-4 py-2 bg-white/4 border border-white/8 rounded-lg text-xs text-slate-400 hover:bg-white/8 transition-colors flex items-center gap-1.5"
        >
          <BookOpen className="w-3.5 h-3.5" /> Export Audit Log
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          {
            label: "Pending Approval",
            value: pending,
            color: "amber",
            icon: Clock,
          },
          {
            label: "Approved",
            value: approved,
            color: "teal",
            icon: CheckCircle,
          },
          { label: "Autonomous", value: autonomous, color: "blue", icon: Bot },
          {
            label: "Rejected (Human Override)",
            value: rejected,
            color: "red",
            icon: XCircle,
          },
        ].map((s) => {
          const Icon = s.icon;
          const c: Record<string, string> = {
            amber: "text-amber-400 bg-amber-500/10",
            teal: "text-teal-400 bg-teal-500/10",
            blue: "text-blue-400 bg-blue-500/10",
            red: "text-red-400 bg-red-500/10",
          };
          const [textColor, bgColor] = c[s.color].split(" ");
          return (
            <div
              key={s.label}
              className="bg-[#0D1520] border border-white/6 rounded-xl p-4"
            >
              <div
                className={`w-8 h-8 rounded-lg ${bgColor} flex items-center justify-center mb-2`}
              >
                <Icon className={`w-4 h-4 ${textColor}`} />
              </div>
              <div className={`text-2xl font-black ${textColor}`}>
                {s.value}
              </div>
              <div className="text-xs text-slate-400 mt-0.5">{s.label}</div>
            </div>
          );
        })}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-white/6">
        {(["log", "rules", "raci"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === t
                ? "border-teal-400 text-teal-400"
                : "border-transparent text-slate-400 hover:text-slate-300"
            }`}
          >
            {t === "log"
              ? "Decision Log"
              : t === "rules"
                ? "Autonomy Rules"
                : "RACI Matrix"}
          </button>
        ))}
      </div>

      {tab === "log" && (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            {(
              ["all", "pending", "approved", "rejected", "autonomous"] as const
            ).map((f) => (
              <button
                key={f}
                onClick={() => setStatusFilter(f)}
                className={`px-3 py-1 rounded-full text-xs transition-colors ${
                  statusFilter === f
                    ? "bg-teal-500/20 text-teal-400 border border-teal-500/30"
                    : "bg-white/3 border border-white/6 text-slate-400"
                }`}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}{" "}
                {f !== "all" &&
                  `(${allDecisions.filter((d) => d.status === f).length})`}
              </button>
            ))}
          </div>
          {loading && <LoadingState label="Loading decision log…" />}
          {error && <ErrorState message={error} onRetry={refetch} />}
          <div className="space-y-3">
            {!loading &&
              !error &&
              filtered.map((d, i) => (
                <motion.div
                  key={d.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.06 }}
                >
                  <DecisionCard
                    d={d}
                    onDecision={(decision) => handleDecision(d, decision)}
                  />
                </motion.div>
              ))}
          </div>
        </>
      )}

      {tab === "rules" && (
        <div className="bg-[#0D1520] border border-white/6 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-white/6">
            <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
              <Shield className="w-4 h-4 text-teal-400" /> Autonomy Decision
              Rules
            </h3>
          </div>
          <div className="divide-y divide-white/4">
            {autonomyRules.map((rule) => (
              <div
                key={rule.action}
                className="grid grid-cols-4 gap-4 px-4 py-3 text-xs"
              >
                <div className="text-slate-200 font-medium">{rule.action}</div>
                <div
                  className={`font-semibold ${rule.mode === "Autonomous" ? "text-teal-400" : rule.mode === "Not Allowed" ? "text-red-400" : "text-amber-400"}`}
                >
                  {rule.mode}
                </div>
                <div className="text-slate-400">{rule.threshold}</div>
                <div className="text-slate-400">{rule.limit}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "raci" && (
        <div className="bg-[#0D1520] border border-white/6 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-white/6">
            <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
              <User className="w-4 h-4 text-teal-400" /> RACI Decision Authority
              Matrix
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px]">
              <thead>
                <tr className="text-xs text-slate-400 border-b border-white/4">
                  <th className="text-left px-4 py-3 w-48">Decision Type</th>
                  <th className="px-4 py-3">Accountable</th>
                  <th className="px-4 py-3">Responsible</th>
                  <th className="px-4 py-3">Consulted</th>
                  <th className="px-4 py-3">Informed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/3">
                {[
                  {
                    decision: "PM Strategy Change",
                    A: "Reliability Mgr",
                    R: "Reliability Eng",
                    C: "Maint. Mgr",
                    I: "Technician",
                  },
                  {
                    decision: "Work Order Creation",
                    A: "Maint. Supervisor",
                    R: "Planner / AI",
                    C: "Operations",
                    I: "Technician",
                  },
                  {
                    decision: "PM Deferral (Critical)",
                    A: "Maint. Manager",
                    R: "Planner",
                    C: "Ops Manager",
                    I: "Reliability Eng",
                  },
                  {
                    decision: "Asset Shutdown",
                    A: "Site Manager",
                    R: "Ops Manager",
                    C: "Maint. Mgr",
                    I: "Executive",
                  },
                  {
                    decision: "Part Purchase (<$5K)",
                    A: "Planner",
                    R: "AI / Storeroom",
                    C: "Maint. Lead",
                    I: "Finance",
                  },
                  {
                    decision: "Capital Request",
                    A: "Asset Manager",
                    R: "Maint. Mgr",
                    C: "Finance",
                    I: "Executive",
                  },
                  {
                    decision: "Safety Override",
                    A: "Site Manager",
                    R: "HSE Manager",
                    C: "Operations",
                    I: "All",
                  },
                ].map((row) => (
                  <tr key={row.decision} className="text-xs">
                    <td className="px-4 py-2.5 text-slate-200 font-medium">
                      {row.decision}
                    </td>
                    <td className="px-4 py-2.5 text-center text-amber-400">
                      {row.A}
                    </td>
                    <td className="px-4 py-2.5 text-center text-teal-400">
                      {row.R}
                    </td>
                    <td className="px-4 py-2.5 text-center text-blue-400">
                      {row.C}
                    </td>
                    <td className="px-4 py-2.5 text-center text-slate-400">
                      {row.I}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-3 border-t border-white/4 flex gap-4 text-xs">
            <div>
              <span className="text-amber-400 font-bold">A</span> = Accountable
              (final decision)
            </div>
            <div>
              <span className="text-teal-400 font-bold">R</span> = Responsible
              (executes)
            </div>
            <div>
              <span className="text-blue-400 font-bold">C</span> = Consulted
              (input required)
            </div>
            <div>
              <span className="text-slate-400 font-bold">I</span> = Informed
              (notified)
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
