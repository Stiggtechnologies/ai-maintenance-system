/**
 * Sync Develop Slice 7A — Advanced Work Packaging.
 *
 *   D7.17 (§27)  the typed WorkPackage, five types, on the canonical work
 *                identity: this panel packages work_orders and never creates
 *                one, because `work_orders` IS the work (RULING 19).
 *   D7.10 (II.4) the EWP → PWP → CWP → IWP chain. The parent selector offers
 *                only packages one level up; the DATABASE refuses a skipped
 *                level and a wrong-typed parent for every writer, and this
 *                only decides which options to show.
 *   D7.18 (§28)  the ten Constraint types, recorded against a package on the
 *                ONE constraint store (RULING 20). Permit, isolation and
 *                asset-state are not offered a hand-clear control at all —
 *                Recovery's rule, not a project-path exemption.
 *   D7.07 (I.28) the FORWARD burn-down: what will block this package and
 *                when, and the recorded history of every projection taken.
 *
 * Slice 7B adds the FIELD-READY half on the same one engine (RULING 22):
 *
 *   D7.12 (II.5) the ten field-ready elements per work order, SEVEN derived
 *                from canonical stores and THREE reported `unverifiable`
 *                because no store answers them. The panel renders the third
 *                answer in its own register — an element nobody can check is
 *                never shown the way a cleared one is.
 *   D7.11 (II.4) WHICH element blocks, beside the constraint holding it, not
 *                a count of how many do.
 *   D7.05 (I.27) the assessment itself: `assess_package_field_readiness`
 *                walks the elements and records what is missing as
 *                constraints the ONE release verdict already refuses on.
 *
 * EVERY NUMBER HERE COMES FROM THE SERVER. There is one forward projection
 * (`get_package_constraint_burndown`), one readiness verdict
 * (`release_work_package`) and one history (`calculation_runs`), and this file
 * re-derives none of them — the 6A `packageLateness` / 6B `warrantyCover`
 * lesson.
 *
 * A REFUSAL IS AN ANSWER and is rendered as prose, never as an error and
 * never as a zero. "No constraint recorded" is shown as UNASSESSED, in the
 * words the server used, because "0 open constraints" reads as ready.
 */
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Boxes } from "lucide-react";

import {
  AWP_ACRONYMS,
  AWP_PACKAGE_TYPES,
  SPEC28_CONSTRAINT_TYPES,
  awpParentType,
  canClearByHand,
  canonicalConstraintKind,
  eligibleParents,
  parseBurndownHorizon,
  parseClearanceProbability,
  parseScheduleImpactDays,
} from "../../lib/develop/workPackaging";
import {
  fieldReadyCoverage,
  fieldReadyTone,
  isStoreDerivedFieldReadyRow,
} from "../../lib/develop/fieldReadiness";
import {
  assessPackageFieldReadiness,
  assignWorkToPackage,
  cancelWorkPackage,
  clearPackageConstraint,
  computePackageConstraintBurndown,
  forecastPackageConstraint,
  getCaseWorkPackages,
  getPackageBurndownHistory,
  getPackageFieldReadiness,
  listCaseWorkOrderOptions,
  recordPackageConstraint,
  recordWorkPackage,
  releaseWorkPackage,
  type CaseWorkPackages,
  type FieldReadinessAssessment,
  type FieldReadyElementRow,
  type PackageBurndown,
  type PackageBurndownHistory,
  type PackageFieldReadiness,
  type WorkPackageRow,
} from "../../services/developService";

const inputClass =
  "w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-signal-cyan/50 focus:outline-none";
const btnClass =
  "rounded-lg bg-signal-cyan/15 px-3 py-1.5 text-xs font-semibold text-signal-cyan hover:bg-signal-cyan/25 disabled:opacity-40";

function Section({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-white/6 bg-[#0D1520] p-5">
      <div className="flex items-center gap-2">
        {icon}
        <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
      </div>
      <p className="mt-1 text-xs text-slate-400">{subtitle}</p>
      <div className="mt-3 space-y-3">{children}</div>
    </div>
  );
}

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div className="rounded border border-red-400/30 bg-red-400/10 px-2.5 py-1.5 text-xs text-red-300">
      {error}
    </div>
  );
}

