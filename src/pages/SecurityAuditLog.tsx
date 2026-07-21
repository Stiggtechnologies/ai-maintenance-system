/**
 * Security Audit Log — admin-only view of security-relevant events
 * (SOC 2 CC7.2 / ISO 27001 A.8.15). Reads get_security_events(); the RPC
 * and the table's RLS both enforce admin-only access, and the log is
 * append-only (no client write/edit path). Exportable as CSV for evidence.
 */
import { useMemo } from "react";
import { ShieldCheck, Download, RefreshCw } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import { useRealtimeRefetch } from "../hooks/useRealtimeRefetch";
import { LiveBadge } from "../components/ui/LiveBadge";
import { supabase } from "../lib/supabase";
import { downloadCsv } from "../services/operatingLoopService";
import {
  LoadingState,
  ErrorState,
  EmptyState,
} from "../components/ui/AsyncStates";

interface SecurityEvent {
  id: string;
  actor_label: string | null;
  event_type: string;
  severity: "info" | "notice" | "warning" | "critical";
  detail: string | null;
  created_at: string;
}

const SEVERITY_STYLE: Record<string, string> = {
  info: "bg-slate-500/10 text-slate-300 border-slate-500/30",
  notice: "bg-blue-500/10 text-blue-300 border-blue-500/30",
  warning: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  critical: "bg-red-500/10 text-red-300 border-red-500/30",
};

async function getSecurityEvents(): Promise<SecurityEvent[]> {
  const { data, error } = await supabase.rpc("get_security_events", {
    p_limit: 300,
  });
  if (error) throw new Error(error.message);
  const result = data as { events?: SecurityEvent[]; error?: string };
  if (result.error) throw new Error(result.error);
  return result.events ?? [];
}

export function SecurityAuditLog() {
  const { data, loading, error, refetch } = useAsyncData<SecurityEvent[]>(
    getSecurityEvents,
    [],
  );
  const { live } = useRealtimeRefetch(["security_events"], refetch);
  const events = useMemo(() => data ?? [], [data]);

  if (loading) return <LoadingState label="Loading security audit log" />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  return (
    <div className="space-y-5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-teal-300" aria-hidden />
            <h1 className="text-2xl font-semibold text-white">
              Security Audit Log
            </h1>
            <LiveBadge live={live} />
          </div>
          <p className="mt-1 text-sm text-slate-300">
            Append-only record of sign-ins, MFA changes, role changes, and admin
            actions — admin-visible, tamper-resistant (no client edit path). SOC
            2 CC7.2 / ISO 27001 A.8.15.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={refetch}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-teal-300"
          >
            <RefreshCw className="h-4 w-4" aria-hidden />
            Refresh
          </button>
          <button
            onClick={() =>
              downloadCsv(
                events.map((e) => ({
                  timestamp: e.created_at,
                  event_type: e.event_type,
                  severity: e.severity,
                  actor: e.actor_label ?? "",
                  detail: e.detail ?? "",
                })),
                "security-audit-log.csv",
              )
            }
            disabled={events.length === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-teal-500 px-3 py-1.5 text-sm font-medium text-slate-950 hover:bg-teal-400 disabled:opacity-40 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-teal-300"
          >
            <Download className="h-4 w-4" aria-hidden />
            Export CSV
          </button>
        </div>
      </div>

      {events.length === 0 ? (
        <EmptyState message="No security events recorded yet — they appear here as users sign in, change roles, or manage MFA." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/6">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/6 text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="px-4 py-3">When</th>
                <th className="px-4 py-3">Event</th>
                <th className="px-4 py-3">Severity</th>
                <th className="px-4 py-3">Actor</th>
                <th className="px-4 py-3">Detail</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr
                  key={e.id}
                  className="border-b border-white/4 hover:bg-white/2"
                >
                  <td className="whitespace-nowrap px-4 py-2.5 text-slate-400">
                    {new Date(e.created_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5 font-medium text-slate-200">
                    {e.event_type.replace(/_/g, " ")}
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs ${SEVERITY_STYLE[e.severity]}`}
                    >
                      {e.severity}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-slate-300">
                    {e.actor_label ?? "—"}
                  </td>
                  <td className="px-4 py-2.5 text-slate-400">{e.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
