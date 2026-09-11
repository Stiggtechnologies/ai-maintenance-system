import { FormEvent, useCallback, useEffect, useState } from "react";
import type { OrgMember } from "../../services/developService";
import {
  acknowledgeOperationalDebt,
  approveOperationalDebtValuation,
  getCaseOperationalDebt,
  getOperationalDebtCandidates,
  recordOperationalDebtReference,
  recordOperationalDebtValuation,
  type OperationalDebtCandidate,
  type OperationalDebtRegister,
} from "../../services/operationalDebtService";

const label = (value: string) => value.replaceAll("_", " ");

export function OperationalDebtPanel({ caseId, members, canPlan, canAcknowledge }: {
  caseId: string; members: OrgMember[]; canPlan: boolean; canAcknowledge: boolean;
}) {
  const [register, setRegister] = useState<OperationalDebtRegister | null>(null);
  const [candidates, setCandidates] = useState<OperationalDebtCandidate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => Promise.all([
    getCaseOperationalDebt(caseId), getOperationalDebtCandidates(caseId),
  ]).then(([result, current]) => { setRegister(result); setCandidates(current); })
    .catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to load operational debt")), [caseId]);
  useEffect(() => { void load(); }, [load]);

  async function recordReference(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const values = new FormData(form);
    const key = String(values.get("candidate"));
    const candidate = candidates.find((item) => `${item.gapClass}|${item.sourceTable}|${item.sourceId}` === key);
    if (!candidate) return;
    setBusy(true); setError(null);
    try {
      await recordOperationalDebtReference(caseId, candidate, String(values.get("owner")), String(values.get("due")) || null);
      form.reset(); await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Registration refused"); }
    finally { setBusy(false); }
  }

  async function recordValuation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const values = new FormData(form);
    setBusy(true); setError(null);
    try {
      await recordOperationalDebtValuation(String(values.get("item")), {
        resolutionCost: Number(values.get("resolutionCost")),
        annualOperatingCost: Number(values.get("annualOperatingCost")),
        annualRiskExposure: Number(values.get("annualRiskExposure")),
        exposureYears: Number(values.get("exposureYears")),
        discountRate: Number(values.get("discountRate")),
        currency: String(values.get("currency")), basis: String(values.get("basis")),
        sourceReference: String(values.get("sourceReference")),
      });
      form.reset(); await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Valuation refused"); }
    finally { setBusy(false); }
  }

  async function acknowledge(id: string) {
    const basis = window.prompt("State the operations acknowledgement evidence basis (minimum 20 characters):");
    if (!basis) return;
    try { await acknowledgeOperationalDebt(id, basis); await load(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Acknowledgement refused"); }
  }

  async function approveValuation(id: string, version: number) {
    const basis = window.prompt("State the independent valuation approval basis (minimum 20 characters):");
    if (!basis) return;
    try { await approveOperationalDebtValuation(id, version, basis); await load(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Valuation approval refused"); }
  }

  const items = register?.items ?? [];
  return <section className="rounded-xl border border-white/6 bg-[#0D1520] p-5">
    <h2 className="text-sm font-semibold text-white">Operational debt at handover</h2>
    <p className="mt-1 text-xs text-slate-400">Nine gap classes linked to canonical records; this register does not copy the source facts. Lifecycle exposure uses explicit cost, risk, horizon and discount assumptions; unknown items remain unvalued, never zero.</p>
    {error && <p role="alert" className="mt-2 text-xs text-rose-300">{error}</p>}
    {register && <div className="mt-3 rounded-lg border border-white/8 p-3 text-xs text-slate-300">
      <strong className="text-slate-100">Lifecycle exposure</strong>
      <p className="mt-1">{register.totalsByCurrency.length ? register.totalsByCurrency.map((total) => `${total.lifecycleExposure.toLocaleString()} ${total.currency} (${total.valuedItems} item${total.valuedItems === 1 ? "" : "s"})`).join(" · ") : "No independently approved valuations yet."}</p>
      <p className="mt-1 text-slate-500">{register.unvaluedCount} unvalued of {register.itemCount} item(s). {register.note}</p>
    </div>}
    <div className="mt-3 space-y-2">{items.length ? items.map((item) => <div key={item.id} className="rounded-lg border border-white/8 p-3 text-xs text-slate-300">
      <div className="flex justify-between gap-2"><strong className="text-slate-100">{label(item.gapClass)}</strong><span>{item.acknowledgedAt ? "Seen and acknowledged by operations" : "Awaiting operations acknowledgement"}</span></div>
      <p className="mt-1 text-slate-500">Canonical reference: {item.sourceTable} / {item.sourceId} · owner {item.ownerName}{item.dueOn ? ` · due ${item.dueOn}` : ""}</p>
      <p className="mt-1 text-slate-400">{item.approvedValuation ? `${item.approvedValuation.lifecycleExposure.toLocaleString()} ${item.approvedValuation.currency} lifecycle exposure · ${item.approvedValuation.sourceReference}` : item.pendingValuation ? `${item.pendingValuation.lifecycleExposure.toLocaleString()} ${item.pendingValuation.currency} awaiting independent valuation approval` : "Lifecycle exposure unvalued"}</p>
      <div className="mt-2 flex gap-2">
        {canAcknowledge && !item.acknowledgedAt && <button onClick={() => void acknowledge(item.id)} className="rounded border border-signal-cyan/30 px-2 py-1 text-signal-cyan">Acknowledge for operations</button>}
        {canAcknowledge && item.pendingValuation && <button onClick={() => void approveValuation(item.id, item.pendingValuation!.version)} className="rounded border border-signal-cyan/30 px-2 py-1 text-signal-cyan">Approve valuation independently</button>}
      </div>
    </div>) : <p className="text-xs text-slate-500">No operational debt has been registered for this case.</p>}</div>

    {canPlan && <form onSubmit={recordReference} className="mt-4 grid gap-2 md:grid-cols-3">
      <select name="candidate" required className="rounded border border-white/10 bg-overlook-deep p-2 text-xs md:col-span-3"><option value="">Select a current canonical gap…</option>{candidates.map((candidate) => <option key={`${candidate.gapClass}|${candidate.sourceTable}|${candidate.sourceId}`} value={`${candidate.gapClass}|${candidate.sourceTable}|${candidate.sourceId}`}>{label(candidate.gapClass)} — {candidate.label}</option>)}</select>
      <select name="owner" required className="rounded border border-white/10 bg-overlook-deep p-2 text-xs md:col-span-2"><option value="">Accountable owner…</option>{members.map((member) => <option key={member.id} value={member.id}>{member.full_name ?? member.email ?? member.id}</option>)}</select>
      <input name="due" type="date" className="rounded border border-white/10 bg-overlook-deep p-2 text-xs" />
      <button disabled={busy || candidates.length === 0} className="rounded bg-signal-cyan px-3 py-2 text-xs font-semibold text-slate-950 disabled:opacity-50 md:col-span-3">{busy ? "Registering…" : "Register referenced gap"}</button>
    </form>}

    {canPlan && items.length > 0 && <form onSubmit={recordValuation} className="mt-5 grid gap-2 md:grid-cols-3">
      <h3 className="text-xs font-semibold text-slate-200 md:col-span-3">Record a stated-basis lifecycle-exposure calculation</h3>
      <select name="item" required className="rounded border border-white/10 bg-overlook-deep p-2 text-xs md:col-span-3"><option value="">Operational-debt item…</option>{items.filter((item) => !item.pendingValuation).map((item) => <option key={item.id} value={item.id}>{label(item.gapClass)} · {item.sourceTable}/{item.sourceId}</option>)}</select>
      <input name="resolutionCost" required type="number" min="0" step="any" placeholder="One-time resolution cost" className="rounded border border-white/10 bg-overlook-deep p-2 text-xs" />
      <input name="annualOperatingCost" required type="number" min="0" step="any" placeholder="Annual operating cost" className="rounded border border-white/10 bg-overlook-deep p-2 text-xs" />
      <input name="annualRiskExposure" required type="number" min="0" step="any" placeholder="Annual risk exposure" className="rounded border border-white/10 bg-overlook-deep p-2 text-xs" />
      <input name="exposureYears" required type="number" min="0.01" max="100" step="any" placeholder="Exposure years" className="rounded border border-white/10 bg-overlook-deep p-2 text-xs" />
      <input name="discountRate" required type="number" min="0" max="0.999999" step="any" placeholder="Discount rate (decimal)" className="rounded border border-white/10 bg-overlook-deep p-2 text-xs" />
      <input name="currency" required pattern="[A-Za-z]{3}" maxLength={3} placeholder="ISO currency" className="rounded border border-white/10 bg-overlook-deep p-2 text-xs" />
      <input name="sourceReference" required minLength={3} placeholder="Source/evidence reference" className="rounded border border-white/10 bg-overlook-deep p-2 text-xs" />
      <textarea name="basis" required minLength={20} placeholder="Calculation and assumption basis (20+ characters)" className="rounded border border-white/10 bg-overlook-deep p-2 text-xs md:col-span-2" />
      <button disabled={busy} className="rounded bg-signal-cyan px-3 py-2 text-xs font-semibold text-slate-950 disabled:opacity-50 md:col-span-3">{busy ? "Calculating…" : "Calculate for independent approval"}</button>
    </form>}
  </section>;
}
