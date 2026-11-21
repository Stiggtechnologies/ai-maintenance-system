import { useState } from "react";
import { RadioTower, ShieldCheck } from "lucide-react";
import { useAuth } from "./AuthProvider";
import { opcUaReadActions } from "../services/opcUaRead";

const input =
  "w-full rounded-lg border border-industrial-border bg-industrial-slate px-3 py-2 text-sm text-industrial-text outline-none focus:border-signal-cyan";

const SECURITY_MODES = ["None", "Sign", "SignAndEncrypt"] as const;
const SECURITY_POLICIES = [
  "None",
  "Basic256Sha256",
  "Aes128_Sha256_RsaOaep",
  "Aes256_Sha256_RsaPss",
] as const;

export function OpcUaReadConnectorSetup({
  onConfigured,
}: {
  onConfigured: () => Promise<void>;
}) {
  const { profile } = useAuth();
  const admin = String(profile?.role ?? "").toLowerCase() === "admin";
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [endpointUrl, setEndpointUrl] = useState("");
  const [securityMode, setSecurityMode] =
    useState<(typeof SECURITY_MODES)[number]>("None");
  const [securityPolicy, setSecurityPolicy] =
    useState<(typeof SECURITY_POLICIES)[number]>("None");
  const [authMode, setAuthMode] = useState<"anonymous" | "username">(
    "anonymous",
  );
  const [nodeList, setNodeList] = useState("");
  const [interval, setInterval] = useState("60");
  const [credential, setCredential] = useState("");
  const [basis, setBasis] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const nodeIds = nodeList
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const valid =
    key.trim().length >= 3 &&
    name.trim().length >= 3 &&
    /^opc\.tcp:\/\/[A-Za-z0-9.-]+:\d{1,5}(\/[^?#\s]*)?$/.test(
      endpointUrl.trim(),
    ) &&
    nodeIds.length >= 1 &&
    nodeIds.length <= 50 &&
    Number.isSafeInteger(Number(interval)) &&
    Number(interval) >= 1 &&
    credential.trim().length > 0 &&
    basis.trim().length >= 20;

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await opcUaReadActions.configure({
        key: key.trim(),
        name: name.trim(),
        endpointUrl: endpointUrl.trim(),
        securityMode,
        securityPolicy,
        authMode,
        nodeIds,
        interval: Number(interval),
        credentialRef: credential.trim(),
        enabled,
        basis: basis.trim(),
      });
      setMessage(String(result.note ?? "OPC-UA source saved."));
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
      const result = await opcUaReadActions.pull(key.trim(), dryRun);
      const count = String(result.mapped_rows ?? result.raw_rows ?? 0);
      setMessage(
        `${dryRun ? "Dry run" : "Read"}: ${count} node values.${dryRun ? " No run, staging or watermark row was written." : ` Status ${String(result.status ?? "unknown")}; ${String(result.records_rejected ?? result.rejected ?? 0)} refused.`}`,
      );
      await onConfigured();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      id="opc-ua-read-setup"
      className="rounded-xl border border-signal-cyan/20 bg-signal-cyan/5 p-5"
    >
      <div className="flex items-start gap-3">
        <RadioTower className="mt-0.5 h-5 w-5 text-signal-cyan" />
        <div>
          <h2 className="font-semibold text-industrial-text">
            OPC-UA (read-only)
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            Read Value, status code and source timestamp for an explicit node
            list. The edge function calls a read-only gateway shim; it never
            issues Write or method calls. Built and tested against a mock OPC-UA
            server, not certified against a live server. Sign and SignAndEncrypt
            are stored and refused rather than downgraded to None.
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
              placeholder="OPC-UA connector key"
              value={key}
              onChange={(event) => setKey(event.target.value)}
            />
            <input
              className={input}
              placeholder="OPC-UA display name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <input
              className={input}
              aria-label="OPC-UA endpoint URL"
              placeholder="opc.tcp://plant.example.com:4840"
              value={endpointUrl}
              onChange={(event) => setEndpointUrl(event.target.value)}
            />
            <select
              className={input}
              aria-label="OPC-UA security mode"
              value={securityMode}
              onChange={(event) =>
                setSecurityMode(
                  event.target.value as (typeof SECURITY_MODES)[number],
                )
              }
            >
              {SECURITY_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  Security mode {mode}
                </option>
              ))}
            </select>
            <select
              className={input}
              aria-label="OPC-UA security policy"
              value={securityPolicy}
              onChange={(event) =>
                setSecurityPolicy(
                  event.target.value as (typeof SECURITY_POLICIES)[number],
                )
              }
            >
              {SECURITY_POLICIES.map((policy) => (
                <option key={policy} value={policy}>
                  Security policy {policy}
                </option>
              ))}
            </select>
            <select
              className={input}
              aria-label="OPC-UA authentication mode"
              value={authMode}
              onChange={(event) =>
                setAuthMode(event.target.value as "anonymous" | "username")
              }
            >
              <option value="anonymous">Anonymous</option>
              <option value="username">Username token</option>
            </select>
            <input
              className={input}
              aria-label="Expected OPC-UA interval minutes"
              type="number"
              min="1"
              value={interval}
              onChange={(event) => setInterval(event.target.value)}
            />
            <input
              className={input}
              placeholder="vault://tenant/opc-ua"
              value={credential}
              onChange={(event) => setCredential(event.target.value)}
            />
          </div>
          <textarea
            className={`${input} mt-3 font-mono`}
            rows={4}
            aria-label="OPC-UA node ids"
            placeholder={"ns=2;s=Pump.Speed\ni=2258"}
            value={nodeList}
            onChange={(event) => setNodeList(event.target.value)}
          />
          <textarea
            className={`${input} mt-3`}
            rows={2}
            placeholder="Activation authority and exact node-list basis (20+ characters)"
            value={basis}
            onChange={(event) => setBasis(event.target.value)}
          />
          <label className="mt-3 flex gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            Enable only after the gateway host, server allowlist and credential
            binding are present in the protected deployment.
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
              Dry-run node read
            </button>
            <button
              type="button"
              disabled={busy || key.trim().length < 3 || !enabled}
              onClick={() => void pull(false)}
              className="rounded-lg border border-amber-400/50 px-4 py-2 text-sm text-amber-200 disabled:opacity-40"
            >
              Record node snapshot
            </button>
          </div>
        </>
      )}
    </section>
  );
}
