import { useEffect, useState } from "react";
import {
  decideScheduleImportRevision,
  proposeScheduleImportRevision,
  type ScheduleImportRevisionResult,
} from "../services/developService";

function display(value: unknown): string {
  if (value == null || value === "") return "not stated";
  return typeof value === "string" ? value : JSON.stringify(value);
}

export function P6ScheduleRevisionReview({ runId }: { runId: string | null }) {
  const [revision, setRevision] = useState<ScheduleImportRevisionResult | null>(
    null,
  );
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRevision(null);
    setMessage(null);
    setNote("");
    if (!runId) return () => undefined;

    void proposeScheduleImportRevision(runId)
      .then((result) => {
        if (cancelled) return;
        // An identical replay is intentionally silent on the surface. It is
        // still counted as duplicate in the import summary immediately above.
        if (result.answered) setRevision(result);
      })
      .catch((error) => {
        if (!cancelled)
          setMessage(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [runId]);

  if (!revision && !message) return null;

  async function decide(decision: "approved" | "rejected") {
    if (!revision?.revisionId) return;
    if (note.trim().length < 20) {
      setMessage(
        "State why this P6 change set is accepted or rejected in at least 20 characters.",
      );
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const result = await decideScheduleImportRevision({
        revisionId: revision.revisionId,
        decision,
        note,
      });
      setRevision((current) => ({ ...current, ...result }));
      setMessage(result.note ?? `Revision ${decision}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-3 rounded-lg border border-signal-cyan/20 bg-signal-cyan/[0.04] p-4">
      <h4 className="text-xs font-medium text-slate-200">
        Changed P6 re-export review
      </h4>
      <p className="mt-1 text-xs leading-relaxed text-slate-400">
        The import found the same activity identities with changed P6-owned
        values. Nothing has been overwritten. Review the exact before/after
        values, then accept or reject the immutable revision. Acceptance updates
        SyncAI&apos;s analysis copy only; it never writes back to P6.
      </p>

      {revision && (
        <div className="mt-3 space-y-3">
          {(revision.changes ?? []).map((change) => (
            <div
              key={`${change.taskId}:${change.stagingRowId}`}
              className="rounded-lg border border-white/8 bg-overlook-void/45 p-3"
            >
              <p className="font-mono text-xs text-slate-200">
                {change.activityKey}
              </p>
              <div className="mt-2 space-y-1">
                {Object.entries(change.fields).map(([field, values]) => (
                  <p key={field} className="text-[11px] text-slate-400">
                    <span className="font-mono text-slate-300">{field}</span>
                    {" · "}
                    <span className="text-rose-200/80">
                      {display(values.from)}
                    </span>
                    {" → "}
                    <span className="text-emerald-200/80">
                      {display(values.to)}
                    </span>
                  </p>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {revision?.status === "pending" && (
        <div className="mt-3">
          <textarea
            aria-label="P6 revision decision basis"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Decision basis — what was checked and why this revision is accepted or rejected"
            rows={3}
            className="w-full rounded border border-white/10 bg-overlook-void px-3 py-2 text-xs text-slate-200"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void decide("approved")}
              className="rounded-lg border border-emerald-300/30 bg-emerald-300/5 px-3 py-1.5 text-xs text-emerald-100 disabled:opacity-50"
            >
              {busy ? "Deciding…" : "Accept reviewed revision"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void decide("rejected")}
              className="rounded-lg border border-rose-300/30 bg-rose-300/5 px-3 py-1.5 text-xs text-rose-100 disabled:opacity-50"
            >
              Reject revision
            </button>
          </div>
        </div>
      )}

      {revision?.status && revision.status !== "pending" && (
        <p className="mt-3 text-xs text-slate-300">
          Decision recorded: {revision.status}. This decision is immutable.
        </p>
      )}
      {message && (
        <p className="mt-2 text-xs leading-relaxed text-amber-200">{message}</p>
      )}
    </section>
  );
}
