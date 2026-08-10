/**
 * EnvironmentalPerformance — what maintenance condition costs the environment
 * (capability register E10.01–E10.11).
 *
 * The link this panel exists to make is the one nobody raises a work order
 * for: a fouled exchanger still runs, and burns more fuel for the same duty
 * every hour while it does. The degradation section turns that into a rate and
 * a payback date, which is a maintenance decision rather than a sustainability
 * aspiration.
 *
 * Emissions are shown only where the factor AND its source are recorded.
 * Activity data with no factor is listed as activity data, because an
 * unauditable emissions figure gets reported anyway.
 */
import { useMemo } from "react";
import { Leaf, Info, TrendingUp, FlaskConical } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import { supabase } from "../lib/supabase";
import {
  assessDegradation,
  computeEmissions,
  type EfficiencyReading,
  type EmissionInput,
} from "../lib/environmental";
import { LoadingState, ErrorState } from "./ui/AsyncStates";

interface Posture {
  activities_recorded: number;
  activities_without_factor: number;
  baselines_defined: number;
  hazardous_without_eol_plan: number;
  basis: string;
}

interface BaselineRow {
  assetName: string;
  metric: string;
  unit: string;
  designValue: number;
  basis: string | null;
  interventionCost: number | null;
  energyCostPerDay: number | null;
  readings: EfficiencyReading[];
}

export function EnvironmentalPerformance() {
  const { data, loading, error, refetch } = useAsyncData<{
    posture: Posture | null;
    baselines: BaselineRow[];
    activities: EmissionInput[];
  }>(async () => {
    const [p, b, a] = await Promise.all([
      supabase.rpc("get_environmental_posture"),
      supabase.rpc("get_efficiency_baselines"),
      supabase.rpc("get_environmental_activities", { p_limit: 50 }),
    ]);
    if (p.error) throw new Error(p.error.message);
    if (b.error) throw new Error(b.error.message);
    if (a.error) throw new Error(a.error.message);
    return {
      posture: (p.data as Posture[])?.[0] ?? null,
      baselines: (b.data as BaselineRow[]) ?? [],
      activities: (a.data as EmissionInput[]) ?? [],
    };
  }, []);

  const degradations = useMemo(
    () =>
      (data?.baselines ?? []).map((b) => ({
        baseline: b,
        result: assessDegradation(
          Number(b.designValue),
          (b.readings ?? []).map((r) => ({
            daysSinceBaseline: Number(r.daysSinceBaseline),
            specificEnergy: Number(r.specificEnergy),
          })),
          b.interventionCost !== null ? Number(b.interventionCost) : null,
          b.energyCostPerDay !== null ? Number(b.energyCostPerDay) : null,
        ),
      })),
    [data],
  );

  const emissions = useMemo(
    () =>
      (data?.activities ?? []).map((a) =>
        computeEmissions({
          ...a,
          activityQuantity: Number(a.activityQuantity),
          factor:
            a.factor !== null && a.factor !== undefined
              ? Number(a.factor)
              : null,
          gwp: a.gwp !== null && a.gwp !== undefined ? Number(a.gwp) : null,
        }),
      ),
    [data],
  );

  const auditable = emissions.filter((e) => e.auditable);
  // Totalled BY SCOPE, never across them. The engine refuses an activity with
  // no scope precisely because scope 1, 2 and 3 are not interchangeable, and a
  // single headline number here would contradict that in the same panel.
  const byScope = auditable.reduce<Record<string, number>>((acc, e) => {
    const k = e.scope ?? "unscoped";
    acc[k] = (acc[k] ?? 0) + (e.co2eTonnes ?? 0);
    return acc;
  }, {});

  if (loading) return <LoadingState label="Loading environmental posture" />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  const posture = data?.posture ?? null;

  return (
    <section aria-labelledby="env-heading" className="space-y-4">
      <div>
        <h2
          id="env-heading"
          className="flex items-center gap-2 text-lg font-semibold text-white"
        >
          <Leaf className="h-5 w-5 text-signal-cyan" aria-hidden />
          Environmental Performance
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-300">
          A fouled exchanger still runs. It just burns more fuel for the same
          duty, every hour, and nobody raises a work order for it.
        </p>
      </div>

      {posture && (
        <div className="flex items-start gap-2 rounded-xl border border-white/6 bg-white/2 p-4 text-sm text-slate-300">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>{posture.basis}</p>
        </div>
      )}

      {/* Efficiency degradation — the maintenance decision. */}
      {degradations.length > 0 && (
        <div className="rounded-xl border border-white/6 p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
            <TrendingUp className="h-4 w-4 text-amber-400" aria-hidden />
            Efficiency degradation
          </h3>
          <ul className="mt-2 space-y-2">
            {degradations.map(({ baseline, result }) => (
              <li
                key={`${baseline.assetName}-${baseline.metric}`}
                className="text-sm"
              >
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-slate-200">{baseline.assetName}</span>
                  <span className="text-xs text-slate-500">
                    {baseline.metric} ({baseline.unit})
                  </span>
                  {result.degradation !== null && (
                    <span
                      className={`font-mono text-xs ${result.degradation > 0 ? "text-amber-300" : "text-signal-cyan"}`}
                    >
                      {(result.degradation * 100).toFixed(1)}% vs design
                    </span>
                  )}
                  {result.daysToPayback !== null && (
                    <span className="rounded bg-signal-cyan/10 px-1.5 py-0.5 text-xs text-signal-cyan">
                      clean pays back in {result.daysToPayback.toFixed(0)} days
                    </span>
                  )}
                </div>
                <p className="text-xs leading-relaxed text-slate-500">
                  {result.reason}
                </p>
                {baseline.basis && (
                  <p className="text-xs text-slate-600">{baseline.basis}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Emissions, and what is not emissions. */}
      {emissions.length > 0 && (
        <div className="rounded-xl border border-white/6 p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
            <FlaskConical className="h-4 w-4 text-signal-cyan" aria-hidden />
            Emissions and activity
            <span className="text-xs font-normal text-slate-500">
              {Object.entries(byScope)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(
                  ([scope, t]) =>
                    `${t.toFixed(1)} tCO2e ${scope.replace("_", " ")}`,
                )
                .join(" · ")}
              {auditable.length > 0 && ` — not summed across scopes`}
            </span>
          </h3>
          <ul className="mt-2 space-y-1.5">
            {emissions.map((e, i) => (
              <li key={i} className="text-sm">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span
                    className={
                      e.auditable ? "text-slate-200" : "text-slate-500"
                    }
                  >
                    {e.activityLabel.replace(/_/g, " ")}
                  </span>
                  {e.co2eTonnes !== null ? (
                    <span className="font-mono text-xs text-slate-300 tabular-nums">
                      {e.co2eTonnes.toFixed(2)} tCO2e
                    </span>
                  ) : (
                    <span className="rounded bg-white/5 px-1.5 py-0.5 text-xs text-slate-500">
                      activity data, not emissions
                    </span>
                  )}
                </div>
                <p className="text-xs leading-relaxed text-slate-500">
                  {e.reason}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
