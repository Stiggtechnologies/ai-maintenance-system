/**
 * AssetInterdependency — what falls over with what
 * (capability register U2.01–U2.09).
 *
 * The panel leads with COVERAGE, deliberately. Every finding below it is drawn
 * from the dependency graph, and a graph nobody has mapped produces a spotless
 * result that looks exactly like a resilient plant. The coverage line is what
 * tells the two apart, so it goes first and it is not collapsible.
 */
import { useMemo, useState } from "react";
import {
  Share2,
  TriangleAlert,
  ShieldOff,
  ListOrdered,
  Gauge,
  Info,
  Inbox,
} from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import { supabase } from "../lib/supabase";
import {
  singlePointsOfFailure,
  commonCauseExposure,
  restorationOrder,
  capacityGaps,
  propagateLoss,
  type DependencyGraph,
} from "../lib/interdependency";
import { LoadingState, ErrorState } from "./ui/AsyncStates";

interface Coverage {
  total_assets: number;
  assets_with_edges: number;
  coverage_pct: number;
  edge_count: number;
  demo_edges: number;
  unevidenced_edges: number;
  common_cause_groups_defined: number;
  assets_with_service_level: number;
  open_candidates: number;
  basis: string;
}

/** One row per DECISION, not per asset: nineteen trucks on one model number
 *  is a single judgement about a shared design, asked once. */
interface CandidateGroup {
  group_key: string;
  suggested_kind: string | null;
  confidence: string;
  asset_count: number;
  example_assets: string | null;
  basis: string;
}

const EMPTY: DependencyGraph = { nodes: [], edges: [], commonCauseGroups: [] };

