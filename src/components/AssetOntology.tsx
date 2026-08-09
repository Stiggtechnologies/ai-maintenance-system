/**
 * AssetOntology — what kind of thing each asset is, and which maths applies
 * (capability register U3.03–U3.07, U3.09–U3.16).
 *
 * The catalogue of sixteen classes is not the capability. The capability is
 * the applicability matrix beside it: the record of which analyses are valid
 * for which measurement basis, so the platform can decline to compute
 * something rather than compute it wrongly. Classes with no assets against
 * them are shown greyed, because a defined class is a catalogue entry and an
 * occupied one is a fact.
 */
import { useMemo, useState } from "react";
import { Boxes, Info, Ban, Check, Waypoints } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import { supabase } from "../lib/supabase";
import {
  defectDensity,
  type ClassProfile,
  type LinearDefect,
} from "../lib/asset-ontology";
import { LoadingState, ErrorState } from "./ui/AsyncStates";

interface Coverage {
  assets_total: number;
  assets_classified: number;
  classes_in_use: number;
  classes_available: number;
  linear_routes: number;
  populations: number;
  untracked_population_units: number;
  non_owned_assets: number;
  expiring_tenure_90d: number;
  basis: string;
}

interface ProfileRow extends ClassProfile {
  registerRef: string;
  identityBasis: string;
  conditionBasis: string;
  assetCount: number;
}

interface RouteRow {
  id: number;
  route_code: string;
  measure_unit: string;
  start_measure: number;
  end_measure: number;
  description: string | null;
}

const ANALYSIS_LABEL: Record<string, string> = {
  weibull_age_replacement: "Age replacement",
  mtbf: "MTBF",
  pf_interval: "P-F interval",
  spares_holding: "Spares holding",
  lifecycle_economics: "Lifecycle economics",
};

