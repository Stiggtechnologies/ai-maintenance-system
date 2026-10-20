/**
 * ModellingStudio — the analyses that answer "what if"
 * (capability register C7.02 RBD, C7.05 Monte Carlo, C7.10 fault/event trees,
 *  C7.12 cost forecasting, C7.13 shutdown critical path).
 *
 * Every figure on this page is produced by a pure engine in src/lib/modelling
 * that was validated against a closed-form answer. Trusted inputs are read and
 * kernels execute inside calculation-service; the browser receives the result
 * together with immutable run identities and performs no trusted calculation.
 *
 * The panel shows refusals as prominently as results. A fault tree with one
 * unassessed basic event shows its cut sets and NO top-event probability; a
 * simulation missing a fitted distribution for any unit produces nothing at
 * all. Both are correct, and a page that only ever displayed numbers would be
 * hiding the more useful half of what these engines know.
 */
import {
  Activity,
  AlertTriangle,
  Boxes,
  CalendarClock,
  Info,
  TrendingUp,
} from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import {
  runModellingStudio,
  type ModellingStudioResult,
} from "../services/modellingStudioService";
import { LoadingState, ErrorState } from "./ui/AsyncStates";

export function ModellingStudio() {
  const { data, loading, error, refetch } = useAsyncData<ModellingStudioResult>(
    runModellingStudio,
    [],
  );

  if (loading) return <LoadingState label="Loading modelling studio" />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;
  if (!data)
    return (
      <ErrorState
        message="The calculation service returned no modelling result."
        onRetry={refetch}
      />
    );

  const treeAnalyses = data.trees;
  const scheduleAnalyses = data.schedules;
  const forecast = data.forecast;
  const simulation = data.simulation;
  const rbd = data.rbd;

  return (
    <section aria-labelledby="modelling-heading" className="space-y-4">
      <div>
        <h2
          id="modelling-heading"
          className="flex items-center gap-2 text-lg font-semibold text-white"
        >
          <Activity className="h-5 w-5 text-signal-cyan" aria-hidden />
          Modelling Studio
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-300">
          Every result is computed from tenant-filtered canonical evidence by
          the authenticated calculation service, then written to the immutable
          calculation ledger. Simulations are seeded so the same question gives
          the same number twice.
        </p>
        <p className="mt-1 text-xs text-slate-500">{data.governance.note}</p>
      </div>

      {/* Fault trees. */}
      {treeAnalyses.length > 0 && (
        <div className="rounded-xl border border-white/6 p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
            <AlertTriangle className="h-4 w-4 text-amber-400" aria-hidden />
            Fault trees
          </h3>
          <ul className="mt-2 space-y-3">
            {treeAnalyses.map((tree) => (
              <li key={tree.treeKey} className="text-sm">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-slate-200">{tree.title}</span>
                  <span className="text-xs text-slate-500">
                    {tree.topEvent}
                  </span>
                  {tree.result.singlePointsOfFailure.length > 0 && (
                    <span className="rounded bg-rose-500/10 px-1.5 py-0.5 text-xs uppercase tracking-wide text-rose-300">
                      {tree.result.singlePointsOfFailure.length} single point
                      {tree.result.singlePointsOfFailure.length === 1
                        ? ""
                        : "s"}{" "}
                      of failure
                    </span>
                  )}
                  {tree.result.computable ? (
                    <span className="font-mono text-xs text-signal-cyan">
                      P(top) ={" "}
                      {tree.result.topEventProbability!.toExponential(2)}
                    </span>
                  ) : (
                    <span className="rounded bg-white/5 px-1.5 py-0.5 text-xs text-slate-400">
                      no probability —{" "}
                      {tree.result.basicEventsMissingProbability.length}{" "}
                      unassessed event
                      {tree.result.basicEventsMissingProbability.length === 1
                        ? ""
                        : "s"}
                    </span>
                  )}
                  <span className="break-all font-mono text-[10px] text-slate-600">
                    run{" "}
                    {
                      data.lineage.trees.find(
                        (entry) => entry.subjectId === tree.id,
                      )?.runId
                    }
                  </span>
                </div>
                <p className="text-xs leading-relaxed text-slate-500">
                  {tree.result.reason}
                </p>
                {tree.importance.length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {tree.importance.map((i) => (
                      <li key={i.eventId} className="text-xs text-slate-500">
                        <span className="font-mono text-slate-400">
                          {(i.fussellVesely * 100).toFixed(1)}%
                        </span>{" "}
                        {i.reason}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Shutdown schedule risk. */}
      {scheduleAnalyses.length > 0 && (
        <div className="rounded-xl border border-white/6 p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
            <CalendarClock className="h-4 w-4 text-signal-cyan" aria-hidden />
            Shutdown schedule risk
          </h3>
          <ul className="mt-2 space-y-3">
            {scheduleAnalyses.map((schedule) => (
              <li key={schedule.eventKey} className="text-sm">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-slate-200">{schedule.title}</span>
                  <span className="font-mono text-xs tabular-nums text-slate-400">
                    plan {schedule.result.deterministicDuration.toFixed(0)}h
                  </span>
                  {/* P80 is the commitment percentile a sanction paper is
                      written against (spec I.9/§51). It is shown BESIDE the
                      deterministic figure and comes off the same simulated
                      sample as P90 — never interpolated by a caller. */}
                  {schedule.result.p80 !== null && (
                    <span className="font-mono text-xs tabular-nums text-amber-300">
                      P80 {schedule.result.p80.toFixed(0)}h
                    </span>
                  )}
                  {schedule.result.p90 !== null && (
                    <span className="font-mono text-xs tabular-nums text-amber-300">
                      P90 {schedule.result.p90.toFixed(0)}h
                    </span>
                  )}
                  {schedule.result.probabilityOnPlan !== null && (
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs ${
                        schedule.result.probabilityOnPlan < 0.5
                          ? "bg-rose-500/10 text-rose-300"
                          : "bg-white/5 text-slate-400"
                      }`}
                    >
                      {(schedule.result.probabilityOnPlan * 100).toFixed(0)}% on
                      plan
                    </span>
                  )}
                  <span className="break-all font-mono text-[10px] text-slate-600">
                    run{" "}
                    {
                      data.lineage.schedules.find(
                        (entry) => entry.subjectId === schedule.id,
                      )?.runId
                    }
                  </span>
                </div>
                <p className="text-xs leading-relaxed text-slate-500">
                  {schedule.result.reason}
                </p>
                {/* Every task, not only those over the hidden-risk threshold.
                    Showing just the flagged ones makes a task at 19% invisible,
                    and 19% is exactly the number worth arguing about. */}
                {schedule.result.criticality.length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {schedule.result.criticality.map((c) => (
                      <li
                        key={c.id}
                        className={`text-xs ${
                          schedule.result.hiddenRisks.some((h) => h.id === c.id)
                            ? "text-amber-200/80"
                            : "text-slate-500"
                        }`}
                      >
                        <span className="font-mono tabular-nums">
                          {(c.criticalityIndex * 100).toFixed(0)}%
                        </span>{" "}
                        <span className="text-slate-400">{c.label}</span> —{" "}
                        {c.reason}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Reliability block diagram. */}
      {rbd && (
        <div className="rounded-xl border border-white/6 p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
            <Boxes className="h-4 w-4 text-signal-cyan" aria-hidden />
            Reliability block diagram
            <span className="text-xs font-normal text-slate-500">
              compiled from the recorded dependency graph, {rbd.blockCount}{" "}
              block{rbd.blockCount === 1 ? "" : "s"}
            </span>
            <span className="break-all font-mono text-[10px] font-normal text-slate-600">
              run {data.lineage.rbdRunId}
            </span>
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">
            {rbd.result.reason}
          </p>
          {rbd.importance.length > 0 && (
            <ul className="mt-1.5 space-y-0.5">
              {rbd.importance.map((i) => (
                <li key={i.blockId} className="text-xs text-slate-500">
                  <span className="font-mono text-slate-400">
                    {i.birnbaum.toFixed(4)}
                  </span>{" "}
                  {i.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Monte Carlo. */}
      <div className="rounded-xl border border-white/6 p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
          <Activity className="h-4 w-4 text-signal-cyan" aria-hidden />
          Monte Carlo availability simulation
          <span className="break-all font-mono text-[10px] font-normal text-slate-600">
            run {data.lineage.simulationRunId}
          </span>
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-slate-400">
          {simulation.reason}
        </p>
        {simulation.simulable && (
          <div className="mt-2 flex flex-wrap gap-4 text-xs text-slate-500">
            <span>
              P10{" "}
              <span className="font-mono text-slate-300 tabular-nums">
                {(simulation.productionP10! * 100).toFixed(1)}%
              </span>
            </span>
            <span>
              P50{" "}
              <span className="font-mono text-signal-cyan tabular-nums">
                {(simulation.productionP50! * 100).toFixed(1)}%
              </span>
            </span>
            <span>
              P90{" "}
              <span className="font-mono text-slate-300 tabular-nums">
                {(simulation.productionP90! * 100).toFixed(1)}%
              </span>
            </span>
            <span>
              seed{" "}
              <span className="font-mono text-slate-400">
                {simulation.seed}
              </span>
            </span>
          </div>
        )}
      </div>

      {/* Cost forecast — posture first, because it bounds the numbers. */}
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
          <TrendingUp className="h-4 w-4 text-amber-400" aria-hidden />
          Maintenance-cost forecast
          <span className="break-all font-mono text-[10px] font-normal text-slate-600">
            run {data.lineage.forecastRunId}
          </span>
        </h3>
        {data.posture && typeof data.posture.basis === "string" && (
          <p className="mt-1 flex items-start gap-2 text-xs leading-relaxed text-amber-100/90">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            {data.posture.basis}
          </p>
        )}
        <p className="mt-2 text-xs leading-relaxed text-slate-400">
          {forecast.reason}
        </p>
        {forecast.forecastable && (
          <div className="mt-2 flex flex-wrap gap-4 text-xs text-slate-500">
            <span>
              planned{" "}
              <span className="font-mono text-slate-300 tabular-nums">
                {forecast.plannedForecast!.toLocaleString(undefined, {
                  maximumFractionDigits: 0,
                })}
              </span>
            </span>
            <span>
              unplanned P50{" "}
              <span className="font-mono text-slate-300 tabular-nums">
                {forecast.unplannedP50!.toLocaleString(undefined, {
                  maximumFractionDigits: 0,
                })}
              </span>
            </span>
            <span>
              combined P90{" "}
              <span className="font-mono text-amber-300 tabular-nums">
                {forecast.combinedP90!.toLocaleString(undefined, {
                  maximumFractionDigits: 0,
                })}
              </span>
            </span>
          </div>
        )}
      </div>
    </section>
  );
}
