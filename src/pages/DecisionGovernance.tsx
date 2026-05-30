import { useState } from "react";
import { Shield, CircleCheck as CheckCircle, Circle as XCircle, Clock, ChevronRight, Eye, ThumbsUp, ThumbsDown, User, Bot, ChartBar as BarChart2, TriangleAlert as AlertTriangle, BookOpen, TrendingUp, TrendingDown, Filter } from "lucide-react";
import { motion } from "framer-motion";

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
}

const decisions: DecisionLog[] = [
  {
    id: "d1",
    title: "Advance PM on Conveyor C-22",
    agent: "Maintenance Strategy Development",
    asset: "Conveyor C-22",
    action: "Advance PM from Day 14 to Day 3 — bearing replacement",
    status: "pending",
    timestamp: "2026-05-30 09:14",
    confidence: 91,
    financialImpact: "$2.4M risk mitigation",
    riskImpact: "High",
    reasoning: "Vibration signature analysis indicates 82% failure probability within 9 days. Advancing PM reduces risk to <5%.",
    accountable: "Maintenance Manager",
  },
  {
    id: "d2",
    title: "Auto-created WO #4821 — Pump P-101 seal inspection",
    agent: "Work Order Management",
    asset: "Pump P-101",
    action: "Created inspection work order — assigned to J. Morrison",
    status: "autonomous",
    timestamp: "2026-05-30 08:44",
    confidence: 96,
    financialImpact: "Prevents $1.1M downtime",
    riskImpact: "High",
    reasoning: "Seal wear detected via process data deviation. Confidence >90% — within autonomous threshold.",
    outcome: "Work order created and assigned",
    accountable: "AI Agent (autonomous)",
  },
  {
    id: "d3",
    title: "Reschedule 3 PMs to avoid production conflict",
    agent: "Planning & Scheduling",
    asset: "Multiple",
    action: "Moved WO #4810, #4812, #4815 to following week",
    status: "approved",
    timestamp: "2026-05-30 07:30",
    approver: "Planner R. Chen",
    confidence: 94,
    financialImpact: "Saves $320K production loss",
    riskImpact: "Low",
    reasoning: "Production plan conflict detected — rescheduling improves schedule compliance by 11%.",
    outcome: "Executed — 3 work orders rescheduled",
    accountable: "Planner",
  },
  {
    id: "d4",
    title: "Order seal kit for P-101",
    agent: "Inventory Management",
    asset: "Pump P-101",
    action: "Create PO #7382 — seal kit $4,200",
    status: "autonomous",
    timestamp: "2026-05-30 06:58",
    confidence: 87,
    financialImpact: "$4,200 cost",
    riskImpact: "Low",
    reasoning: "Part required for scheduled maintenance. Value below $5,000 autonomous threshold.",
    outcome: "PO created and approved by system",
    accountable: "AI Agent (autonomous)",
  },
  {
    id: "d5",
    title: "Defer Compressor K-05 PM by 7 days",
    agent: "Maintenance Strategy Development",
    asset: "Compressor K-05",
    action: "Defer PM #3902 from Day 7 to Day 14",
    status: "rejected",
    timestamp: "2026-05-30 06:22",
    approver: "Maintenance Manager T. Williams",
    confidence: 63,
    financialImpact: "$680K risk exposure",
    riskImpact: "High",
    reasoning: "AI recommended deferral based on condition data. Manager rejected — safety review ongoing.",
    outcome: "Rejected — PM to proceed as scheduled",
    accountable: "Maintenance Manager",
  },
  {
    id: "d6",
    title: "Increased sensor polling on K-05",
    agent: "Condition Monitoring",
    asset: "Compressor K-05",
    action: "Increased polling from 5min to 1min for 72 hours",
    status: "autonomous",
    timestamp: "2026-05-29 22:10",
    confidence: 78,
    financialImpact: "Minimal ($0)",
    riskImpact: "Low",
    reasoning: "Anomaly detected — increased monitoring is a defensive action within autonomous authority.",
    outcome: "Active — enhanced monitoring in progress",
    accountable: "AI Agent (autonomous)",
  },
];

