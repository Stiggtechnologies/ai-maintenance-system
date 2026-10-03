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
  const [cursor, setCursor] = useState<number | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [registering, setRegistering] = useState(false);
  useEffect(() => {
    let active = true;
    listProjectStandardWork()
      .then((rows) => {
        if (active) {
          setItems(rows);
          setCursor(rows.at(-1)?.id);
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
  const refreshStandard = async (id: number) => {
    const rows = await listProjectStandardWork(undefined, id);
    const row = rows.find((item) => item.id === id);
    if (!row) throw new Error(`Standard ${id} was saved but could not be reloaded. Reload before retrying the action.`);
    setItems((old) => [...old.filter((item) => item.id !== id), row].sort((a, b) => a.id - b.id));
    setSelectedId(String(id));
    setLanguage(row.procedures[0]?.language_code ?? "");
    // Keep the sequential page cursor: a newly inserted high ID must not make
    // Load more skip the intervening standards that have not been fetched.
  };
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
      className="mt-4 space-y-4 rounded-xl border border-slate-700/70 bg-slate-950/30 p-4 text-sm leading-relaxed sm:p-6 [&_button]:rounded-lg [&_button]:border [&_button]:border-slate-600 [&_button]:px-3 [&_button]:py-2 [&_button]:font-medium [&_button]:transition-colors [&_button:hover]:bg-slate-700/50 [&_button:disabled]:opacity-50 [&_button:focus-visible]:outline-2 [&_button:focus-visible]:outline-cyan-400 [&_select]:rounded-lg [&_select]:border [&_select]:border-slate-600 [&_select]:p-2 [&_textarea]:min-h-24 [&_textarea]:rounded-lg [&_textarea]:border [&_textarea]:border-slate-600 [&_label]:space-y-2 [&_form]:space-y-3"
    >
      <header className="space-y-1">
        <h4 className="text-base font-semibold text-slate-100">Standard change and project screening</h4>
        <p className="text-xs text-slate-400">Evidence-backed revision · human adoption · traceable project exposure</p>
      </header>
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
              onSaved={refreshStandard}
            />
          )}
        </>
      )}
      {error && <p role="alert" className="rounded-lg border border-rose-500/40 bg-rose-950/30 p-3 text-rose-200">{error}</p>}
      {message && <p role="status" className="rounded-lg border border-cyan-500/30 bg-cyan-950/30 p-3 text-cyan-100">{message}</p>}
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
              const rows = await listProjectStandardWork(cursor);
              if (rows.length) setCursor(rows.at(-1)?.id);
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
                    await refreshStandard(receipt.revisionId);
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
                            await refreshStandard(selected.id);
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
        <p className="rounded-lg border border-emerald-500/30 bg-emerald-950/20 px-3 py-2 text-emerald-200">Adopted standard reference: {closure.project_adopted_standard_id}</p>
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
        <div className="space-y-3 rounded-xl border border-slate-700 bg-slate-900/60 p-4">
          <p className="break-words text-xs text-slate-400">
            Last screen: {closure.project_screening_receipt.screenedAt} ·{" "}
            {closure.project_screening_receipt.actorId}
          </p>
          <p className="text-lg font-semibold text-slate-100">
            {closure.project_screening_receipt.populationCount} screened;{" "}
            {closure.project_screening_receipt.matchCount} matches.
          </p>
          <p className="text-xs leading-relaxed text-amber-200/90">{closure.project_screening_receipt.limitation}</p>
          <details className="space-y-2 border-t border-slate-700 pt-3 [&_p]:break-words">
            <summary className="cursor-pointer py-1 font-medium text-cyan-200 focus-visible:outline-2 focus-visible:outline-cyan-400">Inspect screening receipt</summary>
            <p>Screening basis: {closure.project_screening_receipt.basis}</p>
            <p>Scope: {closure.project_screening_receipt.scope}</p>
            <p>Standard revision: {closure.project_screening_receipt.standardRevisionId}</p>
            <p>Source lifecycle: {closure.project_screening_receipt.sourceLifecycleType ?? "Not captured in this receipt"}</p>
            <p>Recorded applicability: {closure.project_screening_receipt.applicability ?? "Not captured in this receipt"}</p>
            {closure.project_screening_receipt.population.length === 0 ? (
              <p>No candidate projects existed in this screening snapshot.</p>
            ) : (
              <ul className="max-h-64 space-y-2 overflow-auto pt-2">
                {closure.project_screening_receipt.population.map((id) => (
                  <li key={id} className="break-words rounded-lg border border-slate-700/60 px-3 py-2 text-xs">
                    <a className="text-cyan-300 underline" href={`/develop/cases/${encodeURIComponent(id)}`}>{id}</a>
                    {closure.project_screening_receipt!.matches.includes(id)
                      ? " — applicable match" : " — screened, not matched"}
                  </li>
                ))}
              </ul>
            )}
          </details>
        </div>
      )}
    </section>
  );
}
