import { useEffect, useState } from "react";
import { Boxes, ShieldCheck } from "lucide-react";
import { useAuth } from "./AuthProvider";
import { listSites, type SiteOption } from "../services/reliabilityCallers";
import { sapS4InventoryReadActions } from "../services/sapS4InventoryRead";

const input =
  "w-full rounded-lg border border-industrial-border bg-industrial-slate px-3 py-2 text-sm text-industrial-text outline-none focus:border-signal-cyan";

export function SapS4InventoryReadConnectorSetup({
  onConfigured,
}: {
  onConfigured: () => Promise<void>;
}) {
  const { profile } = useAuth();
  const admin = ["admin", "ai_admin"].includes(
    String(profile?.role ?? "").toLowerCase(),
  );
  const [sites, setSites] = useState<SiteOption[]>([]);
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [serviceRoot, setServiceRoot] = useState("");
  const [plant, setPlant] = useState("");
  const [storageLocation, setStorageLocation] = useState("");
  const [siteId, setSiteId] = useState("");
  const [maxRows, setMaxRows] = useState("25000");
  const [pageSize, setPageSize] = useState("1000");
  const [maxPages, setMaxPages] = useState("50");
  const [interval, setInterval] = useState("60");
  const [credential, setCredential] = useState("");
  const [basis, setBasis] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!admin) return;
    let active = true;
    void listSites()
      .then((rows) => {
        if (active) setSites(rows);
      })
      .catch((error: Error) => {
        if (active) setMessage(error.message);
      });
    return () => {
      active = false;
    };
  }, [admin]);

  const valid =
    key.trim().length >= 3 &&
    name.trim().length >= 3 &&
    serviceRoot.trim().length > 0 &&
    plant.trim().length > 0 &&
    storageLocation.trim().length > 0 &&
    siteId.length > 0 &&
    Number.isSafeInteger(Number(maxRows)) &&
    Number(maxRows) >= 1 &&
    Number(maxRows) <= 25000 &&
    Number.isSafeInteger(Number(pageSize)) &&
    Number(pageSize) >= 1 &&
    Number(pageSize) <= Math.min(Number(maxRows), 5000) &&
    Number.isSafeInteger(Number(maxPages)) &&
    Number(maxPages) >= 2 &&
    Number(maxPages) <= 100 &&
    Number.isSafeInteger(Number(interval)) &&
    Number(interval) >= 1 &&
    credential.trim().length > 0 &&
    basis.trim().length >= 20;

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await sapS4InventoryReadActions.configure({
        key: key.trim(),
        name: name.trim(),
        serviceRoot: serviceRoot.trim(),
        plant: plant.trim(),
        storageLocation: storageLocation.trim(),
        siteId,
        maxRows: Number(maxRows),
        pageSize: Number(pageSize),
        maxPages: Number(maxPages),
        interval: Number(interval),
        credentialRef: credential.trim(),
        enabled,
        basis: basis.trim(),
      });
      setMessage(String(result.note ?? "SAP inventory source saved."));
      await onConfigured();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const pull = async (dryRun: boolean) => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await sapS4InventoryReadActions.pull(key.trim(), dryRun);
      setMessage(
        `${dryRun ? "Dry run" : "Pull"}: ${String(result.raw_rows ?? 0)} SAP rows mapped to ${String(result.mapped_rows ?? 0)} material balances across ${String(result.pages ?? 0)} pages.${dryRun ? " No run, staging, stock or watermark row was written." : ` Status ${String(result.status ?? "unknown")}; ${String(result.rejected ?? result.records_rejected ?? 0)} refused.`}`,
      );
      await onConfigured();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-xl border border-signal-cyan/20 bg-signal-cyan/5 p-5">
      <div className="flex items-start gap-3">
        <Boxes className="mt-0.5 h-5 w-5 text-signal-cyan" />
        <div>
          <h2 className="font-semibold text-industrial-text">
            SAP S/4HANA Material Stock (read-only)
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            Read unrestricted, non-special on-hand stock from one approved SAP
            plant and storage location. Material code, base UOM and tenant site
            must match exactly. Reservations and on-order quantities are never
            guessed or overwritten.
          </p>
        </div>
      </div>

      {!admin ? (
        <p className="mt-4 text-sm text-slate-400">
          An administrator must configure or enable this source.
        </p>
      ) : (
        <>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <input
              className={input}
              placeholder="SAP inventory connector key"
              value={key}
              onChange={(event) => setKey(event.target.value)}
            />
            <input
              className={input}
              placeholder="SAP inventory display name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <input
              className={input}
              placeholder="https://sap.example.com/sap/opu/odata/sap/API_MATERIAL_STOCK_SRV"
              value={serviceRoot}
              onChange={(event) => setServiceRoot(event.target.value)}
            />
            <input
              className={input}
              aria-label="SAP Plant"
              placeholder="Plant, for example 1000"
              value={plant}
              onChange={(event) => setPlant(event.target.value)}
            />
            <input
              className={input}
              aria-label="SAP StorageLocation"
              placeholder="Storage location, for example 0001"
              value={storageLocation}
              onChange={(event) => setStorageLocation(event.target.value)}
            />
            <select
              className={input}
              aria-label="Canonical inventory site"
              value={siteId}
              onChange={(event) => setSiteId(event.target.value)}
            >
              <option value="">Map to one tenant site</option>
              {sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
            </select>
            <input
              className={input}
              aria-label="Maximum SAP rows"
              type="number"
              min="1"
              max="25000"
              value={maxRows}
              onChange={(event) => setMaxRows(event.target.value)}
            />
            <input
              className={input}
              aria-label="SAP page size"
              type="number"
              min="1"
              max="5000"
              value={pageSize}
              onChange={(event) => setPageSize(event.target.value)}
            />
            <input
              className={input}
              aria-label="Maximum SAP pages"
              type="number"
              min="2"
              max="100"
              value={maxPages}
              onChange={(event) => setMaxPages(event.target.value)}
            />
            <input
              className={input}
              aria-label="Expected SAP interval minutes"
              type="number"
              min="1"
              value={interval}
              onChange={(event) => setInterval(event.target.value)}
            />
            <input
              className={input}
              placeholder="vault://tenant/sap-s4-inventory"
              value={credential}
              onChange={(event) => setCredential(event.target.value)}
            />
          </div>
          <textarea
            className={`${input} mt-3`}
            rows={2}
            placeholder="Activation authority and exact SAP plant/storage-to-site mapping basis (20+ characters)"
            value={basis}
            onChange={(event) => setBasis(event.target.value)}
          />
          <label className="mt-3 flex gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            Enable only after the exact SAP host and OAuth binding are present
            in the protected deployment.
          </label>
          {message && <p className="mt-3 text-sm text-slate-300">{message}</p>}
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || !valid}
              onClick={() => void save()}
              className="inline-flex items-center gap-2 rounded-lg bg-signal-cyan px-4 py-2 text-sm font-semibold text-overlook-void disabled:opacity-40"
            >
              <ShieldCheck className="h-4 w-4" />
              {enabled ? "Save and enable" : "Save disabled configuration"}
            </button>
            <button
              type="button"
              disabled={busy || key.trim().length < 3 || !enabled}
              onClick={() => void pull(true)}
              className="rounded-lg border border-industrial-border px-4 py-2 text-sm text-industrial-text disabled:opacity-40"
            >
              Dry-run complete stock pull
            </button>
            <button
              type="button"
              disabled={busy || key.trim().length < 3 || !enabled}
              onClick={() => void pull(false)}
              className="rounded-lg border border-amber-400/50 px-4 py-2 text-sm text-amber-200 disabled:opacity-40"
            >
              Import on-hand snapshot
            </button>
          </div>
        </>
      )}
    </section>
  );
}
