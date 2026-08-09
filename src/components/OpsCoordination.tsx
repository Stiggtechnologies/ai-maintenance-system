/**
 * OpsCoordination — equipment release, return-to-service and production loss
 * (capability register E3.05, E3.06, C6.04).
 *
 * The handover between operations and maintenance is where people get hurt. It
 * is a two-sided transaction — operations releases the equipment and later
 * ACCEPTS it back — and the platform had no record of either side.
 *
 * The state this panel exists to surface is "returned but not accepted": the
 * equipment sits in neither party's hands while each assumes the other owns
 * it. Closing that out silently is how it stays invisible.
 *
 * Production loss is measured against the rate each asset actually
 * demonstrated while running, never nameplate. Nameplate overstates loss
 * systematically, and an overstated loss is a number that will not survive
 * the meeting where it matters.
 */
import { HandCoins, ArrowLeftRight, Hourglass } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import { supabase } from "../lib/supabase";
import { LoadingState, ErrorState } from "./ui/AsyncStates";

interface Release {
  asset: string;
  status: string;
  released_at: string;
  returned_at: string | null;
  isolation_confirmed: boolean;
  hours_out_of_service: number;
  awaiting_acceptance: boolean;
}

interface LossRow {
  asset: string;
  down_hours: number;
  demonstrated_rate: number;
  unit_of_measure: string;
  units_lost: number;
}

interface Payload {
  open_releases: Release[];
  production_loss: {
    window_days: number;
    by_asset: LossRow[];
    assets_measurable: number;
    assets: number;
    basis: string;
  };
  note: string;
}

export function OpsCoordination() {
  const { data, loading, error, refetch } = useAsyncData<Payload>(async () => {
    const { data: r, error: e } = await supabase.rpc(
      "get_ops_coordination",
      {},
    );
    if (e) throw new Error(e.message);
    return r as Payload;
  }, []);

  if (loading) return <LoadingState label="Loading operations coordination" />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  const releases = data?.open_releases ?? [];
  const awaiting = releases.filter((r) => r.awaiting_acceptance).length;
  const loss = data?.production_loss;
  const lossRows = loss?.by_asset ?? [];

  return (
    <section aria-labelledby="ops-heading" className="space-y-4">
      <div>
        <h2
          id="ops-heading"
          className="flex items-center gap-2 text-lg font-semibold text-white"
        >
          <ArrowLeftRight className="h-5 w-5 text-signal-cyan" aria-hidden />
          Operations Handover
          <span className="text-xs font-normal text-slate-500">
            {releases.length} open
            {awaiting > 0 && ` · ${awaiting} awaiting acceptance`}
          </span>
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-300">{data?.note}</p>
      </div>

      {releases.length === 0 ? (
        <p className="rounded-xl border border-white/6 bg-white/2 p-4 text-sm text-slate-400">
          No equipment is currently released to maintenance. A release is an
          operations act — maintenance cannot release equipment to itself — and
          work carrying a permit or isolation cannot be closed without one.
        </p>
      ) : (
        <ul className="space-y-2">
          {releases.map((r) => (
            <li
              key={`${r.asset}-${r.released_at}`}
              className={`rounded-xl border p-3.5 ${
                r.awaiting_acceptance
                  ? "border-amber-500/30 bg-amber-500/5"
                  : "border-white/6 bg-overlook-deep/40"
              }`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium text-slate-200">{r.asset}</p>
                <span className="inline-flex items-center gap-1 text-xs text-slate-400">
                  <Hourglass className="h-3 w-3" aria-hidden />
                  {r.hours_out_of_service} h out of service
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-400">
                {r.awaiting_acceptance ? (
                  <span className="text-amber-300">
                    Returned by maintenance, not yet accepted by operations —
                    the equipment is in neither party&rsquo;s hands.
                  </span>
                ) : (
                  <>Released to maintenance</>
                )}
                {" · "}
                {r.isolation_confirmed
                  ? "isolation confirmed"
                  : "no isolation recorded"}
              </p>
            </li>
          ))}
        </ul>
      )}

      <div className="pt-1">
        <h3 className="flex items-center gap-2 text-base font-semibold text-white">
          <HandCoins className="h-4.5 w-4.5 text-signal-gold" aria-hidden />
          Production loss attributable to equipment
          <span className="font-mono text-[10px] text-slate-600">C6.04</span>
        </h3>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-400">
          {loss?.basis}
        </p>
      </div>

      {lossRows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-white/6">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <caption className="sr-only">
              Production loss by asset over the last {loss?.window_days} days
            </caption>
            <thead className="bg-white/2 text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">
                  Asset
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Down hours
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Demonstrated rate
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Units lost
                </th>
              </tr>
            </thead>
            <tbody>
              {lossRows.map((r) => (
                <tr key={r.asset} className="border-t border-white/6">
                  <td className="px-4 py-2.5 text-slate-200">{r.asset}</td>
                  <td className="px-4 py-2.5 font-mono text-slate-300 tabular-nums">
                    {r.down_hours}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-slate-400 tabular-nums">
                    {r.demonstrated_rate} {r.unit_of_measure}/h
                  </td>
                  <td className="px-4 py-2.5 font-mono text-amber-300 tabular-nums">
                    {r.units_lost.toLocaleString()} {r.unit_of_measure}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
