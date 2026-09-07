import { FormEvent, useState } from "react";
import { ClipboardPenLine, CheckCircle2, TriangleAlert } from "lucide-react";
import { supabase } from "../lib/supabase";

type Action = "inspection" | "inspectionComplete" | "relief" | "reliefTest" | "loss" | "impairment" | "approve" | "restore" | "temporary" | "remove";

const ACTIONS: { value: Action; label: string }[] = [
  { value: "inspection", label: "Inspection plan" },
  { value: "inspectionComplete", label: "Inspection completion" },
  { value: "relief", label: "Relief device" },
  { value: "reliefTest", label: "Relief-device test" },
  { value: "loss", label: "Loss of containment" },
  { value: "impairment", label: "Barrier impairment" },
  { value: "approve", label: "Approve barrier deviation" },
  { value: "restore", label: "Record barrier restoration" },
  { value: "temporary", label: "Temporary modification" },
  { value: "remove", label: "Record temporary-modification removal" },
];

function inputClass() {
  return "mt-1 w-full rounded border border-white/10 bg-overlook-deep px-2 py-1.5 text-sm text-slate-100";
}

/** A controlled entry point for canonical process-safety records. */
export function ProcessSafetyActivation() {
  const [action, setAction] = useState<Action>("inspection");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? "").trim();
    const flag = (name: string) => form.get(name) === "on";
    const json = {
      asset_id: value("asset_id") || null,
      circuit_id: value("circuit_id") || null,
      sce_id: value("sce_id") || null,
      device_ref: value("device_ref"),
      device_kind: value("device_kind"),
      governing_case: value("governing_case"),
      set_pressure: value("set_pressure") || null,
      set_pressure_unit: value("set_pressure_unit"),
      test_interval_months: value("test_interval_months") || null,
      probability_category: value("probability_category") || null,
      consequence_category: value("consequence_category") || null,
      risk_rank: value("risk_rank"),
      interval_months: value("interval_months") || null,
      interval_basis: value("interval_basis"),
      next_due: value("next_due") || null,
      last_performed: value("last_performed") || null,
      occurred_at: value("occurred_at") || null,
      tier: value("tier"),
      substance: value("substance"),
      quantity: value("quantity") || null,
      quantity_unit: value("quantity_unit"),
      reached_environment: flag("reached_environment"),
      investigation_reference: value("investigation_reference"),
      expected_restoration: value("expected_restoration") || null,
      reason: value("reason"),
      compensating_measures: value("compensating_measures"),
      modification_kind: value("modification_kind"),
      description: value("description"),
      required_removal_by: value("required_removal_by") || null,
      affects_safety_function: flag("affects_safety_function"),
      risk_assessment_ref: value("risk_assessment_ref"),
      evidence_basis: value("evidence_basis"),
    };
    const rpc = {
      inspection: "record_inspection_plan",
      inspectionComplete: "record_inspection_completion",
      relief: "register_relief_device",
      reliefTest: "record_relief_device_test",
      loss: "record_containment_loss",
      impairment: "declare_barrier_impairment",
      approve: "approve_barrier_deviation",
      restore: "restore_barrier_impairment",
      temporary: "record_safety_temporary_modification",
      remove: "remove_safety_temporary_modification",
    }[action];
    const args = action === "inspection" ? { p_plan: json }
      : action === "inspectionComplete" ? { p_plan_id: Number(value("plan_id")), p_performed_on: value("performed_on"), p_next_due: value("next_due"), p_basis: value("evidence_basis") }
      : action === "relief" ? { p_device: json }
        : action === "reliefTest" ? { p_device_id: Number(value("device_id")), p_tested_on: value("tested_on"), p_result: value("test_result"), p_basis: value("evidence_basis") }
        : action === "loss" ? { p_loss: json }
          : action === "impairment" ? { p_impairment: json }
            : action === "temporary" ? { p_modification: json }
              : action === "approve" ? { p_impairment_id: Number(value("impairment_id")), p_expires_on: value("expires_on"), p_basis: value("evidence_basis") }
                : action === "restore" ? { p_impairment_id: Number(value("impairment_id")), p_basis: value("evidence_basis") }
                  : { p_modification_id: Number(value("modification_id")), p_basis: value("evidence_basis") };
    setBusy(true);
    const { data, error: rpcError } = await (supabase as unknown as {
      rpc: (name: string, args: Record<string, unknown>) => Promise<{
        data: unknown;
        error: { message: string } | null;
      }>;
    }).rpc(rpc, args);
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    const status = (data as { status?: string } | null)?.status ?? "recorded";
    setMessage(status === "awaiting_independent_deviation_approval"
      ? "Recorded. The affected barrier is impaired and remains blocked until a different authorized human approves a dated deviation."
      : "Recorded in the controlled safety register with your evidence basis.");
    event.currentTarget.reset();
  }

  return (
    <section className="rounded-xl border border-white/6 p-4" aria-labelledby="ps-activation-heading">
      <h3 id="ps-activation-heading" className="flex items-center gap-2 text-sm font-semibold text-white">
        <ClipboardPenLine className="h-4 w-4 text-signal-cyan" aria-hidden />
        Controlled safety record
      </h3>
      <p className="mt-1 text-xs leading-relaxed text-slate-400">
        These records require a named human, a traceable evidence basis, and organization-scoped references. SyncAI will not calculate or invent a safety limit for you.
      </p>
      <form className="mt-3 space-y-3" onSubmit={submit}>
        <label className="block text-xs text-slate-300">Record type
          <select className={inputClass()} value={action} onChange={(e) => setAction(e.target.value as Action)}>
            {ACTIONS.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}
          </select>
        </label>

        {action === "inspection" && <>
          <Field name="asset_id" label="Asset ID (or corrosion circuit ID below)" optional />
          <Field name="circuit_id" label="Corrosion circuit ID" optional />
          <div className="grid gap-3 sm:grid-cols-2"><Field name="interval_months" label="Interval (months)" type="number" /><Field name="next_due" label="Next due" type="date" /></div>
          <Field name="interval_basis" label="Interval basis — source, assessment, and rationale" textarea />
        </>}
        {action === "inspectionComplete" && <>
          <Field name="plan_id" label="Inspection plan ID" type="number" />
          <div className="grid gap-3 sm:grid-cols-2"><Field name="performed_on" label="Performed on" type="date" /><Field name="next_due" label="Next due" type="date" /></div>
        </>}
        {action === "relief" && <>
          <Field name="asset_id" label="Asset ID (optional)" optional /><Field name="device_ref" label="Device reference" />
          <label className="block text-xs text-slate-300">Device kind<select name="device_kind" required className={inputClass()}><option value="psv">PSV</option><option value="rupture_disc">Rupture disc</option><option value="vacuum_breaker">Vacuum breaker</option><option value="conservation_vent">Conservation vent</option><option value="other">Other</option></select></label>
          <div className="grid gap-3 sm:grid-cols-2"><Field name="set_pressure" label="Set pressure" type="number" /><Field name="set_pressure_unit" label="Pressure unit" /></div>
          <Field name="governing_case" label="Governing relieving case" textarea />
        </>}
        {action === "reliefTest" && <>
          <Field name="device_id" label="Relief device ID" type="number" />
          <Field name="tested_on" label="Tested on" type="date" />
          <label className="block text-xs text-slate-300">Test result<select name="test_result" required className={inputClass()}><option value="pass">Pass</option><option value="pass_after_adjustment">Pass after adjustment</option><option value="fail_leak">Fail — leak</option><option value="fail_set_pressure">Fail — set pressure</option><option value="fail_stuck">Fail — stuck</option></select></label>
        </>}
        {action === "loss" && <>
          <Field name="asset_id" label="Asset ID (optional)" optional /><Field name="occurred_at" label="Occurred at" type="datetime-local" />
          <label className="block text-xs text-slate-300">API 754 tier<select name="tier" required className={inputClass()}><option value="tier_1">Tier 1</option><option value="tier_2">Tier 2</option><option value="tier_3">Tier 3</option><option value="tier_4">Tier 4</option></select></label>
          <Field name="substance" label="Substance" optional /><label className="flex items-center gap-2 text-xs text-slate-300"><input name="reached_environment" type="checkbox" /> Reached environment</label>
          <Field name="investigation_reference" label="Investigation reference" optional />
        </>}
        {action === "impairment" && <>
          <Field name="sce_id" label="Safety-critical element ID" /><Field name="expected_restoration" label="Expected restoration" type="date" />
          <Field name="reason" label="Reason for impairment" textarea /><Field name="compensating_measures" label="Compensating measures" textarea />
        </>}
        {action === "approve" && <>
          <Field name="impairment_id" label="Open barrier impairment ID" type="number" />
          <Field name="expires_on" label="Deviation expiry (no later than restoration)" type="date" />
        </>}
        {action === "restore" && <Field name="impairment_id" label="Open barrier impairment ID" type="number" />}
        {action === "temporary" && <>
          <Field name="asset_id" label="Asset ID" /><Field name="modification_kind" label="Modification kind (e.g. bypass, temporary_repair)" />
          <Field name="description" label="Description" textarea /><Field name="reason" label="Reason" textarea /><Field name="required_removal_by" label="Required removal by" type="date" />
          <label className="flex items-center gap-2 text-xs text-slate-300"><input name="affects_safety_function" type="checkbox" /> Affects a safety function</label>
          <Field name="sce_id" label="Affected safety-critical element ID (required if safety function affected)" optional /><Field name="compensating_measures" label="Compensating measures (required if safety function affected)" textarea optional />
          <Field name="risk_assessment_ref" label="Risk assessment reference" optional />
        </>}
        {action === "remove" && <Field name="modification_id" label="Open temporary modification ID" type="number" />}
        <Field name="evidence_basis" label="Evidence basis (minimum 20 characters)" textarea />
        {error && <p role="alert" className="flex gap-2 text-xs text-rose-300"><TriangleAlert className="h-4 w-4 shrink-0" />{error}</p>}
        {message && <p role="status" className="flex gap-2 text-xs text-emerald-300"><CheckCircle2 className="h-4 w-4 shrink-0" />{message}</p>}
        <button disabled={busy} className="rounded bg-signal-cyan px-3 py-1.5 text-sm font-medium text-slate-950 disabled:opacity-50">{busy ? "Recording…" : "Record with controls"}</button>
      </form>
    </section>
  );
}

function Field({ name, label, type = "text", textarea = false, optional = false }: { name: string; label: string; type?: string; textarea?: boolean; optional?: boolean }) {
  return <label className="block text-xs text-slate-300">{label}{textarea ? <textarea required={!optional} name={name} rows={3} className={inputClass()} /> : <input required={!optional} name={name} type={type} className={inputClass()} />}</label>;
}
