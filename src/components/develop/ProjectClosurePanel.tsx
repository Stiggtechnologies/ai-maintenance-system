import { useEffect, useState } from "react";
import {
  getProjectCaVerification,
  attestProjectCaStage,
  listOrgEvidenceItems,
  startProjectCaVerification,
  type ProjectCaVerification,
} from "../../services/developService";

export function ProjectClosurePanel({
  lessonId,
  canWrite,
}: {
  lessonId: string;
  canWrite: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [record, setRecord] = useState<ProjectCaVerification | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [basis, setBasis] = useState("");
  useEffect(() => {
    if (!expanded) return;
    let active = true;
    setLoaded(false);
    setError(null);
    getProjectCaVerification(lessonId)
      .then((value) => {
        if (active) {
          setRecord(value);
          setLoaded(true);
        }
      })
      .catch((e: unknown) => {
        if (active)
          setError(e instanceof Error ? e.message : "Could not load closure");
      });
    return () => {
      active = false;
    };
  }, [expanded, lessonId]);
  return (
    <div className="mt-3 border-t border-slate-700 pt-2">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
        className="text-cyan-300"
      >
        Project closure
      </button>
      {expanded && (
        <div className="mt-2 space-y-2">
          {error && <p role="alert">{error}</p>}
          {!loaded && !error && <p role="status">Loading closure…</p>}
          {loaded && record && (
            <>
              <p>Closure started by {record.project_started_by}</p>
              <p>Basis: {record.project_start_basis}</p>
              <p>
                Implementation:{" "}
                {record.physical_verified_at
                  ? "Human attestation recorded"
                  : "Not yet verified"}
              </p>
              {record.physical_verified_at && (
                <p>
                  {record.physical_note} — {record.physical_verified_by} ·{" "}
                  {record.physical_verified_at} · Evidence:{" "}
                  {record.project_implementation_evidence_id}
                </p>
              )}
              <p>
                Causal stage:{" "}
                {record.causal_addressed_at
                  ? "Human attestation recorded"
                  : "Not yet verified"}
              </p>
              {record.causal_addressed_at && (
                <p>
                  {record.causal_note} — {record.causal_addressed_by} ·{" "}
                  {record.causal_addressed_at} · Evidence:{" "}
                  {record.project_causal_evidence_id}
                </p>
              )}
              <p>
                Standard adoption and future-project screening are not verified
                by these attestations.
              </p>
              {canWrite && !record.causal_addressed_at && (
                <ProjectStageForm
                  key={`${record.id}:${record.physical_verified_at ?? "implementation"}`}
                  verificationId={record.id}
                  stage={
                    record.physical_verified_at ? "causal" : "implementation"
                  }
                  onSaved={async () => {
                    const value = await getProjectCaVerification(lessonId);
                    if (!value)
                      throw new Error(
                        "Saved stage could not be reloaded. Refresh before retrying.",
                      );
                    setRecord(value);
                  }}
                />
              )}
            </>
          )}
          {loaded && !record && (
            <>
              <p>
                No closure record yet. A captured lesson is not a completed
                corrective-action loop.
              </p>
              {canWrite && (
                <form
                  onSubmit={async (event) => {
                    event.preventDefault();
                    setBusy(true);
                    setError(null);
                    try {
                      await startProjectCaVerification(lessonId, basis);
                      setLoaded(false);
                      const value = await getProjectCaVerification(lessonId);
                      if (!value)
                        throw new Error(
                          "Closure was started but could not be reloaded. Refresh before retrying.",
                        );
                      setRecord(value);
                      setLoaded(true);
                      setBasis("");
                    } catch (e) {
                      setError(
                        e instanceof Error
                          ? e.message
                          : "Could not start closure",
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <label className="block">
                    Closure basis
                    <textarea
                      required
                      maxLength={10000}
                      value={basis}
                      onChange={(e) => setBasis(e.target.value)}
                      className="block w-full rounded bg-slate-900 p-2"
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={busy || !basis.trim()}
                    className="mt-2 rounded bg-blue-600 px-3 py-2 disabled:opacity-50"
                  >
                    {busy ? "Starting…" : "Start project closure"}
                  </button>
                </form>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ProjectStageForm({
  verificationId,
  stage,
  onSaved,
}: {
  verificationId: string;
  stage: "implementation" | "causal";
  onSaved: () => Promise<void>;
}) {
  const [evidence, setEvidence] = useState<
    Awaited<ReturnType<typeof listOrgEvidenceItems>>
  >([]);
  const [evidenceId, setEvidenceId] = useState("");
  const [note, setNote] = useState("");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    listOrgEvidenceItems()
      .then((items) => {
        if (active) {
          setEvidence(items);
          setReady(true);
        }
      })
      .catch((e: unknown) => {
        if (active)
          setError(e instanceof Error ? e.message : "Could not load evidence");
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <form
      className="space-y-2"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await attestProjectCaStage({
            verificationId,
            stage,
            note,
            evidenceId,
          });
          await onSaved();
        } catch (e) {
          setError(
            e instanceof Error ? e.message : "Could not record attestation",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <p>
        Record {stage} verification. This is a named human attestation, not
        automatic proof.
      </p>
      {error && <p role="alert">{error}</p>}
      <label className="block">
        Supporting evidence
        <select
          required
          value={evidenceId}
          onChange={(e) => setEvidenceId(e.target.value)}
          disabled={!ready || busy}
          className="block w-full rounded bg-slate-900 p-2"
        >
          <option value="">Select evidence</option>
          {evidence.map((item) => (
            <option key={item.id} value={item.id}>
              {item.description} · {item.evidence_class ?? "Unclassified"}
            </option>
          ))}
        </select>
      </label>
      <p>
        Shows the 200 most recent evidence items available to your organization.
        Selection does not verify their quality or applicability.
      </p>
      {ready && !evidence.length && (
        <p>
          No evidence available. Record supporting evidence before attesting.
        </p>
      )}
      <label className="block">
        Verification note
        <textarea
          required
          maxLength={10000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="block w-full rounded bg-slate-900 p-2"
        />
      </label>
      <button
        type="submit"
        disabled={busy || !ready || !evidenceId || !note.trim()}
        className="rounded bg-blue-600 px-3 py-2 disabled:opacity-50"
      >
        {busy ? "Recording…" : `Attest ${stage}`}
      </button>
    </form>
  );
}
