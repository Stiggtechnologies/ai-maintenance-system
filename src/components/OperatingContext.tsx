/**
 * OperatingContext — run states, production and cost per produced unit
 * (capability register C2.04, C6.03, E3.02, E3.03).
 *
 * Org-level counts come from get_production_position. Per-asset duty comes
 * from get_operating_context and get_operating_regime — the two readers
 * that previously had no product caller, so a customer could see how many
 * state records existed and never see one.
 *
 * Two things this panel refuses to do:
 *   * treat an asset with no state record as running — silence is not uptime;
 *   * quote a utilisation percentage without its COVERAGE, because 92%
 *     measured across 3% of the period is not 92% utilisation.
 */
import { useState } from "react";
import { Gauge, PackageOpen, CircleAlert } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import { supabase } from "../lib/supabase";
import { LoadingState, ErrorState } from "./ui/AsyncStates";
import { AssetOperatingDuty } from "./AssetOperatingDuty";
import {
  listAssetsForContext,
  type AssetOption,
} from "../services/reliabilityCallers";

interface CostPerUnit {
  available: boolean;
  value: number | null;
  unit: string | null;
  units_produced: number | null;
  maintenance_cost_usd: number;
  cost_coverage: string;
  missing_inputs: string[];
  basis: string;
}

interface Payload {
  assets: number;
  assets_with_state_records: number;
  state_records: number;
  production_records: number;
  process_events: number;
  cost_per_unit: CostPerUnit;
  note: string;
}

export function OperatingContext() {
  const { data, loading, error, refetch } = useAsyncData<Payload>(async () => {
    const { data: r, error: e } = await supabase.rpc(
      "get_production_position",
      {},
    );
    if (e) throw new Error(e.message);
    return r as Payload;
  }, []);
  const assets = useAsyncData<AssetOption[]>(listAssetsForContext, []);
  const [assetId, setAssetId] = useState("");

  if (loading) return <LoadingState label="Loading operating context" />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  const c = data?.cost_per_unit;
  const covered = data?.assets_with_state_records ?? 0;
  const total = data?.assets ?? 0;
  const coveragePct = total > 0 ? Math.round((100 * covered) / total) : 0;
  const options = assets.data ?? [];

  return (
    <section aria-labelledby="context-heading" className="space-y-4">
      <div>
        <h2
          id="context-heading"
          className="flex items-center gap-2 text-lg font-semibold text-white"
        >
          <Gauge className="h-5 w-5 text-signal-cyan" aria-hidden />
          Operating Context & Production
          <span className="text-xs font-normal text-slate-500">
            {covered}/{total} assets with state records
          </span>
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-300">{data?.note}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-white/6 bg-overlook-deep/40 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-400">
            State coverage
          </p>
          <p
            className={`mt-1 font-mono text-2xl ${coveragePct < 50 ? "text-amber-300" : "text-slate-100"}`}
          >
            {coveragePct}
            <span className="ml-0.5 text-sm text-slate-500">%</span>
          </p>
          <p className="mt-1 text-xs text-slate-500">
            of assets have any run-state history
          </p>
        </div>

        <div className="rounded-xl border border-white/6 bg-overlook-deep/40 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-400">
            State records
          </p>
          <p className="mt-1 font-mono text-2xl text-slate-100">
            {data?.state_records?.toLocaleString()}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            running, idle, standby, down
          </p>
        </div>

        <div className="rounded-xl border border-white/6 bg-overlook-deep/40 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-400">
            Production records
          </p>
          <p className="mt-1 font-mono text-2xl text-slate-100">
            {data?.production_records?.toLocaleString()}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            the denominator for cost per unit
          </p>
        </div>

        <div className="rounded-xl border border-white/6 bg-overlook-deep/40 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-400">
            Process events
          </p>
          <p className="mt-1 font-mono text-2xl text-slate-100">
            {data?.process_events?.toLocaleString()}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            alarms, trips, excursions
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-white/6 bg-overlook-deep/40 p-4">
        <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-slate-400">
          <PackageOpen className="h-3.5 w-3.5" aria-hidden />
          Maintenance cost per production unit
          <span className="font-mono text-[10px] text-slate-600">C6.03</span>
        </p>
        {c?.available ? (
          <>
            <p className="mt-1.5 font-mono text-2xl text-slate-100">
              ${c.value}
              <span className="ml-1 text-sm text-slate-500">{c.unit}</span>
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {c.basis} {c.cost_coverage}.
            </p>
          </>
        ) : (
          <p className="mt-1.5 flex items-start gap-1.5 text-sm text-slate-400">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>{c?.basis}</span>
          </p>
        )}
      </div>

      <div
        data-testid="operating-context-reader"
        className="rounded-xl border border-white/8 bg-industrial-black/60 p-4"
      >
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-400">
            Read duty for one asset
          </span>
          <select
            aria-label="Asset for operating context"
            value={assetId}
            onChange={(e) => setAssetId(e.target.value)}
            className="w-full max-w-xl rounded-lg border border-white/10 bg-industrial-black px-3 py-2 text-sm text-slate-200"
          >
            <option value="">
              {options.length === 0
                ? "No asset is registered in this organization"
                : "Select an asset — counts above are not a duty profile"}
            </option>
            {options.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.asset_tag ? ` · ${a.asset_tag}` : ""}
              </option>
            ))}
          </select>
        </label>
        <p className="mt-2 text-xs text-slate-500">
          Org-level counts are not a duty profile. Selecting an asset calls
          get_operating_context and get_operating_regime. Silence is not uptime;
          Unknown duty is not folded into high, moderate, or low.
        </p>
        {assetId ? (
          <div className="mt-4">
            <AssetOperatingDuty assetId={assetId} />
          </div>
        ) : null}
      </div>

      {(data?.state_records ?? 0) === 0 && (
        <p className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-3 text-xs leading-relaxed text-amber-200/90">
          The monthly sheets this fleet was onboarded from <em>were</em> an
          operating-state export — down-scheduled, down-unscheduled and the
          running states between them. Ingest kept the down events of an hour or
          more as work orders and dropped the rest. Re-running the full stream
          through the connector contract would populate this from data already
          in hand.
        </p>
      )}
    </section>
  );
}
