import { useEffect, useState } from "react";
import { CalendarRange, ShieldCheck } from "lucide-react";
import { useAuth } from "./AuthProvider";
import { listDevelopmentCases } from "../services/developService";
import { p6ScheduleReadActions } from "../services/p6ScheduleRead";
import { P6ScheduleRevisionReview } from "./P6ScheduleRevisionReview";

const input =
  "w-full rounded-lg border border-industrial-border bg-industrial-slate px-3 py-2 text-sm text-industrial-text outline-none focus:border-signal-cyan";

type CaseOption = { id: string; title: string };

export function P6ScheduleReadConnectorSetup({
  onConfigured,
}: {
  onConfigured: () => Promise<void>;
}) {
  const { profile } = useAuth();
  const admin = ["admin", "ai_admin"].includes(
    String(profile?.role ?? "").toLowerCase(),
  );
  const [cases, setCases] = useState<CaseOption[]>([]);
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [projectObjectId, setProjectObjectId] = useState("");
  const [developmentCaseId, setDevelopmentCaseId] = useState("");
  const [scheduleName, setScheduleName] = useState("");
  const [durationToHours, setDurationToHours] = useState("");
  const [maxActivities, setMaxActivities] = useState("5000");
  const [maxRelationships, setMaxRelationships] = useState("20000");
  const [interval, setInterval] = useState("60");
  const [credential, setCredential] = useState("");
  const [basis, setBasis] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [revisionRunId, setRevisionRunId] = useState<string | null>(null);

  useEffect(() => {
    if (!admin) return;
    let active = true;
    void listDevelopmentCases()
      .then((rows) => {
        if (active) setCases(rows.map(({ id, title }) => ({ id, title })));
      })
      .catch((error: Error) => {
        if (active) setMessage(error.message);
      });
    return () => {
      active = false;
    };
  }, [admin]);

  const valid =
    key.trim().length >= 3 &&
    name.trim().length >= 3 &&
    baseUrl.trim().length > 0 &&
    Number.isSafeInteger(Number(projectObjectId)) &&
    Number(projectObjectId) > 0 &&
    developmentCaseId.length > 0 &&
    scheduleName.trim().length >= 3 &&
    Number.isFinite(Number(durationToHours)) &&
    Number(durationToHours) > 0 &&
    Number.isSafeInteger(Number(maxActivities)) &&
    Number(maxActivities) >= 1 &&
    Number(maxActivities) <= 5000 &&
    Number.isSafeInteger(Number(maxRelationships)) &&
    Number(maxRelationships) >= 1 &&
    Number(maxRelationships) <= 20000 &&
    Number.isSafeInteger(Number(interval)) &&
    Number(interval) >= 1 &&
    credential.trim().length > 0 &&
    basis.trim().length >= 20;

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await p6ScheduleReadActions.configure({
        key: key.trim(),
        name: name.trim(),
        baseUrl: baseUrl.trim(),
        projectObjectId: Number(projectObjectId),
        developmentCaseId,
        scheduleName: scheduleName.trim(),
        durationToHours: Number(durationToHours),
        maxActivities: Number(maxActivities),
        maxRelationships: Number(maxRelationships),
        interval: Number(interval),
        credentialRef: credential.trim(),
        enabled,
        basis: basis.trim(),
      });
      setMessage(String(result.note ?? "P6 schedule source saved."));
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
      const result = await p6ScheduleReadActions.pull(key.trim(), dryRun);
      setRevisionRunId(
        !dryRun &&
          Number(result.duplicate ?? 0) > 0 &&
          typeof result.run_id === "string"
          ? result.run_id
          : null,
      );
      setMessage(
        `${dryRun ? "Dry run" : "Pull"}: ${String(result.activities ?? 0)} activities, ${String(result.relationships ?? 0)} relationships, ${String(result.bytes ?? 0)} source bytes.${dryRun ? " No run, schedule, staging or watermark row was written." : ` Status ${String(result.status ?? "unknown")}.`}`,
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
        <CalendarRange className="mt-0.5 h-5 w-5 text-signal-cyan" />
        <div>
          <h2 className="font-semibold text-industrial-text">
            Oracle Primavera P6 EPPM (read-only)
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            Read one administrator-approved P6 project through bounded REST GET
            requests. P6 remains the system of record. SyncAI never writes back,
            and changed re-exports remain pending until human revision review.
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
              placeholder="P6 connector key"
              value={key}
              onChange={(event) => setKey(event.target.value)}
            />
            <input
              className={input}
              placeholder="P6 display name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <input
              className={input}
              placeholder="https://p6.example.com/p6ws/restapi"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
            />
            <input
              aria-label="P6 ProjectObjectId"
              className={input}
              type="number"
              min="1"
              placeholder="P6 ProjectObjectId"
              value={projectObjectId}
              onChange={(event) => setProjectObjectId(event.target.value)}
            />
            <select
              aria-label="Development case"
              className={input}
              value={developmentCaseId}
              onChange={(event) => setDevelopmentCaseId(event.target.value)}
            >
              <option value="">Select governed development case</option>
              {cases.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
            <input
              className={input}
              placeholder="Canonical schedule name"
              value={scheduleName}
              onChange={(event) => setScheduleName(event.target.value)}
            />
            <input
              aria-label="P6 duration unit to hours"
              className={input}
              type="number"
              min="0"
              step="any"
              placeholder="P6 duration unit to hours"
              value={durationToHours}
              onChange={(event) => setDurationToHours(event.target.value)}
            />
            <input
              aria-label="Maximum activities"
              className={input}
              type="number"
              min="1"
              max="5000"
              value={maxActivities}
              onChange={(event) => setMaxActivities(event.target.value)}
            />
            <input
              aria-label="Maximum relationships"
              className={input}
              type="number"
              min="1"
              max="20000"
              value={maxRelationships}
              onChange={(event) => setMaxRelationships(event.target.value)}
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
              placeholder="vault://tenant/primavera-p6"
              value={credential}
              onChange={(event) => setCredential(event.target.value)}
            />
          </div>

          <p className="mt-3 text-xs text-amber-200">
            Enter the duration multiplier verified from this P6 deployment. No
            unit is assumed: use 1 only when the REST values are already hours,
            8 for eight-hour days, or the approved site-specific conversion.
          </p>
          <textarea
            className={`${input} mt-3`}
            rows={2}
            placeholder="Activation authority, approved project scope, and duration-conversion basis (20+ characters)"
            value={basis}
            onChange={(event) => setBasis(event.target.value)}
          />
          <label className="mt-3 flex gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            Enable only after the exact P6 host and OAuth binding are present in
            the protected deployment.
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
              Dry-run complete pull
            </button>
            <button
              type="button"
              disabled={busy || key.trim().length < 3 || !enabled}
              onClick={() => void pull(false)}
              className="rounded-lg border border-amber-400/50 px-4 py-2 text-sm text-amber-200 disabled:opacity-40"
            >
              Import complete project snapshot
            </button>
          </div>
          {revisionRunId && (
            <div className="mt-5">
              <P6ScheduleRevisionReview runId={revisionRunId} />
            </div>
          )}
        </>
      )}
    </section>
  );
}
