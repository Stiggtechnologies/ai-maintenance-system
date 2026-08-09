/**
 * SchedulerPanel — weekly schedule options with human release and frozen-
 * schedule control (capability register C1.05, C5.04).
 *
 * Generation is auto-permitted by the decision-rights matrix (and consults it
 * live, server-side); releasing — the act that freezes the week — is reserved
 * for planner/manager authority. Options are deterministic: three strategies
 * greedily leveled against stated daily capacity.
 *
 * Release now passes through a feasibility check (C8.08). HARD constraints —
 * an un-cleared safety gate, an outstanding approval — refuse the release and
 * cannot be acknowledged away. SOFT constraints — material shortages, labour
 * over-commitment — are shown and require the planner to release with explicit
 * acknowledgement, so a known shortage is never waved through silently.
 */
import { useState } from "react";
import {
  CalendarClock,
  Lock,
  Sparkles,
  ShieldX,
  AlertTriangle,
} from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import { supabase } from "../lib/supabase";
import { useAuth } from "./AuthProvider";
import { LoadingState, ErrorState, EmptyState } from "./ui/AsyncStates";

interface ScheduleItem {
  wo_number: string;
  title: string;
  tag: string | null;
  priority: string;
  hours: number;
  day: number;
}

interface ScheduleOption {
  id: string;
  week_start: string;
  label: string;
  strategy: string;
  items: ScheduleItem[];
  total_hours: number;
  capacity_hours: number;
  status: "draft" | "released" | "discarded";
  released_at: string | null;
}

async function getOptions(): Promise<ScheduleOption[]> {
  const { data, error } = await supabase
    .from("schedule_options")
    .select(
      "id, week_start, label, strategy, items, total_hours, capacity_hours, status, released_at",
    )
    .neq("status", "discarded")
    .order("week_start", { ascending: false })
    .order("label")
    .limit(9);
  if (error) throw new Error(error.message);
  return (data ?? []) as ScheduleOption[];
}

interface FeasibilityCheck {
  constraint: string;
  severity: "blocking" | "warning";
  passed: boolean | null;
  detail: string;
}

interface Feasibility {
  blocking_failures: number;
  warnings: number;
  releasable: boolean;
  checks: FeasibilityCheck[];
}

const RELEASE_ROLES = new Set([
  "planner",
  "maintenance_manager",
  "admin",
  "ai_admin",
]);
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

