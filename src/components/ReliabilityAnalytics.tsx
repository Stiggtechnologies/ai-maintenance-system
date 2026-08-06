/**
 * ReliabilityAnalytics — validated reliability mathematics on real work-order
 * history (capability register C7.01, C7.03, C7.04, C7.11).
 *
 * All numbers here are computed client-side by the deterministic engine in
 * src/lib/reliability (unit-tested against analytic identities and seeded
 * parameter recovery). No LLM touches any numeric path. Assumptions are
 * stated inline; where data is insufficient the panel says so instead of
 * guessing.
 */
import { useMemo, useState } from "react";
import { Activity, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import { supabase } from "../lib/supabase";
import {
  crowAMSAA,
  pareto,
  repairableSummary,
  weibullMLE,
  type CrowAmsaaFit,
  type WeibullFit,
} from "../lib/reliability";
import { LoadingState, ErrorState, EmptyState } from "./ui/AsyncStates";

interface WoRow {
  asset_id: string;
  tag: string;
  completed_at: string;
  downtime_hours: number;
  actual_failure_mode: string | null;
}

async function getCorrectiveHistory(): Promise<WoRow[]> {
  const { data, error } = await supabase
    .from("work_orders")
    .select(
      "asset_id, completed_at, downtime_hours, actual_failure_mode, assets!inner(tag)",
    )
    .eq("work_type", "corrective")
    .not("completed_at", "is", null)
    .order("completed_at");
  if (error) throw new Error(error.message);
  type Raw = {
    asset_id: string;
    completed_at: string;
    downtime_hours: number | null;
    actual_failure_mode: string | null;
    assets: { tag: string } | { tag: string }[];
  };
  return ((data ?? []) as Raw[]).map((r) => ({
    asset_id: r.asset_id,
    tag: Array.isArray(r.assets) ? r.assets[0]?.tag : r.assets?.tag,
    completed_at: r.completed_at,
    downtime_hours: Number(r.downtime_hours ?? 0),
    actual_failure_mode: r.actual_failure_mode,
  }));
}

interface UnitAnalysis {
  tag: string;
  windowHours: number;
  summary: ReturnType<typeof repairableSummary> | null;
  crow: CrowAmsaaFit | null;
  weibull: WeibullFit | null;
  weibullNote: string;
  topModes: Array<{ key: string; value: number; cumulativeShare: number }>;
}

function analyzeUnit(rows: WoRow[]): UnitAnalysis | null {
  if (rows.length === 0) return null;
  const times = rows
    .map((r) => new Date(r.completed_at).getTime())
    .sort((a, b) => a - b);
  const t0 = times[0];
  const tEnd = times[times.length - 1];
  const windowHours = Math.max(24, (tEnd - t0) / 3.6e6 + 24);

  let summary: UnitAnalysis["summary"];
  try {
    summary = repairableSummary(
      rows.map((r) => r.downtime_hours),
      windowHours,
    );
  } catch {
    summary = null;
  }

  const cumHours = times.map((t, i) => (t - t0) / 3.6e6 + 1 + i * 1e-6);
  let crow: CrowAmsaaFit | null;
  try {
    crow = crowAMSAA(cumHours, windowHours);
  } catch {
    crow = null;
  }

  const inter: number[] = [];
  for (let i = 1; i < cumHours.length; i++) {
    const d = cumHours[i] - cumHours[i - 1];
    if (d > 0.01) inter.push(d);
  }
  let weibull: WeibullFit | null = null;
  let weibullNote: string;
  try {
    weibull = weibullMLE(inter);
    weibullNote = `${inter.length} inter-arrival intervals from ${rows.length} events (same-shift events collapse at daily granularity)`;
  } catch (e) {
    weibullNote = e instanceof Error ? e.message : "insufficient data";
  }

  const byMode = new Map<string, number>();
  for (const r of rows) {
    const k = r.actual_failure_mode ?? "Uncoded";
    byMode.set(k, (byMode.get(k) ?? 0) + r.downtime_hours);
  }
  const topModes = pareto(
    [...byMode.entries()].map(([key, value]) => ({ key, value })),
  ).slice(0, 5);

  return {
    tag: rows[0].tag,
    windowHours,
    summary,
    crow,
    weibull,
    weibullNote,
    topModes,
  };
}

function TrendBadge({ beta }: { beta: number }) {
  const deteriorating = beta > 1.1;
  const improving = beta < 0.9;
  const Icon = deteriorating ? TrendingUp : improving ? TrendingDown : Minus;
  const cls = deteriorating
    ? "border-red-500/30 bg-red-500/10 text-red-300"
    : improving
      ? "border-teal-500/30 bg-teal-500/10 text-teal-300"
      : "border-white/10 bg-white/5 text-slate-300";
  const label = deteriorating
    ? "deteriorating"
    : improving
      ? "improving"
      : "stable rate";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${cls}`}
    >
      <Icon className="h-3 w-3" aria-hidden /> {label}
    </span>
  );
}

export function ReliabilityAnalytics() {
  const { data, loading, error, refetch } = useAsyncData<WoRow[]>(
    getCorrectiveHistory,
    [],
  );
  const [selected, setSelected] = useState<string | null>(null);

  const byTag = useMemo(() => {
    const m = new Map<string, WoRow[]>();
    for (const r of data ?? []) {
      if (!r.tag) continue;
      const arr = m.get(r.tag) ?? [];
      arr.push(r);
      m.set(r.tag, arr);
    }
    return new Map(
      [...m.entries()]
        .filter(([, rows]) => rows.length >= 5)
        .sort((a, b) => b[1].length - a[1].length),
    );
  }, [data]);

  const tag = selected ?? [...byTag.keys()][0] ?? null;
  const analysis = useMemo(
    () => (tag ? analyzeUnit(byTag.get(tag) ?? []) : null),
    [byTag, tag],
  );

  if (loading) return <LoadingState label="Loading corrective history" />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;
  if (byTag.size === 0)
    return (
      <EmptyState message="Reliability analytics needs at least 5 completed corrective work orders on an asset." />
    );

  return (
    <section aria-labelledby="rel-analytics-heading" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2
            id="rel-analytics-heading"
            className="flex items-center gap-2 text-lg font-semibold text-white"
          >
            <Activity className="h-5 w-5 text-signal-cyan" aria-hidden />
            Reliability Analytics — validated engine
          </h2>
          <p className="mt-1 text-sm text-slate-300">
            Weibull (censored MLE), Crow-AMSAA growth, and failure-mode Pareto
            computed deterministically from coded work-order history —
            unit-tested code, no generative math.
          </p>
        </div>
        <select
          aria-label="Select asset"
          value={tag ?? ""}
          onChange={(e) => setSelected(e.target.value)}
          className="rounded-lg border border-overlook-rule bg-overlook-void/60 px-3 py-2 text-sm text-overlook-paper focus:border-signal-cyan/70 focus:outline-hidden"
        >
          {[...byTag.keys()].map((t) => (
            <option key={t} value={t}>
              {t} ({byTag.get(t)?.length} corrective WOs)
            </option>
          ))}
        </select>
      </div>

      {analysis && (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-xl border border-white/6 bg-overlook-deep/40 p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Repairable summary
            </h3>
            {analysis.summary ? (
              <dl className="mt-2 space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <dt className="text-slate-400">MTBF</dt>
                  <dd className="font-mono text-slate-200">
                    {analysis.summary.mtbfHours.toFixed(1)} h
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-400">MTTR</dt>
                  <dd className="font-mono text-slate-200">
                    {analysis.summary.mttrHours.toFixed(1)} h
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-400">Availability</dt>
                  <dd className="font-mono text-slate-200">
                    {(analysis.summary.availability * 100).toFixed(1)}%
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-400">Failures / window</dt>
                  <dd className="font-mono text-slate-200">
                    {analysis.summary.failures} /{" "}
                    {Math.round(analysis.windowHours)} h
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="mt-2 text-sm text-slate-400">Insufficient data.</p>
            )}
          </div>

          <div className="rounded-xl border border-white/6 bg-overlook-deep/40 p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Crow-AMSAA (NHPP power law)
            </h3>
            {analysis.crow ? (
              <dl className="mt-2 space-y-1.5 text-sm">
                <div className="flex items-center justify-between">
                  <dt className="text-slate-400">Growth β</dt>
                  <dd className="flex items-center gap-2 font-mono text-slate-200">
                    {analysis.crow.beta.toFixed(3)}
                    <TrendBadge beta={analysis.crow.beta} />
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-400">Instantaneous MTBF</dt>
                  <dd className="font-mono text-slate-200">
                    {analysis.crow.instantaneousMtbf.toFixed(1)} h
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-400">Cumulative MTBF</dt>
                  <dd className="font-mono text-slate-200">
                    {analysis.crow.cumulativeMtbf.toFixed(1)} h
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="mt-2 text-sm text-slate-400">
                Needs ≥3 dated failures — not fitted.
              </p>
            )}
          </div>

          <div className="rounded-xl border border-white/6 bg-overlook-deep/40 p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Weibull (inter-arrival, MLE)
            </h3>
            {analysis.weibull ? (
              <dl className="mt-2 space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <dt className="text-slate-400">Shape β</dt>
                  <dd className="font-mono text-slate-200">
                    {analysis.weibull.beta.toFixed(3)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-400">Characteristic life η</dt>
                  <dd className="font-mono text-slate-200">
                    {analysis.weibull.eta.toFixed(1)} h
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-400">Converged</dt>
                  <dd className="font-mono text-slate-200">
                    {analysis.weibull.converged ? "yes" : "no"}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="mt-2 text-sm text-slate-400">Not fitted.</p>
            )}
            <p className="mt-2 text-xs text-slate-500">
              {analysis.weibullNote}
            </p>
          </div>

          <div className="rounded-xl border border-white/6 bg-overlook-deep/40 p-4 lg:col-span-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Failure-mode Pareto (downtime hours)
            </h3>
            <ul className="mt-2 space-y-1.5">
              {analysis.topModes.map((m) => (
                <li key={String(m.key)} className="flex items-center gap-3">
                  <span className="w-44 truncate text-sm text-slate-300">
                    {String(m.key)}
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/5">
                    <div
                      className="h-full rounded-full bg-signal-gold/70"
                      style={{
                        width: `${Math.max(2, (m.value / analysis.topModes[0].value) * 100)}%`,
                      }}
                    />
                  </div>
                  <span className="w-16 text-right font-mono text-xs text-slate-400">
                    {m.value.toFixed(0)} h
                  </span>
                  <span className="w-14 text-right font-mono text-xs text-slate-500">
                    {(m.cumulativeShare * 100).toFixed(0)}% cum
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}
