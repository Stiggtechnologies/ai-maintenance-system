import { useState } from "react";
import { CalendarRange } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import { describeLongHorizonYear } from "../lib/value/longHorizonPlan";
import {
  adoptLongHorizonPlan,
  getLongHorizonValuePlan,
  recordLongHorizonPlan,
  type LongHorizonComposition,
} from "../services/longHorizonValuePlanService";

function money(value: number | null, currency: string | null): string {
  if (value == null) return "Withheld";
  return `${new Intl.NumberFormat("en-CA", { maximumFractionDigits: 2 }).format(value)} ${currency ?? ""}`.trim();
}

function Lens({ title, children }: { title: string; children: string }) {
  return (
    <article className="rounded-lg border border-white/10 p-3">
      <h3 className="text-sm font-semibold text-white">{title}</h3>
      <p className="mt-1 text-xs leading-relaxed text-slate-300">{children}</p>
    </article>
  );
}

function CompositionView({ plan }: { plan: LongHorizonComposition }) {
  const capital = plan.capitalAllocation;
  return (
    <div className="space-y-3" data-testid="long-horizon-composition">
      <p className="text-sm text-slate-200">
        {plan.planCode} v{plan.version} · {plan.startYear}–{plan.endYear} ·{" "}
        {plan.currency} · {plan.status}
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        <Lens title="Lifecycle cost">
          {`${plan.lifecycleCost.note} Recorded annual maintenance: ${money(plan.lifecycleCost.recordedAnnualMaintenanceUsd, "USD")}. Evaluations: ${plan.lifecycleCost.evaluationCount}.`}
        </Lens>
        <Lens title="Governed risk">
          {`${plan.risk.openCount} open, ${plan.risk.highOrCriticalCount} high or critical. Value at risk: ${money(plan.risk.recordedValueAtRisk, plan.risk.currency)}${plan.risk.valueWithheldReason ? ` — ${plan.risk.valueWithheldReason}` : ""}.`}
        </Lens>
        <Lens title="Observed performance">
          {`${plan.performance.label}. ${plan.performance.withheldReason ?? `${money(plan.performance.observedUnits, plan.performance.unit)} across ${plan.performance.recordCount} records.`}`}
        </Lens>
        <Lens title="Resilience exposure">
          {`${plan.resilience.note} Threat scenarios: ${plan.resilience.threatScenarioCount}. Climate assessments: ${plan.resilience.climateAssessmentCount}.`}
        </Lens>
      </div>
      <div>
        <h3 className="text-sm font-semibold text-white">Capital allocation</h3>
        <p className="mt-1 text-xs text-slate-400">{capital.budgetLineNote}</p>
        <ul className="mt-2 space-y-1 text-xs text-slate-200">
          {capital.years.map((year) => (
            <li key={year.year}>{describeLongHorizonYear(year)}</li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-slate-300">
          Horizon total:{" "}
          {capital.horizonTotalStatus === "recorded"
            ? money(capital.combinedHorizonTotal, capital.currency)
            : `withheld — ${capital.withheldReason}`}
        </p>
      </div>
    </div>
  );
}

export function LongHorizonValuePlan() {
  const [planId, setPlanId] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [method, setMethod] = useState<
    "recorded_only" | "human_stated_annual_maintenance"
  >("recorded_only");
  const { data, loading, error, refetch } = useAsyncData(
    () => getLongHorizonValuePlan(planId),
    [planId],
  );

  async function onRecord(form: FormData) {
    setBusy(true);
    setFormError(null);
    setNotice(null);
    try {
      const stated = String(form.get("statedAnnualMaintenance") ?? "").trim();
      const recorded = await recordLongHorizonPlan({
        planCode: String(form.get("planCode") ?? ""),
        startYear: Number(form.get("startYear")),
        endYear: Number(form.get("endYear")),
        currency: String(form.get("currency") ?? ""),
        forecastMethod: method,
        statedAnnualMaintenance:
          method === "human_stated_annual_maintenance" && stated !== ""
            ? Number(stated)
            : null,
        statedAnnualBasis:
          method === "human_stated_annual_maintenance"
            ? String(form.get("statedAnnualBasis") ?? "")
            : null,
        evidenceItemId: String(form.get("evidenceItemId") ?? ""),
        basis: String(form.get("basis") ?? ""),
      });
      setPlanId(recorded.planId);
      setNotice(
        `Draft ${recorded.planCode} v${recorded.version} recorded. No expenditure was authorized.`,
      );
      refetch();
    } catch (caught) {
      setFormError(
        caught instanceof Error ? caught.message : "The plan was not recorded.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function onAdopt(form: FormData) {
    if (!data?.selected) return;
    setBusy(true);
    setFormError(null);
    setNotice(null);
    try {
      const adopted = await adoptLongHorizonPlan(
        data.selected.planId,
        String(form.get("adoptionNote") ?? ""),
      );
      setPlanId(adopted.planId);
      setNotice("Plan adopted and frozen. No expenditure was authorized.");
      refetch();
    } catch (caught) {
      setFormError(
        caught instanceof Error ? caught.message : "The plan was not adopted.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby="long-horizon-plan-title"
      className="space-y-4 rounded-xl border border-white/10 bg-white/[0.02] p-5"
      data-testid="long-horizon-value-plan"
    >
      <div>
        <h2
          id="long-horizon-plan-title"
          className="flex items-center gap-2 text-lg font-semibold text-white"
        >
          <CalendarRange className="h-5 w-5 text-signal-cyan" aria-hidden />
          Long-horizon maintenance and capital plan
        </h2>
        <p className="mt-1 max-w-4xl text-sm text-slate-300">
          {data?.decisionBoundary ??
            "A multi-year plan composes recorded capital, lifecycle cost, risk, observed performance and resilience exposure. Missing years stay missing."}
        </p>
      </div>

      {loading && (
        <p className="text-sm text-slate-400">Loading the value plan…</p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-200">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-emerald-200">
          {notice}
        </p>
      )}
      {formError && (
        <p role="alert" className="text-sm text-red-200">
          {formError}
        </p>
      )}

      {data?.selected && <CompositionView plan={data.selected} />}

      <form
        className="grid gap-3 md:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          void onRecord(new FormData(event.currentTarget));
        }}
      >
        <label className="text-xs text-slate-300">
          Plan code
          <input
            name="planCode"
            required
            className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm"
          />
        </label>
        <label className="text-xs text-slate-300">
          Currency
          <input
            name="currency"
            required
            minLength={3}
            maxLength={3}
            className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm uppercase"
          />
        </label>
        <label className="text-xs text-slate-300">
          Start year
          <input
            name="startYear"
            type="number"
            required
            className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm"
          />
        </label>
        <label className="text-xs text-slate-300">
          End year
          <input
            name="endYear"
            type="number"
            required
            className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm"
          />
        </label>
        <label className="text-xs text-slate-300 md:col-span-2">
          Forecast method
          <select
            name="forecastMethod"
            value={method}
            onChange={(event) =>
              setMethod(
                event.target.value as
                  "recorded_only" | "human_stated_annual_maintenance",
              )
            }
            className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm"
          >
            <option value="recorded_only">Recorded capital only</option>
            <option value="human_stated_annual_maintenance">
              Recorded capital plus a stated annual maintenance assumption
            </option>
          </select>
        </label>
        {method === "human_stated_annual_maintenance" && (
          <>
            <label className="text-xs text-slate-300">
              Stated annual maintenance
              <input
                name="statedAnnualMaintenance"
                type="number"
                min="0"
                required
                className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm"
              />
            </label>
            <label className="text-xs text-slate-300">
              Assumption basis
              <input
                name="statedAnnualBasis"
                required
                minLength={20}
                className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm"
              />
            </label>
          </>
        )}
        <label className="text-xs text-slate-300 md:col-span-2">
          Independently verified evidence
          <input
            name="evidenceItemId"
            required
            className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm"
          />
        </label>
        <label className="text-xs text-slate-300 md:col-span-2">
          Plan basis
          <textarea
            name="basis"
            required
            minLength={20}
            className="mt-1 min-h-20 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm"
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg border border-signal-cyan/40 px-3 py-2 text-sm text-signal-cyan disabled:opacity-50"
        >
          Record draft plan
        </button>
      </form>

      {data?.selected?.status === "draft" && (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            void onAdopt(new FormData(event.currentTarget));
          }}
        >
          <label className="block text-xs text-slate-300">
            Adoption note
            <textarea
              name="adoptionNote"
              required
              minLength={20}
              className="mt-1 min-h-16 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg border border-white/20 px-3 py-2 text-sm text-white disabled:opacity-50"
          >
            Adopt plan
          </button>
          <p className="text-xs text-slate-400">
            The author cannot adopt this draft. Adoption freezes the composition
            and still authorizes nothing.
          </p>
        </form>
      )}
    </section>
  );
}
