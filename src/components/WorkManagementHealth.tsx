/**
 * WorkManagementHealth — the work-management health family
 * (capability register C6.07–C6.16).
 *
 * Spec §6 keeps this family separate from enterprise outcomes and reliability
 * performance so that optimizing one metric cannot quietly damage another.
 *
 * Metrics the platform cannot yet compute are shown as "not measurable yet"
 * with the reason, never as a zero. An executive must be able to tell "we are
 * at zero" from "we cannot see this".
 */
import { CircleGauge, Info } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import { supabase } from "../lib/supabase";
import { LoadingState, ErrorState } from "./ui/AsyncStates";

interface Metric {
  key: string;
  label: string;
  register_ref: string;
  available: boolean;
  value: number | null;
  unit: string;
  basis: string;
}

interface Health {
  work_orders_in_window: number;
  open_work_orders: number;
  window_source?: string;
  metrics: Metric[];
}

export function WorkManagementHealth() {
  const { data, loading, error, refetch } = useAsyncData<Health>(async () => {
    const { data: r, error: e } = await supabase.rpc(
      "get_work_management_health",
      {},
    );
    if (e) throw new Error(e.message);
    return r as Health;
  }, []);

  if (loading) return <LoadingState label="Computing work-management health" />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;
  const metrics = data?.metrics ?? [];
  const measurable = metrics.filter((m) => m.available);
  const pending = metrics.filter((m) => !m.available);

  return (
    <section aria-labelledby="wm-health-heading" className="space-y-4">
      <div>
        <h2
          id="wm-health-heading"
          className="flex items-center gap-2 text-lg font-semibold text-white"
        >
          <CircleGauge className="h-5 w-5 text-signal-cyan" aria-hidden />
          Work-Management Health
          <span className="text-xs font-normal text-slate-500">
            {measurable.length}/{metrics.length} measurable
          </span>
        </h2>
        <p className="mt-1 text-sm text-slate-300">
          Balanced against reliability and enterprise outcomes, so improving
          one metric cannot quietly damage another. Computed from{" "}
          {data?.work_orders_in_window?.toLocaleString()} work orders;{" "}
          {data?.open_work_orders} open.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {measurable.map((m) => (
          <div
            key={m.key}
            className="rounded-xl border border-white/6 bg-overlook-deep/40 p-4"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                {m.label}
              </p>
              <span className="font-mono text-[10px] text-slate-600">
                {m.register_ref}
              </span>
            </div>
            <p className="mt-1.5 font-mono text-2xl text-slate-100">
              {m.value}
              <span className="ml-1 text-sm text-slate-500">
                {m.unit === "%" ? "%" : ` ${m.unit}`}
              </span>
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
              {m.basis}
            </p>
          </div>
        ))}
      </div>

      {pending.length > 0 && (
        <div className="rounded-xl border border-white/6 bg-white/2 p-4">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
            <Info className="h-3.5 w-3.5" aria-hidden />
            Not measurable yet — {pending.length}
          </h3>
          <ul className="mt-2 space-y-1.5">
            {pending.map((m) => (
              <li key={m.key} className="text-xs text-slate-500">
                <span className="text-slate-300">{m.label}</span> — {m.basis}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
