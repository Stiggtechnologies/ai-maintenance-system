import { useCallback, useEffect, useState } from "react";
import { CircleAlert, GitBranch, Plus, Save } from "lucide-react";
import {
  getCaseDevelopmentWorkstreams,
  recordDevelopmentWorkstream,
  type DevelopmentApproach,
  type HybridDevelopmentState,
} from "../../services/hybridDevelopmentService";

const APPROACHES: Array<{
  value: DevelopmentApproach;
  label: string;
  description: string;
}> = [
  { value: "predictive", label: "Predictive", description: "Defined scope and sequenced delivery against an approved plan." },
  { value: "adaptive", label: "Adaptive", description: "Short feedback cycles reshape the solution as needs are learned." },
  { value: "iterative", label: "Iterative", description: "Repeated increments improve a solution against measured results." },
  { value: "hybrid", label: "Hybrid", description: "A governed combination of predictive and adaptive or iterative practices." },
];

type Member = { id: string; name: string };

export function HybridDevelopmentPanel({
  caseId,
  members,
  canPlan,
}: {
  caseId: string;
  members: Member[];
  canPlan: boolean;
}) {
  const [state, setState] = useState<HybridDevelopmentState | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const [approach, setApproach] = useState<DevelopmentApproach>("predictive");
  const [rationale, setRationale] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [planningHorizon, setPlanningHorizon] = useState("");
  const [reviewCadence, setReviewCadence] = useState("");

  const load = useCallback(async () => {
    try {
      setState(await getCaseDevelopmentWorkstreams(caseId));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load development workstreams");
    }
  }, [caseId]);

  useEffect(() => void load(), [load]);

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const horizon = planningHorizon === "" ? null : Number(planningHorizon);
      const cadence = reviewCadence === "" ? null : Number(reviewCadence);
      if ((horizon != null && (!Number.isInteger(horizon) || horizon <= 0)) ||
          (cadence != null && (!Number.isInteger(cadence) || cadence <= 0))) {
        throw new Error("Planning horizon and review cadence must be positive whole days.");
      }
      const result = await recordDevelopmentWorkstream({
        caseId,
        workstreamCode: code,
        title,
        developmentApproach: approach,
        approachRationale: rationale,
        ownerId: ownerId || null,
        planningHorizonDays: horizon,
        reviewCadenceDays: cadence,
      });
      setMessage(`Workstream ${result.workstream_code} v${result.version} adopted by an accountable human.`);
      setCode("");
      setTitle("");
      setRationale("");
      setOwnerId("");
      setPlanningHorizon("");
      setReviewCadence("");
      setEditing(false);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not adopt workstream approach");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-white/6 bg-[#0D1520] p-5" aria-labelledby="hybrid-development-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-signal-cyan" aria-hidden />
            <h2 id="hybrid-development-title" className="text-sm font-semibold text-slate-100">Hybrid development</h2>
          </div>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-400">
            Choose the delivery method that fits each workstream inside this one Development Case. The method is a human-adopted planning control; it does not pass a gate or sanction work.
          </p>
        </div>
        {canPlan && (
          <button type="button" onClick={() => setEditing((value) => !value)} className="flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-white/5">
            <Plus className="h-3.5 w-3.5" aria-hidden /> {editing ? "Cancel" : "Add or revise workstream"}
          </button>
        )}
      </div>

      {state && state.workstreams.length > 0 && (
        <div className="mt-3 rounded-lg border border-white/6 bg-black/10 px-3 py-2 text-xs text-slate-400">
          {state.isHybridCase
            ? `${state.distinctApproaches} delivery approaches are intentionally combined in this case.`
            : `All recorded workstreams currently use ${state.workstreams[0].developmentApproach}; this case is not yet operating as a mixed-method case.`}
        </div>
      )}

      {state?.workstreams.length === 0 && !editing && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-400/20 bg-amber-400/5 px-3 py-2.5 text-xs text-amber-200">
          <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          No workstream approach has been adopted. Record each physical, digital, design, installation, or other delivery stream separately.
        </div>
      )}

      {state && state.workstreams.length > 0 && (
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {state.workstreams.map((workstream) => (
            <article key={workstream.id} className="rounded-lg border border-white/6 bg-white/[0.02] p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-xs font-semibold text-slate-200">{workstream.workstreamCode} · {workstream.title}</div>
                  <div className="mt-1 text-[11px] uppercase tracking-wide text-signal-cyan">{workstream.developmentApproach}</div>
                </div>
                <span className="text-[10px] text-slate-500">v{workstream.version}</span>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-slate-400">{workstream.approachRationale}</p>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
                <span>Owner: {workstream.owner ?? "not assigned"}</span>
                <span>Planning horizon: {workstream.planningHorizonDays == null ? "not recorded" : `${workstream.planningHorizonDays} days`}</span>
                <span>Review cadence: {workstream.reviewCadenceDays == null ? "not recorded" : `${workstream.reviewCadenceDays} days`}</span>
              </div>
            </article>
          ))}
        </div>
      )}

      {editing && (
        <div className="mt-4 space-y-3 rounded-lg border border-signal-cyan/20 bg-signal-cyan/[0.03] p-3">
          <p className="text-xs text-slate-400">Reusing an existing code creates a new immutable version and retires the previous one.</p>
          <div className="grid gap-2 md:grid-cols-2">
            <label className="text-xs text-slate-400">Workstream code
              <input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="CIVIL" className="mt-1 w-full rounded border border-white/10 bg-black/20 px-2 py-1.5 text-slate-200" />
            </label>
            <label className="text-xs text-slate-400">Workstream name
              <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Civil construction" className="mt-1 w-full rounded border border-white/10 bg-black/20 px-2 py-1.5 text-slate-200" />
            </label>
            <label className="text-xs text-slate-400">Development approach
              <select value={approach} onChange={(event) => setApproach(event.target.value as DevelopmentApproach)} className="mt-1 w-full rounded border border-white/10 bg-[#0D1520] px-2 py-1.5 text-slate-200">
                {APPROACHES.map((item) => <option key={item.value} value={item.value}>{item.label} — {item.description}</option>)}
              </select>
            </label>
            <label className="text-xs text-slate-400">Accountable owner
              <select value={ownerId} onChange={(event) => setOwnerId(event.target.value)} className="mt-1 w-full rounded border border-white/10 bg-[#0D1520] px-2 py-1.5 text-slate-200">
                <option value="">Not assigned</option>
                {members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
              </select>
            </label>
            <label className="text-xs text-slate-400">Planning horizon (days, optional)
              <input type="number" min="1" step="1" value={planningHorizon} onChange={(event) => setPlanningHorizon(event.target.value)} className="mt-1 w-full rounded border border-white/10 bg-black/20 px-2 py-1.5 text-slate-200" />
            </label>
            <label className="text-xs text-slate-400">Review cadence (days, optional)
              <input type="number" min="1" step="1" value={reviewCadence} onChange={(event) => setReviewCadence(event.target.value)} className="mt-1 w-full rounded border border-white/10 bg-black/20 px-2 py-1.5 text-slate-200" />
            </label>
          </div>
          <label className="block text-xs text-slate-400">Approach rationale
            <textarea value={rationale} onChange={(event) => setRationale(event.target.value)} rows={3} placeholder="Explain why this delivery method fits the uncertainty, feedback needs, and physical or digital nature of this workstream." className="mt-1 w-full rounded border border-white/10 bg-black/20 px-2 py-1.5 text-slate-200" />
          </label>
          <button type="button" disabled={busy || code.trim()==="" || title.trim().length<3 || rationale.trim().length<20} onClick={() => void save()} className="flex items-center gap-1.5 rounded bg-signal-cyan/15 px-3 py-1.5 text-xs font-medium text-signal-cyan disabled:opacity-40">
            <Save className="h-3.5 w-3.5" aria-hidden /> {busy ? "Adopting…" : "Adopt workstream approach"}
          </button>
        </div>
      )}

      {message && <p className="mt-3 text-xs text-slate-300">{message}</p>}
    </section>
  );
}
