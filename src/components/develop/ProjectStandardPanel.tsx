import { useEffect, useState } from "react";
import { StandardBaselineForm } from "./StandardBaselineForm";
import {
  decideProjectStandardRevision,
  listProjectStandardWork,
  requestProjectStandardRevision,
  screenProjectCaExposure,
  type ProjectCaVerification,
  type ProjectStandardWorkOption,
} from "../../services/developService";

export function ProjectStandardPanel({
  closure,
  canWrite,
  onChanged,
}: {
  closure: ProjectCaVerification;
  canWrite: boolean;
  onChanged: () => Promise<void>;
}) {
  const [items, setItems] = useState<ProjectStandardWorkOption[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [language, setLanguage] = useState("");
  const [content, setContent] = useState("");
  const [summary, setSummary] = useState("");
  const [basis, setBasis] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [registering, setRegistering] = useState(false);
  useEffect(() => {
    let active = true;
    listProjectStandardWork()
      .then((rows) => {
        if (active) {
          setItems(rows);
          setMore(rows.length > 0);
        }
      })
      .catch((e: unknown) => {
        if (active)
          setError(e instanceof Error ? e.message : "Could not load standards");
      });
    return () => {
      active = false;
    };
  }, []);
  const selected = items.find((row) => String(row.id) === selectedId);
  const procedure = selected?.procedures.find(
    (row) => row.language_code === language,
  );
  const run = async (action: () => Promise<string>) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const receipt = await action();
      await onChanged();
      setMessage(receipt);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      aria-label="Project standard change"
      className="mt-3 space-y-2 border-t border-slate-700 pt-3"
    >
      <h4 className="font-semibold">Standard change and project screening</h4>
      {canWrite && (
        <>
          <button
            type="button"
            aria-expanded={registering}
            onClick={() => setRegistering(!registering)}
          >
            Register existing procedure
          </button>
          {registering && (
            <StandardBaselineForm
              onSaved={async () => {
                setItems(await listProjectStandardWork());
                setMore(true);
              }}
            />
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      <label className="block">
        Standard / revision
        <select
          className="block w-full bg-slate-900 p-2"
          value={selectedId}
          disabled={busy}
          onChange={(e) => {
            setSelectedId(e.target.value);
            setLanguage("");
            setContent("");
            setSummary("");
          }}
        >
          <option value="">Select standard work</option>
          {items.map((row) => (
            <option key={row.id} value={row.id}>
              {row.work_key} · v{row.version} · {row.title} ·{" "}
              {row.approval?.status ?? "Baseline"}
            </option>
          ))}
        </select>
      </label>
      {more && (
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const rows = await listProjectStandardWork(items.at(-1)?.id);
              setItems((old) => [
                ...old,
                ...rows.filter(
                  (row) => !old.some((item) => item.id === row.id),
                ),
              ]);
              setMore(rows.length > 0);
              return rows.length
                ? "Additional standards loaded"
                : "All standards loaded";
            })
          }
        >
          Load more standards
        </button>
      )}
      {selected && (
        <>
          <p>Source basis: {selected.basis ?? "Not recorded"}</p>
          <label className="block">
            Procedure language
            <select
              value={language}
              onChange={(e) => {
                setLanguage(e.target.value);
                setContent(
                  selected.procedures.find(
                    (p) => p.language_code === e.target.value,
                  )?.content ?? "",
                );
              }}
            >
              <option value="">Select language</option>
              {selected.procedures.map((p) => (
                <option key={p.language_code} value={p.language_code}>
                  {p.language_code} · {p.translation_status}
                </option>
              ))}
            </select>
          </label>
          {procedure && (
            <>
              <h5>Recorded procedure</h5>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap">
                {procedure.content}
              </pre>
              <p>
                Verifier: {procedure.verified_by ?? "Not verified"} ·{" "}
                {procedure.verified_at ?? "No verification date"}
              </p>
            </>
          )}
          {canWrite &&
            !closure.project_adopted_standard_id &&
            procedure?.translation_status === "human_verified" && (
              <form
                className="space-y-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    const receipt = await requestProjectStandardRevision({
                      verificationId: closure.id,
                      previousId: selected.id,
                      language,
                      content,
                      changeSummary: summary,
                      basis,
                    });
                    setItems(await listProjectStandardWork());
                    setMore(true);
                    setSelectedId("");
                    return `Draft revision ${receipt.revisionId} requested; approval ${receipt.approvalId} is pending.`;
                  });
                }}
              >
                <label className="block">
                  Proposed procedure
                  <textarea
                    required
                    maxLength={100000}
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    className="block w-full bg-slate-900 p-2"
                  />
                </label>
                <label className="block">
                  Exact change summary
                  <textarea
                    required
                    value={summary}
                    onChange={(e) => setSummary(e.target.value)}
                    className="block w-full bg-slate-900 p-2"
                  />
                </label>
                <label className="block">
                  Revision source basis
                  <textarea
                    required
                    value={basis}
                    onChange={(e) => setBasis(e.target.value)}
                    className="block w-full bg-slate-900 p-2"
                  />
                </label>
                <button
                  disabled={
                    busy ||
                    !content.trim() ||
                    content.trim() === procedure.content.trim() ||
                    !summary.trim() ||
                    !basis.trim()
                  }
                >
                  Request draft revision
                </button>
              </form>
            )}
          {selected.source_project_ca_id === closure.id && (
            <>
              <p>Proposed change: {selected.change_summary}</p>
              <p>Requested by: {selected.revision_requested_by}</p>
              <p>
                Approval:{" "}
                {selected.approval?.status ?? "Missing canonical approval"}
              </p>
              {canWrite &&
                procedure &&
                ["required", "pending"].includes(
                  selected.approval?.status ?? "",
                ) && (
                  <>
                    <p>
                      Review the exact procedure above. The requester cannot
                      decide their own adoption.
                    </p>
                    <label>
                      Decision basis
                      <textarea
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        className="block w-full bg-slate-900 p-2"
                      />
                    </label>
                    {(["approved", "rejected"] as const).map((outcome) => (
                      <button
                        key={outcome}
                        disabled={busy || !note.trim()}
                        type="button"
                        onClick={() =>
                          void run(async () => {
                            const receipt = await decideProjectStandardRevision(
                              selected.id,
                              outcome,
                              note,
                            );
                            setItems(await listProjectStandardWork());
                            setMore(true);
                            return receipt.detail;
                          })
                        }
                      >
                        {outcome === "approved"
                          ? "Approve adoption"
                          : "Reject revision"}
                      </button>
                    ))}
                  </>
                )}
            </>
          )}
        </>
      )}
      {closure.project_adopted_standard_id && (
        <p>Adopted standard reference: {closure.project_adopted_standard_id}</p>
      )}
      {canWrite && closure.project_adopted_standard_id && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const receipt = await screenProjectCaExposure(closure.id, basis);
              return `Screened ${receipt.populationCount} projects; ${receipt.matchCount} applicable matches. ${receipt.limitation}`;
            });
          }}
        >
          <label>
            Screening basis
            <textarea
              required
              value={basis}
              onChange={(e) => setBasis(e.target.value)}
              className="block w-full bg-slate-900 p-2"
            />
          </label>
          <button disabled={busy || !basis.trim()}>
            Screen project exposure
          </button>
        </form>
      )}
      {closure.project_screening_receipt && (
        <div>
          <p>
            Last screen: {closure.project_screening_receipt.screenedAt} ·{" "}
            {closure.project_screening_receipt.actorId}
          </p>
          <p>
            {closure.project_screening_receipt.populationCount} screened;{" "}
            {closure.project_screening_receipt.matchCount} matches.
          </p>
          <p>{closure.project_screening_receipt.limitation}</p>
        </div>
      )}
    </section>
  );
}
