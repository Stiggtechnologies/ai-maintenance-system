/**
 * Sync Field — the composed module (D7.16, spec II.engines), at /sync-field.
 *
 * WHAT IT COMPOSES: work packaging and the AWP chain (D7.10/D7.17), the
 * Constraint-Free Work Index and its forward face (D7.20/D7.08), workface
 * planning (D7.13/D7.14), resource demand and capacity (D7.01), the portfolio
 * resource position (D7.02) and execution readiness (D7.19/D13.09).
 *
 * WHAT IT DOES NOT DO. It computes nothing. Every figure on this page is the
 * owning function's own answer, arriving through one server-side composition
 * (`get_sync_field_module`) that likewise recomputes nothing. There is one
 * readiness verdict in this product, one constraint projection, one field-ready
 * predicate and one guarded division, and a composed surface that re-derived
 * any of them would be the ninth instance of this programme's signature defect
 * — this time on the page a superintendent reads in the morning.
 *
 * WHAT IT SAYS ABOUT ITSELF. A composition is not more complete than its
 * parts, so the page prints the parts still open — D7.06, D7.07 and D7.12 —
 * from the server's own list rather than from a comment nobody updates. That
 * is why the register row for D7.16 stays 🟡 while this surface exists: the
 * navigation the row asked for is here, and three of the things it composes
 * are not finished.
 *
 * REFUSAL-FIRST. Every panel renders the server's refusal sentence where the
 * server refused, and no panel renders a percentage the server did not
 * produce: a `MetricRatio` with `answered: false` carries no `pct` at all.
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ExternalLink, HardHat, RefreshCw } from "lucide-react";

import { Ratio } from "../components/develop/WorkforcePanels";
import {
  getSyncFieldModule,
  listDevelopmentCases,
  type DevelopmentCaseSummary,
  type SyncFieldModule,
} from "../services/developService";

function ForwardTone(state: string): string {
  switch (state) {
    case "ready_now":
      return "border-emerald-400/30 bg-emerald-400/10 text-emerald-200";
    case "forecast_clear_in_time":
      return "border-sky-400/30 bg-sky-400/10 text-sky-200";
    case "forecast_clear_too_late":
    case "overdue":
      return "border-red-400/30 bg-red-400/10 text-red-200";
    // NOT PROJECTABLE AND UNASSESSED ARE NOT FAILURES AND NOT PASSES. They
    // wear the neutral register, because a reader who mistakes either for a
    // verdict has been misled by the styling rather than by the words.
    default:
      return "border-white/10 bg-white/[0.02] text-slate-300";
  }
}

export function SyncFieldPage() {
  const [params, setParams] = useSearchParams();
  const [cases, setCases] = useState<DevelopmentCaseSummary[]>([]);
  const [module, setModule] = useState<SyncFieldModule | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const caseId = params.get("case") ?? "";

  useEffect(() => {
    void (async () => {
      try {
        setCases(await listDevelopmentCases());
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  const load = useCallback(async () => {
    if (!caseId) {
      setModule(null);
      return;
    }
    setBusy(true);
    try {
      setModule(await getSyncFieldModule(caseId, 90));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [caseId]);

  useEffect(() => {
    void load();
  }, [load]);

  const cfw = module?.constraintFreeWork;
  const workface = module?.workface;
  const balance = module?.resourceBalance;
  const portfolio = module?.portfolioConflicts;
  const board = module?.executionReadiness;

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-slate-50">
            <HardHat className="h-4 w-4 text-signal-cyan" aria-hidden />
            Sync Field
          </h1>
          <p className="max-w-3xl text-xs text-slate-400">
            Work packaging, workface planning, constraints, resources and
            execution readiness in one place. Every figure here is another
            engine&apos;s own answer — this page composes and recomputes
            nothing, and where a metric refuses it prints the refusal instead of
            a percentage.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={caseId}
            onChange={(e) =>
              setParams(e.target.value ? { case: e.target.value } : {})
            }
            className="rounded-lg border border-white/10 bg-[#0B121C] px-2.5 py-1.5 text-xs text-slate-200"
          >
            <option value="">Choose a development case</option>
            {cases.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
          <button
            onClick={() => void load()}
            disabled={busy || !caseId}
            className="flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-40"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            {busy ? "Reading…" : "Refresh"}
          </button>
        </div>
      </header>

      {error && (
        <div className="rounded border border-red-400/30 bg-red-400/10 px-2.5 py-2 text-xs whitespace-pre-wrap text-red-300">
          {error}
        </div>
      )}

      {!caseId && (
        <p className="rounded border border-white/8 bg-white/[0.02] px-3 py-2 text-xs text-slate-300">
          Choose a development case. Sync Field is scoped to a project&apos;s
          work; the portfolio resource position it carries is organization-wide
          and is the one figure on this page that is not.
        </p>
      )}

      {module && !module.answered && (
        <p className="rounded border border-amber-400/25 bg-amber-400/5 px-3 py-2 text-xs text-amber-200">
          {module.refusal}
        </p>
      )}

      {module?.answered && (
        <>
          {/* ── the four percentages, and each one's right to exist ── */}
          <section className="rounded-xl border border-white/6 bg-[#0D1520] p-5">
            <h2 className="text-sm font-semibold text-slate-100">
              Constraint-free work and the workface
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              The Constraint-Free Work Index (§49) and forward constraint-free
              work (I.28) are ONE calculation over work packages; planned-work-
              ready and ready-work-executed (II.5) are over the crew&apos;s own
              unit, the job. None of the four divides the same set as another,
              and each refuses rather than dividing over an empty denominator.
            </p>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Ratio
                label="Constraint-Free Work Index"
                ratio={cfw?.constraintFreeWorkIndex}
                registerRef="D7.20 · §49"
              />
              <Ratio
                label="Forward constraint-free work"
                ratio={cfw?.forwardConstraintFreeWork}
                registerRef="D7.08 · I.28"
              />
              <Ratio
                label="Planned-work-ready"
                ratio={workface?.plannedWorkReady}
                registerRef="D7.13 · II.5"
              />
              <Ratio
                label="Ready-work-executed"
                ratio={workface?.readyWorkExecuted}
                registerRef="D7.14 · II.5"
              />
            </div>
            {/* COVERAGE BESIDE THE FOUR, on both halves. A percentage over a
                set most of which nobody could assess is not a project
                position, and this is the figure that says so. */}
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Ratio
                label="Constraint assessment coverage"
                ratio={cfw?.assessmentCoverage}
                registerRef="D7.20 · how much of the planned set the index is about"
              />
              <Ratio
                label="Workface assessment coverage"
                ratio={workface?.assessmentCoverage}
                registerRef="D7.13/D7.14 · how much of the planned set they are about"
              />
            </div>
            <p className="mt-2 text-[11px] text-slate-500">
              Every figure above is about the next {module.horizonDays ?? 90}{" "}
              days; the workface look-ahead runs to{" "}
              {module.workfaceWindowEnd ?? "—"} and the resource reads cover{" "}
              {module.horizonWeeks ?? "—"} week(s). The window is the
              module&apos;s, stated rather than assumed.
            </p>
            {cfw && !cfw.answered && (
              <p className="mt-3 rounded border border-amber-400/25 bg-amber-400/5 px-3 py-2 text-xs text-amber-200">
                {cfw.refusal}
              </p>
            )}
            {cfw?.answered && (
              <>
                <p className="mt-3 text-[11px] text-slate-500">
                  {cfw.plannedPackages} planned package(s) in the next{" "}
                  {cfw.horizonDays} days · {cfw.assessedPackages} assessed ·{" "}
                  {cfw.unassessedPackages} with no constraint recorded at all ·{" "}
                  {cfw.stalePackages} whose recorded assessment the stores have
                  moved past · {cfw.notProjectable} that cannot be projected
                </p>
                {(cfw.overduePackages ?? 0) > 0 && (
                  <div className="mt-2 rounded border border-amber-400/25 bg-amber-400/5 px-3 py-2">
                    <p className="text-[11px] font-semibold text-amber-200">
                      {cfw.overduePackages} unreleased package(s) were needed on
                      a date that has already passed — outside this window, and
                      counted in none of the percentages above.
                    </p>
                    <ul className="mt-1 space-y-0.5">
                      {(cfw.overdue ?? []).map((p) => (
                        <li
                          key={p.packageId}
                          className="text-[11px] text-amber-100"
                        >
                          {p.packageCode} — needed {p.requiredBy},{" "}
                          {p.daysOverdue} day(s) ago
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <ul className="mt-2 space-y-2">
                  {(cfw.packages ?? []).map((p) => (
                    <li
                      key={p.packageId}
                      className="rounded-lg border border-white/8 bg-white/[0.02] p-3"
                    >
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="text-xs font-semibold text-slate-100">
                          {p.packageCode} — {p.title}
                        </span>
                        <span className="rounded border border-white/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">
                          {p.verdict.replace(/_/g, " ")}
                        </span>
                        <span
                          className={`rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${ForwardTone(
                            p.forward,
                          )}`}
                        >
                          {p.forward.replace(/_/g, " ")}
                        </span>
                        <span className="text-[11px] text-slate-500">
                          required by {p.requiredBy}
                        </span>
                      </div>
                      {/* THE ONE VERDICT'S SENTENCE, VERBATIM. */}
                      <p className="mt-1 text-xs text-slate-300">
                        {p.readiness}
                      </p>
                      {p.projectedConstraintFreeDate && (
                        <p className="mt-1 text-[11px] text-sky-200">
                          Projected constraint-free{" "}
                          {p.projectedConstraintFreeDate}
                        </p>
                      )}
                      {p.projectionRefusal && (
                        <p className="mt-1 text-[11px] text-amber-200">
                          {p.projectionRefusal}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {workface && !workface.answered && (
              <p className="mt-3 rounded border border-amber-400/25 bg-amber-400/5 px-3 py-2 text-xs text-amber-200">
                {workface.refusal}
              </p>
            )}
            {workface?.answered && (
              <>
                <p className="mt-3 text-[11px] text-slate-500">
                  Workface window {workface.windowStart} → {workface.windowEnd}{" "}
                  · {workface.plannedWorkOrders} planned job(s) ·{" "}
                  {workface.assessableWorkOrders} assessable ·{" "}
                  {workface.packageUnassessedWorkOrders} in a work package with
                  no constraint recorded at all ·{" "}
                  {workface.notAssessableWorkOrders} the predicate refused to
                  answer for · {workface.packageBlockedWorkOrders} field-ready
                  but held back by their package · {workface.readyNotStarted}{" "}
                  ready and not started
                </p>
                <ul className="mt-2 space-y-1">
                  {(workface.workOrders ?? []).map((w) => (
                    <li
                      key={w.workOrderId}
                      className="rounded border border-white/8 px-2 py-1.5 text-[11px] text-slate-300"
                    >
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="font-semibold text-slate-200">
                          {w.woNumber ?? "—"} — {w.title}
                        </span>
                        <span className="uppercase tracking-wide text-slate-500">
                          {w.fieldReady.replace(/_/g, " ")}
                        </span>
                        {/* THE PACKAGE VERDICT TRAVELS WITH THE JOB, so this
                            half of the screen cannot state the opposite of
                            the index above it about the same package. */}
                        <span className="uppercase tracking-wide text-slate-500">
                          package {w.packageVerdict.replace(/_/g, " ")}
                        </span>
                        <span className="text-slate-500">
                          {w.packageCode}
                          {w.packageCount > 1
                            ? ` (+${w.packageCount - 1} more package)`
                            : ""}
                        </span>
                        <span className="text-slate-500">
                          execution {w.executionStatus ?? "not stated"}
                        </span>
                      </div>
                      <p className="mt-0.5 text-slate-400">{w.detail}</p>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          {/* ── resources ── */}
          <section className="rounded-xl border border-white/6 bg-[#0D1520] p-5">
            <h2 className="text-sm font-semibold text-slate-100">
              Resources, time-phased and collective
            </h2>
            {balance && !balance.answered && (
              <p className="mt-2 rounded border border-amber-400/25 bg-amber-400/5 px-3 py-2 text-xs text-amber-200">
                {balance.refusal}
              </p>
            )}
            {balance?.answered && (
              <ul className="mt-2 space-y-1">
                {(balance.cells ?? []).map((cell) => (
                  <li
                    key={`${cell.category}-${cell.pool}-${cell.periodStart}`}
                    className="rounded border border-white/8 px-2 py-1.5 text-[11px] text-slate-300"
                  >
                    <span className="font-semibold text-slate-200">
                      {cell.category} · {cell.pool}
                    </span>{" "}
                    <span className="uppercase tracking-wide text-slate-500">
                      {cell.state.replace(/_/g, " ")}
                    </span>
                    <p className="mt-0.5 text-slate-400">{cell.detail}</p>
                  </li>
                ))}
              </ul>
            )}
            {portfolio && !portfolio.answered && (
              <p className="mt-2 rounded border border-amber-400/25 bg-amber-400/5 px-3 py-2 text-xs text-amber-200">
                {portfolio.refusal}
              </p>
            )}
            {portfolio?.answered && (
              <>
                <p className="mt-3 text-[11px] text-slate-500">
                  Across the portfolio: {portfolio.conflicts} pool(s) over
                  committed, {portfolio.collectiveOnlyConflicts} of them only
                  collectively — every project fits alone and the set does not.
                </p>
                <ul className="mt-1 space-y-1">
                  {(portfolio.pools ?? []).map((pool) => (
                    <li
                      key={`${pool.category}-${pool.pool}`}
                      className={`rounded border px-2 py-1.5 text-[11px] ${
                        pool.state === "collective_only" ||
                        pool.state === "over_committed"
                          ? "border-red-400/30 bg-red-400/10 text-red-200"
                          : "border-white/8 text-slate-300"
                      }`}
                    >
                      {pool.detail}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          {/* ── execution readiness, composed from the recorded verdicts ── */}
          <section className="rounded-xl border border-white/6 bg-[#0D1520] p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-100">
                Execution readiness
              </h2>
              <Link
                to="/execution-readiness"
                className="flex items-center gap-1 text-[11px] text-signal-cyan underline hover:text-signal-cyan/80"
              >
                the full board <ExternalLink className="h-3 w-3" aria-hidden />
              </Link>
            </div>
            {board && !board.answered && (
              <p className="mt-2 rounded border border-amber-400/25 bg-amber-400/5 px-3 py-2 text-xs text-amber-200">
                {board.refusal}
              </p>
            )}
            {board?.answered && (
              <ul className="mt-2 space-y-1">
                {(board.packages ?? []).map((p) => (
                  <li
                    key={p.packageId}
                    className="rounded border border-white/8 px-2 py-1.5 text-[11px] text-slate-300"
                  >
                    <span className="font-semibold text-slate-200">
                      {p.packageCode}
                    </span>{" "}
                    <span className="uppercase tracking-wide text-slate-500">
                      {p.readinessVerdict.replace(/_/g, " ")}
                    </span>
                    <p className="mt-0.5 text-slate-400">{p.readiness}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ── what this module composes, and what is still open ── */}
          <section className="rounded-xl border border-white/6 bg-[#0D1520] p-5">
            <h2 className="text-sm font-semibold text-slate-100">
              What this module composes
            </h2>
            <ul className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">
              {(module.composition ?? []).map((c) => (
                <li
                  key={c.source}
                  className="rounded border border-white/8 px-2 py-1.5 text-[11px] text-slate-400"
                >
                  <span className="font-semibold text-slate-200">{c.part}</span>{" "}
                  · {c.row} · <code className="text-slate-500">{c.source}</code>
                </li>
              ))}
            </ul>
            <h3 className="mt-4 text-xs font-semibold text-amber-200">
              Parts still open — a composition is not more complete than its
              pieces
            </h3>
            <ul className="mt-1 space-y-1">
              {(module.openParts ?? []).map((p) => (
                <li
                  key={p.row}
                  className="rounded border border-amber-400/25 bg-amber-400/5 px-2 py-1.5 text-[11px] text-amber-100"
                >
                  <span className="font-semibold">{p.row}</span> — {p.gap}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[11px] text-slate-500">{module.basis}</p>
          </section>
        </>
      )}
    </div>
  );
}

export default SyncFieldPage;
