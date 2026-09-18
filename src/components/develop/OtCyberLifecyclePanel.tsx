import { useCallback, useEffect, useMemo, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { listCommissioningTests } from "../../services/developService";
import {
  getCaseOtCyberLifecycle,
  OT_CYBER_ARTIFACT_TYPES,
  recordCaseOtCyberArtifact,
  setCaseOtCyberApplicability,
  type OtCyberArtifactType,
  type OtCyberLifecycle,
} from "../../services/otCyberLifecycleService";

const LABELS: Record<OtCyberArtifactType, string> = {
  cyber_requirement: "Cyber requirement",
  architecture_review: "Architecture review",
  segmentation: "Segmentation",
  remote_access: "Remote access",
  vendor_access: "Vendor access",
  firmware: "Firmware",
  patchability: "Patchability",
  backup: "Backup",
  recovery: "Recovery",
  cyber_acceptance_test: "Cyber acceptance test",
};
const inputClass = "w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-signal-cyan/50 focus:outline-none";
const buttonClass = "rounded-lg bg-signal-cyan/15 px-3 py-2 text-xs font-semibold text-signal-cyan hover:bg-signal-cyan/25 disabled:opacity-40";

export function OtCyberLifecyclePanel({ caseId, members, canPlan, reloadKey }: {
  caseId: string;
  members: { id: string; name: string }[];
  canPlan: boolean;
  reloadKey?: number;
}) {
  const [position, setPosition] = useState<OtCyberLifecycle | null>(null);
  const [tests, setTests] = useState<{ id: number; test_ref: string; test_type: string | null }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<"applicable" | "not_applicable">("applicable");
  const [scopeBasis, setScopeBasis] = useState("");
  const [form, setForm] = useState({ artifactType: "cyber_requirement" as OtCyberArtifactType, requirementRef: "", requirement: "", ownerId: "", acceptanceCriteria: "", verificationMethod: "analysis", basis: "", commissioningTestId: "" });

  const load = useCallback(async () => {
    setError(null);
    try {
      const [p, t] = await Promise.all([getCaseOtCyberLifecycle(caseId), listCommissioningTests()]);
      setPosition(p);
      setTests(t);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [caseId]);
  useEffect(() => { void load(); }, [load, reloadKey]);
  const missing = useMemo(() => new Set(position?.items.filter((x) => x.state === "MISSING").map((x) => x.artifactType) ?? []), [position]);

  async function run(action: () => Promise<unknown>, reset?: () => void) {
    setBusy(true); setError(null);
    try { await action(); reset?.(); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  return <section className="rounded-xl border border-white/6 bg-[#0D1520] p-5 space-y-4">
    <div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-signal-cyan" aria-hidden /><h2 className="text-sm font-semibold text-slate-100">OT cybersecurity by design</h2></div>
    <p className="text-xs text-slate-400">The exact ten II.13 artifacts on the canonical requirement thread. Applicable gaps are hard gate blockers; proof remains in the existing verification and evidence records.</p>
    {error && <div className="rounded border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs text-red-300">{error}</div>}
    {position?.refusal && <div className="rounded border border-amber-400/25 bg-amber-400/5 px-3 py-2 text-xs text-amber-200">{position.refusal}</div>}
    {position && <div className="flex flex-wrap gap-2 text-xs">
      <span className={`rounded px-2 py-1 font-semibold ${position.status === "READY" || position.status === "NOT_APPLICABLE" ? "bg-emerald-400/10 text-emerald-300" : "bg-amber-400/10 text-amber-200"}`}>{position.status.replaceAll("_", " ")}</span>
      {position.requiredCount != null && <span className="rounded bg-white/5 px-2 py-1 text-slate-300">{position.satisfiedCount} / {position.requiredCount} evidence-ready</span>}
      {position.applicabilityBasis && <span className="text-slate-500">Basis: {position.applicabilityBasis}</span>}
    </div>}
    {canPlan && <div className="grid gap-2 md:grid-cols-[180px_1fr_auto]">
      <select value={scope} onChange={(e) => setScope(e.target.value as typeof scope)} className={inputClass}><option value="applicable">Applicable</option><option value="not_applicable">Not applicable</option></select>
      <input value={scopeBasis} onChange={(e) => setScopeBasis(e.target.value)} minLength={20} placeholder="Why OT cyber applies or does not apply (20+ characters)" className={inputClass} />
      <button disabled={busy || scopeBasis.trim().length < 20} className={buttonClass} onClick={() => void run(() => setCaseOtCyberApplicability({ caseId, applicability: scope, basis: scopeBasis }), () => setScopeBasis(""))}>Record scope decision</button>
    </div>}
    {position?.applicability === "applicable" && <>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {position.items.map((item) => <div key={item.artifactType} className={`rounded-lg border p-2 text-xs ${item.state === "SATISFIED" ? "border-emerald-400/20 bg-emerald-400/5" : "border-amber-400/20 bg-amber-400/5"}`}>
          <p className="font-semibold text-slate-200">{LABELS[item.artifactType]}</p><p className={item.state === "SATISFIED" ? "text-emerald-300" : "text-amber-200"}>{item.state.replaceAll("_", " ")}</p>
          {item.requirementRef && <p className="mt-1 text-slate-500">{item.requirementRef}</p>}
          {item.testRef && <p className="text-slate-500">Test: {item.testRef} · {item.testOutcome ?? "no result"} · {item.testReleaseStatus}</p>}
        </div>)}
      </div>
      {canPlan && missing.size > 0 && <div className="grid gap-2 md:grid-cols-2">
        <select value={form.artifactType} onChange={(e) => setForm({ ...form, artifactType: e.target.value as OtCyberArtifactType })} className={inputClass}>{OT_CYBER_ARTIFACT_TYPES.filter((x) => missing.has(x)).map((x) => <option key={x} value={x}>{LABELS[x]}</option>)}</select>
        <input value={form.requirementRef} onChange={(e) => setForm({ ...form, requirementRef: e.target.value })} placeholder="Requirement reference" className={inputClass} />
        <textarea value={form.requirement} onChange={(e) => setForm({ ...form, requirement: e.target.value })} placeholder="What must be true" minLength={10} className={inputClass} />
        <textarea value={form.acceptanceCriteria} onChange={(e) => setForm({ ...form, acceptanceCriteria: e.target.value })} placeholder="Measurable acceptance criteria" minLength={10} className={inputClass} />
        <select value={form.ownerId} onChange={(e) => setForm({ ...form, ownerId: e.target.value })} className={inputClass}><option value="">Named accountable owner…</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
        <select value={form.verificationMethod} onChange={(e) => setForm({ ...form, verificationMethod: e.target.value })} className={inputClass}><option value="analysis">Analysis</option><option value="inspection">Inspection</option><option value="demonstration">Demonstration</option><option value="test">Test</option><option value="operational_validation">Operational validation</option></select>
        {form.artifactType === "cyber_acceptance_test" && <select value={form.commissioningTestId} onChange={(e) => setForm({ ...form, commissioningTestId: e.target.value })} className={inputClass}><option value="">Acceptance test (may be linked later)…</option>{tests.map((t) => <option key={t.id} value={t.id}>{t.test_ref}{t.test_type ? ` · ${t.test_type}` : ""}</option>)}</select>}
        <textarea value={form.basis} onChange={(e) => setForm({ ...form, basis: e.target.value })} placeholder="Case-specific control basis (20+ characters)" minLength={20} className={inputClass} />
        <button disabled={busy || !form.requirementRef || form.requirement.trim().length < 10 || form.acceptanceCriteria.trim().length < 10 || !form.ownerId || form.basis.trim().length < 20} className={`${buttonClass} md:col-span-2`} onClick={() => void run(() => recordCaseOtCyberArtifact({ caseId, artifactType: form.artifactType, requirementRef: form.requirementRef, requirement: form.requirement, ownerId: form.ownerId, acceptanceCriteria: form.acceptanceCriteria, verificationMethod: form.verificationMethod, basis: form.basis, commissioningTestId: form.commissioningTestId ? Number(form.commissioningTestId) : null }), () => setForm({ artifactType: OT_CYBER_ARTIFACT_TYPES.find((x) => missing.has(x) && x !== form.artifactType) ?? "cyber_requirement", requirementRef: "", requirement: "", ownerId: "", acceptanceCriteria: "", verificationMethod: "analysis", basis: "", commissioningTestId: "" }))}>Add to the canonical requirement thread</button>
      </div>}
      <p className="text-[11px] text-slate-500">Plan and record each verification in the Requirements &amp; Verification panel below. A “verified” label without an achieved verification carrying evidence does not satisfy this lifecycle. Cyber acceptance additionally requires the linked canonical acceptance test to pass, carry evidence, and receive independent release.</p>
    </>}
    {position && <p className="text-[11px] text-slate-500">{position.decisionBoundary}</p>}
  </section>;
}
