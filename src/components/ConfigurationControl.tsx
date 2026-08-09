/**
 * ConfigurationControl — what the asset was designed to be, and what it is now
 * (capability register U7.01, U7.03–U7.04, U7.06–U7.11).
 *
 * Two things are shown before any comparison: how many assets can actually be
 * compared, and when this one was last reconciled. A drift result computed
 * from baselines nobody has verified against the equipment is a comparison of
 * two documents, and the panel says which it is.
 */
import { useEffect, useMemo, useState } from "react";
import { GitCompare, TriangleAlert, ClipboardList, Info } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import { supabase } from "../lib/supabase";
import {
  compareBaselines,
  assessTemporaryModifications,
  reconciliationStatus,
  type Baseline,
  type Substitution,
  type TempMod,
} from "../lib/configuration";
import { LoadingState, ErrorState } from "./ui/AsyncStates";

interface Posture {
  assets_total: number;
  assets_with_designed: number;
  assets_comparable: number;
  open_temporary_mods: number;
  overdue_temporary_mods: number;
  overdue_safety_mods: number;
  oldest_overdue_days: number;
  open_red_lines: number;
  oldest_red_line_days: number;
  expired_substitutions: number;
  assets_never_reconciled: number;
  basis: string;
}

interface AssetConfig {
  baselines: Baseline[];
  substitutions: Substitution[];
  lastReconciliation: {
    performedAt: string;
    trigger: string;
    differencesFound: number;
  } | null;
}

interface ComparableAsset {
  id: string;
  name: string;
}

interface ConfigException {
  kind: string;
  asset_name: string;
  detail: string;
  days_overdue: number;
  safety: boolean;
}

