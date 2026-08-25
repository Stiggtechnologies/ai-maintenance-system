import { useState } from "react";
import { Cable, ShieldCheck } from "lucide-react";
import { useAuth } from "./AuthProvider";
import { recoveryActions } from "../services/syncRecoveryService";

const inputClass =
  "w-full rounded-lg border border-industrial-border bg-industrial-slate px-3 py-2 text-sm text-industrial-text outline-none focus:border-teal-500";

export function RecoverySignalConnectorSetup({
  onConfigured,
}: {
  onConfigured: () => Promise<void>;
}) {
  const { profile } = useAuth();
  const role = String(profile?.role ?? "").toLowerCase();
  const isAdmin = role === "admin" || role === "ai_admin";
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [systemKind, setSystemKind] = useState("scheduling");
  const [endpointHint, setEndpointHint] = useState("");
  const [interval, setInterval] = useState("15");
  const [credentialRef, setCredentialRef] = useState("");
  const [basis, setBasis] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function configure() {
    setWorking(true);
    setError(null);
    setMessage(null);
    try {
      const result = await recoveryActions.configureSignalConnector({
        key,
        name,
        systemKind,
        endpointHint,
        expectedIntervalMinutes: Number(interval),
        credentialBindingRef: credentialRef,
        enabled,
        basis,
      });
      setMessage(
        String(result.note ?? "Recovery signal connector configured."),
      );
      await onConfigured();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setWorking(false);
    }
  }

  return (
    <section className="rounded-xl border border-teal-500/20 bg-teal-500/5 p-5">
      <div className="flex items-start gap-3">
        <Cable className="mt-0.5 h-5 w-5 text-teal-400" />
        <div>
          <h2 className="font-semibold text-industrial-text">
            Recovery operational-signal feed
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            Configure weather, vendor/OEM or production-plan adapters against
            the validated connector-run contract. Credential values stay in the
            external secret store; SyncAI records only an opaque binding URI.
          </p>
        </div>
      </div>

      {!isAdmin ? (
        <p className="mt-4 rounded-lg border border-industrial-border p-3 text-sm text-slate-400">
          An administrator must configure or activate tenant feeds.
        </p>
      ) : (
        <>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <input
              className={inputClass}
              placeholder="Connector key, e.g. mine-plan-prod"
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
              onChange={(event) => setSystemKind(event.target.value)}
            >
              <option value="scheduling">Scheduling / mine plan</option>
              <option value="data_lake">Weather / data lake</option>
              <option value="document">Vendor / OEM service</option>
              <option value="historian">Historian</option>
              <option value="file">Managed file feed</option>
            </select>
            <input
              className={inputClass}
              placeholder="Endpoint hint (never a credential)"
              value={endpointHint}
              onChange={(event) => setEndpointHint(event.target.value)}
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
              placeholder="Opaque binding, e.g. vault://tenant/weather"
              value={credentialRef}
              onChange={(event) => setCredentialRef(event.target.value)}
            />
          </div>
          <textarea
            className={`${inputClass} mt-3`}
            rows={2}
            placeholder="Configuration/activation authority and basis (15+ characters)"
            value={basis}
            onChange={(event) => setBasis(event.target.value)}
          />
          <label className="mt-3 flex items-start gap-2 text-sm text-slate-300">
            <input
              className="mt-1"
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            <span>
              Activate polling contract. Only select this after the named secret
              binding exists and the external adapter is deployed.
            </span>
          </label>
          {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
          {message && (
            <p className="mt-3 text-sm text-emerald-300">{message}</p>
          )}
          <button
            type="button"
            onClick={() => void configure()}
            disabled={
              working ||
              key.trim().length < 3 ||
              name.trim().length < 3 ||
              basis.trim().length < 15 ||
              !Number.isFinite(Number(interval)) ||
              Number(interval) < 1 ||
              (enabled &&
                (endpointHint.trim().length < 3 ||
                  credentialRef.trim().length < 8))
            }
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            <ShieldCheck className="h-4 w-4" />
            {enabled ? "Configure and activate" : "Save disabled configuration"}
          </button>
        </>
      )}
    </section>
  );
}
