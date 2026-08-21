/**
 * Reliability Assessment Leads — admin-only commercial conversion surface.
 *
 * The lead itself is global sales data and remains admin/ai_admin read-only.
 * A browser never writes the lead or creates cross-tenant RIA state directly:
 * commercial activation goes through activate_ria_from_intake, whose invariant
 * contract owns target-org validation, authority, idempotency and provenance.
 */
import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Users,
  Download,
  RefreshCw,
  Check,
  FileCheck2,
  ExternalLink,
} from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import { useRealtimeRefetch } from "../hooks/useRealtimeRefetch";
import { LiveBadge } from "../components/ui/LiveBadge";
import { RiaActivationDialog } from "../components/assessment/RiaActivationDialog";
import {
  listPilotIntakeRequests,
  markPilotLeadResponded,
  type PilotIntakeLead,
} from "../services/pilotIntake";
import { formatAlbertaStamp, isOverdue } from "../lib/leads/pilotLeadSla";
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

function shortId(value: string): string {
  return value.length > 12 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
}

export function PilotLeads() {
  const { data, loading, error, refetch } = useAsyncData<PilotIntakeLead[]>(
    () => listPilotIntakeRequests(),
    [],
  );
  const { live } = useRealtimeRefetch(["pilot_intake_requests"], refetch);
  const leads = useMemo(() => data ?? [], [data]);
  const [marking, setMarking] = useState<string | null>(null);
  const [markError, setMarkError] = useState<string | null>(null);
  const [activationLead, setActivationLead] = useState<PilotIntakeLead | null>(
    null,
  );
  const [activationNotice, setActivationNotice] = useState<string | null>(null);

  const markResponded = useCallback(
    async (leadId: string) => {
      setMarking(leadId);
      setMarkError(null);
      try {
        await markPilotLeadResponded(leadId);
        refetch();
      } catch (cause) {
        setMarkError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setMarking(null);
      }
    },
    [refetch],
  );

  if (loading) return <LoadingState label="Loading assessment leads" />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  return (
    <div className="space-y-5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-4xl">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-teal-300" aria-hidden />
            <h1 className="text-2xl font-semibold text-white">
              Reliability Assessment Leads
            </h1>
            <LiveBadge live={live} />
          </div>
          <p className="mt-1 text-sm leading-6 text-slate-300">
            Requests from the public Reliability Intelligence Assessment intake.
            The standard engagement is US$35,000 fixed fee over 6–8 weeks for a
            bounded fleet, site, or asset domain. Admin-visible only. Every lead
            is acknowledged and alerted automatically; first response is due
            within <span className="font-medium text-slate-200">one business hour</span>{" "}
            (Mon–Fri, 8:00am–5:00pm Mountain).
          </p>
          <p className="mt-2 text-xs leading-5 text-slate-500">
            Activation is separate from acknowledgement: record a signed SOW,
            PO, invoice, or payment reference before creating the customer RIA.
            SyncAI does not infer “paid” from a lead status.
          </p>
          {markError ? (
            <p className="mt-2 text-sm text-red-300" role="alert">
              Could not record the response: {markError}
            </p>
          ) : null}
          {activationNotice ? (
            <p
              className="mt-2 rounded-lg border border-emerald-300/20 bg-emerald-300/5 px-3 py-2 text-sm text-emerald-200"
              role="status"
            >
              {activationNotice}
            </p>
          ) : null}
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
                  first_responded_at: lead.first_responded_at ?? "",
                  ria_assessment_id: lead.ria_assessment_id ?? "",
                  activated_organization_id:
                    lead.activated_organization_id ?? "",
                  activated_at: lead.activated_at ?? "",
                  commercial_acceptance_reference:
                    lead.commercial_acceptance_reference ?? "",
                  source_path: lead.source_path,
                })),
                "reliability-assessment-leads.csv",
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
        <EmptyState message="No Reliability Intelligence Assessment leads yet — public intake submissions appear here as they arrive." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/6">
          <table className="w-full min-w-[1320px] text-sm">
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
                <th className="px-4 py-3">Notify</th>
                <th className="px-4 py-3">Answered</th>
                <th className="px-4 py-3">RIA</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => (
                <tr
                  key={lead.id}
                  className="border-b border-white/4 hover:bg-white/2"
                >
                  <td className="whitespace-nowrap px-4 py-2.5 text-slate-400">
                    {formatAlbertaStamp(lead.created_at)}
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
                        {formatAlbertaStamp(lead.first_response_due)}
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
                  <td className="whitespace-nowrap px-4 py-2.5">
                    {lead.first_responded_at ? (
                      <span className="text-emerald-300">
                        {formatAlbertaStamp(lead.first_responded_at)}
                      </span>
                    ) : (
                      <button
                        onClick={() => markResponded(lead.id)}
                        disabled={marking === lead.id}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-600 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-40 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-teal-300"
                      >
                        <Check className="h-3.5 w-3.5" aria-hidden />
                        {marking === lead.id ? "Saving…" : "Mark answered"}
                      </button>
                    )}
                  </td>
                  <td className="min-w-48 px-4 py-2.5">
                    {lead.ria_assessment_id ? (
                      <div>
                        <div className="flex items-center gap-1.5 text-emerald-300">
                          <FileCheck2 className="h-3.5 w-3.5" aria-hidden />
                          <span className="text-xs font-medium">Activated</span>
                        </div>
                        <Link
                          to={`/assessments/${lead.ria_assessment_id}`}
                          title="Assessment visibility remains scoped to the activated organization"
                          className="mt-1 inline-flex items-center gap-1 font-mono text-xs text-teal-300 hover:text-teal-200"
                        >
                          {shortId(lead.ria_assessment_id)}
                          <ExternalLink className="h-3 w-3" aria-hidden />
                        </Link>
                        {lead.activated_at ? (
                          <p className="mt-1 text-[11px] text-slate-500">
                            {formatAlbertaStamp(lead.activated_at)}
                          </p>
                        ) : null}
                        {lead.commercial_acceptance_reference ? (
                          <p
                            className="mt-1 max-w-52 truncate text-[11px] text-slate-500"
                            title={lead.commercial_acceptance_reference}
                          >
                            Ref: {lead.commercial_acceptance_reference}
                          </p>
                        ) : null}
                      </div>
                    ) : (
                      <button
                        onClick={() => {
                          setActivationNotice(null);
                          setActivationLead(lead);
                        }}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-teal-300/30 bg-teal-300/5 px-2.5 py-1 text-xs font-medium text-teal-200 hover:bg-teal-300/10 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-teal-300"
                      >
                        <FileCheck2 className="h-3.5 w-3.5" aria-hidden />
                        Activate RIA
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activationLead ? (
        <RiaActivationDialog
          lead={activationLead}
          onClose={() => setActivationLead(null)}
          onActivated={async ({ assessmentId }) => {
            setActivationLead(null);
            setActivationNotice(
              `RIA ${shortId(assessmentId)} activated for ${activationLead.company}. The assessment remains visible only inside its activated organization.`,
            );
            refetch();
          }}
        />
      ) : null}
    </div>
  );
}
