/**
 * Sync Develop Slice 4B — the §44 Performance sections of the Case
 * Workspace: rules of credit and progress claims (D5.06), the earned value
 * metric suite (D5.05), the eight-dimension estimate basis (D5.16) and the
 * confidence that travels with every forecast (D5.17), the progress
 * integrity cross-check (D5.20) and the §51 forecast presentation
 * (D5.07/D5.32).
 *
 * HONESTY RULES, inherited from ControlsPanels and sharpened for numbers
 * people budget against:
 *
 *   * NO METRIC WITHOUT LINEAGE. Every figure here is rendered from a
 *     RECORDED calculation_runs row and from nothing else.
 *     get_case_performance also embeds the LIVE reads; those record nothing,
 *     so they are used ONLY for their refusals (which are statements, not
 *     figures), for the row listings, and to detect that a recorded run's
 *     inputs have moved.
 *
 *   * A REFUSAL RENDERS IN PLACE OF THE NUMBER, never beside a blank. A blank
 *     cell where a CPI belongs is how a refusal becomes an implied 1.0.
 *
 *   * NO PERCENTILE WITHOUT A DISTRIBUTION. The P50 and P80 cells are
 *     rendered as "not available" with the reason attached, on both the cost
 *     and the schedule side. There is no code path in this file that derives
 *     a percentile from a deterministic figure and there must never be one:
 *     a fabricated P80 looks exactly like a simulated one, and nothing on the
 *     screen would reveal the difference.
 *
 *   * A CLAIM NAMES A STEP. The progress form has no percent field. The
 *     percent comes back from the server, derived from the cited rule of
 *     credit, and is displayed as what the rule earned rather than as what
 *     anybody typed.
 *
 *   * UNRATED IS NOT LOW. The confidence chip prints a different word for
 *     "no basis recorded" than for "the estimate is weak", because those
 *     justify different decisions.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  Activity,
  CalendarRange,
  ClipboardCheck,
  Gauge,
  Ruler,
  ScrollText,
  TrendingUp,
} from "lucide-react";
import {
  EARNED_VALUE_METRICS,
  ESTIMATE_BASIS_DIMENSIONS,
  ESTIMATE_CLASSES,
  PROGRESS_EVIDENCE_SOURCES,
  QUOTATION_SUPPORT_LEVELS,
  RULE_OF_CREDIT_WORK_TYPES,
  SCOPE_MATURITIES,
  confidenceLabel,
  coverageSuffix,
  earnedValueFingerprint,
  estimateConfidenceFingerprint,
  forecastConfidenceFingerprint,
  hasRunOutputs,
  earnedValueHeadline,
  formatPerformanceValue,
  integrityHeadline,
  metricDisplay,
  percentileCell,
  performanceRunIsStale,
  performanceTrendFingerprint,
  previewCumulativeCredit,
  progressIntegrityFingerprint,
  trendSentence,
  validateRuleSteps,
  type CasePerformance,
  type PerformanceCalculationRun,
} from "../../lib/develop/performance";
import {
  closeProgressPeriod,
  computeCaseEarnedValue,
  computeCaseEstimateConfidence,
  computeCaseForecastConfidence,
  computeCasePerformanceTrend,
  computeCaseProgressIntegrity,
  getCasePerformance,
  openProgressPeriod,
  recordEstimateBasis,
  recordProgressClaim,
  recordProgressEvidence,
  recordRuleOfCredit,
  setPeriodPlannedProgress,
  setWbsElementWorkType,
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

/** A refusal is an ANSWER, so it is rendered as prose and never as an error. */
function Refusal({ text }: { text: string | null | undefined }) {
  if (!text) return null;
  return (
    <div className="rounded border border-amber-400/25 bg-amber-400/5 px-2.5 py-1.5 text-xs text-amber-200">
      {text}
    </div>
  );
}

