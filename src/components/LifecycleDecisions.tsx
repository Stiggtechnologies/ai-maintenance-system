/**
 * LifecycleDecisions — repair, replace, redesign or defer
 * (capability register C8.09, C2.10).
 *
 * The failure model comes from the validated Weibull engine in
 * src/lib/reliability; the option arithmetic from src/lib/lifecycle, which has
 * its own thirteen tests. The database supplies inputs and stores results, so
 * there is exactly one implementation of the mathematics rather than a SQL
 * copy that can drift from the tested one.
 *
 * An option that cannot be priced is shown as unpriced with its missing inputs
 * named, and is never ranked. Uncertainty travels with every verdict, because
 * the cheapest option computed from six failures and two guessed costs is not
 * a finding — and a recommendation without its uncertainty invites a decision
 * the evidence cannot support.
 */
import { useState } from "react";
import { Scale3d, TriangleAlert, CircleHelp } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import { supabase } from "../lib/supabase";
import { weibullMLE } from "../lib/reliability";
import {
  deferralRisk,
  compareOptions,
  assessUncertainty,
  recommendOption,
  type AssetEconomics,
  type OptionCost,
} from "../lib/lifecycle";
import { LoadingState, ErrorState } from "./ui/AsyncStates";

interface Evaluation {
  id: string;
  asset: string;
  recommended: string | null;
  uncertainty: "low" | "moderate" | "high";
  uncertainty_reasons: string[];
  rationale: string;
  evaluated_at: string;
  decision: string | null;
  decision_note: string | null;
  options: OptionCost[];
}

interface Position {
  assets: number;
  assets_with_economics: number;
  economics_coverage_pct: number | null;
  evaluations: Evaluation[];
  note: string;
}

interface Inputs {
  asset_id: string;
  asset_name: string;
  inter_failure_hours: number[];
  failures: number;
  hours_since_last_failure: number;
  economics: AssetEconomics;
  missing_inputs: string[];
  sufficient_for_failure_model: boolean;
  note: string;
  error?: string;
}

const UNCERTAINTY_STYLE: Record<string, string> = {
  low: "border-green-500/30 bg-green-500/10 text-green-300",
  moderate: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  high: "border-red-500/30 bg-red-500/10 text-red-300",
};

const money = (v: number | null) =>
  v == null ? "unpriced" : `$${Math.round(v).toLocaleString()}/yr`;

