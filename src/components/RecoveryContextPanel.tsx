import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Activity,
  ArrowUpRight,
  Clock3,
  DollarSign,
  PackageCheck,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import {
  getRecoveryPlatformContext,
  type RecoveryContextSurface,
  type RecoveryPlatformContext,
} from "../services/recoveryPlatformContextService";

interface RecoveryContextPanelProps {
  surface: RecoveryContextSurface;
  workOrderId?: string | null;
  assetId?: string | null;
}

function dateTime(value: string | null | undefined) {
  if (!value) return "not available";
  return new Date(value).toLocaleString();
}

function hours(value: number | null | undefined) {
  return value == null ? "not quantified" : `${Number(value).toFixed(1)} h`;
}

function money(value: number | null | undefined) {
  return value == null
    ? "not computable"
    : new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(value);
}

function statusTone(status: string) {
  if (["released", "executing", "accepted", "complete", "closed"].includes(status)) {
    return "border-emerald-500/25 bg-emerald-500/8 text-emerald-200";
  }
  if (["approval", "planning", "returned", "open"].includes(status)) {
    return "border-amber-500/25 bg-amber-500/8 text-amber-200";
  }
  return "border-white/10 bg-white/4 text-slate-300";
}

export function RecoveryContextPanel({
  surface,
  workOrderId,
  assetId,
}: RecoveryContextPanelProps) {
  const navigate = useNavigate();
  const [data, setData] = useState<RecoveryPlatformContext | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setError(null);
    void getRecoveryPlatformContext(surface, { workOrderId, assetId })
      .then((next) => {
        if (live) setData(next);
      })
      .catch((cause) => {
        if (live) setError(cause instanceof Error ? cause.message : "Recovery context unavailable");
      });
    return () => {
      live = false;
    };
  }, [surface, workOrderId, assetId]);

  const relevant = useMemo(() => {
    if (!data) return false;
    switch (surface) {
      case "work_order":
        return Boolean(data.work_order_context);
      case "materials":
        return data.material_impacts.length > 0;
      case "scheduling":
        return data.schedule_commitments.length > 0;
      case "handover":
        return data.handover_impacts.length > 0;
      case "reliability":
      case "learning":
      case "value":
        return data.active_events.length > 0 || data.recent_closed_events.length > 0;
      default:
        return data.active_events.length > 0;
    }
  }, [data, surface]);

  if (error) {
    return (
      <aside className="mx-6 mt-6 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-xs text-amber-100/80">
        Recovery context could not be loaded. This page remains on its canonical module truth; no fallback write path is used.
      </aside>
    );
  }
  if (!data || !relevant) return null;

  const work = data.work_order_context;

  return (
    <aside
      aria-label="Sync Recovery context"
      className="mx-6 mt-6 rounded-2xl border border-teal-500/20 bg-teal-500/5 p-4 shadow-[0_12px_40px_rgba(0,0,0,0.12)]"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-teal-100">
            <Activity className="h-4 w-4 text-teal-300" aria-hidden />
            Sync Recovery context
          </div>
          <p className="mt-1 max-w-4xl text-xs leading-5 text-slate-400">
            Recovery coordinates the restoration event here; this module remains the authority for its own operational truth.
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate("/recovery")}
          className="inline-flex items-center gap-1.5 rounded-lg border border-teal-500/25 bg-teal-500/10 px-3 py-1.5 text-xs font-medium text-teal-200 hover:bg-teal-500/15"
        >
          Open Sync Recovery
          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>

      {surface === "work_order" && work && (
        <div className="mt-3 grid gap-2 lg:grid-cols-4">
          <ContextMetric label="Event" value={work.event_code} detail={work.event_status} />
          <ContextMetric
            label="Restoration sequence"
            value={`#${work.sequence_no}`}
            detail={
              work.concurrency_rule === "verified_parallel"
                ? `verified parallel${work.parallel_group ? ` · ${work.parallel_group}` : ""}`
                : work.concurrency_rule.replaceAll("_", " ")
            }
          />
          <ContextMetric label="Execution" value={work.execution_status.replaceAll("_", " ")} detail={`plan v${work.latest_plan_version ?? "—"} · ${work.latest_plan_status ?? "not generated"}`} />
          <ContextMetric label="P80 RTS" value={dateTime(work.forecast_p80_return_at)} detail={`forecast ${dateTime(work.forecast_return_at)}`} />
        </div>
      )}

      {surface === "materials" && (
        <div className="mt-3 space-y-2">
          {data.material_impacts.slice(0, 6).map((impact) => (
            <div key={`${impact.event_id}:${impact.work_order_id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-white/7 bg-black/10 px-3 py-2.5 text-xs">
              <PackageCheck className="h-4 w-4 text-amber-300" aria-hidden />
              <span className="font-semibold text-slate-200">{impact.event_code}</span>
              <span className="text-slate-300">{impact.wo_number ?? impact.work_order_id.slice(0, 8)} · {impact.title}</span>
              <span className="text-amber-200">{impact.short_lines} short · {impact.requested_lines} unassessed</span>
              <span className="ml-auto text-slate-400">
                RTS impact: {impact.recorded_rts_impact_hours == null ? "not quantified" : hours(impact.recorded_rts_impact_hours)}
              </span>
            </div>
          ))}
        </div>
      )}

      {surface === "scheduling" && (
        <div className="mt-3">
          <div className="mb-2 flex items-center gap-2 text-xs text-slate-300">
            <Clock3 className="h-4 w-4 text-teal-300" aria-hidden />
            {data.schedule_commitments.length} active Recovery work commitment{data.schedule_commitments.length === 1 ? "" : "s"}. Weekly options must acknowledge omissions; Recovery remains authoritative for event sequence and verified concurrency.
          </div>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {data.schedule_commitments.slice(0, 6).map((item) => (
              <div key={item.work_order_id} className="rounded-xl border border-white/7 bg-black/10 px-3 py-2.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-200">{item.event_code}</span>
                  <span className="text-slate-500">sequence {item.sequence_no}</span>
                </div>
                <div className="mt-1 truncate text-slate-300">{item.wo_number ?? item.work_order_id.slice(0, 8)} · {item.title}</div>
                <div className="mt-1 text-slate-500">
                  {item.duration_basis === "not_sized"
                    ? "duration not sized"
                    : `${hours(item.planned_hours ?? item.estimated_hours)} · ${item.duration_basis.replaceAll("_", " ")}`}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {surface === "handover" && (
        <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {data.handover_impacts.map((item) => (
            <div key={item.release_id} className="rounded-xl border border-white/7 bg-black/10 px-3 py-2.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-slate-200">{item.event_code} · {item.asset}</span>
                <span className={`rounded-full border px-2 py-0.5 ${statusTone(item.release_status)}`}>{item.release_status}</span>
              </div>
              <div className="mt-1 text-slate-400">
                {item.isolation_confirmed ? "Isolation confirmed" : "Isolation not recorded"}
                {item.awaiting_operations_acceptance ? " · awaiting Operations acceptance" : " · in Maintenance custody"}
              </div>
            </div>
          ))}
        </div>
      )}

      {surface === "mission" && <ActiveEventGrid data={data} />}

      {(surface === "reliability" || surface === "learning") && (
        <div className="mt-3 grid gap-2 lg:grid-cols-2">
          {data.recent_closed_events.slice(0, 4).map((event) => (
            <div key={event.event_id} className="rounded-xl border border-white/7 bg-black/10 px-3 py-2.5 text-xs">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-emerald-300" aria-hidden />
                <span className="font-semibold text-slate-200">{event.event_code} · {event.asset}</span>
              </div>
              <div className="mt-1 text-slate-400">
                Actual RTS {dateTime(event.actual_return_at)} · counterfactual recovered hours {hours(event.counterfactual_hours_recovered)}
              </div>
              <div className="mt-1 text-slate-500">
                Feed recurrence, delay and first-time-right learning from the recorded event evidence; do not infer causality from the counterfactual alone.
              </div>
            </div>
          ))}
          {data.recent_closed_events.length === 0 && <ActiveEventGrid data={data} />}
        </div>
      )}

      {surface === "value" && (
        <div className="mt-3 grid gap-2 lg:grid-cols-2">
          {data.recent_closed_events.slice(0, 4).map((event) => (
            <div key={event.event_id} className="rounded-xl border border-white/7 bg-black/10 px-3 py-2.5 text-xs">
              <div className="flex items-center gap-2 text-slate-200">
                <DollarSign className="h-4 w-4 text-emerald-300" aria-hidden />
                <span className="font-semibold">{event.event_code} · {event.asset}</span>
              </div>
              <div className="mt-1 text-slate-300">Recovered hours: {hours(event.counterfactual_hours_recovered)}</div>
              <div className="mt-1 text-slate-400">Projected value: {money(event.projected_downtime_value_usd)} · {event.value_status.replaceAll("_", " ")}</div>
            </div>
          ))}
          {data.recent_closed_events.length === 0 && <ActiveEventGrid data={data} />}
        </div>
      )}
    </aside>
  );
}

function ContextMetric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-xl border border-white/7 bg-black/10 px-3 py-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-semibold text-slate-200">{value}</div>
      <div className="mt-0.5 text-[11px] text-slate-500">{detail}</div>
    </div>
  );
}

function ActiveEventGrid({ data }: { data: RecoveryPlatformContext }) {
  return (
    <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
      {data.active_events.slice(0, 6).map((event) => (
        <div key={event.event_id} className="rounded-xl border border-white/7 bg-black/10 px-3 py-2.5 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-slate-200">{event.event_code} · {event.asset}</span>
            <span className={`rounded-full border px-2 py-0.5 ${statusTone(event.status)}`}>{event.status}</span>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-slate-400">
            <span>P80 RTS {dateTime(event.forecast_p80_return_at)}</span>
            <span>{event.open_blockers} open blocker{event.open_blockers === 1 ? "" : "s"}</span>
          </div>
          {(event.critical_open_blockers > 0 || event.projected_hours_recovered != null) && (
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
              {event.critical_open_blockers > 0 && (
                <span className="inline-flex items-center gap-1 text-red-300">
                  <TriangleAlert className="h-3 w-3" aria-hidden />
                  {event.critical_open_blockers} critical blocker{event.critical_open_blockers === 1 ? "" : "s"}
                </span>
              )}
              {event.projected_hours_recovered != null && (
                <span className="text-teal-200">projected recovery {hours(event.projected_hours_recovered)}</span>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
