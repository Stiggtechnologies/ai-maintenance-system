/**
 * ModellingStudio — the analyses that answer "what if"
 * (capability register C7.02 RBD, C7.05 Monte Carlo, C7.10 fault/event trees,
 *  C7.12 cost forecasting, C7.13 shutdown critical path).
 *
 * Every figure on this page is produced by a pure engine in src/lib/modelling
 * that was validated against a closed-form answer. Nothing here is fitted in
 * the browser except the Weibull distributions, which come from the same MLE
 * the reliability page uses.
 *
 * The panel shows refusals as prominently as results. A fault tree with one
 * unassessed basic event shows its cut sets and NO top-event probability; a
 * simulation missing a fitted distribution for any unit produces nothing at
 * all. Both are correct, and a page that only ever displayed numbers would be
 * hiding the more useful half of what these engines know.
 */
import { useMemo } from "react";
import {
  Activity,
  AlertTriangle,
  Boxes,
  CalendarClock,
  Info,
  TrendingUp,
} from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import { supabase } from "../lib/supabase";
import { repairableSummary, weibullMLE } from "../lib/reliability";
import {
  evaluateRbd,
  blockImportance,
  type RbdBlock,
  type RbdGroupSpec,
} from "../lib/modelling/rbd";
import {
  analyseFaultTree,
  eventImportance,
  type FaultTreeNode,
} from "../lib/modelling/fault-tree";
import { simulateProduction, type SimUnit } from "../lib/modelling/monte-carlo";
import {
  scheduleRisk,
  type ScheduleTask,
} from "../lib/modelling/schedule-risk";
import {
  forecastMaintenanceCost,
  type CostPeriod,
} from "../lib/modelling/cost-forecast";
import { LoadingState, ErrorState } from "./ui/AsyncStates";

interface TreeRow {
  treeKey: string;
  title: string;
  topEvent: string;
  basis: string;
  reviewed: boolean;
  nodes: {
    id: string;
    label: string;
    gate: string | null;
    voteThreshold: number | null;
    parent: string | null;
    probability: number | null;
  }[];
}

interface ScheduleRow {
  eventKey: string;
  title: string;
  status: string;
  tasks: {
    id: string;
    label: string;
    duration: number;
    optimistic: number | null;
    pessimistic: number | null;
    predecessors: string[];
  }[];
}

interface CostRow {
  period: string;
  plannedCost: number;
  unplannedCost: number;
  failureCount: number;
}

interface CostPosture {
  workOrdersClosed: number;
  workOrdersWithRecordedCost: number;
  assetsWithEconomics: number;
  assetsTotal: number;
  basis: string;
}

interface WoRow {
  asset_id: string;
  tag: string | null;
  name: string;
  completed_at: string;
  downtime_hours: number;
  work_type: string;
}

/** Same corrective-history query the reliability page uses — one definition. */
async function correctiveHistory(): Promise<WoRow[]> {
  const { data, error } = await supabase
    .from("work_orders")
    .select(
      "asset_id, completed_at, downtime_hours, work_type, assets!inner(tag, name)",
    )
    .eq("work_type", "corrective")
    .not("completed_at", "is", null)
    .order("completed_at");
  if (error) throw new Error(error.message);
  type Raw = {
    asset_id: string;
    completed_at: string;
    downtime_hours: number | null;
    work_type: string;
    assets:
      | { tag: string | null; name: string }
      | { tag: string | null; name: string }[];
  };
  return ((data ?? []) as Raw[]).map((r) => {
    const a = Array.isArray(r.assets) ? r.assets[0] : r.assets;
    return {
      asset_id: r.asset_id,
      tag: a?.tag ?? null,
      name: a?.name ?? "(unnamed)",
      completed_at: r.completed_at,
      downtime_hours: Number(r.downtime_hours ?? 0),
      work_type: r.work_type,
    };
  });
}

/** Fit each asset's life and repair distribution from its own history. */
function fitUnits(rows: WoRow[]): SimUnit[] {
  const byAsset = new Map<string, WoRow[]>();
  for (const r of rows) {
    const list = byAsset.get(r.asset_id);
    if (list) list.push(r);
    else byAsset.set(r.asset_id, [r]);
  }
  return [...byAsset.entries()].map(([id, evts]) => {
    const times = evts
      .map((e) => new Date(e.completed_at).getTime())
      .sort((a, b) => a - b);
    const inter: number[] = [];
    for (let i = 1; i < times.length; i++) {
      const d = (times[i] - times[i - 1]) / 3.6e6;
      if (d > 0.01) inter.push(d);
    }
    let beta: number | null = null;
    let eta: number | null = null;
    try {
      const fit = weibullMLE(inter);
      // A non-converged fit is not a fit. Leaving it null makes the unit
      // refused rather than simulated on a number that never settled.
      if (fit.converged) {
        beta = fit.beta;
        eta = fit.eta;
      }
    } catch {
      // Too few distinct failures — the model is not identifiable. Stays null.
    }
    const downtimes = evts.map((e) => e.downtime_hours).filter((d) => d > 0);
    const median =
      downtimes.length > 0
        ? [...downtimes].sort((a, b) => a - b)[Math.floor(downtimes.length / 2)]
        : null;
    return {
      id,
      label: evts[0].tag ?? evts[0].name,
      beta,
      eta,
      medianRepairHours: median,
      repairSigma: null,
      capacityPerHour: 1,
    };
  });
}

