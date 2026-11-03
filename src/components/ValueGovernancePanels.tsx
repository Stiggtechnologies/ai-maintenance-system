import { useState, type FormEvent } from "react";
import { Coins, Scale } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import { costOfRisk } from "../lib/value";
import { getProductionLossReconciliation } from "../services/productionLossService";
import {
  listProductionLossUnitValues,
  recordProductionLossUnitValue,
  valueMeasuredProductionLoss,
  type ProductionLossUnitValue,
} from "../services/valueGovernanceService";
import { ErrorState, LoadingState } from "./ui/AsyncStates";

const inputClass =
  "w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-signal-cyan/50 focus:outline-none";

function money(amount: number, currency: string): string {
  return `${amount < 0 ? "−" : ""}${currency} ${Math.abs(amount).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

/**
 * E9.07. Records a sourced unit value on `financial_assumptions` and prices
 * only the measured loss the production-loss reconciliation already computed.
 */
export function ProductionLossValuation() {
  const { data, loading, error, refetch } = useAsyncData(
    () =>
      Promise.all([
        listProductionLossUnitValues(),
        getProductionLossReconciliation(90),
      ]),
    [],
  );
  const [unitOfMeasure, setUnitOfMeasure] = useState("");
  const [currency, setCurrency] = useState("");
  const [valuePerUnit, setValuePerUnit] = useState("");
  const [source, setSource] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [reviewDue, setReviewDue] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  if (loading)
    return <LoadingState label="Loading production-loss valuation" />;
  if (error || !data) {
    return (
      <ErrorState
        message={error ?? "Production-loss valuation returned no data."}
        onRetry={refetch}
      />
    );
  }

  const [rates, reconciliation] = data;
  const rateFor = (unit: string) =>
    rates.find((rate) => rate.unitOfMeasure === unit) ?? null;
  const valuations = reconciliation.summary.lossByUnit.map((loss) =>
    valueMeasuredProductionLoss(
      {
        unitOfMeasure: loss.unitOfMeasure,
        estimatedUnitsLost: loss.estimatedUnitsLost,
        events: loss.events,
      },
      rateFor(loss.unitOfMeasure),
    ),
  );

  const record = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const recorded = await recordProductionLossUnitValue({
        unitOfMeasure,
        currency,
        valuePerUnit: Number(valuePerUnit),
        source,
        effectiveFrom: effectiveFrom || null,
        reviewDue: reviewDue || null,
      });
      setNotice(
        `Recorded ${recorded.assumption_key} as version ${recorded.version_id}. The previous version remains in the series.`,
      );
      setValuePerUnit("");
      setSource("");
      refetch();
    } catch (cause) {
      setNotice(
        cause instanceof Error
          ? cause.message
          : "The production-loss value was refused.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-labelledby="production-loss-value-heading"
      className="space-y-3"
    >
      <div>
        <h3
          id="production-loss-value-heading"
          className="flex items-center gap-2 text-sm font-semibold text-white"
        >
          <Scale className="h-4 w-4 text-signal-cyan" aria-hidden />
          Production-loss valuation
        </h3>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-400">
          A named rate, with its source, prices measured loss from the
          production-loss reconciliation. A missing rate stays unvalued. This
          records an assumption version and does not approve spend, accept risk,
          or change a production plan.
        </p>
      </div>

      {notice && (
        <p
          role="status"
          className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-slate-300"
        >
          {notice}
        </p>
      )}

      <RateList rates={rates} />

      {valuations.length === 0 ? (
        <p className="text-xs text-slate-500">
          No measured production loss in the current reconciliation window. A
          recorded rate is not applied to an invented quantity.
        </p>
      ) : (
        <ul className="space-y-2">
          {valuations.map((valuation) => (
            <li
              key={valuation.unitOfMeasure}
              className={`rounded-lg border px-3 py-2 text-xs leading-relaxed ${
                valuation.status === "valued"
                  ? "border-white/10 text-slate-200"
                  : "border-amber-400/20 text-amber-100"
              }`}
            >
              {valuation.status === "valued" ? (
                <>
                  <span className="font-mono">
                    {money(valuation.amount, valuation.currency)}
                  </span>{" "}
                  <span className="text-slate-400">{valuation.reason}</span>
                </>
              ) : (
                valuation.reason
              )}
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={record} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="text-xs text-slate-400">
          Measured unit
          <input
            value={unitOfMeasure}
            onChange={(event) => setUnitOfMeasure(event.target.value)}
            placeholder="t"
            className={`${inputClass} mt-1`}
            required
          />
        </label>
        <label className="text-xs text-slate-400">
          Currency
          <input
            value={currency}
            onChange={(event) => setCurrency(event.target.value)}
            placeholder="USD"
            maxLength={3}
            className={`${inputClass} mt-1`}
            required
          />
        </label>
        <label className="text-xs text-slate-400">
          Value per unit
          <input
            type="number"
            min="0"
            step="any"
            value={valuePerUnit}
            onChange={(event) => setValuePerUnit(event.target.value)}
            className={`${inputClass} mt-1`}
            required
          />
        </label>
        <label className="text-xs text-slate-400">
          Effective from
          <input
            type="date"
            value={effectiveFrom}
            onChange={(event) => setEffectiveFrom(event.target.value)}
            className={`${inputClass} mt-1`}
          />
        </label>
        <label className="text-xs text-slate-400 sm:col-span-2">
          Source
          <input
            value={source}
            onChange={(event) => setSource(event.target.value)}
            placeholder="Where this unit value comes from"
            className={`${inputClass} mt-1`}
            required
          />
        </label>
        <label className="text-xs text-slate-400">
          Review due
          <input
            type="date"
            value={reviewDue}
            onChange={(event) => setReviewDue(event.target.value)}
            className={`${inputClass} mt-1`}
          />
        </label>
        <div className="flex items-end">
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg border border-signal-cyan/30 bg-signal-cyan/10 px-3 py-2 text-xs font-semibold text-signal-cyan disabled:opacity-50"
          >
            {busy ? "Recording…" : "Record production-loss value"}
          </button>
        </div>
      </form>
    </section>
  );
}

function RateList({ rates }: { rates: ProductionLossUnitValue[] }) {
  if (rates.length === 0) {
    return (
      <p className="text-xs text-slate-500">
        No operative production-loss unit value is recorded for this
        organization.
      </p>
    );
  }
  return (
    <ul className="space-y-1">
      {rates.map((rate) => (
        <li key={rate.assumptionKey} className="text-xs text-slate-300">
          <span className="font-mono">
            {rate.valuePerUnit} {rate.unit}
          </span>{" "}
          <span className="text-slate-500">
            effective {rate.effectiveFrom} · {rate.source}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * E9.08. The pure cost-of-risk kernel, on inputs a person states for this
 * calculation. Nothing here is stored as an accepted risk or a funded treatment.
 */
export function CostOfRiskCalculation() {
  const [probability, setProbability] = useState("");
  const [consequence, setConsequence] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);
  const [result, setResult] = useState<ReturnType<typeof costOfRisk> | null>(
    null,
  );

  const calculate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const annualProbability = Number(probability);
    const consequenceCost = Number(consequence);
    const calculated = costOfRisk(
      Number.isFinite(annualProbability) ? annualProbability : Number.NaN,
      Number.isFinite(consequenceCost) ? consequenceCost : Number.NaN,
    );
    if (!(annualProbability >= 0 && annualProbability <= 1)) {
      setResult(null);
      setRefusal(calculated.reason);
      return;
    }
    if (!Number.isFinite(consequenceCost) || consequenceCost < 0) {
      setResult(null);
      setRefusal(
        "State the consequence as a finite, non-negative loss. A missing or negative amount is not presented as a cost of risk.",
      );
      return;
    }
    setRefusal(null);
    setResult(calculated);
  };

  return (
    <section aria-labelledby="cost-of-risk-heading" className="space-y-3">
      <div>
        <h3
          id="cost-of-risk-heading"
          className="flex items-center gap-2 text-sm font-semibold text-white"
        >
          <Coins className="h-4 w-4 text-signal-cyan" aria-hidden />
          Cost of risk
        </h3>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-400">
          Expected annual cost is probability times a consequence the
          organization states for this calculation. The result is advisory. It
          does not accept the risk, fund a treatment, or authorize expenditure.
        </p>
      </div>
      <form
        onSubmit={calculate}
        className="grid grid-cols-1 gap-2 sm:grid-cols-2"
      >
        <label className="text-xs text-slate-400">
          Annual probability (0 to 1)
          <input
            type="number"
            step="any"
            value={probability}
            onChange={(event) => setProbability(event.target.value)}
            className={`${inputClass} mt-1`}
            required
          />
        </label>
        <label className="text-xs text-slate-400">
          Consequence cost
          <input
            type="number"
            step="any"
            value={consequence}
            onChange={(event) => setConsequence(event.target.value)}
            className={`${inputClass} mt-1`}
            required
          />
        </label>
        <div className="sm:col-span-2">
          <button
            type="submit"
            className="rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-white/5"
          >
            Calculate cost of risk
          </button>
        </div>
      </form>
      {refusal && (
        <p role="alert" className="text-xs leading-relaxed text-amber-200">
          {refusal}
        </p>
      )}
      {result && (
        <div className="rounded-lg border border-white/10 px-3 py-2 text-xs leading-relaxed text-slate-300">
          <p className="font-mono text-sm text-slate-100">
            Expected annual cost{" "}
            {result.expectedAnnualCost.toLocaleString(undefined, {
              maximumFractionDigits: 2,
            })}
          </p>
          <p className="mt-1">{result.reason}</p>
        </div>
      )}
    </section>
  );
}

export function ValueGovernancePanels() {
  return (
    <div className="space-y-4 rounded-xl border border-white/6 p-4">
      <ProductionLossValuation />
      <CostOfRiskCalculation />
    </div>
  );
}
