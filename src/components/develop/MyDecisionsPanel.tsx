/**
 * Sync Develop Slice 4D — D13.02, the My Decisions screen.
 *
 * Spec §44's seven columns: decision, project, value at stake, risk, due,
 * recommendation, confidence.
 *
 * WHAT THIS EXTENDS. A live "My Decisions" queue already ships at /risk
 * (RiskEnterprisePanels, fed by get_risk_decision_operations.my_decisions).
 * It reaches RISK-LINKED decisions only, and carries no due date, no latency
 * and no assumption-reopened flag. This surface is the same canonical
 * `decisions` table read CROSS-DOMAIN — development-case decisions as well as
 * risk ones — with the three missing columns added. It is not a second
 * decision store and not a second queue: one read, `get_my_decisions`.
 *
 * THE THREE ABSENCES THIS SCREEN REFUSES TO RENDER AS BLANKS:
 *   * a decision with no required date is shown LAST with the sentence saying
 *     it has no date, never sorted as though it were on time;
 *   * a decision with no recorded value at stake says so, because a decision
 *     worth nothing and a decision nobody has valued look identical otherwise;
 *   * a decision with no attached recommendation says so, for the same reason.
 */
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Inbox, RefreshCw } from "lucide-react";

import {
  MY_DECISION_COLUMNS,
  sortMyDecisions,
  type MyDecisions,
} from "../../lib/develop/change";
import { getMyDecisions } from "../../services/developService";

export function MyDecisionsPanel() {
  const [data, setData] = useState<MyDecisions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      setData(await getMyDecisions(50));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="rounded-xl border border-white/6 bg-[#0D1520] p-5">
      <div className="flex items-center gap-2">
        <Inbox className="h-4 w-4 text-signal-cyan" />
        <h2 className="text-sm font-semibold text-slate-100">My Decisions</h2>
        <button
          onClick={() => void load()}
          disabled={busy}
          className="ml-auto rounded-lg bg-white/5 px-2 py-1 text-xs text-slate-300 hover:bg-white/10 disabled:opacity-40"
        >
          <RefreshCw className="h-3 w-3" />
        </button>
      </div>
      <p className="mt-1 text-xs text-slate-400">
        Decisions routed to you across risk and development, with what each one
        is holding up.
      </p>

      {error != null && (
        <div className="mt-3 rounded border border-red-400/30 bg-red-400/10 px-2.5 py-1.5 text-xs text-red-300">
          {error}
        </div>
      )}

      {data != null && (
        <>
          <p className="mt-2 text-[11px] text-slate-500">{data.scopeNote}</p>
          {data.refusal != null && (
            <div className="mt-2 rounded border border-amber-400/25 bg-amber-400/5 px-2.5 py-1.5 text-xs text-amber-200">
              {data.refusal}
            </div>
          )}
          {data.count > 0 && (
            <>
              {/* The counts are over the WHOLE queue, not the page. They used
                  to be aggregated after the LIMIT, so an administrator in an
                  organization with 300 pending decisions was told "50
                  pending" — a total that silently equalled the page size. */}
              <p className="mt-2 text-xs text-slate-400">
                {data.count} pending · {data.overdueCount} overdue ·{" "}
                {data.reopenedCount} with a reopened assumption ·{" "}
                {data.undatedCount} with no required date
              </p>
              {data.truncationNote != null && (
                <p className="mt-1 text-[11px] text-amber-200">
                  {data.truncationNote}
                </p>
              )}
              <div className="mt-2 overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="text-left text-slate-500">
                      {MY_DECISION_COLUMNS.map((c) => (
                        <th key={c.key} className="py-1 pr-3">
                          {c.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sortMyDecisions(data.decisions).map((d) => (
                      <tr
                        key={d.decisionId}
                        className="align-top text-slate-300"
                      >
                        <td className="py-1.5 pr-3">
                          <span className="text-slate-100">{d.decision}</span>
                          {d.reassessmentRequired && (
                            <span className="ml-1 inline-flex items-center gap-1 text-amber-300">
                              <AlertTriangle className="h-3 w-3" />
                              assumption reopened
                            </span>
                          )}
                          {d.onCriticalPath === true && (
                            <span className="ml-1 text-red-300">
                              on the critical path
                            </span>
                          )}
                        </td>
                        <td className="py-1.5 pr-3">
                          {d.project ?? (
                            <span className="text-slate-500">
                              not attached to a project
                            </span>
                          )}
                        </td>
                        <td className="py-1.5 pr-3">
                          {d.valueRefusal != null ? (
                            <span className="text-amber-200">not valued</span>
                          ) : (
                            `${d.currency ?? ""} ${(d.valueAtStake ?? 0).toLocaleString()}`
                          )}
                        </td>
                        <td className="py-1.5 pr-3">
                          {d.riskLevel ?? (
                            <span className="text-slate-500">—</span>
                          )}
                        </td>
                        <td className="py-1.5 pr-3">
                          {d.dueRefusal != null ? (
                            <span className="text-amber-200">no due date</span>
                          ) : (
                            <>
                              {d.dueDate}
                              {d.overdue === true && (
                                <span className="ml-1 text-red-300">
                                  +{d.latencyDays}d
                                </span>
                              )}
                            </>
                          )}
                        </td>
                        <td className="py-1.5 pr-3">
                          {d.recommendationRefusal != null ? (
                            <span className="text-amber-200">
                              none recorded
                            </span>
                          ) : (
                            d.recommendation
                          )}
                        </td>
                        <td className="py-1.5 pr-3">
                          {d.confidence == null ? (
                            <span className="text-slate-500">—</span>
                          ) : (
                            `${d.confidence}%`
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
