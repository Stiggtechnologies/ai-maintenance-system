import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  listCatalogueMaterials,
  upsertCatalogueMaterial,
  type CatalogueMaterial,
  type MaterialCriticality,
  type RepairableClassification,
} from "../services/repairableMaterialsService";

function optionalNumber(values: FormData, name: string): number | null {
  const raw = String(values.get(name) ?? "").trim();
  return raw === "" ? null : Number(raw);
}

export function MaterialCatalogue({ onCreated }: { onCreated?: () => void }) {
  const [materials, setMaterials] = useState<CatalogueMaterial[]>([]);
  const [editing, setEditing] = useState<CatalogueMaterial | null>(null);
  const [formVersion, setFormVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setMaterials(await listCatalogueMaterials());
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Material catalogue could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function resetForm() {
    setEditing(null);
    setFormVersion((version) => version + 1);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const result = await upsertCatalogueMaterial({
        materialId: editing?.id,
        expectedVersion: editing?.master_version,
        materialCode: String(values.get("materialCode") ?? ""),
        description: String(values.get("description") ?? ""),
        category: String(values.get("category") ?? ""),
        unitOfMeasure: String(values.get("unitOfMeasure") ?? ""),
        unitCostUsd: optionalNumber(values, "unitCostUsd"),
        leadTimeDays: optionalNumber(values, "leadTimeDays"),
        minimumQuantity: optionalNumber(values, "minimumQuantity"),
        maximumQuantity: optionalNumber(values, "maximumQuantity"),
        repairableClassification: String(
          values.get("repairableClassification") ?? "unknown",
        ) as RepairableClassification,
        criticality:
          (String(values.get("criticality") ?? "") as MaterialCriticality) ||
          null,
        sourceSystem: String(values.get("sourceSystem") ?? ""),
        basis: String(values.get("basis") ?? ""),
      });
      setSaved(
        `Material ${result.materialCode} ${editing ? "revised" : "created"}. Master version ${result.masterVersion} recorded.`,
      );
      resetForm();
      await load();
      onCreated?.();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Material could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby="material-catalogue-title"
      className="space-y-5 rounded-xl border border-slate-700 bg-slate-900 p-5"
    >
      <div>
        <h2
          id="material-catalogue-title"
          className="text-lg font-semibold text-white"
        >
          Material catalogue
        </h2>
        <p className="text-sm text-slate-400">
          Govern lead time, stocking policy and repairable classification at a
          versioned material identity. This does not create stock, approve a
          supplier, authorize installation or infer a repair outcome.
        </p>
      </div>

      <form
        key={`${editing?.id ?? "new"}-${formVersion}`}
        onSubmit={submit}
        className="space-y-4 rounded-lg border border-slate-800 bg-slate-950/40 p-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-medium text-slate-100">
            {editing
              ? `Revise ${editing.material_code} · version ${editing.master_version}`
              : "Create governed material"}
          </h3>
          {editing && (
            <button
              type="button"
              onClick={resetForm}
              className="text-sm text-sky-300 hover:text-sky-200"
            >
              Cancel revision
            </button>
          )}
        </div>
        <fieldset
          disabled={busy}
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        >
          <label className="text-sm text-slate-300">
            Material code
            <input
              name="materialCode"
              required
              maxLength={120}
              defaultValue={editing?.material_code}
              className="mt-1 block w-full rounded border border-slate-600 bg-slate-950 p-2 text-white"
            />
          </label>
          <label className="text-sm text-slate-300 sm:col-span-2">
            Description
            <input
              name="description"
              required
              maxLength={2000}
              defaultValue={editing?.description}
              className="mt-1 block w-full rounded border border-slate-600 bg-slate-950 p-2 text-white"
            />
          </label>
          <label className="text-sm text-slate-300">
            Category
            <input
              name="category"
              maxLength={120}
              defaultValue={editing?.category ?? ""}
              className="mt-1 block w-full rounded border border-slate-600 bg-slate-950 p-2 text-white"
            />
          </label>
          <label className="text-sm text-slate-300">
            Unit of measure
            <input
              name="unitOfMeasure"
              required
              maxLength={80}
              defaultValue={editing?.unit_of_measure ?? "each"}
              className="mt-1 block w-full rounded border border-slate-600 bg-slate-950 p-2 text-white"
            />
          </label>
          <label className="text-sm text-slate-300">
            Unit cost USD
            <input
              name="unitCostUsd"
              type="number"
              min="0"
              step="0.01"
              defaultValue={editing?.unit_cost_usd ?? ""}
              className="mt-1 block w-full rounded border border-slate-600 bg-slate-950 p-2 text-white"
            />
          </label>
          <label className="text-sm text-slate-300">
            Lead time days
            <input
              name="leadTimeDays"
              type="number"
              min="0"
              max="3650"
              step="1"
              defaultValue={editing?.lead_time_days ?? ""}
              className="mt-1 block w-full rounded border border-slate-600 bg-slate-950 p-2 text-white"
            />
          </label>
          <label className="text-sm text-slate-300">
            Criticality
            <select
              name="criticality"
              defaultValue={editing?.criticality ?? ""}
              className="mt-1 block w-full rounded border border-slate-600 bg-slate-950 p-2 text-white"
            >
              <option value="">Not assessed</option>
              <option value="critical">Critical</option>
              <option value="essential">Essential</option>
              <option value="routine">Routine</option>
            </select>
          </label>
          <label className="text-sm text-slate-300">
            Minimum quantity
            <input
              name="minimumQuantity"
              type="number"
              min="0"
              step="any"
              defaultValue={editing?.min_qty ?? ""}
              className="mt-1 block w-full rounded border border-slate-600 bg-slate-950 p-2 text-white"
            />
          </label>
          <label className="text-sm text-slate-300">
            Maximum quantity
            <input
              name="maximumQuantity"
              type="number"
              min="0"
              step="any"
              defaultValue={editing?.max_qty ?? ""}
              className="mt-1 block w-full rounded border border-slate-600 bg-slate-950 p-2 text-white"
            />
          </label>
          <label className="text-sm text-slate-300 sm:col-span-2">
            Repairable / rotable
            <select
              name="repairableClassification"
              required
              defaultValue={editing?.repairable_classification ?? "unknown"}
              className="mt-1 block w-full rounded border border-slate-600 bg-slate-950 p-2 text-white"
            >
              <option value="unknown">Unknown — evidence not assessed</option>
              <option value="consumable">Consumable</option>
              <option value="repairable">Repairable</option>
              <option value="rotable">Rotable</option>
            </select>
          </label>
          <label className="text-sm text-slate-300 sm:col-span-2">
            Source system
            <input
              name="sourceSystem"
              required
              maxLength={160}
              defaultValue={editing?.source_system ?? "customer_catalogue"}
              className="mt-1 block w-full rounded border border-slate-600 bg-slate-950 p-2 text-white"
            />
          </label>
          <label className="text-sm text-slate-300 sm:col-span-2">
            Source / basis
            <textarea
              name="basis"
              required
              minLength={20}
              maxLength={8000}
              rows={3}
              defaultValue={editing?.basis ?? ""}
              className="mt-1 block w-full rounded border border-slate-600 bg-slate-950 p-2 text-white"
            />
          </label>
        </fieldset>
        <button
          type="submit"
          disabled={busy}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? "Saving…" : editing ? "Save revision" : "Create material"}
        </button>
      </form>

      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className="text-sm text-emerald-300">
          {saved} Stock and supplier qualification remain separate records.
        </p>
      )}

      <div className="overflow-x-auto">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-medium text-slate-200">Customer catalogue</h3>
          <span className="text-xs text-slate-500">
            {loading ? "Loading…" : `${materials.length} governed materials`}
          </span>
        </div>
        {!loading && materials.length === 0 ? (
          <p className="rounded border border-dashed border-slate-700 p-4 text-sm text-slate-400">
            No customer material identities yet. Template classes are excluded
            because they are not operating evidence.
          </p>
        ) : (
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="px-2 py-2">Material</th>
                <th className="px-2 py-2">Policy</th>
                <th className="px-2 py-2">Repair class</th>
                <th className="px-2 py-2">Evidence</th>
                <th className="px-2 py-2" aria-label="Actions" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 text-slate-300">
              {materials.map((material) => (
                <tr key={material.id}>
                  <td className="px-2 py-3">
                    <div className="font-medium text-slate-100">
                      {material.material_code}
                    </div>
                    <div className="max-w-sm text-xs text-slate-500">
                      {material.description}
                    </div>
                  </td>
                  <td className="px-2 py-3 text-xs">
                    Lead {material.lead_time_days ?? "unknown"} d · min/max{" "}
                    {material.min_qty ?? "?"}/{material.max_qty ?? "?"}
                  </td>
                  <td className="px-2 py-3 capitalize">
                    {material.repairable_classification}
                  </td>
                  <td className="px-2 py-3 text-xs">
                    v{material.master_version} ·{" "}
                    {material.source_system ?? "source unknown"}
                  </td>
                  <td className="px-2 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(material);
                        setSaved(null);
                        setError(null);
                      }}
                      className="rounded border border-slate-600 px-3 py-1 text-xs text-sky-300 hover:border-sky-500"
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
