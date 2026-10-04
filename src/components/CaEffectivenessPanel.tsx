/**
 * CaEffectivenessPanel — the closed-loop tail (register C4.13–C4.17).
 *
 * Humans attest physical correction and causal closure. Strategy completion
 * requires an immutable, independently reviewed lifecycle-plan version for the
 * same asset; a free-text attestation is not accepted. The platform then
 * measures recurrence deterministically and computes similar-asset exposure.
 */
import { useState } from "react";
import {
  RotateCcw,
  CheckCircle2,
  CircleDashed,
  AlertTriangle,
} from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import { supabase } from "../lib/supabase";
import { LoadingState, ErrorState, EmptyState } from "./ui/AsyncStates";

interface Verification {
  id: string;
  asset_id: string;
  failure_mode: string | null;
  physical_verified_at: string | null;
  causal_addressed_at: string | null;
  strategy_updated_at: string | null;
  strategy_lifecycle_plan_id: string | null;
  strategy_note: string | null;
  observation_days: number;
  effectiveness: "observing" | "effective" | "ineffective";
  status: string;
  similar_exposure: Array<{
    tag: string;
    same_mode_events: number;
    downtime_hours: number;
  }> | null;
  work_orders: { wo_number: string; title: string } | null;
  assets: { tag: string } | null;
}

interface LifecyclePlan {
  id: string;
  asset_id: string;
  version: number;
  objective: string;
  adopted_action: "apply_recommended" | "retain_current" | "defer";
  adopted_strategy: { programmeChanged?: boolean } | null;
  adopted_at: string;
}

interface CandidateWo {
  id: string;
  wo_number: string;
  title: string;
  completed_at: string;
}

interface EffectivenessMetric {
  available: boolean;
  concluded: number;
  effective: number;
  ineffective: number;
  observingExcluded: number;
  effectivenessRatePct: number | null;
  basis: string;
}