function ConfidenceChip({
  band,
  label,
  coverage,
}: {
  band: "high" | "medium" | "low" | "unrated" | null | undefined;
  label: string;
  /** D5.20 Rule 3: a band quoted without its coverage is a false impression. */
  coverage?: string | null;
}) {
  const c = confidenceLabel(band);
  const tone =
    c.tone === "good"
      ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
      : c.tone === "warn"
        ? "border-amber-400/30 bg-amber-400/10 text-amber-200"
        : c.tone === "bad"
          ? "border-red-400/30 bg-red-400/10 text-red-200"
          : "border-slate-400/25 bg-slate-400/5 text-slate-300";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] font-semibold ${tone}`}
    >
      {label} {c.text}
      {coverage != null && (
        <span className="font-normal opacity-80">· {coverage}</span>
      )}
    </span>
  );
}

/**
 * The lineage of one displayed figure, openable beside it.
 *
 * A `<summary>` is visible whether the block is open or closed, so printing
 * the code version there left it on screen two lines under the stale warning
 * that exists to suppress it. `stale` suppresses it in both places or in
 * neither.
 */
function LineageBlock({
  run,
  stale = false,
}: {
  run: PerformanceCalculationRun | undefined;
  stale?: boolean;
}) {
  if (run == null) {
    return (
      <p className="text-[11px] text-slate-500">
        No calculation has been recorded for this figure yet. Nothing is shown
        above that was not computed and recorded — press Compute to produce one.
      </p>
    );
  }
  return (
    <details className="rounded-md border border-white/5 bg-white/[0.02] px-2.5 py-2">
      <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        Lineage · {stale ? "superseded inputs" : run.codeVersion} ·{" "}
        {new Date(run.computedAt).toLocaleString()}
      </summary>
      <div className="mt-2 space-y-1 text-xs text-slate-400">
        <p>
          <span className="text-slate-500">Method: </span>
          {run.method}
        </p>
        <p>
          <span className="text-slate-500">Computed by: </span>
          {run.computedBy ?? "system"} · status {run.status}
        </p>
        <p className="font-mono text-[11px] text-slate-500">
          inputs {JSON.stringify(run.inputs)}
        </p>
        <p className="text-[11px] text-slate-500">
          {run.inputRefs.length} input row(s) referenced
        </p>
        {run.refusals.length > 0 && (
          <ul className="space-y-1">
            {run.refusals.map((r, i) => (
              <li key={i} className="text-amber-200">
                {r}
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}

/**
 * The caption under a figure taken from a recorded run.
 *
 * A run whose recorded input fingerprint no longer matches the live read is
 * STALE — still defensible, no longer current — and its code-version caption
 * is suppressed so a moved figure cannot look freshly computed.
 */
function RunCaption({
  run,
  stale,
}: {
  run: PerformanceCalculationRun | undefined;
  stale: boolean;
}) {
  if (run == null) return null;
  if (stale) {
    return (
      <p className="text-[11px] text-amber-300">
        The inputs behind this figure have changed since it was recorded. It is
        what was computed then, not what would be computed now — compute again
        to bring it up to date.
      </p>
    );
  }
  return (
    <p className="text-[11px] text-slate-500">
      Recorded {new Date(run.computedAt).toLocaleString()} · code version{" "}
      {run.codeVersion}
    </p>
  );
}

/* ── reading a RECORDED run without inventing anything from it ────────── */

function numberOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function bandOrNull(v: unknown): "high" | "medium" | "low" | "unrated" | null {
  return v === "high" || v === "medium" || v === "low" || v === "unrated"
    ? v
    : null;
}

/**
 * The per-element breakdown AS RECORDED on the earned-value run.
 *
 * Nothing is computed here and nothing is filled in: a row missing a field
 * is dropped rather than defaulted, because a zero element budget printed
 * beside a percentage is exactly the fabricated figure this slice refuses.
 */
function recordedElements(outputs: Record<string, unknown>): {
  wbsCode: string;
  claimedPercent: number;
  stepLabel: string;
  ruleRef: string;
  periodRef: string;
  carriedForward: boolean;
  elementBudget: number;
}[] {
  const raw = outputs.claimedElements;
  if (!Array.isArray(raw)) return [];
  const out: ReturnType<typeof recordedElements> = [];
  for (const e of raw) {
    if (e == null || typeof e !== "object") continue;
    const r = e as Record<string, unknown>;
    const budget = numberOrNull(r.elementBudget);
    const percent = numberOrNull(r.claimedPercent);
    if (
      typeof r.wbsCode !== "string" ||
      budget == null ||
      percent == null ||
      typeof r.stepLabel !== "string" ||
      typeof r.ruleRef !== "string"
    ) {
      continue;
    }
    out.push({
      wbsCode: r.wbsCode,
      claimedPercent: percent,
      stepLabel: r.stepLabel,
      ruleRef: r.ruleRef,
      periodRef: typeof r.periodRef === "string" ? r.periodRef : "",
      carriedForward: r.carriedForward === true,
      elementBudget: budget,
    });
  }
  return out;
}

/* ───────────────────── rules of credit and progress ──────────────────── */

function RulesOfCreditSection({
  caseId,
  performance,
  canPlan,
  onChanged,
}: {
  caseId: string;
  performance: CasePerformance;
  canPlan: boolean;
  onChanged: () => void;
}) {
  const [ruleRef, setRuleRef] = useState("");
  const [title, setTitle] = useState("");
  const [appliesTo, setAppliesTo] = useState<string>(
    RULE_OF_CREDIT_WORK_TYPES[0].value,
  );
  const [basis, setBasis] = useState("");
  const [stepsText, setStepsText] = useState(
    "Issued for review:30\nIssued for approval:30\nIssued for construction:40",
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const steps = useMemo(
    () =>
      stepsText
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
        .map((l) => {
          const at = l.lastIndexOf(":");
          return {
            step: at < 0 ? l : l.slice(0, at).trim(),
            weight: at < 0 ? NaN : Number(l.slice(at + 1).trim()),
          };
        }),
    [stepsText],
  );
  const stepProblem = validateRuleSteps(steps);
  const cumulative = previewCumulativeCredit(steps);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await recordRuleOfCredit({
        caseId,
        ruleRef,
        title,
        appliesTo,
        basis,
        steps,
      });
      setRuleRef("");
      setTitle("");
      setBasis("");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not record the rule");
    } finally {
      setBusy(false);
    }
  };

  const { rules, workTypesWithoutARule } = performance.progress;

  return (
    <Section
      icon={<Ruler className="h-4 w-4 text-signal-cyan" aria-hidden />}
      title="Rules of credit (D5.06)"
      subtitle="How progress is EARNED, per work type. A claim names a step; the percent is derived here and can never be typed."
    >
      <ErrorLine error={error} />
      {rules.length === 0 ? (
        <Refusal
          text={
            performance.progress.refusal ??
            "No rule of credit is recorded, so no progress can be claimed on this case at all."
          }
        />
      ) : (
        <ul className="space-y-2">
          {rules.map((r) => (
            <li
              key={r.id}
              className="rounded-md border border-white/5 bg-white/[0.02] px-2.5 py-2"
            >
              <p className="text-xs font-semibold text-slate-200">
                {r.ruleRef} · {r.title}
              </p>
              <p className="text-[11px] text-slate-500">
                {r.appliesTo.replaceAll("_", " ")} · {r.method} · {r.claimCount}{" "}
                claim(s)
              </p>
              <ol className="mt-1 space-y-0.5 text-xs text-slate-300">
                {r.steps.map((s, i) => (
                  <li key={i}>
                    {i + 1}. {s.step}{" "}
                    <span className="text-slate-500">
                      — earns {s.weight}% (cumulative{" "}
                      {previewCumulativeCredit(r.steps)[i]}%)
                    </span>
                  </li>
                ))}
              </ol>
              <p className="mt-1 text-[11px] text-slate-500">
                Basis: {r.basis}
              </p>
            </li>
          ))}
        </ul>
      )}

      {workTypesWithoutARule.length > 0 && (
        <p className="text-[11px] text-slate-500">
          No rule of credit yet for:{" "}
          {workTypesWithoutARule.map((w) => w.replaceAll("_", " ")).join(", ")}.
          Progress claimed against these work types is refused, not credited.
        </p>
      )}

      {canPlan && (
        <div className="space-y-2 rounded-md border border-white/5 bg-white/[0.02] p-2.5">
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              className={inputClass}
              placeholder="Rule reference (ROC-ENG-01)"
              value={ruleRef}
              onChange={(e) => setRuleRef(e.target.value)}
            />
            <input
              className={inputClass}
              placeholder="Title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <select
              className={inputClass}
              value={appliesTo}
              onChange={(e) => setAppliesTo(e.target.value)}
            >
              {RULE_OF_CREDIT_WORK_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            <input
              className={inputClass}
              placeholder="Basis — where the weights come from"
              value={basis}
              onChange={(e) => setBasis(e.target.value)}
            />
          </div>
          <textarea
            className={inputClass}
            rows={4}
            value={stepsText}
            onChange={(e) => setStepsText(e.target.value)}
            placeholder="One step per line: label:weight"
          />
          <p className="text-[11px] text-slate-500">
            Cumulative credit as typed: {cumulative.join("% → ")}%
          </p>
          {stepProblem && <Refusal text={stepProblem} />}
          <button
            type="button"
            className={btnClass}
            disabled={busy || stepProblem != null}
            onClick={() => void submit()}
          >
            Record rule of credit
          </button>
        </div>
      )}
    </Section>
  );
}

function ProgressSection({
  caseId,
  performance,
  canPlan,
  canReview,
  onChanged,
}: {
  caseId: string;
  performance: CasePerformance;
  canPlan: boolean;
  canReview: boolean;
  onChanged: () => void;
}) {
  const { progress } = performance;
  const [periodRef, setPeriodRef] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [planned, setPlanned] = useState("");
  const [plannedBasis, setPlannedBasis] = useState("");
  const [closeNote, setCloseNote] = useState("");
  const [wbsCode, setWbsCode] = useState("");
  const [stepIndex, setStepIndex] = useState("1");
  const [claimBasis, setClaimBasis] = useState("");
  const [typeCode, setTypeCode] = useState("");
  const [workType, setWorkType] = useState<string>(
    RULE_OF_CREDIT_WORK_TYPES[0].value,
  );
  const [typeBasis, setTypeBasis] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The element the claim is against, so the work type can be SHOWN rather
  // than offered. It is an attribute of the element, recorded by its own act.
  const claimElement = useMemo(
    () =>
      progress.elements.find(
        (e) => e.wbsCode.trim() === wbsCode.trim() && wbsCode.trim() !== "",
      ) ?? null,
    [progress.elements, wbsCode],
  );

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The act was refused");
    } finally {
      setBusy(false);
    }
  };

  const latest = progress.latestPeriod;

  return (
    <Section
      icon={<CalendarRange className="h-4 w-4 text-signal-cyan" aria-hidden />}
      title="Reporting periods and claimed progress (D5.06)"
      subtitle="Progress is claimed INTO a period. Trending reads the runs recorded while each period was current — it never recomputes history."
    >
      <ErrorLine error={error} />

      {progress.periods.length === 0 ? (
        <Refusal text="No reporting period is recorded on this case, so there is nowhere to claim progress into and no time axis to trend along." />
      ) : (
        <ul className="space-y-1">
          {progress.periods.map((p) => (
            <li
              key={p.id}
              className="rounded-md border border-white/5 bg-white/[0.02] px-2.5 py-1.5 text-xs text-slate-300"
            >
              <span className="font-mono text-slate-200">{p.periodRef}</span> ·
              ends {p.periodEnd} · {p.status} · {p.claimCount} claim(s) ·{" "}
              {p.plannedPercentComplete == null ? (
                <span className="text-amber-300">
                  no planned percent — planned value refuses on this period
                </span>
              ) : (
                <span>planned {p.plannedPercentComplete}% complete</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {latest != null && (
        <div className="rounded-md border border-white/5 bg-white/[0.02] px-2.5 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Claimed positions in {latest.periodRef} ·{" "}
            {progress.latestPeriodClaims.length}
          </p>
          {progress.latestPeriodClaims.length === 0 ? (
            <p className="mt-1 text-xs text-slate-500">
              {progress.refusal ??
                "Nothing is claimed in this period. That is an empty claim set, not a measured zero."}
            </p>
          ) : (
            <ul className="mt-1 space-y-1 text-xs text-slate-300">
              {progress.latestPeriodClaims.map((c) => (
                <li key={c.id}>
                  <span className="font-mono text-slate-200">{c.wbsCode}</span>{" "}
                  — {c.stepLabel} under {c.ruleRef} ={" "}
                  <span className="text-slate-100">{c.claimedPercent}%</span>{" "}
                  <span className="text-slate-500">
                    (derived from the rule, not entered)
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {canPlan && (
        <div className="grid gap-2 rounded-md border border-white/5 bg-white/[0.02] p-2.5 sm:grid-cols-3">
          <input
            className={inputClass}
            placeholder="Period ref (2026-M01)"
            value={periodRef}
            onChange={(e) => setPeriodRef(e.target.value)}
          />
          <input
            className={inputClass}
            type="date"
            value={periodEnd}
            onChange={(e) => setPeriodEnd(e.target.value)}
          />
          <button
            type="button"
            className={btnClass}
            disabled={busy}
            onClick={() =>
              void act(() =>
                openProgressPeriod({ caseId, periodRef, periodEnd }),
              )
            }
          >
            Open period
          </button>
        </div>
      )}

      {canReview && latest != null && latest.status === "open" && (
        <div className="grid gap-2 rounded-md border border-white/5 bg-white/[0.02] p-2.5 sm:grid-cols-3">
          <input
            className={inputClass}
            placeholder="Planned % complete at period end"
            value={planned}
            onChange={(e) => setPlanned(e.target.value)}
          />
          <input
            className={inputClass}
            placeholder="Basis for the planned curve"
            value={plannedBasis}
            onChange={(e) => setPlannedBasis(e.target.value)}
          />
          <button
            type="button"
            className={btnClass}
            disabled={busy}
            onClick={() =>
              void act(() =>
                setPeriodPlannedProgress({
                  periodId: latest.id,
                  percent: planned,
                  basis: plannedBasis,
                }),
              )
            }
          >
            Set planned progress
          </button>
          <p className="text-[11px] text-slate-500 sm:col-span-3">
            The planned curve is the time-phased cost baseline planned value is
            read off, so setting it is a baseline act: governance or engineering
            roles only, and refused to the AI-operator identity by name (§70).
          </p>
        </div>
      )}

      {progress.elementsWithoutAWorkType > 0 && (
        <Refusal
          text={`${progress.elementsWithoutAWorkType} WBS element(s) on this case carry no recorded work type, so no rule of credit resolves for them and a claim against any of them is refused by name. The work type is recorded on the element, never stated in a claim: a work type chosen at claim time is a percent chosen at claim time.`}
        />
      )}

      {canPlan && (
        <div className="grid gap-2 rounded-md border border-white/5 bg-white/[0.02] p-2.5 sm:grid-cols-4">
          <input
            className={inputClass}
            placeholder="WBS code"
            value={typeCode}
            onChange={(e) => setTypeCode(e.target.value)}
          />
          <select
            className={inputClass}
            value={workType}
            onChange={(e) => setWorkType(e.target.value)}
          >
            {RULE_OF_CREDIT_WORK_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <input
            className={inputClass}
            placeholder="Basis — why this element is that kind of work"
            value={typeBasis}
            onChange={(e) => setTypeBasis(e.target.value)}
          />
          <button
            type="button"
            className={btnClass}
            disabled={busy}
            onClick={() =>
              void act(() =>
                setWbsElementWorkType({
                  caseId,
                  wbsCode: typeCode,
                  workType,
                  basis: typeBasis,
                }),
              )
            }
          >
            Record the work type
          </button>
          <p className="text-[11px] text-slate-500 sm:col-span-4">
            Recording an element&apos;s work type decides which rule of credit
            every percent complete on it is derived from, so it is a progress
            judgement one level up: refused to the AI-operator identity by name
            (§70), and immutable once the element carries a claim.
          </p>
        </div>
      )}

      {canPlan && latest != null && latest.status === "open" && (
        <div className="grid gap-2 rounded-md border border-white/5 bg-white/[0.02] p-2.5 sm:grid-cols-2">
          <input
            className={inputClass}
            placeholder="WBS code"
            value={wbsCode}
            onChange={(e) => setWbsCode(e.target.value)}
          />
          <p className="self-center text-xs text-slate-400">
            {claimElement == null
              ? "Work type: the WBS code above is not on this case yet."
              : claimElement.workType == null
                ? `Work type: ${claimElement.wbsCode} carries none. A claim against it is refused by name — record the work type on the element first.`
                : `Work type: ${claimElement.workType.replaceAll("_", " ")}${
                    claimElement.ruleRef
                      ? ` → rule ${claimElement.ruleRef}`
                      : " → no rule of credit recorded for it yet"
                  }`}
          </p>
          <input
            className={inputClass}
            placeholder="Step reached (1, 2, 3 …)"
            value={stepIndex}
            onChange={(e) => setStepIndex(e.target.value)}
          />
          <input
            className={inputClass}
            placeholder="Basis — what was observed or accepted"
            value={claimBasis}
            onChange={(e) => setClaimBasis(e.target.value)}
          />
          <button
            type="button"
            className={btnClass}
            disabled={busy}
            onClick={() =>
              void act(() =>
                recordProgressClaim({
                  periodId: latest.id,
                  wbsCode,
                  stepIndex: Number(stepIndex),
                  basis: claimBasis,
                }),
              )
            }
          >
            Claim the step
          </button>
          <p className="text-[11px] text-slate-500 sm:col-span-2">
            There is no percent field and no work-type field. The claim names a
            step; the server resolves the rule of credit from the work type
            recorded ON THE ELEMENT and derives what that step earns from it. A
            work type chosen at claim time would be a percent chosen at claim
            time.
          </p>
        </div>
      )}

      {canPlan && latest != null && latest.status === "open" && (
        <div className="grid gap-2 rounded-md border border-white/5 bg-white/[0.02] p-2.5 sm:grid-cols-3">
          <input
            className={inputClass}
            placeholder="Note — what this period is closed on"
            value={closeNote}
            onChange={(e) => setCloseNote(e.target.value)}
          />
          <button
            type="button"
            className={btnClass}
            disabled={busy}
            onClick={() =>
              void act(() =>
                closeProgressPeriod({ periodId: latest.id, note: closeNote }),
              )
            }
          >
            Close period
          </button>
        </div>
      )}
    </Section>
  );
}

/* ─────────────────────────── the estimate basis ──────────────────────── */

function EstimateBasisSection({
  caseId,
  performance,
  canPlan,
  onChanged,
}: {
  caseId: string;
  performance: CasePerformance;
  canPlan: boolean;
  onChanged: () => void;
}) {
  const { estimateBasis } = performance;
  const run = performance.latestCalculations.case_estimate_confidence;
  const [form, setForm] = useState({
    estimateClass: ESTIMATE_CLASSES[2].value as string,
    scopeMaturity: SCOPE_MATURITIES[2].value as string,
    quantityBasedPercent: "",
    quotationSupport: QUOTATION_SUPPORT_LEVELS[0].value as string,
    supportingQuotationCount: "0",
    escalationBasis: "",
    productivityBasis: "",
    exclusions: "",
    contingencyBasis: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The act was refused");
    } finally {
      setBusy(false);
    }
  };

  const current = estimateBasis.current;
  const stale = performanceRunIsStale(
    run,
    estimateConfidenceFingerprint(estimateBasis),
  );
  const runBand = hasRunOutputs(run) ? bandOrNull(run.outputs.band) : null;
  const runDrivers =
    hasRunOutputs(run) && Array.isArray(run.outputs.drivers)
      ? (run.outputs.drivers as unknown[]).filter(
          (d): d is string => typeof d === "string",
        )
      : [];

  return (
    <Section
      icon={<ScrollText className="h-4 w-4 text-signal-cyan" aria-hidden />}
      title="Estimate basis and confidence (D5.16, D5.17)"
      subtitle="Eight dimensions (spec II.7). The confidence is DERIVED from them and travels with every forecast on this case."
    >
      <ErrorLine error={error} />
      <div className="flex flex-wrap items-center gap-2">
        {/* The band comes from the RECORDED run. A chip that could read HIGH
            with no run behind it is the "silently confident" number D5.17
            exists to prevent. */}
        <ConfidenceChip band={runBand} label="Estimate confidence" />
        {hasRunOutputs(run) && run.outputs.basisVersion != null && (
          <span className="text-[11px] text-slate-500">
            from basis v{String(run.outputs.basisVersion)}
          </span>
        )}
        {run == null && (
          <span className="text-[11px] text-slate-500">
            no confidence has been computed and recorded yet
          </span>
        )}
      </div>
      <RunCaption run={run} stale={stale} />
      <Refusal text={estimateBasis.confidence?.refusal} />
      {runDrivers.length > 0 && (
        <ul className="space-y-0.5 text-[11px] text-slate-400">
          {runDrivers.map((d, i) => (
            <li key={i}>· {d}</li>
          ))}
        </ul>
      )}
      {estimateBasis.confidence?.mapping && (
        <p className="text-[11px] text-slate-500">
          Mapping: {estimateBasis.confidence.mapping}
        </p>
      )}

      <div className="rounded-md border border-white/5 bg-white/[0.02] px-2.5 py-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          The eight dimensions
        </p>
        <ul className="mt-1 space-y-0.5 text-xs text-slate-300">
          {ESTIMATE_BASIS_DIMENSIONS.map((d) => {
            const value = current
              ? (current as unknown as Record<string, unknown>)[d.key]
              : null;
            return (
              <li key={d.key}>
                <span className="text-slate-500">{d.label}: </span>
                {value == null || value === "" ? (
                  <span className="text-amber-300">not recorded</span>
                ) : (
                  String(value)
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {canPlan && (
        <div className="space-y-2 rounded-md border border-white/5 bg-white/[0.02] p-2.5">
          <div className="grid gap-2 sm:grid-cols-2">
            <select
              className={inputClass}
              value={form.estimateClass}
              onChange={(e) =>
                setForm({ ...form, estimateClass: e.target.value })
              }
            >
              {ESTIMATE_CLASSES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
            <select
              className={inputClass}
              value={form.scopeMaturity}
              onChange={(e) =>
                setForm({ ...form, scopeMaturity: e.target.value })
              }
            >
              {SCOPE_MATURITIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
            <input
              className={inputClass}
              placeholder="% quantity-based vs factored"
              value={form.quantityBasedPercent}
              onChange={(e) =>
                setForm({ ...form, quantityBasedPercent: e.target.value })
              }
            />
            <select
              className={inputClass}
              value={form.quotationSupport}
              onChange={(e) =>
                setForm({ ...form, quotationSupport: e.target.value })
              }
            >
              {QUOTATION_SUPPORT_LEVELS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
            <input
              className={inputClass}
              placeholder="Supporting quotation count"
              value={form.supportingQuotationCount}
              onChange={(e) =>
                setForm({ ...form, supportingQuotationCount: e.target.value })
              }
            />
            <input
              className={inputClass}
              placeholder="Escalation basis"
              value={form.escalationBasis}
              onChange={(e) =>
                setForm({ ...form, escalationBasis: e.target.value })
              }
            />
            <input
              className={inputClass}
              placeholder="Productivity basis"
              value={form.productivityBasis}
              onChange={(e) =>
                setForm({ ...form, productivityBasis: e.target.value })
              }
            />
            <input
              className={inputClass}
              placeholder="Exclusions"
              value={form.exclusions}
              onChange={(e) => setForm({ ...form, exclusions: e.target.value })}
            />
            <input
              className={inputClass}
              placeholder="Contingency basis"
              value={form.contingencyBasis}
              onChange={(e) =>
                setForm({ ...form, contingencyBasis: e.target.value })
              }
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={btnClass}
              disabled={busy}
              onClick={() =>
                void act(() => recordEstimateBasis({ caseId, ...form }))
              }
            >
              Record estimate basis
            </button>
            <button
              type="button"
              className={btnClass}
              disabled={busy}
              onClick={() =>
                void act(() => computeCaseEstimateConfidence(caseId))
              }
            >
              Compute and record confidence
            </button>
          </div>
        </div>
      )}

      <LineageBlock run={run} stale={stale} />
    </Section>
  );
}

/* ──────────────────────── the earned value suite ─────────────────────── */

function EarnedValueSection({
  caseId,
  performance,
  canPlan,
  onChanged,
}: {
  caseId: string;
  performance: CasePerformance;
  canPlan: boolean;
  onChanged: () => void;
}) {
  const live = performance.earnedValue;
  const run = performance.latestCalculations.case_earned_value;
  const stale = performanceRunIsStale(run, earnedValueFingerprint(live));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const currency =
    run != null && typeof run.outputs?.currency === "string"
      ? (run.outputs.currency as string)
      : null;

  // EVERY FIGURE FROM THE RUN, INCLUDING THE ONES BESIDE THE GRID. The
  // per-element budgets are money aggregates and the confidence bands are
  // ratings: taken from the live read they sat, un-lineaged and current,
  // under a metric grid that could be stale — two figures side by side,
  // indistinguishable on screen, one of them backed by a recorded run.
  const runElements = useMemo(
    () => (hasRunOutputs(run) ? recordedElements(run.outputs) : []),
    [run],
  );
  const runEstimateBand = hasRunOutputs(run)
    ? bandOrNull(run.outputs.estimateConfidenceBand)
    : null;
  const runProgressBand = hasRunOutputs(run)
    ? bandOrNull(run.outputs.progressConfidence)
    : null;

  return (
    <Section
      icon={<Gauge className="h-4 w-4 text-signal-cyan" aria-hidden />}
      title="Earned value metric suite (D5.05)"
      subtitle={`EV, PV, AC, CPI, SPI, ES, EAC, VAC. ${live.eacFormula}. Every absent figure names the input it is missing.`}
    >
      <ErrorLine error={error} />
      <p className="text-xs text-slate-300">{earnedValueHeadline(live, run)}</p>
      <RunCaption run={run} stale={stale} />

      <div className="grid gap-2 sm:grid-cols-2">
        {EARNED_VALUE_METRICS.map((m) => {
          const d = metricDisplay(m.key, live, run);
          return (
            <div
              key={m.key}
              className="rounded-md border border-white/5 bg-white/[0.02] px-2.5 py-2"
            >
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                {d.label}
              </p>
              {d.value == null ? (
                <p className="mt-0.5 text-xs text-amber-200">{d.refusal}</p>
              ) : (
                <p className="mt-0.5 text-sm text-slate-100">
                  {formatPerformanceValue(d.value, d.unit, currency)}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <ConfidenceChip band={runEstimateBand} label="Estimate confidence" />
        <ConfidenceChip
          band={runProgressBand}
          label="Progress confidence"
          coverage={coverageSuffix(
            numberOrNull(run?.outputs?.progressConfidenceCoverage),
            numberOrNull(run?.outputs?.progressConfidenceCovered),
            numberOrNull(run?.outputs?.progressConfidenceClaimed),
          )}
        />
      </div>

      {runElements.length > 0 && (
        <div className="rounded-md border border-white/5 bg-white/[0.02] px-2.5 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            What was earned, element by element
          </p>
          <ul className="mt-1 space-y-0.5 text-xs text-slate-300">
            {runElements.map((e) => (
              <li key={e.wbsCode}>
                <span className="font-mono text-slate-200">{e.wbsCode}</span> —{" "}
                {e.claimedPercent}% of{" "}
                {formatPerformanceValue(e.elementBudget, "currency", currency)}{" "}
                at &quot;{e.stepLabel}&quot; ({e.ruleRef})
                {e.carriedForward && (
                  <span className="text-slate-500">
                    {" "}
                    · carried forward from {e.periodRef}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {live.caveats.map((c, i) => (
        <Refusal key={`caveat-${i}`} text={c} />
      ))}

      {canPlan && (
        <button
          type="button"
          className={btnClass}
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError(null);
            computeCaseEarnedValue(caseId)
              .then(() => onChanged())
              .catch((e: unknown) =>
                setError(
                  e instanceof Error
                    ? e.message
                    : "The calculation was refused",
                ),
              )
              .finally(() => setBusy(false));
          }}
        >
          Compute and record earned value
        </button>
      )}

      <LineageBlock run={run} stale={stale} />
    </Section>
  );
}

/* ───────────────────── progress integrity cross-check ────────────────── */

function ProgressIntegritySection({
  caseId,
  performance,
  canPlan,
  onChanged,
}: {
  caseId: string;
  performance: CasePerformance;
  canPlan: boolean;
  onChanged: () => void;
}) {
  const report = performance.progressIntegrity;
  const run = performance.latestCalculations.case_progress_integrity;
  const period = performance.progress.latestPeriod;
  const [wbsCode, setWbsCode] = useState("");
  const [source, setSource] = useState<string>(
    PROGRESS_EVIDENCE_SOURCES[1].value,
  );
  const [complete, setComplete] = useState("");
  const [total, setTotal] = useState("");
  const [unit, setUnit] = useState("");
  const [basis, setBasis] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // ONE definition of evidenceCount, produced by the read that the recording
  // side also read it from. Re-deriving it here by summing sourceCount over
  // the CLAIMED elements disagreed with the run whenever an observation was
  // recorded against an unclaimed element, so a just-recorded run read as
  // permanently stale and its code-version caption was suppressed for ever.
  const stale = performanceRunIsStale(
    run,
    progressIntegrityFingerprint(report),
  );
  const runBand = hasRunOutputs(run)
    ? bandOrNull(run.outputs.confidence)
    : null;
  const runCoverage = hasRunOutputs(run)
    ? coverageSuffix(
        numberOrNull(run.outputs.coverage),
        numberOrNull(run.outputs.coveredElementCount),
        numberOrNull(run.outputs.claimedElementCount),
      )
    : null;

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The act was refused");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      icon={<ClipboardCheck className="h-4 w-4 text-signal-cyan" aria-hidden />}
      title="Progress integrity cross-check (D5.20)"
      subtitle="Claimed progress against independent counted observations (spec II.9). An element with no observation is UNRATED, never confirmed."
    >
      <ErrorLine error={error} />
      <div className="flex flex-wrap items-center gap-2">
        <ConfidenceChip
          band={runBand}
          label="Progress confidence"
          coverage={runCoverage}
        />
        {run == null && (
          <span className="text-[11px] text-slate-500">
            no cross-check has been computed and recorded yet
          </span>
        )}
      </div>
      <p className="text-xs text-slate-300">
        {hasRunOutputs(run) && typeof run.outputs.headline === "string"
          ? run.outputs.headline
          : (run?.refusals[0] ?? integrityHeadline(report))}
      </p>
      <RunCaption run={run} stale={stale} />

      {report.elements.length > 0 && (
        <p className="text-[11px] text-slate-500">
          The rows behind the cross-check, as they stand now. The rating above
          is the recorded one; these are the claims and observations it was
          computed from, listed rather than aggregated.
        </p>
      )}
      {report.elements.length > 0 && (
        <ul className="space-y-1">
          {report.elements.map((e) => (
            <li
              key={e.wbsCode}
              className="rounded-md border border-white/5 bg-white/[0.02] px-2.5 py-2 text-xs"
            >
              <p className="text-slate-200">
                <span className="font-mono">{e.wbsCode}</span> — claimed{" "}
                {e.claimedPercent}% at &quot;{e.stepLabel}&quot;
              </p>
              {e.refusal ? (
                <p className="mt-0.5 text-amber-200">{e.refusal}</p>
              ) : (
                <p className="mt-0.5 text-slate-400">
                  {e.bindingSource?.replaceAll("_", " ")}: {e.observedComplete}{" "}
                  of {e.observedTotal} {e.bindingUnit} ({e.observedPercent}%) ·
                  divergence {e.divergencePoints} point(s) ·{" "}
                  {(e.confidence ?? "unrated").toUpperCase()}
                </p>
              )}
              {e.discrepancy && (
                <p className="mt-0.5 text-amber-200">{e.discrepancy}</p>
              )}
            </li>
          ))}
        </ul>
      )}
      <Refusal text={report.refusal} />
      <p className="text-[11px] text-slate-500">{report.bands?.note}</p>

      {canPlan && period != null && period.status === "open" && (
        <div className="grid gap-2 rounded-md border border-white/5 bg-white/[0.02] p-2.5 sm:grid-cols-3">
          <input
            className={inputClass}
            placeholder="WBS code"
            value={wbsCode}
            onChange={(e) => setWbsCode(e.target.value)}
          />
          <select
            className={inputClass}
            value={source}
            onChange={(e) => setSource(e.target.value)}
          >
            {PROGRESS_EVIDENCE_SOURCES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <input
            className={inputClass}
            placeholder="Unit (drawings, welds, m³)"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
          />
          <input
            className={inputClass}
            placeholder="Observed complete"
            value={complete}
            onChange={(e) => setComplete(e.target.value)}
          />
          <input
            className={inputClass}
            placeholder="Observed total"
            value={total}
            onChange={(e) => setTotal(e.target.value)}
          />
          <input
            className={inputClass}
            placeholder="Basis — where the count came from"
            value={basis}
            onChange={(e) => setBasis(e.target.value)}
          />
          <button
            type="button"
            className={btnClass}
            disabled={busy}
            onClick={() =>
              void act(() =>
                recordProgressEvidence({
                  periodId: period.id,
                  wbsCode,
                  evidenceSource: source,
                  observedComplete: complete,
                  observedTotal: total,
                  unit,
                  basis,
                }),
              )
            }
          >
            Record observation
          </button>
          <p className="text-[11px] text-slate-500 sm:col-span-3">
            A counted pair, never a percentage: &quot;137 of 193 drawings&quot;
            can be checked, &quot;71%&quot; can only be asserted.
          </p>
        </div>
      )}

      {canPlan && (
        <button
          type="button"
          className={btnClass}
          disabled={busy}
          onClick={() => void act(() => computeCaseProgressIntegrity(caseId))}
        >
          Compute and record the cross-check
        </button>
      )}

      <LineageBlock run={run} stale={stale} />
    </Section>
  );
}

/* ─────────────────── §51 forecast confidence presentation ────────────── */

function ForecastConfidenceSection({
  caseId,
  performance,
  canPlan,
  onChanged,
}: {
  caseId: string;
  performance: CasePerformance;
  canPlan: boolean;
  onChanged: () => void;
}) {
  const fc = performance.forecastConfidence;
  const run = performance.latestCalculations.case_forecast_confidence;
  // THE MOST CONSEQUENTIAL FIGURE IN THE SLICE HAD NO STALENESS CHECK AT
  // ALL: the deterministic EAC and finish date a sanction paper is written
  // against were read straight off the run and rendered for ever with
  // nothing on screen when their inputs moved. The recording side already
  // wrote the fingerprint; only the comparison was missing.
  const stale = performanceRunIsStale(run, forecastConfidenceFingerprint(fc));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const costDeterministic =
    run != null && typeof run.outputs?.costDeterministic === "number"
      ? (run.outputs.costDeterministic as number)
      : null;
  const currency =
    run != null && typeof run.outputs?.currency === "string"
      ? (run.outputs.currency as string)
      : null;
  const scheduleDeterministic =
    run != null && typeof run.outputs?.scheduleDeterministicFinish === "string"
      ? (run.outputs.scheduleDeterministicFinish as string)
      : null;
  // Two money figures side by side, both from the SAME recorded run. Taking
  // this one from the live read put an un-lineaged currency total directly
  // beside a lineage-backed one, indistinguishable on screen — and the run
  // records it, so it was available and simply not used.
  const recordedForecastTotal = hasRunOutputs(run)
    ? numberOrNull(run.outputs.costRecordedForecastTotal)
    : null;

  const costP50 = percentileCell(null, fc.cost.percentileRefusal);
  const costP80 = percentileCell(null, fc.cost.percentileRefusal);
  const schedP50 = percentileCell(null, fc.schedule.percentileRefusal);
  const schedP80 = percentileCell(null, fc.schedule.percentileRefusal);

  return (
    <Section
      icon={<Activity className="h-4 w-4 text-signal-cyan" aria-hidden />}
      title="Forecast confidence — cost and schedule (D5.07, D5.32, §51)"
      subtitle="Deterministic, P50, P80, confidence. The percentiles are shown as absent because no distribution exists — not manufactured from the deterministic figure."
    >
      <ErrorLine error={error} />

      <div className="rounded-md border border-white/5 bg-white/[0.02] px-2.5 py-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          Cost
        </p>
        <div className="mt-1 grid gap-2 sm:grid-cols-3">
          <div>
            <p className="text-[11px] text-slate-500">Deterministic</p>
            {costDeterministic == null ? (
              <p className="text-xs text-amber-200">
                {fc.cost.deterministicRefusal ??
                  "No forecast has been computed and recorded yet."}
              </p>
            ) : (
              <p className="text-sm text-slate-100">
                {formatPerformanceValue(
                  costDeterministic,
                  "currency",
                  currency,
                )}
              </p>
            )}
            <p className="text-[11px] text-slate-500">
              {fc.cost.deterministicFormula}
            </p>
          </div>
          <div>
            <p className="text-[11px] text-slate-500">P50</p>
            <p className="text-sm text-slate-400">{costP50.text}</p>
          </div>
          <div>
            <p className="text-[11px] text-slate-500">P80</p>
            <p className="text-sm text-slate-400">{costP80.text}</p>
          </div>
        </div>
        <p className="mt-1 text-[11px] text-slate-500">
          {fc.cost.recordedForecastNote}
          {recordedForecastTotal != null && (
            <>
              {" "}
              Recorded bottom-up forecast:{" "}
              {formatPerformanceValue(
                recordedForecastTotal,
                "currency",
                currency,
              )}
              .
            </>
          )}
        </p>
      </div>

      <div className="rounded-md border border-white/5 bg-white/[0.02] px-2.5 py-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          Schedule
        </p>
        <div className="mt-1 grid gap-2 sm:grid-cols-3">
          <div>
            <p className="text-[11px] text-slate-500">Deterministic finish</p>
            {scheduleDeterministic == null ? (
              <p className="text-xs text-amber-200">
                {fc.schedule.deterministicRefusal ??
                  "No forecast has been computed and recorded yet."}
              </p>
            ) : (
              <p className="text-sm text-slate-100">
                {new Date(scheduleDeterministic).toLocaleDateString()}
              </p>
            )}
          </div>
          <div>
            <p className="text-[11px] text-slate-500">P50 date</p>
            <p className="text-sm text-slate-400">{schedP50.text}</p>
          </div>
          <div>
            <p className="text-[11px] text-slate-500">P80 date</p>
            <p className="text-sm text-slate-400">{schedP80.text}</p>
          </div>
        </div>
        <p className="mt-1 text-[11px] text-slate-500">
          {fc.schedule.activitiesWithDurationRange} of{" "}
          {fc.schedule.activityCount} activity(ies) carry an optimistic and
          pessimistic duration.
        </p>
      </div>

      <Refusal text={fc.cost.percentileRefusal} />
      <Refusal text={fc.schedule.criticalDriversRefusal} />
      <Refusal text={fc.againstSanctionRefusal} />

      <div className="flex flex-wrap items-center gap-2">
        <ConfidenceChip
          band={
            hasRunOutputs(run)
              ? bandOrNull(run.outputs.estimateConfidenceBand)
              : null
          }
          label="Estimate confidence"
        />
        <ConfidenceChip
          band={
            hasRunOutputs(run)
              ? bandOrNull(run.outputs.progressConfidenceBand)
              : null
          }
          label="Progress confidence"
          coverage={coverageSuffix(
            fc.progressConfidence?.coverage,
            performance.progressIntegrity?.coveredElementCount,
            performance.progressIntegrity?.claimedElementCount,
          )}
        />
      </div>
      <RunCaption run={run} stale={stale} />

      {canPlan && (
        <button
          type="button"
          className={btnClass}
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError(null);
            computeCaseForecastConfidence(caseId)
              .then(() => onChanged())
              .catch((e: unknown) =>
                setError(
                  e instanceof Error
                    ? e.message
                    : "The calculation was refused",
                ),
              )
              .finally(() => setBusy(false));
          }}
        >
          Compute and record the forecast
        </button>
      )}

      <LineageBlock run={run} stale={stale} />
    </Section>
  );
}

/* ────────────────────────── performance trending ─────────────────────── */

function TrendSection({
  caseId,
  performance,
  canPlan,
  onChanged,
}: {
  caseId: string;
  performance: CasePerformance;
  canPlan: boolean;
  onChanged: () => void;
}) {
  const trend = performance.trend;
  const run = performance.latestCalculations.case_performance_trend;
  const stale = performanceRunIsStale(run, performanceTrendFingerprint(trend));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <Section
      icon={<TrendingUp className="h-4 w-4 text-signal-cyan" aria-hidden />}
      title="Performance trending (D5.06)"
      subtitle="One point per period, read from the run recorded while that period was current. Nothing here is recomputed and no gap is interpolated across."
    >
      <ErrorLine error={error} />
      <p className="text-xs text-slate-300">{trendSentence(trend)}</p>
      <RunCaption run={run} stale={stale} />

      {trend.points.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-slate-500">
                <th className="py-1 pr-3">Period</th>
                <th className="py-1 pr-3">CPI</th>
                <th className="py-1 pr-3">SPI</th>
                <th className="py-1 pr-3">EAC</th>
                <th className="py-1 pr-3">Recorded</th>
              </tr>
            </thead>
            <tbody>
              {trend.points.map((p) => (
                <tr key={p.runId} className="text-slate-300">
                  <td className="py-1 pr-3 font-mono text-slate-200">
                    {p.periodRef}
                  </td>
                  <td className="py-1 pr-3">
                    {p.cpi == null ? (
                      <span className="text-amber-300">no figure</span>
                    ) : (
                      p.cpi.toFixed(3)
                    )}
                  </td>
                  <td className="py-1 pr-3">
                    {p.spi == null ? (
                      <span className="text-amber-300">no figure</span>
                    ) : (
                      p.spi.toFixed(3)
                    )}
                  </td>
                  <td className="py-1 pr-3">
                    {p.eac == null ? (
                      <span className="text-amber-300">no figure</span>
                    ) : (
                      formatPerformanceValue(p.eac, "currency", p.currency)
                    )}
                  </td>
                  <td className="py-1 pr-3 text-slate-500">
                    {new Date(p.computedAt).toLocaleDateString()} ·{" "}
                    {p.refusalCount} refusal(s)
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {trend.gaps.map((g) => (
        <Refusal key={g.periodRef} text={`${g.periodRef}: ${g.reason}`} />
      ))}

      {canPlan && (
        <button
          type="button"
          className={btnClass}
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError(null);
            computeCasePerformanceTrend(caseId)
              .then(() => onChanged())
              .catch((e: unknown) =>
                setError(
                  e instanceof Error
                    ? e.message
                    : "The calculation was refused",
                ),
              )
              .finally(() => setBusy(false));
          }}
        >
          Compute and record the trend
        </button>
      )}

      <LineageBlock run={run} stale={stale} />
    </Section>
  );
}

/* ───────────────────────────── the panel ─────────────────────────────── */

export function PerformancePanel({
  caseId,
  canPlan,
  canReview,
  reloadKey,
}: {
  caseId: string;
  canPlan: boolean;
  canReview: boolean;
  reloadKey: number;
}) {
  const [performance, setPerformance] = useState<CasePerformance | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * As in ControlsPanels: there is deliberately no "freshly computed result"
   * state. Computing RELOADS, so the figure on screen is always the recorded
   * run in `latestCalculations` and never the live read's number.
   */
  const load = useCallback(async () => {
    setError(null);
    try {
      setPerformance(await getCasePerformance(caseId));
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not load the performance view",
      );
    }
  }, [caseId]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  if (error) {
    return (
      <div className="rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-300">
        {error}
      </div>
    );
  }
  if (performance == null) {
    return (
      <div className="rounded-xl border border-white/6 bg-[#0D1520] p-5 text-xs text-slate-500">
        Loading the rules of credit, reporting periods, estimate basis and
        recorded performance runs…
      </div>
    );
  }

  return (
    <>
      <RulesOfCreditSection
        caseId={caseId}
        performance={performance}
        canPlan={canPlan}
        onChanged={() => void load()}
      />
      <ProgressSection
        caseId={caseId}
        performance={performance}
        canPlan={canPlan}
        canReview={canReview}
        onChanged={() => void load()}
      />
      <EstimateBasisSection
        caseId={caseId}
        performance={performance}
        canPlan={canPlan}
        onChanged={() => void load()}
      />
      <EarnedValueSection
        caseId={caseId}
        performance={performance}
        canPlan={canPlan}
        onChanged={() => void load()}
      />
      <ProgressIntegritySection
        caseId={caseId}
        performance={performance}
        canPlan={canPlan}
        onChanged={() => void load()}
      />
      <ForecastConfidenceSection
        caseId={caseId}
        performance={performance}
        canPlan={canPlan}
        onChanged={() => void load()}
      />
      <TrendSection
        caseId={caseId}
        performance={performance}
        canPlan={canPlan}
        onChanged={() => void load()}
      />
      <div className="rounded-xl border border-white/6 bg-[#0D1520] px-4 py-3">
        <div className="flex items-center gap-2">
          <ScrollText className="h-4 w-4 text-slate-500" aria-hidden />
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Not in this view, and why
          </p>
        </div>
        <ul className="mt-1 space-y-1 text-xs text-slate-500">
          {performance.notInThisSlice.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      </div>
    </>
  );
}
