import { FormEvent, useRef, useState } from "react";
import { ShieldCheck, TriangleAlert, CheckCircle2 } from "lucide-react";
import { supabase } from "../lib/supabase";
import { planRiskBasedInspection } from "../lib/integrity/rbi";
import type {
  DamageMechanism,
  RbiInput,
  RbiResult,
} from "../lib/integrity/rbi";
import { buildRbiAdoption } from "../lib/integrity/rbi-adoption";
import type { RbiAdoption } from "../lib/integrity/rbi-adoption";

/**
 * Risk-based inspection planning on the pressure-integrity surface (BOK-05,
 * register E2.06).
 *
 * The calculation runs in the browser on the shared pure kernel; nothing is
 * recorded until a named engineer adopts the proposal through the existing
 * human-only `record_inspection_plan` door, which enforces process-safety
 * authority, tenancy and the evidence-basis rule. Every input is the owner's,
 * with a stated basis — API 581 tables are not embedded.
 */

const control =
  "mt-1 w-full rounded border border-white/10 bg-overlook-deep px-2 py-1.5 text-sm text-slate-100";

interface CalculatedProposal {
  input: RbiInput;
  result: RbiResult;
  adoption: RbiAdoption;
  circuitId: string;
}

function circuitIdentity(value: string): string {
  // Canonical PostgreSQL bigint identity must never cross a Number conversion.
  if (!/^[1-9][0-9]{0,18}$/.test(value) || BigInt(value) > 9223372036854775807n)
    throw new Error(
      "Name the corrosion circuit using a positive PostgreSQL bigint ID.",
    );
  return value;
}

function mechanism(
  v: (n: string) => string,
  prefix: string,
): DamageMechanism | null {
  const fields = [
    ["name", "mechanism name"],
    ["basis", "source"],
    ["df0", "damage factor now"],
    ["horizon", "assessed horizon"],
    ["dfh", "damage factor at horizon"],
  ];
  const missing = fields.filter(([key]) => !v(`${prefix}_${key}`));
  if (prefix === "m2" && missing.length === fields.length) return null;
  if (missing.length)
    throw new Error(
      `${prefix === "m2" ? "Second" : "First"} damage mechanism is incomplete: provide ${missing.map(([, label]) => label).join(", ")}. Only an entirely empty second mechanism may be omitted.`,
    );
  return {
    mechanism: v(`${prefix}_name`),
    basis: v(`${prefix}_basis`),
    curve: [
      { years: 0, df: Number(v(`${prefix}_df0`)) },
      { years: Number(v(`${prefix}_horizon`)), df: Number(v(`${prefix}_dfh`)) },
    ],
  };
}