export function AssetInterdependency() {
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const { data, loading, error, refetch } = useAsyncData<{
    graph: DependencyGraph;
    coverage: Coverage | null;
    candidates: CandidateGroup[];
  }>(async () => {
    const [g, c, k] = await Promise.all([
      supabase.rpc("get_dependency_graph"),
      supabase.rpc("get_dependency_coverage"),
      supabase.rpc("get_dependency_candidates", { p_limit: 8 }),
    ]);
    if (g.error) throw new Error(g.error.message);
    if (c.error) throw new Error(c.error.message);
    if (k.error) throw new Error(k.error.message);
    return {
      graph: (g.data as DependencyGraph) ?? EMPTY,
      coverage: (c.data as Coverage[])?.[0] ?? null,
      candidates: (k.data as CandidateGroup[]) ?? [],
    };
  }, []);

  const graph = data?.graph ?? EMPTY;
  const coverage = data?.coverage ?? null;
  const candidates = data?.candidates ?? [];

  async function review(key: string, decision: "confirmed" | "rejected") {
    setBusy(key);
    const { data: r, error: e } = await supabase.rpc(
      "review_dependency_candidate_group",
      { p_group_key: key, p_decision: decision },
    );
    setBusy(null);
    setNote(
      e ? e.message : ((r as { detail: string }[])?.[0]?.detail ?? "Recorded."),
    );
    refetch();
  }

  const spof = useMemo(() => singlePointsOfFailure(graph), [graph]);
  const cc = useMemo(() => commonCauseExposure(graph), [graph]);
  const gaps = useMemo(() => capacityGaps(graph), [graph]);
  const cascade = useMemo(
    () => (selected ? propagateLoss(graph, [selected]) : null),
    [graph, selected],
  );
  const restore = useMemo(
    () =>
      cascade
        ? restorationOrder(
            graph,
            cascade.impacted.filter((i) => i.state === "lost").map((i) => i.id),
          )
        : null,
    [graph, cascade],
  );

  if (loading) return <LoadingState label="Loading dependency graph" />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  return (
    <section aria-labelledby="interdep-heading" className="space-y-4">
      <div>
        <h2
          id="interdep-heading"
          className="flex items-center gap-2 text-lg font-semibold text-white"
        >
          <Share2 className="h-5 w-5 text-signal-cyan" aria-hidden />
          Asset Interdependency
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-300">
          A criticality rating given to an asset on its own is usually wrong.
          This is what changes when you account for what stops with it.
        </p>
      </div>

      {/* Coverage first. Everything below is only as good as this line. */}
      {coverage && (
        <div
          className={`flex items-start gap-2 rounded-xl border p-4 text-sm ${
            coverage.edge_count === 0
              ? "border-amber-500/30 bg-amber-500/5 text-amber-200"
              : "border-white/6 bg-white/2 text-slate-300"
          }`}
        >
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <div>
            <p>{coverage.basis}</p>
            <p className="mt-1 text-xs text-slate-500">
              {coverage.assets_with_edges} of {coverage.total_assets} assets
              mapped · {coverage.common_cause_groups_defined} common-cause
              group(s) · {coverage.assets_with_service_level} with a declared
              service level · {coverage.open_candidates} candidate(s) awaiting
              review.
            </p>
          </div>
        </div>
      )}

      {/* The headline: redundancy that a shared cause defeats. */}
      <div className="rounded-xl border border-white/6 p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
          <ShieldOff className="h-4 w-4 text-amber-400" aria-hidden />
          Redundancy defeated by common cause
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-slate-400">
          {cc.reason}
        </p>
        {cc.defeatedRedundancies.length > 0 && (
          <ul className="mt-3 space-y-2">
            {cc.defeatedRedundancies.map((d, i) => (
              <li
                key={i}
                className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-sm"
              >
                <span className="font-medium text-white">
                  {d.dependentName}
                </span>
                <span className="text-slate-400"> — {d.reason}</span>
                <div className="mt-1 font-mono text-xs text-slate-500">
                  {d.members.join(" · ")}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Single points of failure. */}
      <div className="rounded-xl border border-white/6 p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
          <TriangleAlert className="h-4 w-4 text-signal-cyan" aria-hidden />
          Single points of failure
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-slate-400">
          {spof.reason}
        </p>
        {spof.points.length > 0 && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[38rem] text-left text-sm">
              <caption className="sr-only">
                Assets whose loss propagates beyond themselves
              </caption>
              <thead className="text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Asset
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Rated
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Also lost
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Degraded
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    Services stranded
                  </th>
                </tr>
              </thead>
              <tbody>
                {spof.points.slice(0, 15).map((p) => (
                  <tr
                    key={p.id}
                    className="cursor-pointer border-t border-white/6 hover:bg-white/2"
                    onClick={() => setSelected(p.id)}
                  >
                    <td className="py-2 pr-4 text-slate-200">
                      <button
                        type="button"
                        className="text-left hover:text-signal-cyan"
                        aria-label={`Trace the cascade from ${p.name}`}
                      >
                        {p.name}
                      </button>
                    </td>
                    <td className="py-2 pr-4">
                      <span
                        className={
                          p.underrated ? "text-amber-300" : "text-slate-400"
                        }
                      >
                        {p.criticality ?? "—"}
                        {p.underrated && " ⚠"}
                      </span>
                    </td>
                    <td className="py-2 pr-4 font-mono tabular-nums text-slate-300">
                      {p.assetsLost}
                    </td>
                    <td className="py-2 pr-4 font-mono tabular-nums text-slate-400">
                      {p.assetsDegraded}
                    </td>
                    <td className="py-2 text-slate-400">
                      {p.servicesLost.join(", ") || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Trace + restoration for the selected asset. */}
      {cascade && restore && (
        <div className="rounded-xl border border-signal-cyan/20 bg-signal-cyan/5 p-4">
          <div className="flex items-start justify-between gap-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
              <ListOrdered className="h-4 w-4 text-signal-cyan" aria-hidden />
              Losing{" "}
              {cascade.impacted.find((i) => i.id === selected)?.name ??
                selected}
            </h3>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="text-xs text-slate-400 hover:text-slate-200"
            >
              Clear
            </button>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">
            {cascade.reason}
          </p>
          <ul className="mt-3 space-y-1 text-sm">
            {cascade.impacted.map((i) => (
              <li key={i.id} className="flex flex-wrap items-baseline gap-2">
                <span
                  className={
                    i.state === "lost" ? "text-rose-300" : "text-amber-300"
                  }
                >
                  {i.state === "lost" ? "lost" : `${i.capacityPct}%`}
                </span>
                <span className="text-slate-200">{i.name}</span>
                <span className="text-xs text-slate-500">— {i.cause}</span>
              </li>
            ))}
          </ul>
          <h4 className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Restoration order
          </h4>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            {restore.reason}
          </p>
          {restore.steps.length > 0 && (
            <ol className="mt-2 space-y-1 text-sm">
              {restore.steps.map((s) => (
                <li key={s.id} className="flex flex-wrap items-baseline gap-2">
                  <span className="font-mono text-xs text-signal-cyan tabular-nums">
                    {s.order}.
                  </span>
                  <span className="text-slate-200">{s.name}</span>
                  <span className="text-xs text-slate-500">— {s.reason}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {/* The review queue. Derived proposals only — nothing here has entered
          the graph, and confirming a co-location or shared-model candidate
          creates a COMMON-CAUSE membership rather than a dependency. */}
      {candidates.length > 0 && (
        <div className="rounded-xl border border-white/6 p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
            <Inbox className="h-4 w-4 text-slate-400" aria-hidden />
            Derived candidates awaiting review
            <span className="text-xs font-normal text-slate-500">
              {coverage?.open_candidates ?? candidates.length} open
            </span>
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">
            Proposed from co-location and shared make/model in the asset
            register. Neither is evidence of a functional dependency, so
            confirming one records a <em>common cause</em> — the thing that
            makes redundancy fail together. Functional edges have to come from a
            P&amp;ID, a single-line diagram or someone who knows the plant.
          </p>
          {note && (
            <p className="mt-2 rounded-lg border border-signal-cyan/20 bg-signal-cyan/5 p-2 text-xs text-signal-cyan">
              {note}
            </p>
          )}
          <ul className="mt-3 space-y-2">
            {candidates.map((c) => (
              <li
                key={c.group_key}
                className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-white/6 p-3 text-sm"
              >
                <div className="min-w-[16rem] flex-1">
                  <span
                    className="block truncate text-slate-200"
                    title={c.group_key}
                  >
                    {c.group_key}
                  </span>
                  <span className="ml-2 text-xs text-slate-500">
                    {c.asset_count} asset{c.asset_count === 1 ? "" : "s"}
                  </span>
                  <p className="mt-0.5 text-xs text-slate-500">{c.basis}</p>
                  {c.example_assets && (
                    <p
                      className="mt-0.5 truncate font-mono text-xs text-slate-600"
                      title={c.example_assets}
                    >
                      {c.example_assets}
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busy === c.group_key}
                    onClick={() => review(c.group_key, "confirmed")}
                    className="rounded border border-signal-cyan/40 px-2 py-1 text-xs text-signal-cyan hover:bg-signal-cyan/10 disabled:opacity-50"
                  >
                    Confirm all {c.asset_count}
                  </button>
                  <button
                    type="button"
                    disabled={busy === c.group_key}
                    onClick={() => review(c.group_key, "rejected")}
                    className="rounded border border-white/10 px-2 py-1 text-xs text-slate-400 hover:bg-white/5 disabled:opacity-50"
                  >
                    Reject
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Modelling gaps. */}
      {gaps.length > 0 && (
        <div className="rounded-xl border border-white/6 p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
            <Gauge className="h-4 w-4 text-slate-400" aria-hidden />
            Capacity shares that do not add up
          </h3>
          <ul className="mt-2 space-y-1 text-xs text-slate-400">
            {gaps.slice(0, 10).map((g, i) => (
              <li key={i}>
                <span className="text-slate-200">{g.name}</span> — {g.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
