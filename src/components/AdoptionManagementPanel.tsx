import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, LockKeyhole, RefreshCw, Users } from "lucide-react";
import { useAuth } from "./AuthProvider";
import { ErrorState, LoadingState } from "./ui/AsyncStates";
import { useAsyncData } from "../hooks/useAsyncData";
import { supabase } from "../lib/supabase";
import {
  ADOPTION_MANAGEMENT_CATEGORIES,
  activateAdoptionProgram,
  createAdoptionProgram,
  getAdoptionManagementWorkspace,
  recordAdoptionValuePoint,
  reviewAdoptionProgram,
  setAdoptionItemStatus,
  submitAdoptionProgram,
  upsertAdoptionItem,
  type AdoptionCategory,
} from "../services/adoptionManagementService";

const LABELS: Record<AdoptionCategory, string> = {
  stakeholder_mapping: "Stakeholder mapping", role_design: "Role design",
  process_ownership: "Process ownership", training: "Training",
  field_trials: "Field trials", change_impact: "Change impact",
  feedback: "Feedback", adoption_metrics: "Adoption metrics",
  procedure_updates: "Procedure updates", incentives: "Incentives",
  communications: "Communications", champions: "Champions",
  benefits_tracking: "Benefits tracking",
};
type Evidence = { id: string; description: string | null };
const today = () => new Date().toISOString().slice(0, 10);
const inNinetyDays = () => new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);

