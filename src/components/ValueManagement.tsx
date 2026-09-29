/**
 * ValueManagement — the arithmetic under the boardroom numbers
 * (capability register E9.01–E9.08, E9.11).
 *
 * Two errors this panel is built to make visible rather than commit.
 *
 * Comparing the NPV of a 7-year option against a 20-year one is a category
 * error that looks like analysis. Where lives differ the comparison switches
 * to equivalent annual value and says whether the naive ranking would have
 * picked a different winner.
 *
 * A capital list ordered by benefit is not a prioritisation. Under a budget,
 * ranking by benefit per unit cost fits more value in, and the difference is
 * shown as a number.
 */
import { useState } from "react";
import { Coins, Info, ArrowDownWideNarrow } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import { runValueCalculations } from "../services/valueCalculationService";
import { LoadingState, ErrorState } from "./ui/AsyncStates";

const money = (x: number) =>
  `${x < 0 ? "−" : ""}$${Math.abs(Math.round(x)).toLocaleString()}`;

function CalculationLimits({
  title,
  items,
  runId,
}: {
  title: string;
  items: string[];
  runId?: string;
}) {
  if (items.length === 0) return null;
  return (
    <div
      role="status"
      className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-4"
    >
      <p className="text-sm font-medium text-amber-200">
        {title}
        {runId && (
          <span className="ml-2 font-mono text-xs font-normal text-amber-300/70">
            run {runId.slice(0, 8)}
          </span>
        )}
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-relaxed text-amber-100/80">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

export function ValueManagement() {
  const [budget, setBudget] = useState(3_000_000);
  const [appliedBudget, setAppliedBudget] = useState(3_000_000);

  // The browser submits only the scenario budget. Canonical case/plan rows are
  // re-read and both calculations are executed server-side, then appended to
  // calculation_runs before the result is returned for display.
  const { data, loading, error, refetch } = useAsyncData(
    () => runValueCalculations(appliedBudget),
    [appliedBudget],
  );

  const comparison = data?.comparison ?? null;
  const prioritisation = data?.prioritisation ?? null;

  if (loading) return <LoadingState label="Loading value posture" />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  const posture = data?.posture ?? null;
  const bc = data?.businessCase ?? null;

  return (
    <section aria-labelledby="value-heading" className="space-y-4">
      <div>
        <h2
          id="value-heading"
          className="flex items-center gap-2 text-lg font-semibold text-white"
        >
          <Coins className="h-5 w-5 text-signal-cyan" aria-hidden />
          Value Management
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-300">
          Options with different lives cannot be compared on NPV, and a capital
          list ordered by benefit is not a prioritisation. Every result below is
          server-computed from tenant records and written to immutable lineage.
        </p>
      </div>

      {posture && (
        <div className="flex items-start gap-2 rounded-xl border border-white/6 bg-white/2 p-4 text-sm text-slate-300">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>{posture.basis}</p>
        </div>
      )}

      <CalculationLimits
        title="Option comparison limits"
        items={data?.refusals.optionComparison ?? []}
        runId={data?.lineage.optionComparisonRunId}
      />

      {/* Option comparison. */}
      {bc && comparison && (
        <div className="rounded-xl border border-white/6 p-4">
          <h3 className="text-sm font-semibold text-white">{bc.title}</h3>
          <p className="mt-1 text-xs text-slate-500">
            Discounted at {(Number(bc.discountRate) * 100).toFixed(1)}%
            {bc.discountRateSource && ` · ${bc.discountRateSource}`}
            {data?.lineage.optionComparisonRunId && (
              <> · run {data.lineage.optionComparisonRunId.slice(0, 8)}</>
            )}
          </p>
          <p
            className={`mt-2 text-xs leading-relaxed ${comparison.npvWouldMislead ? "text-amber-300" : "text-slate-400"}`}
          >
            {comparison.reason}
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[32rem] text-left text-sm">
              <caption className="sr-only">
                Options ranked on {comparison.basis.replace(/_/g, " ")}
              </caption>
              <thead className="text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Option
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Life
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    NPV
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    Equivalent annual
                  </th>
                </tr>
              </thead>
              <tbody>
                {comparison.ranked.map((o, i) => (
                  <tr key={o.label} className="border-t border-white/6">
                    <td className="py-2 pr-4 text-slate-200">
                      {o.label}
                      {i === 0 && (
                        <span className="ml-2 text-xs text-signal-cyan">
                          best on{" "}
                          {comparison.basis === "npv"
                            ? "NPV"
                            : "equivalent annual"}
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs text-slate-500 tabular-nums">
                      {o.lifePeriods} yr
                    </td>
                    <td
                      className={`py-2 pr-4 font-mono tabular-nums ${comparison.basis === "npv" ? "text-slate-200" : "text-slate-500"}`}
                    >
                      {money(o.npv)}
                    </td>
                    <td
                      className={`py-2 font-mono tabular-nums ${comparison.basis === "npv" ? "text-slate-500" : "text-slate-200"}`}
                    >
                      {money(o.equivalentAnnual)}/yr
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <CalculationLimits
        title="Capital-plan limits"
        items={data?.refusals.capitalPlan ?? []}
        runId={data?.lineage.capitalPlanRunId}
      />

      {/* Capital prioritisation. */}
      {(data?.plan.length ?? 0) > 0 && prioritisation && (
        <div className="rounded-xl border border-white/6 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
              <ArrowDownWideNarrow
                className="h-4 w-4 text-signal-cyan"
                aria-hidden
              />
              {data?.planYear ?? "Current"} capital plan
            </h3>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                setAppliedBudget(budget);
              }}
              className="flex items-center gap-2"
            >
              <label
                htmlFor="budget"
                className="text-xs uppercase tracking-wide text-slate-400"
              >
                Budget
              </label>
              <input
                id="budget"
                type="number"
                min={0}
                step={250000}
                value={budget}
                onChange={(e) =>
                  setBudget(Math.max(0, Number(e.target.value) || 0))
                }
                className="w-36 rounded border border-white/10 bg-overlook-deep px-2 py-1 font-mono text-sm text-slate-200"
              />
              <button
                type="submit"
                disabled={budget === appliedBudget}
                className="rounded border border-signal-cyan/30 bg-signal-cyan/10 px-2 py-1 text-xs text-signal-cyan disabled:cursor-default disabled:opacity-40"
              >
                Record scenario
              </button>
            </form>
          </div>

          {prioritisation.mandatory.length > 0 && (
            <p className="mt-2 text-xs leading-relaxed text-slate-400">
              {prioritisation.mandatory.length} mandatory item(s) totalling{" "}
              {money(prioritisation.mandatoryCost)} are funded first and do not
              compete on benefit-cost:{" "}
              {prioritisation.mandatory
                .map((m) => `${m.label} (${m.mandatoryBasis})`)
                .join("; ")}
            </p>
          )}
          <p className="mt-2 text-xs leading-relaxed text-slate-400">
            {prioritisation.result.reason} Run{" "}
            {data?.lineage.capitalPlanRunId.slice(0, 8)} records the stated
            budget, exact plan rows, method, result and any exclusions.
          </p>
          <ul className="mt-2 space-y-1 text-sm">
            {(data?.plan ?? [])
              .filter((i) => !i.mandatory)
              .map((i) => {
                const selected = prioritisation.result.selected.includes(
                  i.label,
                );
                return (
                  <li
                    key={i.label}
                    className="flex flex-wrap items-baseline gap-2"
                  >
                    <span
                      className={
                        selected ? "text-signal-cyan" : "text-slate-600"
                      }
                    >
                      {selected ? "fund" : "defer"}
                    </span>
                    <span className="text-slate-200">{i.label}</span>
                    <span className="font-mono text-xs text-slate-500 tabular-nums">
                      {money(Number(i.cost))} →{" "}
                      {i.benefitRecorded
                        ? money(Number(i.benefit))
                        : "benefit not recorded"}
                      {i.benefitRecorded && Number(i.cost) > 0
                        ? ` (${(Number(i.benefit) / Number(i.cost)).toFixed(2)}×)`
                        : ""}
                    </span>
                  </li>
                );
              })}
          </ul>
        </div>
      )}

      {data?.governance && (
        <p className="rounded-xl border border-signal-cyan/20 bg-signal-cyan/5 p-3 text-xs leading-relaxed text-slate-300">
          {data.governance.note}
        </p>
      )}
    </section>
  );
}
