/**
 * Sync Develop Slice 4C — the Schedule Assurance surface.
 *
 *   D5.13  the nine II.6 defect classes, each with its count, its threshold
 *          and — the part that matters — its NOT-DIAGNOSABLE reason, which is
 *          rendered as grey and never as green.
 *   D5.31  the §50 Schedule Quality Score with its published weights.
 *   D5.14  the Schedule Confidence Score, which is a different question.
 *   D5.15  the gate. When it fails, the Simulate control is not rendered at
 *          all and the failing classes are named. There is no override.
 *   D5.08  the risk → activity → money chain, with unlinked risks NAMED.
 *   D5.09  the per-risk attribution, ranked by the simulation itself.
 *
 * THE SURFACE CONVENTION, unchanged from 4A/4B: every FIGURE comes from a
 * recorded calculation run, the live read supplies refusals, row listings and
 * staleness detection, and a run whose input fingerprint has moved is labelled
 * stale with its code-version caption suppressed everywhere it appears —
 * including the `<summary>`, which is visible whether the block is open or not.
 *
 * The simulation itself is `src/lib/modelling/integrated-risk.ts`, invoked
 * through `runCaseScheduleSimulation`. Nothing in this file computes a
 * percentile, and nothing in it derives one from a deterministic figure.
 */
import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  GitBranch,
  Link2,
  ShieldAlert,
  SlidersHorizontal,
} from "lucide-react";
import type { ReactNode } from "react";

