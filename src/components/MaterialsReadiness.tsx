/**
 * MaterialsReadiness — MRO catalogue, kitting position and shortages
 * (capability register C2.07, C2.17).
 *
 * Two work-health metrics named this as their blocker: waiting-on-material
 * (C6.15) could not be computed at all and ready backlog (C6.11) rested on a
 * boolean flag nothing maintained.
 *
 * Three states are kept distinct, and the third is the one usually lost:
 *   * reserved — stock is held against the job
 *   * SHORT — a stock record exists and there is not enough
 *   * UNASSESSABLE — there is no stock record, so it is neither reservable
 *     nor honestly a shortage
 *
 * Collapsing the third into "fine" is how a fresh deployment reports a clean
 * materials position while every job is actually un-plannable.
 */
import { useState } from "react";
import { Boxes, PackageSearch, TriangleAlert, RefreshCw } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import { supabase } from "../lib/supabase";
import { LoadingState, ErrorState } from "./ui/AsyncStates";
import {
  canIssue,
  canKit,
  canReserve,
  describeReserveResult,
  listMaterialDemand,
  recordMaterialEvent,
  reserveWoMaterials,
  type MaterialDemandLine,
} from "../services/materialsCallers";

interface Shortage {
  work_order: string;
  material_code: string;
  description: string;
  short_qty: number;
  lead_time_days: number | null;
  needed_by: string | null;
  at_risk: boolean;
}

interface Unassessable {
  work_order: string;
  material_code: string;
  description: string;
  qty_required: number;
  needed_by: string | null;
  reason: string;
}

interface BelowMin {
  material_code: string;
  description: string;
  on_hand: number;
  min_qty: number;
  lead_time_days: number | null;
  criticality: string | null;
}

interface Repairable {
  material_code: string;
  description: string;
  lead_time_days: number | null;
}

interface Position {
  catalogue_size: number;
  template_rows: number;
  stock_records: number;
  demand_lines: number;
  stock_note: string;
  below_minimum: BelowMin[];
  open_shortages: Shortage[];
  unassessable_demand: Unassessable[];
  repairables: Repairable[];
}

