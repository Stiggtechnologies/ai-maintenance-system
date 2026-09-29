import { useEffect, useState } from "react";
import { listStandardWorkObservations, type StandardWorkObservation } from "../../services/developService";
import { StandardWorkObservationForm } from "./StandardWorkObservationForm";

export function StandardWorkLearningPanel({ caseId, canRecord = false }: { caseId: string; canRecord?: boolean }) {
  const [rows, setRows] = useState<StandardWorkObservation[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => { setRows([]); setCursor(undefined); }, [caseId]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    listStandardWorkObservations(caseId, cursor).then(page => {
      if (!active) return;
      setRows(previous => cursor ? [...new Map([...previous, ...page].map(row => [row.id, row])).values()] : page);
      setMore(page.length === 100);
    }).catch(reason => {
      if (active) setError(reason instanceof Error ? reason.message : "Could not load observation history");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [caseId, cursor, retry]);
  return <section aria-label="Standard-work learning" className="rounded-xl border border-slate-700 p-4 space-y-4">
    <h3 className="font-semibold">Standard-work learning</h3>
    <p className="text-sm text-slate-400">Recorded execution, variation and outcomes. An observation does not establish improvement, authorize work or adopt a revised procedure.</p>
    {canRecord && <StandardWorkObservationForm key={caseId} caseId={caseId} onRecorded={() => { setCursor(undefined); setRetry(n => n + 1); }} />}
    {loading && <p role="status">Loading observations…</p>}
    {error && <div role="alert">{error} <button type="button" onClick={() => setRetry(value => value + 1)}>Retry history</button></div>}
    {!loading && !error && rows.length === 0 && <p>No standard-work observations recorded for this case.</p>}
    {rows.map(row => <article key={row.id} className="rounded-lg border border-slate-700 p-3 space-y-2">
      <h4 className="font-medium">{row.title}</h4>
      <p className="text-sm">Recorded observation · {row.standard_variation_kind} · {row.standard_execution_observed_at}</p>
      <dl className="text-sm space-y-2">
        <div><dt>Execution</dt><dd>{row.standard_execution_description}</dd></div>
        <div><dt>Variation basis</dt><dd>{row.standard_variation_basis}</dd></div>
        <div><dt>Outcome</dt><dd>{row.standard_outcome_description}</dd></div>
        <div><dt>Learning</dt><dd>{row.detail}</dd></div>
        <div><dt>Applicability</dt><dd>{row.applicability}</dd></div>
      </dl>
      <details className="text-sm break-all"><summary>Source references</summary>
        <p>Procedure: {row.standard_procedure_id}</p><p>Work order: {row.standard_execution_work_order_id}</p>
        <p>Execution evidence: {row.standard_execution_evidence_id}</p><p>Outcome evidence: {row.standard_outcome_evidence_id}</p>
        <p>Recorded by: {row.standard_execution_recorded_by}</p><p>Observation: {row.id}</p>
      </details>
    </article>)}
    {more && !error && <button type="button" disabled={loading} onClick={() => setCursor(rows.at(-1)?.id)}>Load more observations</button>}
  </section>;
}
