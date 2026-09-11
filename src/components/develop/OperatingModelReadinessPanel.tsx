import { FormEvent, useCallback, useEffect, useState } from "react";
import type { OrgMember } from "../../services/developService";
import {
  EVIDENCE_CLASSES,
  getCaseOperatingModelReadiness,
  OPERATING_MODEL_DIMENSIONS,
  recordOperatingModelReadiness,
  type OperatingModelReadiness,
} from "../../services/operatingModelReadinessService";

const label = (value: string) => value.replaceAll("_", " ");

export function OperatingModelReadinessPanel({ caseId, members, canAssess }: {
  caseId: string; members: OrgMember[]; canAssess: boolean;
}) {
  const [readiness, setReadiness] = useState<OperatingModelReadiness | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => getCaseOperatingModelReadiness(caseId)
    .then(setReadiness)
    .catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to load operating-model readiness")), [caseId]);
  useEffect(() => { void load(); }, [load]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const values = new FormData(form);
    setBusy(true); setError(null);
    try {
      await recordOperatingModelReadiness(caseId, {
        dimension: String(values.get("dimension")),
        status: String(values.get("status")) as "not_ready" | "at_risk" | "ready",
        ownerId: String(values.get("owner")),
        evidenceReference: String(values.get("evidenceReference")),
        evidenceClass: String(values.get("evidenceClass")),
        basis: String(values.get("basis")),
      });
      form.reset(); await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Assessment refused"); }
    finally { setBusy(false); }
  }

  return <section className="rounded-xl border border-white/6 bg-[#0D1520] p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-sm font-semibold text-white">Operating-model readiness</h2>
        <p className="mt-1 text-xs text-slate-400">All thirteen organizational conditions needed to receive and sustain the asset. Assessments reference—not copy—their source evidence.</p></div>
      {readiness && <span className={`rounded px-2 py-1 text-xs font-semibold ${readiness.verdict === "READY" ? "bg-emerald-400/15 text-emerald-300" : "bg-amber-400/15 text-amber-300"}`}>{readiness.verdict}</span>}
    </div>
    {error && <p role="alert" className="mt-2 text-xs text-rose-300">{error}</p>}
    {readiness && <>
      <p className="mt-3 text-xs text-slate-400">{readiness.readyCount}/13 ready · {readiness.atRiskCount} at risk · {readiness.notReadyCount} not ready · {readiness.notAssessedCount} not assessed</p>
      <div className="mt-3 grid gap-2 md:grid-cols-2">{readiness.dimensions.map((item) => <div key={item.dimension} className="rounded-lg border border-white/8 p-3 text-xs text-slate-300">
        <div className="flex justify-between gap-2"><strong className="text-slate-100">{label(item.dimension)}</strong><span>{label(item.status)}</span></div>
        {item.version ? <p className="mt-1 text-slate-500">Owner {item.ownerName} · {item.evidenceClass} · {item.evidenceReference} · version {item.version}</p> : <p className="mt-1 text-slate-500">No human assessment recorded.</p>}
      </div>)}</div>
      <p className="mt-3 text-[11px] text-slate-500">{readiness.decisionBoundary}</p>
    </>}
    {canAssess && <form onSubmit={submit} className="mt-5 grid gap-2 md:grid-cols-3">
      <select name="dimension" required className="rounded border border-white/10 bg-overlook-deep p-2 text-xs"><option value="">Dimension…</option>{OPERATING_MODEL_DIMENSIONS.map((dimension) => <option key={dimension} value={dimension}>{label(dimension)}</option>)}</select>
      <select name="status" required className="rounded border border-white/10 bg-overlook-deep p-2 text-xs"><option value="">Status…</option><option value="not_ready">not ready</option><option value="at_risk">at risk</option><option value="ready">ready</option></select>
      <select name="owner" required className="rounded border border-white/10 bg-overlook-deep p-2 text-xs"><option value="">Accountable owner…</option>{members.map((member) => <option key={member.id} value={member.id}>{member.full_name ?? member.email ?? member.id}</option>)}</select>
      <select name="evidenceClass" required className="rounded border border-white/10 bg-overlook-deep p-2 text-xs"><option value="">Evidence provenance…</option>{EVIDENCE_CLASSES.map((kind) => <option key={kind} value={kind}>{label(kind)}</option>)}</select>
      <input name="evidenceReference" required minLength={3} placeholder="Source/evidence reference" className="rounded border border-white/10 bg-overlook-deep p-2 text-xs md:col-span-2" />
      <textarea name="basis" required minLength={20} placeholder="Assessment basis (20+ characters)" className="rounded border border-white/10 bg-overlook-deep p-2 text-xs md:col-span-3" />
      <button disabled={busy} className="rounded bg-signal-cyan px-3 py-2 text-xs font-semibold text-slate-950 disabled:opacity-50 md:col-span-3">{busy ? "Recording…" : "Record human assessment"}</button>
    </form>}
  </section>;
}