function Refusal({ text }: { text: string | null | undefined }) {
  if (!text) return null;
  return (
    <div className="rounded border border-amber-400/25 bg-amber-400/5 px-2.5 py-1.5 text-xs text-amber-200">
      {text}
    </div>
  );
}

/** An absent figure is stated as absent — `?? 0` is how a blank becomes a fact. */
function num(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? "not stated"
    : String(value);
}

function dateOr(value: string | null | undefined, absent: string): string {
  return value ? value : absent;
}

/* ────────── D7.12 / D7.11 / D7.05 — the ten field-ready elements ────────── */

/**
 * The visual register for an element state.
 *
 * `unverifiable` gets its OWN colour, and that is the point rather than a
 * flourish: if an element no store can answer rendered like a cleared one, a
 * supervisor reading this panel would see "nobody has checked" as "checked and
 * clear" — the exact reading spec §27 exists to prevent, arriving through CSS.
 */
const ELEMENT_TONE: Record<string, string> = {
  positive: "border-emerald-400/25 bg-emerald-400/5 text-emerald-200",
  negative: "border-red-400/30 bg-red-400/10 text-red-200",
  neutral: "border-white/10 bg-white/[0.02] text-slate-400",
  caution: "border-amber-400/25 bg-amber-400/5 text-amber-200",
  unknown: "border-white/10 bg-white/[0.02] text-slate-400",
};

function ElementRow({ element }: { element: FieldReadyElementRow }) {
  const tone = ELEMENT_TONE[fieldReadyTone(element.state)];
  return (
    <li className={`rounded border px-2 py-1.5 text-[11px] ${tone}`}>
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-semibold">{element.label}</span>
        <span className="uppercase tracking-wide">
          {element.state.replace(/_/g, " ")}
        </span>
        <span className="text-slate-500">
          {element.basisKind === "derived"
            ? element.source
            : "no canonical store"}
        </span>
      </div>
      <p className="mt-0.5 text-slate-300">{element.detail}</p>
      {element.constraint && (
        <p className="mt-0.5 text-slate-400">
          Held by a {element.constraintKind ?? "constraint"} constraint —{" "}
          {element.constraint.state}
          {element.constraint.verifiedAt
            ? ` (verified ${element.constraint.verifiedAt.slice(0, 10)})`
            : " (nobody has verified it)"}
          {element.constraint.ownerRole
            ? ` · owner ${element.constraint.ownerRole}`
            : ""}
        </p>
      )}
    </li>
  );
}

