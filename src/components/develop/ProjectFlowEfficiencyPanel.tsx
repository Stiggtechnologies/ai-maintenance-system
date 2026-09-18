import { useCallback, useEffect, useState } from "react";
import { Activity, CircleAlert, Clock3 } from "lucide-react";
import {
  getProjectFlowEfficiency,
  type ProjectFlowEfficiency,
} from "../../services/projectFlowEfficiencyService";

function hours(value: number) {
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} h`;
}

export function ProjectFlowEfficiencyPanel({ caseId }: { caseId: string }) {
  const [flow, setFlow] = useState<ProjectFlowEfficiency | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setFlow(await getProjectFlowEfficiency(caseId));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not calculate project flow efficiency");
    }
  }, [caseId]);

  useEffect(() => void load(), [load]);

  return (
    <section className="rounded-xl border border-white/6 bg-[#0D1520] p-5" aria-labelledby="project-flow-title">
      <div className="flex items-start gap-2">
        <Activity className="mt-0.5 h-4 w-4 text-signal-cyan" aria-hidden />
        <div>
          <h2 id="project-flow-title" className="text-sm font-semibold text-slate-100">Project flow efficiency</h2>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-400">
            Active value-adding time divided by total elapsed time for work orders on assets in this Development Case. Waiting includes pending, approval, scheduled, blocked, and critical states.
          </p>
        </div>
      </div>

      {error && <p className="mt-3 text-xs text-rose-300">{error}</p>}

      {flow && !flow.computable && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-400/20 bg-amber-400/5 px-3 py-2.5 text-xs text-amber-200">
          <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          Flow efficiency is not computable yet. No linked work order has complete, internally consistent status-transition evidence.
        </div>
      )}

      {flow?.computable && (
        <>
          <div className="mt-4 grid gap-2 sm:grid-cols-4">
            <div className="rounded-lg border border-white/6 bg-black/10 p-3">
              <div className="text-[11px] uppercase tracking-wide text-slate-500">Flow efficiency</div>
              <div className="mt-1 text-xl font-semibold text-signal-cyan">{flow.flowEfficiencyPct?.toFixed(2)}%</div>
            </div>
            <div className="rounded-lg border border-white/6 bg-black/10 p-3">
              <div className="text-[11px] uppercase tracking-wide text-slate-500">Active</div>
              <div className="mt-1 text-sm font-semibold text-slate-200">{hours(flow.activeHours)}</div>
            </div>
            <div className="rounded-lg border border-white/6 bg-black/10 p-3">
              <div className="text-[11px] uppercase tracking-wide text-slate-500">Waiting</div>
              <div className="mt-1 text-sm font-semibold text-slate-200">{hours(flow.waitingHours)}</div>
            </div>
            <div className="rounded-lg border border-white/6 bg-black/10 p-3">
              <div className="text-[11px] uppercase tracking-wide text-slate-500">Evidence coverage</div>
              <div className="mt-1 text-sm font-semibold text-slate-200">{flow.measuredWorkOrders}/{flow.eligibleWorkOrders} work orders</div>
            </div>
          </div>

          <div className="mt-3 space-y-2">
            {flow.workOrders.map((workOrder) => (
              <article key={workOrder.workOrderId} className="rounded-lg border border-white/6 bg-white/[0.02] px-3 py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs font-medium text-slate-200">{workOrder.workOrderNumber ?? "Unnumbered work order"} · {workOrder.title}</div>
                  <div className="text-xs text-signal-cyan">{workOrder.flowEfficiencyPct?.toFixed(2)}%</div>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-slate-500">
                  <span>{hours(workOrder.activeHours)} active</span>
                  <span>{hours(workOrder.waitingHours)} waiting</span>
                  <span>{workOrder.transitionCount} evidenced transitions</span>
                </div>
              </article>
            ))}
          </div>
        </>
      )}

      {flow && flow.exclusions.length > 0 && (
        <details className="mt-3 rounded-lg border border-amber-400/15 bg-amber-400/[0.03] px-3 py-2 text-xs text-amber-100">
          <summary className="cursor-pointer">{flow.exclusions.length} work order{flow.exclusions.length === 1 ? "" : "s"} excluded for incomplete evidence</summary>
          <ul className="mt-2 space-y-1 text-amber-100/80">
            {flow.exclusions.map((item) => <li key={item.workOrderId}>{item.workOrderNumber ?? item.workOrderId}: {item.reason}</li>)}
          </ul>
        </details>
      )}

      {flow && (
        <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-slate-500">
          <Clock3 className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          Calculated from canonical work orders and their status-history timestamps at {new Date(flow.asOf).toLocaleString()}. It is decision support, not an approval or productivity score.
        </p>
      )}
    </section>
  );
}
