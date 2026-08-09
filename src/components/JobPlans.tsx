/**
 * JobPlans — executable job plans and planning accuracy
 * (capability register C8.07, C6.14).
 *
 * The spec is explicit about what makes a job plan executable rather than a
 * title: scope, sequence, labour, duration, materials, tools, permits,
 * isolations, quality checks and acceptance criteria. All ten are modelled, and
 * two rules are enforced in the database rather than suggested here:
 *
 *   * a plan cannot be ADOPTED without at least one acceptance criterion — a
 *     plan whose completion cannot be verified is a to-do list;
 *   * only an ADOPTED plan can be applied to real work.
 *
 * Planning accuracy shows absolute error AND bias, never one average. A job
 * estimated at 4 h that took 8 and one estimated at 8 h that took 4 average to
 * zero variance — perfect-looking planning, two wrecked shifts.
 */
import { ClipboardList, ShieldAlert, Target } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import { supabase } from "../lib/supabase";
import { LoadingState, ErrorState } from "./ui/AsyncStates";

interface Plan {
  id: string;
  plan_key: string;
  title: string;
  scope: string;
  applies_to: string;
  status: "draft" | "adopted";
  version: number;
  steps: number;
  estimated_hours: number;
  materials: number;
  tools: number;
  permits: number;
  checks: number;
  applied_to_work_orders: number;
}

interface Accuracy {
  available: boolean;
  sample: number;
  mean_absolute_error_pct: number | null;
  bias_pct: number | null;
  within_10_pct: number | null;
  bias_reading: string | null;
  basis: string;
}

export function JobPlans() {
  const plans = useAsyncData<{ plans: Plan[]; note: string }>(async () => {
    const { data, error } = await supabase.rpc("get_job_plans", {});
    if (error) throw new Error(error.message);
    return data as { plans: Plan[]; note: string };
  }, []);

  const acc = useAsyncData<Accuracy>(async () => {
    const { data, error } = await supabase.rpc("get_planning_accuracy", {});
    if (error) throw new Error(error.message);
    return data as Accuracy;
  }, []);

  if (plans.loading || acc.loading)
    return <LoadingState label="Loading job plans" />;
  if (plans.error)
    return <ErrorState message={plans.error} onRetry={plans.refetch} />;

  const list = plans.data?.plans ?? [];
  const adopted = list.filter((p) => p.status === "adopted").length;
  const a = acc.data;

  return (
    <section aria-labelledby="jobplans-heading" className="space-y-4">
      <div>
        <h2
          id="jobplans-heading"
          className="flex items-center gap-2 text-lg font-semibold text-white"
        >
          <ClipboardList className="h-5 w-5 text-signal-cyan" aria-hidden />
          Job Plans
          <span className="text-xs font-normal text-slate-500">
            {adopted} adopted of {list.length}
          </span>
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-300">
          {plans.data?.note}
        </p>
      </div>

      <div className="rounded-xl border border-white/6 bg-overlook-deep/40 p-4">
        <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-slate-400">
          <Target className="h-3.5 w-3.5" aria-hidden />
          Planning accuracy
        </p>
        {a?.available ? (
          <>
            <div className="mt-2 flex flex-wrap items-baseline gap-x-6 gap-y-1">
              <span className="font-mono text-2xl text-slate-100">
                {a.mean_absolute_error_pct}
                <span className="ml-1 text-sm text-slate-500">
                  % mean absolute error
                </span>
              </span>
              <span
                className={`font-mono text-lg ${Math.abs(a.bias_pct ?? 0) > 10 ? "text-amber-300" : "text-slate-300"}`}
              >
                {(a.bias_pct ?? 0) > 0 ? "+" : ""}
                {a.bias_pct}
                <span className="ml-1 text-xs text-slate-500">% bias</span>
              </span>
              <span className="font-mono text-sm text-slate-400">
                {a.within_10_pct}%
                <span className="ml-1 text-xs text-slate-500">within ±10%</span>
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-400">{a.bias_reading}</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              Error and bias are shown separately on purpose: a job estimated at
              4 h that took 8, and one estimated at 8 h that took 4, average to
              zero variance — perfect-looking planning and two wrecked shifts.
            </p>
          </>
        ) : (
          <p className="mt-1.5 text-sm text-slate-400">{a?.basis}</p>
        )}
      </div>

      {list.length === 0 ? (
        <p className="rounded-xl border border-white/6 bg-white/2 p-4 text-sm text-slate-400">
          No job plan has been authored. A plan carries scope, sequence, labour,
          duration, materials, tools, permits, isolations and acceptance
          criteria — the last of which is what makes it verifiable.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/6">
          <table className="w-full min-w-[50rem] text-left text-sm">
            <caption className="sr-only">
              Job plans with their content and adoption state
            </caption>
            <thead className="bg-white/2 text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">
                  Plan
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Applies to
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Steps
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Hours
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Content
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Used
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  State
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.id} className="border-t border-white/6 align-top">
                  <td className="px-4 py-2.5">
                    <p className="text-slate-200">{p.title}</p>
                    <p className="font-mono text-[11px] text-slate-500">
                      {p.plan_key} v{p.version}
                    </p>
                  </td>
                  <td className="px-4 py-2.5 text-slate-400">{p.applies_to}</td>
                  <td className="px-4 py-2.5 font-mono text-slate-300 tabular-nums">
                    {p.steps}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-slate-300 tabular-nums">
                    {p.estimated_hours}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-400">
                    {p.materials}m · {p.tools}t ·{" "}
                    {p.permits > 0 ? (
                      <span className="inline-flex items-center gap-0.5 text-amber-300">
                        <ShieldAlert className="h-3 w-3" aria-hidden />
                        {p.permits} permit{p.permits > 1 ? "s" : ""}
                      </span>
                    ) : (
                      "no permit"
                    )}{" "}
                    ·{" "}
                    <span className={p.checks === 0 ? "text-red-300" : ""}>
                      {p.checks} check{p.checks === 1 ? "" : "s"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-slate-300 tabular-nums">
                    {p.applied_to_work_orders}
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs ${
                        p.status === "adopted"
                          ? "border-green-500/30 bg-green-500/10 text-green-300"
                          : "border-amber-500/30 bg-amber-500/10 text-amber-300"
                      }`}
                    >
                      {p.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
