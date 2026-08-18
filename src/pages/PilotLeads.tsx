/**
 * Pilot Leads — admin-only view of pilot-intake requests submitted through the
 * public value-proof form. Access is enforced by RLS
 * (pilot_intake_requests_admin_read, 20260913090000_pilot_leads_admin_only.sql):
 * only admin / ai_admin read rows, so a non-admin who reaches this route via
 * AdminGate could never see a lead anyway. Each row shows exactly what the
 * visitor submitted plus its notification status — no derived or scored fields.
 *
 * Leads no longer wait to be noticed. An AFTER INSERT trigger fires the
 * lead-notify edge function the instant a row lands
 * (20260914090000_lead_notify_trigger.sql): the visitor gets an
 * acknowledgement, the owner gets an alert, and the row's notification_status
 * moves off 'queued'. This page is where that outcome is read back — amber
 * means the notification has not completed, red means it failed and a person
 * has to step in.
 */
import { useMemo } from "react";
import { Users, Download, RefreshCw } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import { useRealtimeRefetch } from "../hooks/useRealtimeRefetch";
import { LiveBadge } from "../components/ui/LiveBadge";
import {
  listPilotIntakeRequests,
  type PilotIntakeLead,
} from "../services/pilotIntake";
import { downloadCsv } from "../services/operatingLoopService";
import {
  LoadingState,
  ErrorState,
  EmptyState,
} from "../components/ui/AsyncStates";

const STATUS_STYLE: Record<string, string> = {
  queued: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  notified: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  failed: "bg-red-500/10 text-red-300 border-red-500/30",
};

function statusStyle(status: string): string {
  return (
    STATUS_STYLE[status] ?? "bg-slate-500/10 text-slate-300 border-slate-500/30"
  );
}

/**
 * Past its one-business-hour deadline and nobody has moved it out of 'new'.
 * Deliberately keyed on the pipeline status rather than notification_status: a
 * lead that was successfully acknowledged is still cold if no human replied.
 */
function isOverdue(lead: PilotIntakeLead, now: number = Date.now()): boolean {
  if (lead.status !== "new" || !lead.first_response_due) return false;
  const due = new Date(lead.first_response_due).getTime();
  return Number.isFinite(due) && due < now;
}

export function PilotLeads() {
  const { data, loading, error, refetch } = useAsyncData<PilotIntakeLead[]>(
    () => listPilotIntakeRequests(),
    [],
  );
  const { live } = useRealtimeRefetch(["pilot_intake_requests"], refetch);
  const leads = useMemo(() => data ?? [], [data]);

  if (loading) return <LoadingState label="Loading pilot leads" />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  return (
    <div className="space-y-5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-teal-300" aria-hidden />
            <h1 className="text-2xl font-semibold text-white">Pilot Leads</h1>
            <LiveBadge live={live} />
          </div>
          <p className="mt-1 text-sm text-slate-300">
            Requests submitted through the public 48-hour value-proof intake.
            Admin-visible only. Every lead is acknowledged and alerted
            automatically the moment it arrives; first response is due within{" "}
            <span className="font-medium text-slate-200">
              one business hour
            </span>{" "}
            (Mon-Fri, 8:00am-5:00pm Mountain). A lead still showing{" "}
            <span className="font-medium text-amber-300">queued</span> or{" "}
            <span className="font-medium text-red-300">failed</span> did not get
            its notification — pick it up by hand.
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
                leads.map((lead) => ({
                  submitted_at: lead.created_at,
                  name: lead.name,
                  email: lead.email,
                  company: lead.company,
                  role: lead.role ?? "",
                  industry: lead.industry ?? "",
                  asset_scope: lead.asset_scope,
                  primary_pain: lead.primary_pain,
                  notification_status: lead.notification_status,
                  first_response_due: lead.first_response_due ?? "",
                  source_path: lead.source_path,
                })),
                "pilot-leads.csv",
              )
            }
            disabled={leads.length === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-teal-500 px-3 py-1.5 text-sm font-medium text-slate-950 hover:bg-teal-400 disabled:opacity-40 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-teal-300"
          >
            <Download className="h-4 w-4" aria-hidden />
            Export CSV
          </button>
        </div>
      </div>

      {leads.length === 0 ? (
        <EmptyState message="No pilot-intake leads yet — submissions from the value-proof intake form appear here as they arrive." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/6">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/6 text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="px-4 py-3">Submitted</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Work email</th>
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">Role / industry</th>
                <th className="px-4 py-3">Asset scope</th>
                <th className="px-4 py-3">Primary pain</th>
                <th className="px-4 py-3">First response due</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => (
                <tr
                  key={lead.id}
                  className="border-b border-white/4 hover:bg-white/2"
                >
                  <td className="whitespace-nowrap px-4 py-2.5 text-slate-400">
                    {new Date(lead.created_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5 font-medium text-slate-200">
                    {lead.name}
                  </td>
                  <td className="px-4 py-2.5 text-slate-300">{lead.email}</td>
                  <td className="px-4 py-2.5 text-slate-300">{lead.company}</td>
                  <td className="px-4 py-2.5 text-slate-400">
                    {[lead.role, lead.industry].filter(Boolean).join(" · ") ||
                      "—"}
                  </td>
                  <td className="px-4 py-2.5 text-slate-400">
                    {lead.asset_scope}
                  </td>
                  <td className="px-4 py-2.5 text-slate-400">
                    {lead.primary_pain}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5">
                    {lead.first_response_due ? (
                      <span
                        className={
                          isOverdue(lead)
                            ? "font-medium text-red-300"
                            : "text-slate-400"
                        }
                      >
                        {new Date(lead.first_response_due).toLocaleString()}
                        {isOverdue(lead) ? " · overdue" : ""}
                      </span>
                    ) : (
                      <span className="text-slate-500">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs ${statusStyle(
                        lead.notification_status,
                      )}`}
                    >
                      {lead.notification_status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