async function getPanelData(): Promise<{
  verifications: Verification[];
  candidates: CandidateWo[];
  metric: EffectivenessMetric;
  lifecyclePlans: LifecyclePlan[];
}> {
  const [v, c, m, l] = await Promise.all([
    supabase
      .from("ca_verifications")
      .select(
        "id, asset_id, failure_mode, physical_verified_at, causal_addressed_at, strategy_updated_at, strategy_lifecycle_plan_id, strategy_note, observation_days, effectiveness, status, similar_exposure, work_orders!ca_verifications_work_order_id_fkey(wo_number, title), assets(tag)",
      )
      .not("work_order_id", "is", null)
      .not("asset_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(12),
    supabase
      .from("work_orders")
      .select("id, wo_number, title, completed_at")
      .eq("work_type", "corrective")
      .not("completed_at", "is", null)
      .order("completed_at", { ascending: false })
      .limit(8),
    supabase.rpc("get_ca_effectiveness_rate"),
    supabase
      .from("asset_lifecycle_plans")
      .select(
        "id, asset_id, version, objective, adopted_action, adopted_strategy, adopted_at",
      )
      .eq("adopted_action", "apply_recommended")
      .order("adopted_at", { ascending: false }),
  ]);
  if (v.error) throw new Error(v.error.message);
  if (c.error) throw new Error(c.error.message);
  if (m.error) throw new Error(m.error.message);
  if (l.error) throw new Error(l.error.message);
  const metric = m.data as EffectivenessMetric & { error?: string };
  if (metric.error) throw new Error(metric.error);
  const norm = (row: unknown): Verification => {
    const r = row as Verification & {
      work_orders: Verification["work_orders"] | Verification["work_orders"][];
      assets: Verification["assets"] | Verification["assets"][];
    };
    return {
      ...r,
      work_orders: Array.isArray(r.work_orders)
        ? r.work_orders[0]
        : r.work_orders,
      assets: Array.isArray(r.assets) ? r.assets[0] : r.assets,
    };
  };
  return {
    verifications: (v.data ?? []).map(norm),
    candidates: (c.data ?? []) as CandidateWo[],
    metric,
    lifecyclePlans: (l.data ?? []) as LifecyclePlan[],
  };
}

function Stage({
  label,
  at,
  onAttest,
  busy,
}: {
  label: string;
  at: string | null;
  onAttest?: () => void;
  busy: boolean;
}) {
  return at ? (
    <span className="inline-flex items-center gap-1 rounded-full border border-teal-500/30 bg-teal-500/10 px-2 py-0.5 text-xs text-teal-300">
      <CheckCircle2 className="h-3 w-3" aria-hidden /> {label}
    </span>
  ) : onAttest ? (
    <button
      onClick={onAttest}
      disabled={busy}
      className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-slate-300 hover:border-signal-cyan/40 hover:text-signal-cyan disabled:opacity-40 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-signal-cyan"
    >
      <CircleDashed className="h-3 w-3" aria-hidden /> attest {label}
    </button>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full border border-white/10 px-2 py-0.5 text-xs text-slate-500">
      <CircleDashed className="h-3 w-3" aria-hidden /> {label}
    </span>
  );
}

const EFFECT_CHIP: Record<Verification["effectiveness"], string> = {
  observing: "border-signal-cyan/30 bg-signal-cyan/10 text-signal-cyan",
  effective: "border-teal-500/30 bg-teal-500/10 text-teal-300",
  ineffective: "border-red-500/30 bg-red-500/10 text-red-300",
};

export function CaEffectivenessPanel() {
  const { data, loading, error, refetch } = useAsyncData(getPanelData, []);
  const [busy, setBusy] = useState(false);
  const [selectedWo, setSelectedWo] = useState("");
  const [strategySelections, setStrategySelections] = useState<
    Record<string, string>
  >({});
  const [strategyBases, setStrategyBases] = useState<Record<string, string>>(
    {},
  );
  const [notice, setNotice] = useState<{
    kind: "ok" | "error";
    text: string;
  } | null>(null);

  const act = async (fn: () => Promise<unknown>, success?: string) => {
    setBusy(true);
    setNotice(null);
    try {
      const result = await fn();
      if (result && typeof result === "object") {
        const response = result as {
          data?: unknown;
          error?: { message?: string } | null;
        };
        if (response.error) throw new Error(response.error.message);
        if (
          response.data &&
          typeof response.data === "object" &&
          "error" in response.data
        ) {
          throw new Error(String((response.data as { error: unknown }).error));
        }
      }
      if (success) setNotice({ kind: "ok", text: success });
      await refetch();
    } catch (caught) {
      setNotice({
        kind: "error",
        text:
          caught instanceof Error
            ? caught.message
            : "The governed corrective-action request failed.",
      });
    } finally {
      setBusy(false);
    }
  };

  if (loading)
    return <LoadingState label="Loading corrective-action verifications" />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;
  const { verifications, candidates, metric, lifecyclePlans } = data ?? {
    verifications: [],
    candidates: [],
    metric: null,
    lifecyclePlans: [],
  };

  return (
    <section aria-labelledby="ca-effect-heading" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2
            id="ca-effect-heading"
            className="flex items-center gap-2 text-lg font-semibold text-white"
          >
            <RotateCcw className="h-5 w-5 text-signal-gold" aria-hidden />
            Corrective-Action Effectiveness
          </h2>
          <p className="mt-1 text-sm text-slate-300">
            A corrective action is complete only when verified, measured over an
            operating window, and similar assets are screened. Humans attest
            judgment; the platform measures recurrence deterministically.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            aria-label="Completed corrective work order"
            value={selectedWo}
            onChange={(e) => setSelectedWo(e.target.value)}
            className="max-w-72 rounded-lg border border-overlook-rule bg-overlook-void/60 px-3 py-2 text-sm text-overlook-paper focus:border-signal-cyan/70 focus:outline-hidden"
          >
            <option value="">Start verification for…</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.wo_number} — {c.title.slice(0, 40)}
              </option>
            ))}
          </select>
          <button
            disabled={!selectedWo || busy}
            onClick={() =>
              act(async () => {
                const result = await supabase.rpc("start_ca_verification", {
                  p_work_order_id: selectedWo,
                });
                if (
                  !result.error &&
                  !(result.data as { error?: string })?.error
                )
                  setSelectedWo("");
                return result;
              })
            }
            className="rounded-lg bg-signal-gold px-3 py-2 text-sm font-medium text-overlook-void hover:bg-signal-gold-soft disabled:opacity-40 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-signal-gold"
          >
            Start
          </button>
        </div>
      </div>

      {notice ? (
        <p
          role="status"
          className={`rounded-lg border px-3 py-2 text-xs ${notice.kind === "ok" ? "border-teal-500/30 bg-teal-500/10 text-teal-200" : "border-red-500/30 bg-red-500/10 text-red-200"}`}
        >
          {notice.text}
        </p>
      ) : null}

      {metric?.available ? (
        <div className="rounded-xl border border-teal-500/20 bg-teal-500/5 p-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="text-3xl font-semibold tabular-nums text-teal-300">
                {metric.effectivenessRatePct}%
              </div>
              <div className="text-xs text-slate-400">
                {metric.effective} effective of {metric.concluded} concluded
              </div>
            </div>
            <div className="text-right text-xs text-slate-400">
              <div>{metric.ineffective} ineffective</div>
              <div>{metric.observingExcluded} still observing — excluded</div>
              <div className="mt-1 text-slate-500">
                Trend only; no universal target asserted.
              </div>
            </div>
          </div>
          <p className="mt-3 text-xs text-slate-500">{metric.basis}</p>
        </div>
      ) : (
        <p className="rounded-lg border border-white/8 bg-white/3 px-3 py-2 text-xs text-slate-400">
          Effectiveness rate awaits its first concluded observation window.
          {metric && metric.observingExcluded > 0
            ? ` ${metric.observingExcluded} verification(s) are still observing and are not treated as failures or successes.`
            : ""}
        </p>
      )}

      {verifications.length === 0 ? (
        <EmptyState message="No corrective-action verifications yet — start one from a completed corrective work order." />
      ) : (
        <ul className="space-y-3">
          {verifications.map((v) => {
            const eligiblePlans = lifecyclePlans.filter(
              (plan) =>
                plan.asset_id === v.asset_id &&
                plan.adopted_action === "apply_recommended" &&
                plan.adopted_strategy?.programmeChanged === true,
            );
            const selectedPlan =
              strategySelections[v.id] ?? eligiblePlans[0]?.id ?? "";
            const linkedPlan = lifecyclePlans.find(
              (plan) => plan.id === v.strategy_lifecycle_plan_id,
            );
            return (
              <li
                key={v.id}
                className="rounded-xl border border-white/6 bg-overlook-deep/40 p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-200">
                      {v.assets?.tag} · {v.work_orders?.wo_number} —{" "}
                      {v.failure_mode ?? "uncoded mode"}
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      {v.observation_days}-day observation window
                    </div>
                  </div>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-xs ${EFFECT_CHIP[v.effectiveness]}`}
                  >
                    {v.effectiveness}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Stage
                    label="physical"
                    at={v.physical_verified_at}
                    busy={busy}
                    onAttest={() =>
                      act(async () => {
                        return await supabase.rpc("attest_ca_stage", {
                          p_verification_id: v.id,
                          p_stage: "physical",
                        });
                      })
                    }
                  />
                  <Stage
                    label="causal"
                    at={v.causal_addressed_at}
                    busy={busy}
                    onAttest={() =>
                      act(async () => {
                        return await supabase.rpc("attest_ca_stage", {
                          p_verification_id: v.id,
                          p_stage: "causal",
                        });
                      })
                    }
                  />
                  <Stage
                    label={
                      linkedPlan
                        ? `strategy v${linkedPlan.version}`
                        : "strategy"
                    }
                    at={v.strategy_lifecycle_plan_id}
                    busy={busy}
                  />
                  <button
                    onClick={() =>
                      act(async () => {
                        return await supabase.rpc("screen_similar_assets", {
                          p_verification_id: v.id,
                        });
                      })
                    }
                    disabled={busy}
                    className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-slate-300 hover:border-signal-gold/40 hover:text-signal-gold disabled:opacity-40 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-signal-gold"
                  >
                    screen similar assets
                  </button>
                </div>
                {!v.strategy_lifecycle_plan_id ? (
                  <div className="mt-3 rounded-lg border border-cyan-400/20 bg-cyan-400/5 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="text-xs font-semibold text-cyan-200">
                          Governed strategy update required
                        </div>
                        <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-400">
                          Link an independently reviewed lifecycle-plan version
                          that changed this asset&apos;s canonical maintenance
                          programme. Free-text attestation alone does not close
                          this stage.
                        </p>
                      </div>
                      <a
                        href="/interval-decisions"
                        className="text-xs font-semibold text-cyan-300 underline-offset-4 hover:underline"
                      >
                        Open Asset Strategy Specialist
                      </a>
                    </div>
                    {v.strategy_updated_at ? (
                      <p className="mt-2 text-xs text-amber-300">
                        A legacy strategy attestation exists, but it is not
                        treated as proof until an adopted lifecycle plan is
                        linked.
                      </p>
                    ) : null}
                    <div className="mt-3 grid gap-2 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.5fr)_auto]">
                      <select
                        aria-label={`Adopted strategy for ${v.work_orders?.wo_number ?? v.id}`}
                        value={selectedPlan}
                        onChange={(event) =>
                          setStrategySelections((current) => ({
                            ...current,
                            [v.id]: event.target.value,
                          }))
                        }
                        className="rounded-lg border border-white/10 bg-overlook-void/70 px-3 py-2 text-xs text-slate-200 focus:border-cyan-400/60 focus:outline-hidden"
                      >
                        <option value="">Select adopted plan…</option>
                        {eligiblePlans.map((plan) => (
                          <option key={plan.id} value={plan.id}>
                            v{plan.version} · {plan.objective.slice(0, 62)}
                          </option>
                        ))}
                      </select>
                      <input
                        aria-label={`Strategy linkage basis for ${v.work_orders?.wo_number ?? v.id}`}
                        value={strategyBases[v.id] ?? ""}
                        onChange={(event) =>
                          setStrategyBases((current) => ({
                            ...current,
                            [v.id]: event.target.value,
                          }))
                        }
                        placeholder="Explain how this adopted programme change addresses the corrective action"
                        className="rounded-lg border border-white/10 bg-overlook-void/70 px-3 py-2 text-xs text-slate-200 placeholder:text-slate-600 focus:border-cyan-400/60 focus:outline-hidden"
                      />
                      <button
                        type="button"
                        disabled={
                          busy ||
                          !v.physical_verified_at ||
                          !v.causal_addressed_at ||
                          !selectedPlan ||
                          (strategyBases[v.id] ?? "").trim().length < 20
                        }
                        onClick={() =>
                          act(
                            async () =>
                              await supabase.rpc("link_ca_strategy_update", {
                                p_verification_id: v.id,
                                p_lifecycle_plan_id: selectedPlan,
                                p_basis: strategyBases[v.id] ?? "",
                              }),
                            "Adopted same-asset strategy version linked; the observation window is now governed by retained evidence.",
                          )
                        }
                        className="rounded-lg bg-cyan-300 px-3 py-2 text-xs font-semibold text-slate-950 disabled:opacity-40"
                      >
                        Link adopted strategy
                      </button>
                    </div>
                    {eligiblePlans.length === 0 ? (
                      <p className="mt-2 text-xs text-slate-500">
                        No applied programme change is available for this asset.
                        Run the Asset Strategy Specialist and complete
                        independent review and named-human adoption first.
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <p className="mt-3 rounded-lg border border-teal-500/20 bg-teal-500/5 px-3 py-2 text-xs text-teal-200">
                    Canonical lifecycle-plan version{" "}
                    {linkedPlan?.version ?? "—"}
                    {v.strategy_note ? ` · ${v.strategy_note}` : ""}
                  </p>
                )}
                {v.similar_exposure && v.similar_exposure.length > 0 && (
                  <div className="mt-3 rounded-lg border border-signal-gold/20 bg-signal-gold/5 p-2.5">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-signal-gold">
                      <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                      Similar-asset exposure ({v.similar_exposure.length})
                    </div>
                    <div className="mt-1 flex flex-wrap gap-2">
                      {v.similar_exposure.slice(0, 6).map((e) => (
                        <span
                          key={e.tag}
                          className="rounded border border-white/10 px-1.5 py-0.5 font-mono text-[11px] text-slate-300"
                        >
                          {e.tag}: {e.same_mode_events}× / {e.downtime_hours}h
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
