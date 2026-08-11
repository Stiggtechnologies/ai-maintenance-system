/**
 * AssetTwinCoverage — how much of the fleet has a digital twin worth having,
 * and which machines the catalogue can and cannot identify
 * (capability register U3 ontology, E12.02 master data).
 *
 * The headline number here is deliberately the smaller of the two available.
 * Counting every asset with a twin row gives a flattering figure that includes
 * twins compiled from templates with no components — machines the platform can
 * name and cannot reason about. Showing both, with the gap called out, is the
 * only version of this panel that stays useful after the first look.
 *
 * Model candidates are shown and never applied. The catalogue records what
 * models a manufacturer makes; it cannot record which one a machine is, and
 * writing a researched guess into the register would make a fiction
 * indistinguishable from a fact for everything downstream.
 */
import { useMemo } from "react";
import { Boxes, Info, Layers, Search } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import { supabase } from "../lib/supabase";
import {
  assessTwinDepth,
  type TwinInstanceSummary,
} from "../lib/asset-twins/model-candidates";
import { LoadingState, ErrorState } from "./ui/AsyncStates";

interface ClassMapRow {
  localClass: string;
  templateKey: string | null;
  fit: "direct" | "approximate" | "none";
  rationale: string;
  source: string;
  assetCount: number;
}

interface CandidateRow {
  asset_id: string;
  asset_name: string;
  asset_class: string | null;
  recorded_manufacturer: string | null;
  candidate_count: number;
  candidates: {
    manufacturer: string;
    model: string;
    size_class: string | null;
    maturity: string;
  }[];
  verdict: string;
  reason: string;
}