/** Availability per asset, used as the RBD block reliability. */
function availabilityByAsset(rows: WoRow[]): Map<string, number> {
  const byAsset = new Map<string, WoRow[]>();
  for (const r of rows) {
    const list = byAsset.get(r.asset_id);
    if (list) list.push(r);
    else byAsset.set(r.asset_id, [r]);
  }
  const out = new Map<string, number>();
  for (const [id, evts] of byAsset) {
    const times = evts.map((e) => new Date(e.completed_at).getTime());
    const window = Math.max(
      24,
      (Math.max(...times) - Math.min(...times)) / 3.6e6 + 24,
    );
    try {
      out.set(
        id,
        repairableSummary(
          evts.map((e) => e.downtime_hours),
          window,
        ).availability,
      );
    } catch {
      // No availability rather than a default — evaluateRbd refuses on null.
    }
  }
  return out;
}

export function ModellingStudio() {
  const { data, loading, error, refetch } = useAsyncData<{
    trees: TreeRow[];
    schedules: ScheduleRow[];
    cost: CostRow[];
    posture: CostPosture | null;
    graph: unknown;
    history: WoRow[];
  }>(async () => {
    const [t, s, c, p, g, h] = await Promise.all([
      supabase.rpc("get_fault_trees"),
      supabase.rpc("get_shutdown_schedules"),
      supabase.rpc("get_maintenance_cost_history", { p_months: 24 }),
      supabase.rpc("get_cost_capture_posture"),
      supabase.rpc("get_dependency_graph"),
      correctiveHistory(),
    ]);
    for (const r of [t, s, c, p, g]) {
      if (r.error) throw new Error(r.error.message);
    }
    return {
      trees: (t.data as TreeRow[]) ?? [],
      schedules: (s.data as ScheduleRow[]) ?? [],
      cost: ((c.data as CostRow[]) ?? []).map((r) => ({
        ...r,
        plannedCost: Number(r.plannedCost),
        unplannedCost: Number(r.unplannedCost),
        failureCount: Number(r.failureCount),
      })),
      posture: (p.data as CostPosture[])?.[0] ?? null,
      graph: g.data,
      history: h,
    };
  }, []);

  const treeAnalyses = useMemo(
    () =>
      (data?.trees ?? []).map((t) => {
        const nodes: FaultTreeNode[] = t.nodes.map((n) => ({
          id: n.id,
          label: n.label,
          gate: (n.gate as FaultTreeNode["gate"]) ?? undefined,
          voteThreshold: n.voteThreshold ?? undefined,
          children: t.nodes.filter((c) => c.parent === n.id).map((c) => c.id),
          probability:
            n.probability === null || n.probability === undefined
              ? null
              : Number(n.probability),
        }));
        return {
          tree: t,
          result: analyseFaultTree(nodes, "TOP"),
          importance: eventImportance(nodes, "TOP").slice(0, 4),
        };
      }),
    [data],
  );

  const scheduleAnalyses = useMemo(
    () =>
      (data?.schedules ?? []).map((s) => {
        const tasks: ScheduleTask[] = s.tasks.map((t) => ({
          id: t.id,
          label: t.label,
          duration: Number(t.duration),
          optimistic: t.optimistic === null ? null : Number(t.optimistic),
          pessimistic: t.pessimistic === null ? null : Number(t.pessimistic),
          predecessors: t.predecessors ?? [],
        }));
        // Seeded from the event key so the same shutdown always reproduces the
        // same numbers between page loads and between users.
        const seed = [...s.eventKey].reduce((a, ch) => a + ch.charCodeAt(0), 0);
        return { schedule: s, result: scheduleRisk(tasks, 2000, seed) };
      }),
    [data],
  );

  const forecast = useMemo(
    () => forecastMaintenanceCost((data?.cost ?? []) as CostPeriod[], 1),
    [data],
  );

  const simulation = useMemo(() => {
    const units = fitUnits(data?.history ?? []);
    // Capacity is unweighted: the register holds no rated capacity per asset,
    // so every unit contributes 1 and the target is the full fleet. That makes
    // the result FLEET AVAILABILITY. The basis is declared to the engine so it
    // suppresses its capacity commentary — "installed capacity equals target"
    // would be true of the nominal weighting and say nothing about the plant.
    return simulateProduction({
      units,
      horizonHours: 8760,
      iterations: 300,
      seed: 20260824,
      targetCapacityPerHour: Math.max(1, units.length),
      capacityBasis: "unweighted",
    });
  }, [data]);

  const rbd = useMemo(() => {
    const graph = data?.graph as
      | {
          edges?: {
            dependent: string;
            supplier: string;
            redundancyGroup?: string | null;
            minRequired?: number | null;
          }[];
          nodes?: { id: string; tag: string | null; name: string }[];
        }
      | null
      | undefined;
    const edges = graph?.edges ?? [];
    if (edges.length === 0) return null;
    // Labels live on `nodes`, not on the edges. Falling back to a UUID prefix
    // would render eight hex characters where a tag belongs.
    const labelOf = new Map(
      (graph?.nodes ?? []).map((n) => [n.id, n.tag ?? n.name]),
    );
    const avail = availabilityByAsset(data?.history ?? []);
    const seen = new Set<string>();
    const blocks: RbdBlock[] = [];
    const specs = new Map<string, RbdGroupSpec>();
    for (const e of edges) {
      // A supplier with no redundancy group is its own group of one, keyed by
      // the dependent it serves — two ungrouped suppliers of the SAME dependent
      // are separate conjunctive requirements, not parallel alternatives.
      const group = e.redundancyGroup ?? `${e.dependent}:${e.supplier}`;
      if (!specs.has(group)) {
        specs.set(group, { group, minRequired: e.minRequired ?? 1 });
      }
      const key = `${group}|${e.supplier}`;
      if (seen.has(key)) continue;
      seen.add(key);
      blocks.push({
        id: e.supplier,
        label: labelOf.get(e.supplier) ?? e.supplier,
        reliability: avail.get(e.supplier) ?? null,
        group,
      });
    }
    const specList = [...specs.values()];
    return {
      result: evaluateRbd(blocks, specList),
      importance: blockImportance(blocks, specList).slice(0, 4),
      blockCount: blocks.length,
    };
  }, [data]);

  if (loading) return <LoadingState label="Loading modelling studio" />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

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
          Every result here comes from an engine checked against a closed-form
          answer, and every simulation is seeded so the same question gives the
          same number twice.
        </p>
      </div>

      {/* Fault trees. */}
      {treeAnalyses.length > 0 && (
        <div className="rounded-xl border border-white/6 p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
            <AlertTriangle className="h-4 w-4 text-amber-400" aria-hidden />
            Fault trees
          </h3>
          <ul className="mt-2 space-y-3">
            {treeAnalyses.map(({ tree, result, importance }) => (
              <li key={tree.treeKey} className="text-sm">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-slate-200">{tree.title}</span>
                  <span className="text-xs text-slate-500">
                    {tree.topEvent}
                  </span>
                  {result.singlePointsOfFailure.length > 0 && (
                    <span className="rounded bg-rose-500/10 px-1.5 py-0.5 text-xs uppercase tracking-wide text-rose-300">
                      {result.singlePointsOfFailure.length} single point
                      {result.singlePointsOfFailure.length === 1 ? "" : "s"} of
                      failure
                    </span>
                  )}
                  {result.computable ? (
                    <span className="font-mono text-xs text-signal-cyan">
                      P(top) = {result.topEventProbability!.toExponential(2)}
                    </span>
                  ) : (
                    <span className="rounded bg-white/5 px-1.5 py-0.5 text-xs text-slate-400">
                      no probability —{" "}
                      {result.basicEventsMissingProbability.length} unassessed
                      event
                      {result.basicEventsMissingProbability.length === 1
                        ? ""
                        : "s"}
                    </span>
                  )}
                </div>
                <p className="text-xs leading-relaxed text-slate-500">
                  {result.reason}
                </p>
                {importance.length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {importance.map((i) => (
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
            {scheduleAnalyses.map(({ schedule, result }) => (
              <li key={schedule.eventKey} className="text-sm">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-slate-200">{schedule.title}</span>
                  <span className="font-mono text-xs tabular-nums text-slate-400">
                    plan {result.deterministicDuration.toFixed(0)}h
                  </span>
                  {result.p90 !== null && (
                    <span className="font-mono text-xs tabular-nums text-amber-300">
                      P90 {result.p90.toFixed(0)}h
                    </span>
                  )}
                  {result.probabilityOnPlan !== null && (
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs ${
                        result.probabilityOnPlan < 0.5
                          ? "bg-rose-500/10 text-rose-300"
                          : "bg-white/5 text-slate-400"
                      }`}
                    >
                      {(result.probabilityOnPlan * 100).toFixed(0)}% on plan
                    </span>
                  )}
                </div>
                <p className="text-xs leading-relaxed text-slate-500">
                  {result.reason}
                </p>
                {/* Every task, not only those over the hidden-risk threshold.
                    Showing just the flagged ones makes a task at 19% invisible,
                    and 19% is exactly the number worth arguing about. */}
                {result.criticality.length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {result.criticality.map((c) => (
                      <li
                        key={c.id}
                        className={`text-xs ${
                          result.hiddenRisks.some((h) => h.id === c.id)
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
        </h3>
        {data?.posture && (
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