export function RbiPlanner() {
  const [error, setError] = useState<string | null>(null);
  const [calc, setCalc] = useState<CalculatedProposal | null>(null);
  const currentProposal = useRef<CalculatedProposal | null>(null);
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [recorded, setRecorded] = useState<string | null>(null);

  function invalidateProposal() {
    currentProposal.current = null;
    setError(null);
    setCalc(null);
    setRecorded(null);
  }

  function calculate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting.current) return;
    invalidateProposal();
    const form = new FormData(e.currentTarget);
    const v = (n: string) => String(form.get(n) ?? "").trim();
    try {
      const circuitId = circuitIdentity(v("circuit_id"));
      const mechanisms = [mechanism(v, "m1"), mechanism(v, "m2")].filter(
        (m): m is DamageMechanism => m !== null,
      );
      const input: RbiInput = {
        componentId: `circuit ${circuitId}`,
        genericFailureFrequency: {
          perYear: Number(v("gff")),
          basis: v("gff_basis"),
        },
        mechanisms,
        combination:
          v("combination") === "governing" ? "governing" : "additive",
        combinationBasis: v("combination_basis"),
        managementSystemFactor: {
          value: Number(v("fms")),
          basis: v("fms_basis"),
        },
        consequence: {
          value: Number(v("cof")),
          unit: v("cof_unit") === "currency" ? "currency" : "m2",
          basis: v("cof_basis"),
        },
        riskTarget: { value: Number(v("target")), basis: v("target_basis") },
      };
      const result = planRiskBasedInspection(input);
      const proposal = {
        input,
        result,
        adoption: buildRbiAdoption(input, result, new Date()),
        circuitId,
      };
      currentProposal.current = proposal;
      setCalc(proposal);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function adopt() {
    const submitted = currentProposal.current;
    if (
      submitting.current ||
      !submitted?.adoption.adoptable ||
      recorded !== null
    )
      return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const { data, error: rpcError } = await (
        supabase as unknown as {
          rpc: (
            name: string,
            args: Record<string, unknown>,
          ) => Promise<{
            data: Record<string, unknown> | null;
            error: { message: string } | null;
          }>;
        }
      ).rpc("record_inspection_plan", {
        p_plan: {
          circuit_id: submitted.circuitId,
          interval_months: String(submitted.adoption.intervalMonths),
          next_due: submitted.adoption.nextDue,
          interval_basis: submitted.adoption.intervalBasis,
        },
      });
      // A response belongs only to the immutable proposal actually submitted.
      if (currentProposal.current !== submitted) return;
      if (rpcError) setError(rpcError.message);
      else {
        if (
          data?.status !== "recorded" ||
          !(
            typeof data.id === "string" ||
            (typeof data.id === "number" && Number.isSafeInteger(data.id))
          )
        )
          throw new Error("Unqualified inspection-plan acknowledgement");
        setRecorded(circuitIdentity(String(data.id)));
        currentProposal.current = null;
      }
    } catch {
      if (currentProposal.current === submitted) {
        // A transport failure can occur after the server commits. Do not claim
        // success or offer an automatic retry that could duplicate the plan.
        invalidateProposal();
        setError(
          "Recording outcome is unknown. Check existing inspection plans before recalculating; no automatic retry was made.",
        );
      }
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <section
      className="mt-4 rounded-xl border border-white/6 p-4"
      aria-labelledby="rbi-planner-heading"
    >
      <h3
        id="rbi-planner-heading"
        className="flex items-center gap-2 text-sm font-semibold text-white"
      >
        <ShieldCheck className="h-4 w-4 text-signal-cyan" aria-hidden />
        Plan inspection by risk (RBI)
      </h3>
      <p className="mt-1 text-xs text-slate-400">
        API 580-aligned: risk = generic failure frequency × damage factor ×
        management-system factor × consequence. Every value is yours, with its
        source; API 581 tables are not built in. Nothing is recorded until you
        adopt the result as an inspection plan.
      </p>
      <form onSubmit={calculate} onChange={invalidateProposal} className="mt-3">
        <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2">
          <Field
            name="circuit_id"
            label="Corrosion circuit ID"
            inputMode="numeric"
          />
          <div />
          <Field
            name="gff"
            label="Generic failure frequency (per year)"
            type="number"
          />
          <Field
            name="gff_basis"
            label="GFF source (licensed table, edition)"
          />
          <Field name="m1_name" label="Damage mechanism" />
          <Field
            name="m1_basis"
            label="Damage-factor source (assessment, CML trend)"
          />
          <Field name="m1_df0" label="Damage factor now" type="number" />
          <Field
            name="m1_horizon"
            label="Assessed horizon (years)"
            type="number"
          />
          <Field name="m1_dfh" label="Damage factor at horizon" type="number" />
          <div />
          <Field name="m2_name" label="Second mechanism (optional)" optional />
          <Field name="m2_basis" label="Second mechanism source" optional />
          <Field name="m2_df0" label="Second D_f now" type="number" optional />
          <Field
            name="m2_horizon"
            label="Second horizon (years)"
            type="number"
            optional
          />
          <Field
            name="m2_dfh"
            label="Second D_f at horizon"
            type="number"
            optional
          />
          <div />
          <label className="block text-xs text-slate-300">
            Combine damage factors
            <select
              name="combination"
              className={control}
              defaultValue="additive"
            >
              <option value="additive">Add (conservative)</option>
              <option value="governing">Governing mechanism only</option>
            </select>
          </label>
          <Field
            name="combination_basis"
            label="Why this combination (procedure ref.)"
          />
          <Field name="fms" label="Management-system factor" type="number" />
          <Field name="fms_basis" label="F_MS source (audit, score)" />
          <Field name="cof" label="Consequence of failure" type="number" />
          <label className="block text-xs text-slate-300">
            Consequence unit
            <select name="cof_unit" className={control} defaultValue="m2">
              <option value="m2">Area (m²)</option>
              <option value="currency">Financial</option>
            </select>
          </label>
          <Field name="cof_basis" label="Consequence source (study ref.)" />
          <div />
          <Field name="target" label="Risk target" type="number" />
          <Field
            name="target_basis"
            label="Risk-target source (owner criterion)"
          />
          <div className="sm:col-span-2">
            <button className="rounded bg-signal-cyan px-3 py-1.5 text-sm font-medium text-slate-950">
              Calculate risk
            </button>
          </div>
        </fieldset>
      </form>

      {error && (
        <p role="alert" className="mt-3 flex gap-2 text-xs text-rose-300">
          <TriangleAlert className="h-4 w-4" />
          {error}
        </p>
      )}

      {calc && (
        <div
          role="status"
          className="mt-3 space-y-2 rounded border border-white/10 p-3 text-xs text-slate-200"
        >
          <p>Calculated for corrosion circuit {calc.circuitId}.</p>
          <p>
            Risk now {calc.result.riskNow.toPrecision(3)} · target{" "}
            {calc.result.riskTarget.toPrecision(3)} · governing mechanism{" "}
            {calc.result.governingMechanism}
          </p>
          <p>{calc.result.reason}</p>
          {calc.adoption.adoptable ? (
            <>
              <p className="font-medium text-emerald-200">
                Proposed plan: every {calc.adoption.intervalMonths} months, next
                due {calc.adoption.nextDue}.
              </p>
              <button
                type="button"
                disabled={busy || recorded !== null}
                onClick={adopt}
                className="rounded border border-emerald-400/40 px-3 py-1.5 text-sm text-emerald-100 disabled:opacity-50"
              >
                {busy ? "Recording…" : "Adopt as inspection plan"}
              </button>
              <p className="text-slate-400">
                Adopting records the plan under your name with the full
                calculation basis. You need process-safety authority to do this.
              </p>
            </>
          ) : (
            <p className="font-medium text-amber-200">
              No interval proposed: {calc.adoption.reason}
            </p>
          )}
          {recorded !== null && (
            <p className="flex gap-2 text-emerald-200">
              <CheckCircle2 className="h-4 w-4" />
              Inspection plan {recorded} recorded.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function Field({
  name,
  label,
  type = "text",
  optional = false,
  inputMode,
}: {
  name: string;
  label: string;
  type?: string;
  optional?: boolean;
  inputMode?: "numeric";
}) {
  return (
    <label className="block text-xs text-slate-300">
      {label}
      <input
        name={name}
        aria-label={label}
        required={!optional}
        type={type}
        inputMode={inputMode}
        min={type === "number" ? "0" : undefined}
        step={type === "number" ? "any" : undefined}
        className={control}
      />
    </label>
  );
}
