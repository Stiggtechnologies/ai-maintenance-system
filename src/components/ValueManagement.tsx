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
import { useMemo, useState } from "react";
import { Coins, Info, ArrowDownWideNarrow } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import { supabase } from "../lib/supabase";
import {
  compareOptions,
  prioritiseUnderBudget,
  type CashFlow,
} from "../lib/value";
import { LoadingState, ErrorState } from "./ui/AsyncStates";

interface Posture {
  cases_total: number;
  cases_mixed_lives: number;
  plan_items: number;
  budget_lines: number;
  basis: string;
}

interface CasePayload {
  caseRef: string;
  title: string;
  driver: string;
  discountRate: number;
  discountRateSource: string | null;
  options: {
    label: string;
    lifePeriods: number;
    cashFlows: CashFlow[];
    benefitProbability: number | null;
    isDoNothing: boolean;
    notes: string | null;
  }[];
}

interface PlanItem {
  label: string;
  cost: number;
  benefit: number;
  mandatory: boolean;
  mandatoryBasis: string | null;
}

const money = (x: number) =>
  `${x < 0 ? "−" : ""}$${Math.abs(Math.round(x)).toLocaleString()}`;

export function ValueManagement() {
  const [budget, setBudget] = useState(3_000_000);

  const { data, loading, error, refetch } = useAsyncData<{
    posture: Posture | null;
    businessCase: CasePayload | null;
    plan: PlanItem[];
  }>(async () => {
    const [p, c, pl] = await Promise.all([
      supabase.rpc("get_value_posture"),
      // No arguments. These asked for the business case literally named
      // "DEMO-BC-01" and the capital plan for the literal year 2027, so the
      // panel rendered empty for every organisation except the demo tenant.
      // 20260921002000 made both parameters optional: null means this
      // organisation's most recent, which is what was always wanted.
      supabase.rpc("get_business_case"),
      supabase.rpc("get_capital_plan"),
    ]);
    if (p.error) throw new Error(p.error.message);
    if (c.error) throw new Error(c.error.message);
    if (pl.error) throw new Error(pl.error.message);
    return {
      posture: (p.data as Posture[])?.[0] ?? null,
      businessCase: (c.data as CasePayload) ?? null,
      plan: (pl.data as PlanItem[]) ?? [],
    };
  }, []);

  const comparison = useMemo(() => {
    const bc = data?.businessCase;
    if (!bc || !bc.options?.length) return null;
    return compareOptions(
      bc.options.map((o) => ({
        label: o.label,
        lifePeriods: Number(o.lifePeriods),
        cashFlows: (o.cashFlows ?? []).map((cf) => ({
          period: Number(cf.period),
          amount: Number(cf.amount),
        })),
      })),
      Number(bc.discountRate),
    );
  }, [data]);

  // Mandatory items are funded first and do not compete on benefit-cost.
  const prioritisation = useMemo(() => {
    const items = data?.plan ?? [];
    const mandatory = items.filter((i) => i.mandatory);
    const mandatoryCost = mandatory.reduce((s, i) => s + Number(i.cost), 0);
    const discretionary = items
      .filter((i) => !i.mandatory)
      .map((i) => ({
        label: i.label,
        cost: Number(i.cost),
        benefit: Number(i.benefit),
      }));
    return {
      mandatory,
      mandatoryCost,
      result: prioritiseUnderBudget(
        discretionary,
        Math.max(0, budget - mandatoryCost),
      ),
    };
  }, [data, budget]);

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
          list ordered by benefit is not a prioritisation.
        </p>
      </div>

      {posture && (
        <div className="flex items-start gap-2 rounded-xl border border-white/6 bg-white/2 p-4 text-sm text-slate-300">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>{posture.basis}</p>
        </div>
      )}

      {/* Option comparison. */}
      {bc && comparison && (
        <div className="rounded-xl border border-white/6 p-4">
          <h3 className="text-sm font-semibold text-white">{bc.title}</h3>
          <p className="mt-1 text-xs text-slate-500">
            Discounted at {(Number(bc.discountRate) * 100).toFixed(1)}%
            {bc.discountRateSource && ` · ${bc.discountRateSource}`}
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

      {/* Capital prioritisation. */}
      {(data?.plan.length ?? 0) > 0 && (
        <div className="rounded-xl border border-white/6 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
              <ArrowDownWideNarrow
                className="h-4 w-4 text-signal-cyan"
                aria-hidden
              />
              2027 capital plan
            </h3>
            <div>
              <label
                htmlFor="budget"
                className="mr-2 text-xs uppercase tracking-wide text-slate-400"
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
            </div>
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
            {prioritisation.result.reason}
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
                      {money(Number(i.cost))} → {money(Number(i.benefit))} (
                      {(Number(i.benefit) / Number(i.cost)).toFixed(2)}×)
                    </span>
                  </li>
                );
              })}
          </ul>
        </div>
      )}
    </section>
  );
}