function FieldReadinessPanel({
  pkg,
  canPlan,
  onChanged,
}: {
  pkg: WorkPackageRow;
  canPlan: boolean;
  onChanged: () => void;
}) {
  const [view, setView] = useState<PackageFieldReadiness | null>(null);
  const [assessment, setAssessment] = useState<FieldReadinessAssessment | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const coverage = fieldReadyCoverage();

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setView(await getPackageFieldReadiness(pkg.packageId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [pkg.packageId]);

  const assess = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await assessPackageFieldReadiness(pkg.packageId);
      setAssessment(result);
      setView(await getPackageFieldReadiness(pkg.packageId));
      // The assessment writes constraints, so the package's own verdict and
      // constraint counts have moved. Re-read them from the server rather than
      // adjusting the numbers on screen.
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [pkg.packageId, onChanged]);

  return (
    <div className="rounded-lg border border-white/6 bg-white/[0.02] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-slate-200">
          Field readiness (spec II.5) — the ten elements, per job
        </span>
        <span className="text-[10px] text-slate-500">
          {/* DERIVED FROM THE VOCABULARY, not counted inline beside it. D7.12's
              row claims "7 of 10"; `fieldReadyCoverage` IS that claim, and an
              eleventh element or a new store moves this sentence with it. */}
          {coverage.derived} of {coverage.total} read from a canonical store;
          the other {coverage.declared} have none and are declared by a person
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          onClick={() => void load()}
          disabled={busy}
          className={btnClass}
        >
          {busy ? "Reading…" : "Show the elements"}
        </button>
        <button
          onClick={() => void assess()}
          disabled={busy || !canPlan || pkg.releasedAt !== null}
          className={btnClass}
        >
          Assess and record what is missing
        </button>
      </div>
      <ErrorLine error={error} />

      {assessment && !assessment.answered && (
        <Refusal text={assessment.refusal} />
      )}
      {assessment?.answered && (
        <p className="mt-2 text-[11px] text-slate-300">
          {num(assessment.derivedBlockersRecorded)} derived blocker(s) recorded,{" "}
          {num(assessment.derivedQuestionsRaised)} element(s) no store could
          answer and {num(assessment.declaredQuestionsRaised)} question(s)
          raised that no store can answer at all, over{" "}
          {num(assessment.workOrders)} work order(s). {assessment.note}
        </p>
      )}

      {view && !view.answered && <Refusal text={view.refusal} />}
      {view?.answered && (
        <div className="mt-2 space-y-2">
          {/* ASSESSED IS A FACT. A package nobody has walked says so, rather
              than rendering ten live element states as though someone had. */}
          <Refusal text={view.assessed ? null : view.assessmentNote} />
          {view.assessed && (
            <p className="text-[11px] text-slate-400">{view.assessmentNote}</p>
          )}
          {/* The readiness sentence is the SERVER'S, verbatim — the same one
              release_work_package refuses with. Never restated here. */}
          <p className="text-[11px] text-slate-300">{view.readiness}</p>
          {/* WHERE THE RECORDED ASSESSMENT NO LONGER DESCRIBES THE WORK. The
              server itemizes these behind its own `stale` verdict; this list
              is that array, not a client-side comparison. */}
          {(view.fieldReadinessGaps ?? []).length > 0 && (
            <ul className="space-y-1">
              {(view.fieldReadinessGaps ?? []).map((gap) => (
                <li
                  key={`${gap.workOrderId}-${gap.element}`}
                  className="rounded border border-red-400/25 bg-red-400/5 px-2 py-1.5 text-[11px] text-red-200"
                >
                  <span className="font-semibold">
                    {gap.woNumber ?? "—"} · {gap.label}
                  </span>{" "}
                  <span className="uppercase tracking-wide text-slate-400">
                    {gap.reason.replace(/_/g, " ")}
                  </span>
                  <p className="mt-0.5 text-slate-300">{gap.detail}</p>
                </li>
              ))}
            </ul>
          )}
          {(view.items ?? []).map((item) => (
            <div key={item.workOrderId}>
              <div className="text-[11px] font-semibold text-slate-200">
                {item.woNumber ?? "—"} · {item.title}
                <span className="ml-2 font-normal text-slate-500">
                  {num(item.ready)} ready · {num(item.blocked)} blocked ·{" "}
                  {num(item.notApplicable)} n/a · {num(item.unverifiable)} not
                  verifiable
                </span>
              </div>
              <ul className="mt-1 space-y-1">
                {item.elements.map((element) => (
                  <ElementRow key={element.key} element={element} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ───────────────────── D7.07 — the forward burn-down ─────────────────────── */

function BurndownPanel({
  pkg,
  canPlan,
}: {
  pkg: WorkPackageRow;
  canPlan: boolean;
}) {
  const [horizon, setHorizon] = useState("90");
  const [result, setResult] = useState<PackageBurndown | null>(null);
  const [history, setHistory] = useState<PackageBurndownHistory | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const take = useCallback(async () => {
    const parsed = parseBurndownHorizon(horizon);
    if (!parsed.ok) {
      setError(parsed.refusal);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // The RECORDING call: the projection and its lineage row are one act.
      setResult(
        await computePackageConstraintBurndown(pkg.packageId, parsed.value),
      );
      setHistory(await getPackageBurndownHistory(pkg.packageId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [horizon, pkg.packageId]);

  return (
    <div className="rounded-lg border border-white/6 bg-white/[0.02] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-slate-200">
          Constraint burn-down (spec I.28) — what will block this package, and
          when
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          value={horizon}
          onChange={(e) => setHorizon(e.target.value)}
          placeholder="Horizon in days"
          className={`${inputClass} max-w-[10rem]`}
        />
        <button
          onClick={() => void take()}
          disabled={busy || !canPlan}
          className={btnClass}
        >
          {busy ? "Projecting…" : "Take a burn-down"}
        </button>
      </div>
      <ErrorLine error={error} />
      {result && !result.answered && <Refusal text={result.refusal} />}
      {result?.answered && (
        <div className="mt-2 space-y-2 text-xs text-slate-300">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <span>
              As of {result.asOf} · horizon {result.horizonDays} days (to{" "}
              {result.horizonEnd})
            </span>
            <span>{result.constraintsRecorded} recorded</span>
            <span>{result.openConstraints} open</span>
            <span className="text-red-300">{result.willBlock} will block</span>
            <span className="text-red-300">
              {result.lapsed} lapsed forecast
            </span>
            <span className="text-emerald-300">
              {result.expectedClear} expected clear
            </span>
            <span className="text-amber-300">
              {result.unforecast} unforecast
            </span>
            <span className="text-amber-300">
              {result.notAssessable} not assessable
            </span>
          </div>
          <div>
            Projected constraint-free:{" "}
            {result.forecastComplete && result.projectedConstraintFreeDate
              ? result.projectedConstraintFreeDate
              : "REFUSED"}
          </div>
          <Refusal text={result.projectedConstraintFreeRefusal} />
          {(result.refusals ?? []).map((r, i) => (
            <Refusal key={i} text={r.reason} />
          ))}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-[11px]">
              <thead className="text-slate-500">
                <tr>
                  <th className="py-1 pr-2">Constraint</th>
                  <th className="py-1 pr-2">Required by</th>
                  <th className="py-1 pr-2">Expected clear</th>
                  <th className="py-1 pr-2">P(clear)</th>
                  <th className="py-1 pr-2">Impact (d)</th>
                  <th className="py-1 pr-2">Forecast</th>
                </tr>
              </thead>
              <tbody>
                {(result.constraints ?? []).map((c) => (
                  <tr key={c.constraintId} className="border-t border-white/5">
                    <td className="py-1 pr-2">
                      {c.kind}
                      {c.isHard ? " (hard)" : ""} — {c.description}
                    </td>
                    <td className="py-1 pr-2">
                      {dateOr(c.requiredBy, "not dated")}
                    </td>
                    <td className="py-1 pr-2">
                      {dateOr(c.expectedClearDate, "unforecast")}
                    </td>
                    <td className="py-1 pr-2">
                      {num(c.probabilityOfClearance)}
                    </td>
                    <td className="py-1 pr-2">{num(c.scheduleImpactDays)}</td>
                    <td className="py-1 pr-2">
                      {c.forecast}
                      {c.daysLate !== null && c.daysLate !== undefined
                        ? c.forecast === "lapsed"
                          ? ` (forecast passed ${c.daysLate}d ago)`
                          : ` (${c.daysLate}d late)`
                        : ""}
                      {c.daysBeyondHorizon !== null &&
                      c.daysBeyondHorizon !== undefined
                        ? ` (${c.daysBeyondHorizon}d beyond the horizon)`
                        : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-slate-500">{result.basis}</p>
          {result.calculationRunId && (
            <p className="text-[11px] text-slate-500">
              Recorded as calculation run {result.calculationRunId} ·{" "}
              {result.codeVersion}
            </p>
          )}
        </div>
      )}
      {history && !history.answered && <Refusal text={history.refusal} />}
      {history?.answered && (
        <div className="mt-2 text-[11px] text-slate-400">
          <p className="font-semibold text-slate-300">
            Recorded history — {history.runCount} projection(s), read back as
            written and never recomputed
          </p>
          <ul className="mt-1 space-y-0.5">
            {(history.runs ?? []).map((r) => (
              <li key={r.runId}>
                {r.computedAt} · {r.status} ·{" "}
                {r.outputs
                  ? `${String((r.outputs as Record<string, unknown>).willBlock ?? "—")} will block`
                  : `refused: ${r.refusals[0]?.reason ?? ""}`}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ───────────────────── D7.18 — the §28 constraints ──────────────────────── */

function ConstraintsPanel({
  pkg,
  canPlan,
  onChanged,
}: {
  pkg: WorkPackageRow;
  canPlan: boolean;
  onChanged: () => void;
}) {
  const [type, setType] = useState<string>(SPEC28_CONSTRAINT_TYPES[0]);
  const [description, setDescription] = useState("");
  const [basis, setBasis] = useState("");
  const [ownerRole, setOwnerRole] = useState("");
  const [requiredBy, setRequiredBy] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [forecastFor, setForecastFor] = useState<string>("");
  const [expected, setExpected] = useState("");
  const [probability, setProbability] = useState("");
  const [probabilityBasis, setProbabilityBasis] = useState("");
  const [impact, setImpact] = useState("");
  const [impactBasis, setImpactBasis] = useState("");
  const [clearBasis, setClearBasis] = useState("");

  const add = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await recordPackageConstraint(pkg.packageId, {
        constraint_type: type,
        description,
        basis,
        owner_role: ownerRole || undefined,
        required_by: requiredBy || undefined,
      });
      setDescription("");
      setBasis("");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [
    pkg.packageId,
    type,
    description,
    basis,
    ownerRole,
    requiredBy,
    onChanged,
  ]);

  const forecast = useCallback(async () => {
    if (!forecastFor) return;
    if (probability.trim() !== "") {
      const parsed = parseClearanceProbability(probability, probabilityBasis);
      if (!parsed.ok) {
        setError(parsed.refusal);
        return;
      }
    }
    if (impact.trim() !== "") {
      const parsed = parseScheduleImpactDays(impact, impactBasis);
      if (!parsed.ok) {
        setError(parsed.refusal);
        return;
      }
    }
    setBusy(true);
    setError(null);
    try {
      await forecastPackageConstraint(forecastFor, {
        expected_clear_date: expected || undefined,
        probability_of_clearance: probability || undefined,
        probability_basis: probabilityBasis || undefined,
        schedule_impact_days: impact || undefined,
        impact_basis: impactBasis || undefined,
      });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [
    forecastFor,
    expected,
    probability,
    probabilityBasis,
    impact,
    impactBasis,
    onChanged,
  ]);

  const clear = useCallback(
    async (constraintId: string, state: string) => {
      setBusy(true);
      setError(null);
      try {
        await clearPackageConstraint(constraintId, state, clearBasis);
        setClearBasis("");
        onChanged();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [clearBasis, onChanged],
  );

  return (
    <div className="rounded-lg border border-white/6 bg-white/[0.02] p-3">
      <p className="text-xs font-semibold text-slate-200">
        Constraints (spec §28) — {pkg.constraints.recorded} recorded ·{" "}
        {pkg.constraints.openHard} hard open · {pkg.constraints.satisfied}{" "}
        satisfied
      </p>
      {pkg.constraints.recorded === 0 && (
        <Refusal text="UNASSESSED — no constraint has been recorded against this package. That is not constraint-free, and the release refuses over it." />
      )}
      <ul className="mt-2 space-y-1 text-[11px] text-slate-300">
        {pkg.constraints.items.map((c) => (
          <li key={c.constraintId} className="border-t border-white/5 pt-1">
            <span className="text-slate-200">{c.kind}</span>
            {c.isHard ? " (hard)" : " (soft)"} · {c.state} · {c.description}
            {" · required by "}
            {dateOr(c.requiredBy, "not dated")}
            {" · expected clear "}
            {dateOr(c.expectedClearDate, "unforecast")}
            {canPlan &&
              c.state !== "satisfied" &&
              canClearByHand(c.kind) &&
              !isStoreDerivedFieldReadyRow(c.sourceRef) && (
                <button
                  onClick={() => void clear(c.constraintId, "satisfied")}
                  disabled={busy}
                  className="ml-2 rounded bg-emerald-400/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 hover:bg-emerald-400/20 disabled:opacity-40"
                >
                  Verify satisfied
                </button>
              )}
            {canPlan && !canClearByHand(c.kind) && (
              <span className="ml-2 text-amber-300/80">
                permit / isolation / asset-state truth comes from the canonical
                operating and release controls, not a toggle
              </span>
            )}
            {/* A ROW THE ASSESSMENT DERIVED FROM A STORE has no toggle, and the
                screen says why rather than showing a button the door refuses. */}
            {canPlan &&
              canClearByHand(c.kind) &&
              isStoreDerivedFieldReadyRow(c.sourceRef) && (
                <span className="ml-2 text-amber-300/80">
                  raised from a canonical store — change what the store says and
                  re-assess; there is no toggle for it
                </span>
              )}
          </li>
        ))}
      </ul>
      {canPlan && (
        <>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className={inputClass}
            >
              {SPEC28_CONSTRAINT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t} → {canonicalConstraintKind(t)}
                </option>
              ))}
            </select>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is the constraint?"
              className={inputClass}
            />
            <input
              value={basis}
              onChange={(e) => setBasis(e.target.value)}
              placeholder="Basis (where this comes from)"
              className={inputClass}
            />
            <input
              value={ownerRole}
              onChange={(e) => setOwnerRole(e.target.value)}
              placeholder="Owner role"
              className={inputClass}
            />
            <input
              value={requiredBy}
              onChange={(e) => setRequiredBy(e.target.value)}
              placeholder="Required by (YYYY-MM-DD)"
              className={inputClass}
            />
            <button
              onClick={() => void add()}
              disabled={busy}
              className={btnClass}
            >
              Record constraint
            </button>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <select
              value={forecastFor}
              onChange={(e) => setForecastFor(e.target.value)}
              className={inputClass}
            >
              <option value="">Forecast a constraint…</option>
              {pkg.constraints.items.map((c) => (
                <option key={c.constraintId} value={c.constraintId}>
                  {c.kind} — {c.description.slice(0, 40)}
                </option>
              ))}
            </select>
            <input
              value={expected}
              onChange={(e) => setExpected(e.target.value)}
              placeholder="Expected clear date (YYYY-MM-DD)"
              className={inputClass}
            />
            <input
              value={probability}
              onChange={(e) => setProbability(e.target.value)}
              placeholder="Probability of clearance (0–1)"
              className={inputClass}
            />
            <input
              value={probabilityBasis}
              onChange={(e) => setProbabilityBasis(e.target.value)}
              placeholder="Basis for that probability (20 characters)"
              className={`${inputClass} sm:col-span-2`}
            />
            <input
              value={impact}
              onChange={(e) => setImpact(e.target.value)}
              placeholder="Schedule impact (days)"
              className={inputClass}
            />
            <input
              value={impactBasis}
              onChange={(e) => setImpactBasis(e.target.value)}
              placeholder="Basis for that impact"
              className={`${inputClass} sm:col-span-2`}
            />
            <button
              onClick={() => void forecast()}
              disabled={busy || !forecastFor}
              className={btnClass}
            >
              Record forecast
            </button>
          </div>
          <input
            value={clearBasis}
            onChange={(e) => setClearBasis(e.target.value)}
            placeholder="Evidence for verifying a constraint satisfied"
            className={`${inputClass} mt-2`}
          />
        </>
      )}
      <ErrorLine error={error} />
    </div>
  );
}

/* ───────────────────── D7.17 / D7.10 — the package ──────────────────────── */

function PackageCard({
  pkg,
  packages,
  workOrders,
  canPlan,
  canRelease,
  onChanged,
}: {
  pkg: WorkPackageRow;
  packages: WorkPackageRow[];
  workOrders: { id: string; label: string }[];
  canPlan: boolean;
  canRelease: boolean;
  onChanged: () => void;
}) {
  const [workOrderId, setWorkOrderId] = useState("");
  const [assignBasis, setAssignBasis] = useState("");
  const [releaseNote, setReleaseNote] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const assign = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await assignWorkToPackage(pkg.packageId, workOrderId, assignBasis);
      setAssignBasis("");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [pkg.packageId, workOrderId, assignBasis, onChanged]);

  const release = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await releaseWorkPackage(pkg.packageId, releaseNote);
      setReleaseNote("");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [pkg.packageId, releaseNote, onChanged]);

  const cancel = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await cancelWorkPackage(pkg.packageId, cancelReason);
      setCancelReason("");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [pkg.packageId, cancelReason, onChanged]);

  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.02] p-4">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="rounded bg-signal-cyan/10 px-1.5 py-0.5 text-[10px] font-semibold text-signal-cyan">
          L{pkg.level}{" "}
          {AWP_ACRONYMS[pkg.packageType as keyof typeof AWP_ACRONYMS]}
        </span>
        <span className="text-sm font-semibold text-slate-100">
          {pkg.packageCode} — {pkg.title}
        </span>
        <span className="text-xs text-slate-400">{pkg.status}</span>
        {pkg.parentPackageCode && (
          <span className="text-xs text-slate-500">
            under {pkg.parentPackageCode} ({pkg.parentType ?? "type unknown"})
          </span>
        )}
      </div>
      {pkg.parentTypeDiverges && (
        <Refusal
          text={`Broken chain: this ${pkg.packageType} package must hang from a ${pkg.parentTypeExpected} package, and ${pkg.parentPackageCode} is ${pkg.parentType}. The database refuses to create or reach this state; if you are seeing it, the row predates that rule and cannot be released until the chain is repaired.`}
        />
      )}
      <p className="mt-1 text-xs text-slate-400">{pkg.scope}</p>
      <p className="mt-1 text-xs text-slate-300">{pkg.readiness}</p>

      <div className="mt-2 text-[11px] text-slate-400">
        <span className="font-semibold text-slate-300">
          Work in this package
        </span>
        {pkg.workOrders.length === 0 ? (
          <span> — none yet</span>
        ) : (
          <ul className="mt-1 space-y-0.5">
            {pkg.workOrders.map((w) => (
              <li key={w.workOrderId}>
                {w.woNumber ?? "—"} · {w.title} · execution:{" "}
                {w.executionStatus ?? "not recorded"}
              </li>
            ))}
          </ul>
        )}
      </div>

      {canPlan && pkg.releasedAt === null && (
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <select
            value={workOrderId}
            onChange={(e) => setWorkOrderId(e.target.value)}
            className={inputClass}
          >
            <option value="">Add a work order…</option>
            {workOrders.map((w) => (
              <option key={w.id} value={w.id}>
                {w.label}
              </option>
            ))}
          </select>
          <input
            value={assignBasis}
            onChange={(e) => setAssignBasis(e.target.value)}
            placeholder="Why this work belongs here (20 characters)"
            className={`${inputClass} sm:col-span-2`}
          />
          <button
            onClick={() => void assign()}
            disabled={busy || !workOrderId}
            className={btnClass}
          >
            Add to package
          </button>
        </div>
      )}

      <div className="mt-3 space-y-3">
        <ConstraintsPanel pkg={pkg} canPlan={canPlan} onChanged={onChanged} />
        <FieldReadinessPanel
          pkg={pkg}
          canPlan={canPlan}
          onChanged={onChanged}
        />
        <BurndownPanel pkg={pkg} canPlan={canPlan} />
      </div>

      {canRelease && pkg.releasedAt === null && pkg.status !== "cancelled" && (
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <input
            value={releaseNote}
            onChange={(e) => setReleaseNote(e.target.value)}
            placeholder="What you are releasing, and on what basis (20 characters)"
            className={`${inputClass} sm:col-span-2`}
          />
          <button
            onClick={() => void release()}
            disabled={busy}
            className="rounded-lg bg-emerald-400/10 border border-emerald-400/30 px-3 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-400/20 disabled:opacity-40"
          >
            {busy ? "Checking constraints…" : "Release this package"}
          </button>
        </div>
      )}
      {pkg.releasedAt && (
        <p className="mt-2 text-[11px] text-emerald-300/80">
          Released {pkg.releasedAt} by {pkg.releasedBy ?? "a named person"} —{" "}
          {pkg.releaseNote}
        </p>
      )}
      {/* The withdrawal the DELETE refusals name. It is offered on a released
          package too: without it, "Cancel it instead" was a remedy the product
          named and did not provide. The release record is preserved. */}
      {canRelease && pkg.status !== "cancelled" && (
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <input
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            placeholder="Why this package is being withdrawn (20 characters)"
            className={`${inputClass} sm:col-span-2`}
          />
          <button
            onClick={() => void cancel()}
            disabled={busy}
            className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs font-semibold text-amber-300 hover:bg-amber-400/20 disabled:opacity-40"
          >
            {busy ? "Withdrawing…" : "Cancel this package"}
          </button>
        </div>
      )}
      {/* Parent options are shown so the chain rule is visible rather than
          only enforced: the database refuses a skipped level for every writer. */}
      {pkg.parentTypeExpected && !pkg.parentPackageCode && (
        <Refusal
          text={`This ${pkg.packageType} package hangs from a ${pkg.parentTypeExpected} package. Eligible parents on this case: ${
            eligibleParents(pkg.packageType, packages)
              .map((p) => p.packageCode)
              .join(", ") || "none recorded yet"
          }.`}
        />
      )}
      <ErrorLine error={error} />
    </div>
  );
}

export function WorkPackagingPanel({
  caseId,
  canPlan,
  canRelease,
  reloadKey,
}: {
  caseId: string;
  canPlan: boolean;
  canRelease: boolean;
  reloadKey?: number;
}) {
  const [data, setData] = useState<CaseWorkPackages | null>(null);
  const [workOrders, setWorkOrders] = useState<{ id: string; label: string }[]>(
    [],
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);

  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const [type, setType] = useState<string>(AWP_PACKAGE_TYPES[0]);
  const [scope, setScope] = useState("");
  const [parentCode, setParentCode] = useState("");
  const [requiredBy, setRequiredBy] = useState("");

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const [packages, orders] = await Promise.all([
          getCaseWorkPackages(caseId),
          listCaseWorkOrderOptions(),
        ]);
        if (!live) return;
        setData(packages);
        setWorkOrders(orders);
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      live = false;
    };
  }, [caseId, reloadKey, tick]);

  const create = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await recordWorkPackage(caseId, {
        package_code: code,
        title,
        package_type: type,
        scope,
        parent_package_code: parentCode || undefined,
        required_by: requiredBy || undefined,
      });
      setCode("");
      setTitle("");
      setScope("");
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [caseId, code, title, type, scope, parentCode, requiredBy, reload]);

  const packages = data?.packages ?? [];
  const parentOptions = eligibleParents(type, packages);

  return (
    <Section
      icon={<Boxes className="h-4 w-4 text-signal-cyan" />}
      title="Advanced Work Packaging"
      subtitle="Spec II.4 and §27/§28: the typed EWP → PWP → CWP → IWP chain on the canonical work identity, the ten constraint types on the canonical constraint store, and a forward burn-down that says what will block each package and when."
    >
      {data && !data.answered && <Refusal text={data.refusal} />}
      {canPlan && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Package code"
            className={inputClass}
          />
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title"
            className={inputClass}
          />
          <select
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              setParentCode("");
            }}
            className={inputClass}
          >
            {AWP_PACKAGE_TYPES.map((t) => (
              <option key={t} value={t}>
                {AWP_ACRONYMS[t]} — {t}
              </option>
            ))}
          </select>
          <input
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            placeholder="Scope statement (20 characters minimum)"
            className={`${inputClass} sm:col-span-2`}
          />
          <input
            value={requiredBy}
            onChange={(e) => setRequiredBy(e.target.value)}
            placeholder="Required by (YYYY-MM-DD)"
            className={inputClass}
          />
          {awpParentType(type) !== null && (
            <select
              value={parentCode}
              onChange={(e) => setParentCode(e.target.value)}
              className={`${inputClass} sm:col-span-2`}
            >
              <option value="">
                Parent {awpParentType(type)} package (required)…
              </option>
              {parentOptions.map((p) => (
                <option key={p.packageCode} value={p.packageCode}>
                  {p.packageCode} — {p.title}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={() => void create()}
            disabled={busy}
            className={btnClass}
          >
            {busy ? "Recording…" : "Record package"}
          </button>
        </div>
      )}
      <ErrorLine error={error} />
      {packages.map((p) => (
        <PackageCard
          key={p.packageId}
          pkg={p}
          packages={packages}
          workOrders={workOrders}
          canPlan={canPlan}
          canRelease={canRelease}
          onChanged={reload}
        />
      ))}
      {data?.answered && (
        <p className="text-[11px] text-slate-500">{data.basis}</p>
      )}
    </Section>
  );
}
