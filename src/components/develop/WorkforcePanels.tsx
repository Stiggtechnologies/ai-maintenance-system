/**
 * Sync Develop Slice 7C — resources, competency readiness and the workface
 * metrics, as screens.
 *
 *   D7.01 (I.22)  ResourceDemand beside ResourceCapacity, time-phased across
 *                 the nine categories. A pool with no recorded capacity is
 *                 rendered NOT ASSESSABLE in its own neutral register — never
 *                 as a shortfall and never as a clearance.
 *   D7.02 (I.22)  the portfolio position: which pools are committed beyond
 *                 their capacity across every project, and which of those are
 *                 over-committed ONLY collectively.
 *   D7.03 (I.23)  the competency requirement and the availability record,
 *                 with the write paths the register called demoted.
 *   D7.04 (I.23)  qualified WHEN NEEDED, with the expiring certificate shown
 *                 as its own state rather than folded into "not qualified".
 *   D7.13/D7.14   planned-work-ready % and ready-work-executed % (II.5).
 *   D7.08/D7.20   the Constraint-Free Work Index and its forward face — ONE
 *                 calculation, rendered once, cited from two register rows.
 *
 * ── THE ONE RULE THIS FILE OBEYS ───────────────────────────────────────────
 *
 * A PERCENTAGE ARRIVES AS A `MetricRatio`, NOT AS A NUMBER. Every ratio the
 * server produces carries `answered`, and when it is false there is no `pct`
 * to render at all — only the server's refusal sentence. `<Ratio>` below is
 * the only component that renders a percentage in this file, and it cannot
 * print a number the server did not produce. That is deliberate: 0 ready of 0
 * planned rendered as 0% reads as broken and rendered as 100% reads as
 * perfect, and both are wrong about a window nobody planned work into.
 *
 * No readiness sentence is written here. The package readiness prose is
 * `sync_work_package_release_verdict`'s own, the field-readiness detail is
 * the element predicate's own, and the capacity refusals are
 * `sync_resource_capacity_hours`'s own.
 */
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { HardHat } from "lucide-react";

import {
  RESOURCE_CATEGORIES,
  RESOURCE_CATEGORY_LABELS,
  RESOURCE_DEMAND_SOURCES,
  balanceTone,
  parseHorizonWeeks,
  parseHours,
  type ResourceCategory,
  type ResourceBalanceState,
} from "../../lib/develop/workforce";
import {
  approveResourceDemand,
  computeCompetencyReadiness,
  computeConstraintFreeWorkIndex,
  computeWorkfaceExecutionMetrics,
  getCaseResourceBalance,
  getCaseWorkPackages,
  getCaseResourceDemand,
  getCompetencyReadiness,
  getConstraintFreeWorkIndex,
  getWorkfaceExecutionMetrics,
  getCompetencyRequirements,
  getPortfolioResourceConflicts,
  recordCapacityDeduction,
  recordCompetency,
  recordCompetencyRequirement,
  renewMemberCompetency,
  retireCompetencyRequirement,
  setWorkforceMemberActive,
  closeResourceCapacity,
  recordMemberCompetency,
  recordResourceCapacity,
  recordResourceDemand,
  recordShiftAssignment,
  recordWorkforceMember,
  withdrawResourceDemand,
  type CaseResourceBalance,
  type CompetencyCatalogue,
  type CompetencyReadiness,
  type ConstraintFreeWorkIndex,
  type MetricRatio,
  type PortfolioResourceConflicts,
  type ResourceDemandLine,
  type WorkfaceExecutionMetrics,
} from "../../services/developService";