export function LifecycleDecisions() {
  const [running, setRunning] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const { data, loading, error, refetch } = useAsyncData<Position>(async () => {
    const { data: r, error: e } = await supabase.rpc(
      "get_lifecycle_position",
      {},
    );
    if (e) throw new Error(e.message);
    return r as Position;
  }, []);

  /**
   * Runs the analysis for the asset with the most corrective history — the one
   * where a life model is best supported — and records it with its inputs.
   */
  async function evaluateWorstActor() {
    setRunning(true);
    setPreview(null);
    const { data: assetRows } = await supabase
      .from("work_orders")
      .select("asset_id")
      .eq("work_type", "corrective")
      .not("completed_at", "is", null)
      .limit(2000);
    const counts = new Map<string, number>();
    for (const r of (assetRows ?? []) as { asset_id: string | null }[]) {
      if (r.asset_id) counts.set(r.asset_id, (counts.get(r.asset_id) ?? 0) + 1);
    }
    const worst = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (!worst) {
      setRunning(false);
      setPreview("No corrective history to analyse.");
      return;
    }

    const { data: raw } = await supabase.rpc("get_lifecycle_inputs", {
      p_asset_id: worst,
    });
    const inputs = raw as Inputs;
    if (inputs?.error || !inputs.sufficient_for_failure_model) {
      setRunning(false);
      setPreview(inputs?.note ?? inputs?.error ?? "Inputs unavailable.");
      return;
    }

    let fit;
    try {
      fit = weibullMLE(inputs.inter_failure_hours.filter((t) => t > 0));
    } catch (e) {
      setRunning(false);
      setPreview(e instanceof Error ? e.message : "Failure model unavailable.");
      return;
    }

    const risk = deferralRisk(
      fit,
      inputs.hours_since_last_failure,
      30,
      inputs.economics,
    );
    const options = compareOptions(inputs.economics, risk, null, null);
    const uncertainty = assessUncertainty(fit, options);
    const verdict = recommendOption(options, uncertainty);

    await supabase.rpc("record_lifecycle_evaluation", {
      p_asset_id: worst,
      p_inputs: {
        ...inputs,
        weibull: { beta: fit.beta, eta: fit.eta, failures: fit.failures },
        deferral_probability_30d: risk.probability,
      },
      p_options: options,
      p_recommended: verdict.recommended,
      p_uncertainty_level: uncertainty.level,
      p_uncertainty_reasons: uncertainty.reasons,
      p_rationale: verdict.rationale,
    });

    setRunning(false);
    setPreview(
      `${inputs.asset_name}: β=${fit.beta.toFixed(2)}, ${(risk.probability * 100).toFixed(1)}% chance of failure in 30 days. ${verdict.rationale}`,
    );
    refetch();
  }

  if (loading) return <LoadingState label="Loading lifecycle position" />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  const evals = data?.evaluations ?? [];

  return (
    <section aria-labelledby="lifecycle-heading" className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            id="lifecycle-heading"
            className="flex items-center gap-2 text-lg font-semibold text-white"
          >
            <Scale3d className="h-5 w-5 text-signal-gold" aria-hidden />
            Repair · Replace · Redesign · Defer
            <span className="text-xs font-normal text-slate-500">
              {data?.assets_with_economics}/{data?.assets} assets priced
            </span>
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-300">{data?.note}</p>
        </div>
        <button
          onClick={evaluateWorstActor}
          disabled={running}
          className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-slate-200 hover:bg-white/10 disabled:opacity-50 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-signal-cyan"
        >
          {running ? "Analysing…" : "Evaluate worst actor"}
        </button>
      </div>

      {preview && (
        <p className="rounded-xl border border-white/6 bg-white/2 p-3 text-xs leading-relaxed text-slate-300">
          {preview}
        </p>
      )}

      {evals.length === 0 ? (
        <p className="rounded-xl border border-white/6 bg-white/2 p-4 text-sm text-slate-400">
          No lifecycle evaluation has been recorded. The deferral question — can
          this wait until the next window? — is answerable from failure history
          alone; the repair-versus-replace question needs a replacement value,
          which is yours to supply.
        </p>
      ) : (
        <ul className="space-y-2">
          {evals.map((e) => (
            <li
              key={e.id}
              className="rounded-xl border border-white/6 bg-overlook-deep/40 p-4"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium text-slate-200">
                  {e.asset}
                  {e.recommended ? (
                    <span className="ml-2 text-signal-cyan">
                      → {e.recommended}
                    </span>
                  ) : (
                    <span className="ml-2 text-slate-500">
                      → no ranking possible
                    </span>
                  )}
                </p>
                <div className="flex items-center gap-2 text-xs">
                  <span
                    className={`rounded-full border px-2 py-0.5 ${UNCERTAINTY_STYLE[e.uncertainty]}`}
                  >
                    {e.uncertainty} uncertainty
                  </span>
                  {e.decision && (
                    <span className="rounded-full border border-white/10 px-2 py-0.5 text-slate-400">
                      {e.decision}
                    </span>
                  )}
                </div>
              </div>

              <p className="mt-1 text-xs text-slate-400">{e.rationale}</p>

              <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                {(e.options ?? []).map((o) => (
                  <li
                    key={o.option}
                    className="flex items-baseline justify-between gap-2 text-xs"
                  >
                    <span
                      className={
                        o.option === e.recommended
                          ? "text-signal-cyan"
                          : "text-slate-400"
                      }
                    >
                      {o.option}
                    </span>
                    <span
                      className={`font-mono tabular-nums ${o.annualCostUsd == null ? "text-slate-600" : "text-slate-300"}`}
                    >
                      {money(o.annualCostUsd)}
                    </span>
                  </li>
                ))}
              </ul>

              {(e.options ?? []).some((o) => o.missingInputs?.length > 0) && (
                <p className="mt-1.5 flex items-start gap-1.5 text-xs text-slate-500">
                  <CircleHelp className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                  Unpriced because these are not recorded:{" "}
                  {[
                    ...new Set(
                      (e.options ?? []).flatMap((o) => o.missingInputs ?? []),
                    ),
                  ].join(", ")}
                  .
                </p>
              )}

              {e.uncertainty_reasons?.length > 0 && (
                <ul className="mt-1.5 space-y-0.5">
                  {e.uncertainty_reasons.map((r) => (
                    <li
                      key={r}
                      className="flex items-start gap-1.5 text-xs text-amber-200/80"
                    >
                      <TriangleAlert
                        className="mt-0.5 h-3 w-3 shrink-0"
                        aria-hidden
                      />
                      {r}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
