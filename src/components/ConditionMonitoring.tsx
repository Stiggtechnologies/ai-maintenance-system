/**
 * ConditionMonitoring — coverage, live alerts, warning lead time, PM task
 * effectiveness and P-F intervals
 * (capability register C2.05, C6.24, C6.25).
 *
 * The sensors table stored only last_value, so there was no history — and
 * without history a trend is decoration, an alert cannot be edge-triggered,
 * and "how much warning did we get?" has no answer at all. Alerts now record a
 * CROSSING rather than a state, which is precisely what makes lead time
 * measurable.
 *
 * P-F intervals are shown as declared engineering reference data with their
 * basis, not as something the platform inferred. An invented interval sitting
 * underneath an inspection frequency is an invented safety margin.
 */
import { Radar, Bell, Ruler } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import { supabase } from "../lib/supabase";
import { LoadingState, ErrorState } from "./ui/AsyncStates";

interface Alert {
  id: string;
  asset: string | null;
  sensor: string;
  severity: "warning" | "alarm";
  value: number;
  limit: number;
  triggered_at: string;
  hours_open: number;
  acknowledged: boolean;
  linked_work_order: boolean;
}

interface Pf {
  failure_mode: string;
  technique: string;
  pf_interval_days: number;
  recommended_inspection_days: number;
  status: string;
  basis: string;
}

interface Payload {
  coverage: {
    assets: number;
    monitored_assets: number;
    coverage_pct: number | null;
    critical_assets: number;
    critical_monitored: number;
    critical_coverage_pct: number | null;
    readings: number;
    basis: string;
  };
  active_alerts: Alert[];
  warning_lead_time: {
    available: boolean;
    value: number | null;
    unit: string;
    sample: number;
    basis: string;
  };
  pm_task_effectiveness: {
    available: boolean;
    pm_completed: number;
    finding_rate_pct: number | null;
    missed_rate_pct: number | null;
    basis: string;
  };
  pf_intervals: Pf[];
  pf_note: string;
}

