/**
 * SparesOptimization — how many to hold, and what the answer costs
 * (capability register C7.06).
 *
 * Lead time comes from the catalogue. Demand does not: no consumption history
 * or bill of materials is recorded, and a holding level derived from a demand
 * rate nobody measured is a guess wearing a number. So demand is an input the
 * planner supplies, and the panel says where it should come from.
 *
 * The service ladder needs only demand and lead time. The cost-optimal level
 * additionally needs unit cost, a holding rate and the cost of a stockout —
 * and when those are absent the ladder still stands on its own rather than the
 * whole panel going blank.
 */
import { useState } from "react";
import { PackageCheck, Info } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import { supabase } from "../lib/supabase";
import { optimiseSpares } from "../lib/spares";
import { LoadingState, ErrorState } from "./ui/AsyncStates";

interface Material {
  id: string;
  material_code: string;
  description: string;
  lead_time_days: number | null;
  criticality: string | null;
  unit_cost_usd: number | null;
  is_template: boolean;
}

export function SparesOptimization() {
  const [selected, setSelected] = useState<string | null>(null);
  const [demand, setDemand] = useState(2);
  const [stockoutCost, setStockoutCost] = useState(0);

  const { data, loading, error, refetch } = useAsyncData<
    Material[]
  >(async () => {
    const { data: rows, error: e } = await supabase
      .from("materials")
      .select(
        "id, material_code, description, lead_time_days, criticality, unit_cost_usd, is_template",
      )
      .order("lead_time_days", { ascending: false })
      .limit(50);
    if (e) throw new Error(e.message);
    return (rows ?? []) as Material[];
  }, []);

  if (loading) return <LoadingState label="Loading spares catalogue" />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  const mats = (data ?? []).filter((m) => m.lead_time_days);
  const chosen = mats.find((m) => m.id === selected) ?? mats[0] ?? null;

  const result = chosen
    ? optimiseSpares(
        {
          annualDemand: demand,
          leadTimeDays: chosen.lead_time_days as number,
          unitCost: chosen.unit_cost_usd ?? undefined,
          holdingRate: chosen.unit_cost_usd ? 0.25 : undefined,
          stockoutCost: stockoutCost > 0 ? stockoutCost : undefined,
        },
        0.95,
      )
    : null;

  return (
    <section aria-labelledby="spares-heading" className="space-y-4">
      <div>
        <h2
          id="spares-heading"
          className="flex items-center gap-2 text-lg font-semibold text-white"
        >
          <PackageCheck className="h-5 w-5 text-signal-cyan" aria-hidden />
          Spares Holding
          <span className="text-xs font-normal text-slate-500">
            {mats.length} catalogued with a lead time
          </span>
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-300">
          Demand over the lead time is modelled as Poisson — the standard choice
          for slow-moving critical spares, where consumption is a count of rare
          independent events. For a fast mover with lumpy demand it is the wrong
          model, and the answer would be confidently wrong.
        </p>
      </div>

      {mats.length === 0 ? (
        <p className="rounded-xl border border-white/6 bg-white/2 p-4 text-sm text-slate-400">
          No catalogued material carries a lead time. Lead time is half the
          input; without it there is nothing to size against.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-4 rounded-xl border border-white/6 bg-overlook-deep/40 p-4">
            <div>
              <label
                htmlFor="mat"
                className="block text-xs uppercase tracking-wide text-slate-400"
              >
                Material
              </label>
              <select
                id="mat"
                value={chosen?.id ?? ""}
                onChange={(e) => setSelected(e.target.value)}
                className="mt-1 rounded border border-white/10 bg-overlook-deep px-2 py-1 text-sm text-slate-200"
              >
                {mats.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.description} ({m.lead_time_days} d)
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                htmlFor="dem"
                className="block text-xs uppercase tracking-wide text-slate-400"
              >
                Annual demand
              </label>
              <input
                id="dem"
                type="number"
                min={0}
                step={0.5}
                value={demand}
                onChange={(e) =>
                  setDemand(Math.max(0, Number(e.target.value) || 0))
                }
                className="mt-1 w-24 rounded border border-white/10 bg-overlook-deep px-2 py-1 font-mono text-sm text-slate-200"
              />
            </div>
            <div>
              <label
                htmlFor="soc"
                className="block text-xs uppercase tracking-wide text-slate-400"
              >
                Stockout cost ($)
              </label>
              <input
                id="soc"
                type="number"
                min={0}
                step={1000}
                value={stockoutCost}
                onChange={(e) =>
                  setStockoutCost(Math.max(0, Number(e.target.value) || 0))
                }
                className="mt-1 w-32 rounded border border-white/10 bg-overlook-deep px-2 py-1 font-mono text-sm text-slate-200"
              />
            </div>
          </div>

          {result && (
            <>
              <p className="flex items-start gap-1.5 rounded-xl border border-white/6 bg-white/2 p-3 text-xs leading-relaxed text-slate-400">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                {result.reason}
              </p>

              <div className="overflow-x-auto rounded-xl border border-white/6">
                <table className="w-full min-w-[30rem] text-left text-sm">
                  <caption className="sr-only">
                    Service level achieved by each holding level
                  </caption>
                  <thead className="bg-white/2 text-xs uppercase tracking-wide text-slate-400">
                    <tr>
                      <th scope="col" className="px-4 py-2 font-medium">
                        Hold
                      </th>
                      <th scope="col" className="px-4 py-2 font-medium">
                        Service level
                      </th>
                      <th scope="col" className="px-4 py-2 font-medium">
                        Expected units short per cycle
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.ladder.map((l) => {
                      const isTarget = l.level === result.levelForTargetService;
                      const isOpt = l.level === result.optimalLevel;
                      return (
                        <tr
                          key={l.level}
                          className={`border-t border-white/6 ${isOpt ? "bg-signal-cyan/5" : isTarget ? "bg-white/2" : ""}`}
                        >
                          <td className="px-4 py-2 font-mono text-slate-200 tabular-nums">
                            {l.level}
                            {isOpt && (
                              <span className="ml-2 text-xs text-signal-cyan">
                                cost-optimal
                              </span>
                            )}
                            {isTarget && !isOpt && (
                              <span className="ml-2 text-xs text-slate-500">
                                {(result.targetService * 100).toFixed(0)}%
                                target
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2 font-mono text-slate-300 tabular-nums">
                            {(l.serviceLevel * 100).toFixed(2)}%
                          </td>
                          <td className="px-4 py-2 font-mono text-slate-400 tabular-nums">
                            {l.expectedStockouts.toFixed(3)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {result.missingInputs.length > 0 && (
                <p className="text-xs text-slate-500">
                  Cost-optimal level not computed — missing{" "}
                  {result.missingInputs.join(", ")}. The service ladder above is
                  derived from demand and lead time alone and stands without
                  them.
                </p>
              )}
            </>
          )}

          <p className="text-xs leading-relaxed text-slate-500">
            Annual demand is entered here because no consumption history or bill
            of materials is recorded. It should come from issued-parts history
            or a BOM plan — a holding level derived from a rate nobody measured
            is a guess wearing a number.
            {chosen?.is_template &&
              " This material is a template class, not your catalogue: its lead time is a placeholder."}
          </p>
        </>
      )}
    </section>
  );
}
