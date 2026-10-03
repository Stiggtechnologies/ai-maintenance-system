import { useEffect, useState } from "react";
import { CloudCog, RefreshCw, ShieldCheck } from "lucide-react";
import { useAuth } from "./AuthProvider";
import {
  azureIotOperationsActions,
  type AzureIotOperationsStatus,
} from "../services/azureIotOperations";

const inputClass =
  "w-full rounded-lg border border-industrial-border bg-industrial-slate px-3 py-2 text-sm text-industrial-text outline-none focus:border-signal-cyan";

export function AzureIotOperationsConnectorSetup({
  onConfigured,
}: {
  onConfigured: () => Promise<void>;
}) {
  const { profile } = useAuth();
  const role = String(profile?.role ?? "").toLowerCase();
  const isAdmin = role === "admin" || role === "ai_admin";
  const [status, setStatus] = useState<AzureIotOperationsStatus | null>(null);
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [namespace, setNamespace] = useState("");
  const [hub, setHub] = useState("");
  const [interval, setInterval] = useState("1");
  const [ingressKeyId, setIngressKeyId] = useState("");
  const [credentialRef, setCredentialRef] = useState("");
  const [purpose, setPurpose] = useState("");
  const [rightsReference, setRightsReference] = useState("");
  const [basis, setBasis] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function refresh() {
    try {
      const next = await azureIotOperationsActions.status();
      setStatus(next);
      if (next.configured) {
        setKey((current) => current || next.connector_key || "");
        setName((current) => current || next.name || "");
        setIngressKeyId((current) => current || next.ingress_key_id || "");
        setEnabled(next.enabled);
        if (next.endpoint_hint) {
          try {
            const url = new URL(next.endpoint_hint);
            setNamespace((current) => current || url.hostname);
            setHub((current) => current || url.pathname.replace(/^\//, ""));
          } catch {
            // A malformed legacy hint stays visible in status and is not reused.
          }
        }
      }
    } catch (error) {
      setMessage((error as Error).message);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await azureIotOperationsActions.configure({
        key: key.trim(),
        name: name.trim(),
        eventHubsNamespace: namespace.trim(),
        eventHubName: hub.trim(),
        expectedIntervalMinutes: Number(interval),
        ingressKeyId: ingressKeyId.trim(),
        credentialBindingRef: credentialRef.trim(),
        contextPurpose: purpose.trim(),
        rightsReference: rightsReference.trim(),
        enabled,
        basis: basis.trim(),
      });
      setMessage(String(result.note ?? "Azure IoT Operations source saved."));
      await Promise.all([refresh(), onConfigured()]);
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const canSave =
    key.trim().length >= 3 &&
    name.trim().length >= 3 &&
    namespace.trim().endsWith(".servicebus.windows.net") &&
    hub.trim().length >= 1 &&
    ingressKeyId.trim().length >= 8 &&
    credentialRef.trim().length >= 8 &&
    purpose.trim().length >= 10 &&
    rightsReference.trim().length >= 8 &&
    basis.trim().length >= 40;

  return (
    <section className="rounded-xl border border-sky-400/25 bg-sky-400/5 p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <CloudCog className="mt-0.5 h-5 w-5 text-sky-300" />
          <div>
            <h2 className="font-semibold text-industrial-text">
              Azure IoT Operations · OPC UA telemetry
            </h2>
            <p className="mt-1 max-w-4xl text-sm text-slate-400">
              Governed read-only flow from the Azure IoT Operations OPC UA
              connector through MQTT, data flows and Event Hubs. SyncAI accepts
              only timestamped, signed telemetry batches. Plant writes, method
              calls, command topics and autonomous control are refused by
              design.
            </p>
          </div>
        </div>
        <button
          type="button"
          aria-label="Refresh Azure IoT Operations status"
          onClick={() => void refresh()}
          className="rounded-lg border border-industrial-border p-2 text-slate-300 hover:text-white"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {status && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatusCell
            label="State"
            value={
              status.live
                ? "Live"
                : status.enabled
                  ? "Awaiting evidence"
                  : "Disabled"
            }
          />
          <StatusCell
            label="Confirmed tag mappings"
            value={String(status.confirmed_tag_mappings)}
          />
          <StatusCell
            label="Rejected/unconfirmed mappings"
            value={String(status.unconfirmed_tag_mappings)}
          />
          <StatusCell
            label="Last accepted delivery"
            value={
              status.last_success_at
                ? new Date(status.last_success_at).toLocaleString()
                : "None yet"
            }
          />
        </div>
      )}
      {status?.basis && (
        <p className="mt-3 rounded-lg border border-industrial-border/70 bg-overlook-void/30 p-3 text-xs text-slate-400">
          {status.basis}
        </p>
      )}

      {!isAdmin ? (
        <p className="mt-4 text-sm text-slate-400">
          A named administrator must configure and authorize this source.
        </p>
      ) : (
        <>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <input
              className={inputClass}
              placeholder="Connector key, e.g. mine-a-aio"
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
            <input
              className={inputClass}
              placeholder="Display name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <input
              className={inputClass}
              placeholder="namespace.servicebus.windows.net"
              value={namespace}
              onChange={(e) => setNamespace(e.target.value)}
            />
            <input
              className={inputClass}
              placeholder="Event Hub name"
              value={hub}
              onChange={(e) => setHub(e.target.value)}
            />
            <input
              className={inputClass}
              type="number"
              min="1"
              max="1440"
              aria-label="Expected telemetry interval in minutes"
              value={interval}
              onChange={(e) => setInterval(e.target.value)}
            />
            <input
              className={inputClass}
              placeholder="Ingress key ID (not the key)"
              value={ingressKeyId}
              onChange={(e) => setIngressKeyId(e.target.value)}
            />
            <input
              className={inputClass}
              placeholder="keyvault://tenant/aio-relay"
              value={credentialRef}
              onChange={(e) => setCredentialRef(e.target.value)}
            />
            <input
              className={inputClass}
              placeholder="Operational purpose"
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
            />
            <input
              className={inputClass}
              placeholder="Customer authority / rights reference"
              value={rightsReference}
              onChange={(e) => setRightsReference(e.target.value)}
            />
          </div>
          <textarea
            className={`${inputClass} mt-3`}
            rows={3}
            placeholder="Activation, data-rights and read-only basis (40+ characters)"
            value={basis}
            onChange={(e) => setBasis(e.target.value)}
          />
          <label className="mt-3 flex gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            Enable only after the signed relay is deployed and at least one tag
            is human-confirmed in Data Governance.
          </label>
          {message && <p className="mt-3 text-sm text-slate-300">{message}</p>}
          <button
            type="button"
            disabled={busy || !canSave}
            onClick={() => void save()}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-sky-300 px-4 py-2 text-sm font-semibold text-overlook-void disabled:opacity-40"
          >
            <ShieldCheck className="h-4 w-4" />
            {enabled
              ? "Authorize read-only ingress"
              : "Save disabled configuration"}
          </button>
        </>
      )}
    </section>
  );
}

function StatusCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-industrial-border/70 bg-overlook-void/30 p-3">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-medium text-industrial-text">{value}</p>
    </div>
  );
}
