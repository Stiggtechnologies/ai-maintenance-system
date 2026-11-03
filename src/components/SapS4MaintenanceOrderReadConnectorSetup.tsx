import { useEffect, useState } from "react";
import { ClipboardList, ShieldCheck } from "lucide-react";
import { useAuth } from "./AuthProvider";
import { listSites, type SiteOption } from "../services/reliabilityCallers";
import {
  parseSapMaintenancePhaseMap,
  sapS4MaintenanceOrderReadActions,
} from "../services/sapS4MaintenanceOrderRead";

const input =
  "w-full rounded-lg border border-industrial-border bg-industrial-slate px-3 py-2 text-sm text-industrial-text outline-none focus:border-signal-cyan";

export function SapS4MaintenanceOrderReadConnectorSetup({
  onConfigured,
}: {
  onConfigured: () => Promise<void>;
}) {
  const { profile } = useAuth();
  const admin = String(profile?.role ?? "").toLowerCase() === "admin";
  const [sites, setSites] = useState<SiteOption[]>([]);
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [serviceRoot, setServiceRoot] = useState("");
  const [planningPlant, setPlanningPlant] = useState("");
  const [siteId, setSiteId] = useState("");
  const [phaseMap, setPhaseMap] = useState("09 | completed");
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

  let parsedPhases: number;
  try {
    parsedPhases = parseSapMaintenancePhaseMap(phaseMap).length;
  } catch {
    parsedPhases = -1;
  }
  const valid =
    key.trim().length >= 3 &&
    name.trim().length >= 3 &&
    serviceRoot.trim().length > 0 &&
    /^[A-Za-z0-9]{1,4}$/.test(planningPlant.trim()) &&
    siteId.length > 0 &&
    parsedPhases >= 0 &&
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
      const result = await sapS4MaintenanceOrderReadActions.configure({
        key: key.trim(),
        name: name.trim(),
        serviceRoot: serviceRoot.trim(),
        planningPlant: planningPlant.trim(),
        siteId,
        phaseMap: parseSapMaintenancePhaseMap(phaseMap),
        maxRows: Number(maxRows),
        pageSize: Number(pageSize),
        maxPages: Number(maxPages),
        interval: Number(interval),
        credentialRef: credential.trim(),
        enabled,
        basis: basis.trim(),
      });
      setMessage(String(result.note ?? "SAP maintenance order source saved."));
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
      const result = await sapS4MaintenanceOrderReadActions.pull(
        key.trim(),
        dryRun,
      );
      setMessage(
        `${dryRun ? "Dry run" : "Pull"}: ${String(result.raw_rows ?? 0)} SAP orders mapped to ${String(result.mapped_rows ?? 0)} work orders across ${String(result.pages ?? 0)} pages.${dryRun ? " No run, staging, work order or watermark row was written." : ` Status ${String(result.status ?? "unknown")}; ${String(result.records_rejected ?? 0)} refused.`}`,
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
        <ClipboardList className="mt-0.5 h-5 w-5 text-signal-cyan" />
        <div>
          <h2 className="font-semibold text-industrial-text">
            SAP S/4HANA Maintenance Order (read-only)
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            Read API_MAINTENANCEORDER / MaintenanceOrder for one planning plant.
            Equipment must already match a canonical asset. Closeout, approval
            and safety fields are never overwritten.
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
              placeholder="SAP maintenance connector key"
              value={key}
              onChange={(event) => setKey(event.target.value)}
            />
            <input
              className={input}
              placeholder="SAP maintenance display name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <input
              className={input}
              placeholder="https://sap.example.com/sap/opu/odata/sap/API_MAINTENANCEORDER"
              value={serviceRoot}
              onChange={(event) => setServiceRoot(event.target.value)}
            />
            <input
              className={input}
              aria-label="SAP MaintenancePlanningPlant"
              placeholder="Planning plant, for example 1710"
              value={planningPlant}
              onChange={(event) => setPlanningPlant(event.target.value)}
            />
            <select
              className={input}
              aria-label="Canonical maintenance site"
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
              aria-label="Maximum SAP maintenance orders"
              type="number"
              min="1"
              max="25000"
              value={maxRows}
              onChange={(event) => setMaxRows(event.target.value)}
            />
            <input
              className={input}
              aria-label="SAP maintenance page size"
              type="number"
              min="1"
              max="5000"
              value={pageSize}
              onChange={(event) => setPageSize(event.target.value)}
            />
            <input
              className={input}
              aria-label="Maximum SAP maintenance pages"
              type="number"
              min="2"
              max="100"
              value={maxPages}
              onChange={(event) => setMaxPages(event.target.value)}
            />
            <input
              className={input}
              aria-label="Expected SAP maintenance interval minutes"
              type="number"
              min="1"
              value={interval}
              onChange={(event) => setInterval(event.target.value)}
            />
            <input
              className={input}
              placeholder="vault://tenant/sap-s4-maintenance"
              value={credential}
              onChange={(event) => setCredential(event.target.value)}
            />
          </div>
          <textarea
            className={`${input} mt-3 font-mono`}
            rows={3}
            aria-label="SAP process phase map"
            placeholder={"09 | completed\n02 | in_progress"}
            value={phaseMap}
            onChange={(event) => setPhaseMap(event.target.value)}
          />
          <textarea
            className={`${input} mt-3`}
            rows={2}
            placeholder="Activation authority and exact SAP planning-plant-to-site mapping basis (20+ characters)"
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
              Dry-run maintenance order pull
            </button>
            <button
              type="button"
              disabled={busy || key.trim().length < 3 || !enabled}
              onClick={() => void pull(false)}
              className="rounded-lg border border-amber-400/50 px-4 py-2 text-sm text-amber-200 disabled:opacity-40"
            >
              Import maintenance order headers
            </button>
          </div>
        </>
      )}
    </section>
  );
}
