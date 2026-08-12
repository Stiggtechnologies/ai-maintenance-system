/**
 * IntervalOptimization — should this be replaced on age, and how often
 * inspected (capability register C7.07, C7.08, C7.14).
 *
 * The finding this panel most often delivers is a NO. Preventive replacement
 * on age reduces cost only when the failure rate is increasing — Weibull
 * beta > 1. Below that, replacing a survivor throws away good life and buys
 * nothing, and a fleet whose failures are random or early-life will get worse
 * PM value the harder it tries.
 *
 * That verdict needs no cost data at all, which is why it is shown first: the
 * shape of the failure process is decidable from history alone, and it is the
 * decision that determines whether an interval is even the right question.
 */
import { useState } from "react";
import { Timer, CircleSlash, CircleCheck, Info } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import { supabase } from "../lib/supabase";
import { weibullMLE } from "../lib/reliability";
import { optimalAgeReplacement, inspectionInterval } from "../lib/optimization";
import { LoadingState, ErrorState } from "./ui/AsyncStates";

interface Verdict {
  asset: string;
  failures: number;
  beta: number;
  eta: number;
  shape: "infant" | "random" | "wear-out";
  recommended: boolean;
  optimalAge: number | null;
  savingsPct: number | null;
  reason: string;
}

const SHAPE_NOTE: Record<Verdict["shape"], string> = {
  infant:
    "Failures cluster early. Time-based replacement makes this worse, not better — the new part is the risky one. Look at installation, commissioning and early-life quality.",
  random:
    "Failures arrive at a constant rate. A replacement interval buys nothing: the survivor is exactly as likely to fail as a new one. Condition monitoring or run-to-failure.",
  "wear-out":
    "Failures increase with age, so a planned replacement has something to buy. An interval is worth computing.",
};

