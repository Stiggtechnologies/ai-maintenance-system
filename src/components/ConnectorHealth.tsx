/**
 * ConnectorHealth — the ingestion contract's operating picture
 * (capability register C2.12–C2.19, U21.01).
 *
 * Two things this panel refuses to do, because both are how integration
 * dashboards mislead:
 *
 *   * It never shows a connector that has not run as healthy. Silence is
 *     reported as "never run" or "stale", not as a green tick.
 *   * It never shows a sync as successful without its ACCEPTANCE RATE. A
 *     connector quietly rejecting 40% of its rows completes its run without
 *     error; the rate and the reject reasons are the only way that surfaces.
 *
 * Rejected rows are retained in staging with the reason attached, so the
 * question "what did we not load, and why?" always has an answer.
 */
import { Plug, AlertOctagon, ArrowDownToLine } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import { supabase } from "../lib/supabase";
import { LoadingState, ErrorState } from "./ui/AsyncStates";

interface Connector {
  connector_key: string;
  name: string;
  system_kind: string | null;
  enabled: boolean;
  direction: string;
  write_enabled: boolean;
  last_success_at: string | null;
  expected_interval_minutes: number | null;
  state: "disabled" | "never run" | "stale" | "current";
  runs_30d: number;
  records_accepted_30d: number;
  records_rejected_30d: number;
  acceptance_pct: number | null;
}

interface Payload {
  connectors: Connector[];
  top_reject_reasons: { reason: string; count: number }[];
  note: string;
}

const STATE_STYLE: Record<string, string> = {
  current: "border-green-500/30 bg-green-500/10 text-green-300",
  stale: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  "never run": "border-slate-600 bg-slate-800/60 text-slate-400",
  disabled: "border-slate-700 bg-slate-900/60 text-slate-500",
};

export function ConnectorHealth() {
  const { data, loading, error, refetch } = useAsyncData<Payload>(async () => {
    const { data: r, error: e } = await supabase.rpc(
      "get_connector_health",
      {},
    );
    if (e) throw new Error(e.message);
    return r as Payload;
  }, []);

  if (loading) return <LoadingState label="Loading connector health" />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  const connectors = data?.connectors ?? [];
  const reasons = data?.top_reject_reasons ?? [];
  const live = connectors.filter((c) => c.state === "current").length;
  const writers = connectors.filter((c) => c.write_enabled).length;

  return (
    <section aria-labelledby="connector-heading" className="space-y-4">
      <div>
        <h2
          id="connector-heading"
          className="flex items-center gap-2 text-lg font-semibold text-white"
        >
          <Plug className="h-5 w-5 text-signal-cyan" aria-hidden />
          Source Connectors
          <span className="text-xs font-normal text-slate-500">
            {live}/{connectors.length} current
            {writers === 0 && " · all read-only"}
          </span>
        </h2>
        <p className="mt-1 text-sm text-slate-300">{data?.note}</p>
      </div>

      {connectors.length === 0 ? (
        <p className="rounded-xl border border-white/6 bg-white/2 p-4 text-sm text-slate-400">
          No connector is registered. Every source lands through the same
          validated, idempotent path — batches are keyed on{" "}
          <code className="text-slate-300">(source_system, external_id)</code>{" "}
          so replays and overlapping windows cannot double-count.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/6">
          <table className="w-full min-w-[48rem] text-left text-sm">
            <caption className="sr-only">
              Registered connectors with state and 30-day acceptance
            </caption>
            <thead className="bg-white/2 text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">
                  Connector
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Kind
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Access
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Runs 30d
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Accepted
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  State
                </th>
              </tr>
            </thead>
            <tbody>
              {connectors.map((c) => (
                <tr key={c.connector_key} className="border-t border-white/6">
                  <td className="px-4 py-2.5">
                    <p className="text-slate-200">{c.name}</p>
                    <p className="font-mono text-[11px] text-slate-500">
                      {c.connector_key}
                    </p>
                  </td>
                  <td className="px-4 py-2.5 text-slate-400">
                    {c.system_kind ?? "—"}
                  </td>
                  <td className="px-4 py-2.5 text-xs">
                    <span className="text-slate-300">
                      {c.direction === "read_only" ? "read-only" : "read/write"}
                    </span>
                    {c.write_enabled && (
                      <span className="ml-1 text-amber-300">· writes on</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-slate-300 tabular-nums">
                    {c.runs_30d}
                  </td>
                  <td className="px-4 py-2.5">
                    {c.acceptance_pct === null ? (
                      <span className="text-slate-500">—</span>
                    ) : (
                      <>
                        <span
                          className={`font-mono tabular-nums ${c.acceptance_pct < 90 ? "text-amber-300" : "text-slate-300"}`}
                        >
                          {c.acceptance_pct}%
                        </span>
                        <span className="ml-1 text-xs text-slate-500">
                          ({c.records_rejected_30d} rejected)
                        </span>
                      </>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs ${STATE_STYLE[c.state]}`}
                    >
                      {c.state}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {reasons.length > 0 && (
        <div className="rounded-xl border border-white/6 bg-white/2 p-4">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
            <AlertOctagon className="h-3.5 w-3.5" aria-hidden />
            Why rows were rejected — last 30 days
          </h3>
          <ul className="mt-2 space-y-1">
            {reasons.map((r) => (
              <li
                key={r.reason}
                className="flex items-baseline justify-between gap-3 text-xs"
              >
                <span className="text-slate-400">{r.reason}</span>
                <span className="font-mono text-slate-300 tabular-nums">
                  {r.count}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="flex items-start gap-1.5 text-xs leading-relaxed text-slate-500">
        <ArrowDownToLine className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        Connectors register disabled and read-only. Write-back to a source
        system additionally requires explicit enablement and a permitting
        decision right — the platform's default posture is that it reads.
      </p>
    </section>
  );
}
