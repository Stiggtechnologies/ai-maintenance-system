import { useEffect, useMemo, useState } from "react";
import { Activity, ShieldCheck } from "lucide-react";
import { useAuth } from "./AuthProvider";
import { loadConditionSensorRegistry } from "../services/conditionSensorRegistryService";
import {
  bentlySystem1ReadActions,
  parseSystem1NodeBindings,
} from "../services/bentlySystem1Read";

const input =
  "w-full rounded-lg border border-industrial-border bg-industrial-slate px-3 py-2 text-sm text-industrial-text outline-none focus:border-signal-cyan";

export function BentlySystem1ConnectorSetup({
  onConfigured,
}: {
  onConfigured: () => Promise<void>;
}) {
  const { profile } = useAuth();
  const role = String(profile?.role ?? "").toLowerCase();
  const admin = role === "admin";
  const canPull = [
    "reliability_engineer",
    "maintenance_manager",
    "admin",
  ].includes(role);
  const canDryRun = canPull || role === "ai_admin";
  const [sensors, setSensors] = useState<
    Array<{ id: string; label: string; unit: string }>
  >([]);
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [credential, setCredential] = useState("");
  const [bindingsText, setBindingsText] = useState("");
  const [maxRows, setMaxRows] = useState("5000");
  const [pageSize, setPageSize] = useState("500");
  const [maxPages, setMaxPages] = useState("20");
  const [interval, setInterval] = useState("15");
  const [basis, setBasis] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!admin) return;
    let active = true;
    void loadConditionSensorRegistry()
      .then((workspace) => {
        if (!active) return;
        setSensors(
          workspace.sensors
            .filter((sensor) => sensor.registryStatus === "active")
            .map((sensor) => ({
              id: sensor.sensorId,
              label: `${sensor.assetTag} · ${sensor.sensorTag ?? sensor.name}`,
              unit: sensor.unit ?? "unit not recorded",
            })),
        );
      })
      .catch((error: Error) => {
        if (active) setMessage(error.message);
      });
    return () => {
      active = false;
    };
  }, [admin]);

  const parsedBindings = useMemo(() => {
    try {
      return parseSystem1NodeBindings(bindingsText);
    } catch {
      return null;
    }
  }, [bindingsText]);

  const valid =
    key.trim().length >= 3 &&
    name.trim().length >= 3 &&
    endpoint.trim().length >= 12 &&
    credential.trim().length >= 8 &&
    parsedBindings !== null &&
    Number.isSafeInteger(Number(maxRows)) &&
    Number(maxRows) >= 1 &&
    Number(maxRows) <= 5000 &&
    Number.isSafeInteger(Number(pageSize)) &&
    Number(pageSize) >= 1 &&
    Number(pageSize) <= Math.min(1000, Number(maxRows)) &&
    Number.isSafeInteger(Number(maxPages)) &&
    Number(maxPages) >= 1 &&
    Number(maxPages) <= 100 &&
    Number.isSafeInteger(Number(interval)) &&
    Number(interval) >= 1 &&
    basis.trim().length >= 20;

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await bentlySystem1ReadActions.configure({
        key: key.trim(),
        name: name.trim(),
        endpoint: endpoint.trim(),
        credentialRef: credential.trim(),
        bindings: parseSystem1NodeBindings(bindingsText),
        maxRows: Number(maxRows),
        pageSize: Number(pageSize),
        maxPages: Number(maxPages),
        interval: Number(interval),
        enabled,
        basis: basis.trim(),
      });
      setMessage(String(result.note ?? "System 1 source saved."));
      await onConfigured();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function pull(dryRun: boolean) {
    setBusy(true);
    setMessage(null);
    try {
      const result = await bentlySystem1ReadActions.pull(key.trim(), dryRun);
      setMessage(
        `${dryRun ? "Dry run" : "Pull"}: validated ${String(result.raw_rows ?? 0)} System 1 samples across ${String(result.pages ?? 0)} page(s). ${dryRun ? "No run, staging, reading, alert or watermark row was written." : `Status ${String(result.status ?? "unknown")}; accepted ${String(result.records_accepted ?? 0)}, duplicate ${String(result.records_duplicate ?? 0)}, refused ${String(result.records_rejected ?? 0)}.`}`,
      );
      await onConfigured();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-cyan-400/20 bg-cyan-400/5 p-5">
      <div className="flex items-start gap-3">
        <Activity className="mt-0.5 h-5 w-5 text-cyan-300" aria-hidden />
        <div>
          <h2 className="font-semibold text-industrial-text">
            Bently Nevada System 1 condition data (read-only)
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            Read approved OPC UA measurement points through a customer-operated
            System 1 gateway. Exact node, canonical sensor and unit bindings are
            frozen into the source contract. SyncAI cannot write OPC values,
            acknowledge alarms, change limits or control equipment.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <input
          className={input}
          aria-label="System 1 connector key"
          placeholder="System 1 connector key"
          value={key}
          onChange={(event) => setKey(event.target.value)}
        />
        {admin && (
          <>
            <input
              className={input}
              placeholder="System 1 display name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <input
              className={input}
              placeholder="https://gateway.example.com/syncai/v1/system1/readings"
              value={endpoint}
              onChange={(event) => setEndpoint(event.target.value)}
            />
            <input
              className={input}
              placeholder="vault://tenant/system1-gateway"
              value={credential}
              onChange={(event) => setCredential(event.target.value)}
            />
            <input
              className={input}
              aria-label="Maximum System 1 rows"
              type="number"
              min="1"
              max="5000"
              value={maxRows}
              onChange={(event) => setMaxRows(event.target.value)}
            />
            <input
              className={input}
              aria-label="System 1 page size"
              type="number"
              min="1"
              max="1000"
              value={pageSize}
              onChange={(event) => setPageSize(event.target.value)}
            />
            <input
              className={input}
              aria-label="Maximum System 1 pages"
              type="number"
              min="1"
              max="100"
              value={maxPages}
              onChange={(event) => setMaxPages(event.target.value)}
            />
            <input
              className={input}
              aria-label="Expected System 1 interval minutes"
              type="number"
              min="1"
              value={interval}
              onChange={(event) => setInterval(event.target.value)}
            />
          </>
        )}
      </div>

      {admin ? (
        <>
          <textarea
            className={`${input} mt-3 font-mono`}
            rows={6}
            aria-label="Approved System 1 node bindings"
            placeholder={
              "One binding per line:\nOPC_UA_NODE_ID | CANONICAL_SENSOR_UUID | EXACT_UNIT"
            }
            value={bindingsText}
            onChange={(event) => setBindingsText(event.target.value)}
          />
          {sensors.length > 0 && (
            <p className="mt-2 text-xs text-slate-400">
              Active canonical sensors: {sensors
                .map((sensor) => `${sensor.label} · ${sensor.id} · ${sensor.unit}`)
                .join("; ")}
            </p>
          )}
          <textarea
            className={`${input} mt-3`}
            rows={2}
            placeholder="Human approval basis for the gateway, OPC UA nodes, sensor identities and units (20+ characters)"
            value={basis}
            onChange={(event) => setBasis(event.target.value)}
          />
          <label className="mt-3 flex gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            Enable only after the gateway host, tenant-bound credential and
            exact node/sensor/unit bindings are independently verified
          </label>
          <button
            type="button"
            disabled={!valid || busy}
            onClick={() => void save()}
            className="mt-4 rounded-lg bg-cyan-300 px-4 py-2 text-sm font-semibold text-industrial-navy disabled:cursor-not-allowed disabled:opacity-40"
          >
            Save governed System 1 source
          </button>
        </>
      ) : (
        <p className="mt-4 text-sm text-slate-400">
          A named human administrator must configure, map or enable this
          source. Authorized reliability and maintenance users may run it;
          AI administrators are limited to write-free validation.
        </p>
      )}

      {(canDryRun || canPull) && (
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!key.trim() || busy}
            onClick={() => void pull(true)}
            className="rounded-lg border border-industrial-border px-4 py-2 text-sm text-industrial-text disabled:opacity-40"
          >
            Validate complete dry run
          </button>
          {canPull && (
            <button
              type="button"
              disabled={!key.trim() || busy}
              onClick={() => void pull(false)}
              className="rounded-lg border border-cyan-300/50 px-4 py-2 text-sm text-cyan-300 disabled:opacity-40"
            >
              Pull governed readings
            </button>
          )}
        </div>
      )}

      <div className="mt-3 flex items-start gap-2 text-xs text-slate-400">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
        GET only, bounded, page-hashed and replay-safe. Non-good readings are
        retained as evidence but cannot create or clear an alert. Only a clean,
        fully reconciled run advances the source watermark.
      </div>
      {message && (
        <p className="mt-3 text-sm text-slate-300" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