export function IntervalOptimization() {
  const [pf, setPf] = useState(60);
  const { data, loading, error, refetch } = useAsyncData<
    Verdict[]
  >(async () => {
    // Assets with enough coded corrective history for a fit to be identifiable.
    const { data: rows, error: e } = await supabase
      .from("work_orders")
      .select("asset_id, completed_at, assets(name)")
      .eq("work_type", "corrective")
      .not("completed_at", "is", null)
      .order("completed_at")
      .limit(8000);
    if (e) throw new Error(e.message);

    const byAsset = new Map<string, { name: string; times: number[] }>();
    for (const r of (rows ?? []) as unknown as {
      asset_id: string | null;
      completed_at: string;
      assets: { name: string } | null;
    }[]) {
      if (!r.asset_id || !r.assets) continue;
      const e2 = byAsset.get(r.asset_id) ?? { name: r.assets.name, times: [] };
      e2.times.push(new Date(r.completed_at).getTime());
      byAsset.set(r.asset_id, e2);
    }

    const out: Verdict[] = [];
    for (const { name, times } of byAsset.values()) {
      if (times.length < 8) continue;
      times.sort((a, b) => a - b);
      const gaps: number[] = [];
      for (let i = 1; i < times.length; i++) {
        const h = (times[i] - times[i - 1]) / 3_600_000;
        if (h > 0) gaps.push(h);
      }
      if (gaps.length < 5) continue;
      let fit;
      try {
        fit = weibullMLE(gaps);
      } catch {
        continue; // not identifiable — skip rather than guess
      }
      // No asset economics are recorded, so the cost question cannot be
      // answered. The SHAPE question can, and it is the one that decides
      // whether an interval is even the right thing to ask for.
      const r = optimalAgeReplacement(fit, { plannedCost: 0, failureCost: 0 });
      out.push({
        asset: name,
        failures: fit.failures,
        beta: Number(fit.beta.toFixed(2)),
        eta: Math.round(fit.eta),
        shape:
          fit.beta < 0.95 ? "infant" : fit.beta <= 1.05 ? "random" : "wear-out",
        recommended: r.recommended,
        optimalAge: r.optimalAge,
        savingsPct: r.savingsPct,
        reason: r.reason,
      });
    }
    return out.sort((a, b) => b.failures - a.failures).slice(0, 12);
  }, []);

  if (loading) return <LoadingState label="Fitting failure models" />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  const v = data ?? [];
  const wearOut = v.filter((x) => x.shape === "wear-out").length;
  const insp = inspectionInterval(pf, 0.9, 2);

  return (
    <section aria-labelledby="opt-heading" className="space-y-4">
      <div>
        <h2
          id="opt-heading"
          className="flex items-center gap-2 text-lg font-semibold text-white"
        >
          <Timer className="h-5 w-5 text-signal-cyan" aria-hidden />
          Replacement & Inspection Intervals
          <span className="text-xs font-normal text-slate-500">
            {wearOut}/{v.length} assets where an interval could help
          </span>
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-300">
          Preventive replacement on age lowers cost only when the failure rate
          is increasing. The shape of the failure process decides whether an
          interval is even the right question, and that is decidable from
          history alone — no cost data required.
        </p>
      </div>

      {v.length === 0 ? (
        <p className="rounded-xl border border-white/6 bg-white/2 p-4 text-sm text-slate-400">
          No asset yet has enough coded corrective history for an identifiable
          failure model. A Weibull fit needs at least two distinct inter-failure
          intervals, and a decision worth acting on needs considerably more.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/6">
          <table className="w-full min-w-[44rem] text-left text-sm">
            <caption className="sr-only">
              Failure-model shape and replacement verdict per asset
            </caption>
            <thead className="bg-white/2 text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">
                  Asset
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Failures
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  β
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  η (h)
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Shape
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Age replacement
                </th>
              </tr>
            </thead>
            <tbody>
              {v.map((x) => (
                <tr key={x.asset} className="border-t border-white/6 align-top">
                  <td className="px-4 py-2.5 text-slate-200">{x.asset}</td>
                  <td className="px-4 py-2.5 font-mono text-slate-400 tabular-nums">
                    {x.failures}
                  </td>
                  <td
                    className={`px-4 py-2.5 font-mono tabular-nums ${x.shape === "wear-out" ? "text-signal-cyan" : "text-amber-300"}`}
                  >
                    {x.beta}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-slate-400 tabular-nums">
                    {x.eta.toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-300">
                    {x.shape}
                  </td>
                  <td className="px-4 py-2.5 text-xs">
                    {x.shape === "wear-out" ? (
                      <span className="inline-flex items-center gap-1 text-slate-300">
                        <CircleCheck
                          className="h-3.5 w-3.5 text-green-300"
                          aria-hidden
                        />
                        worth computing — needs planned and failure costs
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-amber-300">
                        <CircleSlash className="h-3.5 w-3.5" aria-hidden />
                        will not help
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {v.length > 0 && (
        <div className="space-y-1.5">
          {(["infant", "random", "wear-out"] as const)
            .filter((s) => v.some((x) => x.shape === s))
            .map((s) => (
              <p
                key={s}
                className={`flex items-start gap-1.5 rounded-xl border p-3 text-xs leading-relaxed ${
                  s === "wear-out"
                    ? "border-white/6 bg-white/2 text-slate-400"
                    : "border-amber-500/25 bg-amber-500/5 text-amber-200/90"
                }`}
              >
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>
                  <strong>
                    {v.filter((x) => x.shape === s).length} {s}
                  </strong>{" "}
                  — {SHAPE_NOTE[s]}
                </span>
              </p>
            ))}
        </div>
      )}

      <div className="rounded-xl border border-white/6 bg-overlook-deep/40 p-4">
        <label
          htmlFor="pf-input"
          className="text-xs uppercase tracking-wide text-slate-400"
        >
          Inspection interval from a P-F interval
        </label>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <input
            id="pf-input"
            type="number"
            min={1}
            value={pf}
            onChange={(e) => setPf(Math.max(1, Number(e.target.value) || 1))}
            className="w-24 rounded border border-white/10 bg-overlook-deep px-2 py-1 font-mono text-sm text-slate-200"
          />
          <span className="text-xs text-slate-500">days P-F</span>
          <span className="font-mono text-lg text-signal-cyan">
            inspect every {insp.intervalDays} d
          </span>
          <span className="font-mono text-sm text-slate-300">
            {(insp.detectionProbability * 100).toFixed(1)}% detection
          </span>
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
          {insp.reason}
        </p>
      </div>
    </section>
  );
}