export function SchedulerPanel() {
  const { profile } = useAuth();
  const { data, loading, error, refetch } = useAsyncData<ScheduleOption[]>(
    getOptions,
    [],
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const canRelease = RELEASE_ROLES.has((profile?.role as string) ?? "");

  const act = async (fn: () => Promise<{ error?: string } | void>) => {
    setBusy(true);
    setMessage(null);
    try {
      const r = await fn();
      if (r && "error" in r && r.error) setMessage(r.error);
      refetch();
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <LoadingState label="Loading schedule options" />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;
  const options = data ?? [];
  const released = options.find((o) => o.status === "released");

  return (
    <section aria-labelledby="scheduler-heading" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2
            id="scheduler-heading"
            className="flex items-center gap-2 text-lg font-semibold text-white"
          >
            <CalendarClock className="h-5 w-5 text-signal-cyan" aria-hidden />
            Weekly Schedule Options
          </h2>
          <p className="mt-1 text-sm text-slate-300">
            Deterministic candidates from the open backlog — generation is
            auto-permitted by the decision-rights matrix (consulted live);
            releasing freezes the week and requires planner or manager
            authority.
          </p>
        </div>
        <button
          disabled={busy}
          onClick={() =>
            act(async () => {
              const { data: r } = await supabase.rpc(
                "generate_schedule_options",
                {},
              );
              return r as { error?: string };
            })
          }
          className="inline-flex items-center gap-2 rounded-lg bg-signal-gold px-3 py-2 text-sm font-medium text-overlook-void hover:bg-signal-gold-soft disabled:opacity-40 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-signal-gold"
        >
          <Sparkles className="h-4 w-4" aria-hidden />
          Generate options
        </button>
      </div>

      {message && (
        <p className="rounded-lg border border-signal-gold/30 bg-signal-gold/10 px-3 py-2 text-sm text-signal-gold">
          {message}
        </p>
      )}

      {options.length === 0 ? (
        <EmptyState message="No schedule options yet — generate candidates from the open backlog." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {options.map((o) => (
            <div
              key={o.id}
              className={`rounded-xl border p-4 ${
                o.status === "released"
                  ? "border-signal-gold/40 bg-signal-gold/5"
                  : "border-white/6 bg-overlook-deep/40"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-200">
                  {o.label}
                </h3>
                {o.status === "released" ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-signal-gold/40 bg-signal-gold/10 px-2 py-0.5 text-xs text-signal-gold">
                    <Lock className="h-3 w-3" aria-hidden /> released · frozen
                  </span>
                ) : (
                  <span className="rounded-full border border-white/10 px-2 py-0.5 text-xs text-slate-400">
                    draft
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Week of {o.week_start} · {o.strategy}
              </p>
              <p className="mt-1 font-mono text-xs text-slate-400">
                {Number(o.total_hours).toFixed(1)} h scheduled ·{" "}
                {Number(o.capacity_hours).toFixed(0)} h/day capacity
              </p>
              <ul className="mt-3 space-y-1.5">
                {o.items.slice(0, 6).map((it) => (
                  <li
                    key={it.wo_number}
                    className="flex items-center gap-2 text-xs"
                  >
                    <span className="w-9 shrink-0 font-mono text-signal-cyan">
                      {DAYS[it.day - 1] ?? `D${it.day}`}
                    </span>
                    <span className="truncate text-slate-300">
                      {it.wo_number} — {it.title}
                    </span>
                    <span className="ml-auto shrink-0 font-mono text-slate-500">
                      {Number(it.hours).toFixed(0)}h
                    </span>
                  </li>
                ))}
                {o.items.length > 6 && (
                  <li className="text-xs text-slate-600">
                    +{o.items.length - 6} more
                  </li>
                )}
              </ul>
              {o.status === "draft" && canRelease && !released && (
                <ReleaseControl optionId={o.id} busy={busy} act={act} />
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * The release control does the feasibility check BEFORE offering the button,
 * so a planner sees why a week cannot be frozen rather than clicking into an
 * error. Blocking failures remove the button entirely — there is nothing to
 * acknowledge, the constraint has to be fixed.
 */
function ReleaseControl({
  optionId,
  busy,
  act,
}: {
  optionId: string;
  busy: boolean;
  act: (fn: () => Promise<{ error?: string }>) => void;
}) {
  const [f, setF] = useState<Feasibility | null>(null);
  const [checking, setChecking] = useState(false);

  async function check() {
    setChecking(true);
    const { data } = await supabase.rpc("evaluate_schedule_feasibility", {
      p_option_id: optionId,
    });
    setChecking(false);
    setF(data as Feasibility);
  }

  if (!f) {
    return (
      <button
        disabled={checking}
        onClick={check}
        className="mt-3 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-white/10 disabled:opacity-40 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-signal-cyan"
      >
        {checking ? "Checking constraints…" : "Check constraints to release"}
      </button>
    );
  }

  const blockers = f.checks.filter(
    (c) => c.severity === "blocking" && c.passed === false,
  );
  const warnings = f.checks.filter(
    (c) => c.severity === "warning" && c.passed === false,
  );

  return (
    <div className="mt-3 space-y-2">
      {blockers.map((c) => (
        <p
          key={c.constraint}
          className="flex items-start gap-1.5 rounded-lg border border-red-500/30 bg-red-500/5 p-2 text-[11px] leading-relaxed text-red-200"
        >
          <ShieldX className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          <span>
            <strong>{c.constraint}:</strong> {c.detail}
          </span>
        </p>
      ))}
      {warnings.map((c) => (
        <p
          key={c.constraint}
          className="flex items-start gap-1.5 rounded-lg border border-amber-500/25 bg-amber-500/5 p-2 text-[11px] leading-relaxed text-amber-200/90"
        >
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          <span>
            <strong>{c.constraint}:</strong> {c.detail}
          </span>
        </p>
      ))}

      {f.releasable ? (
        <button
          disabled={busy}
          onClick={() =>
            act(async () => {
              const { data: r } = await supabase.rpc(
                "release_schedule_option",
                { p_id: optionId, p_acknowledge_warnings: true },
              );
              return r as { error?: string };
            })
          }
          className="w-full rounded-lg border border-signal-gold/40 bg-signal-gold/10 px-3 py-1.5 text-xs font-medium text-signal-gold hover:bg-signal-gold/20 disabled:opacity-40 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-signal-gold"
        >
          {warnings.length > 0
            ? `Acknowledge ${warnings.length} warning${warnings.length > 1 ? "s" : ""} & freeze week`
            : "Release & freeze week"}
        </button>
      ) : (
        <p className="text-[11px] text-slate-500">
          {f.blocking_failures} hard constraint
          {f.blocking_failures > 1 ? "s" : ""} must be resolved before this week
          can be frozen. These cannot be acknowledged away.
        </p>
      )}
    </div>
  );
}
