import { useEffect, useState } from "react";
import { Activity, ShieldCheck } from "lucide-react";
import { useAuth } from "./AuthProvider";
import { listSites, type SiteOption } from "../services/reliabilityCallers";
import {
  parseSapApmIndicatorBindings,
  sapApmIndicatorReadActions,
} from "../services/sapApmIndicatorRead";

const input =
  "w-full rounded-lg border border-industrial-border bg-industrial-slate px-3 py-2 text-sm text-industrial-text outline-none focus:border-signal-cyan";

export function SapApmIndicatorReadConnectorSetup({
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
  const [technicalObject, setTechnicalObject] = useState("");
  const [siteId, setSiteId] = useState("");
  const [bindings, setBindings] = useState("");
  const [maxRows, setMaxRows] = useState("500");
  const [maxPages, setMaxPages] = useState("10");
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

  let parsedBindings: number;
  try {
    parsedBindings = parseSapApmIndicatorBindings(bindings).length;
  } catch {
    parsedBindings = -1;
  }
  const valid =
    key.trim().length >= 3 &&
    name.trim().length >= 3 &&
    serviceRoot.trim().length > 0 &&
    technicalObject.trim().length > 0 &&
    siteId.length > 0 &&
    parsedBindings >= 1 &&
    Number.isSafeInteger(Number(maxRows)) &&
    Number(maxRows) >= 1 &&
    Number(maxRows) <= 5000 &&
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
      const result = await sapApmIndicatorReadActions.configure({
        key: key.trim(),
        name: name.trim(),
        serviceRoot: serviceRoot.trim(),
        technicalObjectNumber: technicalObject.trim(),
        siteId,
        bindings: parseSapApmIndicatorBindings(bindings),
        maxRows: Number(maxRows),
        maxPages: Number(maxPages),
        interval: Number(interval),
        credentialRef: credential.trim(),
        enabled,
        basis: basis.trim(),
      });
      setMessage(String(result.note ?? "SAP APM indicator source saved."));
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
      const result = await sapApmIndicatorReadActions.pull(key.trim(), dryRun);
      setMessage(
        `${dryRun ? "Dry run" : "Pull"}: ${String(result.raw_rows ?? 0)} SAP indicators confirmed ${String(result.mapped_rows ?? 0)} canonical sensors across ${String(result.pages ?? 0)} pages.${dryRun ? " No run, staging, sensor or watermark row was written." : ` Status ${String(result.status ?? "unknown")}; ${String(result.records_rejected ?? 0)} refused.`}`,
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
        <Activity className="mt-0.5 h-5 w-5 text-signal-cyan" />
        <div>
          <h2 className="font-semibold text-industrial-text">
            SAP Asset Performance Management indicators (read-only)
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            GET IndicatorService/v1/Indicators for one technical object and
            confirm each binding against an existing sensor. This read does not
            write measurements, limits or a health score.
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
              placeholder="SAP APM connector key"
              value={key}
              onChange={(event) => setKey(event.target.value)}
            />
            <input
              className={input}
              placeholder="SAP APM display name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <input
              className={input}
              placeholder="https://api-apm.example.com/IndicatorService/v1"
              value={serviceRoot}
              onChange={(event) => setServiceRoot(event.target.value)}
            />
            <input
              className={input}
              aria-label="SAP APM technical object number"
              placeholder="Technical object number"
              value={technicalObject}
              onChange={(event) => setTechnicalObject(event.target.value)}
            />
            <select
              className={input}
              aria-label="Canonical indicator site"
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
              aria-label="Maximum SAP APM indicator rows"
              type="number"
              min="1"
              max="5000"
              value={maxRows}
              onChange={(event) => setMaxRows(event.target.value)}
            />
            <input
              className={input}
              aria-label="Maximum SAP APM pages"
              type="number"
              min="2"
              max="100"
              value={maxPages}
              onChange={(event) => setMaxPages(event.target.value)}
            />
            <input
              className={input}
              aria-label="Expected SAP APM interval minutes"
              type="number"
              min="1"
              value={interval}
              onChange={(event) => setInterval(event.target.value)}
            />
            <input
              className={input}
              placeholder="vault://tenant/sap-apm-indicators"
              value={credential}
              onChange={(event) => setCredential(event.target.value)}
            />
          </div>
          <textarea
            className={`${input} mt-3 font-mono`}
            rows={3}
            aria-label="SAP APM indicator bindings"
            placeholder="53 | position-id | M | EQUI | 00000000-0000-4000-8000-000000000001"
            value={bindings}
            onChange={(event) => setBindings(event.target.value)}
          />
          <textarea
            className={`${input} mt-3`}
            rows={2}
            placeholder="Activation authority and exact technical-object-to-sensor mapping basis (20+ characters)"
            value={basis}
            onChange={(event) => setBasis(event.target.value)}
          />
          <label className="mt-3 flex gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            Enable only after the exact APM host, OAuth bearer and API key are
            present in the protected deployment.
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
              Dry-run indicator confirmation
            </button>
            <button
              type="button"
              disabled={busy || key.trim().length < 3 || !enabled}
              onClick={() => void pull(false)}
              className="rounded-lg border border-amber-400/50 px-4 py-2 text-sm text-amber-200 disabled:opacity-40"
            >
              Confirm indicator bindings
            </button>
          </div>
        </>
      )}
    </section>
  );
}