import {
  DEFAULT_SIMULATION_ITERATIONS,
  SCHEDULE_CONFIDENCE_COMPONENTS,
  SCHEDULE_QUALITY_POLICY,
  SCHEDULE_SIMULATION_POLICY,
  SCHEDULE_SCORE_COMPONENTS,
  attributionSentence,
  defectCount,
  defectTone,
  gateHeadline,
  overrunDays,
  probabilityPercent,
  qualityBand,
  riskChainFingerprint,
  scheduleQualityFingerprint,
  type CaseRiskScheduleChain,
  type CaseScheduleQuality,
  type CaseScheduleSimulation,
  type ScheduleDefectClass,
} from "../../lib/develop/schedule";
import {
  performanceRunIsStale,
  type CasePerformance,
  type PerformanceCalculationRun,
} from "../../lib/develop/performance";
import {
  computeCaseRiskScheduleEconomics,
  computeCaseScheduleQuality,
  getCaseSimulationInputs,
  listBindableRisks,
  recordRiskScheduleImpact,
  runCaseScheduleSimulation,
  setScheduleActivityDurationRange,
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

function numberOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/* ───────────────── D5.13 / D5.31 / D5.14 — quality and gate ──────────── */

function DefectRow({ cls }: { cls: ScheduleDefectClass }) {
  const tone = defectTone(cls.severity);
  const chip =
    tone.tone === "good"
      ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
      : tone.tone === "warn"
        ? "border-amber-400/30 bg-amber-400/10 text-amber-200"
        : tone.tone === "bad"
          ? "border-red-400/30 bg-red-400/10 text-red-200"
          : "border-slate-400/25 bg-slate-400/5 text-slate-300";
  return (
    <div className="rounded-md border border-white/5 bg-white/[0.02] px-2.5 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-slate-200">{cls.label}</p>
        <span
          className={`rounded border px-2 py-0.5 text-[11px] font-semibold ${chip}`}
        >
          {tone.text} · {defectCount(cls)}
        </span>
      </div>
      <p className="mt-1 text-[11px] text-slate-500">{cls.definition}</p>
      {/* NOT DIAGNOSABLE IS NOT A PASS. The reason is rendered every time,
          because a blind spot that reads as a clean bill of health is the
          exact failure this diagnosis exists to prevent. */}
      {!cls.diagnosable && cls.notDiagnosableReason && (
        <p className="mt-1 text-[11px] text-amber-200">
          {cls.notDiagnosableReason}
        </p>
      )}
    </div>
  );
}

function QualitySection({
  caseId,
  quality,
  run,
  canPlan,
  onChanged,
}: {
  caseId: string;
  quality: CaseScheduleQuality;
  run: PerformanceCalculationRun | undefined;
  canPlan: boolean;
  onChanged: () => void;
}) {
  const stale = performanceRunIsStale(run, scheduleQualityFingerprint(quality));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The FIGURE comes off the recorded run, never off the live read.
  const score =
    run != null && run.outputs != null && run.status !== "refused"
      ? numberOrNull(run.outputs.score)
      : null;
  const confidence =
    run != null && run.outputs != null && run.status !== "refused"
      ? numberOrNull(run.outputs.confidence)
      : null;
  const band = qualityBand(score);
  const bandTone =
    band.tone === "good"
      ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
      : band.tone === "warn"
        ? "border-amber-400/30 bg-amber-400/10 text-amber-200"
        : band.tone === "bad"
          ? "border-red-400/30 bg-red-400/10 text-red-200"
          : "border-slate-400/25 bg-slate-400/5 text-slate-300";

  return (
    <Section
      icon={<ShieldAlert className="h-4 w-4 text-signal-cyan" aria-hidden />}
      title="Schedule quality — the nine defect classes (D5.13, D5.31, §50)"
      subtitle="Detect: missing logic, open ends, excessive constraints, long-duration activities, negative float, unrealistic lags, broken critical paths, excessive concurrency, unrealistic calendars. A class the imported data cannot answer says so and is never counted as clean."
    >
      <ErrorLine error={error} />

      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded border px-2 py-0.5 text-[11px] font-semibold ${bandTone}`}
        >
          §50 score {score == null ? "NOT SCORED" : score} · {band.text}
        </span>
        <span className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[11px] text-slate-300">
          Schedule confidence (D5.14):{" "}
          {confidence == null ? "NOT RATED" : `${confidence} / 100`}
        </span>
        <span className="text-[11px] text-slate-500">
          {quality.activityCount} activity(ies) · {quality.relationshipCount}{" "}
          relationship(s) · {quality.diagnosableComponents} of{" "}
          {SCHEDULE_SCORE_COMPONENTS.length} §50 components diagnosable
        </span>
      </div>
      <RunCaption run={run} stale={stale} />

      <Refusal text={quality.scoreRefusal} />
      <Refusal text={quality.confidenceRefusal} />

      <div className="space-y-2">
        {quality.classes.map((c) => (
          <DefectRow key={c.key} cls={c} />
        ))}
      </div>

      <details className="rounded-md border border-white/5 bg-white/[0.02] px-2.5 py-2">
        <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          Published weights and thresholds — not tenant-configurable
        </summary>
        <div className="mt-2 space-y-2 text-[11px] text-slate-400">
          <p>
            §50 score components:{" "}
            {SCHEDULE_SCORE_COMPONENTS.map(
              (c) => `${c.label} ${c.weight}`,
            ).join(" · ")}
            . Negative float, unrealistic lags and excessive concurrency are
            diagnosed and block the gate in their own right, but carry no §50
            weight — §50 enumerates its own six components and inventing three
            more would make the published number stop being the spec&apos;s
            number.
          </p>
          <p>
            Schedule confidence components:{" "}
            {SCHEDULE_CONFIDENCE_COMPONENTS.map(
              (c) => `${c.label} ${c.weight}`,
            ).join(" · ")}
            .
          </p>
          <p>
            Floors: {SCHEDULE_QUALITY_POLICY.minimumActivities} activities and{" "}
            {SCHEDULE_QUALITY_POLICY.minimumRelationships} relationships to
            score at all; {SCHEDULE_QUALITY_POLICY.minimumDiagnosableComponents}{" "}
            of six components diagnosable;{" "}
            {SCHEDULE_QUALITY_POLICY.minimumScoreToSimulate} to simulate. A
            long-duration activity is one over{" "}
            {SCHEDULE_QUALITY_POLICY.longDurationHours} elapsed hours (44
            calendar days); an excessive lag is one over{" "}
            {SCHEDULE_QUALITY_POLICY.excessiveLagHours} hours.
          </p>
          {quality.confidenceComponents != null && (
            <ul className="space-y-1">
              {SCHEDULE_CONFIDENCE_COMPONENTS.map((c) => {
                const comp =
                  quality.confidenceComponents[
                    c.key as keyof typeof quality.confidenceComponents
                  ];
                if (comp == null) return null;
                return (
                  <li key={c.key}>
                    <span className="text-slate-300">{c.label}: </span>
                    {comp.value == null ? "not rated" : comp.value} —{" "}
                    {comp.basis}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </details>

      {canPlan && (
        <button
          type="button"
          className={btnClass}
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError(null);
            computeCaseScheduleQuality(caseId)
              .then(() => onChanged())
              .catch((e: unknown) =>
                setError(
                  e instanceof Error ? e.message : "The diagnosis was refused",
                ),
              )
              .finally(() => setBusy(false));
          }}
        >
          Diagnose and record
        </button>
      )}

      <LineageBlock run={run} stale={stale} />
    </Section>
  );
}

/* ──────────────────── D5.08 — risk → schedule → money ────────────────── */

function RiskChainSection({
  caseId,
  chain,
  run,
  canPlan,
  onChanged,
}: {
  caseId: string;
  chain: CaseRiskScheduleChain;
  run: PerformanceCalculationRun | undefined;
  canPlan: boolean;
  onChanged: () => void;
}) {
  const stale = performanceRunIsStale(run, riskChainFingerprint(chain));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [risks, setRisks] = useState<{ id: string; title: string }[]>([]);
  /**
   * The activities come from the SAME read the kernel consumes
   * (`get_case_simulation_inputs`), so an activity offered here is an activity
   * the simulation would sample. A second listing would let somebody link a
   * risk to a key the simulation never sees.
   */
  const [activities, setActivities] = useState<
    { key: string; label: string }[]
  >([]);
  const [form, setForm] = useState({
    riskId: "",
    activityKey: "",
    probability: "",
    o: "",
    l: "",
    p: "",
    co: "",
    cl: "",
    cp: "",
    currency: "",
    basis: "",
  });

  useEffect(() => {
    if (!adding) return;
    void listBindableRisks()
      .then((rows) => setRisks(rows.map((r) => ({ id: r.id, title: r.title }))))
      .catch(() => setRisks([]));
    void getCaseSimulationInputs(caseId)
      .then((inputs) =>
        setActivities(
          // The ACT resolves an activity by its human-facing key and refuses an
          // ambiguous one by name, so the picker offers keys — the row id is
          // the kernel's node identity, not the operator's.
          (inputs.activities ?? []).map((a) => ({
            key: a.key,
            label: a.label,
          })),
        ),
      )
      .catch(() => setActivities([]));
  }, [adding, caseId]);

  return (
    <Section
      icon={<Link2 className="h-4 w-4 text-signal-cyan" aria-hidden />}
      title="Risk → schedule → economics (D5.08, I.10)"
      subtitle="A risk names the activity it threatens, carries its own probability and a three-point delay, and converts to money through a stated cost of delay. A single-point impact is refused: a spread manufactured at data entry looks exactly like diligence."
    >
      <ErrorLine error={error} />

      <p className="text-xs text-slate-400">{chain.coverageNote}</p>
      {/* A closed risk that kept driving the P80 would be exposure nobody
          still carries. The excluded edges are named, not silently dropped. */}
      <Refusal text={chain.retiredLinkNote ?? null} />
      <Refusal text={chain.delayCostRate?.refusal} />
      {chain.delayCostRate?.value != null && (
        <p className="text-[11px] text-slate-500">
          Cost of delay: {chain.delayCostRate.value}{" "}
          {chain.delayCostRate.unit ?? ""} per day —{" "}
          {chain.delayCostRate.source}. Recorded as a financial assumption under{" "}
          <span className="font-mono">{chain.delayCostRate.key}</span>.
        </p>
      )}

      {chain.links.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[46rem] text-left text-xs">
            <thead className="text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-1 pr-3">Risk</th>
                <th className="py-1 pr-3">Activity</th>
                <th className="py-1 pr-3">P(occurs)</th>
                <th className="py-1 pr-3">Delay (days) o / l / p</th>
                <th className="py-1 pr-3">Direct cost o / l / p</th>
              </tr>
            </thead>
            <tbody className="text-slate-300">
              {chain.links.map((l) => (
                <tr key={l.id} className="border-t border-white/5 align-top">
                  <td className="py-1 pr-3">
                    {l.riskTitle}
                    <span className="block text-[11px] text-slate-500">
                      {l.riskLevel ?? "unrated"} · {l.riskStatus}
                    </span>
                  </td>
                  <td className="py-1 pr-3">
                    {l.activityKey}
                    <span className="block text-[11px] text-slate-500">
                      {l.activityLabel} · {l.activityOrigin}
                      {l.wbsCode ? ` · WBS ${l.wbsCode}` : ""}
                    </span>
                  </td>
                  <td className="py-1 pr-3">{l.probability}</td>
                  <td className="py-1 pr-3">
                    {l.delayDaysOptimistic} / {l.delayDaysLikely} /{" "}
                    {l.delayDaysPessimistic}
                  </td>
                  <td className="py-1 pr-3">
                    {l.costLikely == null
                      ? "—"
                      : `${l.costOptimistic} / ${l.costLikely} / ${l.costPessimistic} ${l.currency ?? ""}`}
                    <span className="block text-[11px] text-slate-500">
                      {l.economicHop}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* NAMED, not counted. "9 risks are not linked" tells nobody which. */}
      {chain.unlinkedRisks.length > 0 && (
        <div className="rounded border border-amber-400/25 bg-amber-400/5 px-2.5 py-1.5 text-xs text-amber-200">
          Outside every forecast computed from this chain:{" "}
          {chain.unlinkedRisks.map((r) => r.riskTitle).join("; ")}.
        </div>
      )}

      {canPlan && !adding && (
        <button
          type="button"
          className={btnClass}
          onClick={() => setAdding(true)}
        >
          Link a risk to an activity
        </button>
      )}

      {canPlan && adding && (
        <div className="grid gap-2 sm:grid-cols-3">
          <select
            className={inputClass}
            value={form.riskId}
            onChange={(e) => setForm({ ...form, riskId: e.target.value })}
          >
            <option value="">Risk bound to this case…</option>
            {risks.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title}
              </option>
            ))}
          </select>
          <select
            className={inputClass}
            value={form.activityKey}
            onChange={(e) => setForm({ ...form, activityKey: e.target.value })}
          >
            <option value="">Schedule activity…</option>
            {activities.map((a) => (
              <option key={a.key} value={a.key}>
                {a.key} — {a.label}
              </option>
            ))}
          </select>
          <input
            className={inputClass}
            placeholder="Probability, 0–1"
            value={form.probability}
            onChange={(e) => setForm({ ...form, probability: e.target.value })}
          />
          <input
            className={inputClass}
            placeholder="Delay days — optimistic"
            value={form.o}
            onChange={(e) => setForm({ ...form, o: e.target.value })}
          />
          <input
            className={inputClass}
            placeholder="Delay days — most likely"
            value={form.l}
            onChange={(e) => setForm({ ...form, l: e.target.value })}
          />
          <input
            className={inputClass}
            placeholder="Delay days — pessimistic"
            value={form.p}
            onChange={(e) => setForm({ ...form, p: e.target.value })}
          />
          <input
            className={inputClass}
            placeholder="Direct cost — optimistic (optional)"
            value={form.co}
            onChange={(e) => setForm({ ...form, co: e.target.value })}
          />
          <input
            className={inputClass}
            placeholder="Direct cost — most likely"
            value={form.cl}
            onChange={(e) => setForm({ ...form, cl: e.target.value })}
          />
          <input
            className={inputClass}
            placeholder="Direct cost — pessimistic"
            value={form.cp}
            onChange={(e) => setForm({ ...form, cp: e.target.value })}
          />
          <input
            className={inputClass}
            placeholder="Currency (with a cost)"
            value={form.currency}
            onChange={(e) => setForm({ ...form, currency: e.target.value })}
          />
          <textarea
            className={`${inputClass} sm:col-span-3`}
            rows={2}
            placeholder="Basis for this probability and this range (20 characters minimum)"
            value={form.basis}
            onChange={(e) => setForm({ ...form, basis: e.target.value })}
          />
          <button
            type="button"
            className={btnClass}
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setError(null);
              recordRiskScheduleImpact({
                caseId,
                riskId: form.riskId,
                activityKey: form.activityKey,
                probability: form.probability,
                delayDaysOptimistic: form.o,
                delayDaysLikely: form.l,
                delayDaysPessimistic: form.p,
                costOptimistic: form.co,
                costLikely: form.cl,
                costPessimistic: form.cp,
                currency: form.currency,
                basis: form.basis,
              })
                .then(() => {
                  setAdding(false);
                  onChanged();
                })
                .catch((e: unknown) =>
                  setError(
                    e instanceof Error ? e.message : "The link was refused",
                  ),
                )
                .finally(() => setBusy(false));
            }}
          >
            Record the impact
          </button>
          <p className="text-[11px] text-slate-500 sm:col-span-2">
            Three points or nothing. The register&apos;s own likelihood score is
            not read as a probability — it is unbounded, and rescaling it would
            invent the number that decides how often this risk happens.
          </p>
        </div>
      )}

      {canPlan && (
        <button
          type="button"
          className={btnClass}
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError(null);
            computeCaseRiskScheduleEconomics(caseId)
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
          Compute and record the chain
        </button>
      )}

      <LineageBlock run={run} stale={stale} />
    </Section>
  );
}

/* ────────────── D5.15 / D5.09 — the gated simulation and its drivers ──── */

function SimulationSection({
  caseId,
  quality,
  simulation,
  run,
  canPlan,
  onChanged,
}: {
  caseId: string;
  quality: CaseScheduleQuality;
  simulation: CaseScheduleSimulation;
  run: PerformanceCalculationRun | undefined;
  canPlan: boolean;
  onChanged: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [iterations, setIterations] = useState(
    String(DEFAULT_SIMULATION_ITERATIONS),
  );
  const [replaySeed, setReplaySeed] = useState("");

  const permitted = quality.gate?.permitted === true;
  const current = simulation.exists && simulation.current;

  return (
    <Section
      icon={<Activity className="h-4 w-4 text-signal-cyan" aria-hidden />}
      title="Integrated risk-cost-schedule simulation (D5.15, D5.09)"
      subtitle="Seeded, reproducible and recorded. It runs only on a schedule that passes its §50 diagnostics — spec II.6: Monte Carlo on poor logic is not useful, so a failing schedule is refused rather than simulated with a caveat."
    >
      <ErrorLine error={error} />

      <div
        className={
          permitted
            ? "rounded border border-emerald-400/25 bg-emerald-400/5 px-2.5 py-1.5 text-xs text-emerald-200"
            : "rounded border border-red-400/25 bg-red-400/5 px-2.5 py-1.5 text-xs text-red-200"
        }
      >
        {gateHeadline(quality)}
      </div>

      {simulation.exists && (
        <div className="rounded-md border border-white/5 bg-white/[0.02] px-2.5 py-2">
          <div className="grid gap-2 sm:grid-cols-4">
            <div>
              <p className="text-[11px] text-slate-500">Deterministic</p>
              <p className="text-sm text-slate-100">
                {simulation.deterministicHours?.toFixed(1)} h
              </p>
            </div>
            <div>
              <p className="text-[11px] text-slate-500">P50</p>
              <p
                className={
                  current ? "text-sm text-slate-100" : "text-sm text-slate-400"
                }
              >
                {simulation.p50Hours?.toFixed(1)} h
              </p>
            </div>
            <div>
              <p className="text-[11px] text-slate-500">P80</p>
              <p
                className={
                  current ? "text-sm text-slate-100" : "text-sm text-slate-400"
                }
              >
                {simulation.p80Hours?.toFixed(1)} h
              </p>
              {overrunDays(
                simulation.p80Hours ?? null,
                simulation.deterministicHours ?? null,
              ) != null && (
                <p className="text-[11px] text-slate-500">
                  {overrunDays(
                    simulation.p80Hours ?? null,
                    simulation.deterministicHours ?? null,
                  )!.toFixed(1)}{" "}
                  day(s) of overrun
                </p>
              )}
            </div>
            <div>
              <p className="text-[11px] text-slate-500">On plan</p>
              <p
                className={
                  current ? "text-sm text-slate-100" : "text-sm text-slate-400"
                }
              >
                {probabilityPercent(simulation.probabilityOnPlan) ?? "—"}
              </p>
            </div>
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            Seed {simulation.seed} · {simulation.iterations} iterations · kernel{" "}
            {simulation.kernelVersion} · §50 score {simulation.qualityScore} ·{" "}
            {simulation.sampledRangeCount} of {simulation.activityCount}{" "}
            activity(ies) carried a range · {simulation.riskLinkCount} risk
            edge(s). The same seed over the same inputs reproduces these numbers
            exactly.
          </p>
        </div>
      )}

      <Refusal text={simulation.refusal} />
      <Refusal text={simulation.staleReason} />
      <Refusal text={simulation.costStaleReason} />
      {(simulation.refusals ?? []).map((r, i) => (
        <Refusal key={i} text={r} />
      ))}

      {/* D5.09. Ranked BY the simulation: each row is the same run re-executed
          at the same seed with that one risk suppressed. */}
      {(simulation.attribution ?? []).length > 0 && (
        <div className="rounded-md border border-white/5 bg-white/[0.02] px-2.5 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            What drives the spread — marginal, per risk
          </p>
          <ul className="mt-1 space-y-1 text-xs text-slate-300">
            {(simulation.attribution ?? []).map((a) => (
              <li key={a.riskId}>
                {attributionSentence(a, simulation.currency ?? null)}
                <span className="block text-[11px] text-slate-500">
                  {a.reason}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {canPlan && permitted && (
        <div className="grid gap-2 sm:grid-cols-3">
          <input
            className={inputClass}
            placeholder={`Iterations (minimum ${SCHEDULE_SIMULATION_POLICY.minimumIterations})`}
            value={iterations}
            onChange={(e) => setIterations(e.target.value)}
          />
          <input
            className={inputClass}
            placeholder="Seed to replay (optional)"
            value={replaySeed}
            onChange={(e) => setReplaySeed(e.target.value)}
          />
          <button
            type="button"
            className={btnClass}
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setError(null);
              const iters = Number(iterations);
              const seed = replaySeed === "" ? undefined : Number(replaySeed);
              runCaseScheduleSimulation({
                caseId,
                iterations: Number.isFinite(iters) ? iters : undefined,
                seed: seed != null && Number.isFinite(seed) ? seed : undefined,
              })
                .then(() => onChanged())
                .catch((e: unknown) =>
                  setError(
                    e instanceof Error
                      ? e.message
                      : "The simulation was refused",
                  ),
                )
                .finally(() => setBusy(false));
            }}
          >
            {simulation.exists ? "Simulate again" : "Simulate and record"}
          </button>
          <p className="text-[11px] text-slate-500 sm:col-span-3">
            Re-running at a recorded seed reproduces that run exactly, which is
            how somebody checks a P80 rather than taking it on trust. Leave the
            seed blank for a fresh one.
          </p>
        </div>
      )}

      {canPlan && !permitted && (
        <p className="text-[11px] text-slate-500">
          There is no override. A failing defect class is fixed in the schedule
          — in P6, where the schedule lives — and re-imported; it is not signed
          off here. A waiver control on this panel would be a way to open the
          gate by typing.
        </p>
      )}

      <LineageBlock run={run} />
    </Section>
  );
}

/* ─────────────── the range that IS the distribution (D5.28/D5.14) ──────── */

/**
 * The duration range had no product write path at all.
 *
 * `optimistic_hours`/`pessimistic_hours` decide the WIDTH of every P80 this
 * slice publishes, feed §50's duration-quality component and D5.14's
 * "uncertainty expressed" component, and were writable only by superuser SQL.
 * So the Schedule Confidence Score was structurally capped at 75 for every
 * customer, with nothing on screen saying why, and the ranges behind the only
 * P50/P80 the transcript proved had been manufactured by a fixture as
 * multiples of the deterministic duration — a spread derived from a
 * deterministic number, which is exactly what this slice forbids.
 *
 * This control is that door. It cannot detect a fabricated range (nothing
 * can), but it makes one a thing a named human recorded with a stated basis,
 * bracketing the duration it is a range around, instead of an anonymous
 * UPDATE nobody can find afterwards.
 */
function DurationRangeSection({
  caseId,
  quality,
  canPlan,
  onChanged,
}: {
  caseId: string;
  quality: CaseScheduleQuality;
  canPlan: boolean;
  onChanged: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [activityId, setActivityId] = useState("");
  const [optimistic, setOptimistic] = useState("");
  const [pessimistic, setPessimistic] = useState("");
  const [basis, setBasis] = useState("");
  const [note, setNote] = useState<string | null>(null);

  const withRange = quality.activitiesWithDurationRange;
  const total = quality.activityCount;

  return (
    <Section
      icon={
        <SlidersHorizontal className="h-4 w-4 text-signal-cyan" aria-hidden />
      }
      title="Duration uncertainty — the range the simulation samples (D5.28, D5.14)"
      subtitle="The optimistic and pessimistic durations ARE the distribution. A single-point duration expresses a certainty the estimate does not have, and no default variance is ever supplied in its place."
    >
      <ErrorLine error={error} />

      <p className="text-xs text-slate-400">
        {withRange} of {total} activity(ies) on this case carry an optimistic
        and pessimistic duration.{" "}
        {withRange === 0
          ? "Until at least one does, there is nothing for the simulation to sample from the schedule itself and the spread can only come from the risk register."
          : "Each range is recorded with its author and its stated basis, because it is what a P80 is made of."}
      </p>

      {note != null && <p className="text-xs text-emerald-200">{note}</p>}

      {canPlan && (
        <div className="grid gap-2 sm:grid-cols-4">
          <input
            className={inputClass}
            placeholder="Activity id"
            value={activityId}
            onChange={(e) => setActivityId(e.target.value)}
          />
          <input
            className={inputClass}
            placeholder="Optimistic hours"
            value={optimistic}
            onChange={(e) => setOptimistic(e.target.value)}
          />
          <input
            className={inputClass}
            placeholder="Pessimistic hours"
            value={pessimistic}
            onChange={(e) => setPessimistic(e.target.value)}
          />
          <input
            className={inputClass}
            placeholder="Basis for this range"
            value={basis}
            onChange={(e) => setBasis(e.target.value)}
          />
          <button
            type="button"
            className={btnClass}
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setError(null);
              setNote(null);
              setScheduleActivityDurationRange({
                caseId,
                activityId,
                optimisticHours: optimistic,
                pessimisticHours: pessimistic,
                basis,
              })
                .then((r) => {
                  setNote(r.note);
                  setActivityId("");
                  setOptimistic("");
                  setPessimistic("");
                  setBasis("");
                  onChanged();
                })
                .catch((e: unknown) =>
                  setError(
                    e instanceof Error ? e.message : "The range was refused",
                  ),
                )
                .finally(() => setBusy(false));
            }}
          >
            State the range
          </button>
        </div>
      )}

      <p className="text-[11px] text-slate-500">
        A range must bracket the activity&apos;s stated duration — the sampler
        takes that duration as the mode — and its ends must differ, because a
        triple whose ends meet is a point estimate with three columns. Neither
        end is ever derived from the other or from the duration.
      </p>
    </Section>
  );
}

/* ───────────────────────────── the panel ─────────────────────────────── */

export function ScheduleAssurancePanel({
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
  const reload = useCallback(() => onChanged(), [onChanged]);

  if (performance.scheduleQuality == null) {
    return (
      <div className="rounded-xl border border-white/6 bg-[#0D1520] p-5 text-xs text-slate-500">
        <SlidersHorizontal className="mr-1 inline h-4 w-4" aria-hidden />
        The schedule assurance view is not available for this case.
      </div>
    );
  }

  return (
    <>
      <QualitySection
        caseId={caseId}
        quality={performance.scheduleQuality}
        run={performance.latestCalculations.case_schedule_quality}
        canPlan={canPlan}
        onChanged={reload}
      />
      <RiskChainSection
        caseId={caseId}
        chain={performance.riskScheduleChain}
        run={performance.latestCalculations.case_risk_schedule_economics}
        canPlan={canPlan}
        onChanged={reload}
      />
      <DurationRangeSection
        caseId={caseId}
        quality={performance.scheduleQuality}
        canPlan={canPlan}
        onChanged={reload}
      />
      <SimulationSection
        caseId={caseId}
        quality={performance.scheduleQuality}
        simulation={performance.simulation}
        run={performance.latestCalculations.case_schedule_simulation}
        canPlan={canPlan}
        onChanged={reload}
      />
      <div className="rounded-xl border border-white/6 bg-[#0D1520] px-4 py-3">
        <div className="flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-slate-500" aria-hidden />
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            What this simulation does not model, and why
          </p>
        </div>
        <ul className="mt-1 space-y-1 text-xs text-slate-500">
          <li>
            Correlation between risks. Every edge is sampled independently, so
            two risks with a common cause are understated. Modelling a
            correlation nobody has estimated would invent the number that
            matters most.
          </li>
          <li>
            Resource constraints. The network is sampled against its logic, not
            against crew availability, so a schedule that is logically
            achievable and unresourceable simulates as achievable.
          </li>
          <li>
            Anything a class marked NOT DIAGNOSABLE would have found. The gate
            is only as wide as what the imported data can answer, and it says
            which questions it could not ask.
          </li>
        </ul>
      </div>
    </>
  );
}