export function MaterialsReadiness() {
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { data, loading, error, refetch } = useAsyncData<Position>(async () => {
    const { data: r, error: e } = await supabase.rpc(
      "get_material_position",
      {},
    );
    if (e) throw new Error(e.message);
    return r as Position;
  }, []);
  const demand = useAsyncData<MaterialDemandLine[]>(
    () => listMaterialDemand(),
    [],
  );

  if (loading) return <LoadingState label="Loading materials position" />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  const shortages = data?.open_shortages ?? [];
  const unassessable = data?.unassessable_demand ?? [];
  const belowMin = data?.below_minimum ?? [];
  const repairables = data?.repairables ?? [];
  const atRisk = shortages.filter((s) => s.at_risk).length;
  const lines = demand.data ?? [];
  const firstReserveableByWo = new Map<string, string>();
  for (const line of lines) {
    if (
      canReserve(line.status) &&
      !firstReserveableByWo.has(line.work_order_id)
    ) {
      firstReserveableByWo.set(line.work_order_id, line.id);
    }
  }

  const runReserve = async (workOrderId: string) => {
    setBusy(true);
    setFlash(null);
    try {
      const result = await reserveWoMaterials(workOrderId);
      setFlash(describeReserveResult(result));
      await Promise.all([refetch(), demand.refetch()]);
    } catch (e) {
      setFlash(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  };

  const runEvent = async (
    line: MaterialDemandLine,
    eventType: "kitted" | "issued",
  ) => {
    setBusy(true);
    setFlash(null);
    try {
      await recordMaterialEvent(line.id, eventType);
      setFlash(
        `Recorded ${eventType} on ${line.wo_number ?? line.work_order_id}. Waiting-on-material measures request to this satisfaction.`,
      );
      await Promise.all([refetch(), demand.refetch()]);
    } catch (e) {
      setFlash(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="materials-heading" className="space-y-4">
      <div>
        <h2
          id="materials-heading"
          className="flex items-center gap-2 text-lg font-semibold text-white"
        >
          <Boxes className="h-5 w-5 text-signal-cyan" aria-hidden />
          MRO Materials & Kitting
          <span className="text-xs font-normal text-slate-500">
            {data?.catalogue_size} catalogued · {data?.demand_lines} demand
            lines
          </span>
        </h2>
        <p className="mt-1 text-sm text-slate-300">
          Material demand, reservation and issue are recorded as events, which
          is what makes waiting-on-material measurable at all. A reservation is
          not authorization to start work.
        </p>
      </div>

      {flash && (
        <p className="rounded-lg border border-white/10 bg-white/4 px-3 py-2 text-sm text-slate-200">
          {flash}
        </p>
      )}

      {data?.stock_records === 0 && (
        <p className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-3 text-xs leading-relaxed text-amber-200/90">
          {data.stock_note}
          {data.template_rows > 0 && (
            <>
              {" "}
              The {data.template_rows} catalogued items are{" "}
              <strong>template classes</strong>, not your MRO catalogue — no
              part numbers, costs or on-hand quantities have been invented.
            </>
          )}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-white/6 bg-overlook-deep/40 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-400">
            Open shortages
          </p>
          <p className="mt-1 font-mono text-2xl text-slate-100">
            {shortages.length}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {atRisk > 0 ? (
              <span className="text-red-300">
                {atRisk} cannot arrive before the need date
              </span>
            ) : (
              "Stock exists but is insufficient"
            )}
          </p>
        </div>
        <div className="rounded-xl border border-white/6 bg-overlook-deep/40 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-400">
            Unassessable demand
          </p>
          <p className="mt-1 font-mono text-2xl text-slate-100">
            {unassessable.length}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            No stock record — not a shortage, not fine
          </p>
        </div>
        <div className="rounded-xl border border-white/6 bg-overlook-deep/40 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-400">
            Below minimum
          </p>
          <p className="mt-1 font-mono text-2xl text-slate-100">
            {belowMin.length}
          </p>
          <p className="mt-1 text-xs text-slate-500">Reorder points breached</p>
        </div>
      </div>

      <div className="rounded-xl border border-white/6 bg-white/2 p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Demand lines — reserve, kit, issue
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">
          Ready backlog (C6.11) and waiting-on-material (C6.15) stay
          unmeasurable until a human records reserved, kitted or issued events.
          Absence is not a green ready state.
        </p>
        {demand.loading ? (
          <p className="mt-2 text-xs text-slate-500">Loading demand…</p>
        ) : lines.length === 0 ? (
          <p className="mt-2 text-xs text-slate-500">
            No open material demand. Request a part on a work order, or apply a
            job plan, before reserve / kit / issue can write the event stream
            these metrics read.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {lines.map((line) => (
              <li
                key={line.id}
                className="flex flex-wrap items-center gap-2 text-xs text-slate-300"
              >
                <span className="min-w-0 flex-1">
                  <span className="font-mono text-slate-400">
                    {line.wo_number ?? line.work_order_id}
                  </span>{" "}
                  {line.description ?? line.material_code} ×{line.qty_required}
                  <span className="ml-2 font-mono text-slate-500">
                    {line.status}
                  </span>
                </span>
                {firstReserveableByWo.get(line.work_order_id) === line.id && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => runReserve(line.work_order_id)}
                    className="rounded-lg border border-teal-500/40 bg-teal-500/10 px-2 py-1 text-teal-300 disabled:opacity-50"
                  >
                    Reserve
                  </button>
                )}
                {canKit(line.status) && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => runEvent(line, "kitted")}
                    className="rounded-lg border border-white/10 px-2 py-1 text-slate-300 disabled:opacity-50"
                  >
                    Kit
                  </button>
                )}
                {canIssue(line.status) && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => runEvent(line, "issued")}
                    className="rounded-lg border border-white/10 px-2 py-1 text-slate-300 disabled:opacity-50"
                  >
                    Issue
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {shortages.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-white/6">
          <table className="w-full min-w-[42rem] text-left text-sm">
            <caption className="sr-only">Open material shortages</caption>
            <thead className="bg-white/2 text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">
                  Work order
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Material
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Short
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Lead time
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Needed by
                </th>
              </tr>
            </thead>
            <tbody>
              {shortages.map((s) => (
                <tr
                  key={`${s.work_order}-${s.material_code}`}
                  className={`border-t border-white/6 ${s.at_risk ? "bg-red-500/5" : ""}`}
                >
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-300">
                    {s.work_order}
                  </td>
                  <td className="px-4 py-2.5">
                    <p className="text-slate-200">{s.description}</p>
                    <p className="font-mono text-[11px] text-slate-500">
                      {s.material_code}
                    </p>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-slate-300 tabular-nums">
                    {s.short_qty}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-slate-400 tabular-nums">
                    {s.lead_time_days === null ? "—" : `${s.lead_time_days} d`}
                  </td>
                  <td className="px-4 py-2.5 text-xs">
                    <span className="text-slate-300">{s.needed_by ?? "—"}</span>
                    {s.at_risk && (
                      <span className="ml-2 inline-flex items-center gap-1 text-red-300">
                        <TriangleAlert className="h-3 w-3" aria-hidden />
                        cannot arrive in time
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {unassessable.length > 0 && (
        <div className="rounded-xl border border-white/6 bg-white/2 p-4">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
            <PackageSearch className="h-3.5 w-3.5" aria-hidden />
            Demand that cannot be assessed — {unassessable.length}
          </h3>
          <ul className="mt-2 space-y-1.5">
            {unassessable.map((u) => (
              <li
                key={`${u.work_order}-${u.material_code}`}
                className="text-xs text-slate-500"
              >
                <span className="font-mono text-slate-400">{u.work_order}</span>{" "}
                <span className="text-slate-300">{u.description}</span> ×
                {u.qty_required} — {u.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {repairables.length > 0 && (
        <div className="rounded-xl border border-white/6 bg-white/2 p-4">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            Repairable / rotable spares — {repairables.length}
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            Rotables return, are refurbished and re-enter stock; their history
            follows the component rather than the asset.
          </p>
          <ul className="mt-2 grid gap-1 sm:grid-cols-2">
            {repairables.map((r) => (
              <li key={r.material_code} className="text-xs text-slate-400">
                {r.description}
                {r.lead_time_days !== null && (
                  <span className="text-slate-600">
                    {" "}
                    · {r.lead_time_days} d lead
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