export function ConditionMonitoring() {
  const { data, loading, error, refetch } = useAsyncData<Payload>(async () => {
    const { data: r, error: e } = await supabase.rpc(
      "get_condition_monitoring",
      {},
    );
    if (e) throw new Error(e.message);
    return r as Payload;
  }, []);

  if (loading) return <LoadingState label="Loading condition monitoring" />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  const cov = data?.coverage;
  const alerts = data?.active_alerts ?? [];
  const lead = data?.warning_lead_time;
  const pm = data?.pm_task_effectiveness;
  const pf = data?.pf_intervals ?? [];
  const alarms = alerts.filter((a) => a.severity === "alarm").length;

  return (
    <section aria-labelledby="cm-heading" className="space-y-4">
      <div>
        <h2
          id="cm-heading"
          className="flex items-center gap-2 text-lg font-semibold text-white"
        >
          <Radar className="h-5 w-5 text-signal-cyan" aria-hidden />
          Condition Monitoring
          <span className="text-xs font-normal text-slate-500">
            {cov?.monitored_assets}/{cov?.assets} assets ·{" "}
            {cov?.readings?.toLocaleString()} readings
          </span>
        </h2>
        <p className="mt-1 text-sm text-slate-300">{cov?.basis}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-white/6 bg-overlook-deep/40 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-400">
            Critical-asset coverage
          </p>
          <p className="mt-1 font-mono text-2xl text-slate-100">
            {cov?.critical_coverage_pct ?? "—"}
            <span className="ml-0.5 text-sm text-slate-500">%</span>
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {cov?.critical_monitored} of {cov?.critical_assets} critical assets
            instrumented
          </p>
        </div>

        <div className="rounded-xl border border-white/6 bg-overlook-deep/40 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-400">
            Warning lead time
          </p>
          <p className="mt-1 font-mono text-2xl text-slate-100">
            {lead?.available ? lead.value : "—"}
            {lead?.available && (
              <span className="ml-0.5 text-sm text-slate-500"> h</span>
            )}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            {lead?.available
              ? `Over ${lead.sample} alerts linked to work`
              : "Not measurable yet"}
          </p>
        </div>

        <div className="rounded-xl border border-white/6 bg-overlook-deep/40 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-400">
            PM finding rate
          </p>
          <p className="mt-1 font-mono text-2xl text-slate-100">
            {pm?.finding_rate_pct ?? "—"}
            <span className="ml-0.5 text-sm text-slate-500">%</span>
          </p>
          <p className="mt-1 text-xs text-slate-500">
            PMs that found something, of {pm?.pm_completed?.toLocaleString()}
          </p>
        </div>

        <div className="rounded-xl border border-white/6 bg-overlook-deep/40 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-400">
            PM missed rate
          </p>
          <p
            className={`mt-1 font-mono text-2xl ${(pm?.missed_rate_pct ?? 0) > 25 ? "text-amber-300" : "text-slate-100"}`}
          >
            {pm?.missed_rate_pct ?? "—"}
            <span className="ml-0.5 text-sm text-slate-500">%</span>
          </p>
          <p className="mt-1 text-xs text-slate-500">
            High/critical failure 7–30 days after a PM
          </p>
        </div>
      </div>

      <p className="text-xs leading-relaxed text-slate-500">{pm?.basis}</p>
      {!lead?.available && (
        <p className="rounded-xl border border-white/6 bg-white/2 p-3 text-xs leading-relaxed text-slate-400">
          {lead?.basis}
        </p>
      )}

      <div className="pt-1">
        <h3 className="flex items-center gap-2 text-base font-semibold text-white">
          <Bell className="h-4.5 w-4.5 text-signal-gold" aria-hidden />
          Open alerts
          <span className="text-xs font-normal text-slate-500">
            {alerts.length}
            {alarms > 0 && ` · ${alarms} at alarm`}
          </span>
        </h3>
      </div>

      {alerts.length === 0 ? (
        <p className="rounded-xl border border-white/6 bg-white/2 p-4 text-sm text-slate-400">
          No open condition alerts. Alerts are raised on a limit{" "}
          <em>crossing</em> and closed when the signal returns inside limits —
          the record of the crossing is kept, because that is what warning lead
          time is measured from.
        </p>
      ) : (
        <ul className="space-y-2">
          {alerts.map((a) => (
            <li
              key={a.id}
              className={`rounded-xl border p-3.5 ${
                a.severity === "alarm"
                  ? "border-red-500/30 bg-red-500/5"
                  : "border-amber-500/25 bg-amber-500/5"
              }`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm text-slate-200">
                  {a.asset ?? "Unassigned asset"}{" "}
                  <span className="text-slate-500">· {a.sensor}</span>
                </p>
                <span
                  className={`rounded-full border px-2 py-0.5 text-xs ${
                    a.severity === "alarm"
                      ? "border-red-500/30 text-red-300"
                      : "border-amber-500/30 text-amber-300"
                  }`}
                >
                  {a.severity}
                </span>
              </div>
              <p className="mt-1 font-mono text-xs text-slate-400 tabular-nums">
                {a.value} vs limit {a.limit} · open {a.hours_open} h
              </p>
              {!a.linked_work_order && (
                <p className="mt-1 text-xs text-slate-500">
                  Not yet linked to work — lead time counts only linked alerts.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="pt-1">
        <h3 className="flex items-center gap-2 text-base font-semibold text-white">
          <Ruler className="h-4.5 w-4.5 text-slate-300" aria-hidden />
          P-F intervals
          <span className="text-xs font-normal text-slate-500">
            {pf.length} declared
          </span>
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-slate-400">
          {data?.pf_note}
        </p>
      </div>

      <div className="overflow-x-auto rounded-xl border border-white/6">
        <table className="w-full min-w-[44rem] text-left text-sm">
          <caption className="sr-only">
            Potential-failure to functional-failure intervals by mode and
            detection technique
          </caption>
          <thead className="bg-white/2 text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">
                Failure mode
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Technique
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                P-F
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Inspect every
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                State
              </th>
            </tr>
          </thead>
          <tbody>
            {pf.map((p) => (
              <tr
                key={`${p.failure_mode}-${p.technique}`}
                className="border-t border-white/6 align-top"
              >
                <td className="px-4 py-2.5 text-slate-200">{p.failure_mode}</td>
                <td className="px-4 py-2.5 text-slate-400">{p.technique}</td>
                <td className="px-4 py-2.5 font-mono text-slate-300 tabular-nums">
                  {p.pf_interval_days} d
                </td>
                <td className="px-4 py-2.5 font-mono text-signal-cyan tabular-nums">
                  {p.recommended_inspection_days} d
                </td>
                <td className="px-4 py-2.5">
                  <span
                    className={`rounded-full border px-2 py-0.5 text-xs ${
                      p.status === "adopted"
                        ? "border-green-500/30 bg-green-500/10 text-green-300"
                        : "border-amber-500/30 bg-amber-500/10 text-amber-300"
                    }`}
                  >
                    {p.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