export function AdoptionManagementPanel() {
  const { profile } = useAuth();
  const role = String(profile?.role ?? "");
  const canAuthor = ["admin", "executive", "maintenance_manager", "reliability_engineer"].includes(role);
  const canReview = role === "admin" || role === "executive";
  const workspace = useAsyncData(getAdoptionManagementWorkspace, [], { isEmpty: () => false });
  const evidence = useAsyncData(async () => {
    const { data, error } = await supabase.from("evidence_items").select("id,description")
      .eq("verification_status", "verified").order("created_at", { ascending: false }).limit(200).returns<Evidence[]>();
    if (error) throw new Error(error.message);
    return data ?? [];
  }, [], { isEmpty: () => false });
  const [selectedId, setSelectedId] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [basis, setBasis] = useState("");
  const [program, setProgram] = useState({ title: "", objective: "", scope: "", sponsorId: "", processOwnerId: "", startsOn: today(), targetOn: inNinetyDays(), maturityAssessmentId: "" });
  const [item, setItem] = useState({ category: "stakeholder_mapping" as AdoptionCategory, title: "", ownerId: "", affectedGroup: "", plan: "", successMeasure: "", sourceReference: "", impactLevel: "", safetyGuardrail: "", dueOn: inNinetyDays() });
  const [completion, setCompletion] = useState<Record<string, { note: string; evidenceId: string }>>({});
  const [measurement, setMeasurement] = useState<Record<string, { point: "baseline" | "target" | "actual"; value: string; unit: string; basis: string; evidenceId: string }>>({});
  const data = workspace.data;
  const selected = useMemo(() => data?.programs.find((entry) => entry.id === selectedId) ?? data?.programs[0], [data, selectedId]);

  const run = async (operation: () => Promise<unknown>, success: string) => {
    setBusy(true); setProblem(null); setNotice(null);
    try { await operation(); setNotice(success); await workspace.refetch(); }
    catch (error) { setProblem(error instanceof Error ? error.message : "The governed operation failed."); }
    finally { setBusy(false); }
  };

  if (workspace.loading || evidence.loading) return <LoadingState label="Loading adoption management…" />;
  if (workspace.error) return <ErrorState message={workspace.error} onRetry={workspace.refetch} />;
  if (evidence.error) return <ErrorState message={evidence.error} onRetry={evidence.refetch} />;
  if (!data) return <ErrorState message="No adoption workspace was returned." onRetry={workspace.refetch} />;

  return <div className="space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300"><Users className="h-4 w-4" /> Implementation and adoption</div>
        <h1 className="text-2xl font-bold text-white">Adoption management</h1>
        <p className="mt-1 max-w-4xl text-sm text-slate-400">Turn an approved baseline into an owned rollout across people, process, evidence and measurable value.</p>
      </div>
      <button onClick={workspace.refetch} className="flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-300"><RefreshCw className="h-4 w-4" /> Refresh</button>
    </header>
    <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-amber-200"><LockKeyhole className="h-4 w-4" /> Evidence and independent closeout</div>
      <p className="mt-1 text-xs leading-relaxed text-slate-400">All 13 disciplines need named owners before activation. Completion needs verified evidence; adoption and benefit claims need comparable measurements. This workspace never changes plant controls, procedures, work-release authority or spending authority.</p>
    </div>
    {notice && <div role="status" className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-300"><CheckCircle2 className="h-4 w-4" />{notice}</div>}
    {problem && <div role="alert" className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300"><AlertTriangle className="h-4 w-4" />{problem}</div>}

    {data.programs.length > 0 && <section className="space-y-3">
      <label className="text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="adoption-program">Program</label>
      <select id="adoption-program" value={selected?.id ?? ""} onChange={(event) => setSelectedId(event.target.value)} className="w-full rounded-lg border border-white/8 bg-[#111b28] p-3 text-sm text-white">
        {data.programs.map((entry) => <option key={entry.id} value={entry.id}>{entry.title} · {entry.status}</option>)}
      </select>
    </section>}

    {selected && <section className="rounded-2xl border border-white/8 bg-[#0D1520] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="text-lg font-semibold text-white">{selected.title}</h2><p className="mt-1 text-sm text-slate-400">{selected.objective}</p><p className="mt-2 text-xs text-slate-500">Sponsor: {selected.sponsor} · Process owner: {selected.processOwner}</p></div>
        <div className="rounded-lg border border-white/8 bg-black/20 px-4 py-2 text-center"><div className="text-xl font-black text-white">{selected.progress.completedCategories}/13</div><div className="text-[10px] uppercase text-slate-500">evidenced</div></div>
      </div>
      <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {ADOPTION_MANAGEMENT_CATEGORIES.map((category) => {
          const entries = selected.items.filter((entry) => entry.category === category);
          return <div key={category} className="rounded-lg border border-white/6 bg-black/20 p-3">
            <div className="flex items-center justify-between gap-2"><strong className="text-xs text-slate-200">{LABELS[category]}</strong><span className="text-[10px] text-slate-500">{entries.length ? entries.map((entry) => entry.status).join(", ") : "missing"}</span></div>
            {entries.map((entry) => <div key={entry.id} className="mt-2 border-t border-white/6 pt-2">
              <p className="text-xs font-medium text-white">{entry.title}</p><p className="mt-1 text-[10px] text-slate-500">{entry.owner} · due {entry.dueOn}</p>
              {selected.status === "active" && entry.status !== "complete" && <div className="mt-2 space-y-2">
                <textarea aria-label={`Completion basis for ${entry.title}`} value={completion[entry.id]?.note ?? ""} onChange={(event) => setCompletion((current) => ({ ...current, [entry.id]: { note: event.target.value, evidenceId: current[entry.id]?.evidenceId ?? "" } }))} placeholder="Completion, block or cancellation basis" className="min-h-16 w-full rounded border border-white/8 bg-[#111b28] p-2 text-xs text-white" />
                <select aria-label={`Completion evidence for ${entry.title}`} value={completion[entry.id]?.evidenceId ?? ""} onChange={(event) => setCompletion((current) => ({ ...current, [entry.id]: { note: current[entry.id]?.note ?? "", evidenceId: event.target.value } }))} className="w-full rounded border border-white/8 bg-[#111b28] p-2 text-xs text-white"><option value="">Verified evidence…</option>{(evidence.data ?? []).map((option) => <option key={option.id} value={option.id}>{option.description ?? option.id}</option>)}</select>
                <div className="flex flex-wrap gap-1">{(["in_progress", "blocked", "complete", "cancelled"] as const).map((status) => <button key={status} disabled={busy || ((status === "complete" || status === "blocked" || status === "cancelled") && (completion[entry.id]?.note.trim().length ?? 0) < 20) || (status === "complete" && !completion[entry.id]?.evidenceId)} onClick={() => run(() => setAdoptionItemStatus(entry.id, status, completion[entry.id]?.note ?? "", completion[entry.id]?.evidenceId), `${entry.title} moved to ${status}.`)} className="rounded bg-white/5 px-2 py-1 text-[10px] text-slate-300 disabled:opacity-30">{status.replace("_", " ")}</button>)}</div>
              </div>}
              {selected.status === "active" && (category === "adoption_metrics" || category === "benefits_tracking") && <div className="mt-3 space-y-2 rounded border border-cyan-400/10 p-2">
                <div className="grid grid-cols-3 gap-1"><select aria-label={`Value point for ${entry.title}`} value={measurement[entry.id]?.point ?? "baseline"} onChange={(event) => setMeasurement((current) => ({ ...current, [entry.id]: { ...(current[entry.id] ?? { value: "", unit: "", basis: "", evidenceId: "" }), point: event.target.value as "baseline" | "target" | "actual" } }))} className="rounded bg-[#111b28] p-1 text-[10px] text-white"><option>baseline</option><option>target</option><option>actual</option></select><input aria-label={`Value for ${entry.title}`} value={measurement[entry.id]?.value ?? ""} onChange={(event) => setMeasurement((current) => ({ ...current, [entry.id]: { ...(current[entry.id] ?? { point: "baseline", unit: "", basis: "", evidenceId: "" }), value: event.target.value } }))} placeholder="Value" type="number" className="rounded bg-[#111b28] p-1 text-[10px] text-white" /><input aria-label={`Unit for ${entry.title}`} value={measurement[entry.id]?.unit ?? ""} onChange={(event) => setMeasurement((current) => ({ ...current, [entry.id]: { ...(current[entry.id] ?? { point: "baseline", value: "", basis: "", evidenceId: "" }), unit: event.target.value } }))} placeholder="Unit" className="rounded bg-[#111b28] p-1 text-[10px] text-white" /></div>
                <textarea aria-label={`Value basis for ${entry.title}`} value={measurement[entry.id]?.basis ?? ""} onChange={(event) => setMeasurement((current) => ({ ...current, [entry.id]: { ...(current[entry.id] ?? { point: "baseline", value: "", unit: "", evidenceId: "" }), basis: event.target.value } }))} placeholder="Measurement basis" className="min-h-14 w-full rounded bg-[#111b28] p-1 text-[10px] text-white" /><select aria-label={`Value evidence for ${entry.title}`} value={measurement[entry.id]?.evidenceId ?? ""} onChange={(event) => setMeasurement((current) => ({ ...current, [entry.id]: { ...(current[entry.id] ?? { point: "baseline", value: "", unit: "", basis: "" }), evidenceId: event.target.value } }))} className="w-full rounded bg-[#111b28] p-1 text-[10px] text-white"><option value="">Verified evidence…</option>{(evidence.data ?? []).map((option) => <option key={option.id} value={option.id}>{option.description ?? option.id}</option>)}</select><button disabled={busy || !measurement[entry.id]?.value || !measurement[entry.id]?.unit || (measurement[entry.id]?.basis.length ?? 0) < 20 || !measurement[entry.id]?.evidenceId} onClick={() => { const value = measurement[entry.id]!; return run(() => recordAdoptionValuePoint({ itemId: entry.id, point: value.point, value: Number(value.value), unit: value.unit, basis: value.basis, evidenceItemId: value.evidenceId }), `${value.point} value point recorded.`); }} className="rounded bg-cyan-500/10 px-2 py-1 text-[10px] text-cyan-300 disabled:opacity-30">Record value point</button>
              </div>}
            </div>)}
          </div>;
        })}
      </div>
      {canAuthor && <div className="mt-5 space-y-2 border-t border-white/6 pt-4"><textarea aria-label="Program decision basis" value={basis} onChange={(event) => setBasis(event.target.value)} placeholder="Substantive activation, submission or review basis" className="min-h-20 w-full rounded-lg border border-white/8 bg-black/20 p-3 text-sm text-white" /><div className="flex flex-wrap gap-2">
        {selected.status === "draft" && <button disabled={busy || basis.trim().length < 20 || selected.progress.plannedCategories !== 13} onClick={() => run(() => activateAdoptionProgram(selected.id, basis), "Program activated with all 13 disciplines owned.")} className="rounded bg-cyan-500/15 px-4 py-2 text-xs font-semibold text-cyan-300 disabled:opacity-30">Activate all 13 disciplines</button>}
        {selected.status === "active" && <button disabled={busy || basis.trim().length < 20 || selected.progress.completedCategories !== 13 || selected.progress.openItems !== 0} onClick={() => run(() => submitAdoptionProgram(selected.id, basis), "Program submitted for independent closeout.")} className="rounded bg-cyan-500/15 px-4 py-2 text-xs font-semibold text-cyan-300 disabled:opacity-30">Submit evidenced closeout</button>}
        {selected.status === "review_pending" && canReview && (["approved", "rejected"] as const).map((decision) => <button key={decision} disabled={busy || basis.trim().length < 20} onClick={() => run(() => reviewAdoptionProgram(selected.id, decision, basis), `Program ${decision}.`)} className="rounded bg-white/5 px-4 py-2 text-xs font-semibold text-slate-300 disabled:opacity-30">{decision === "approved" ? "Approve independent closeout" : "Return to active"}</button>)}
      </div></div>}
    </section>}

    {canAuthor && <div className="grid gap-6 xl:grid-cols-2">
      <section className="rounded-2xl border border-white/8 bg-[#0D1520] p-5"><h2 className="font-semibold text-white">Create program</h2><div className="mt-3 grid gap-2">
        <input aria-label="Program title" value={program.title} onChange={(e) => setProgram({ ...program, title: e.target.value })} placeholder="Program title" className="rounded bg-black/20 p-2 text-sm text-white" /><textarea aria-label="Program objective" value={program.objective} onChange={(e) => setProgram({ ...program, objective: e.target.value })} placeholder="Measurable objective" className="min-h-16 rounded bg-black/20 p-2 text-sm text-white" /><textarea aria-label="Program scope" value={program.scope} onChange={(e) => setProgram({ ...program, scope: e.target.value })} placeholder="Sites, teams and processes in scope" className="min-h-16 rounded bg-black/20 p-2 text-sm text-white" />
        <div className="grid grid-cols-2 gap-2"><select aria-label="Program sponsor" value={program.sponsorId} onChange={(e) => setProgram({ ...program, sponsorId: e.target.value })} className="rounded bg-[#111b28] p-2 text-xs text-white"><option value="">Named sponsor…</option>{data.people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select><select aria-label="Program process owner" value={program.processOwnerId} onChange={(e) => setProgram({ ...program, processOwnerId: e.target.value })} className="rounded bg-[#111b28] p-2 text-xs text-white"><option value="">Process owner…</option>{data.people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select><input aria-label="Program start" type="date" value={program.startsOn} onChange={(e) => setProgram({ ...program, startsOn: e.target.value })} className="rounded bg-[#111b28] p-2 text-xs text-white" /><input aria-label="Program target" type="date" value={program.targetOn} onChange={(e) => setProgram({ ...program, targetOn: e.target.value })} className="rounded bg-[#111b28] p-2 text-xs text-white" /></div>
        <select aria-label="Linked maturity assessment" value={program.maturityAssessmentId} onChange={(e) => setProgram({ ...program, maturityAssessmentId: e.target.value })} className="rounded bg-[#111b28] p-2 text-xs text-white"><option value="">No linked maturity assessment</option>{data.maturityAssessments.map((entry) => <option key={entry.id} value={entry.id}>{entry.title} · {entry.overallLevel}/5</option>)}</select>
        <button disabled={busy || program.title.trim().length < 3 || program.objective.trim().length < 20 || program.scope.trim().length < 20 || !program.sponsorId || !program.processOwnerId} onClick={() => run(() => createAdoptionProgram(program), "Draft adoption program created.")} className="rounded bg-cyan-500/15 px-4 py-2 text-xs font-semibold text-cyan-300 disabled:opacity-30">Create governed draft</button>
      </div></section>
      {selected && selected.status !== "completed" && <section className="rounded-2xl border border-white/8 bg-[#0D1520] p-5"><h2 className="font-semibold text-white">Plan a discipline</h2><div className="mt-3 grid gap-2">
        <div className="grid grid-cols-2 gap-2"><select aria-label="Adoption category" value={item.category} onChange={(e) => setItem({ ...item, category: e.target.value as AdoptionCategory })} className="rounded bg-[#111b28] p-2 text-xs text-white">{ADOPTION_MANAGEMENT_CATEGORIES.map((category) => <option key={category} value={category}>{LABELS[category]}</option>)}</select><select aria-label="Adoption owner" value={item.ownerId} onChange={(e) => setItem({ ...item, ownerId: e.target.value })} className="rounded bg-[#111b28] p-2 text-xs text-white"><option value="">Named owner…</option>{data.people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></div>
        <input aria-label="Adoption item title" value={item.title} onChange={(e) => setItem({ ...item, title: e.target.value })} placeholder="Owned action" className="rounded bg-black/20 p-2 text-sm text-white" /><input aria-label="Affected group" value={item.affectedGroup} onChange={(e) => setItem({ ...item, affectedGroup: e.target.value })} placeholder="Affected group or audience" className="rounded bg-black/20 p-2 text-sm text-white" /><textarea aria-label="Adoption plan" value={item.plan} onChange={(e) => setItem({ ...item, plan: e.target.value })} placeholder="Execution plan and dependencies" className="min-h-16 rounded bg-black/20 p-2 text-sm text-white" /><textarea aria-label="Success measure" value={item.successMeasure} onChange={(e) => setItem({ ...item, successMeasure: e.target.value })} placeholder="Observable success measure" className="min-h-16 rounded bg-black/20 p-2 text-sm text-white" />
        <div className="grid grid-cols-2 gap-2"><input aria-label="Source reference" value={item.sourceReference} onChange={(e) => setItem({ ...item, sourceReference: e.target.value })} placeholder="Procedure/source revision" className="rounded bg-black/20 p-2 text-xs text-white" /><select aria-label="Impact level" value={item.impactLevel} onChange={(e) => setItem({ ...item, impactLevel: e.target.value })} className="rounded bg-[#111b28] p-2 text-xs text-white"><option value="">Impact level…</option><option>low</option><option>medium</option><option>high</option><option>critical</option></select></div><textarea aria-label="Safety guardrail" value={item.safetyGuardrail} onChange={(e) => setItem({ ...item, safetyGuardrail: e.target.value })} placeholder="Safety and anti-gaming guardrail" className="min-h-16 rounded bg-black/20 p-2 text-sm text-white" /><input aria-label="Adoption due date" type="date" value={item.dueOn} onChange={(e) => setItem({ ...item, dueOn: e.target.value })} className="rounded bg-[#111b28] p-2 text-xs text-white" />
        <button disabled={busy || item.title.trim().length < 3 || item.plan.trim().length < 20 || item.successMeasure.trim().length < 10 || !item.ownerId} onClick={() => run(() => upsertAdoptionItem(selected.id, item), `${LABELS[item.category]} plan saved.`)} className="rounded bg-cyan-500/15 px-4 py-2 text-xs font-semibold text-cyan-300 disabled:opacity-30">Save owned discipline</button>
      </div></section>}
    </div>}
    {!canAuthor && <p className="text-xs text-slate-500">This is a read-only view for your role. Server-side authority controls every transition.</p>}
  </div>;
}
