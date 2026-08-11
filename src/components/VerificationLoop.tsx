/**
 * VerificationLoop — did the approved action produce the intended outcome?
 * (register C4.08; the closing question of the enterprise target state.)
 *
 * The panel's job is to keep three silent states apart, because all three
 * render as "nothing to see" if unmanaged:
 *
 *   unwatched — actioned before obligations existed; nothing tracks them.
 *   overdue   — an obligation exists and its date passed. A verification that
 *               never happens is indistinguishable from one that passed.
 *   pending   — open and in date. The one healthy quiet state.
 *
 * A recorded FAILURE is displayed as the system working: a verification
 * process that has never failed anything has never been tested by reality.
 */
import { useMemo } from "react";
import { CheckCircle2, Clock, Info, RefreshCcw } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import { supabase } from "../lib/supabase";
import { assessLoop, type VerificationPosture } from "../lib/verification-loop";
import { LoadingState, ErrorState } from "./ui/AsyncStates";

interface OpenRow {
  obligationId: string;
  recommendationTitle: string;
  assetName: string | null;
  method: string;
  dueDate: string;
  dueDateAssumed: boolean;
  daysOverdue: number;
  intendedOutcome: string | null;
}

export function VerificationLoop() {
  const { data, loading, error, refetch } = useAsyncData<{
    posture: VerificationPosture | null;
    open: OpenRow[];
  }>(async () => {
    const [p, o] = await Promise.all([
      supabase.rpc("get_verification_posture"),
      supabase.rpc("get_open_verifications", { p_limit: 20 }),
    ]);
    if (p.error) throw new Error(p.error.message);
    if (o.error) throw new Error(o.error.message);
    const raw = (p.data as Record<string, number>[])?.[0] ?? null;
    return {
      posture: raw
        ? {
            actionedRecommendations: Number(raw.actionedRecommendations),
            withObligation: Number(raw.withObligation),
            openObligations: Number(raw.openObligations),
            overdue: Number(raw.overdue),
            achieved: Number(raw.achieved),
            notAchieved: Number(raw.notAchieved),
            inconclusive: Number(raw.inconclusive),
            waived: Number(raw.waived),
            actionedWithoutObligation: Number(raw.actionedWithoutObligation),
          }
        : null,
      open: (o.data as OpenRow[]) ?? [],
    };
  }, []);

  const loop = useMemo(() => assessLoop(data?.posture ?? null), [data]);

  if (loading) return <LoadingState label="Loading verification loop" />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  return (
    <section aria-labelledby="verify-heading" className="space-y-4">
      <div>
        <h2
          id="verify-heading"
          className="flex items-center gap-2 text-lg font-semibold text-white"
        >
          <RefreshCcw className="h-5 w-5 text-signal-cyan" aria-hidden />
          Verification Loop
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-300">
          Every released recommendation states how we will know it worked. This
          is whether anyone looked.
        </p>
      </div>

      <div
        className={`flex items-start gap-2 rounded-xl border p-4 text-sm ${
          loop.overdue > 0 || loop.healthiest === "unwatched"
            ? "border-amber-500/30 bg-amber-500/5 text-amber-100"
            : "border-white/6 bg-white/2 text-slate-300"
        }`}
      >
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <p>{loop.reason}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-white/6 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">
            Loop closure
          </p>
          <p className="mt-1 font-mono text-2xl tabular-nums text-signal-cyan">
            {loop.loopClosureRate === null
              ? "—"
              : `${(loop.loopClosureRate * 100).toFixed(0)}%`}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Actioned recommendations with a recorded outcome.
          </p>
        </div>
        <div className="rounded-xl border border-white/6 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">
            Outcomes achieved
          </p>
          <p className="mt-1 font-mono text-2xl tabular-nums text-slate-300">
            {loop.outcomeSuccessRate === null
              ? "—"
              : `${(loop.outcomeSuccessRate * 100).toFixed(0)}%`}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Of verifications executed.
          </p>
        </div>
        <div className="rounded-xl border border-white/6 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">
            Overdue
          </p>
          <p
            className={`mt-1 font-mono text-2xl tabular-nums ${loop.overdue > 0 ? "text-amber-300" : "text-slate-300"}`}
          >
            {loop.overdue}
          </p>
          <p className="mt-1 text-xs text-slate-500">The number to escalate.</p>
        </div>
        <div className="rounded-xl border border-white/6 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">
            Unwatched
          </p>
          <p
            className={`mt-1 font-mono text-2xl tabular-nums ${loop.unwatched > 0 ? "text-rose-300" : "text-slate-300"}`}
          >
            {loop.unwatched}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Actioned with no obligation at all.
          </p>
        </div>
      </div>

      {data && data.open.length > 0 && (
        <div className="rounded-xl border border-white/6 p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
            <Clock className="h-4 w-4 text-signal-cyan" aria-hidden />
            Open verifications
          </h3>
          <ul className="mt-2 space-y-2">
            {data.open.map((o) => (
              <li key={o.obligationId} className="text-sm">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-slate-200">
                    {o.recommendationTitle}
                  </span>
                  {o.assetName && (
                    <span className="text-xs text-slate-500">
                      {o.assetName}
                    </span>
                  )}
                  <span
                    className={`font-mono text-xs tabular-nums ${o.daysOverdue > 0 ? "text-amber-300" : "text-slate-500"}`}
                  >
                    due {o.dueDate}
                    {o.daysOverdue > 0 && ` · ${o.daysOverdue}d overdue`}
                  </span>
                  {o.dueDateAssumed && (
                    <span className="rounded bg-white/5 px-1.5 py-0.5 text-xs text-slate-500">
                      date assumed
                    </span>
                  )}
                </div>
                <p className="text-xs leading-relaxed text-slate-500">
                  {o.method}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {loop.hasRecordedFailure && (
        <div className="flex items-start gap-2 rounded-xl border border-signal-cyan/25 bg-signal-cyan/5 p-4 text-sm text-slate-200">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>
            At least one verification has recorded a failed outcome and fed it
            into the learning loop. That is the loop working — a verification
            process that has never failed anything has never been tested.
          </p>
        </div>
      )}
    </section>
  );
}
