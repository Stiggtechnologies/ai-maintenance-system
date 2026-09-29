import { useEffect, useState, type FormEvent } from "react";
import { getCaseWorkPackages, listOrgEvidenceItems, listProjectStandardWork, recordStandardWorkObservation, type ProjectStandardWorkOption, type WorkPackageRow, type StandardWorkObservationInput } from "../../services/developService";
import { ProjectEvidenceSearch } from "./ProjectEvidenceSearch";

export function StandardWorkObservationForm({ caseId, onRecorded }: { caseId: string; onRecorded: () => void }) {
  const [standards, setStandards] = useState<ProjectStandardWorkOption[]>([]);
  const [work, setWork] = useState<WorkPackageRow["workOrders"]>([]);
  const [evidence, setEvidence] = useState<Awaited<ReturnType<typeof listOrgEvidenceItems>>>([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [procedureId, setProcedureId] = useState("");
  const selectedProcedure = standards.flatMap(s => s.procedures).find(p => String(p.id) === procedureId);
  useEffect(() => {
    let active = true;
    setReady(false); setError("");
    async function load() {
      const all: ProjectStandardWorkOption[] = [];
      let after: number | undefined;
      while (active) {
        const page = await listProjectStandardWork(after);
        all.push(...page);
        if (page.length < 100) break;
        const next = page.at(-1)!.id;
        if (after !== undefined && next <= after) throw new Error("Procedure paging did not advance");
        after = next;
      }
      const [packages, items] = await Promise.all([getCaseWorkPackages(caseId), listOrgEvidenceItems()]);
      if (!packages.answered) throw new Error(packages.refusal || "Case work context unavailable");
      if (!active) return;
      setStandards(all);
      setWork([...new Map((packages.packages ?? []).flatMap(pkg => pkg.workOrders).map(row => [row.workOrderId, row])).values()]);
      setEvidence(items); setReady(true);
    }
    load().catch(reason => { if (active) setError(reason instanceof Error ? reason.message : "Could not load recording context"); });
    return () => { active = false; };
  }, [caseId, attempt]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !ready) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const value = (key: string) => String(data.get(key) ?? "").trim();
    setBusy(true); setError(""); setReceipt("");
    try {
      const result = await recordStandardWorkObservation({ caseId, procedureId: Number(value("procedure")), workOrderId: value("work"), executionEvidenceId: value("executionEvidence"), outcomeEvidenceId: value("outcomeEvidence"), observedAt: new Date(value("observedAt")).toISOString(), title: value("title"), execution: value("execution"), variationKind: value("variationKind") as StandardWorkObservationInput["variationKind"], variationBasis: value("variationBasis"), outcome: value("outcome"), learning: value("learning"), applicability: value("applicability") });
      setReceipt(`Observation recorded: ${result.id}. Improvement has not been established.`);
      form.reset(); setProcedureId(""); onRecorded();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Recording failed; reload history before retrying"); }
    finally { setBusy(false); }
  }
  return <details><summary>Record actual execution and learning</summary>
    {error && <p role="alert">{error}</p>}
    {!ready && <button type="button" onClick={() => setAttempt(n => n + 1)}>Reload recording context</button>}
    {receipt && <p role="status">{receipt}</p>}
    <form onSubmit={submit} className="space-y-3 mt-3 [&_input]:block [&_input]:w-full [&_input]:rounded [&_input]:bg-slate-900 [&_input]:p-2 [&_select]:block [&_select]:w-full [&_select]:rounded [&_select]:bg-slate-900 [&_select]:p-2 [&_textarea]:rounded [&_textarea]:bg-slate-900 [&_textarea]:p-2">
      <fieldset disabled={!ready || busy} className="space-y-3">
        <label className="block">Procedure version<select name="procedure" required value={procedureId} onChange={event => setProcedureId(event.target.value)}><option value="">Choose verified procedure</option>{standards.filter(s => !s.previous_standard_work_id || s.approval?.status === "approved").flatMap(s => s.procedures.filter(p => p.translation_status === "human_verified" && p.verified_by && p.verified_at).map(p => <option key={p.id} value={p.id}>{s.title} · v{s.version} · {p.language_code}</option>))}</select></label>
        {selectedProcedure && <details><summary>Inspect exact procedure content</summary><p className="whitespace-pre-wrap">{selectedProcedure.content}</p><p>Verified by {selectedProcedure.verified_by} · {selectedProcedure.verified_at}</p></details>}
        {ready && work.length === 0 && <p>No work orders are assigned to this case. Assign actual work through the existing work-package workflow before recording execution.</p>}
        <label className="block">Actual work order<select name="work" required defaultValue=""><option value="">Choose case work order</option>{work.map(w => <option key={w.workOrderId} value={w.workOrderId}>{w.woNumber} · {w.title} · {w.executionStatus}</option>)}</select></label>
        <label className="block">Observed at (local time)<input name="observedAt" type="datetime-local" required /></label>
        <label className="block">Title<input name="title" required minLength={3} maxLength={500} /></label>
        <label className="block">Variation<select name="variationKind" defaultValue="undetermined"><option value="undetermined">Undetermined</option><option value="conforming">Conforming</option><option value="varied">Varied</option></select></label>
        {([['execution', 'Actual execution'], ['variationBasis', 'Variation basis'], ['outcome', 'Observed outcome and attribution limits'], ['learning', 'Learning'], ['applicability', 'Applicability']] as const).map(([name, label]) => <label className="block" key={name}>{label}<textarea name={name} required minLength={10} maxLength={10000} className="block w-full" /></label>)}
        <ProjectEvidenceSearch onResults={items => setEvidence(previous => [...new Map([...previous, ...items].map(item => [item.id, item])).values()])} />
        {([['executionEvidence', 'Execution evidence'], ['outcomeEvidence', 'Outcome evidence']] as const).map(([name, label]) => <label className="block" key={name}>{label}<select name={name} required defaultValue=""><option value="">Choose evidence</option>{evidence.map(item => <option key={item.id} value={item.id}>{item.description} · {item.id}</option>)}</select></label>)}
        <p className="text-sm">Recording an observation does not complete the work order, verify savings or authorize a procedure change.</p>
        <button type="submit">{busy ? "Recording…" : "Record observation"}</button>
      </fieldset>
    </form>
  </details>;
}
