/**
 * ProcessSafety — the barriers, and whether they still work
 * (capability register E2.01–E2.13).
 *
 * Two things are shown that a barrier count cannot. A barrier with no stated
 * performance standard is not counted, because nobody can test it. And
 * barriers sharing a common cause are named as such, because four preventive
 * barriers that all depend on instrument air are one barrier with three
 * copies — the same finding the interdependency slice makes about assets.
 *
 * The SIL table is the arithmetic: PFD computed from the proof-test interval
 * ACTUALLY achieved, not the one on the schedule, so an overdue test shows as
 * the band change it is rather than as a missed task.
 */
import { useMemo } from "react";
import { ShieldAlert, Info, Activity, Siren } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import { supabase } from "../lib/supabase";
import {
  verifySIF,
  assessBarriers,
  assessAlarms,
  type SIFInput,
  type BarrierSet,
} from "../lib/process-safety";
import { LoadingState, ErrorState } from "./ui/AsyncStates";

interface Posture {
  barriers_total: number;
  barriers_without_standard: number;
  open_impairments: number;
  impairments_without_deviation: number;
  sifs_overdue: number;
  iow_exceedances_unassessed: number;
  basis: string;
}

interface AlarmRow {
  console_label: string;
  operator_hours: number;
  total_alarms: number;
  peak_ten_minute_count: number | null;
  standing_alarms: number | null;
  high_priority: number | null;
  medium_priority: number | null;
  low_priority: number | null;
}

export function ProcessSafety() {
  const { data, loading, error, refetch } = useAsyncData<{
    posture: Posture | null;
    sifs: SIFInput[];
    hazards: BarrierSet[];
    alarms: AlarmRow[];
  }>(async () => {
    const [p, s, h, a] = await Promise.all([
      supabase.rpc("get_process_safety_posture"),
      supabase.rpc("get_sif_register"),
      supabase.rpc("get_hazard_barriers"),
      supabase
        .from("alarm_performance")
        .select(
          "console_label, operator_hours, total_alarms, peak_ten_minute_count, standing_alarms, high_priority, medium_priority, low_priority",
        )
        .order("period_end", { ascending: false })
        .limit(1),
    ]);
    if (p.error) throw new Error(p.error.message);
    if (s.error) throw new Error(s.error.message);
    if (h.error) throw new Error(h.error.message);
    if (a.error) throw new Error(a.error.message);
    return {
      posture: (p.data as Posture[])?.[0] ?? null,
      sifs: (s.data as SIFInput[]) ?? [],
      hazards: (h.data as BarrierSet[]) ?? [],
      alarms: (a.data as AlarmRow[]) ?? [],
    };
  }, []);

  const sifVerdicts = useMemo(
    () =>
      (data?.sifs ?? []).map((s) =>
        verifySIF({
          ...s,
          lambdaDU: Number(s.lambdaDU),
          betaFactor: s.betaFactor !== null ? Number(s.betaFactor) : null,
          monthsSinceLastTest:
            s.monthsSinceLastTest !== null &&
            s.monthsSinceLastTest !== undefined
              ? Number(s.monthsSinceLastTest)
              : null,
        }),
      ),
    [data],
  );

  const barrierVerdicts = useMemo(
    () => (data?.hazards ?? []).map((h) => assessBarriers(h)),
    [data],
  );

  const alarm = useMemo(() => {
    const a = (data?.alarms ?? [])[0];
    if (!a) return null;
    return {
      label: a.console_label,
      verdict: assessAlarms({
        operatorHours: Number(a.operator_hours),
        totalAlarms: Number(a.total_alarms),
        peakTenMinuteCount: a.peak_ten_minute_count,
        standingAlarms: a.standing_alarms,
        highPriority: a.high_priority,
        mediumPriority: a.medium_priority,
        lowPriority: a.low_priority,
      }),
    };
  }, [data]);

  if (loading) return <LoadingState label="Loading process-safety posture" />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  const posture = data?.posture ?? null;
  const breached = sifVerdicts.filter((v) => !v.meetsTarget).length;

  return (
    <section aria-labelledby="psm-heading" className="space-y-4">
      <div>
        <h2
          id="psm-heading"
          className="flex items-center gap-2 text-lg font-semibold text-white"
        >
          <ShieldAlert className="h-5 w-5 text-signal-cyan" aria-hidden />
          Process Safety
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-300">
          A barrier nobody can test is a claim. A SIL is a band of probability,
          and the proof-test interval that matters is the one actually achieved.
        </p>
      </div>

      {posture && (
        <div
          className={`flex items-start gap-2 rounded-xl border p-4 text-sm ${
            posture.impairments_without_deviation > 0 || breached > 0
              ? "border-rose-500/30 bg-rose-500/5 text-rose-100"
              : "border-white/6 bg-white/2 text-slate-300"
          }`}
        >
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>{posture.basis}</p>
        </div>
      )}

      {/* SIL verification. */}
      {sifVerdicts.length > 0 && (
        <div className="rounded-xl border border-white/6 p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
            <Activity className="h-4 w-4 text-signal-cyan" aria-hidden />
            Safety-instrumented functions
          </h3>
          <ul className="mt-2 space-y-2">
            {sifVerdicts.map((v) => (
              <li
                key={v.tag}
                className={`rounded-lg border p-3 text-sm ${
                  v.meetsTarget
                    ? "border-white/6"
                    : "border-rose-500/25 bg-rose-500/5"
                }`}
              >
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-mono text-xs text-slate-200">
                    {v.tag}
                  </span>
                  <span className="text-xs text-slate-500">
                    target SIL {v.targetSil}
                  </span>
                  <span
                    className={`font-mono text-xs ${v.meetsTarget ? "text-signal-cyan" : "text-rose-300"}`}
                  >
                    achieved SIL {v.achievedSil ?? "unknown"}
                  </span>
                  {v.overdueMonths > 0 && (
                    <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-xs text-amber-300">
                      {v.overdueMonths.toFixed(1)} mo overdue
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs leading-relaxed text-slate-400">
                  {v.reason}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Barriers per hazard. */}
      {barrierVerdicts.map((b) => (
        <div key={b.hazard} className="rounded-xl border border-white/6 p-4">
          <h3 className="text-sm font-semibold text-white">{b.hazard}</h3>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">
            {b.reason}
          </p>
          {b.sharedCause.length > 0 && (
            <ul className="mt-2 space-y-1">
              {b.sharedCause.map((s) => (
                <li
                  key={s.group}
                  className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-2 text-xs text-amber-200"
                >
                  {s.group}: {s.barriers.join(" · ")}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}

      {/* Alarms. */}
      {alarm && (
        <div className="rounded-xl border border-white/6 p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
            <Siren className="h-4 w-4 text-amber-400" aria-hidden />
            {alarm.label}
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">
            {alarm.verdict.reason}
          </p>
        </div>
      )}
    </section>
  );
}
