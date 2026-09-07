/**
 * Administrator setup for the thin read-only plant historian pull.
 * Credentials stay in PLANT_HISTORIAN_CREDENTIALS_JSON; this form records
 * only an opaque binding URI and a credential-free HTTPS endpoint.
 */
import { useState } from "react";
import { Radio, ShieldCheck } from "lucide-react";
import { useAuth } from "./AuthProvider";
import { plantHistorianActions } from "../services/plantHistorian";
import { DEFAULT_HISTORIAN_COLUMN_MAPPING } from "../lib/plant-historian";

const inputClass =
  "w-full rounded-lg border border-industrial-border bg-industrial-slate px-3 py-2 text-sm text-industrial-text outline-none focus:border-signal-cyan";

export function PlantHistorianConnectorSetup({
  onConfigured,
}: {
  onConfigured: () => Promise<void>;
}) {
  const { profile } = useAuth();
  const role = String(profile?.role ?? "").toLowerCase();
  const isAdmin = role === "admin" || role === "ai_admin";
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [systemKind, setSystemKind] = useState<
    "historian" | "condition_monitoring"
  >("historian");
  const [endpointUrl, setEndpointUrl] = useState("");
  const [interval, setInterval] = useState("15");
  const [credentialRef, setCredentialRef] = useState("");
  const [sourceArrayPath, setSourceArrayPath] = useState("readings");
  const [basis, setBasis] = useState("");
  const [approveMapping, setApproveMapping] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function save() {
    setWorking(true);
    setError(null);
    setMessage(null);
    try {
      const configured = await plantHistorianActions.configureSource({
        key,
        name,
        systemKind,
        endpointUrl: endpointUrl.trim() || null,
        expectedIntervalMinutes: Number(interval),
        credentialBindingRef: credentialRef.trim() || null,
        enabled,
        basis,
      });
      const mapped = await plantHistorianActions.saveMapping({
        connectorKey: key.trim(),
        sourceArrayPath: sourceArrayPath.trim(),
        columnMapping: DEFAULT_HISTORIAN_COLUMN_MAPPING,
        approve: approveMapping,
        basis,
      });
      setMessage(
        [
          String(configured.note ?? "Historian source saved."),
          String(mapped.note ?? ""),
        ]
          .filter(Boolean)
          .join(" "),
      );
      await onConfigured();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setWorking(false);
    }
  }

  async function pull(dryRun: boolean) {
    setWorking(true);
    setError(null);
    setMessage(null);
    try {
      const result = await plantHistorianActions.pull(key.trim(), dryRun);
      setMessage(
        dryRun
          ? `Dry run: read ${String(result.read ?? 0)}, accepted ${String(result.accepted ?? 0)}, rejected ${String(result.rejected ?? 0)}. No canonical rows written.`
          : `Pull ${String(result.status ?? "complete")}: accepted ${String(result.accepted ?? 0)}, rejected ${String(result.rejected ?? 0)}.`,
      );
      await onConfigured();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setWorking(false);
    }
  }

  return (
    <section className="rounded-xl border border-signal-cyan/20 bg-signal-cyan/5 p-5">
      <div className="flex items-start gap-3">
        <Radio className="mt-0.5 h-5 w-5 text-signal-cyan" />
        <div>
          <h2 className="font-semibold text-industrial-text">
            Plant historian (read-only)
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            Point SyncAI at a HTTPS JSON historian or condition-monitoring
            export. This is a thin read: no write-back, no execute, no
            unattended polling. When unset or disabled, seed/sim telemetry
            stays in force and is never labelled live plant data. Deploy
            <code className="mx-1 text-slate-300">
              PLANT_HISTORIAN_ALLOWED_HOSTS
            </code>
            and
            <code className="mx-1 text-slate-300">
              PLANT_HISTORIAN_CREDENTIALS_JSON
            </code>
            on the Edge Function before enabling.
          </p>
        </div>
      </div>

      {!isAdmin ? (
        <p className="mt-4 rounded-lg border border-industrial-border p-3 text-sm text-slate-400">
          An administrator must configure or enable the plant historian source.
        </p>
      ) : (
        <>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <input
              className={inputClass}
              placeholder="Connector key, e.g. site-a-pi"
              value={key}
              onChange={(event) => setKey(event.target.value)}
            />
            <input
              className={inputClass}
              placeholder="Display name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <select
              className={inputClass}
              value={systemKind}
              onChange={(event) =>
                setSystemKind(
                  event.target.value as "historian" | "condition_monitoring",
                )
              }
            >
              <option value="historian">Process historian</option>
              <option value="condition_monitoring">
                Condition-monitoring platform
              </option>
            </select>
            <input
              className={inputClass}
              placeholder="https://historian.example.com/readings"
              value={endpointUrl}
              onChange={(event) => setEndpointUrl(event.target.value)}
            />
            <input
              className={inputClass}
              type="number"
              min="1"
              placeholder="Expected interval (minutes)"
              value={interval}
              onChange={(event) => setInterval(event.target.value)}
            />
            <input
              className={inputClass}
              placeholder="Opaque binding, e.g. vault://tenant/historian"
              value={credentialRef}
              onChange={(event) => setCredentialRef(event.target.value)}
            />
            <input
              className={inputClass}
              placeholder="JSON array path, e.g. readings"
              value={sourceArrayPath}
              onChange={(event) => setSourceArrayPath(event.target.value)}
            />
          </div>
          <textarea
            className={`${inputClass} mt-3`}
            rows={2}
            placeholder="Configuration/activation authority and basis (20+ characters)"
            value={basis}
            onChange={(event) => setBasis(event.target.value)}
          />
          <label className="mt-3 flex items-start gap-2 text-sm text-slate-300">
            <input
              className="mt-1"
              type="checkbox"
              checked={approveMapping}
              onChange={(event) => setApproveMapping(event.target.checked)}
            />
            <span>
              Approve the default condition_reading field mapping
              (external_id, sensor_name, value, taken_at, quality).
            </span>
          </label>
          <label className="mt-2 flex items-start gap-2 text-sm text-slate-300">
            <input
              className="mt-1"
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            <span>
              Enable the source. Only select this after the host is on the
              deployment allowlist and the secret binding exists. Enabling
              yields the telemetry simulator for this organization.
            </span>
          </label>
          {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
          {message && (
            <p className="mt-3 text-sm text-emerald-300">{message}</p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void save()}
              disabled={
                working ||
                key.trim().length < 3 ||
                name.trim().length < 3 ||
                basis.trim().length < 20 ||
                !Number.isFinite(Number(interval)) ||
                Number(interval) < 1 ||
                (enabled &&
                  (endpointUrl.trim().length < 12 ||
                    credentialRef.trim().length < 8))
              }
              className="inline-flex items-center gap-2 rounded-lg bg-signal-cyan px-4 py-2 text-sm font-semibold text-overlook-void disabled:opacity-40"
            >
              <ShieldCheck className="h-4 w-4" />
              {enabled ? "Save and enable" : "Save disabled configuration"}
            </button>
            <button
              type="button"
              onClick={() => void pull(true)}
              disabled={working || key.trim().length < 3}
              className="rounded-lg border border-industrial-border px-4 py-2 text-sm text-slate-300 disabled:opacity-40"
            >
              Dry-run pull
            </button>
            <button
              type="button"
              onClick={() => void pull(false)}
              disabled={working || key.trim().length < 3 || !enabled}
              className="rounded-lg border border-signal-cyan/40 px-4 py-2 text-sm text-signal-cyan disabled:opacity-40"
            >
              Pull readings
            </button>
          </div>
        </>
      )}
    </section>
  );
}
