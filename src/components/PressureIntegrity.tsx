import { FormEvent, useState } from "react";
import { Gauge, CheckCircle2, TriangleAlert } from "lucide-react";
import { supabase } from "../lib/supabase";

type Action = "circuit" | "reading" | "assessment";
const control =
  "mt-1 w-full rounded border border-white/10 bg-overlook-deep px-2 py-1.5 text-sm text-slate-100";

export function PressureIntegrity() {
  const [action, setAction] = useState<Action>("circuit");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    const form = new FormData(e.currentTarget);
    const v = (n: string) => String(form.get(n) ?? "").trim();
    const record = Object.fromEntries(
      Array.from(form.entries()).map(([k, x]) => [k, String(x).trim() || null]),
    );
    const call =
      action === "assessment"
        ? [
            "assess_corrosion_circuit",
            {
              p_circuit_id: Number(v("circuit_id")),
              p_cml_ref: v("cml_ref"),
              p_inspection_fraction: Number(v("inspection_fraction")),
            },
          ]
        : [
            action === "circuit"
              ? "record_corrosion_circuit"
              : "record_thickness_reading",
            { p_record: record },
          ];
    const response = await (
      supabase as unknown as {
        rpc: (
          name: string,
          args: Record<string, unknown>,
        ) => Promise<{
          data: Record<string, unknown> | null;
          error: { message: string } | null;
        }>;
      }
    ).rpc(call[0] as string, call[1] as Record<string, unknown>);
    setBusy(false);
    if (response.error) setError(response.error.message);
    else setResult(response.data);
  }
  return (
    <section
      className="rounded-xl border border-white/6 p-4"
      aria-labelledby="pressure-integrity-heading"
    >
      <h3
        id="pressure-integrity-heading"
        className="flex items-center gap-2 text-sm font-semibold text-white"
      >
        <Gauge className="h-4 w-4 text-signal-cyan" aria-hidden />
        Pressure equipment &amp; piping integrity
      </h3>
      <p className="mt-1 text-xs text-slate-400">
        Record corrosion evidence and screen remaining life from owner-approved
        limits. Results do not replace the authorized inspection plan.
      </p>
      <form onSubmit={submit} className="mt-3 space-y-3">
        <label className="block text-xs text-slate-300">
          Workflow
          <select
            className={control}
            value={action}
            onChange={(e) => setAction(e.target.value as Action)}
          >
            <option value="circuit">Create corrosion circuit</option>
            <option value="reading">Record thickness reading</option>
            <option value="assessment">Screen circuit / CML</option>
          </select>
        </label>
        {action === "circuit" && (
          <>
            <Field name="circuit_ref" label="Circuit reference" />
            <Field name="description" label="Description" />
            <Field name="material" label="Material" />
            <Field name="service_fluid" label="Service fluid" />
            <Field name="damage_mechanisms" label="Damage mechanisms" area />
            <Field
              name="design_thickness_mm"
              label="Design thickness (mm, optional)"
              type="number"
              optional
            />
            <Field
              name="minimum_thickness_mm"
              label="Owner-approved minimum thickness (mm)"
              type="number"
            />
            <Field
              name="evidence_basis"
              label="Approved minimum-thickness and damage-mechanism evidence"
              area
            />
          </>
        )}
        {action === "reading" && (
          <>
            <Field name="circuit_id" label="Circuit ID" type="number" />
            <Field name="cml_ref" label="CML reference" />
            <Field name="measured_on" label="Measured on" type="date" />
            <Field name="thickness_mm" label="Thickness (mm)" type="number" />
            <Field name="method" label="Measurement method" />
            <Field
              name="evidence_basis"
              label="Inspection record / evidence basis"
              area
            />
          </>
        )}
        {action === "assessment" && (
          <>
            <Field name="circuit_id" label="Circuit ID" type="number" />
            <Field name="cml_ref" label="CML reference" />
            <Field
              name="inspection_fraction"
              label="Approved inspection fraction (0–1)"
              type="number"
            />
          </>
        )}
        {error && (
          <p role="alert" className="flex gap-2 text-xs text-rose-300">
            <TriangleAlert className="h-4 w-4" />
            {error}
          </p>
        )}
        {result && (
          <div
            role="status"
            className="rounded border border-emerald-400/20 p-2 text-xs text-emerald-200"
          >
            <p className="flex gap-2">
              <CheckCircle2 className="h-4 w-4" />
              Result: {String(result.status)}
            </p>
            {result.corrosionRateMmPerYear != null && (
              <p>
                Corrosion rate: {String(result.corrosionRateMmPerYear)} mm/year
              </p>
            )}
            {result.remainingLifeYears != null && (
              <p>
                Remaining-life screen: {String(result.remainingLifeYears)} years
                · candidate interval: {String(result.candidateIntervalYears)}{" "}
                years
              </p>
            )}
          </div>
        )}
        <button
          disabled={busy}
          className="rounded bg-signal-cyan px-3 py-1.5 text-sm font-medium text-slate-950 disabled:opacity-50"
        >
          {busy ? "Working…" : "Submit"}
        </button>
      </form>
    </section>
  );
}
function Field({
  name,
  label,
  type = "text",
  optional = false,
  area = false,
}: {
  name: string;
  label: string;
  type?: string;
  optional?: boolean;
  area?: boolean;
}) {
  return (
    <label className="block text-xs text-slate-300">
      {label}
      {area ? (
        <textarea
          name={name}
          required={!optional}
          rows={3}
          className={control}
        />
      ) : (
        <input
          name={name}
          required={!optional}
          type={type}
          min={type === "number" ? "0" : undefined}
          step={type === "number" ? "any" : undefined}
          className={control}
        />
      )}
    </label>
  );
}
