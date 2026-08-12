/**
 * LifecycleStages — where each asset is in its whole life, and how it got there
 * (capability register U4.01–U4.07, U4.10–U4.14).
 *
 * The headline number is not how many assets carry a stage. It is how many
 * reached that stage through a recorded gate. An asset register where every
 * row has a stage and none was gated describes where things are, not how they
 * got there, and the panel leads with that distinction rather than burying it.
 */
import { useMemo } from "react";
import { Route, Info, CircleCheck, CircleDashed } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import { supabase } from "../lib/supabase";
import { wholeLifeCoverage, type StageRef } from "../lib/lifecycle/stages";
import { LoadingState, ErrorState } from "./ui/AsyncStates";

interface Coverage {
  assets_total: number;
  assets_staged: number;
  assets_inherited: number;
  assets_with_any_pre_service_record: number;
  gate_reviews_total: number;
  criteria_defined: number;
  open_restoration_obligations: number;
  basis: string;
}

interface DistributionRow {
  stage_key: string;
  label: string;
  phase: "pre_service" | "in_service" | "end_of_life";
  stage_order: number;
  decision_owned: string;
  asset_count: number;
  gated_count: number;
}

const PHASE_LABEL: Record<string, string> = {
  pre_service: "Before service — where most of the whole-life cost is decided",
  in_service: "In service — concurrent, not sequential",
  end_of_life: "End of life",
};

export function LifecycleStages() {
  const { data, loading, error, refetch } = useAsyncData<{
    coverage: Coverage | null;
    distribution: DistributionRow[];
  }>(async () => {
    const [c, d] = await Promise.all([
      supabase.rpc("get_lifecycle_coverage"),
      supabase.rpc("get_lifecycle_distribution"),
    ]);
    if (c.error) throw new Error(c.error.message);
    if (d.error) throw new Error(d.error.message);
    return {
      coverage: (c.data as Coverage[])?.[0] ?? null,
      distribution: (d.data as DistributionRow[]) ?? [],
    };
  }, []);

  const rows = useMemo(() => data?.distribution ?? [], [data]);

  const summary = useMemo(() => {
    const stages: StageRef[] = rows.map((r) => ({
      stageKey: r.stage_key,
      label: r.label,
      phase: r.phase,
      stageOrder: r.stage_order,
    }));
    return wholeLifeCoverage(
      stages,
      rows.map((r) => ({
        stageKey: r.stage_key,
        assetCount: r.asset_count,
        gatedCount: r.gated_count,
      })),
    );
  }, [rows]);

  if (loading) return <LoadingState label="Loading lifecycle stages" />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  const coverage = data?.coverage ?? null;
  const phases: DistributionRow["phase"][] = [
    "pre_service",
    "in_service",
    "end_of_life",
  ];

  return (
    <section aria-labelledby="lifecycle-heading" className="space-y-4">
      <div>
        <h2
          id="lifecycle-heading"
          className="flex items-center gap-2 text-lg font-semibold text-white"
        >
          <Route className="h-5 w-5 text-signal-cyan" aria-hidden />
          Whole-Life Stages
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-300">
          Most of what an asset costs over its life is decided before anyone
          turns it on.
        </p>
      </div>

      {coverage && (
        <div className="flex items-start gap-2 rounded-xl border border-white/6 bg-white/2 p-4 text-sm text-slate-300">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <div>
            <p>{coverage.basis}</p>
            <p className="mt-2 text-xs leading-relaxed text-slate-500">
              {summary.reason}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {coverage.criteria_defined} gate criteria defined ·{" "}
              {coverage.gate_reviews_total} gate review(s) recorded
              {coverage.open_restoration_obligations > 0 &&
                ` · ${coverage.open_restoration_obligations} open site-restoration obligation(s)`}
              .
            </p>
          </div>
        </div>
      )}

      {phases.map((phase) => {
        const inPhase = rows.filter((r) => r.phase === phase);
        if (inPhase.length === 0) return null;
        return (
          <div key={phase} className="rounded-xl border border-white/6 p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              {PHASE_LABEL[phase]}
            </h3>
            <ul className="mt-2 space-y-2">
              {inPhase.map((r) => (
                <li key={r.stage_key} className="flex items-start gap-3">
                  <span className="mt-0.5 shrink-0">
                    {r.asset_count > 0 ? (
                      <CircleCheck
                        className="h-4 w-4 text-signal-cyan"
                        aria-hidden
                      />
                    ) : (
                      <CircleDashed
                        className="h-4 w-4 text-slate-600"
                        aria-hidden
                      />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span
                        className={
                          r.asset_count > 0
                            ? "text-slate-200"
                            : "text-slate-500"
                        }
                      >
                        {r.label}
                      </span>
                      {r.asset_count > 0 && (
                        <span className="font-mono text-xs text-slate-400 tabular-nums">
                          {r.asset_count} asset{r.asset_count === 1 ? "" : "s"}
                          {r.gated_count === 0
                            ? " · none gated"
                            : ` · ${r.gated_count} gated`}
                        </span>
                      )}
                    </div>
                    <p className="text-xs leading-relaxed text-slate-500">
                      {r.decision_owned}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}
