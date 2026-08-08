/**
 * SegmentedReliability — metrics segmented by asset class, criticality, site
 * and failure mode (capability register C6.26).
 *
 * Spec §6: "Metrics must always be segmented by asset class, criticality,
 * site, operating regime and failure mode." A fleet-level MTBF hides the
 * variation an engineer needs; these figures come from the same deterministic
 * arithmetic as the validated reliability engine, computed server-side over
 * coded work-order history.
 */
import { useState } from "react";
import { Layers } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import { supabase } from "../lib/supabase";
import { LoadingState, ErrorState, EmptyState } from "./ui/AsyncStates";

type Dimension = "criticality" | "asset_class" | "site" | "failure_mode";

interface Segment {
  segment: string;
  failures: number;
  assets_in_segment: number;
  downtime_hours: number;
  window_hours: number;
  mtbf_hours: number;
  mttr_hours: number;
  availability_pct: number;
}

interface SegmentedResult {
  dimension: string;
  window_days?: number;
  window_source?: string;
  basis: string;
  segments: Segment[];
  error?: string;
}

const DIMENSIONS: Array<{ key: Dimension; label: string }> = [
  { key: "criticality", label: "Criticality" },
  { key: "asset_class", label: "Asset class" },
  { key: "site", label: "Site" },
  { key: "failure_mode", label: "Failure mode" },
];

export function SegmentedReliability() {
  const [dimension, setDimension] = useState<Dimension>("criticality");
  const { data, loading, error, refetch } = useAsyncData<SegmentedResult>(
    async () => {
      const { data: r, error: e } = await supabase.rpc(
        "get_segmented_reliability",
        { p_dimension: dimension },
      );
      if (e) throw new Error(e.message);
      const result = r as SegmentedResult;
      if (result?.error) throw new Error(result.error);
      return result;
    },
    [dimension],
  );

  if (loading) return <LoadingState label="Computing segmented reliability" />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;
  const segments = data?.segments ?? [];
  const worstAvailability = segments.length
    ? Math.min(...segments.map((s) => s.availability_pct))
    : null;

  return (
    <section aria-labelledby="segmented-heading" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2
            id="segmented-heading"
            className="flex items-center gap-2 text-lg font-semibold text-white"
          >
            <Layers className="h-5 w-5 text-signal-cyan" aria-hidden />
            Segmented Reliability
          </h2>
          <p className="mt-1 text-sm text-slate-300">
            Fleet averages hide the variation that matters. MTBF, MTTR and
            availability computed per segment from coded work-order history.
          </p>
        </div>
        <div
          role="tablist"
          aria-label="Segmentation dimension"
          className="flex flex-wrap gap-1"
        >
          {DIMENSIONS.map((d) => (
            <button
              key={d.key}
              role="tab"
              aria-selected={dimension === d.key}
              onClick={() => setDimension(d.key)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-signal-cyan ${
                dimension === d.key
                  ? "border-signal-cyan/50 bg-signal-cyan/10 text-signal-cyan"
                  : "border-white/10 bg-white/5 text-slate-300 hover:text-white"
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>

      {segments.length === 0 ? (
        <EmptyState message="No segment has enough coded corrective history to report on." />
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-white/6">
            <table className="w-full text-sm">
              <caption className="sr-only">
                Reliability metrics by {dimension.replace(/_/g, " ")}
              </caption>
              <thead>
                <tr className="border-b border-white/6 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th scope="col" className="px-4 py-3">
                    Segment
                  </th>
                  <th scope="col" className="px-4 py-3 text-right">
                    Assets
                  </th>
                  <th scope="col" className="px-4 py-3 text-right">
                    Failures
                  </th>
                  <th scope="col" className="px-4 py-3 text-right">
                    MTBF (h)
                  </th>
                  <th scope="col" className="px-4 py-3 text-right">
                    MTTR (h)
                  </th>
                  <th scope="col" className="px-4 py-3 text-right">
                    Availability
                  </th>
                </tr>
              </thead>
              <tbody>
                {segments.map((s) => {
                  const worst =
                    worstAvailability !== null &&
                    s.availability_pct === worstAvailability &&
                    segments.length > 1;
                  return (
                    <tr
                      key={s.segment}
                      className="border-b border-white/4 hover:bg-white/2"
                    >
                      <th
                        scope="row"
                        className="px-4 py-2.5 text-left font-medium text-slate-200"
                      >
                        {s.segment}
                      </th>
                      <td className="px-4 py-2.5 text-right font-mono text-slate-400">
                        {s.assets_in_segment}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-slate-400">
                        {s.failures}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-slate-200">
                        {s.mtbf_hours}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-slate-200">
                        {s.mttr_hours}
                      </td>
                      <td
                        className={`px-4 py-2.5 text-right font-mono ${
                          worst ? "text-red-300" : "text-slate-200"
                        }`}
                      >
                        {s.availability_pct}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500">
            {data?.window_days
              ? `Window ${data.window_days} days (${data.window_source}). `
              : ""}
            {data?.basis}
          </p>
        </>
      )}
    </section>
  );
}