export function ConfigurationControl() {
  const [assetId, setAssetId] = useState<string | null>(null);
  const [config, setConfig] = useState<AssetConfig | null>(null);

  const { data, loading, error, refetch } = useAsyncData<{
    posture: Posture | null;
    exceptions: ConfigException[];
    comparable: ComparableAsset[];
    mods: TempMod[];
  }>(async () => {
    const [p, x, c, m] = await Promise.all([
      supabase.rpc("get_configuration_posture"),
      supabase.rpc("get_configuration_exceptions", { p_limit: 10 }),
      supabase
        .from("configuration_baselines")
        .select("asset_id, assets(name)")
        .eq("is_current", true)
        .eq("baseline_kind", "as_designed"),
      // The real rows, not a reconstruction of them: the assessor counts
      // missing risk assessments, and a fabricated placeholder would hide the
      // very gap it is there to surface.
      supabase
        .from("temporary_modifications")
        .select(
          "id, modification_kind, description, required_removal_by, installed_at, removed_at, affects_safety_function, risk_assessment_ref, assets(name)",
        )
        .is("removed_at", null),
    ]);
    if (p.error) throw new Error(p.error.message);
    if (x.error) throw new Error(x.error.message);
    if (c.error) throw new Error(c.error.message);
    if (m.error) throw new Error(m.error.message);
    const rows = (c.data ?? []) as unknown as {
      asset_id: string;
      assets: { name: string } | null;
    }[];
    // Postgres returns snake_case; the analysis types are camelCase. Mapped
    // explicitly rather than cast, because a cast here would compile fine and
    // leave every field undefined at runtime.
    const modRows = (m.data ?? []) as unknown as {
      id: number;
      modification_kind: string;
      description: string;
      required_removal_by: string;
      installed_at: string;
      removed_at: string | null;
      affects_safety_function: boolean;
      risk_assessment_ref: string | null;
      assets: { name: string } | null;
    }[];
    return {
      posture: (p.data as Posture[])?.[0] ?? null,
      exceptions: (x.data as ConfigException[]) ?? [],
      comparable: rows.map((r) => ({
        id: r.asset_id,
        name: r.assets?.name ?? r.asset_id,
      })),
      mods: modRows.map((r) => ({
        id: r.id,
        assetName: r.assets?.name ?? "(unknown asset)",
        modificationKind: r.modification_kind,
        description: r.description,
        requiredRemovalBy: r.required_removal_by,
        installedAt: r.installed_at,
        removedAt: r.removed_at,
        affectsSafetyFunction: r.affects_safety_function,
        riskAssessmentRef: r.risk_assessment_ref,
      })),
    };
  }, []);

  const comparable = useMemo(() => data?.comparable ?? [], [data]);
  const chosen = assetId ?? comparable[0]?.id ?? null;

  useEffect(() => {
    let cancelled = false;
    if (!chosen) {
      setConfig(null);
      return;
    }
    supabase
      .rpc("get_asset_configuration", { p_asset_id: chosen })
      .then(({ data: d }) => {
        if (!cancelled) setConfig((d as AssetConfig) ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [chosen]);

  const now = new Date();

  const drift = useMemo(() => {
    if (!config) return null;
    const designed = config.baselines.find((b) => b.kind === "as_designed");
    const maintained = config.baselines.find((b) => b.kind === "as_maintained");
    return compareBaselines(designed, maintained, config.substitutions, now);
    // `now` is recreated each render but only affects expiry comparison,
    // which is stable at day resolution.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  const recon = useMemo(
    () =>
      config ? reconciliationStatus(config.lastReconciliation, now) : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [config],
  );

  const mods = useMemo(
    () => assessTemporaryModifications(data?.mods ?? [], now),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data],
  );

  if (loading) return <LoadingState label="Loading configuration posture" />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  const posture = data?.posture ?? null;

  return (
    <section aria-labelledby="config-heading" className="space-y-4">
      <div>
        <h2
          id="config-heading"
          className="flex items-center gap-2 text-lg font-semibold text-white"
        >
          <GitCompare className="h-5 w-5 text-signal-cyan" aria-hidden />
          Configuration Control
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-300">
          Maintenance history says what was done to an asset. It does not say
          what the asset currently is.
        </p>
      </div>

      {posture && (
        <div
          className={`flex items-start gap-2 rounded-xl border p-4 text-sm ${
            posture.assets_with_designed === 0
              ? "border-amber-500/30 bg-amber-500/5 text-amber-200"
              : "border-white/6 bg-white/2 text-slate-300"
          }`}
        >
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <div>
            <p>{posture.basis}</p>
            <p className="mt-1 text-xs text-slate-500">
              {posture.open_temporary_mods} open temporary modification(s) ·{" "}
              {posture.open_red_lines} unincorporated red-line(s)
              {posture.oldest_red_line_days > 0 &&
                `, oldest ${posture.oldest_red_line_days} days`}{" "}
              · {posture.expired_substitutions} expired substitution approval(s)
              · {posture.assets_never_reconciled} asset(s) never reconciled.
            </p>
          </div>
        </div>
      )}

      {/* Temporary modifications: the ones with teeth. */}
      <div className="rounded-xl border border-white/6 p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
          <TriangleAlert className="h-4 w-4 text-amber-400" aria-hidden />
          Temporary modifications and red lines
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-slate-400">
          {mods.reason}
        </p>
        {(data?.exceptions.length ?? 0) > 0 && (
          <ul className="mt-3 space-y-1 text-sm">
            {data?.exceptions.map((e, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-2">
                <span
                  className={
                    e.days_overdue > 0
                      ? e.safety
                        ? "font-mono text-rose-300 tabular-nums"
                        : "font-mono text-amber-300 tabular-nums"
                      : "font-mono text-slate-500 tabular-nums"
                  }
                >
                  {e.days_overdue > 0
                    ? `+${e.days_overdue}d`
                    : `${-e.days_overdue}d left`}
                </span>
                <span className="text-slate-200">{e.asset_name}</span>
                <span className="text-xs text-slate-500">— {e.detail}</span>
                {e.safety && (
                  <span className="rounded bg-rose-500/10 px-1.5 py-0.5 text-xs text-rose-300">
                    defeats a safety function
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Drift for one asset. */}
      <div className="rounded-xl border border-white/6 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
            <ClipboardList className="h-4 w-4 text-signal-cyan" aria-hidden />
            As-designed vs as-maintained
          </h3>
          {comparable.length > 0 && (
            <div>
              <label htmlFor="cfg-asset" className="sr-only">
                Asset
              </label>
              <select
                id="cfg-asset"
                value={chosen ?? ""}
                onChange={(e) => setAssetId(e.target.value)}
                className="rounded border border-white/10 bg-overlook-deep px-2 py-1 text-sm text-slate-200"
              >
                {comparable.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {recon && (
          <p
            className={`mt-2 text-xs leading-relaxed ${recon.overdue ? "text-amber-300" : "text-slate-500"}`}
          >
            {recon.reason}
          </p>
        )}

        {!drift ? (
          <p className="mt-2 text-sm text-slate-400">
            No asset carries an as-designed configuration baseline yet.
          </p>
        ) : (
          <>
            <p className="mt-2 text-xs leading-relaxed text-slate-400">
              {drift.reason}
            </p>
            {drift.differences.length > 0 && (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[40rem] text-left text-sm">
                  <caption className="sr-only">
                    Differences between the as-designed and as-maintained
                    configuration
                  </caption>
                  <thead className="text-xs uppercase tracking-wide text-slate-400">
                    <tr>
                      <th scope="col" className="py-2 pr-4 font-medium">
                        Position
                      </th>
                      <th scope="col" className="py-2 pr-4 font-medium">
                        Specified
                      </th>
                      <th scope="col" className="py-2 pr-4 font-medium">
                        Installed
                      </th>
                      <th scope="col" className="py-2 font-medium">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {drift.differences.map((d, i) => (
                      <tr key={i} className="border-t border-white/6 align-top">
                        <td className="py-2 pr-4 text-slate-200">
                          {d.positionRef}
                          {d.safetyCritical && (
                            <span className="ml-2 rounded bg-rose-500/10 px-1.5 py-0.5 text-xs text-rose-300">
                              safety-critical
                            </span>
                          )}
                        </td>
                        <td className="py-2 pr-4 font-mono text-xs text-slate-400">
                          {d.expected}
                        </td>
                        <td className="py-2 pr-4 font-mono text-xs text-slate-300">
                          {d.actual}
                        </td>
                        <td className="py-2 text-xs text-slate-400">
                          {d.approved ? (
                            <span className="text-slate-500">approved — </span>
                          ) : d.approvalExpired ? (
                            <span className="text-amber-300">
                              approval expired —{" "}
                            </span>
                          ) : null}
                          {d.detail}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
