/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "./AuthProvider";
import {
  Activity,
  AlertTriangle,
  CheckCircle,
  Clock,
  Eye,
  FileCheck,
  ThumbsDown,
  ThumbsUp,
  TrendingUp,
  XCircle,
} from "lucide-react";

interface Decision {
  id: string;
  decision_type: string;
  decision_data: Record<string, any>;
  confidence_score: number;
  status: string;
  requires_approval: boolean;
  created_at: string;
  approval_deadline?: string;
}

interface Alert {
  id: string;
  severity: string;
  title: string;
  description: string;
  acknowledged: boolean;
  created_at: string;
}

const APPROVAL_ROLES = new Set([
  "admin",
  "manager",
  "maintenance_manager",
  "plant_manager",
  "operations_manager",
  "reliability_engineer",
]);

export function AutonomousDashboard() {
  const { profile } = useAuth();
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [stats, setStats] = useState({ pending: 0, approved: 0, critical: 0, monitored: 0 });
  const [loading, setLoading] = useState(true);
  const [actioning, setActioning] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const canApprove = APPROVAL_ROLES.has(String(profile?.role ?? "").toLowerCase());

  const loadDashboardData = async () => {
    try {
      const [decisionsRes, alertsRes, assetsRes] = await Promise.all([
        supabase.from("autonomous_decisions").select("*").order("created_at", { ascending: false }).limit(20),
        supabase.from("system_alerts").select("*").eq("resolved", false).order("created_at", { ascending: false }).limit(8),
        supabase.from("assets").select("id", { count: "exact", head: true }),
      ]);
      if (decisionsRes.error) throw decisionsRes.error;
      if (alertsRes.error) throw alertsRes.error;
      const decisionRows = (decisionsRes.data ?? []) as Decision[];
      const alertRows = (alertsRes.data ?? []) as Alert[];
      setDecisions(decisionRows);
      setAlerts(alertRows);
      setStats({
        pending: decisionRows.filter((d) => d.status === "pending").length,
        approved: decisionRows.filter((d) => d.status === "approved").length,
        critical: alertRows.filter((a) => a.severity === "critical").length,
        monitored: assetsRes.count ?? 0,
      });
    } catch (error) {
      console.error("Error loading autonomous dashboard", error);
      setNotice("The dashboard could not be refreshed. Existing operating controls remain unaffected.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadDashboardData();
    const interval = window.setInterval(() => void loadDashboardData(), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  const handleDecision = async (decisionId: string, approved: boolean) => {
    if (!canApprove) return;
    setActioning(decisionId);
    setNotice(null);
    try {
      const { data, error } = await supabase.functions.invoke("autonomous-orchestrator", {
        body: { action: "process_decision", data: { decision_id: decisionId, approved } },
      });
      if (error || !data?.success) throw new Error(error?.message || data?.error || "Decision update failed");
      setNotice(approved
        ? "Decision approved. No operational side-effect is applied until a governed execute action is selected."
        : "Decision rejected. No operational side-effect was applied.");
      await loadDashboardData();
    } catch (error) {
      console.error("Error processing decision", error);
      setNotice("The decision was not changed. Please verify your approval authority and try again.");
    } finally {
      setActioning(null);
    }
  };

  const acknowledgeAlert = async (alertId: string) => {
    const { error } = await supabase.from("system_alerts").update({ acknowledged: true }).eq("id", alertId);
    if (!error) await loadDashboardData();
  };

  const statusIcon = (status: string) => {
    if (status === "pending") return <Clock className="h-5 w-5 text-amber-400" />;
    if (status === "approved") return <CheckCircle className="h-5 w-5 text-emerald-400" />;
    if (status === "rejected") return <XCircle className="h-5 w-5 text-red-400" />;
    return <Eye className="h-5 w-5 text-slate-400" />;
  };

  const severityClass = (severity: string) => {
    if (severity === "critical") return "border-red-500/30 bg-red-500/10 text-red-200";
    if (severity === "high") return "border-orange-500/30 bg-orange-500/10 text-orange-200";
    if (severity === "medium") return "border-amber-500/30 bg-amber-500/10 text-amber-200";
    return "border-blue-500/30 bg-blue-500/10 text-blue-200";
  };

  if (loading) {
    return <div className="flex h-64 items-center justify-center"><div className="h-12 w-12 animate-spin rounded-full border-b-2 border-teal-500" /></div>;
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#E6EDF3]">Governed AI Operations</h1>
          <p className="mt-1 text-slate-400">AI recommendations remain advisory until an authorized human approves a governed action.</p>
        </div>
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-4 py-2 text-sm font-medium text-amber-300">Human-in-the-Loop</div>
      </div>

      {notice && <div className="rounded-lg border border-teal-500/20 bg-teal-500/10 px-4 py-3 text-sm text-teal-100">{notice}</div>}

      <div className="grid gap-4 md:grid-cols-4">
        {[
          ["Pending decisions", stats.pending, Clock],
          ["Approved decisions", stats.approved, CheckCircle],
          ["Critical alerts", stats.critical, AlertTriangle],
          ["Assets monitored", stats.monitored, Activity],
        ].map(([label, value, Icon]) => (
          <div key={String(label)} className="rounded-xl border border-[#232A33] bg-[#11161D] p-5">
            <div className="mb-2 flex items-center justify-between"><Icon className="h-7 w-7 text-teal-400" /><span className="text-3xl font-bold text-[#E6EDF3]">{String(value)}</span></div>
            <p className="text-sm text-slate-400">{String(label)}</p>
          </div>
        ))}
      </div>

      {alerts.length > 0 && (
        <section className="rounded-xl border border-[#232A33] bg-[#11161D] p-6">
          <h2 className="mb-4 text-lg font-semibold text-[#E6EDF3]">Active Alerts</h2>
          <div className="space-y-3">
            {alerts.map((alert) => (
              <div key={alert.id} className={`rounded-lg border p-4 ${severityClass(alert.severity)}`}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="mb-1 flex items-center gap-2"><AlertTriangle className="h-4 w-4" /><p className="font-semibold">{alert.title}</p></div>
                    <p className="text-sm opacity-90">{alert.description}</p>
                    <p className="mt-2 text-xs opacity-70">{new Date(alert.created_at).toLocaleString()}</p>
                  </div>
                  {!alert.acknowledged && <button onClick={() => void acknowledgeAlert(alert.id)} className="rounded-lg border border-white/10 px-3 py-1.5 text-sm hover:bg-white/5">Acknowledge</button>}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="rounded-xl border border-[#232A33] bg-[#11161D] p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[#E6EDF3]">AI Decisions</h2>
          {!canApprove && <span className="rounded-full bg-[#161C24] px-3 py-1 text-xs text-slate-400">View only · {profile?.role}</span>}
        </div>
        <div className="space-y-3">
          {decisions.map((decision) => (
            <article key={decision.id} className="rounded-lg border border-[#232A33] p-4 hover:border-teal-500/30">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="mb-2 flex items-center gap-3">
                    {statusIcon(decision.status)}
                    <div>
                      <p className="font-semibold text-[#E6EDF3]">{decision.decision_data?.asset_name || "Asset"} · {decision.decision_type.replaceAll("_", " ")}</p>
                      <p className="text-sm text-slate-400">{decision.decision_data?.reason || decision.decision_data?.raw_summary || "AI recommendation awaiting review"}</p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-slate-400">
                    <span className="flex items-center gap-1"><TrendingUp className="h-4 w-4" />Confidence: {Number(decision.confidence_score ?? 0).toFixed(0)}%</span>
                    <span className="flex items-center gap-1 capitalize"><FileCheck className="h-4 w-4" />{decision.status.replaceAll("_", " ")}</span>
                    {decision.requires_approval && <span className="rounded bg-amber-500/10 px-2 py-1 text-xs text-amber-300">Qualified approval required</span>}
                  </div>
                </div>
                {decision.status === "pending" && decision.requires_approval && canApprove && (
                  <div className="flex gap-2">
                    <button disabled={actioning === decision.id} onClick={() => void handleDecision(decision.id, true)} className="flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"><ThumbsUp className="h-4 w-4" />Approve</button>
                    <button disabled={actioning === decision.id} onClick={() => void handleDecision(decision.id, false)} className="flex items-center gap-1 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"><ThumbsDown className="h-4 w-4" />Reject</button>
                  </div>
                )}
              </div>
            </article>
          ))}
          {decisions.length === 0 && <div className="py-12 text-center"><FileCheck className="mx-auto mb-3 h-12 w-12 text-slate-600" /><p className="text-slate-400">No recent decisions</p></div>}
        </div>
      </section>
    </div>
  );
}
