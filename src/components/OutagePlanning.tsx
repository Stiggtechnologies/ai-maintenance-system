/**
 * OutagePlanning — shutdown and turnaround windows
 * (capability register C1.09, C8.08).
 *
 * The number this panel exists to surface is LATE ADDITIONS. Work added after
 * an outage work list is frozen is the single most reliable predictor of that
 * outage overrunning, and a scope that grows invisibly cannot be defended
 * afterwards. So late additions are counted separately, permanently, and
 * demand a written justification at the moment they are added.
 *
 * Unplanned hours are shown for the same reason: an outage whose work orders
 * carry no job plan has no defensible duration, only a hope.
 */
import { CalendarRange, GitPullRequestArrow, Users } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import { supabase } from "../lib/supabase";
import { LoadingState, ErrorState } from "./ui/AsyncStates";

interface Window {
  window_key: string;
  title: string;
  kind: string;
  starts_at: string;
  ends_at: string;
  status: string;
  duration_hours: number;
  work_orders: number;
  late_additions: number;
  planned_hours: number;
  hours_unplanned: number;
}

interface Payload {
  windows: Window[];
  craft_capacity_recorded: number;
  note: string;
}

const STATUS_STYLE: Record<string, string> = {
  planned: "border-slate-600 bg-slate-800/60 text-slate-300",
  frozen: "border-signal-gold/30 bg-signal-gold/10 text-signal-gold",
  executing: "border-signal-cyan/30 bg-signal-cyan/10 text-signal-cyan",
  closed: "border-green-500/30 bg-green-500/10 text-green-300",
};

export function OutagePlanning() {
  const { data, loading, error, refetch } = useAsyncData<Payload>(async () => {
    const { data: r, error: e } = await supabase.rpc("get_outage_position", {});
    if (e) throw new Error(e.message);
    return r as Payload;
  }, []);

  if (loading) return <LoadingState label="Loading outage windows" />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  const windows = data?.windows ?? [];
  const capacity = data?.craft_capacity_recorded ?? 0;

  return (
    <section aria-labelledby="outage-heading" className="space-y-4">
      <div>
        <h2
          id="outage-heading"
          className="flex items-center gap-2 text-lg font-semibold text-white"
        >
          <CalendarRange className="h-5 w-5 text-signal-gold" aria-hidden />
          Shutdowns & Turnarounds
          <span className="text-xs font-normal text-slate-500">
            {windows.length} window{windows.length === 1 ? "" : "s"}
          </span>
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-300">{data?.note}</p>
      </div>

      {capacity === 0 && (
        <p className="flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/5 p-3 text-xs leading-relaxed text-amber-200/90">
          <Users className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            No craft capacity is recorded, so the labour constraint on schedule
            release reports <strong>not assessable</strong> rather than a
            number. Capacity is deliberately not inferred from headcount — a
            fabricated figure would silently authorise an unachievable week.
          </span>
        </p>
      )}

      {windows.length === 0 ? (
        <p className="rounded-xl border border-white/6 bg-white/2 p-4 text-sm text-slate-400">
          No outage window is planned. A window freezes its work list; anything
          added afterwards is recorded as a late addition with a justification,
          rather than absorbed into the scope.
        </p>
      ) : (
        <ul className="space-y-2">
          {windows.map((w) => (
            <li
              key={w.window_key}
              className="rounded-xl border border-white/6 bg-overlook-deep/40 p-4"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <p className="font-medium text-slate-200">{w.title}</p>
                  <p className="text-xs text-slate-500">
                    {w.kind} · {new Date(w.starts_at).toLocaleDateString()} –{" "}
                    {new Date(w.ends_at).toLocaleDateString()} ·{" "}
                    {w.duration_hours} h window
                  </p>
                </div>
                <span
                  className={`rounded-full border px-2 py-0.5 text-xs ${STATUS_STYLE[w.status] ?? ""}`}
                >
                  {w.status}
                </span>
              </div>

              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Work orders</dt>
                  <dd className="font-mono text-slate-300 tabular-nums">
                    {w.work_orders}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Planned hours</dt>
                  <dd className="font-mono text-slate-300 tabular-nums">
                    {w.planned_hours}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">No job plan</dt>
                  <dd
                    className={`font-mono tabular-nums ${w.hours_unplanned > 0 ? "text-amber-300" : "text-slate-300"}`}
                  >
                    {w.hours_unplanned}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="flex items-center gap-1 text-slate-500">
                    <GitPullRequestArrow className="h-3 w-3" aria-hidden />
                    Late additions
                  </dt>
                  <dd
                    className={`font-mono tabular-nums ${w.late_additions > 0 ? "text-red-300" : "text-slate-300"}`}
                  >
                    {w.late_additions}
                  </dd>
                </div>
              </dl>

              {w.hours_unplanned > 0 && (
                <p className="mt-1.5 text-xs text-slate-500">
                  {w.hours_unplanned} work order
                  {w.hours_unplanned > 1 ? "s" : ""} carry no job plan, so this
                  outage has no defensible duration for that scope.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
