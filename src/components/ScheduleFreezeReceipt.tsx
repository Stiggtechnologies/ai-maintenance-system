/**
 * Read-only C4.06 freeze receipts. Freezing stays on SchedulerPanel through
 * release_schedule_option; this surface only shows the audit row that door wrote.
 */
import { useState } from "react";
import { ScrollText } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import {
  getScheduleFreezeReceipts,
  type ScheduleFreezeCheck,
  type ScheduleFreezeReceipt as FreezeReceipt,
  type ScheduleFreezeReceipts,
} from "../services/scheduleFreezeService";
import { EmptyState, ErrorState, LoadingState } from "./ui/AsyncStates";

function when(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "time not recorded";
  return parsed.toLocaleString();
}

function checkLabel(check: ScheduleFreezeCheck): string {
  if (check.passed === true) return "passed";
  if (check.passed === false) return "failed";
  return "not assessable";
}

function openChecks(receipt: FreezeReceipt): ScheduleFreezeCheck[] {
  return (receipt.checks ?? []).filter((check) => check.passed !== true);
}

export function ScheduleFreezeReceipt() {
  const { data, loading, error, refetch } =
    useAsyncData<ScheduleFreezeReceipts>(getScheduleFreezeReceipts, []);
  const [openId, setOpenId] = useState<string | null>(null);

  if (loading) return <LoadingState label="Loading schedule freeze receipts" />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  const receipts = data?.receipts ?? [];

  return (
    <section aria-labelledby="schedule-freeze-heading" className="space-y-3">
      <div>
        <h2
          id="schedule-freeze-heading"
          className="flex items-center gap-2 text-lg font-semibold text-white"
        >
          <ScrollText className="h-5 w-5 text-signal-cyan" aria-hidden />
          Frozen-week receipts
        </h2>
        <p className="mt-1 text-sm text-slate-300">
          Each freeze is an append-only receipt of the named human, the role,
          and the feasibility enforced at release. The AI-operator identity
          cannot freeze a week. A receipt does not approve a production
          interruption, release outage scope, or authorize work.
        </p>
      </div>

      {data?.truncated && (
        <p className="text-xs text-slate-400">
          Showing the latest {receipts.length} of {data.receipt_count} frozen
          weeks. Older receipts remain in the audit ledger.
        </p>
      )}

      {receipts.length === 0 ? (
        <EmptyState message="No week has been frozen in this tenant yet. A freeze stays a planner, maintenance-manager, or administrator act on a draft option above." />
      ) : (
        <ul className="space-y-3">
          {receipts.map((receipt) => {
            const open = openChecks(receipt);
            const expanded = openId === receipt.audit_id;
            return (
              <li
                key={receipt.audit_id}
                className="rounded-xl border border-white/6 bg-overlook-deep/40 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-200">
                      {receipt.label || "Weekly option"} · week of{" "}
                      {receipt.week_start}
                    </h3>
                    <p className="mt-1 text-xs text-slate-400">
                      Frozen {when(receipt.event_time)} by {receipt.actor_role}{" "}
                      {receipt.actor}
                    </p>
                  </div>
                  <p className="font-mono text-[11px] text-slate-500">
                    {receipt.warnings_acknowledged} warning
                    {receipt.warnings_acknowledged === 1 ? "" : "s"}{" "}
                    acknowledged
                  </p>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-slate-400">
                  {receipt.boundary}
                </p>
                <p className="mt-2 break-all font-mono text-[11px] text-slate-500">
                  Feasibility {receipt.feasibility_sha256}
                </p>
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => setOpenId(expanded ? null : receipt.audit_id)}
                  className="mt-3 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-white/10 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-signal-cyan"
                >
                  {expanded
                    ? "Hide feasibility checks"
                    : `Show ${open.length} open feasibility check${open.length === 1 ? "" : "s"}`}
                </button>
                {expanded && (
                  <ul className="mt-3 space-y-2">
                    {open.length === 0 ? (
                      <li className="text-xs text-slate-400">
                        Every recorded check passed at freeze.
                      </li>
                    ) : (
                      open.map((check) => (
                        <li
                          key={`${receipt.audit_id}-${check.constraint}`}
                          className="rounded-lg border border-white/8 bg-white/3 p-2 text-[11px] leading-relaxed text-slate-300"
                        >
                          <strong>{check.constraint}</strong> · {check.severity}{" "}
                          · {checkLabel(check)}. {check.detail}
                        </li>
                      ))
                    )}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