export function AssetOntology() {
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data, loading, error, refetch } = useAsyncData<{
    coverage: Coverage | null;
    profiles: ProfileRow[];
    route: RouteRow | null;
    defects: LinearDefect[];
  }>(async () => {
    const [c, p, r] = await Promise.all([
      supabase.rpc("get_ontology_coverage"),
      supabase.rpc("get_class_profiles"),
      supabase
        .from("linear_asset_routes")
        .select(
          "id, route_code, measure_unit, start_measure, end_measure, description",
        )
        .limit(1),
    ]);
    if (c.error) throw new Error(c.error.message);
    if (p.error) throw new Error(p.error.message);
    if (r.error) throw new Error(r.error.message);
    const route = ((r.data ?? []) as RouteRow[])[0] ?? null;

    let defects: LinearDefect[] = [];
    if (route) {
      const d = await supabase
        .from("linear_defects")
        .select("at_measure, defect_type, severity, repaired_at")
        .eq("route_id", route.id);
      if (d.error) throw new Error(d.error.message);
      defects = (
        (d.data ?? []) as unknown as {
          at_measure: number;
          defect_type: string;
          severity: string | null;
          repaired_at: string | null;
        }[]
      ).map((x) => ({
        atMeasure: Number(x.at_measure),
        defectType: x.defect_type,
        severity: x.severity,
        repairedAt: x.repaired_at,
      }));
    }

    return {
      coverage: (c.data as Coverage[])?.[0] ?? null,
      profiles: (p.data as ProfileRow[]) ?? [],
      route,
      defects,
    };
  }, []);

  const density = useMemo(() => {
    const route = data?.route;
    if (!route) return null;
    return defectDensity(
      Number(route.start_measure),
      Number(route.end_measure),
      data?.defects ?? [],
      1,
    );
  }, [data]);

  if (loading) return <LoadingState label="Loading asset ontology" />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  const coverage = data?.coverage ?? null;
  const profiles = data?.profiles ?? [];

  return (
    <section aria-labelledby="ontology-heading" className="space-y-4">
      <div>
        <h2
          id="ontology-heading"
          className="flex items-center gap-2 text-lg font-semibold text-white"
        >
          <Boxes className="h-5 w-5 text-signal-cyan" aria-hidden />
          Asset Ontology
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-300">
          Not every asset is a machine. The analyses this platform runs assume
          one, and for a route, a population, a structure or a firmware image
          that assumption produces numbers that are confidently wrong.
        </p>
      </div>

      {coverage && (
        <div className="flex items-start gap-2 rounded-xl border border-white/6 bg-white/2 p-4 text-sm text-slate-300">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <div>
            <p>{coverage.basis}</p>
            <p className="mt-1 text-xs text-slate-500">
              {coverage.classes_in_use} of {coverage.classes_available} classes
              in use · {coverage.linear_routes} linear route(s) ·{" "}
              {coverage.populations} population(s)
              {coverage.non_owned_assets > 0 &&
                ` · ${coverage.non_owned_assets} not owned outright`}
              .
            </p>
          </div>
        </div>
      )}

      {/* Where the defects actually are — the analysis a point model cannot do. */}
      {density && data?.route && (
        <div className="rounded-xl border border-white/6 p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
            <Waypoints className="h-4 w-4 text-signal-cyan" aria-hidden />
            Defect density along {data.route.route_code}
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">
            {density.reason}
          </p>
          <div
            className="mt-3 flex gap-0.5"
            role="img"
            aria-label={`Defect density by ${data.route.measure_unit} along the route`}
          >
            {density.bands.map((b) => {
              const peak = Math.max(
                ...density.bands.map((x) => x.densityPerUnit),
                1,
              );
              const hot = density.hotspots.some(
                (h) => h.fromMeasure === b.fromMeasure,
              );
              return (
                <div
                  key={b.fromMeasure}
                  className="flex-1 text-center"
                  title={`${b.fromMeasure}–${b.toMeasure} ${data.route?.measure_unit}: ${b.defectCount} defect(s)`}
                >
                  <div className="flex h-16 items-end">
                    <div
                      className={`w-full rounded-t ${hot ? "bg-amber-400/70" : "bg-signal-cyan/40"}`}
                      style={{
                        height: `${Math.max(2, (b.densityPerUnit / peak) * 100)}%`,
                      }}
                    />
                  </div>
                  <span className="text-[10px] text-slate-600">
                    {b.fromMeasure}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* The classes, and what each one refuses. */}
      <div className="space-y-2">
        {profiles.map((p) => {
          const inUse = p.assetCount > 0;
          const refused = p.applicability.filter((a) => !a.applicable);
          const open = expanded === p.classKey;
          return (
            <div
              key={p.classKey}
              className={`rounded-xl border p-3 ${inUse ? "border-white/10" : "border-white/6 opacity-60"}`}
            >
              <button
                type="button"
                onClick={() => setExpanded(open ? null : p.classKey)}
                aria-expanded={open}
                className="flex w-full flex-wrap items-baseline gap-2 text-left"
              >
                <span className={inUse ? "text-slate-100" : "text-slate-400"}>
                  {p.label}
                </span>
                <span className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-slate-400">
                  {p.measurementBasis}
                </span>
                {inUse ? (
                  <span className="font-mono text-xs text-signal-cyan tabular-nums">
                    {p.assetCount} asset{p.assetCount === 1 ? "" : "s"}
                  </span>
                ) : (
                  <span className="text-xs text-slate-600">
                    none classified
                  </span>
                )}
                {refused.length > 0 && (
                  <span className="ml-auto text-xs text-slate-500">
                    {refused.length} analysis/analyses not applicable
                  </span>
                )}
              </button>

              {open && (
                <div className="mt-3 space-y-2 border-t border-white/6 pt-3">
                  <dl className="grid gap-1 text-xs sm:grid-cols-2">
                    <div>
                      <dt className="text-slate-500">Identified by</dt>
                      <dd className="text-slate-300">{p.identityBasis}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Condition from</dt>
                      <dd className="text-slate-300">{p.conditionBasis}</dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="text-slate-500">Failure means</dt>
                      <dd className="text-slate-300">{p.failureMeaning}</dd>
                    </div>
                  </dl>
                  {p.notes && (
                    <p className="text-xs italic leading-relaxed text-amber-200/80">
                      {p.notes}
                    </p>
                  )}
                  <ul className="space-y-1">
                    {p.applicability.map((a) => (
                      <li
                        key={a.analysisKey}
                        className="flex items-start gap-2 text-xs"
                      >
                        {a.applicable ? (
                          <Check
                            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-signal-cyan"
                            aria-label="applicable"
                          />
                        ) : (
                          <Ban
                            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400"
                            aria-label="not applicable"
                          />
                        )}
                        <span>
                          <span className="text-slate-200">
                            {ANALYSIS_LABEL[a.analysisKey] ?? a.analysisKey}
                          </span>
                          <span className="text-slate-500"> — {a.reason}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
