/**
 * MonitoringCoverageGaps — which failure mechanisms are BLIND on each asset
 * (capability register C2.05, C4.03).
 *
 * The tempting design was a catalogue of every monitorable condition across
 * every asset class. That is combinatorially unbounded, mostly irrelevant to
 * any one operator, and every interval in it would be a vendor-invented number
 * underneath an inspection frequency.
 *
 * So the universal part — techniques, damage mechanisms, and which detects
 * which — ships complete, and the site-specific part (how many days of warning
 * you actually get) stays with the operator. That split is what makes the
 * useful question answerable: not "what could be monitored?" but "what is
 * this asset blind to, right now, given the instrumentation actually fitted?"
 *
 * Coverage counts a mechanism only where a PRIMARY technique is installed.
 * Planning a condition-based strategy on a secondary indicator is how late
 * detection happens.
 */
import { useState } from "react";
import { EyeOff, ScanSearch } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import { supabase } from "../lib/supabase";
import { LoadingState, ErrorState } from "./ui/AsyncStates";

interface AssetGap {
  asset_id: string;
  name: string;
  criticality: string | null;
  techniques_installed: string[];
  mechanisms_covered: number;
  mechanisms_total: number;
  coverage_pct: number | null;
  blind_primary: string[];
}

interface Payload {
  techniques: number;
  mechanisms: number;
  detectability_pairs: number;
  assets: AssetGap[];
  method: string;
  caveat: string;
}

export function MonitoringCoverageGaps() {
  const [criticalOnly, setCriticalOnly] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const { data, loading, error, refetch } = useAsyncData<Payload>(async () => {
    const { data: r, error: e } = await supabase.rpc(
      "get_monitoring_coverage_gaps",
      {},
    );
    if (e) throw new Error(e.message);
    return r as Payload;
  }, []);

  if (loading) return <LoadingState label="Assessing monitoring coverage" />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  const all = data?.assets ?? [];
  const assets = criticalOnly
    ? all.filter((a) => a.criticality === "critical")
    : all;
  const uninstrumented = all.filter(
    (a) => (a.techniques_installed?.length ?? 0) === 0,
  ).length;

  return (
    <section aria-labelledby="gaps-heading" className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            id="gaps-heading"
            className="flex items-center gap-2 text-lg font-semibold text-white"
          >
            <ScanSearch className="h-5 w-5 text-signal-gold" aria-hidden />
            Detectability & Coverage Gaps
            <span className="text-xs font-normal text-slate-500">
              {data?.techniques} techniques · {data?.mechanisms} mechanisms ·{" "}
              {data?.detectability_pairs} mappings
            </span>
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-300">
            {data?.method}
          </p>
        </div>
        <button
          onClick={() => setCriticalOnly((v) => !v)}
          className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-slate-200 hover:bg-white/10 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-signal-cyan"
          aria-pressed={criticalOnly}
        >
          {criticalOnly ? "Critical assets only" : "All assets"}
        </button>
      </div>

      {uninstrumented > 0 && (
        <p className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-3 text-xs leading-relaxed text-amber-200/90">
          <strong>{uninstrumented}</strong> of {all.length} assets carry no
          condition-monitoring instrumentation at all — every mechanism on them
          is blind, and no amount of analysis changes that.
        </p>
      )}

      <ul className="space-y-2">
        {assets.map((a) => (
          <li
            key={a.asset_id}
            className="rounded-xl border border-white/6 bg-overlook-deep/40 p-4"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-medium text-slate-200">
                {a.name}
                {a.criticality && (
                  <span className="ml-2 text-xs text-slate-500">
                    {a.criticality}
                  </span>
                )}
              </p>
              <div className="flex items-center gap-3 text-xs">
                <span className="font-mono text-slate-300 tabular-nums">
                  {a.coverage_pct ?? 0}% covered
                </span>
                <span className="inline-flex items-center gap-1 text-amber-300">
                  <EyeOff className="h-3.5 w-3.5" aria-hidden />
                  {a.blind_primary?.length ?? 0} blind
                </span>
              </div>
            </div>

            <p className="mt-1 text-xs text-slate-500">
              {a.techniques_installed?.length
                ? `Installed: ${a.techniques_installed.join(", ")}`
                : "No condition-monitoring technique installed"}
            </p>

            {(a.blind_primary?.length ?? 0) > 0 && (
              <>
                <button
                  onClick={() =>
                    setExpanded(expanded === a.asset_id ? null : a.asset_id)
                  }
                  className="mt-2 text-xs text-signal-cyan hover:underline focus:outline-hidden focus-visible:ring-2 focus-visible:ring-signal-cyan"
                  aria-expanded={expanded === a.asset_id}
                >
                  {expanded === a.asset_id ? "Hide" : "Show"} blind mechanisms
                </button>
                {expanded === a.asset_id && (
                  <ul className="mt-2 grid gap-1 border-l border-white/10 pl-3 sm:grid-cols-2">
                    {a.blind_primary.map((m) => (
                      <li key={m} className="text-xs text-slate-400">
                        {m}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </li>
        ))}
      </ul>

      <p className="text-xs leading-relaxed text-slate-500">{data?.caveat}</p>
    </section>
  );
}
