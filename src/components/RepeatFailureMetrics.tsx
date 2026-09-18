import { RotateCcw, TriangleAlert } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import { supabase } from "../lib/supabase";
import { EmptyState, ErrorState, LoadingState } from "./ui/AsyncStates";

interface RepeatEvent {
  workOrderId: string;
  workOrderNumber: string;
  previousWorkOrderNumber: string;
  assetTag: string;
  mechanismName: string;
  completedAt: string;
  gapDays: number;
}

interface RepeatMetric {
  available: boolean;
  recurrenceDays: number;
  codedEvents: number;
  uncodedEventsExcluded: number;
  incompleteCodingProvenanceExcluded: number;
  repeatEvents: number;
  repeatRatePct: number | null;
  repeatAssetMechanismPairs: number;
  reportingWindowSource: string;
  basis: string;
  events: RepeatEvent[];
}

async function loadRepeatMetrics(): Promise<RepeatMetric> {
  const { data, error } = await supabase.rpc("get_repeat_failure_metrics", {
    p_recurrence_days: 90,
  });
  if (error) throw new Error(error.message);
  const metric = data as RepeatMetric & { error?: string };
  if (metric.error) throw new Error(metric.error);
  return metric;
}

export function RepeatFailureMetrics() {
  const { data, loading, error, refetch } = useAsyncData(loadRepeatMetrics, []);
  if (loading) return <LoadingState label="Measuring repeat failures" />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;
  if (!data?.available) {
    return (
      <EmptyState
        message={`Repeat-failure measurement needs completed corrective events with governed human coding. ${data?.uncodedEventsExcluded ?? 0} uncoded and ${data?.incompleteCodingProvenanceExcluded ?? 0} incomplete-provenance event(s) are excluded rather than promoted into the denominator.`}
      />
    );
  }

  return (
    <section aria-labelledby="repeat-failure-heading" className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            id="repeat-failure-heading"
            className="flex items-center gap-2 text-lg font-semibold text-white"
          >
            <RotateCcw className="h-5 w-5 text-signal-gold" aria-hidden />
            Repeat Failures
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-300">{data.basis}</p>
        </div>
        <div className="text-right">
          <div className="text-3xl font-semibold tabular-nums text-signal-gold">
            {data.repeatRatePct}%
          </div>
          <div className="text-xs text-slate-500">
            repeat events / coded events
          </div>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-4">
        <div className="rounded-lg border border-white/8 bg-white/3 p-3">
          <div className="text-xl font-semibold text-white">
            {data.repeatEvents}
          </div>
          <div className="text-xs text-slate-400">repeat events</div>
        </div>
        <div className="rounded-lg border border-white/8 bg-white/3 p-3">
          <div className="text-xl font-semibold text-white">
            {data.repeatAssetMechanismPairs}
          </div>
          <div className="text-xs text-slate-400">
            affected asset–mechanism pairs
          </div>
        </div>
        <div className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-3">
          <div className="text-xl font-semibold text-amber-300">
            {data.uncodedEventsExcluded}
          </div>
          <div className="text-xs text-slate-400">uncoded events excluded</div>
        </div>
        <div className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-3">
          <div className="text-xl font-semibold text-amber-300">
            {data.incompleteCodingProvenanceExcluded}
          </div>
          <div className="text-xs text-slate-400">
            incomplete codings excluded
          </div>
        </div>
      </div>
      {data.events.length > 0 && (
        <ul className="space-y-2">
          {data.events.slice(0, 10).map((event) => (
            <li
              key={event.workOrderId}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-500/15 bg-red-500/5 px-3 py-2 text-sm"
            >
              <span className="flex items-center gap-2 text-slate-200">
                <TriangleAlert className="h-4 w-4 text-red-300" aria-hidden />
                {event.assetTag} · {event.mechanismName}
              </span>
              <span className="text-xs text-slate-400">
                {event.previousWorkOrderNumber} → {event.workOrderNumber} ·{" "}
                {event.gapDays} days
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-slate-500">
        Reporting window: {data.reportingWindowSource}. Recurrence window:{" "}
        {data.recurrenceDays} days.
      </p>
    </section>
  );
}
