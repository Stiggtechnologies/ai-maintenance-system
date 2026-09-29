import { useState, type FormEvent } from "react";
import { useAsyncData } from "../hooks/useAsyncData";
import {
  linkCatalogueBom,
  listMaterialBomOptions,
} from "../services/materialsCallers";

export function MaterialBomLink() {
  const options = useAsyncData(listMaterialBomOptions);
  const [mode, setMode] = useState("asset");
  const [assetId, setAssetId] = useState("");
  const [componentId, setComponentId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const classes = [
    ...new Set(
      options.data?.assets
        .map((a) => a.asset_class)
        .filter((c): c is string => !!c) ?? [],
    ),
  ].sort();
  const inputStyle = "block w-full rounded bg-slate-950 p-2 text-slate-200";
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await linkCatalogueBom({
        materialId: String(values.get("materialId")),
        assetId: mode === "asset" ? assetId : null,
        assetClass: mode === "class" ? String(values.get("assetClass")) : null,
        componentId: mode === "asset" ? componentId || null : null,
        quantity: Number(values.get("quantity")),
        positionNote: String(values.get("positionNote") ?? ""),
        basis: String(values.get("basis") ?? ""),
      });
      setSaved(true);
      form.reset();
      setAssetId("");
      setComponentId("");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "BOM link could not be recorded.",
      );
    } finally {
      setBusy(false);
    }
  }
  const empty = !options.data?.materials.length || !options.data?.assets.length;
  return (
    <section
      aria-labelledby="material-bom-title"
      className="rounded-xl border border-slate-700 bg-slate-900 p-5 space-y-4"
    >
      <h2 id="material-bom-title" className="text-lg font-semibold text-white">
        Bill of materials
      </h2>
      <p className="text-sm text-slate-400">
        Record where a material belongs, with its quantity and source. A BOM
        relationship is not evidence of installation, failure causation, or
        authorization to perform work.
      </p>
      <button
        type="button"
        onClick={options.refetch}
        disabled={options.loading || busy}
        className="text-sm text-blue-300"
      >
        Refresh materials and equipment
      </button>
      {options.loading && <p role="status">Loading materials and equipment…</p>}
      {options.error && <p role="alert">{options.error}</p>}
      {!options.loading && !options.error && empty && (
        <p>
          Create a material and an asset before recording a BOM relationship.
        </p>
      )}
      <form onSubmit={submit}>
        <fieldset
          disabled={busy || options.loading || !!options.error || empty}
          className="grid gap-3 sm:grid-cols-2 text-sm text-slate-300"
        >
          <label>
            BOM material
            <select
              name="materialId"
              defaultValue=""
              required
              className={inputStyle}
            >
              <option value="">Select material</option>
              {options.data?.materials.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.material_code} — {m.description}
                </option>
              ))}
            </select>
          </label>
          <label>
            BOM scope
            <select
              value={mode}
              onChange={(e) => {
                setMode(e.target.value);
                setAssetId("");
                setComponentId("");
              }}
              className={inputStyle}
            >
              <option value="asset">Specific asset / component</option>
              <option value="class">Asset class</option>
            </select>
          </label>
          {mode === "asset" ? (
            <>
              <label>
                BOM asset
                <select
                  required
                  value={assetId}
                  onChange={(e) => {
                    setAssetId(e.target.value);
                    setComponentId("");
                  }}
                  className={inputStyle}
                >
                  <option value="">Select asset</option>
                  {options.data?.assets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.tag ? `${a.tag} — ` : ""}
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                BOM component (optional)
                <select
                  value={componentId}
                  onChange={(e) => setComponentId(e.target.value)}
                  disabled={!assetId}
                  className={inputStyle}
                >
                  <option value="">Asset-level BOM</option>
                  {options.data?.components
                    .filter((c) => c.asset_id === assetId)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </label>
            </>
          ) : (
            <label>
              BOM asset class
              <select
                name="assetClass"
                defaultValue=""
                required
                className={inputStyle}
              >
                <option value="">Select class</option>
                {classes.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Quantity per asset / component
            <input
              name="quantity"
              type="number"
              step="any"
              min="0"
              required
              className={inputStyle}
            />
          </label>
          <label>
            Position note (optional)
            <input
              name="positionNote"
              maxLength={2000}
              className={inputStyle}
            />
          </label>
          <label>
            BOM source / basis
            <input
              name="basis"
              required
              maxLength={8000}
              className={inputStyle}
            />
          </label>
          <button
            type="submit"
            className="rounded bg-blue-600 px-4 py-2 text-white"
          >
            {busy ? "Recording…" : "Record BOM relationship"}
          </button>
        </fieldset>
      </form>
      {error && (
        <p role="alert" className="text-red-300">
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className="text-emerald-300">
          BOM relationship recorded. Installation and work approval remain
          separate.
        </p>
      )}
    </section>
  );
}
