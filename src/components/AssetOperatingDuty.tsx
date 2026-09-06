/**
 * Per-asset duty reader — get_operating_context + get_operating_regime
 * (C2.04, E3.02). Shared by /executive OperatingContext and /assets/:id.
 *
 * Does not invent a running state, a utilisation figure without coverage,
 * or a duty class when load_pct is missing.
 */
import { useState } from "react";
import { useAsyncData } from "../hooks/useAsyncData";
import {
  getOperatingContext,
  getOperatingRegime,
  suggestedWindowDays,
  type OperatingContextResult,
  type OperatingRegimeResult,
} from "../services/reliabilityCallers";
import { LoadingState, ErrorState } from "./ui/AsyncStates";

export function AssetOperatingDuty({ assetId }: { assetId: string }) {
  const [windowDays, setWindowDays] = useState(90);
  const context = useAsyncData<OperatingContextResult>(
    () => getOperatingContext(assetId, windowDays),
    [assetId, windowDays],
  );
  const regime = useAsyncData<OperatingRegimeResult>(
    () => getOperatingRegime(assetId),
    [assetId],
  );

  if (context.loading || regime.loading) {
    return <LoadingState label="Loading asset operating context" />;
  }
  if (context.error) {
    return <ErrorState message={context.error} onRetry={context.refetch} />;
  }

  const c = context.data;
  if (!c) return null;
  const suggested = suggestedWindowDays(c);
  const states = c.states ?? [];

  return (
    <div data-testid="asset-operating-duty" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-400">
            Duty profile
            <span className="ml-2 font-mono text-[10px] text-slate-600">
              {c.window_days}d window · {c.coverage_pct}% covered
            </span>
          </p>
          <p className="mt-1 text-sm text-slate-300">{c.basis}</p>
        </div>
        <label className="block">
          <span className="mb-1 block text-xs text-slate-500">Window days</span>
          <input
            aria-label="Operating-context window days"
            type="number"
            min={1}
            value={windowDays}
            onChange={(e) => {
              const next = Number(e.target.value);
              if (Number.isFinite(next) && next > 0) setWindowDays(next);
            }}
            className="w-24 rounded-lg border border-white/10 bg-industrial-black px-2 py-1.5 font-mono text-sm text-slate-200"
          />
        </label>
      </div>

      {regime.data && (
        <p className="text-sm text-slate-300">
          Regime now:{" "}
          <span className="font-medium text-slate-100">
            {regime.data.regime ?? "No state at this moment"}
          </span>
          <span className="mt-0.5 block text-xs text-slate-500">
            {regime.data.basis}
          </span>
        </p>
      )}

      {suggested != null && (
        <button
          type="button"
          onClick={() => setWindowDays(suggested)}
          className="rounded-lg border border-signal-gold/40 bg-signal-gold/10 px-2.5 py-1 text-xs font-medium text-signal-gold hover:bg-signal-gold/20 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-signal-gold"
        >
          Read the {suggested}-day span the records actually cover
        </button>
      )}

      {states.length === 0 ? (
        <p className="rounded-lg border border-white/6 bg-white/2 p-3 text-sm text-slate-400">
          No state hours fall inside this window. The platform does not treat
          that as uptime.
        </p>
      ) : (
        <table className="w-full text-left text-sm">
          <caption className="sr-only">
            Hours in each operating state inside the requested window
          </caption>
          <thead className="text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th scope="col" className="py-1 font-medium">
                State
              </th>
              <th scope="col" className="py-1 font-medium">
                Hours
              </th>
              <th scope="col" className="py-1 font-medium">
                Of covered
              </th>
            </tr>
          </thead>
          <tbody>
            {states.map((s) => (
              <tr key={s.state} className="border-t border-white/6">
                <td className="py-1.5 text-slate-200">{s.state}</td>
                <td className="py-1.5 font-mono text-slate-300 tabular-nums">
                  {s.hours}
                </td>
                <td className="py-1.5 font-mono text-slate-400 tabular-nums">
                  {s.pct_of_covered == null ? "—" : `${s.pct_of_covered}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="text-xs text-slate-500">
        {c.records_total} state record{c.records_total === 1 ? "" : "s"} held
        for this asset
        {c.data_span_from && c.data_span_to
          ? ` · history ${c.data_span_from.slice(0, 10)} to ${c.data_span_to.slice(0, 10)}`
          : ""}
        . {c.starts_in_window} start{c.starts_in_window === 1 ? "" : "s"} in
        window.
      </p>
    </div>
  );
}
