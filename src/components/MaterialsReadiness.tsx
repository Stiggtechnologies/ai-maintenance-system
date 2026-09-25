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
  listLotFormOptions,
  listMaterialDemand,
  listMaterialStockLots,
  MATERIAL_LOT_CERTIFICATIONS,
  MATERIAL_LOT_CONDITIONS,
  MATERIAL_SUBSTITUTION_STATUSES,
  MATERIAL_SUBSTITUTION_TYPES,
  recordMaterialEvent,
  recordMaterialStockLot,
  recordMaterialSubstitution,
  reserveWoMaterials,
  type MaterialDemandLine,
  type MaterialLotCertification,
  type MaterialLotCondition,
  type MaterialSubstitutionStatus,
  type MaterialSubstitutionType,
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
  const lots = useAsyncData(listMaterialStockLots, []);
  const lotOptions = useAsyncData(listLotFormOptions, []);
  const [lotMaterialId, setLotMaterialId] = useState("");
  const [lotSiteId, setLotSiteId] = useState("");
  const [lotRef, setLotRef] = useState("");
  const [lotQty, setLotQty] = useState("");
  const [lotCondition, setLotCondition] =
    useState<MaterialLotCondition>("unknown");
  const [lotCert, setLotCert] = useState<MaterialLotCertification>("unknown");
  const [lotSource, setLotSource] = useState("");
  const [lotBasis, setLotBasis] = useState("");
  const [subMaterialId, setSubMaterialId] = useState("");
  const [subSubstituteId, setSubSubstituteId] = useState("");
  const [subType, setSubType] = useState<MaterialSubstitutionType>(
    "approved_alternate",
  );
  const [subStatus, setSubStatus] =
    useState<MaterialSubstitutionStatus>("pending");
  const [subBasis, setSubBasis] = useState("");

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

      <div className="rounded-xl border border-white/6 bg-white/2 p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Lot condition and certification
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">
          Recovery parts-risk reads material lot condition, certification and
          staging. Recording a lot calls the existing stock-lot contract. It
          does not invent a quantity, a limit, or a fitment approval.
        </p>
        {lots.loading ? (
          <p className="mt-2 text-xs text-slate-500">Loading lots…</p>
        ) : (lots.data ?? []).length === 0 ? (
          <p className="mt-2 text-xs text-slate-500">
            No lot condition is recorded. Aggregate on-hand stock is not a
            condition or certification.
          </p>
        ) : (
          <ul className="mt-2 space-y-1">
            {(lots.data ?? []).map((lot) => (
              <li key={lot.id} className="text-xs text-slate-300">
                <span className="font-mono text-slate-400">
                  {lot.material_code ?? "material"}
                </span>{" "}
                {lot.lot_ref} · qty {lot.qty} · {lot.condition} ·{" "}
                {lot.certification_status}
              </li>
            ))}
          </ul>
        )}
        {(lotOptions.data?.materials.length ?? 0) === 0 ? (
          <p className="mt-3 text-xs text-slate-500">
            No tenant catalogue material is available to attach a lot to. Load
            the catalogue before recording condition. Nothing is invented here.
          </p>
        ) : (
          <form
            className="mt-3 grid gap-2 md:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              const qty = Number(lotQty);
              if (!lotMaterialId || !lotRef.trim() || !Number.isFinite(qty)) {
                setFlash("A catalogue material, lot reference and quantity are required.");
                return;
              }
              setBusy(true);
              setFlash(null);
              void recordMaterialStockLot({
                materialId: lotMaterialId,
                siteId: lotSiteId || null,
                lotRef: lotRef.trim(),
                qty,
                condition: lotCondition,
                certificationStatus: lotCert,
                sourceSystem: lotSource.trim(),
                basis: lotBasis.trim(),
              })
                .then(() => {
                  setFlash("Lot condition recorded. It is not an approval to install.");
                  setLotRef("");
                  setLotQty("");
                  setLotBasis("");
                  return lots.refetch();
                })
                .catch((err: unknown) =>
                  setFlash(err instanceof Error ? err.message : "Could not record the lot."),
                )
                .finally(() => setBusy(false));
            }}
          >
            <label className="text-xs text-slate-400">
              Material
              <select
                aria-label="Lot material"
                className="mt-1 w-full rounded border border-white/10 bg-overlook-deep px-2 py-1 text-sm text-slate-200"
                value={lotMaterialId}
                onChange={(event) => setLotMaterialId(event.target.value)}
              >
                <option value="">Select…</option>
                {lotOptions.data?.materials.map((material) => (
                  <option key={material.id} value={material.id}>
                    {material.material_code} — {material.description}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-400">
              Site
              <select
                aria-label="Lot site"
                className="mt-1 w-full rounded border border-white/10 bg-overlook-deep px-2 py-1 text-sm text-slate-200"
                value={lotSiteId}
                onChange={(event) => setLotSiteId(event.target.value)}
              >
                <option value="">Unspecified site</option>
                {lotOptions.data?.sites.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-400">
              Lot reference
              <input
                aria-label="Lot reference"
                className="mt-1 w-full rounded border border-white/10 bg-overlook-deep px-2 py-1 text-sm text-slate-200"
                value={lotRef}
                onChange={(event) => setLotRef(event.target.value)}
              />
            </label>
            <label className="text-xs text-slate-400">
              Quantity
              <input
                aria-label="Lot quantity"
                type="number"
                min="0"
                step="any"
                className="mt-1 w-full rounded border border-white/10 bg-overlook-deep px-2 py-1 text-sm text-slate-200"
                value={lotQty}
                onChange={(event) => setLotQty(event.target.value)}
              />
            </label>
            <label className="text-xs text-slate-400">
              Condition
              <select
                aria-label="Lot condition"
                className="mt-1 w-full rounded border border-white/10 bg-overlook-deep px-2 py-1 text-sm text-slate-200"
                value={lotCondition}
                onChange={(event) =>
                  setLotCondition(event.target.value as MaterialLotCondition)
                }
              >
                {MATERIAL_LOT_CONDITIONS.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-400">
              Certification
              <select
                aria-label="Lot certification"
                className="mt-1 w-full rounded border border-white/10 bg-overlook-deep px-2 py-1 text-sm text-slate-200"
                value={lotCert}
                onChange={(event) =>
                  setLotCert(event.target.value as MaterialLotCertification)
                }
              >
                {MATERIAL_LOT_CERTIFICATIONS.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-400">
              Source system
              <input
                aria-label="Lot source system"
                className="mt-1 w-full rounded border border-white/10 bg-overlook-deep px-2 py-1 text-sm text-slate-200"
                value={lotSource}
                onChange={(event) => setLotSource(event.target.value)}
              />
            </label>
            <label className="text-xs text-slate-400 md:col-span-2">
              Basis
              <textarea
                aria-label="Lot basis"
                className="mt-1 w-full rounded border border-white/10 bg-overlook-deep px-2 py-1 text-sm text-slate-200"
                value={lotBasis}
                onChange={(event) => setLotBasis(event.target.value)}
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="md:col-span-2 w-fit rounded-lg border border-teal-500/40 bg-teal-500/10 px-3 py-1.5 text-xs text-teal-300 disabled:opacity-50"
            >
              Record lot condition
            </button>
          </form>
        )}
        {(lotOptions.data?.materials.length ?? 0) >= 2 && (
          <form
            className="mt-4 grid gap-2 border-t border-white/6 pt-3 md:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (
                !subMaterialId ||
                !subSubstituteId ||
                subMaterialId === subSubstituteId
              ) {
                setFlash("A substitution needs two different catalogue materials.");
                return;
              }
              setBusy(true);
              setFlash(null);
              void recordMaterialSubstitution({
                materialId: subMaterialId,
                substituteMaterialId: subSubstituteId,
                type: subType,
                status: subStatus,
                basis: subBasis.trim(),
              })
                .then((result) => {
                  setFlash(
                    `Substitution recorded as ${result.status ?? subStatus}. Pending is not an approved fitment.`,
                  );
                  setSubBasis("");
                })
                .catch((err: unknown) =>
                  setFlash(
                    err instanceof Error
                      ? err.message
                      : "Could not record the substitution.",
                  ),
                )
                .finally(() => setBusy(false));
            }}
          >
            <p className="md:col-span-2 text-xs text-slate-500">
              Substitution stays pending unless a role the contract already
              allows records another status. This does not move a part.
            </p>
            <label className="text-xs text-slate-400">
              Specified material
              <select
                aria-label="Specified material"
                className="mt-1 w-full rounded border border-white/10 bg-overlook-deep px-2 py-1 text-sm text-slate-200"
                value={subMaterialId}
                onChange={(event) => setSubMaterialId(event.target.value)}
              >
                <option value="">Select…</option>
                {lotOptions.data?.materials.map((material) => (
                  <option key={material.id} value={material.id}>
                    {material.material_code}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-400">
              Substitute
              <select
                aria-label="Substitute material"
                className="mt-1 w-full rounded border border-white/10 bg-overlook-deep px-2 py-1 text-sm text-slate-200"
                value={subSubstituteId}
                onChange={(event) => setSubSubstituteId(event.target.value)}
              >
                <option value="">Select…</option>
                {lotOptions.data?.materials.map((material) => (
                  <option key={material.id} value={material.id}>
                    {material.material_code}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-400">
              Type
              <select
                aria-label="Substitution type"
                className="mt-1 w-full rounded border border-white/10 bg-overlook-deep px-2 py-1 text-sm text-slate-200"
                value={subType}
                onChange={(event) =>
                  setSubType(event.target.value as MaterialSubstitutionType)
                }
              >
                {MATERIAL_SUBSTITUTION_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-400">
              Status
              <select
                aria-label="Substitution status"
                className="mt-1 w-full rounded border border-white/10 bg-overlook-deep px-2 py-1 text-sm text-slate-200"
                value={subStatus}
                onChange={(event) =>
                  setSubStatus(event.target.value as MaterialSubstitutionStatus)
                }
              >
                {MATERIAL_SUBSTITUTION_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-400 md:col-span-2">
              Engineering basis
              <textarea
                aria-label="Substitution basis"
                className="mt-1 w-full rounded border border-white/10 bg-overlook-deep px-2 py-1 text-sm text-slate-200"
                value={subBasis}
                onChange={(event) => setSubBasis(event.target.value)}
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="md:col-span-2 w-fit rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300 disabled:opacity-50"
            >
              Record substitution
            </button>
          </form>
        )}
      </div>

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
