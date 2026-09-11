import { FormEvent, useCallback, useEffect, useState } from "react";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../components/AuthProvider";
import { EVIDENCE_CLASSES } from "../services/operatingModelReadinessService";
import { getCaseSyncTransition, recordCaseEarlyLifeFailure, type SyncTransitionReadModel } from "../services/syncTransitionService";
import { CommissioningPanel } from "../components/develop/CommissioningPanel";

const words = (value: string) => value.replaceAll("_", " ");

export function SyncTransitionPage() {
  const { caseId } = useParams();
  const { profile } = useAuth();
  const [days, setDays] = useState(90);
  const [model, setModel] = useState<SyncTransitionReadModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const canRecord = ["admin","executive","maintenance_manager","reliability_engineer","planner","supervisor","technician"].includes(String(profile?.role ?? "").toLowerCase());
  const load = useCallback(async () => {
    if (!caseId) return;
    setLoading(true); setError(null);
    try { setModel(await getCaseSyncTransition(caseId, days)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to load Sync Transition"); }
    finally { setLoading(false); }
  }, [caseId, days]);
  useEffect(() => { void load(); }, [load]);

  async function recordFailure(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!caseId) return;
    const form = event.currentTarget; const values = new FormData(form); const months = String(values.get("months")).trim();
    setBusy(true); setError(null);
    try {
      await recordCaseEarlyLifeFailure(caseId, {
        assetId: String(values.get("asset")), occurredAt: String(values.get("occurredAt")),
        monthsSinceHandover: months === "" ? null : Number(months), failureMode: String(values.get("failureMode")),
        attributedTo: String(values.get("attributedTo")), preventableBy: String(values.get("preventableBy")) || null,
        sourceReference: String(values.get("sourceReference")), evidenceClass: String(values.get("evidenceClass")),
        assessmentBasis: String(values.get("assessmentBasis")),
      });
      form.reset(); await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Evidence capture refused"); }
    finally { setBusy(false); }
  }

  if (!caseId) return <div className="p-6 text-sm text-rose-300">A development case is required.</div>;
  return <div className="space-y-6 p-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <Link to={`/develop/cases/${caseId}`} className="flex items-center gap-1 text-xs text-slate-400 hover:text-white"><ArrowLeft className="h-3.5 w-3.5" /> Case workspace</Link>
        <h1 className="mt-2 text-2xl font-bold text-white">Sync Transition</h1>
        <p className="text-sm text-slate-400">One governed view of operating model, asset readiness, accepted debt, and startup stabilization.</p>
      </div>
      <div className="flex items-center gap-2">
        <label className="text-xs text-slate-400">Stabilization window <select value={days} onChange={(event) => setDays(Number(event.target.value))} className="ml-1 rounded border border-white/10 bg-overlook-deep p-2 text-slate-200"><option value={30}>30 days</option><option value={60}>60 days</option><option value={90}>90 days</option><option value={180}>180 days</option><option value={365}>365 days</option></select></label>
        <button onClick={() => void load()} aria-label="Refresh Sync Transition" className="rounded border border-white/10 p-2 text-slate-300"><RefreshCw className="h-4 w-4" /></button>
      </div>
    </div>
    {error && <p role="alert" className="rounded border border-rose-400/20 bg-rose-400/10 p-3 text-sm text-rose-300">{error}</p>}
    {loading && <p className="text-sm text-slate-400">Loading canonical transition evidence…</p>}
    {model && <>
      <section className="rounded-xl border border-white/6 bg-[#0D1520] p-5">
        <div className="flex flex-wrap justify-between gap-3"><div><h2 className="text-lg font-semibold text-white">{model.caseTitle}</h2><p className="text-xs text-slate-500">Stage {model.stageKey ?? "not recorded"} · generated {new Date(model.generatedAt).toLocaleString()}</p></div><span className={`rounded px-3 py-1 text-xs font-semibold ${model.transitionPosture === "NOT_READY" ? "bg-rose-400/15 text-rose-300" : model.transitionPosture === "ATTENTION_REQUIRED" ? "bg-amber-400/15 text-amber-300" : "bg-signal-cyan/15 text-signal-cyan"}`}>{words(model.transitionPosture)}</span></div>
        <p className="mt-3 text-xs text-slate-400">{model.decisionBoundary}</p>
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-white/6 bg-[#0D1520] p-5"><h2 className="text-sm font-semibold text-white">Operating-model readiness</h2><p className="mt-2 text-2xl font-bold text-white">{model.operatingModel.readyCount}/13</p><p className="text-xs text-slate-400">dimensions ready · {model.operatingModel.atRiskCount} at risk · {model.operatingModel.notReadyCount} not ready · {model.operatingModel.notAssessedCount} not assessed</p></section>
        <section className="rounded-xl border border-white/6 bg-[#0D1520] p-5"><h2 className="text-sm font-semibold text-white">Asset operational readiness</h2><p className="mt-2 text-2xl font-bold text-white">{model.operationalReadiness.assetCount}</p><p className="text-xs text-slate-400">case assets · {model.operationalReadiness.overall?.hardBlockerCount ?? 0} hard blockers · {model.operationalReadiness.overall?.safetyOpenCount ?? 0} safety-critical gaps</p></section>
        <section className="rounded-xl border border-white/6 bg-[#0D1520] p-5"><h2 className="text-sm font-semibold text-white">Known debt</h2><p className="mt-2 text-sm text-slate-200">{model.technicalDebt.items.length} technical-debt item(s) · {model.operationalDebt.itemCount} operational-debt item(s)</p><p className="mt-1 text-xs text-slate-400">{model.technicalDebt.unvaluedCount} technical and {model.operationalDebt.unvaluedCount} operational item(s) remain unvalued. Unknown is never shown as zero.</p><div className="mt-2 space-y-1 text-xs text-slate-500">{model.operationalDebt.totalsByCurrency.map((total) => <p key={total.currency}>{total.lifecycleExposure.toLocaleString()} {total.currency} independently approved lifecycle exposure</p>)}</div></section>
        <section className="rounded-xl border border-white/6 bg-[#0D1520] p-5"><h2 className="text-sm font-semibold text-white">Startup stabilization</h2><p className="mt-2 text-sm font-semibold text-slate-200">{words(model.stabilization.status)}</p><p className="mt-1 text-xs text-slate-400">{model.stabilization.recordedInWindow} early-life failure(s) in {model.stabilization.windowDays} days · {model.stabilization.notFedBackCount} not fed back · {model.stabilization.notDeterminedCount} attribution open · {model.stabilization.unclassifiedTimingCount} timing unclassified</p><p className="mt-2 text-[11px] text-slate-500">{model.stabilization.note}</p></section>
      </div>
      <CommissioningPanel caseId={caseId} role={profile?.role} />
      <section className="rounded-xl border border-white/6 bg-[#0D1520] p-5"><h2 className="text-sm font-semibold text-white">Early-life observations</h2><p className="mt-1 text-[11px] text-slate-500">{model.stabilization.windowBasis}</p><div className="mt-3 space-y-2">{model.stabilization.events.length ? model.stabilization.events.map((event) => <div key={event.id} className="rounded border border-white/8 p-3 text-xs text-slate-300"><div className="flex justify-between gap-3"><strong>{event.assetName}</strong><span>{event.monthsSinceHandover} months after handover</span></div><p className="mt-1">{event.failureMode ?? "Failure mode not recorded"}</p><p className="mt-1 text-slate-500">Attribution {words(event.attributedTo ?? "not recorded")} · feedback {event.fedBackToDesign ? "closed" : "open"} · {event.evidenceClass ?? "historic evidence class not recorded"} · {event.sourceReference ?? "historic source not recorded"}</p></div>) : <p className="text-xs text-slate-500">No early-life failures are recorded in this window. This is not presented as proof of stability.</p>}</div>
        {canRecord && <form onSubmit={recordFailure} className="mt-5 grid gap-2 md:grid-cols-3"><h3 className="text-xs font-semibold text-slate-200 md:col-span-3">Record a governed early-life observation</h3><select name="asset" required className="rounded border border-white/10 bg-overlook-deep p-2 text-xs"><option value="">Case asset…</option>{model.operationalReadiness.assets.map((asset) => <option key={asset.assetId} value={asset.assetId}>{asset.name}</option>)}</select><input name="occurredAt" type="datetime-local" required className="rounded border border-white/10 bg-overlook-deep p-2 text-xs"/><input name="months" type="number" min="0" step="any" placeholder="Months since handover (if known)" className="rounded border border-white/10 bg-overlook-deep p-2 text-xs"/><input name="failureMode" required minLength={3} placeholder="Failure mode" className="rounded border border-white/10 bg-overlook-deep p-2 text-xs"/><select name="attributedTo" required className="rounded border border-white/10 bg-overlook-deep p-2 text-xs"><option value="">Attribution…</option>{["design","manufacture","installation","commissioning","operation_outside_envelope","random","not_determined"].map((value) => <option key={value} value={value}>{words(value)}</option>)}</select><select name="evidenceClass" required className="rounded border border-white/10 bg-overlook-deep p-2 text-xs"><option value="">Evidence provenance…</option>{EVIDENCE_CLASSES.map((value) => <option key={value} value={value}>{words(value)}</option>)}</select><input name="preventableBy" placeholder="Preventable by / learning action" className="rounded border border-white/10 bg-overlook-deep p-2 text-xs"/><input name="sourceReference" required minLength={3} placeholder="Source/evidence reference" className="rounded border border-white/10 bg-overlook-deep p-2 text-xs md:col-span-2"/><textarea name="assessmentBasis" required minLength={20} placeholder="Evidence-based assessment (20+ characters)" className="rounded border border-white/10 bg-overlook-deep p-2 text-xs md:col-span-3"/><button disabled={busy || model.operationalReadiness.assets.length === 0} className="rounded bg-signal-cyan px-3 py-2 text-xs font-semibold text-slate-950 disabled:opacity-50 md:col-span-3">{busy ? "Recording…" : "Record observation"}</button></form>}
      </section>
    </>}
  </div>;
}
