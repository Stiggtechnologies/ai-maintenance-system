import { useState } from "react";
import { Database, ShieldCheck } from "lucide-react";
import { useAuth } from "./AuthProvider";
import { cmmsReadActions } from "../services/cmmsRead";

const input =
  "w-full rounded-lg border border-industrial-border bg-industrial-slate px-3 py-2 text-sm text-industrial-text outline-none focus:border-signal-cyan";

export function CmmsReadConnectorSetup({
  onConfigured,
}: {
  onConfigured: () => Promise<void>;
}) {
  const { profile } = useAuth();
  const admin = String(profile?.role ?? "").toLowerCase() === "admin";
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState("generic_cmms");
  const [endpoint, setEndpoint] = useState("");
  const [interval, setInterval] = useState("60");
  const [credential, setCredential] = useState("");
  const [path, setPath] = useState("work_orders");
  const [paginationMode, setPaginationMode] = useState<"none" | "next_url">(
    "none",
  );
  const [paginationNextPath, setPaginationNextPath] = useState("links.next");
  const [paginationMaxPages, setPaginationMaxPages] = useState("20");
  const [basis, setBasis] = useState("");
  const [approved, setApproved] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const configuration = {
        key,
        name,
        systemKind: kind,
        endpointUrl: endpoint,
        interval: Number(interval),
        credentialRef: credential,
        paginationMode,
        paginationNextPath,
        paginationMaxPages: Number(paginationMaxPages),
        basis,
      };
      const staged = await cmmsReadActions.configure({
        ...configuration,
        enabled: false,
      });
      const mapped = await cmmsReadActions.map(key, path, approved, basis);
      const configured = enabled
        ? await cmmsReadActions.configure({ ...configuration, enabled: true })
        : staged;
      setMessage(
        `${String(configured.note ?? "CMMS source saved.")} ${String(mapped.note ?? "")}`,
      );
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
      const result = await cmmsReadActions.pull(key, dryRun);
      setMessage(
        `${dryRun ? "Dry run" : "Pull"}: ${String(result.pages ?? 1)} page(s), read ${String(result.read ?? 0)}, accepted ${String(result.accepted ?? 0)}, rejected ${String(result.rejected ?? 0)}.${dryRun ? " No rows written." : ""}`,
      );
      await onConfigured();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const paginationValid =
    paginationMode === "none" ||
    (paginationNextPath.trim().length > 0 &&
      Number(paginationMaxPages) >= 2 &&
      Number(paginationMaxPages) <= 100);

  return (
    <section className="rounded-xl border border-signal-cyan/20 bg-signal-cyan/5 p-5">
      <div className="flex items-start gap-3">
        <Database className="mt-0.5 h-5 w-5 text-signal-cyan" />
        <div>
          <h2 className="font-semibold text-industrial-text">
            CMMS work orders (read-only)
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            Pull work orders from an approved HTTPS JSON CMMS export. SyncAI
            never writes back. Enable only after the host allow-list and opaque
            Edge secret binding are deployed.
          </p>
        </div>
      </div>
      {!admin ? (
        <p className="mt-4 text-sm text-slate-400">
          A named human administrator must configure or enable this source.
        </p>
      ) : (
        <>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <input
              className={input}
              placeholder="Connector key"
              value={key}
              onChange={(event) => setKey(event.target.value)}
            />
            <input
              className={input}
              placeholder="Display name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <select
              className={input}
              value={kind}
              onChange={(event) => setKind(event.target.value)}
            >
              <option value="generic_cmms">Generic CMMS JSON</option>
              <option value="sap_pm">SAP PM</option>
              <option value="maximo">IBM Maximo</option>
              <option value="oracle_eam">Oracle EAM</option>
            </select>
            <input
              className={input}
              placeholder="https://cmms.example.com/work-orders"
              value={endpoint}
              onChange={(event) => setEndpoint(event.target.value)}
            />
            <input
              aria-label="Expected interval minutes"
              className={input}
              type="number"
              min="1"
              value={interval}
              onChange={(event) => setInterval(event.target.value)}
            />
            <input
              className={input}
              placeholder="vault://tenant/cmms"
              value={credential}
              onChange={(event) => setCredential(event.target.value)}
            />
            <input
              className={input}
              placeholder="JSON array path"
              value={path}
              onChange={(event) => setPath(event.target.value)}
            />
            <select
              aria-label="Pagination mode"
              className={input}
              value={paginationMode}
              onChange={(event) =>
                setPaginationMode(event.target.value as "none" | "next_url")
              }
            >
              <option value="none">Single response</option>
              <option value="next_url">Same-origin next-link pagination</option>
            </select>
            {paginationMode === "next_url" && (
              <>
                <input
                  aria-label="Next-link JSON path"
                  className={input}
                  placeholder="Next-link JSON path (for example links.next)"
                  value={paginationNextPath}
                  onChange={(event) =>
                    setPaginationNextPath(event.target.value)
                  }
                />
                <input
                  aria-label="Maximum pages per pull"
                  className={input}
                  type="number"
                  min="2"
                  max="100"
                  placeholder="Maximum pages per pull"
                  value={paginationMaxPages}
                  onChange={(event) =>
                    setPaginationMaxPages(event.target.value)
                  }
                />
              </>
            )}
          </div>
          <textarea
            className={`${input} mt-3`}
            rows={2}
            placeholder="Activation authority and mapping basis (20+ characters)"
            value={basis}
            onChange={(event) => setBasis(event.target.value)}
          />
          <label className="mt-3 flex gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={approved}
              onChange={(event) => setApproved(event.target.checked)}
            />
            Approve the displayed canonical work-order mapping.
          </label>
          <label className="mt-2 flex gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            Enable this read-only source after deployment configuration is
            present.
          </label>
          {message && <p className="mt-3 text-sm text-slate-300">{message}</p>}
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={
                busy ||
                key.trim().length < 3 ||
                name.trim().length < 3 ||
                basis.trim().length < 20 ||
                !paginationValid
              }
              onClick={() => void save()}
              className="inline-flex items-center gap-2 rounded-lg bg-signal-cyan px-4 py-2 text-sm font-semibold text-overlook-void disabled:opacity-40"
            >
              <ShieldCheck className="h-4 w-4" />
              {enabled ? "Save and enable" : "Save disabled configuration"}
            </button>
            <button
              type="button"
              disabled={busy || key.trim().length < 3}
              onClick={() => void pull(true)}
              className="rounded-lg border border-industrial-border px-4 py-2 text-sm text-industrial-text disabled:opacity-40"
            >
              Dry-run pull
            </button>
            <button
              type="button"
              disabled={busy || key.trim().length < 3 || !enabled || !approved}
              onClick={() => void pull(false)}
              className="rounded-lg border border-amber-400/50 px-4 py-2 text-sm text-amber-200 disabled:opacity-40"
            >
              Pull approved rows
            </button>
          </div>
        </>
      )}
    </section>
  );
}
