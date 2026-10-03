import { useState } from "react";
import { listOrgEvidenceItems } from "../../services/developService";

/** Search is tenant-scoped by the canonical evidence table's RLS. */
export function ProjectEvidenceSearch({ onResults }: {
  onResults: (rows: Awaited<ReturnType<typeof listOrgEvidenceItems>>) => void;
}) {
  const [term, setTerm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [count, setCount] = useState<number | null>(null);
  return <div className="space-y-1">
    <label className="block">Find supporting evidence
      <input value={term} maxLength={500} disabled={busy}
        onChange={(event) => setTerm(event.target.value)}
        placeholder="Description or exact evidence UUID"
        className="block w-full rounded bg-slate-900 p-2" />
    </label>
    <button type="button" disabled={busy} onClick={async () => {
      setBusy(true); setError(null); setCount(null);
      try {
        const rows = await listOrgEvidenceItems(term);
        onResults(rows); setCount(rows.length);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Evidence search failed");
      } finally { setBusy(false); }
    }}>{busy ? "Searching…" : "Search evidence"}</button>
    <p>Search all available evidence by description or exact UUID, including older records. Up to 200 matches are shown; narrow the search if needed. Blank search restores recent items.</p>
    {count !== null && <p role="status">{count} evidence matches</p>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
