import { useState } from "react";
import { Radio, ShieldCheck } from "lucide-react";
import { useAuth } from "./AuthProvider";
import { mqttReadActions } from "../services/mqttRead";

const input =
  "w-full rounded-lg border border-industrial-border bg-industrial-slate px-3 py-2 text-sm text-industrial-text outline-none focus:border-signal-cyan";

function topicFilters(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function MqttReadConnectorSetup({
  onConfigured,
}: {
  onConfigured: () => Promise<void>;
}) {
  const { profile } = useAuth();
  const admin = String(profile?.role ?? "").toLowerCase() === "admin";
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [brokerUrl, setBrokerUrl] = useState("");
  const [filters, setFilters] = useState("");
  const [windowSeconds, setWindowSeconds] = useState("10");
  const [maxMessages, setMaxMessages] = useState("100");
  const [subscribeQos, setSubscribeQos] = useState("0");
  const [interval, setInterval] = useState("60");
  const [credential, setCredential] = useState("");
  const [basis, setBasis] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const parsedFilters = topicFilters(filters);

  const valid =
    key.trim().length >= 3 &&
    name.trim().length >= 3 &&
    brokerUrl.trim().startsWith("wss://") &&
    parsedFilters.length >= 1 &&
    parsedFilters.length <= 8 &&
    parsedFilters.every((filter) => filter.length <= 256) &&
    Number.isSafeInteger(Number(windowSeconds)) &&
    Number(windowSeconds) >= 1 &&
    Number(windowSeconds) <= 30 &&
    Number.isSafeInteger(Number(maxMessages)) &&
    Number(maxMessages) >= 1 &&
    Number(maxMessages) <= 200 &&
    ["0", "1", "2"].includes(subscribeQos) &&
    Number.isSafeInteger(Number(interval)) &&
    Number(interval) >= 1 &&
    credential.trim().length > 0 &&
    basis.trim().length >= 20;

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await mqttReadActions.configure({
        key: key.trim(),
        name: name.trim(),
        brokerUrl: brokerUrl.trim(),
        topicFilters: parsedFilters,
        windowSeconds: Number(windowSeconds),
        maxMessages: Number(maxMessages),
        subscribeQos: Number(subscribeQos),
        interval: Number(interval),
        credentialRef: credential.trim(),
        enabled,
        basis: basis.trim(),
      });
      setMessage(String(result.note ?? "MQTT source saved."));
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
      const result = await mqttReadActions.pull(key.trim(), dryRun);
      const silence =
        Number(result.messages ?? 0) === 0
          ? " Silence is not a process state."
          : "";
      setMessage(
        `${dryRun ? "Dry run" : "Listen"}: ${String(result.messages ?? 0)} messages, ${String(result.bytes ?? 0)} bytes.${result.truncated ? " The approved cap stopped the window early." : ""}${dryRun ? " No run or staging row was written." : ` Status ${String(result.status ?? "unknown")}; ${String(result.records_rejected ?? 0)} refused.`}${silence}`,
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
      id="mqtt-read-setup"
      className="rounded-xl border border-signal-cyan/20 bg-signal-cyan/5 p-5"
    >
      <div className="flex items-start gap-3">
        <Radio className="mt-0.5 h-5 w-5 text-signal-cyan" />
        <div>
          <h2 className="font-semibold text-industrial-text">
            MQTT broker (read-only)
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            Subscribe to an allowlisted broker over TLS WebSockets, keep the
            topic, payload, QoS, and received time for a bounded window, then
            disconnect. This adapter never publishes. Messages stay staged
            evidence and are not turned into condition readings or limits. Built
            and tested against a mock broker only — not certified against a live
            broker.
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
              placeholder="MQTT connector key"
              value={key}
              onChange={(event) => setKey(event.target.value)}
            />
            <input
              className={input}
              placeholder="MQTT display name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <input
              className={input}
              aria-label="MQTT broker URL"
              placeholder="wss://broker.example.com/mqtt"
              value={brokerUrl}
              onChange={(event) => setBrokerUrl(event.target.value)}
            />
            <textarea
              className={input}
              aria-label="MQTT topic filters"
              rows={3}
              placeholder={"plant/line1/#\nplant/line1/status"}
              value={filters}
              onChange={(event) => setFilters(event.target.value)}
            />
            <input
              className={input}
              aria-label="MQTT listen window seconds"
              type="number"
              min="1"
              max="30"
              value={windowSeconds}
              onChange={(event) => setWindowSeconds(event.target.value)}
            />
            <input
              className={input}
              aria-label="Maximum MQTT messages"
              type="number"
              min="1"
              max="200"
              value={maxMessages}
              onChange={(event) => setMaxMessages(event.target.value)}
            />
            <select
              className={input}
              aria-label="MQTT subscribe QoS"
              value={subscribeQos}
              onChange={(event) => setSubscribeQos(event.target.value)}
            >
              <option value="0">Subscribe QoS 0</option>
              <option value="1">Subscribe QoS 1</option>
              <option value="2">Subscribe QoS 2</option>
            </select>
            <input
              className={input}
              aria-label="Expected MQTT interval minutes"
              type="number"
              min="1"
              value={interval}
              onChange={(event) => setInterval(event.target.value)}
            />
            <input
              className={input}
              placeholder="vault://tenant/mqtt-read"
              value={credential}
              onChange={(event) => setCredential(event.target.value)}
            />
          </div>
          <textarea
            className={`${input} mt-3`}
            rows={2}
            placeholder="Activation authority and broker/topic basis (20+ characters)"
            value={basis}
            onChange={(event) => setBasis(event.target.value)}
          />
          <label className="mt-3 flex gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            Enable only after the exact broker host and username/password
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
              Dry-run listen
            </button>
            <button
              type="button"
              disabled={busy || key.trim().length < 3 || !enabled}
              onClick={() => void pull(false)}
              className="rounded-lg border border-amber-400/50 px-4 py-2 text-sm text-amber-200 disabled:opacity-40"
            >
              Retain listen evidence
            </button>
          </div>
        </>
      )}
    </section>
  );
}
