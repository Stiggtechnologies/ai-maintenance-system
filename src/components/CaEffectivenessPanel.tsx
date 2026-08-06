/**
 * CaEffectivenessPanel — the closed-loop tail (register C4.13–C4.17).
 *
 * Humans attest the judgment stages (physical correction, causal closure,
 * strategy update); the platform deterministically measures effectiveness
 * (recurrence within the observation window, evaluated hourly) and computes
 * similar-asset exposure. Ineffective outcomes re-open as governed
 * recommendations — the loop never closes itself on judgment.
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
  failure_mode: string | null;
  physical_verified_at: string | null;
  causal_addressed_at: string | null;
  strategy_updated_at: string | null;
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

interface CandidateWo {
  id: string;
  wo_number: string;
  title: string;
  completed_at: string;
}

async function getPanelData(): Promise<{
  verifications: Verification[];
  candidates: CandidateWo[];
}> {
  const [v, c] = await Promise.all([
    supabase
      .from("ca_verifications")
      .select(
        "id, failure_mode, physical_verified_at, causal_addressed_at, strategy_updated_at, observation_days, effectiveness, status, similar_exposure, work_orders!ca_verifications_work_order_id_fkey(wo_number, title), assets(tag)",
      )
      .order("created_at", { ascending: false })
      .limit(12),
    supabase
      .from("work_orders")
      .select("id, wo_number, title, completed_at")
      .eq("work_type", "corrective")
      .not("completed_at", "is", null)
      .order("completed_at", { ascending: false })
      .limit(8),
  ]);
  if (v.error) throw new Error(v.error.message);
  if (c.error) throw new Error(c.error.message);
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

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      refetch();
    } finally {
      setBusy(false);
    }
  };

  if (loading)
    return <LoadingState label="Loading corrective-action verifications" />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;
  const { verifications, candidates } = data ?? {
    verifications: [],
    candidates: [],
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
                await supabase.rpc("start_ca_verification", {
                  p_work_order_id: selectedWo,
                });
                setSelectedWo("");
              })
            }
            className="rounded-lg bg-signal-gold px-3 py-2 text-sm font-medium text-overlook-void hover:bg-signal-gold-soft disabled:opacity-40 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-signal-gold"
          >
            Start
          </button>
        </div>
      </div>

      {verifications.length === 0 ? (
        <EmptyState message="No corrective-action verifications yet — start one from a completed corrective work order." />
      ) : (
        <ul className="space-y-3">
          {verifications.map((v) => (
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
                      await supabase.rpc("attest_ca_stage", {
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
                      await supabase.rpc("attest_ca_stage", {
                        p_verification_id: v.id,
                        p_stage: "causal",
                      });
                    })
                  }
                />
                <Stage
                  label="strategy"
                  at={v.strategy_updated_at}
                  busy={busy}
                  onAttest={() =>
                    act(async () => {
                      await supabase.rpc("attest_ca_stage", {
                        p_verification_id: v.id,
                        p_stage: "strategy",
                      });
                    })
                  }
                />
                <button
                  onClick={() =>
                    act(async () => {
                      await supabase.rpc("screen_similar_assets", {
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
          ))}
        </ul>
      )}
    </section>
  );
}
