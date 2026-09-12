import { useState } from "react";
import { BarChart3, CalendarClock, RefreshCw, ShieldCheck } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import { supabase } from "../lib/supabase";
import { ErrorState, LoadingState } from "./ui/AsyncStates";

type LossRow = {
  asset_id: string;
  tag: string | null;
  asset: string;
  status: "forecast" | "not_assessable";
  state_coverage_pct: number;
  history_unplanned_events: number;
  demonstrated_rate: number | null;
  unit_of_measure: string | null;
  expected_unplanned_hours: number | null;
  expected_units_at_risk: number | null;
  refusal: string | null;
  basis: string;
};

type BacklogRow = {
  work_order_id: string;
  wo_number: string | null;
  title: string;
  asset: string | null;
  priority: string;
  criticality: string;
  current_risk_score: number | null;
  risk_basis: string;
  safety_flag: boolean;
  due_date: string | null;
  age_days: number;
  planned_hours: number | null;
  sized: boolean;
};

type OutageCandidate = {
  work_order_id: string;
  wo_number: string | null;
  title: string;
  asset: string | null;
  priority: string;
  criticality: string;
  planned_hours: number;
  current_risk_score: number | null;
  selection_basis: string;
};

type OutageOption = {
  window_id: string;
  window_key: string;
  title: string;
  starts_at: string;
  remaining_hours: number;
  late_additions: number;
  candidates: OutageCandidate[];
  authority: string;
};

type OptimizationResult = {
  history_days: number;
  horizon_days: number;
  source_posture: "connector_backed" | "seed_sim_or_import";
  loss_forecast: LossRow[];
  risk_backlog: BacklogRow[];
  outage_options: OutageOption[];
  controls: Record<string, string>;
};

type RunPayload = {
  run_id?: string;
  status: "not_generated" | "draft" | "reviewed" | "superseded";
  generated_at?: string;
  result?: OptimizationResult;
  error?: string;
};

