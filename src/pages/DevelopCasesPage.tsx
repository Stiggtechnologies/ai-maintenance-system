/**
 * Sync Develop — case list (/develop). Slice 1 surface for D1.04.
 *
 * Reads development_cases via RLS. Everything shown is a persisted row a
 * signed-in customer created through create_development_case — no seeded
 * numbers, no placeholders. The empty state says what to do, not what to
 * imagine.
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BriefcaseBusiness, Grid3X3, Landmark, Plus, RefreshCw } from "lucide-react";
import {
  listDevelopmentCases,
  type DevelopmentCaseSummary,
} from "../services/developService";
import { LIFECYCLE_TYPES } from "../lib/develop";
import { MyDecisionsPanel } from "../components/develop/MyDecisionsPanel";

const STATUS_STYLE: Record<string, string> = {
  active: "bg-signal-cyan/10 text-signal-cyan",
  on_hold: "bg-amber-400/10 text-amber-300",
  sanctioned: "bg-emerald-400/10 text-emerald-300",
  cancelled: "bg-white/5 text-slate-400",
  completed: "bg-white/5 text-slate-300",
};

function lifecycleLabel(value: string): string {
  return LIFECYCLE_TYPES.find((t) => t.value === value)?.label ?? value;
}

function money(value: number | null): string {
  if (value == null) return "—";
  return `$${Number(value).toLocaleString()}`;
}

export function DevelopCasesPage() {
  const navigate = useNavigate();
  const [cases, setCases] = useState<DevelopmentCaseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setCases(await listDevelopmentCases());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load cases");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            Sync Develop
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Development cases — from problem statement to sanctioned project,
            through gates a human has to pass
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate("/develop/operational-readiness")}
            className="flex items-center gap-2 rounded-lg border border-white/8 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-white/5"
          >
            <Grid3X3 className="h-4 w-4" aria-hidden />
            Operational readiness
          </button>
          <button
            onClick={() => navigate("/develop/portfolio")}
            className="flex items-center gap-2 rounded-lg border border-white/8 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-white/5"
          >
            <BriefcaseBusiness className="h-4 w-4" aria-hidden />
            Portfolio
          </button>
          <button
            onClick={() => void load()}
            className="rounded-lg border border-white/8 p-2 text-slate-300 hover:bg-white/5"
            title="Refresh"
          >
            <RefreshCw className="h-4 w-4" aria-hidden />
          </button>
          <button
            onClick={() => navigate("/develop/new")}
            className="flex items-center gap-2 rounded-lg bg-signal-cyan/15 border border-signal-cyan/30 px-3 py-2 text-sm font-semibold text-signal-cyan hover:bg-signal-cyan/25"
          >
            <Plus className="h-4 w-4" aria-hidden />
            Frame a new case
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* D13.02 (spec §44): the per-user decision queue, cross-domain over the
          ONE canonical decisions table. It sits above the case list because it
          is the question a person opens this route to answer — "what is waiting
          on me?" — and because it spans cases rather than belonging to one. */}
      <MyDecisionsPanel />

      {loading ? (
        <div className="text-sm text-slate-400">Loading cases…</div>
      ) : cases.length === 0 ? (
        <div className="rounded-xl border border-white/6 bg-[#0D1520] p-8 text-center">
          <Landmark className="mx-auto h-8 w-8 text-slate-500" aria-hidden />
          <p className="mt-3 text-sm font-semibold text-slate-200">
            No development cases yet
          </p>
          <p className="mx-auto mt-1 max-w-md text-xs text-slate-400">
            A case begins with the problem, not the project. Frame the problem
            or opportunity, pick a framework, and the gates take it from there.
          </p>
          <button
            onClick={() => navigate("/develop/new")}
            className="mt-4 rounded-lg bg-signal-cyan/15 border border-signal-cyan/30 px-3 py-2 text-sm font-semibold text-signal-cyan hover:bg-signal-cyan/25"
          >
            Frame the first case
          </button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/6">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-white/6 bg-white/[0.02] text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="px-4 py-3">Case</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Stage</th>
                <th className="px-4 py-3">Estimated capex</th>
                <th className="px-4 py-3">Expected value</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {cases.map((c) => (
                <tr
                  key={c.id}
                  onClick={() => navigate(`/develop/cases/${c.id}`)}
                  className="cursor-pointer border-b border-white/4 last:border-0 hover:bg-white/[0.03]"
                >
                  <td className="px-4 py-3">
                    <div className="font-semibold text-slate-100">
                      {c.title}
                    </div>
                    <div className="mt-0.5 max-w-lg truncate text-xs text-slate-500">
                      {c.problem_statement}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-300">
                    {lifecycleLabel(c.lifecycle_type)}
                  </td>
                  <td className="px-4 py-3 text-slate-300">
                    {c.current_stage_key ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-300">
                    {money(c.estimated_capex)}
                  </td>
                  <td className="px-4 py-3 text-slate-300">
                    {money(c.expected_value)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[c.status] ?? "bg-white/5 text-slate-300"}`}
                    >
                      {c.status.replace("_", " ")}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
