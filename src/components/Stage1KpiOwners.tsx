/**
 * Name humans against the ISO 55000 KPI catalog RACI.
 *
 * Catalog A/R/C/I stay role names. This records a named human in Accountable
 * or Responsible on raci_assignments (decision_type iso55000_kpi:<key>).
 * Empty named slots stay empty — no demo default, no invented owner.
 */
import { useMemo, useState } from "react";
import { UserCheck } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import {
  getKpiNamedOwners,
  nameKpiOwner,
  type KpiNamedOwnerRow,
  type KpiOwnerSlot,
} from "../services/stage1PilotPack";
import { LoadingState, ErrorState, EmptyState } from "./ui/AsyncStates";

export function Stage1KpiOwners() {
  const { data, loading, error, refetch } = useAsyncData(getKpiNamedOwners, []);
  const [kpiKey, setKpiKey] = useState("");
  const [slot, setSlot] = useState<KpiOwnerSlot>("accountable");
  const [ownerName, setOwnerName] = useState("");
  const [basis, setBasis] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const owners = useMemo(() => data?.owners ?? [], [data]);
  const namedCount = useMemo(
    () =>
      owners.filter((o) => o.named_accountable || o.named_responsible).length,
    [owners],
  );
  const selected = owners.find((o) => o.kpi_key === kpiKey) ?? null;

  async function submit() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await nameKpiOwner({
        kpiKey,
        slot,
        ownerName,
        basis,
      });
      setMsg(`Recorded ${r.slot} owner ${r.owner_name} on ${r.kpi_key}.`);
      setOwnerName("");
      refetch();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not record the owner");
    } finally {
      setBusy(false);
    }
  }

  if (loading)
    return <LoadingState label="Loading ISO 55000 KPI catalog RACI" />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;
  if (owners.length === 0) {
    return (
      <EmptyState message="The ISO 55000 KPI catalog did not return. Nothing is invented in its place." />
    );
  }

  return (
    <section
      data-testid="stage1-kpi-owners"
      className="space-y-4 rounded-2xl border border-white/8 bg-[#0D1520] p-4 md:p-5"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal-500/15 text-teal-300">
          <UserCheck className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-white">
            Name KPI owners
            <span className="ml-2 text-xs font-normal text-slate-500">
              {namedCount}/{owners.length} KPIs have a named human
            </span>
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">
            Catalog RACI stays the role names (E4.02). This records a named
            human in Accountable or Responsible. AI cannot name an owner. Empty
            stays empty until a human records a name and a 20-character basis.
          </p>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="block text-xs text-slate-400">
          KPI
          <select
            data-testid="stage1-kpi-key"
            className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100"
            value={kpiKey}
            onChange={(e) => setKpiKey(e.target.value)}
          >
            <option value="">Select a catalog KPI…</option>
            {owners.map((o) => (
              <option key={o.kpi_key} value={o.kpi_key}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs text-slate-400">
          Slot
          <select
            data-testid="stage1-kpi-slot"
            className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100"
            value={slot}
            onChange={(e) => setSlot(e.target.value as KpiOwnerSlot)}
          >
            <option value="accountable">Accountable (owns the outcome)</option>
            <option value="responsible">Responsible (does the work)</option>
          </select>
        </label>
        <label className="block text-xs text-slate-400">
          Named human
          <input
            data-testid="stage1-kpi-owner-name"
            className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100"
            value={ownerName}
            onChange={(e) => setOwnerName(e.target.value)}
            placeholder="Full name as the organization writes it"
          />
        </label>
        <label className="block text-xs text-slate-400">
          Instrument / basis (20+ characters)
          <input
            data-testid="stage1-kpi-owner-basis"
            className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100"
            value={basis}
            onChange={(e) => setBasis(e.target.value)}
            placeholder="RACI instrument or meeting that names this human"
          />
        </label>
      </div>

      {selected && (
        <p
          className="text-xs text-slate-400"
          data-testid="stage1-kpi-catalog-raci"
        >
          Catalog roles — A {selected.catalog_accountable} · R{" "}
          {selected.catalog_responsible}
          {selected.catalog_consulted
            ? ` · C ${selected.catalog_consulted}`
            : ""}
          {selected.catalog_informed ? ` · I ${selected.catalog_informed}` : ""}
          . Named humans: A {selected.named_accountable ?? "—"} · R{" "}
          {selected.named_responsible ?? "—"}.
        </p>
      )}

      <button
        type="button"
        data-testid="stage1-kpi-owner-submit"
        disabled={
          busy ||
          kpiKey === "" ||
          ownerName.trim().length < 2 ||
          basis.trim().length < 20
        }
        className="rounded-lg bg-teal-500/90 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-40"
        onClick={() => void submit()}
      >
        {busy ? "Recording…" : "Record named owner"}
      </button>
      {msg && (
        <p
          className="text-xs text-slate-300"
          data-testid="stage1-kpi-owner-msg"
        >
          {msg}
        </p>
      )}

      <div className="overflow-x-auto rounded-xl border border-white/6">
        <table className="w-full min-w-[40rem] text-left text-sm">
          <caption className="sr-only">
            ISO 55000 KPI catalog RACI with named-human overlay
          </caption>
          <thead className="bg-white/2 text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-3 py-2 font-medium">KPI</th>
              <th className="px-3 py-2 font-medium">Catalog A / R</th>
              <th className="px-3 py-2 font-medium">Named human</th>
            </tr>
          </thead>
          <tbody>
            {owners.map((row) => (
              <OwnerRow key={row.kpi_key} row={row} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function OwnerRow({ row }: { row: KpiNamedOwnerRow }) {
  const named = row.named_accountable || row.named_responsible;
  return (
    <tr
      data-testid={`stage1-kpi-row-${row.kpi_key}`}
      className="border-t border-white/6 align-top"
    >
      <td className="px-3 py-2">
        <p className="font-medium text-slate-200">{row.name}</p>
        <p className="font-mono text-[11px] text-slate-500">{row.kpi_key}</p>
      </td>
      <td className="px-3 py-2 text-xs text-slate-400">
        A {row.catalog_accountable}
        <br />R {row.catalog_responsible}
      </td>
      <td className="px-3 py-2 text-xs">
        {named ? (
          <span className="text-slate-200">
            A {row.named_accountable ?? "—"} · R {row.named_responsible ?? "—"}
          </span>
        ) : (
          <span className="text-slate-500">No named human recorded</span>
        )}
      </td>
    </tr>
  );
}