export function AssetTwinCoverage() {
  const { data, loading, error, refetch } = useAsyncData<{
    coverage: TwinInstanceSummary[];
    total: number;
    classMap: ClassMapRow[];
    candidates: CandidateRow[];
  }>(async () => {
    const [c, t, m, s] = await Promise.all([
      supabase.rpc("get_twin_coverage"),
      supabase.rpc("get_twin_asset_total"),
      supabase.rpc("get_twin_class_map"),
      supabase.rpc("suggest_asset_models", { p_limit: 200 }),
    ]);
    if (c.error) throw new Error(c.error.message);
    if (t.error) throw new Error(t.error.message);
    if (m.error) throw new Error(m.error.message);
    if (s.error) throw new Error(s.error.message);
    return {
      // Numeric columns arrive as strings over PostgREST for bigint-ish types;
      // Number() here rather than a cast, because a cast would compile clean
      // and produce NaN arithmetic at runtime.
      coverage: ((c.data as TwinInstanceSummary[]) ?? []).map((r) => ({
        ...r,
        componentCount: Number(r.componentCount),
        failureModeCount: Number(r.failureModeCount),
        assetCount: Number(r.assetCount),
      })),
      total: Number(t.data ?? 0),
      classMap: ((m.data as ClassMapRow[]) ?? []).map((r) => ({
        ...r,
        assetCount: Number(r.assetCount),
      })),
      candidates: (s.data as CandidateRow[]) ?? [],
    };
  }, []);

  const depth = useMemo(
    () => assessTwinDepth(data?.coverage ?? [], data?.total ?? 0),
    [data],
  );

  // Group candidate rows: 144 individual lines is noise when the answer is
  // identical for every unit of a class.
  const candidateGroups = useMemo(() => {
    const by = new Map<
      string,
      { rows: CandidateRow[]; sample: CandidateRow }
    >();
    for (const r of data?.candidates ?? []) {
      const key = `${r.asset_class ?? "(none)"}|${r.recorded_manufacturer ?? ""}|${r.verdict}`;
      const g = by.get(key);
      if (g) g.rows.push(r);
      else by.set(key, { rows: [r], sample: r });
    }
    return [...by.values()].sort((a, b) => b.rows.length - a.rows.length);
  }, [data]);

  if (loading) return <LoadingState label="Loading twin coverage" />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  const refused = (data?.classMap ?? []).filter((m) => m.fit === "none");

  return (
    <section aria-labelledby="twin-heading" className="space-y-4">
      <div>
        <h2
          id="twin-heading"
          className="flex items-center gap-2 text-lg font-semibold text-white"
        >
          <Boxes className="h-5 w-5 text-signal-cyan" aria-hidden />
          Digital Twin Coverage
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-300">
          A twin that can name a machine but not describe how it fails is a
          label, not a model.
        </p>
      </div>

      <div className="flex items-start gap-2 rounded-xl border border-white/6 bg-white/2 p-4 text-sm text-slate-300">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <p>{depth.reason}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-white/6 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">
            Meaningful coverage
          </p>
          <p className="mt-1 font-mono text-2xl tabular-nums text-signal-cyan">
            {depth.meaningfulCoveragePct}%
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Twins on a template that carries components.
          </p>
        </div>
        <div className="rounded-xl border border-white/6 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">
            Nominal coverage
          </p>
          <p className="mt-1 font-mono text-2xl tabular-nums text-slate-400">
            {depth.nominalCoveragePct}%
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Any twin at all — {depth.assetsOnShellTwins} of them are shells.
          </p>
        </div>
      </div>

      {/* Per-template depth. Hidden when empty: a heading over nothing reads
          as "checked, all fine" rather than "nothing to check". */}
      {depth.verdicts.length > 0 && (
        <div className="rounded-xl border border-white/6 p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
            <Layers className="h-4 w-4 text-signal-cyan" aria-hidden />
            Templates in use
          </h3>
          <ul className="mt-2 space-y-2">
            {depth.verdicts.map((v) => (
              <li key={`${v.templateKey}-${v.fit}`} className="text-sm">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-slate-200">{v.templateKey}</span>
                  <span className="font-mono text-xs tabular-nums text-slate-500">
                    {v.assetCount} asset{v.assetCount === 1 ? "" : "s"}
                  </span>
                  <span className="text-xs text-slate-500">{v.fit} fit</span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs uppercase tracking-wide ${
                      v.depth === "usable"
                        ? "bg-signal-cyan/10 text-signal-cyan"
                        : v.depth === "partial"
                          ? "bg-amber-500/10 text-amber-300"
                          : "bg-rose-500/10 text-rose-300"
                    }`}
                  >
                    {v.depth}
                  </span>
                </div>
                <p className="text-xs leading-relaxed text-slate-500">
                  {v.reason}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Classes deliberately given no twin. A refusal belongs in the picture. */}
      {refused.length > 0 && (
        <div className="rounded-xl border border-white/6 p-4">
          <h3 className="text-sm font-semibold text-white">
            Classes with no twin, on purpose
          </h3>
          <p className="mt-1 text-xs text-slate-400">
            No template fits these closely enough to compile one. A wrong twin
            attaches the wrong failure modes to a real machine.
          </p>
          <ul className="mt-2 space-y-1.5">
            {refused.map((m) => (
              <li key={m.localClass} className="text-sm">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-slate-200">{m.localClass}</span>
                  <span className="font-mono text-xs tabular-nums text-slate-500">
                    {m.assetCount} asset{m.assetCount === 1 ? "" : "s"}
                  </span>
                </div>
                <p className="text-xs leading-relaxed text-slate-500">
                  {m.rationale}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Model candidates — proposed, never applied. */}
      {candidateGroups.length > 0 && (
        <div className="rounded-xl border border-white/6 p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
            <Search className="h-4 w-4 text-signal-cyan" aria-hidden />
            Model candidates
            <span className="text-xs font-normal text-slate-500">
              proposed only — nothing is written to the register
            </span>
          </h3>
          <ul className="mt-2 space-y-2">
            {candidateGroups.map(({ rows, sample }) => (
              <li
                key={`${sample.asset_class}-${sample.recorded_manufacturer}-${sample.verdict}`}
                className="text-sm"
              >
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-slate-200">
                    {sample.asset_class ?? "(no class)"}
                  </span>
                  <span className="text-xs text-slate-500">
                    {sample.recorded_manufacturer ?? "make not recorded"}
                  </span>
                  <span className="font-mono text-xs tabular-nums text-slate-500">
                    {rows.length} asset{rows.length === 1 ? "" : "s"}
                  </span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs uppercase tracking-wide ${
                      sample.verdict === "single_candidate"
                        ? "bg-signal-cyan/10 text-signal-cyan"
                        : "bg-white/5 text-slate-400"
                    }`}
                  >
                    {sample.verdict.replace(/_/g, " ")}
                  </span>
                </div>
                {sample.candidates.length > 0 && (
                  <p className="mt-0.5 flex flex-wrap gap-1.5">
                    {sample.candidates.map((c) => (
                      <span
                        key={`${c.manufacturer}-${c.model}`}
                        className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-xs text-slate-300"
                      >
                        {c.manufacturer} {c.model}
                        {c.size_class ? ` · ${c.size_class}` : ""}
                        {c.maturity === "draft" ? " · unverified" : ""}
                      </span>
                    ))}
                  </p>
                )}
                <p className="text-xs leading-relaxed text-slate-500">
                  {sample.reason}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