const statusConfig: Record<DecisionStatus, { label: string; color: string; bg: string; icon: React.ElementType }> = {
  pending: { label: "Pending Approval", color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/20", icon: Clock },
  approved: { label: "Approved", color: "text-teal-400", bg: "bg-teal-500/10 border-teal-500/20", icon: CheckCircle },
  rejected: { label: "Rejected", color: "text-red-400", bg: "bg-red-500/10 border-red-500/20", icon: XCircle },
  autonomous: { label: "Autonomous", color: "text-blue-400", bg: "bg-blue-500/10 border-blue-500/20", icon: Bot },
};

const autonomyRules = [
  { action: "Create inspection work order", mode: "Autonomous", threshold: ">85% confidence", limit: "—" },
  { action: "Reschedule non-critical PM", mode: "Autonomous", threshold: ">90% confidence", limit: "No critical assets" },
  { action: "Order parts", mode: "Autonomous", threshold: ">85% confidence", limit: "< $5,000" },
  { action: "Increase sensor polling", mode: "Autonomous", threshold: ">75% confidence", limit: "Monitoring only" },
  { action: "Defer PM on critical asset", mode: "Manager Approval", threshold: "Any", limit: "All cases" },
  { action: "Shutdown critical system", mode: "Executive Approval", threshold: "Any", limit: "All cases" },
  { action: "Override safety control", mode: "Not Allowed", threshold: "—", limit: "—" },
  { action: "Capital expenditure", mode: "Manager Approval", threshold: ">$5,000", limit: "Budget review" },
];

function DecisionCard({ d }: { d: DecisionLog }) {
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
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${status.bg}`}>
            <StatusIcon className={`w-4 h-4 ${status.color}`} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-semibold text-slate-200">{d.title}</h4>
              <ChevronRight className={`w-3.5 h-3.5 text-slate-600 flex-shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`} />
            </div>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${status.bg} ${status.color}`}>
                {status.label}
              </span>
              <span className="text-[11px] text-slate-500">{d.agent}</span>
              <span className="text-[11px] text-slate-600">·</span>
              <span className="text-[11px] text-slate-500">{d.timestamp}</span>
            </div>
            <div className="text-xs text-slate-400 mt-1.5">{d.action}</div>
            <div className="flex items-center gap-3 mt-2 text-xs">
              <span className="text-teal-400 font-medium">{d.financialImpact}</span>
              <span className="text-slate-600">·</span>
              <span className="text-slate-500 font-mono">{d.confidence}% confidence</span>
              <span className="text-slate-600">·</span>
              <span className="text-slate-500">Accountable: <span className="text-slate-300">{d.accountable}</span></span>
            </div>
          </div>
        </div>

        {expanded && (
          <div className="mt-3 pt-3 border-t border-white/[0.05] space-y-2">
            <div className="text-xs text-slate-400">
              <span className="text-slate-600">Reasoning: </span>{d.reasoning}
            </div>
            {d.outcome && (
              <div className="text-xs text-slate-400">
                <span className="text-slate-600">Outcome: </span>{d.outcome}
              </div>
            )}
            {d.approver && (
              <div className="text-xs text-slate-400">
                <span className="text-slate-600">Actioned by: </span>
                <span className="flex items-center gap-1 inline-flex">
                  <User className="w-3 h-3" />{d.approver}
                </span>
              </div>
            )}
            {d.status === "pending" && (
              <div className="flex gap-2 mt-2">
                <button className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-500/20 border border-teal-500/30 text-teal-400 text-xs font-medium rounded-lg hover:bg-teal-500/30 transition-colors">
                  <ThumbsUp className="w-3 h-3" /> Approve
                </button>
                <button className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-medium rounded-lg hover:bg-red-500/20 transition-colors">
                  <ThumbsDown className="w-3 h-3" /> Reject
                </button>
                <button className="flex items-center gap-1.5 px-3 py-1.5 bg-white/[0.04] border border-white/[0.08] text-slate-400 text-xs rounded-lg hover:bg-white/[0.08] transition-colors">
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
  const [statusFilter, setStatusFilter] = useState<"all" | DecisionStatus>("all");

  const filtered = decisions.filter((d) => statusFilter === "all" || d.status === statusFilter);
  const pending = decisions.filter((d) => d.status === "pending").length;
  const autonomous = decisions.filter((d) => d.status === "autonomous").length;
  const approved = decisions.filter((d) => d.status === "approved").length;
  const rejected = decisions.filter((d) => d.status === "rejected").length;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Decision Governance</h1>
          <p className="text-sm text-slate-500 mt-0.5">Every AI decision is logged, traceable, and auditable</p>
        </div>
        <button className="px-4 py-2 bg-white/[0.04] border border-white/[0.08] rounded-lg text-xs text-slate-400 hover:bg-white/[0.08] transition-colors flex items-center gap-1.5">
          <BookOpen className="w-3.5 h-3.5" /> Export Audit Log
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Pending Approval", value: pending, color: "amber", icon: Clock },
          { label: "Approved", value: approved, color: "teal", icon: CheckCircle },
          { label: "Autonomous", value: autonomous, color: "blue", icon: Bot },
          { label: "Rejected (Human Override)", value: rejected, color: "red", icon: XCircle },
        ].map((s) => {
          const Icon = s.icon;
          const c: Record<string, string> = { amber: "text-amber-400 bg-amber-500/10", teal: "text-teal-400 bg-teal-500/10", blue: "text-blue-400 bg-blue-500/10", red: "text-red-400 bg-red-500/10" };
          const [textColor, bgColor] = c[s.color].split(" ");
          return (
            <div key={s.label} className="bg-[#0D1520] border border-white/[0.06] rounded-xl p-4">
              <div className={`w-8 h-8 rounded-lg ${bgColor} flex items-center justify-center mb-2`}>
                <Icon className={`w-4 h-4 ${textColor}`} />
              </div>
              <div className={`text-2xl font-black ${textColor}`}>{s.value}</div>
              <div className="text-[10px] text-slate-600 mt-0.5">{s.label}</div>
            </div>
          );
        })}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-white/[0.06]">
        {(["log", "rules", "raci"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === t
                ? "border-teal-400 text-teal-400"
                : "border-transparent text-slate-500 hover:text-slate-300"
            }`}
          >
            {t === "log" ? "Decision Log" : t === "rules" ? "Autonomy Rules" : "RACI Matrix"}
          </button>
        ))}
      </div>

      {tab === "log" && (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <Filter className="w-3.5 h-3.5 text-slate-600" />
            {(["all", "pending", "approved", "rejected", "autonomous"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setStatusFilter(f)}
                className={`px-3 py-1 rounded-full text-xs transition-colors ${
                  statusFilter === f
                    ? "bg-teal-500/20 text-teal-400 border border-teal-500/30"
                    : "bg-white/[0.03] border border-white/[0.06] text-slate-500"
                }`}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)} {f !== "all" && `(${decisions.filter((d) => d.status === f).length})`}
              </button>
            ))}
          </div>
          <div className="space-y-3">
            {filtered.map((d, i) => (
              <motion.div key={d.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.06 }}>
                <DecisionCard d={d} />
              </motion.div>
            ))}
          </div>
        </>
      )}

      {tab === "rules" && (
        <div className="bg-[#0D1520] border border-white/[0.06] rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-white/[0.06]">
            <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
              <Shield className="w-4 h-4 text-teal-400" /> Autonomy Decision Rules
            </h3>
          </div>
          <div className="divide-y divide-white/[0.04]">
            {autonomyRules.map((rule) => (
              <div key={rule.action} className="grid grid-cols-4 gap-4 px-4 py-3 text-xs">
                <div className="text-slate-200 font-medium">{rule.action}</div>
                <div className={`font-semibold ${rule.mode === "Autonomous" ? "text-teal-400" : rule.mode === "Not Allowed" ? "text-red-400" : "text-amber-400"}`}>
                  {rule.mode}
                </div>
                <div className="text-slate-500">{rule.threshold}</div>
                <div className="text-slate-500">{rule.limit}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "raci" && (
        <div className="bg-[#0D1520] border border-white/[0.06] rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-white/[0.06]">
            <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
              <User className="w-4 h-4 text-teal-400" /> RACI Decision Authority Matrix
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px]">
              <thead>
                <tr className="text-[11px] text-slate-600 border-b border-white/[0.04]">
                  <th className="text-left px-4 py-3 w-48">Decision Type</th>
                  <th className="px-4 py-3">Accountable</th>
                  <th className="px-4 py-3">Responsible</th>
                  <th className="px-4 py-3">Consulted</th>
                  <th className="px-4 py-3">Informed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.03]">
                {[
                  { decision: "PM Strategy Change", A: "Reliability Mgr", R: "Reliability Eng", C: "Maint. Mgr", I: "Technician" },
                  { decision: "Work Order Creation", A: "Maint. Supervisor", R: "Planner / AI", C: "Operations", I: "Technician" },
                  { decision: "PM Deferral (Critical)", A: "Maint. Manager", R: "Planner", C: "Ops Manager", I: "Reliability Eng" },
                  { decision: "Asset Shutdown", A: "Site Manager", R: "Ops Manager", C: "Maint. Mgr", I: "Executive" },
                  { decision: "Part Purchase (<$5K)", A: "Planner", R: "AI / Storeroom", C: "Maint. Lead", I: "Finance" },
                  { decision: "Capital Request", A: "Asset Manager", R: "Maint. Mgr", C: "Finance", I: "Executive" },
                  { decision: "Safety Override", A: "Site Manager", R: "HSE Manager", C: "Operations", I: "All" },
                ].map((row) => (
                  <tr key={row.decision} className="text-xs">
                    <td className="px-4 py-2.5 text-slate-200 font-medium">{row.decision}</td>
                    <td className="px-4 py-2.5 text-center text-amber-400">{row.A}</td>
                    <td className="px-4 py-2.5 text-center text-teal-400">{row.R}</td>
                    <td className="px-4 py-2.5 text-center text-blue-400">{row.C}</td>
                    <td className="px-4 py-2.5 text-center text-slate-500">{row.I}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-3 border-t border-white/[0.04] flex gap-4 text-[11px]">
            <div><span className="text-amber-400 font-bold">A</span> = Accountable (final decision)</div>
            <div><span className="text-teal-400 font-bold">R</span> = Responsible (executes)</div>
            <div><span className="text-blue-400 font-bold">C</span> = Consulted (input required)</div>
            <div><span className="text-slate-500 font-bold">I</span> = Informed (notified)</div>
          </div>
        </div>
      )}
    </div>
  );
}
