/**
 * WorkforceReadiness — the constraints hours hide
 * (capability register E6.01–E6.14, C2.08).
 *
 * The scheduler constrains on craft hours. This panel shows what a craft-hours
 * figure cannot: whether anyone qualified is available inside those hours,
 * whether the person who is has been on shift for eleven days, and whether the
 * only holder of a critical competency has a leaving date.
 *
 * Statutory breaches are rendered separately from every other kind. A company
 * standard can be flexed by someone with the authority to flex it; a statutory
 * limit cannot, and showing both in the same amber teaches people to treat
 * them the same.
 */
import { useMemo } from "react";
import {
  HardHat,
  Info,
  TriangleAlert,
  BrainCircuit,
  Gauge,
} from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import { supabase } from "../lib/supabase";
import {
  assessFatigue,
  type LabourRule,
  type RosteredMember,
} from "../lib/human-factors";
import { LoadingState, ErrorState } from "./ui/AsyncStates";

interface Posture {
  members_total: number;
  contractors: number;
  competencies_defined: number;
  expired_competencies: number;
  expiring_90d: number;
  statutory_expired: number;
  single_point_areas: number;
  members_with_departure_date: number;
  roster_rows: number;
  labour_rules_defined: number;
  basis: string;
}

interface KnowledgeRisk {
  area_title: string;
  criticality: string;
  consequence_if_lost: string;
  holder_count: number;
  holders: string;
  earliest_departure: string | null;
  documented_where: string | null;
  has_succession_plan: boolean;
}

interface CapacityRow {
  craft: string;
  declared_weekly_hours: number | null;
  deductions_total: number;
  headcount: number;
  theoretical_weekly_hours: number;
  basis: string;
}

interface RosterWindow {
  rules: LabourRule[];
  members: RosteredMember[];
}

export function WorkforceReadiness() {
  const { data, loading, error, refetch } = useAsyncData<{
    posture: Posture | null;
    knowledge: KnowledgeRisk[];
    capacity: CapacityRow[];
    roster: RosterWindow;
  }>(async () => {
    const [p, k, c, r] = await Promise.all([
      supabase.rpc("get_workforce_posture"),
      supabase.rpc("get_knowledge_risk"),
      supabase.rpc("get_craft_capacity_reconciliation"),
      supabase.rpc("get_roster_window", { p_days: 21 }),
    ]);
    if (p.error) throw new Error(p.error.message);
    if (k.error) throw new Error(k.error.message);
    if (c.error) throw new Error(c.error.message);
    if (r.error) throw new Error(r.error.message);
    return {
      posture: (p.data as Posture[])?.[0] ?? null,
      knowledge: (k.data as KnowledgeRisk[]) ?? [],
      capacity: (c.data as CapacityRow[]) ?? [],
      roster: (r.data as RosterWindow) ?? { rules: [], members: [] },
    };
  }, []);

  const fatigue = useMemo(() => {
    const roster = data?.roster;
    if (!roster) return null;
    return assessFatigue(roster.members, roster.rules, new Date(), 21);
  }, [data]);

  if (loading) return <LoadingState label="Loading workforce readiness" />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  const posture = data?.posture ?? null;
  const knowledge = data?.knowledge ?? [];
  const capacity = data?.capacity ?? [];

  return (
    <section aria-labelledby="workforce-heading" className="space-y-4">
      <div>
        <h2
          id="workforce-heading"
          className="flex items-center gap-2 text-lg font-semibold text-white"
        >
          <HardHat className="h-5 w-5 text-signal-cyan" aria-hidden />
          Workforce Readiness
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-300">
          A craft-hours figure says how much work can be done. It does not say
          whether anyone qualified is available inside those hours.
        </p>
      </div>

      {posture && (
        <div
          className={`flex items-start gap-2 rounded-xl border p-4 text-sm ${
            posture.statutory_expired > 0
              ? "border-rose-500/30 bg-rose-500/5 text-rose-100"
              : "border-white/6 bg-white/2 text-slate-300"
          }`}
        >
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>{posture.basis}</p>
        </div>
      )}

      {/* Fatigue. Statutory separated from everything else. */}
      {fatigue && (
        <div className="rounded-xl border border-white/6 p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
            <TriangleAlert className="h-4 w-4 text-amber-400" aria-hidden />
            Roster and fatigue exposure
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">
            {fatigue.reason}
          </p>
          {fatigue.breaches.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {fatigue.breaches.map((b, i) => (
                <li
                  key={i}
                  className={`rounded-lg border p-2 text-sm ${
                    b.source === "statutory"
                      ? "border-rose-500/25 bg-rose-500/5"
                      : "border-white/6"
                  }`}
                >
                  <span
                    className={
                      b.source === "statutory"
                        ? "font-mono text-xs uppercase tracking-wide text-rose-300"
                        : "font-mono text-xs uppercase tracking-wide text-slate-500"
                    }
                  >
                    {b.source.replace(/_/g, " ")}
                  </span>{" "}
                  <span className="ml-2 text-slate-300">{b.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Single points of knowledge. */}
      {knowledge.length > 0 && (
        <div className="rounded-xl border border-white/6 p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
            <BrainCircuit className="h-4 w-4 text-signal-cyan" aria-hidden />
            Single points of knowledge
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">
            The workforce equivalent of a single point of failure: an area of
            knowledge with one holder, or none.
          </p>
          <ul className="mt-3 space-y-2">
            {knowledge.map((k, i) => (
              <li
                key={i}
                className="rounded-lg border border-white/6 p-3 text-sm"
              >
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-slate-100">{k.area_title}</span>
                  <span
                    className={`font-mono text-xs ${
                      k.holder_count === 0 ? "text-rose-300" : "text-amber-300"
                    }`}
                  >
                    {k.holder_count === 0
                      ? "no holder"
                      : `${k.holder_count} holder — ${k.holders}`}
                  </span>
                  {k.earliest_departure && (
                    <span className="rounded bg-rose-500/10 px-1.5 py-0.5 text-xs text-rose-300">
                      leaving {k.earliest_departure}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  {k.consequence_if_lost}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {k.documented_where
                    ? `Documented: ${k.documented_where}.`
                    : "Not documented anywhere."}{" "}
                  {k.has_succession_plan
                    ? "A succession or cross-training plan is open."
                    : "No succession or cross-training plan is open."}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Actual capacity vs theoretical. */}
      {capacity.length > 0 && (
        <div className="rounded-xl border border-white/6 p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
            <Gauge className="h-4 w-4 text-slate-400" aria-hidden />
            Actual capacity, not theoretical hours
          </h3>
          <ul className="mt-2 space-y-2">
            {capacity.map((c) => (
              <li key={c.craft} className="text-sm">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-slate-200">{c.craft}</span>
                  <span className="font-mono text-xs text-slate-400 tabular-nums">
                    {c.headcount} person(s) ·{" "}
                    {Number(c.theoretical_weekly_hours).toFixed(0)} h
                    theoretical
                    {c.declared_weekly_hours !== null &&
                      ` · ${c.declared_weekly_hours} h declared`}
                  </span>
                </div>
                <p className="text-xs leading-relaxed text-slate-500">
                  {c.basis}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
