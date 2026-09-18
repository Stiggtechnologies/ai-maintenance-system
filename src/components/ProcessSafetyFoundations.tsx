import { FormEvent, useState } from "react";
import { Landmark, CheckCircle2, TriangleAlert } from "lucide-react";
import { supabase } from "../lib/supabase";

type FoundationAction = "sce" | "hazard" | "link" | "window" | "exceedance" | "assessment";
const actions: { value: FoundationAction; label: string }[] = [
  { value: "sce", label: "Safety-critical element" },
  { value: "hazard", label: "Major hazard" },
  { value: "link", label: "Hazard-to-barrier link" },
  { value: "window", label: "Integrity operating window" },
  { value: "exceedance", label: "Integrity-window exceedance" },
  { value: "assessment", label: "Engineering exceedance assessment" },
];
const control = "mt-1 w-full rounded border border-white/10 bg-overlook-deep px-2 py-1.5 text-sm text-slate-100";

export function ProcessSafetyFoundations() {
  const [action, setAction] = useState<FoundationAction>("sce");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(null); setMessage(null);
    const form = new FormData(event.currentTarget);
    const v = (name: string) => String(form.get(name) ?? "").trim();
    const record = Object.fromEntries(Array.from(form.entries()).map(([k, value]) => [k, String(value).trim() || null]));
    const call = action === "link"
      ? ["link_hazard_barrier", { p_hazard_id: Number(v("hazard_id")), p_sce_id: Number(v("sce_id")), p_relation: v("relation"), p_basis: v("evidence_basis") }]
      : action === "assessment"
        ? ["assess_integrity_exceedance", { p_exceedance_id: Number(v("exceedance_id")), p_note: v("evidence_basis") }]
      : [{ sce: "record_safety_critical_element", hazard: "record_major_hazard", window: "record_integrity_window", exceedance: "record_integrity_exceedance" }[action], { p_record: record }];
    const result = await (supabase as unknown as { rpc: (name: string, args: Record<string, unknown>) => Promise<{ error: { message: string } | null }> }).rpc(call[0] as string, call[1] as Record<string, unknown>);
    setBusy(false);
    if (result.error) setError(result.error.message);
    else { setMessage(action === "exceedance" ? "Recorded and awaiting independent engineering assessment." : "Recorded in the governed safety foundation."); event.currentTarget.reset(); }
  }

  return <section className="rounded-xl border border-white/6 p-4" aria-labelledby="safety-foundations-heading">
    <h3 id="safety-foundations-heading" className="flex items-center gap-2 text-sm font-semibold text-white"><Landmark className="h-4 w-4 text-signal-cyan" aria-hidden />Safety foundations</h3>
    <p className="mt-1 text-xs text-slate-400">Establish the site’s barrier and hazard basis. Limits and standards must come from approved operator evidence.</p>
    <form onSubmit={submit} className="mt-3 space-y-3">
      <label className="block text-xs text-slate-300">Record type<select className={control} value={action} onChange={(e) => setAction(e.target.value as FoundationAction)}>{actions.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}</select></label>
      {action === "sce" && <><Field name="asset_id" label="Asset ID (optional)" optional /><Field name="sce_ref" label="SCE reference" /><Field name="label" label="Barrier label" /><Choice name="barrier_kind" label="Barrier kind" values={["instrumented","mechanical","passive","procedural","human","structural","emergency_response"]} /><Choice name="barrier_role" label="Barrier role" values={["preventive","mitigative"]} /><Field name="performance_standard" label="Testable performance standard" area /><Field name="test_interval_months" label="Owner-approved test interval (months, optional)" type="number" optional /></>}
      {action === "hazard" && <><Field name="site_id" label="Site ID (optional)" optional /><Field name="hazard_ref" label="Hazard reference" /><Field name="title" label="Hazard title" /><Field name="top_event" label="Top event" area /><Field name="worst_credible_consequence" label="Worst credible consequence" area optional /><Choice name="consequence_class" label="Consequence class (optional)" optional values={["multiple_fatality","single_fatality","major_injury","major_environmental","major_asset_loss"]} /></>}
      {action === "link" && <><Field name="hazard_id" label="Major hazard ID" type="number" /><Field name="sce_id" label="Safety-critical element ID" type="number" /><Field name="relation" label="Threat or consequence controlled" area /></>}
      {action === "window" && <><Field name="asset_id" label="Asset ID" /><Field name="parameter" label="Operating parameter" /><Field name="unit" label="Unit" /><div className="grid gap-3 sm:grid-cols-2"><Field name="standard_low" label="Standard low" type="number" optional /><Field name="standard_high" label="Standard high" type="number" optional /><Field name="critical_low" label="Critical low" type="number" optional /><Field name="critical_high" label="Critical high" type="number" optional /></div><Field name="damage_mechanism" label="Damage mechanism" area /><Field name="consequence_of_exceedance" label="Consequence of exceedance" area /></>}
      {action === "exceedance" && <><Field name="window_id" label="Integrity window ID" type="number" /><Field name="occurred_at" label="Occurred at" type="datetime-local" /><Field name="ended_at" label="Ended at (optional)" type="datetime-local" optional /><Field name="peak_value" label="Peak value (optional)" type="number" optional /><Choice name="severity" label="Severity" values={["standard","critical"]} /></>}
      {action === "assessment" && <Field name="exceedance_id" label="Unassessed exceedance ID" type="number" />}
      <Field name="evidence_basis" label="Approved evidence basis (minimum 20 characters)" area />
      {error && <p role="alert" className="flex gap-2 text-xs text-rose-300"><TriangleAlert className="h-4 w-4" />{error}</p>}{message && <p role="status" className="flex gap-2 text-xs text-emerald-300"><CheckCircle2 className="h-4 w-4" />{message}</p>}
      <button disabled={busy} className="rounded bg-signal-cyan px-3 py-1.5 text-sm font-medium text-slate-950 disabled:opacity-50">{busy ? "Recording…" : "Record foundation"}</button>
    </form>
  </section>;
}

function Field({ name, label, type="text", optional=false, area=false }: { name:string; label:string; type?:string; optional?:boolean; area?:boolean }) { return <label className="block text-xs text-slate-300">{label}{area ? <textarea name={name} required={!optional} rows={3} className={control} /> : <input name={name} required={!optional} type={type} step={type === "number" ? "any" : undefined} className={control} />}</label>; }
function Choice({ name, label, values, optional=false }: { name:string; label:string; values:string[]; optional?:boolean }) { return <label className="block text-xs text-slate-300">{label}<select name={name} required={!optional} className={control}>{optional && <option value="">Not set</option>}{values.map((v) => <option key={v} value={v}>{v.replaceAll("_"," ")}</option>)}</select></label>; }
