/**
 * ResiliencePanel — what a threat actually stops
 * (capability register E11.01–E11.12).
 *
 * The cascade is not recomputed here. Each scenario is run through the same
 * `propagateLoss` the interdependency panel uses, via `assessScenario`, so
 * there is one engine and one set of tests behind both.
 *
 * The number the panel is careful about is the impact figure. Where a
 * directly affected asset has no recorded dependencies, nothing downstream of
 * it was counted, and the panel labels the result a FLOOR rather than an
 * estimate. A resilience number that quietly excludes half the plant is worse
 * than none.
 */
import { useMemo } from "react";
import { ShieldHalf, Info, Siren, Layers } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import { supabase } from "../lib/supabase";
import {
  assessScenario,
  exerciseStatus,
  assessOperatingModes,
  type Scenario,
  type OperatingMode,
} from "../lib/resilience";
import type { DependencyGraph } from "../lib/interdependency";
import { LoadingState, ErrorState } from "./ui/AsyncStates";

interface Posture {
  scenarios_total: number;
  threat_kinds_covered: number;
  scenarios_never_exercised: number;
  modes_fully_specified: number;
  current_mode: string;
  basis: string;
}

const EMPTY_GRAPH: DependencyGraph = {
  nodes: [],
  edges: [],
  commonCauseGroups: [],
};

export function ResiliencePanel() {
  const { data, loading, error, refetch } = useAsyncData<{
    posture: Posture | null;
    scenarios: Scenario[];
    modes: OperatingMode[];
    graph: DependencyGraph;
  }>(async () => {
    const [p, s, m, g] = await Promise.all([
      supabase.rpc("get_resilience_posture"),
      supabase.rpc("get_threat_scenarios"),
      supabase.rpc("get_operating_modes"),
      supabase.rpc("get_dependency_graph"),
    ]);
    if (p.error) throw new Error(p.error.message);
    if (s.error) throw new Error(s.error.message);
    if (m.error) throw new Error(m.error.message);
    if (g.error) throw new Error(g.error.message);
    return {
      posture: (p.data as Posture[])?.[0] ?? null,
      scenarios: (s.data as Scenario[]) ?? [],
      modes: (m.data as OperatingMode[]) ?? [],
      graph: (g.data as DependencyGraph) ?? EMPTY_GRAPH,
    };
  }, []);

  const assessments = useMemo(() => {
    const graph = data?.graph ?? EMPTY_GRAPH;
    const now = new Date();
    return (data?.scenarios ?? []).map((s) => ({
      scenario: s,
      impact: assessScenario(s, graph),
      exercise: exerciseStatus(s, now),
    }));
  }, [data]);

  const modeReadiness = useMemo(
    () => assessOperatingModes(data?.modes ?? []),
    [data],
  );

  if (loading) return <LoadingState label="Loading resilience posture" />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  const posture = data?.posture ?? null;

  return (
    <section aria-labelledby="resilience-heading" className="space-y-4">
      <div>
        <h2
          id="resilience-heading"
          className="flex items-center gap-2 text-lg font-semibold text-white"
        >
          <ShieldHalf className="h-5 w-5 text-signal-cyan" aria-hidden />
          Enterprise Resilience
          {posture && (
            <span className="rounded bg-white/5 px-2 py-0.5 text-xs font-normal uppercase tracking-wide text-slate-400">
              mode: {posture.current_mode}
            </span>
          )}
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-300">
          A threat is only as computable as the dependency graph beneath it.
        </p>
      </div>

      {posture && (
        <div className="flex items-start gap-2 rounded-xl border border-white/6 bg-white/2 p-4 text-sm text-slate-300">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>{posture.basis}</p>
        </div>
      )}

      {/* Scenarios. */}
      {assessments.length > 0 && (
        <div className="rounded-xl border border-white/6 p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
            <Siren className="h-4 w-4 text-amber-400" aria-hidden />
            Threat scenarios
          </h3>
          <ul className="mt-3 space-y-3">
            {assessments.map(({ scenario, impact, exercise }) => (
              <li
                key={scenario.scenarioKey}
                className={`rounded-lg border p-3 text-sm ${
                  impact.boundedEstimate
                    ? "border-white/6"
                    : "border-amber-500/20 bg-amber-500/5"
                }`}
              >
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-slate-100">{scenario.title}</span>
                  <span className="rounded bg-white/5 px-1.5 py-0.5 text-xs uppercase tracking-wide text-slate-400">
                    {scenario.threatKind.replace(/_/g, " ")}
                  </span>
                  {impact.totalLost > 0 && (
                    <span
                      className={`font-mono text-xs ${impact.boundedEstimate ? "text-slate-300" : "text-amber-300"}`}
                    >
                      {impact.totalLost} asset(s) lost
                      {!impact.boundedEstimate && " (floor)"}
                    </span>
                  )}
                  {impact.servicesLost.length > 0 && (
                    <span className="rounded bg-rose-500/10 px-1.5 py-0.5 text-xs text-rose-300">
                      {impact.servicesLost.join(", ")}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs leading-relaxed text-slate-400">
                  {impact.reason}
                </p>
                <p
                  className={`mt-1 text-xs leading-relaxed ${exercise.stale ? "text-amber-300/80" : "text-slate-500"}`}
                >
                  {exercise.reason}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Operating modes. */}
      <div className="rounded-xl border border-white/6 p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
          <Layers className="h-4 w-4 text-signal-cyan" aria-hidden />
          Operating modes
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-slate-400">
          {modeReadiness.reason}
        </p>
        {(data?.modes.length ?? 0) > 0 && (
          <ul className="mt-3 space-y-2">
            {(data?.modes ?? []).map((m) => {
              const gap = modeReadiness.gaps.find((g) => g.mode === m.mode);
              return (
                <li key={m.mode} className="text-sm">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="uppercase tracking-wide text-slate-200">
                      {m.mode}
                    </span>
                    {gap ? (
                      <span className="text-xs text-amber-300">
                        missing {gap.missing.join(", ")}
                      </span>
                    ) : (
                      <span className="text-xs text-signal-cyan">
                        fully specified
                      </span>
                    )}
                    {m.declaredByRole && (
                      <span className="text-xs text-slate-500">
                        declared by {m.declaredByRole}
                      </span>
                    )}
                  </div>
                  {m.authorityChanges && (
                    <p className="text-xs leading-relaxed text-slate-500">
                      {m.authorityChanges}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
