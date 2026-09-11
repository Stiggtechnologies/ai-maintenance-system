import { ShieldCheck, TimerReset, TriangleAlert } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import { supabase } from "../lib/supabase";
import { EmptyState, ErrorState, LoadingState } from "./ui/AsyncStates";

interface EliminationMetric {
  available: boolean;
  targetedAssetMechanisms: number;
  eliminatedAssetMechanisms: number;
  recurrentAssetMechanisms: number;
  observingAssetMechanisms: number;
  uncodedVerificationsExcluded: number;
  eliminationRatePct: number | null;
  unit: string;
  basis: string;
}

async function loadEliminationMetric(): Promise<EliminationMetric> {
  const { data, error } = await supabase.rpc(
    "get_failure_mode_elimination_rate",
  );
  if (error) throw new Error(error.message);
  const metric = data as EliminationMetric & { error?: string };
  if (metric.error) throw new Error(metric.error);
  return metric;
}

export function FailureModeElimination() {
  const { data, loading, error, refetch } = useAsyncData(
    loadEliminationMetric,
    [],
  );

  if (loading)
    return <LoadingState label="Measuring failure-mode elimination" />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;
  if (!data?.available) {
    return (
      <section aria-labelledby="elimination-heading" className="space-y-3">
        <h2
          id="elimination-heading"
          className="text-lg font-semibold text-white"
        >
          Failure-Mode Elimination
        </h2>
        <EmptyState message="No coded asset–mechanism target has entered corrective-action verification yet. Code the failure mechanism and start its verification before an elimination rate can be measured." />
        {(data?.uncodedVerificationsExcluded ?? 0) > 0 && (
          <p className="text-xs text-signal-gold">
            {data?.uncodedVerificationsExcluded} uncoded verification(s)
            excluded — a raw source label is not treated as a failure mechanism.
          </p>
        )}
      </section>
    );
  }

  return (
    <section
      aria-labelledby="elimination-heading"
      className="rounded-xl border border-white/6 bg-overlook-deep/40 p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            id="elimination-heading"
            className="flex items-center gap-2 text-lg font-semibold text-white"
          >
            <ShieldCheck className="h-5 w-5 text-teal-300" aria-hidden />
            Failure-Mode Elimination
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-300">{data.basis}</p>
        </div>
        <div className="text-right">
          <div className="text-3xl font-semibold tabular-nums text-teal-300">
            {data.eliminationRatePct}%
          </div>
          <div className="text-xs text-slate-500">
            verified elimination rate
          </div>
        </div>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <div className="rounded-lg border border-teal-500/20 bg-teal-500/5 p-3">
          <div className="text-xl font-semibold text-teal-300">
            {data.eliminatedAssetMechanisms}
          </div>
          <div className="text-xs text-slate-400">eliminated</div>
        </div>
        <div className="rounded-lg border border-signal-cyan/20 bg-signal-cyan/5 p-3">
          <div className="flex items-center gap-1.5 text-xl font-semibold text-signal-cyan">
            <TimerReset className="h-4 w-4" aria-hidden />{" "}
            {data.observingAssetMechanisms}
          </div>
          <div className="text-xs text-slate-400">still observing</div>
        </div>
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3">
          <div className="flex items-center gap-1.5 text-xl font-semibold text-red-300">
            <TriangleAlert className="h-4 w-4" aria-hidden />{" "}
            {data.recurrentAssetMechanisms}
          </div>
          <div className="text-xs text-slate-400">recurrent or ineffective</div>
        </div>
      </div>
      <p className="mt-3 text-xs text-slate-500">
        Denominator: {data.targetedAssetMechanisms} {data.unit}.
        {data.uncodedVerificationsExcluded > 0 &&
          ` ${data.uncodedVerificationsExcluded} uncoded verification(s) excluded.`}
      </p>
    </section>
  );
}