export function MaintenanceOptimization() {
  const [generating, setGenerating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const { data, loading, error, refetch } = useAsyncData<RunPayload>(async () => {
    const { data: payload, error: rpcError } = await supabase.rpc(
      "get_latest_maintenance_optimization_run",
      {},
    );
    if (rpcError) throw new Error(rpcError.message);
    return payload as RunPayload;
  }, []);

  async function generate() {
    setGenerating(true);
    setActionError(null);
    try {
      const { data: payload, error: rpcError } = await supabase.rpc(
        "generate_maintenance_optimization_run",
        { p_history_days: 180, p_horizon_days: 90, p_limit: 50 },
      );
      if (rpcError) throw new Error(rpcError.message);
      const response = payload as RunPayload;
      if (response.error) throw new Error(response.error);
      await refetch();
    } catch (caught) {
      setActionError(
        caught instanceof Error ? caught.message : "Planning run could not be generated.",
      );
    } finally {
      setGenerating(false);
    }
  }

  if (loading) return <LoadingState label="Loading maintenance optimization" />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  const result = data?.result;
  const measurable = result?.loss_forecast.filter((row) => row.status === "forecast") ?? [];

  return (
    <section aria-labelledby="maintenance-optimization-heading" className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="maintenance-optimization-heading" className="flex items-center gap-2 text-lg font-semibold text-white">
            <BarChart3 className="h-5 w-5 text-signal-cyan" aria-hidden />
            Loss, backlog &amp; outage planning
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-300">
            A persisted planning run connects demonstrated production loss, governed backlog risk, and constrained outage opportunities. It never releases work or scope.
          </p>
        </div>
        <button
          type="button"
          disabled={generating}
          onClick={() => void generate()}
          className="inline-flex items-center gap-2 rounded-lg border border-signal-cyan/30 bg-signal-cyan/10 px-3 py-2 text-xs font-semibold text-signal-cyan disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${generating ? "animate-spin" : ""}`} aria-hidden />
          {result ? "Regenerate planning run" : "Generate planning run"}
        </button>
      </div>

      {actionError ? (
        <p role="alert" className="rounded-lg border border-red-500/25 bg-red-500/5 p-3 text-xs text-red-200">
          {actionError}
        </p>
      ) : null}

      {!result ? (
        <p className="rounded-xl border border-white/6 bg-white/2 p-4 text-sm text-slate-400">
          No governed planning run exists yet. Generate one from current tenant evidence; missing history will be reported as not assessable rather than estimated.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-white/6 bg-white/2 p-3 text-xs text-slate-400">
            <span>{result.history_days}-day history</span>
            <span>{result.horizon_days}-day horizon</span>
            <span>{result.source_posture === "connector_backed" ? "Historian connector enabled" : "Seed, simulation, or import evidence"}</span>
            <span>{data?.generated_at ? new Date(data.generated_at).toLocaleString() : "Draft run"}</span>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <article className="rounded-xl border border-white/6 bg-overlook-deep/40 p-4">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                <BarChart3 className="h-4 w-4 text-signal-cyan" aria-hidden />
                Demonstrated loss forecast
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                {measurable.length} asset{measurable.length === 1 ? "" : "s"} forecastable; mixed units are never summed.
              </p>
              <ul className="mt-3 space-y-2">
                {result.loss_forecast.slice(0, 8).map((row) => (
                  <li key={row.asset_id} className="rounded-lg border border-white/5 p-3 text-xs">
                    <div className="flex justify-between gap-3">
                      <strong className="text-slate-200">{row.tag ? `${row.tag} · ` : ""}{row.asset}</strong>
                      <span className={row.status === "forecast" ? "text-signal-cyan" : "text-amber-300"}>
                        {row.status === "forecast" ? `${row.expected_units_at_risk} ${row.unit_of_measure} at risk` : "Not assessable"}
                      </span>
                    </div>
                    {row.status === "forecast" ? (
                      <p className="mt-1 text-slate-400">{row.expected_unplanned_hours} expected unplanned h · {row.history_unplanned_events} observed events · {row.state_coverage_pct}% state coverage</p>
                    ) : (
                      <p className="mt-1 text-amber-200/80">{row.refusal}</p>
                    )}
                  </li>
                ))}
              </ul>
            </article>

            <article className="rounded-xl border border-white/6 bg-overlook-deep/40 p-4">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                <ShieldCheck className="h-4 w-4 text-signal-gold" aria-hidden />
                Risk-ranked open backlog
              </h3>
              <p className="mt-1 text-xs text-slate-500">Linked ISO 31000 risk leads. Priority and criticality remain a labelled proxy when no governed risk exists.</p>
              <ol className="mt-3 space-y-2">
                {result.risk_backlog.slice(0, 10).map((row, index) => (
                  <li key={row.work_order_id} className="flex gap-3 rounded-lg border border-white/5 p-3 text-xs">
                    <span className="font-mono text-slate-500">{index + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap justify-between gap-2">
                        <strong className="text-slate-200">{row.wo_number ?? "Unnumbered"} · {row.title}</strong>
                        <span className="text-slate-400">{row.current_risk_score == null ? "Proxy ordering" : `Risk ${row.current_risk_score}`}</span>
                      </div>
                      <p className="mt-1 text-slate-500">{row.asset ?? "No asset"} · {row.priority} priority · {row.criticality} criticality · {row.age_days} days open{row.sized ? ` · ${row.planned_hours} h` : " · unsized"}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </article>
          </div>

          <article className="rounded-xl border border-white/6 bg-overlook-deep/40 p-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-100">
              <CalendarClock className="h-4 w-4 text-green-300" aria-hidden />
              Constrained outage opportunities
            </h3>
            {result.outage_options.length === 0 ? (
              <p className="mt-2 text-xs text-slate-500">No future planned or frozen outage window exists. SyncAI will not invent a window or available capacity.</p>
            ) : (
              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                {result.outage_options.map((window) => (
                  <section key={window.window_id} className="rounded-lg border border-white/5 p-3">
                    <div className="flex justify-between gap-3 text-xs">
                      <strong className="text-slate-200">{window.title}</strong>
                      <span className="text-green-300">{window.remaining_hours} h remaining</span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">{new Date(window.starts_at).toLocaleDateString()} · {window.late_additions} late additions</p>
                    <ul className="mt-2 space-y-1.5">
                      {window.candidates.length === 0 ? <li className="text-xs text-slate-500">No unblocked, sized work fits this window.</li> : window.candidates.map((candidate) => (
                        <li key={candidate.work_order_id} className="rounded border border-white/5 px-2 py-1.5 text-xs text-slate-300">
                          {candidate.wo_number ?? "Unnumbered"} · {candidate.title} · {candidate.planned_hours} h
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 text-[11px] text-slate-500">{window.authority}</p>
                  </section>
                ))}
              </div>
            )}
          </article>
        </>
      )}
    </section>
  );
}
