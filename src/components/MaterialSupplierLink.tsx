import { useState, type FormEvent } from "react";
import { useAsyncData } from "../hooks/useAsyncData";
import {
  linkCatalogueSupplier,
  listMaterialSupplierOptions,
} from "../services/materialsCallers";

export function MaterialSupplierLink() {
  const options = useAsyncData(listMaterialSupplierOptions);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await linkCatalogueSupplier({
        materialId: String(values.get("materialId")),
        supplierId: Number(values.get("supplierId")),
        supplierPartNumber: String(values.get("supplierPartNumber") ?? ""),
        basis: String(values.get("basis") ?? ""),
      });
      setSaved(true);
      form.reset();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Relationship could not be recorded.",
      );
    } finally {
      setBusy(false);
    }
  }
  const empty =
    !options.data?.materials.length || !options.data?.suppliers.length;
  return (
    <section
      aria-labelledby="material-supplier-title"
      className="rounded-xl border border-slate-700 bg-slate-900 p-5 space-y-4"
    >
      <h2
        id="material-supplier-title"
        className="text-lg font-semibold text-white"
      >
        Supplier relationship
      </h2>
      <p className="text-sm text-slate-400">
        Connect an existing supplier to a catalogued material. This records
        traceability, not supplier qualification or permission to procure.
      </p>
      <button
        type="button"
        onClick={options.refetch}
        disabled={options.loading || busy}
        className="text-sm text-blue-300"
      >
        Refresh catalogue and suppliers
      </button>
      {options.loading && <p role="status">Loading catalogue and suppliers…</p>}
      {options.error && <p role="alert">{options.error}</p>}
      {!options.loading && !options.error && empty && (
        <p className="text-sm text-slate-400">
          Create a material and register a supplier before linking them.
        </p>
      )}
      <form onSubmit={submit} className="space-y-3">
        <fieldset
          disabled={busy || options.loading || !!options.error || empty}
          className="grid gap-3 sm:grid-cols-2"
        >
          <label className="text-sm text-slate-300">
            Catalogue material
            <select
              name="materialId"
              required
              defaultValue=""
              className="block w-full rounded bg-slate-950 p-2"
            >
              <option value="">Select material</option>
              {options.data?.materials.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.material_code} — {m.description}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-slate-300">
            Supplier
            <select
              name="supplierId"
              required
              defaultValue=""
              className="block w-full rounded bg-slate-950 p-2"
            >
              <option value="">Select supplier</option>
              {options.data?.suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.supplier_code} — {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-slate-300">
            Supplier part number (optional)
            <input
              name="supplierPartNumber"
              maxLength={240}
              className="block w-full rounded bg-slate-950 p-2"
            />
          </label>
          <label className="text-sm text-slate-300">
            Relationship source / basis
            <input
              name="basis"
              required
              maxLength={8000}
              className="block w-full rounded bg-slate-950 p-2"
            />
          </label>
          <button
            type="submit"
            className="rounded bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {busy ? "Recording…" : "Record supplier relationship"}
          </button>
        </fieldset>
      </form>
      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className="text-sm text-emerald-300">
          Supplier relationship recorded as unapproved. Qualification requires
          separate review.
        </p>
      )}
    </section>
  );
}
