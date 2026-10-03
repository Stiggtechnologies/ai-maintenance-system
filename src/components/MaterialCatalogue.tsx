import { useState, type FormEvent } from "react";
import { createCatalogueMaterial } from "../services/materialsCallers";

export function MaterialCatalogue({ onCreated }: { onCreated?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setBusy(true);
    setError(null);
    setCreated(null);
    try {
      const result = await createCatalogueMaterial({
        materialCode: String(values.get("materialCode") ?? ""),
        description: String(values.get("description") ?? ""),
        unitOfMeasure: String(values.get("unitOfMeasure") ?? ""),
        basis: String(values.get("basis") ?? ""),
      });
      setCreated(result.materialCode);
      form.reset();
      onCreated?.();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Material could not be created.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby="material-catalogue-title"
      className="rounded-xl border border-slate-700 bg-slate-900 p-5 space-y-4"
    >
      <div>
        <h2
          id="material-catalogue-title"
          className="text-lg font-semibold text-white"
        >
          Material catalogue
        </h2>
        <p className="text-sm text-slate-400">
          Record a customer material and its source. This does not create stock,
          approve a supplier, or authorize installation.
        </p>
      </div>
      <form onSubmit={submit} className="space-y-3">
        <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2">
          {[
            ["materialCode", "Material code", 120],
            ["description", "Description", 2000],
            ["unitOfMeasure", "Unit of measure", 80],
            ["basis", "Source / basis", 8000],
          ].map(([name, label, maxLength]) => (
            <label key={name} className="text-sm text-slate-300">
              {label}
              <input
                name={String(name)}
                required
                maxLength={Number(maxLength)}
                className="mt-1 block w-full rounded border border-slate-600 bg-slate-950 p-2 text-white"
              />
            </label>
          ))}
        </fieldset>
        <button
          type="submit"
          disabled={busy}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? "Creating…" : "Create material"}
        </button>
      </form>
      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}
      {created && (
        <p role="status" className="text-sm text-emerald-300">
          Material {created} created. Stock and supplier qualification remain
          separate records.
        </p>
      )}
    </section>
  );
}