const inputClass =
  "w-full rounded-lg border border-white/10 bg-[#0B121C] px-2.5 py-1.5 text-xs text-slate-200 placeholder:text-slate-600";

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-white/6 bg-[#0D1520] p-5">
      <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
      <p className="mt-1 text-xs text-slate-400">{subtitle}</p>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

/**
 * THE ONLY PLACE A PERCENTAGE IS RENDERED.
 *
 * When the server refused there is no number in the payload, so this cannot
 * invent one: it prints the refusal in the server's own words, in amber, and
 * says which kind of refusal it was. A reader can tell "nobody looked" from
 * "somebody looked and the answer is none" without reading the prose, which
 * is exactly the distinction a bare 0% destroys.
 */
export function Ratio({
  label,
  ratio,
  registerRef,
}: {
  label: string;
  ratio: MetricRatio | undefined;
  registerRef: string;
}) {
  if (!ratio) {
    return (
      <div className="rounded-lg border border-white/8 bg-white/[0.02] p-3">
        <span className="text-[11px] font-semibold text-slate-300">
          {label}
        </span>
        <p className="mt-1 text-xs text-slate-400">
          The server returned no position for this metric.
        </p>
      </div>
    );
  }
  if (!ratio.answered) {
    return (
      <div className="rounded-lg border border-amber-400/25 bg-amber-400/5 p-3">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-[11px] font-semibold text-amber-200">
            {label}
          </span>
          <span className="rounded border border-amber-400/30 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-200">
            {ratio.kind.replace(/_/g, " ")}
          </span>
          <span className="text-[10px] text-slate-500">{registerRef}</span>
        </div>
        {/* NO NUMBER. The refusal is the answer. */}
        <p className="mt-1 text-xs text-amber-100">{ratio.refusal}</p>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-white/8 bg-white/[0.02] p-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-[11px] font-semibold text-slate-300">
          {label}
        </span>
        <span className="text-[10px] text-slate-500">{registerRef}</span>
      </div>
      <p className="mt-1 text-2xl font-semibold text-slate-50">{ratio.pct}%</p>
      <p className="text-[11px] text-slate-500">
        {ratio.numerator} of {ratio.denominator}
      </p>
    </div>
  );
}

function RefusalList({
  refusals,
}: {
  refusals: { reason: string; scope: string }[] | undefined;
}) {
  if (!refusals || refusals.length === 0) return null;
  return (
    <ul className="space-y-1">
      {refusals.map((r, i) => (
        <li
          key={`${r.scope}-${i}`}
          className="rounded border border-amber-400/25 bg-amber-400/5 px-2 py-1.5 text-[11px] text-amber-100"
        >
          <span className="font-semibold uppercase tracking-wide text-amber-200">
            {r.scope}
          </span>{" "}
          {r.reason}
        </li>
      ))}
    </ul>
  );
}

/* ── D7.01 / D7.02 — resources ─────────────────────────────────────────── */

const BALANCE_LABEL: Record<ResourceBalanceState, string> = {
  within_capacity: "within capacity",
  at_capacity: "at capacity",
  over_committed: "over committed",
  not_assessable: "not assessable",
};

export function ResourceBalancePanel({
  caseId,
  canPlan,
  canApprove,
  packages,
  reloadKey,
}: {
  caseId: string;
  canPlan: boolean;
  canApprove: boolean;
  packages: { id: number; code: string }[];
  reloadKey?: number;
}) {
  const [balance, setBalance] = useState<CaseResourceBalance | null>(null);
  const [demand, setDemand] = useState<ResourceDemandLine[]>([]);
  const [portfolio, setPortfolio] = useState<PortfolioResourceConflicts | null>(
    null,
  );
  const [horizon, setHorizon] = useState("12");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const [demandForm, setDemandForm] = useState({
    category: "skilled_trades" as ResourceCategory,
    pool: "",
    demandHours: "",
    periodStart: "",
    periodEnd: "",
    sourceKind: "estimate",
    basis: "",
    workPackageId: "",
  });
  const [closeFor, setCloseFor] = useState<{
    capacityId: string;
    pool: string;
    category: string;
    weeklyHours: number | null;
    effectiveFrom: string | null;
  } | null>(null);
  const [closeDate, setCloseDate] = useState("");
  const [capacityForm, setCapacityForm] = useState({
    category: "skilled_trades" as ResourceCategory,
    pool: "",
    weeklyHours: "",
    basis: "",
    effectiveTo: "",
  });
  const [deductionForm, setDeductionForm] = useState({
    category: "skilled_trades" as ResourceCategory,
    pool: "",
    deductionKind: "leave",
    weeklyHours: "",
    basis: "",
  });

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const weeks = parseHorizonWeeks(horizon);
      const w = weeks.ok ? (weeks.value ?? 12) : 12;
      const [b, d, p] = await Promise.all([
        getCaseResourceBalance(caseId, w),
        getCaseResourceDemand(caseId),
        getPortfolioResourceConflicts(w),
      ]);
      setBalance(b);
      setDemand(d.demand ?? []);
      setPortfolio(p);
      setNote(weeks.ok ? null : (weeks.error ?? null));
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [caseId, horizon]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  const submitDemand = async () => {
    const hours = parseHours(demandForm.demandHours, "Demand hours");
    if (!hours.ok) {
      setNote(hours.error ?? null);
      return;
    }
    setBusy(true);
    try {
      const r = await recordResourceDemand(caseId, {
        ...demandForm,
        workPackageId: demandForm.workPackageId || null,
      });
      setNote(r.answered ? (r.note ?? "Recorded.") : (r.refusal ?? null));
      if (r.answered) {
        setDemandForm({ ...demandForm, demandHours: "", basis: "" });
        await load();
      }
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const closeCapacity = async () => {
    if (!closeFor) return;
    setBusy(true);
    try {
      const r = await closeResourceCapacity({
        capacityId: closeFor.capacityId,
        effectiveTo: closeDate,
      });
      setNote(r.answered ? (r.note ?? "Closed.") : (r.refusal ?? null));
      if (r.answered) {
        setCloseFor(null);
        setCloseDate("");
        await load();
      }
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const submitCapacity = async () => {
    const hours = parseHours(capacityForm.weeklyHours, "Weekly hours");
    if (!hours.ok) {
      setNote(hours.error ?? null);
      return;
    }
    setBusy(true);
    try {
      const r = await recordResourceCapacity(capacityForm);
      setNote(r.answered ? (r.note ?? "Recorded.") : (r.refusal ?? null));
      if (r.answered) {
        setCapacityForm({ ...capacityForm, weeklyHours: "", basis: "" });
        await load();
      }
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const submitDeduction = async () => {
    setBusy(true);
    try {
      const r = await recordCapacityDeduction(deductionForm);
      setNote(r.answered ? (r.note ?? "Recorded.") : (r.refusal ?? null));
      if (r.answered) {
        setDeductionForm({ ...deductionForm, weeklyHours: "", basis: "" });
        await load();
      }
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const act = async (
    fn: () => Promise<{ answered: boolean; refusal?: string; note?: string }>,
  ) => {
    setBusy(true);
    try {
      const r = await fn();
      setNote(r.answered ? (r.note ?? "Done.") : (r.refusal ?? null));
      if (r.answered) await load();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title="Resource demand and capacity (D7.01 · D7.02, spec I.22)"
      subtitle="Demand and capacity time-phased across the nine categories and set beside each other, then summed across every project so a conflict is detectable rather than discovered on site. A pool with no recorded capacity is reported NOT ASSESSABLE: capacity is never inferred from headcount."
    >
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-[11px] text-slate-400" htmlFor="s7c-horizon">
          Horizon (weeks)
        </label>
        <input
          id="s7c-horizon"
          value={horizon}
          onChange={(e) => setHorizon(e.target.value)}
          className={`${inputClass} w-24`}
        />
        <button
          onClick={() => void load()}
          disabled={busy}
          className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-40"
        >
          {busy ? "Reading…" : "Refresh"}
        </button>
      </div>

      {note && (
        <p className="rounded border border-amber-400/25 bg-amber-400/5 px-2.5 py-2 text-xs whitespace-pre-wrap text-amber-100">
          {note}
        </p>
      )}

      {/* THE REFUSAL IS THE ANSWER, in the server's words. */}
      {balance && !balance.answered && (
        <p className="rounded border border-amber-400/25 bg-amber-400/5 px-3 py-2 text-xs text-amber-200">
          {balance.refusal}
        </p>
      )}

      {balance?.answered && (
        <>
          <p className="text-[11px] text-slate-500">
            {balance.linesInWindow} demand line(s) in the next{" "}
            {balance.horizonWeeks} week(s) · {balance.categoriesWithDemand} of{" "}
            {balance.categoriesInSpec} categories carry demand ·{" "}
            {balance.overCommitted} over committed · {balance.notAssessable} not
            assessable
          </p>
          <ul className="space-y-2">
            {(balance.cells ?? []).map((cell) => (
              <li
                key={`${cell.category}-${cell.pool}-${cell.periodStart}`}
                className={`rounded-lg border p-3 ${balanceTone(cell.state)}`}
              >
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-xs font-semibold">
                    {RESOURCE_CATEGORY_LABELS[
                      cell.category as ResourceCategory
                    ] ?? cell.category}{" "}
                    · {cell.pool}
                  </span>
                  <span className="rounded border border-current/30 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                    {BALANCE_LABEL[cell.state]}
                  </span>
                  <span className="text-[11px] opacity-70">
                    {cell.periodStart} → {cell.periodEnd}
                  </span>
                </div>
                {/* THE SERVER'S SENTENCE. */}
                <p className="mt-1 text-[11px]">{cell.detail}</p>
                {cell.deductionsItemised.length > 0 && (
                  <p className="mt-1 text-[11px] opacity-70">
                    Deductions behind the declared figure:{" "}
                    {cell.deductionsItemised
                      .map((d) => `${d.kind} ${d.weeklyHours}h`)
                      .join(", ")}{" "}
                    — itemized, not subtracted again.
                  </p>
                )}
                {/* THE SUPERSEDE ACT, on the figure being read. Recording a
                    replacement while the standing figure is still open leaves
                    two rows for one pool, and the collision refusal instructs
                    this close — which had no path in the product until now. */}
                {canPlan && cell.capacityId && (
                  <button
                    onClick={() => {
                      setCloseFor({
                        capacityId: cell.capacityId!,
                        pool: cell.pool,
                        category: cell.category,
                        weeklyHours: cell.weeklyHours,
                        effectiveFrom: cell.capacityEffectiveFrom,
                      });
                      setCloseDate("");
                    }}
                    className="mt-1 rounded border border-white/15 px-1.5 py-0.5 text-[10px] text-slate-300 hover:bg-white/5"
                  >
                    Close this capacity figure
                  </button>
                )}
              </li>
            ))}
          </ul>
          <RefusalList refusals={balance.refusals} />
          <p className="text-[11px] text-slate-500">{balance.basis}</p>
        </>
      )}

      {closeFor && (
        <div className="space-y-1.5 rounded-lg border border-white/15 bg-white/[0.03] p-3">
          <p className="text-xs font-semibold text-slate-100">
            Close the {closeFor.category} figure for “{closeFor.pool}”
          </p>
          <p className="text-[11px] text-slate-400">
            {closeFor.weeklyHours ?? "—"} hours a week, in force from{" "}
            {closeFor.effectiveFrom ?? "—"}. Closing it stops it counting from
            the day you name, so a figure recorded from that day SUPERSEDES it
            instead of being summed beside it — which is what the collision
            refusal on the record form is asking for. The hours, the basis and
            the start are not editable here.
          </p>
          <input
            type="date"
            value={closeDate}
            onChange={(e) => setCloseDate(e.target.value)}
            className={inputClass}
          />
          <div className="flex gap-2">
            <button
              onClick={() => void closeCapacity()}
              disabled={busy}
              className="rounded-lg border border-white/15 px-2.5 py-1.5 text-xs text-slate-200 disabled:opacity-40"
            >
              Close it
            </button>
            <button
              onClick={() => setCloseFor(null)}
              className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-white/5"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── the portfolio position ── */}
      <div className="rounded-lg border border-white/8 bg-white/[0.02] p-3">
        <span className="text-[11px] font-semibold text-slate-300">
          Across every project (D7.02)
        </span>
        {portfolio && !portfolio.answered && (
          <p className="mt-1 text-xs text-amber-200">{portfolio.refusal}</p>
        )}
        {portfolio?.answered && (
          <>
            <p className="mt-1 text-[11px] text-slate-500">
              {portfolio.approvedDemandLines} approved line(s) across{" "}
              {portfolio.casesWithCommitments} project(s) ·{" "}
              {portfolio.draftDemandLines} still draft and never summed into a
              conflict · {portfolio.conflicts} pool(s) over committed, of which{" "}
              {portfolio.collectiveOnlyConflicts} only collectively
            </p>
            <ul className="mt-2 space-y-2">
              {(portfolio.pools ?? []).map((pool) => (
                <li
                  key={`${pool.category}-${pool.pool}`}
                  className={`rounded border p-2.5 ${
                    pool.state === "collective_only"
                      ? "border-red-400/30 bg-red-400/10 text-red-200"
                      : balanceTone(pool.state as ResourceBalanceState)
                  }`}
                >
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-xs font-semibold">
                      {RESOURCE_CATEGORY_LABELS[
                        pool.category as ResourceCategory
                      ] ?? pool.category}{" "}
                      · {pool.pool}
                    </span>
                    <span className="rounded border border-current/30 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                      {pool.state.replace(/_/g, " ")}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px]">{pool.detail}</p>
                  <p className="mt-1 text-[11px] opacity-70">
                    {pool.contributions
                      .map((c) => `${c.caseTitle}: ${c.demandHours}h`)
                      .join(" · ")}
                  </p>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {/* ── the demand register and its acts ── */}
      {demand.length > 0 && (
        <div className="rounded-lg border border-white/8 bg-white/[0.02] p-3">
          <span className="text-[11px] font-semibold text-slate-300">
            Recorded demand
          </span>
          <ul className="mt-1 space-y-1">
            {demand.map((line) => (
              <li
                key={line.demandId}
                className="rounded border border-white/8 px-2 py-1.5 text-[11px] text-slate-300"
              >
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-semibold text-slate-200">
                    {RESOURCE_CATEGORY_LABELS[
                      line.category as ResourceCategory
                    ] ?? line.category}{" "}
                    · {line.pool}
                  </span>
                  <span>
                    {line.demandHours}h · {line.periodStart} → {line.periodEnd}
                  </span>
                  <span className="uppercase tracking-wide text-slate-500">
                    {line.withdrawn
                      ? "withdrawn"
                      : line.approved
                        ? "approved"
                        : "draft"}
                  </span>
                  {line.packageCode && (
                    <span className="text-slate-500">{line.packageCode}</span>
                  )}
                </div>
                <p className="mt-0.5 text-slate-400">{line.basis}</p>
                {line.withdrawn && (
                  <p className="mt-0.5 text-amber-200">
                    {line.withdrawalReason}
                  </p>
                )}
                {!line.withdrawn && (
                  <div className="mt-1 flex flex-wrap gap-2">
                    {/* §70: approving a roster is a human act, and the
                        database refuses the AI-operator identity whether or
                        not this button is on the screen. */}
                    {!line.approved && canApprove && (
                      <button
                        onClick={() =>
                          void act(() =>
                            approveResourceDemand(
                              line.demandId,
                              window.prompt(
                                "State what is being committed (20 characters minimum)",
                              ) ?? "",
                            ),
                          )
                        }
                        disabled={busy}
                        className="rounded border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[11px] text-emerald-200 disabled:opacity-40"
                      >
                        Approve the commitment
                      </button>
                    )}
                    {canPlan && (
                      <button
                        onClick={() =>
                          void act(() =>
                            withdrawResourceDemand(
                              line.demandId,
                              window.prompt(
                                "Why is this demand withdrawn? (20 characters minimum)",
                              ) ?? "",
                            ),
                          )
                        }
                        disabled={busy}
                        className="rounded border border-white/15 px-2 py-0.5 text-[11px] text-slate-300 disabled:opacity-40"
                      >
                        Withdraw
                      </button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {canPlan && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <div className="rounded-lg border border-white/8 bg-white/[0.02] p-3">
            <span className="text-[11px] font-semibold text-slate-300">
              Record demand — time-phased by definition
            </span>
            <div className="mt-2 space-y-2">
              <select
                value={demandForm.category}
                onChange={(e) =>
                  setDemandForm({
                    ...demandForm,
                    category: e.target.value as ResourceCategory,
                  })
                }
                className={inputClass}
              >
                {RESOURCE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {RESOURCE_CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
              <input
                value={demandForm.pool}
                onChange={(e) =>
                  setDemandForm({ ...demandForm, pool: e.target.value })
                }
                placeholder="Pool — the craft, team or unit"
                className={inputClass}
              />
              <input
                value={demandForm.demandHours}
                onChange={(e) =>
                  setDemandForm({ ...demandForm, demandHours: e.target.value })
                }
                placeholder="Hours"
                className={inputClass}
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="date"
                  value={demandForm.periodStart}
                  onChange={(e) =>
                    setDemandForm({
                      ...demandForm,
                      periodStart: e.target.value,
                    })
                  }
                  className={inputClass}
                />
                <input
                  type="date"
                  value={demandForm.periodEnd}
                  onChange={(e) =>
                    setDemandForm({ ...demandForm, periodEnd: e.target.value })
                  }
                  className={inputClass}
                />
              </div>
              <select
                value={demandForm.sourceKind}
                onChange={(e) =>
                  setDemandForm({ ...demandForm, sourceKind: e.target.value })
                }
                className={inputClass}
              >
                {RESOURCE_DEMAND_SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {s.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
              <select
                value={demandForm.workPackageId}
                onChange={(e) =>
                  setDemandForm({
                    ...demandForm,
                    workPackageId: e.target.value,
                  })
                }
                className={inputClass}
              >
                <option value="">No work package named</option>
                {packages.map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    {p.code}
                  </option>
                ))}
              </select>
              <input
                value={demandForm.basis}
                onChange={(e) =>
                  setDemandForm({ ...demandForm, basis: e.target.value })
                }
                placeholder="Where the hours came from (20 characters minimum)"
                className={inputClass}
              />
              <button
                onClick={() => void submitDemand()}
                disabled={busy}
                className="w-full rounded-lg border border-signal-cyan/30 bg-signal-cyan/10 px-2.5 py-1.5 text-xs font-semibold text-signal-cyan disabled:opacity-40"
              >
                Record demand
              </button>
            </div>
          </div>

          <div className="rounded-lg border border-white/8 bg-white/[0.02] p-3">
            <span className="text-[11px] font-semibold text-slate-300">
              Record capacity — the delivered-hours figure
            </span>
            <div className="mt-2 space-y-2">
              <select
                value={capacityForm.category}
                onChange={(e) =>
                  setCapacityForm({
                    ...capacityForm,
                    category: e.target.value as ResourceCategory,
                  })
                }
                className={inputClass}
              >
                {RESOURCE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {RESOURCE_CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
              <input
                value={capacityForm.pool}
                onChange={(e) =>
                  setCapacityForm({ ...capacityForm, pool: e.target.value })
                }
                placeholder="Pool"
                className={inputClass}
              />
              <input
                value={capacityForm.weeklyHours}
                onChange={(e) =>
                  setCapacityForm({
                    ...capacityForm,
                    weeklyHours: e.target.value,
                  })
                }
                placeholder="Weekly delivered hours"
                className={inputClass}
              />
              <input
                type="date"
                value={capacityForm.effectiveTo}
                onChange={(e) =>
                  setCapacityForm({
                    ...capacityForm,
                    effectiveTo: e.target.value,
                  })
                }
                placeholder="Effective to (optional)"
                className={inputClass}
              />
              <input
                value={capacityForm.basis}
                onChange={(e) =>
                  setCapacityForm({ ...capacityForm, basis: e.target.value })
                }
                placeholder="Basis (20 characters minimum)"
                className={inputClass}
              />
              <button
                onClick={() => void submitCapacity()}
                disabled={busy}
                className="w-full rounded-lg border border-white/15 px-2.5 py-1.5 text-xs text-slate-200 disabled:opacity-40"
              >
                Record capacity
              </button>
            </div>
          </div>

          <div className="rounded-lg border border-white/8 bg-white/[0.02] p-3">
            <span className="text-[11px] font-semibold text-slate-300">
              Itemize a deduction — explains the figure, never reduces it
            </span>
            <div className="mt-2 space-y-2">
              <select
                value={deductionForm.category}
                onChange={(e) =>
                  setDeductionForm({
                    ...deductionForm,
                    category: e.target.value as ResourceCategory,
                  })
                }
                className={inputClass}
              >
                {RESOURCE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {RESOURCE_CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
              <input
                value={deductionForm.pool}
                onChange={(e) =>
                  setDeductionForm({ ...deductionForm, pool: e.target.value })
                }
                placeholder="Pool"
                className={inputClass}
              />
              <select
                value={deductionForm.deductionKind}
                onChange={(e) =>
                  setDeductionForm({
                    ...deductionForm,
                    deductionKind: e.target.value,
                  })
                }
                className={inputClass}
              >
                {[
                  "leave",
                  "training",
                  "sickness",
                  "indirect_time",
                  "travel",
                  "toolbox_and_permits",
                  "standby",
                  "vacancy",
                ].map((k) => (
                  <option key={k} value={k}>
                    {k.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
              <input
                value={deductionForm.weeklyHours}
                onChange={(e) =>
                  setDeductionForm({
                    ...deductionForm,
                    weeklyHours: e.target.value,
                  })
                }
                placeholder="Weekly hours deducted"
                className={inputClass}
              />
              <input
                value={deductionForm.basis}
                onChange={(e) =>
                  setDeductionForm({ ...deductionForm, basis: e.target.value })
                }
                placeholder="Basis (20 characters minimum)"
                className={inputClass}
              />
              <button
                onClick={() => void submitDeduction()}
                disabled={busy}
                className="w-full rounded-lg border border-white/15 px-2.5 py-1.5 text-xs text-slate-200 disabled:opacity-40"
              >
                Record deduction
              </button>
            </div>
          </div>
        </div>
      )}
    </Section>
  );
}

/* ── D7.03 / D7.04 — competency ────────────────────────────────────────── */

const WHEN_NEEDED_TONE: Record<string, string> = {
  qualified_through: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
  // THE ROW. Qualified today, not qualified when the work happens — and it
  // wears red rather than the neutral register a bare "not held" would get,
  // because this is the one an ordinary check reports as available.
  expires_during_window: "border-red-400/30 bg-red-400/10 text-red-200",
  already_expired: "border-white/10 bg-white/[0.02] text-slate-400",
  not_held: "border-white/10 bg-white/[0.02] text-slate-400",
};

export function CompetencyReadinessPanel({
  packages,
  canPlan,
  reloadKey,
}: {
  packages: { id: number; code: string }[];
  canPlan: boolean;
  reloadKey?: number;
}) {
  const [packageId, setPackageId] = useState<string>("");
  const [readiness, setReadiness] = useState<CompetencyReadiness | null>(null);
  const [catalogue, setCatalogue] = useState<CompetencyCatalogue | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const [competencyForm, setCompetencyForm] = useState({
    competencyKey: "",
    title: "",
    kind: "certification",
    isStatutory: "false",
    validityMonths: "",
  });
  const [memberForm, setMemberForm] = useState({
    employeeRef: "",
    displayName: "",
    craft: "",
  });
  const [holdingForm, setHoldingForm] = useState({
    memberId: "",
    competencyId: "",
    expiresOn: "",
    evidenceReference: "",
  });
  const [shiftForm, setShiftForm] = useState({
    memberId: "",
    startsAt: "",
    endsAt: "",
    shiftKind: "day",
  });
  const [requirementForm, setRequirementForm] = useState({
    competencyId: "",
    craft: "",
    minHolders: "1",
    basis: "",
  });
  // THE THREE ACTS THE REFUSALS PROMISE. Each is opened from the row that
  // needs it rather than living in a form nobody connects to the problem.
  const [renewFor, setRenewFor] = useState<{
    memberCompetencyId: number;
    displayName: string;
    competencyTitle: string;
    expiresOn: string | null;
  } | null>(null);
  const [renewForm, setRenewForm] = useState({
    expiresOn: "",
    evidenceReference: "",
  });
  const [retireFor, setRetireFor] = useState<{
    requirementId: number;
    title: string;
  } | null>(null);
  const [retireReason, setRetireReason] = useState("");
  const [leaverForm, setLeaverForm] = useState({
    memberId: "",
    active: "false",
    reason: "",
  });

  const load = useCallback(async () => {
    setBusy(true);
    try {
      setCatalogue(await getCompetencyRequirements());
      if (packageId) {
        setReadiness(await getCompetencyReadiness(Number(packageId)));
      } else {
        setReadiness(null);
      }
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [packageId]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  const act = async (
    fn: () => Promise<{ answered: boolean; refusal?: string; note?: string }>,
  ) => {
    setBusy(true);
    try {
      const r = await fn();
      setNote(r.answered ? (r.note ?? "Recorded.") : (r.refusal ?? null));
      if (r.answered) await load();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const recordPosition = async () => {
    setBusy(true);
    try {
      const r = await computeCompetencyReadiness(Number(packageId));
      setReadiness(r);
      // A REFUSAL IS RECORDED TOO, and the note says so rather than reporting
      // success only when the position could be computed.
      setNote(
        `Recorded as run ${r.calculationRunId ?? "—"}. ${r.recordNote ?? r.refusal ?? ""}`,
      );
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title="Competency readiness (D7.03 · D7.04, spec I.23)"
      subtitle="Readiness is not fourteen people available — it is fourteen QUALIFIED people available WHEN NEEDED. Every question here is asked about the work window, so a certificate that lapses before the job makes its holder not qualified when needed, and says so by name."
    >
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={packageId}
          onChange={(e) => setPackageId(e.target.value)}
          className={`${inputClass} max-w-xs`}
        >
          <option value="">Choose a work package</option>
          {packages.map((p) => (
            <option key={p.id} value={String(p.id)}>
              {p.code}
            </option>
          ))}
        </select>
        <button
          onClick={() => void load()}
          disabled={busy}
          className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-40"
        >
          {busy ? "Reading…" : "Refresh"}
        </button>
        {/* The RECORD act. A read is a position now; this writes an immutable
            calculation_runs row (D11.29) — refusals included, so a history
            cannot show a clean run of readiness positions with the unassessed
            weeks missing. */}
        {canPlan && packageId && (
          <button
            onClick={() => void recordPosition()}
            disabled={busy}
            className="rounded-lg border border-signal-cyan/30 bg-signal-cyan/10 px-2.5 py-1.5 text-xs font-semibold text-signal-cyan disabled:opacity-40"
          >
            Record this position
          </button>
        )}
      </div>

      {note && (
        <p className="rounded border border-amber-400/25 bg-amber-400/5 px-2.5 py-2 text-xs whitespace-pre-wrap text-amber-100">
          {note}
        </p>
      )}

      {readiness && !readiness.answered && (
        <p className="rounded border border-amber-400/25 bg-amber-400/5 px-3 py-2 text-xs text-amber-200">
          {readiness.refusal}
        </p>
      )}

      {readiness?.answered && (
        <>
          <p className="text-[11px] text-slate-500">
            Window {readiness.windowStart} → {readiness.windowEnd} (from{" "}
            {readiness.windowFrom}) · {readiness.requirementsInScope}{" "}
            requirement(s) · {readiness.requirementsMet} met ·{" "}
            {readiness.requirementsShort} short ·{" "}
            {readiness.requirementsNotAssessable} not assessable ·{" "}
            {readiness.holdingsExpiringInWindow} holding(s) lapse inside the
            window
          </p>
          <ul className="space-y-2">
            {(readiness.requirements ?? []).map((req) => (
              <li
                key={req.requirementId}
                className="rounded-lg border border-white/8 bg-white/[0.02] p-3"
              >
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-xs font-semibold text-slate-100">
                    {req.competencyTitle}
                  </span>
                  {req.isStatutory && (
                    <span className="rounded border border-red-400/30 bg-red-400/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-200">
                      statutory
                    </span>
                  )}
                  <span className="rounded border border-white/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">
                    {req.state.replace(/_/g, " ")}
                  </span>
                  <span className="text-[11px] text-slate-500">
                    {req.scope === "craft"
                      ? `craft ${req.craft}`
                      : "this package"}{" "}
                    · needs {req.minHolders}
                  </span>
                </div>
                {/* THE SERVER'S SENTENCE. */}
                <p className="mt-1 text-xs text-slate-300">{req.detail}</p>
                <ul className="mt-2 flex flex-wrap gap-1">
                  {req.holders.map((h) => (
                    <li
                      key={h.memberId}
                      className={`flex items-center gap-1.5 rounded border px-2 py-1 text-[11px] ${
                        WHEN_NEEDED_TONE[h.whenNeeded] ??
                        "border-white/10 text-slate-400"
                      }`}
                    >
                      <span>
                        {h.displayName} · {h.whenNeeded.replace(/_/g, " ")}
                        {h.expiresOn ? ` · to ${h.expiresOn}` : " · no expiry"}
                        {h.rostered ? "" : " · not rostered"}
                      </span>
                      {/* THE ACT THAT FIXES WHAT THIS ROW DETECTS. D7.04's
                          headline is the expiring-certificate flip; until now
                          the product could name the lapse and offered no way
                          to record the renewal, because the holding is UNIQUE
                          per (member, competency) and the write path was
                          INSERT only. */}
                      {canPlan &&
                        h.memberCompetencyId != null &&
                        (h.whenNeeded === "expires_during_window" ||
                          h.whenNeeded === "already_expired") && (
                          <button
                            onClick={() =>
                              setRenewFor({
                                memberCompetencyId: h.memberCompetencyId!,
                                displayName: h.displayName,
                                competencyTitle: req.competencyTitle,
                                expiresOn: h.expiresOn,
                              })
                            }
                            className="rounded border border-signal-cyan/30 bg-signal-cyan/10 px-1.5 py-0.5 text-[10px] font-semibold text-signal-cyan"
                          >
                            Renew
                          </button>
                        )}
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-[11px] text-slate-500">{req.basis}</p>
              </li>
            ))}
          </ul>
          <RefusalList refusals={readiness.refusals} />
          {(readiness.labourRules ?? []).length > 0 && (
            <p className="text-[11px] text-slate-500">
              Labour rules bounding this roster, reported and not applied:{" "}
              {(readiness.labourRules ?? [])
                .map((r) => `${r.title} (${r.limitKind} ${r.limitValue})`)
                .join(" · ")}
            </p>
          )}
          <p className="text-[11px] text-slate-500">{readiness.basis}</p>
        </>
      )}

      {canPlan && catalogue?.answered && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div className="rounded-lg border border-white/8 bg-white/[0.02] p-3">
            <span className="text-[11px] font-semibold text-slate-300">
              A competency, and who holds it
            </span>
            <div className="mt-2 space-y-2">
              <input
                value={competencyForm.competencyKey}
                onChange={(e) =>
                  setCompetencyForm({
                    ...competencyForm,
                    competencyKey: e.target.value,
                  })
                }
                placeholder="Key, e.g. confined_space_entrant"
                className={inputClass}
              />
              <input
                value={competencyForm.title}
                onChange={(e) =>
                  setCompetencyForm({
                    ...competencyForm,
                    title: e.target.value,
                  })
                }
                placeholder="Title"
                className={inputClass}
              />
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={competencyForm.kind}
                  onChange={(e) =>
                    setCompetencyForm({
                      ...competencyForm,
                      kind: e.target.value,
                    })
                  }
                  className={inputClass}
                >
                  {[
                    "certification",
                    "licence",
                    "statutory_authorisation",
                    "skill",
                    "familiarisation",
                  ].map((k) => (
                    <option key={k} value={k}>
                      {k.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
                <input
                  value={competencyForm.validityMonths}
                  onChange={(e) =>
                    setCompetencyForm({
                      ...competencyForm,
                      validityMonths: e.target.value,
                    })
                  }
                  placeholder="Validity (months)"
                  className={inputClass}
                />
              </div>
              <label className="flex items-center gap-2 text-[11px] text-slate-400">
                <input
                  type="checkbox"
                  checked={competencyForm.isStatutory === "true"}
                  onChange={(e) =>
                    setCompetencyForm({
                      ...competencyForm,
                      isStatutory: e.target.checked ? "true" : "false",
                    })
                  }
                />
                Statutory — cannot be waived, and must state a validity period
              </label>
              <button
                onClick={() => void act(() => recordCompetency(competencyForm))}
                disabled={busy}
                className="w-full rounded-lg border border-white/15 px-2.5 py-1.5 text-xs text-slate-200 disabled:opacity-40"
              >
                Record competency
              </button>

              <div className="grid grid-cols-3 gap-2 pt-2">
                <input
                  value={memberForm.employeeRef}
                  onChange={(e) =>
                    setMemberForm({
                      ...memberForm,
                      employeeRef: e.target.value,
                    })
                  }
                  placeholder="Employee ref"
                  className={inputClass}
                />
                <input
                  value={memberForm.displayName}
                  onChange={(e) =>
                    setMemberForm({
                      ...memberForm,
                      displayName: e.target.value,
                    })
                  }
                  placeholder="Name"
                  className={inputClass}
                />
                <input
                  value={memberForm.craft}
                  onChange={(e) =>
                    setMemberForm({ ...memberForm, craft: e.target.value })
                  }
                  placeholder="Craft"
                  className={inputClass}
                />
              </div>
              <button
                onClick={() =>
                  void act(() => recordWorkforceMember(memberForm))
                }
                disabled={busy}
                className="w-full rounded-lg border border-white/15 px-2.5 py-1.5 text-xs text-slate-200 disabled:opacity-40"
              >
                Record workforce member
              </button>

              {/* §70: an AI identity is refused at the database on this act. */}
              <div className="grid grid-cols-2 gap-2 pt-2">
                <select
                  value={holdingForm.memberId}
                  onChange={(e) =>
                    setHoldingForm({
                      ...holdingForm,
                      memberId: e.target.value,
                    })
                  }
                  className={inputClass}
                >
                  <option value="">Member</option>
                  {(catalogue.members ?? []).map((m) => (
                    <option key={m.memberId} value={String(m.memberId)}>
                      {m.displayName}
                    </option>
                  ))}
                </select>
                <select
                  value={holdingForm.competencyId}
                  onChange={(e) =>
                    setHoldingForm({
                      ...holdingForm,
                      competencyId: e.target.value,
                    })
                  }
                  className={inputClass}
                >
                  <option value="">Competency</option>
                  {(catalogue.competencies ?? []).map((c) => (
                    <option key={c.competencyId} value={String(c.competencyId)}>
                      {c.title}
                    </option>
                  ))}
                </select>
              </div>
              <input
                type="date"
                value={holdingForm.expiresOn}
                onChange={(e) =>
                  setHoldingForm({ ...holdingForm, expiresOn: e.target.value })
                }
                className={inputClass}
              />
              <input
                value={holdingForm.evidenceReference}
                onChange={(e) =>
                  setHoldingForm({
                    ...holdingForm,
                    evidenceReference: e.target.value,
                  })
                }
                placeholder="Evidence — the certificate or assessment behind it"
                className={inputClass}
              />
              <button
                onClick={() =>
                  void act(() =>
                    recordMemberCompetency({
                      memberId: Number(holdingForm.memberId),
                      competencyId: Number(holdingForm.competencyId),
                      expiresOn: holdingForm.expiresOn || undefined,
                      evidenceReference: holdingForm.evidenceReference,
                    }),
                  )
                }
                disabled={busy}
                className="w-full rounded-lg border border-white/15 px-2.5 py-1.5 text-xs text-slate-200 disabled:opacity-40"
              >
                Declare this person competent (§70 — a person, never the agent)
              </button>
            </div>
          </div>

          <div className="rounded-lg border border-white/8 bg-white/[0.02] p-3">
            <span className="text-[11px] font-semibold text-slate-300">
              The roster, and what the work requires
            </span>
            <div className="mt-2 space-y-2">
              <select
                value={shiftForm.memberId}
                onChange={(e) =>
                  setShiftForm({ ...shiftForm, memberId: e.target.value })
                }
                className={inputClass}
              >
                <option value="">Member</option>
                {(catalogue.members ?? []).map((m) => (
                  <option key={m.memberId} value={String(m.memberId)}>
                    {m.displayName}
                  </option>
                ))}
              </select>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="datetime-local"
                  value={shiftForm.startsAt}
                  onChange={(e) =>
                    setShiftForm({ ...shiftForm, startsAt: e.target.value })
                  }
                  className={inputClass}
                />
                <input
                  type="datetime-local"
                  value={shiftForm.endsAt}
                  onChange={(e) =>
                    setShiftForm({ ...shiftForm, endsAt: e.target.value })
                  }
                  className={inputClass}
                />
              </div>
              <button
                onClick={() =>
                  void act(() =>
                    recordShiftAssignment({
                      memberId: Number(shiftForm.memberId),
                      startsAt: shiftForm.startsAt,
                      endsAt: shiftForm.endsAt,
                      shiftKind: shiftForm.shiftKind,
                    }),
                  )
                }
                disabled={busy}
                className="w-full rounded-lg border border-white/15 px-2.5 py-1.5 text-xs text-slate-200 disabled:opacity-40"
              >
                Roster a shift
              </button>

              <div className="grid grid-cols-2 gap-2 pt-2">
                <select
                  value={requirementForm.competencyId}
                  onChange={(e) =>
                    setRequirementForm({
                      ...requirementForm,
                      competencyId: e.target.value,
                    })
                  }
                  className={inputClass}
                >
                  <option value="">Competency</option>
                  {(catalogue.competencies ?? []).map((c) => (
                    <option key={c.competencyId} value={String(c.competencyId)}>
                      {c.title}
                    </option>
                  ))}
                </select>
                <input
                  value={requirementForm.craft}
                  onChange={(e) =>
                    setRequirementForm({
                      ...requirementForm,
                      craft: e.target.value,
                    })
                  }
                  placeholder="Craft it applies to"
                  className={inputClass}
                />
              </div>
              <input
                value={requirementForm.minHolders}
                onChange={(e) =>
                  setRequirementForm({
                    ...requirementForm,
                    minHolders: e.target.value,
                  })
                }
                placeholder="How many holders the work needs"
                className={inputClass}
              />
              <input
                value={requirementForm.basis}
                onChange={(e) =>
                  setRequirementForm({
                    ...requirementForm,
                    basis: e.target.value,
                  })
                }
                placeholder="The regulation, standard or hazard it comes from (20 characters minimum)"
                className={inputClass}
              />
              <button
                onClick={() =>
                  void act(() =>
                    recordCompetencyRequirement({
                      competencyId: Number(requirementForm.competencyId),
                      craft: requirementForm.craft || undefined,
                      minHolders: requirementForm.minHolders,
                      basis: requirementForm.basis,
                    }),
                  )
                }
                disabled={busy}
                className="w-full rounded-lg border border-signal-cyan/30 bg-signal-cyan/10 px-2.5 py-1.5 text-xs font-semibold text-signal-cyan disabled:opacity-40"
              >
                Record the requirement
              </button>

              {(catalogue.requirements ?? []).length > 0 && (
                <ul className="mt-2 space-y-1">
                  {(catalogue.requirements ?? []).map((r) => (
                    <li
                      key={r.requirementId}
                      className="rounded border border-white/8 px-2 py-1 text-[11px] text-slate-400"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span>
                          {r.competencyTitle} ·{" "}
                          {r.scope === "craft"
                            ? `craft ${r.craft}`
                            : (r.packageCode ?? "package")}{" "}
                          · needs {r.minHolders}
                          {r.retired ? " · retired" : ""}
                        </span>
                        {/* RETIRE, WIRED. `uq_competency_requirement_live`
                            refuses a second live requirement at the same
                            scope and the integrity trigger refuses a DELETE,
                            so restating a revised standard REQUIRES this act —
                            and nothing in the product called it, which made a
                            competency requirement write-once and permanent
                            from every customer surface. */}
                        {canPlan && !r.retired && (
                          <button
                            onClick={() =>
                              setRetireFor({
                                requirementId: r.requirementId,
                                title: r.competencyTitle,
                              })
                            }
                            className="rounded border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-200"
                          >
                            Retire
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* ── THE LEAVER ACT. `workforce_members.active` gates every count
                   above and could only ever be set at INSERT, so a departed
                   person stayed qualified and rostered forever in a metric a
                   crew relies on. */}
            <div className="space-y-1.5 rounded-lg border border-white/8 bg-white/[0.02] p-2.5">
              <p className="text-[11px] font-semibold text-slate-300">
                On or off the roster
              </p>
              <select
                value={leaverForm.memberId}
                onChange={(e) =>
                  setLeaverForm({ ...leaverForm, memberId: e.target.value })
                }
                className={inputClass}
              >
                <option value="">Choose a workforce member</option>
                {(catalogue.members ?? []).map((m) => (
                  <option key={m.memberId} value={String(m.memberId)}>
                    {m.displayName} ({m.employeeRef})
                    {m.active === false ? " — inactive" : ""}
                  </option>
                ))}
              </select>
              <select
                value={leaverForm.active}
                onChange={(e) =>
                  setLeaverForm({ ...leaverForm, active: e.target.value })
                }
                className={inputClass}
              >
                <option value="false">Take off the roster</option>
                <option value="true">Put back on the roster</option>
              </select>
              <textarea
                value={leaverForm.reason}
                onChange={(e) =>
                  setLeaverForm({ ...leaverForm, reason: e.target.value })
                }
                placeholder="Why — this changes numbers a crew relies on"
                className={`${inputClass} h-14`}
              />
              <button
                onClick={() =>
                  void act(() =>
                    setWorkforceMemberActive({
                      memberId: Number(leaverForm.memberId),
                      active: leaverForm.active === "true",
                      reason: leaverForm.reason,
                    }),
                  )
                }
                disabled={busy}
                className="w-full rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-40"
              >
                Record the change
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── RENEW. Opened from the holder row whose certificate lapses inside
             the window, which is the row D7.04 exists to produce. */}
      {renewFor && (
        <div className="space-y-1.5 rounded-lg border border-signal-cyan/30 bg-signal-cyan/5 p-3">
          <p className="text-xs font-semibold text-slate-100">
            Renew {renewFor.competencyTitle} for {renewFor.displayName}
          </p>
          <p className="text-[11px] text-slate-400">
            The existing holding runs to{" "}
            {renewFor.expiresOn ?? "no stated expiry"}. One member holds one
            competency once, so this SUPERSEDES that holding in place rather
            than adding a second one; the previous dates and evidence stay in
            the audit record.
          </p>
          <input
            type="date"
            value={renewForm.expiresOn}
            onChange={(e) =>
              setRenewForm({ ...renewForm, expiresOn: e.target.value })
            }
            className={inputClass}
          />
          <input
            value={renewForm.evidenceReference}
            onChange={(e) =>
              setRenewForm({
                ...renewForm,
                evidenceReference: e.target.value,
              })
            }
            placeholder="The new certificate, assessment or authorisation"
            className={inputClass}
          />
          <div className="flex gap-2">
            <button
              onClick={() =>
                void act(async () => {
                  const r = await renewMemberCompetency({
                    memberCompetencyId: renewFor.memberCompetencyId,
                    evidenceReference: renewForm.evidenceReference,
                    expiresOn: renewForm.expiresOn || undefined,
                  });
                  if (r.answered) {
                    setRenewFor(null);
                    setRenewForm({ expiresOn: "", evidenceReference: "" });
                  }
                  return r;
                })
              }
              disabled={busy}
              className="rounded-lg border border-signal-cyan/30 bg-signal-cyan/10 px-2.5 py-1.5 text-xs font-semibold text-signal-cyan disabled:opacity-40"
            >
              Record the renewal
            </button>
            <button
              onClick={() => setRenewFor(null)}
              className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-white/5"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── RETIRE. A requirement is retired with a reason, never deleted. */}
      {retireFor && (
        <div className="space-y-1.5 rounded-lg border border-amber-400/30 bg-amber-400/5 p-3">
          <p className="text-xs font-semibold text-slate-100">
            Retire the requirement for {retireFor.title}
          </p>
          <p className="text-[11px] text-slate-400">
            The requirement is kept and marked retired, so what the job was said
            to need last quarter stays readable. Restating a revised standard
            needs this first: a second live requirement at the same scope is
            refused, and a delete is refused outright.
          </p>
          <textarea
            value={retireReason}
            onChange={(e) => setRetireReason(e.target.value)}
            placeholder="Why this requirement no longer applies"
            className={`${inputClass} h-14`}
          />
          <div className="flex gap-2">
            <button
              onClick={() =>
                void act(async () => {
                  const r = await retireCompetencyRequirement(
                    retireFor.requirementId,
                    retireReason,
                  );
                  if (r.answered) {
                    setRetireFor(null);
                    setRetireReason("");
                  }
                  return r;
                })
              }
              disabled={busy}
              className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-2.5 py-1.5 text-xs font-semibold text-amber-200 disabled:opacity-40"
            >
              Retire it
            </button>
            <button
              onClick={() => setRetireFor(null)}
              className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-white/5"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </Section>
  );
}

/* ── D7.08 / D7.20 / D7.13 / D7.14 — the four percentages, on the case ───── */

/**
 * The metrics BESIDE THE PACKAGES THEY ARE ABOUT, with the window a planner
 * chooses.
 *
 * This is not a duplicate of the /sync-field composition and it is not here
 * to satisfy a gate. `get_sync_field_module` composes ONE reading — a horizon,
 * with the workface look-ahead derived from it — because a composed module has
 * to pick something. The question a planner actually asks is "what does the
 * week after next look like", and answering it means calling the metric
 * functions with an explicit window, which the composition does not offer.
 *
 * The RECORD act is here for the same reason. A read is a position now; a
 * `compute_` call writes an immutable `calculation_runs` row (D11.29) that
 * can be read back verbatim afterwards, and somebody has to be able to press
 * it. The burn-down panel Slice 7A shipped works exactly this way.
 */
export function WorkfaceMetricsPanel({
  caseId,
  canPlan,
  reloadKey,
}: {
  caseId: string;
  canPlan: boolean;
  reloadKey?: number;
}) {
  const [index, setIndex] = useState<ConstraintFreeWorkIndex | null>(null);
  const [workface, setWorkface] = useState<WorkfaceExecutionMetrics | null>(
    null,
  );
  const [horizonDays, setHorizonDays] = useState("90");
  const [windowStart, setWindowStart] = useState("");
  const [windowEnd, setWindowEnd] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const days = Number(horizonDays);
      const [i, w] = await Promise.all([
        getConstraintFreeWorkIndex(
          caseId,
          Number.isFinite(days) && days > 0 ? days : 90,
        ),
        getWorkfaceExecutionMetrics(
          caseId,
          windowStart || null,
          windowEnd || null,
        ),
      ]);
      setIndex(i);
      setWorkface(w);
      setNote(null);
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [caseId, horizonDays, windowStart, windowEnd]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  const record = async () => {
    setBusy(true);
    try {
      const days = Number(horizonDays);
      const i = await computeConstraintFreeWorkIndex(
        caseId,
        Number.isFinite(days) && days > 0 ? days : 90,
      );
      const w = await computeWorkfaceExecutionMetrics(
        caseId,
        windowStart || null,
        windowEnd || null,
      );
      setIndex(i);
      setWorkface(w);
      // A REFUSAL IS RECORDED TOO, so the note says what was written either
      // way rather than reporting success only when a number came back.
      setNote(
        `Recorded. Constraint-free run ${i.calculationRunId ?? "—"}; workface run ${w.calculationRunId ?? "—"}. ${
          i.recordNote ?? i.refusal ?? ""
        }`,
      );
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title="Constraint-free work and the workface (D7.08 · D7.20 · D7.13 · D7.14)"
      subtitle="Spec §49's index and spec I.28's forward figure are ONE calculation over work packages; spec II.5's two percentages are over the crew's own unit, the job. None of the four divides the same set, and each refuses rather than dividing over an empty denominator — 0 of 0 is neither 0% nor 100%."
    >
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label
            className="block text-[11px] text-slate-400"
            htmlFor="s7c-horizon-days"
          >
            Index horizon (days)
          </label>
          <input
            id="s7c-horizon-days"
            value={horizonDays}
            onChange={(e) => setHorizonDays(e.target.value)}
            className={`${inputClass} w-24`}
          />
        </div>
        <div>
          <label
            className="block text-[11px] text-slate-400"
            htmlFor="s7c-window-start"
          >
            Workface window
          </label>
          <div className="flex gap-2">
            <input
              id="s7c-window-start"
              type="date"
              value={windowStart}
              onChange={(e) => setWindowStart(e.target.value)}
              className={`${inputClass} w-40`}
            />
            <input
              type="date"
              value={windowEnd}
              onChange={(e) => setWindowEnd(e.target.value)}
              className={`${inputClass} w-40`}
            />
          </div>
        </div>
        <button
          onClick={() => void load()}
          disabled={busy}
          className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-40"
        >
          {busy ? "Reading…" : "Refresh"}
        </button>
        {canPlan && (
          <button
            onClick={() => void record()}
            disabled={busy}
            className="rounded-lg border border-signal-cyan/30 bg-signal-cyan/10 px-2.5 py-1.5 text-xs font-semibold text-signal-cyan disabled:opacity-40"
          >
            Record this position
          </button>
        )}
      </div>

      {note && (
        <p className="rounded border border-white/8 bg-white/[0.02] px-2.5 py-2 text-xs whitespace-pre-wrap text-slate-300">
          {note}
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Ratio
          label="Constraint-Free Work Index"
          ratio={index?.constraintFreeWorkIndex}
          registerRef="D7.20 · §49"
        />
        <Ratio
          label="Forward constraint-free work"
          ratio={index?.forwardConstraintFreeWork}
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

      {/* COVERAGE BESIDE THE PERCENTAGES, not only in the prose below them.
          A "100% — 1 of 1" tile over ten planned jobs with nine unassessable
          reads as a project position, and the subtitle "1 of 1" reinforces the
          wrong reading rather than correcting it. Both halves carry it now. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Ratio
          label="Constraint assessment coverage"
          ratio={index?.assessmentCoverage}
          registerRef="D7.20 · how much of the planned set the index is about"
        />
        <Ratio
          label="Workface assessment coverage"
          ratio={workface?.assessmentCoverage}
          registerRef="D7.13/D7.14 · how much of the planned set they are about"
        />
      </div>

      {index && !index.answered && (
        <p className="rounded border border-amber-400/25 bg-amber-400/5 px-3 py-2 text-xs text-amber-200">
          {index.refusal}
        </p>
      )}
      {index?.answered && (
        <>
          <p className="text-[11px] text-slate-500">
            {index.plannedPackages} planned package(s) inside the{" "}
            {index.horizonDays}-day window · {index.assessedPackages} assessed ·{" "}
            {index.unassessedPackages} with no constraint recorded at all ·{" "}
            {index.stalePackages} whose recorded assessment the stores have
            moved past · {index.notProjectable} that cannot be projected
          </p>
          {/* THE OVERDUE SET IS OUTSIDE THE WINDOW AND IS NAMED FOR IT. It is
              excluded from every denominator above — a percentage about "the
              next N days" cannot be computed from work due last year — so it
              is printed here rather than left to a reader to notice. */}
          {(index.overduePackages ?? 0) > 0 && (
            <div className="rounded border border-amber-400/25 bg-amber-400/5 px-3 py-2">
              <p className="text-[11px] font-semibold text-amber-200">
                {index.overduePackages} unreleased package(s) were needed on a
                date that has already passed — outside this window, and counted
                in none of the percentages above.
              </p>
              <ul className="mt-1 space-y-0.5">
                {(index.overdue ?? []).map((p) => (
                  <li key={p.packageId} className="text-[11px] text-amber-100">
                    {p.packageCode} — needed {p.requiredBy}, {p.daysOverdue}{" "}
                    day(s) ago
                  </li>
                ))}
              </ul>
            </div>
          )}
          <RefusalList refusals={index.refusals} />
        </>
      )}

      {workface && !workface.answered && (
        <p className="rounded border border-amber-400/25 bg-amber-400/5 px-3 py-2 text-xs text-amber-200">
          {workface.refusal}
        </p>
      )}
      {workface?.answered && (
        <>
          <p className="text-[11px] text-slate-500">
            {workface.plannedWorkOrders} planned job(s) between{" "}
            {workface.windowStart} and {workface.windowEnd} ·{" "}
            {workface.assessableWorkOrders} assessable ·{" "}
            {workface.packageUnassessedWorkOrders} in a work package with no
            constraint recorded at all · {workface.notAssessableWorkOrders} the
            predicate refused to answer for ·{" "}
            {workface.packageBlockedWorkOrders} field-ready but held back by
            their package · {workface.readyNotStarted} ready and not started
          </p>
          <RefusalList refusals={workface.refusals} />
        </>
      )}
    </Section>
  );
}

/**
 * The case-workspace entry point. Reads the case's packages ONCE and hands
 * the two panels the same list, so a package selector and a demand line
 * cannot disagree about which packages exist.
 */
export function WorkforcePanel({
  caseId,
  canPlan,
  canApprove,
  reloadKey,
}: {
  caseId: string;
  canPlan: boolean;
  canApprove: boolean;
  reloadKey?: number;
}) {
  const [packages, setPackages] = useState<{ id: number; code: string }[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        const p = await getCaseWorkPackages(caseId);
        setPackages(
          (p.packages ?? []).map((row) => ({
            id: row.packageId,
            code: `${row.packageCode} — ${row.title}`,
          })),
        );
      } catch {
        // A package list this panel cannot read is not a reason to hide the
        // panel: the demand and capacity halves work without one, and the
        // selectors simply offer nothing.
        setPackages([]);
      }
    })();
  }, [caseId, reloadKey]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <HardHat className="h-4 w-4 text-signal-cyan" aria-hidden />
        <span className="text-sm font-semibold text-slate-100">
          Workforce and workface (Slice 7C)
        </span>
      </div>
      <ResourceBalancePanel
        caseId={caseId}
        canPlan={canPlan}
        canApprove={canApprove}
        packages={packages}
        reloadKey={reloadKey}
      />
      <CompetencyReadinessPanel
        packages={packages}
        canPlan={canPlan}
        reloadKey={reloadKey}
      />
      <WorkfaceMetricsPanel
        caseId={caseId}
        canPlan={canPlan}
        reloadKey={reloadKey}
      />
    </div>
  );
}
