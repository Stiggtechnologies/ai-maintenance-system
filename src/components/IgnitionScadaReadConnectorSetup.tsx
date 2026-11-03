import { useState } from "react";
import { Gauge, ShieldCheck } from "lucide-react";
import { useAuth } from "./AuthProvider";
import { ignitionScadaReadActions } from "../services/ignitionScadaRead";

const input =
  "w-full rounded-lg border border-industrial-border bg-industrial-slate px-3 py-2 text-sm text-industrial-text outline-none focus:border-signal-cyan";

const TAG_PATH = /^\[[A-Za-z][A-Za-z0-9_-]{0,63}\][^\s?#]{1,180}$/;

function parseTagPaths(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function IgnitionScadaReadConnectorSetup({
  onConfigured,
}: {
  onConfigured: () => Promise<void>;
}) {
  const { profile } = useAuth();
  const admin = String(profile?.role ?? "").toLowerCase() === "admin";
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [resourceUrl, setResourceUrl] = useState("");
  const [tags, setTags] = useState("");
  const [interval, setInterval] = useState("60");
  const [credential, setCredential] = useState("");
  const [basis, setBasis] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const tagPaths = parseTagPaths(tags);
  const tagsValid =
    tagPaths.length >= 1 &&
    tagPaths.length <= 20 &&
    new Set(tagPaths).size === tagPaths.length &&
    tagPaths.every(
      (path) =>
        TAG_PATH.test(path) && !path.includes("..") && !/write/i.test(path),
    );
  const resourceValid =
    /^https:\/\/[A-Za-z0-9.-]+(?::443)?\/system\/webdev\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_.-]+)+\/?$/.test(
      resourceUrl.trim(),
    ) && !/write|localhost|127\.0\.0\.1/i.test(resourceUrl);

  const valid =
    key.trim().length >= 3 &&
    name.trim().length >= 3 &&
    resourceValid &&
    tagsValid &&
    Number.isSafeInteger(Number(interval)) &&
    Number(interval) >= 1 &&
    Number(interval) <= 525600 &&
    credential.trim().length > 0 &&
    basis.trim().length >= 20;

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await ignitionScadaReadActions.configure({
        key: key.trim(),
        name: name.trim(),
        resourceUrl: resourceUrl.trim(),
        tagPaths,
        interval: Number(interval),
        credentialRef: credential.trim(),
        enabled,
        basis: basis.trim(),
      });
      setMessage(String(result.note ?? "Ignition source saved."));
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
      const result = await ignitionScadaReadActions.pull(key.trim(), dryRun);
      const tagsRead = Array.isArray(result.tags) ? result.tags : [];
      const preview = tagsRead
        .slice(0, 3)
        .map((tag) => {
          const row = tag as {
            path?: unknown;
            value?: unknown;
            quality?: unknown;
          };
          return `${String(row.path ?? "")}=${String(row.value)} (${String(row.quality ?? "")})`;
        })
        .join("; ");
      setMessage(
        `${dryRun ? "Dry run" : "Read"}: ${String(result.raw_rows ?? 0)} Ignition tags across ${String(result.pages ?? 0)} GETs.${preview ? ` ${preview}.` : ""}${dryRun ? " No run, staging or watermark row was written." : ` Status ${String(result.status ?? "unknown")}; ${String(result.records_rejected ?? 0)} refused.`}`,
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
      id="ignition-scada-read-setup"
      className="rounded-xl border border-signal-cyan/20 bg-signal-cyan/5 p-5"
    >
      <div className="flex items-start gap-3">
        <Gauge className="mt-0.5 h-5 w-5 text-signal-cyan" />
        <div>
          <h2 className="font-semibold text-industrial-text">
            Ignition SCADA tags (read-only)
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            Read path, value, quality and timestamp for an approved tag list
            from one Ignition WebDev resource. The adapter sends GET only and
            cannot write tags. Built and tested against a mock gateway; not
            certified against a live Ignition server.
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
              placeholder="Ignition connector key"
              value={key}
              onChange={(event) => setKey(event.target.value)}
            />
            <input
              className={input}
              placeholder="Ignition display name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <input
              className={input}
              aria-label="Ignition WebDev resource URL"
              placeholder="https://gateway.example.com/system/webdev/Plant/tags/read"
              value={resourceUrl}
              onChange={(event) => setResourceUrl(event.target.value)}
            />
            <input
              className={input}
              aria-label="Expected Ignition interval minutes"
              type="number"
              min="1"
              value={interval}
              onChange={(event) => setInterval(event.target.value)}
            />
            <input
              className={input}
              placeholder="vault://tenant/ignition-scada"
              value={credential}
              onChange={(event) => setCredential(event.target.value)}
            />
          </div>
          <textarea
            className={`${input} mt-3`}
            rows={4}
            aria-label="Ignition tag paths"
            placeholder={"[default]Plant/Temperature\n[default]Plant/Pressure"}
            value={tags}
            onChange={(event) => setTags(event.target.value)}
          />
          <textarea
            className={`${input} mt-3`}
            rows={2}
            placeholder="Activation authority and exact tag-list basis (20+ characters)"
            value={basis}
            onChange={(event) => setBasis(event.target.value)}
          />
          <label className="mt-3 flex gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            Enable only after the exact Ignition host and credential binding are
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
              Dry-run tag read
            </button>
            <button
              type="button"
              disabled={busy || key.trim().length < 3 || !enabled}
              onClick={() => void pull(false)}
              className="rounded-lg border border-amber-400/50 px-4 py-2 text-sm text-amber-200 disabled:opacity-40"
            >
              Read tag snapshot
            </button>
          </div>
        </>
      )}
    </section>
  );
}
