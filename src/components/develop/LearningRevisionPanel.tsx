import { useEffect, useState, type FormEvent } from "react";
import { decideLearningStandardRevision, getObservedProcedure, listProjectStandardWork, requestLearningStandardRevision, type ProjectStandardWorkOption } from "../../services/developService";

export function LearningRevisionPanel({ observationId, procedureId, canWrite }: { observationId: string; procedureId: number; canWrite: boolean }) {
  const [opened, setOpened] = useState(false);
  const [items, setItems] = useState<ProjectStandardWorkOption[]>([]);
  const [original, setOriginal] = useState<Awaited<ReturnType<typeof getObservedProcedure>>>();
  const [tick, setTick] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!opened) return;
    let active = true;
    setLoading(true); setError("");
    async function load() {
      const prior = await getObservedProcedure(procedureId);
      const rows: ProjectStandardWorkOption[] = [];
      let cursor: number | undefined;
      while (active) {
        const page = await listProjectStandardWork(cursor, undefined, observationId);
        rows.push(...page);
        if (page.length < 100) break;
        const next = page.at(-1)!.id;
        if (cursor !== undefined && next <= cursor) throw new Error("Revision history paging did not advance");
        cursor = next;
      }
      if (active) { setOriginal(prior); setItems(rows); }
    }
    load().catch(reason => { if (active) setError(reason instanceof Error ? reason.message : "Could not load revisions"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [opened, observationId, procedureId, tick]);
  async function request(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || loading || !original) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    setBusy(true); setError(""); setMessage("");
    try {
      const receipt = await requestLearningStandardRevision({ observationId, content: String(values.get("content")), changeSummary: String(values.get("summary")), basis: String(values.get("basis")) });
      setMessage(`Draft revision ${receipt.revisionId} requested. A different authorized human must decide adoption.`);
      form.reset(); setTick(n => n + 1);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Request failed; reload before retrying"); }
    finally { setBusy(false); }
  }
  async function decide(event: FormEvent<HTMLFormElement>, id: number) {
    event.preventDefault();
    if (busy || loading) return;
    const values = new FormData(event.currentTarget);
    setBusy(true); setError(""); setMessage("");
    try {
      const receipt = await decideLearningStandardRevision(id, String(values.get("outcome")) as "approved" | "rejected", String(values.get("note")));
      setMessage(receipt.detail); setTick(n => n + 1);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Decision failed; reload before retrying"); }
    finally { setBusy(false); }
  }
  return <div className="space-y-3 text-sm [&_textarea]:block [&_textarea]:w-full [&_textarea]:rounded [&_textarea]:bg-slate-900 [&_textarea]:p-2 [&_select]:rounded [&_select]:bg-slate-900 [&_select]:p-2">
    <button type="button" aria-expanded={opened} onClick={() => setOpened(value => !value)}>Review procedure revisions</button>
    {opened && <>
      {loading && <p role="status">Loading source and revision history…</p>}
      {error && <p role="alert">{error} <button type="button" onClick={() => setTick(n => n + 1)}>Reload revisions</button></p>}
      {message && <p role="status">{message}</p>}
      {original && <details><summary>Exact observed procedure · {original.language_code}</summary><p className="whitespace-pre-wrap">{original.content}</p></details>}
      {items.map(item => <article key={item.id} className="border border-slate-700 rounded p-3 space-y-2">
        <h5>{item.title} · version {item.version} · {item.approval?.status ?? "Approval missing"}</h5>
        <p>{item.change_summary}</p><p>Basis: {item.basis}</p>
        <p>Requested by: {item.revision_requested_by}</p>
        {item.procedures.map(procedure => <details key={procedure.id}><summary>Proposed procedure · {procedure.language_code}</summary><p className="whitespace-pre-wrap">{procedure.content}</p></details>)}
        <p>Decision by: {item.approval?.approver_user_id ?? "Not decided"} · {item.approval?.decided_at ?? "No decision date"}</p>
        {canWrite && ["required", "pending"].includes(item.approval?.status ?? "") && <form onSubmit={event => decide(event, item.id)}><fieldset disabled={busy || loading}>
          <label>Decision<select name="outcome" required defaultValue=""><option value="">Choose decision</option><option value="approved">Approve adoption</option><option value="rejected">Reject revision</option></select></label>
          <label>Decision basis<textarea name="note" required maxLength={10000} /></label>
          <p>The requester cannot approve their own revision. The server checks approval authority.</p>
          <button type="submit">Record human decision</button>
        </fieldset></form>}
      </article>)}
      {!loading && !error && items.length === 0 && <p>No revisions requested from this observation.</p>}
      {canWrite && original && <form onSubmit={request}><fieldset disabled={busy || loading} className="space-y-2">
        <label>Changed procedure content<textarea name="content" required maxLength={100000} /></label>
        <label>Change summary<textarea name="summary" required maxLength={10000} /></label>
        <label>Evidence and applicability basis<textarea name="basis" required maxLength={10000} /></label>
        <p>A request creates a draft, not an adopted procedure or proof of improved outcomes.</p>
        <button type="submit">Request procedure revision</button>
      </fieldset></form>}
    </>}
  </div>;
}
