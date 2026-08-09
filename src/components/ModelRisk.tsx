/**
 * ModelRisk — whether this platform's own numbers can be checked
 * (capability register E5.08–E5.11, E5.14, E5.15).
 *
 * Every other panel in this application reports on the plant. This one reports
 * on the application. The question it exists to keep visible is whether the
 * scores driving all that work have ever been compared with what actually
 * happened — because a score with no recorded outcome cannot be shown wrong,
 * and that is not the same as being right.
 */
import { useMemo, useState } from "react";
import { Gauge, Info, ListChecks } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import { supabase } from "../lib/supabase";
import {
  assessCalibration,
  reviewModelRegister,
  type Prediction,
  type ModelRecord,
} from "../lib/model-risk";
import { LoadingState, ErrorState } from "./ui/AsyncStates";

interface Posture {
  models_registered: number;
  models_approved: number;
  models_autonomous_unapproved: number;
  predictions_total: number;
  predictions_with_outcome: number;
  continuity_untested: number;
  basis: string;
}

interface RegisterRow {
  modelKey: string;
  version: string;
  modelKind: string;
  purpose: string;
  approvedFor: string[];
  approvedOn: string | null;
  reviewDue: string | null;
  humanInLoop: boolean;
  verificationReference: string | null;
  limitations: string | null;
}

const CAL_MODEL = "health-score-as-probability";

export function ModelRisk() {
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data, loading, error, refetch } = useAsyncData<{
    posture: Posture | null;
    models: RegisterRow[];
    predictions: Prediction[];
  }>(async () => {
    const [p, m, pr] = await Promise.all([
      supabase.rpc("get_model_risk_posture"),
      supabase.rpc("get_model_register"),
      supabase.rpc("get_model_predictions", { p_model_key: CAL_MODEL }),
    ]);
    if (p.error) throw new Error(p.error.message);
    if (m.error) throw new Error(m.error.message);
    if (pr.error) throw new Error(pr.error.message);
    return {
      posture: (p.data as Posture[])?.[0] ?? null,
      models: (m.data as RegisterRow[]) ?? [],
      predictions: (
        (pr.data as { predicted: number; outcome: boolean | null }[]) ?? []
      ).map((x) => ({ predicted: Number(x.predicted), outcome: x.outcome })),
    };
  }, []);

  const calibration = useMemo(
    () => assessCalibration(data?.predictions ?? []),
    [data],
  );

  const registerVerdict = useMemo(
    () =>
      reviewModelRegister(
        (data?.models ?? []).map((m): ModelRecord => ({
          modelKey: m.modelKey,
          version: m.version,
          approvedFor: m.approvedFor ?? [],
          approvedOn: m.approvedOn,
          reviewDue: m.reviewDue,
          humanInLoop: m.humanInLoop,
        })),
        new Date(),
      ),
    [data],
  );

  if (loading) return <LoadingState label="Loading model-risk posture" />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  const posture = data?.posture ?? null;
  const models = data?.models ?? [];

  return (
    <section aria-labelledby="modelrisk-heading" className="space-y-4">
      <div>
        <h2
          id="modelrisk-heading"
          className="flex items-center gap-2 text-lg font-semibold text-white"
        >
          <Gauge className="h-5 w-5 text-signal-cyan" aria-hidden />
          Model Risk
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-300">
          Every other panel reports on the plant. This one reports on this
          application — and on whether its numbers have ever been checked
          against what happened.
        </p>
      </div>

      {posture && (
        <div
          className={`flex items-start gap-2 rounded-xl border p-4 text-sm ${
            posture.models_autonomous_unapproved > 0
              ? "border-rose-500/30 bg-rose-500/5 text-rose-100"
              : "border-amber-500/25 bg-amber-500/5 text-amber-100"
          }`}
        >
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>{posture.basis}</p>
        </div>
      )}

      {/* Calibration. */}
      <div className="rounded-xl border border-white/6 p-4">
        <h3 className="text-sm font-semibold text-white">
          Calibration of the health score
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-slate-400">
          {calibration.reason}
        </p>
        {calibration.measurable && calibration.bins.length > 0 && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[28rem] text-left text-sm">
              <caption className="sr-only">
                Predicted probability against observed rate, by band
              </caption>
              <thead className="text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Band
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    n
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Predicted
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    Observed
                  </th>
                </tr>
              </thead>
              <tbody>
                {calibration.bins.map((b) => (
                  <tr key={b.lower} className="border-t border-white/6">
                    <td className="py-2 pr-4 font-mono text-xs text-slate-300">
                      {(b.lower * 100).toFixed(0)}–{(b.upper * 100).toFixed(0)}%
                    </td>
                    <td className="py-2 pr-4 font-mono text-slate-400 tabular-nums">
                      {b.count}
                    </td>
                    <td className="py-2 pr-4 font-mono text-slate-300 tabular-nums">
                      {(b.meanPredicted * 100).toFixed(0)}%
                    </td>
                    <td
                      className={`py-2 font-mono tabular-nums ${Math.abs(b.gap) > 0.1 ? "text-amber-300" : "text-slate-300"}`}
                    >
                      {(b.observedRate * 100).toFixed(0)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* The register. */}
      <div className="rounded-xl border border-white/6 p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
          <ListChecks className="h-4 w-4 text-signal-cyan" aria-hidden />
          Approved-model register
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-slate-400">
          {registerVerdict.reason}
        </p>
        <ul className="mt-3 space-y-1">
          {models.map((m) => {
            const key = `${m.modelKey}@${m.version}`;
            const open = expanded === key;
            return (
              <li key={key} className="rounded-lg border border-white/6">
                <button
                  type="button"
                  onClick={() => setExpanded(open ? null : key)}
                  aria-expanded={open}
                  className="flex w-full flex-wrap items-baseline gap-2 p-2 text-left text-sm"
                >
                  <span className="font-mono text-xs text-slate-200">
                    {m.modelKey}
                  </span>
                  <span className="text-xs text-slate-500">
                    v{m.version} · {m.modelKind.replace(/_/g, " ")}
                  </span>
                  <span
                    className={`text-xs ${m.approvedOn ? "text-signal-cyan" : "text-amber-300"}`}
                  >
                    {m.approvedOn ? `approved ${m.approvedOn}` : "unapproved"}
                  </span>
                  {m.humanInLoop && (
                    <span className="text-xs text-slate-600">
                      human in the loop
                    </span>
                  )}
                </button>
                {open && (
                  <div className="space-y-1 border-t border-white/6 p-2 text-xs">
                    <p className="text-slate-300">{m.purpose}</p>
                    {m.verificationReference && (
                      <p className="font-mono text-slate-500">
                        verified by {m.verificationReference}
                      </p>
                    )}
                    {m.limitations && (
                      <p className="italic leading-relaxed text-amber-200/80">
                        {m.limitations}
                      </p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
