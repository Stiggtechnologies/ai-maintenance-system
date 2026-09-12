/**
 * Sync Develop — Realize / Learn on the Case Workspace
 * (D9.02, D9.03, D9.04, D9.11, D9.13, D9.01, D9.12, D9.14, D9.16,
 * D12.16, D12.17).
 *
 * Surfaces the server rows. Nothing here recomputes a due date, a completeness
 * percentage, or a verification. Completeness uses `warrantyCompleteness` so
 * an unstated metric renders "not warranted" instead of 0. Lifecycle uses
 * `checkpointLifecycle` so an observation is never labelled verified.
 *
 * recommend ≠ authorize: the forms are hidden from `ai_admin`. Verification
 * is `verifyValueMetric` — the one existing loop.
 */
import { useEffect, useState, type ReactNode } from "react";
import {
  BookOpen,
  Gauge,
  Milestone,
  Scale,
  Sparkles,
  Target,
} from "lucide-react";
import {
  CHECKPOINT_HORIZONS,
  DELIVERY_FAILURE_LABELS,
  DELIVERY_FAILURE_TYPES,
  RECORDABLE_VALUE_TRAJECTORY_POINTS,
  VALUE_LEAKAGE_BUCKETS,
  WARRANTY_METRIC_LABELS,
  checkpointLifecycle,
  checkpointLifecycleLabel,
  warrantyCompleteness,
  type WarrantyMetric,
} from "../../lib/develop/realize";
import type { WorkspaceEvidence } from "../../lib/develop";
import {
  getCaseBenefitsScreen,
  getCaseLifecycleSuccess,
  getCaseOperationalWarranty,
  getCaseProjectLessons,
  getCaseProjectSuccess,
  getCaseRealizationCheckpoints,
  getCaseValueRealization,
  openRealizationWindow,
  recordCaseValueLeakageAttribution,
  recordCaseValueTrajectoryPoint,
  recordCheckpointObservation,
  recordOperationalWarranty,
  recordProjectLesson,
  runBenefitsAgent,
  runLessonsAgent,
  screenApplicableProjectLessons,
  type ApplicableProjectLessons,
  type CaseBenefitsScreen,
  type CaseLifecycleSuccess,
  type CaseOperationalWarranty,
  type CaseProjectLessons,
  type CaseProjectSuccess,
  type CaseRealizationCheckpoints,
  type CaseValueRealization,
  type BenefitsAgentResult,
  type LessonsAgentResult,
  type RealizationCheckpointRow,
} from "../../services/developService";
import { verifyValueMetric } from "../../services/operatingLoopService";

const inputClass =
  "w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-signal-cyan/50 focus:outline-none";

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

const OPTIONAL_METRICS = [
  "throughput",
  "reliability",
  "maintenance_cost",
  "energy",
  "quality",
  "operating_cost",
] as const satisfies readonly WarrantyMetric[];

export function OperationalWarrantySection({
  caseId,
  canRealize,
  onChanged,
}: {
  caseId: string;
  canRealize: boolean;
  onChanged: () => void;
}) {
  const [payload, setPayload] = useState<CaseOperationalWarranty | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [systemLabel, setSystemLabel] = useState("");
  const [availability, setAvailability] = useState("");
  const [basis, setBasis] = useState("");
  const [optional, setOptional] = useState<
    Record<string, { target: string; unit: string }>
  >({});

  const load = () => {
    getCaseOperationalWarranty(caseId)
      .then(setPayload)
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Could not load warranty"),
      );
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId]);

  return (
    <Section
      icon={<Gauge className="h-4 w-4 text-slate-500" aria-hidden />}
      title="Operational performance warranty"
      subtitle="Internal seven-metric commitment on ram_targets (spec I.36). vendor warranty_terms is a different store. Unstated metrics are not warranted — never zero. Survives handover."
    >
      <ErrorLine error={error} />
      {payload == null ? (
        <p className="text-xs text-slate-500">Loading warranty…</p>
      ) : !payload.available ? (
        <p className="text-xs text-slate-500">
          {payload.reason ??
            "An operational warranty binds to the delivery-side capital project."}
        </p>
      ) : payload.warranties.length === 0 ? (
        <p className="text-xs text-slate-500">
          No internal performance warranty recorded on this case yet.
        </p>
      ) : (
        <div className="space-y-3">
          {payload.warranties.map((w) => {
            const complete = warrantyCompleteness(w.metrics);
            return (
              <div
                key={w.id}
                className="rounded-lg bg-white/[0.03] px-3 py-2 text-xs"
              >
                <div className="font-semibold text-slate-200">
                  {w.systemLabel}
                </div>
                <div className="mt-0.5 text-[11px] text-slate-500">
                  {w.survivesHandover
                    ? "Survives handover"
                    : "Does not survive handover"}
                  {w.startupAt
                    ? ` · startup ${w.startupAt}`
                    : " · clock not started"}
                  {w.basis ? ` · basis: ${w.basis}` : ""}
                </div>
                <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                  {complete.stated.map((m) => (
                    <li key={m.key} className="text-slate-300">
                      {WARRANTY_METRIC_LABELS[m.key]}: {m.target} {m.unit}
                    </li>
                  ))}
                  {complete.notWarranted.map((k) => (
                    <li key={k} className="text-slate-500">
                      {WARRANTY_METRIC_LABELS[k as WarrantyMetric]}: not
                      warranted
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
      {canRealize &&
        payload?.available &&
        (adding ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <input
              value={systemLabel}
              onChange={(e) => setSystemLabel(e.target.value)}
              placeholder="System label"
              className={inputClass}
            />
            <input
              type="number"
              step="any"
              min="0"
              max="1"
              value={availability}
              onChange={(e) => setAvailability(e.target.value)}
              placeholder="Availability fraction (required, 0–1)"
              className={inputClass}
            />
            <input
              value={basis}
              onChange={(e) => setBasis(e.target.value)}
              placeholder="Basis — where the commitment comes from (10+ characters)"
              className={`${inputClass} sm:col-span-2`}
            />
            {OPTIONAL_METRICS.map((key) => (
              <div key={key} className="grid grid-cols-2 gap-2 sm:col-span-2">
                <input
                  type="number"
                  step="any"
                  value={optional[key]?.target ?? ""}
                  onChange={(e) =>
                    setOptional((prev) => ({
                      ...prev,
                      [key]: {
                        target: e.target.value,
                        unit: prev[key]?.unit ?? "",
                      },
                    }))
                  }
                  placeholder={`${WARRANTY_METRIC_LABELS[key]} target (omit if not warranted)`}
                  className={inputClass}
                />
                <input
                  value={optional[key]?.unit ?? ""}
                  onChange={(e) =>
                    setOptional((prev) => ({
                      ...prev,
                      [key]: {
                        target: prev[key]?.target ?? "",
                        unit: e.target.value,
                      },
                    }))
                  }
                  placeholder="Unit"
                  className={inputClass}
                />
              </div>
            ))}
            <button
              onClick={() => {
                const metrics: Record<
                  string,
                  { target: number; unit: string }
                > = {};
                for (const key of OPTIONAL_METRICS) {
                  const row = optional[key];
                  if (row?.target && row.unit.trim()) {
                    metrics[key] = {
                      target: Number(row.target),
                      unit: row.unit,
                    };
                  }
                }
                setBusy(true);
                setError(null);
                recordOperationalWarranty({
                  caseId,
                  systemLabel,
                  targetAvailability: Number(availability),
                  warrantyBasis: basis,
                  metrics,
                })
                  .then(() => {
                    setAdding(false);
                    setSystemLabel("");
                    setAvailability("");
                    setBasis("");
                    setOptional({});
                    load();
                    onChanged();
                  })
                  .catch((e) =>
                    setError(e instanceof Error ? e.message : "Refused"),
                  )
                  .finally(() => setBusy(false));
              }}
              disabled={busy}
              className="rounded-lg bg-signal-cyan/10 border border-signal-cyan/30 px-3 py-1.5 text-xs font-semibold text-signal-cyan disabled:opacity-50 sm:col-span-2"
            >
              {busy
                ? "Recording…"
                : "Record internal warranty (does not verify, does not start the clock)"}
            </button>
          </div>
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="text-xs font-semibold text-signal-cyan hover:underline"
          >
            + Record an operational performance warranty
          </button>
        ))}
    </Section>
  );
}

function CheckpointRow({
  row,
  startupAt,
  canRealize,
  onChanged,
}: {
  row: RealizationCheckpointRow;
  startupAt: string | null;
  canRealize: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [observing, setObserving] = useState(false);
  const [observed, setObserved] = useState("");
  const [method, setMethod] = useState("");
  const [evidence, setEvidence] = useState("");
  const state = checkpointLifecycle({
    startupAt,
    observedAt: row.observedAt,
    status: row.status,
  });

  return (
    <div className="rounded-lg bg-white/[0.03] px-3 py-2 text-xs">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-semibold text-slate-200">{row.label}</span>
        <span className="text-slate-500">day {row.horizonDays}</span>
        {row.dueOn ? (
          <span className="text-slate-500">due {row.dueOn}</span>
        ) : (
          <span className="text-slate-500">no due date</span>
        )}
        <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold bg-white/5 text-slate-300">
          {checkpointLifecycleLabel(state)}
        </span>
      </div>
      <div className="mt-1 text-[11px] text-slate-500">
        Design:{" "}
        {row.designValue != null
          ? `${row.designValue} ${row.unit ?? ""}`
          : "not stated"}
        {" · "}
        Observed:{" "}
        {row.observedValue != null
          ? `${row.observedValue} ${row.unit ?? ""}`
          : "none"}
      </div>
      <ErrorLine error={error} />
      {canRealize &&
        state === "awaiting_observation" &&
        (observing ? (
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <input
              type="number"
              step="any"
              value={observed}
              onChange={(e) => setObserved(e.target.value)}
              placeholder="Observed actual"
              className={inputClass}
            />
            <input
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              placeholder="Measurement method (10+ characters)"
              className={inputClass}
            />
            <input
              value={evidence}
              onChange={(e) => setEvidence(e.target.value)}
              placeholder="Evidence record (10+ characters)"
              className={`${inputClass} sm:col-span-2`}
            />
            <button
              onClick={() => {
                setBusy(true);
                setError(null);
                recordCheckpointObservation({
                  metricId: row.id,
                  observedValue: Number(observed),
                  method,
                  evidence,
                })
                  .then(() => {
                    setObserving(false);
                    onChanged();
                  })
                  .catch((e) =>
                    setError(e instanceof Error ? e.message : "Refused"),
                  )
                  .finally(() => setBusy(false));
              }}
              disabled={busy}
              className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-slate-200 disabled:opacity-50 sm:col-span-2"
            >
              {busy ? "Recording…" : "Record observation (does not verify)"}
            </button>
          </div>
        ) : (
          <button
            onClick={() => setObserving(true)}
            className="mt-2 text-xs font-semibold text-signal-cyan hover:underline"
          >
            Record observed actual
          </button>
        ))}
      {canRealize && state === "observed_unverified" && (
        <button
          onClick={() => {
            setBusy(true);
            setError(null);
            verifyValueMetric(
              row.id,
              true,
              "Case workspace realization checkpoint",
            )
              .then(() => onChanged())
              .catch((e) =>
                setError(e instanceof Error ? e.message : "Refused"),
              )
              .finally(() => setBusy(false));
          }}
          disabled={busy}
          className="mt-2 rounded-lg bg-signal-cyan/10 border border-signal-cyan/30 px-3 py-1.5 text-xs font-semibold text-signal-cyan disabled:opacity-50"
        >
          {busy ? "Verifying…" : "Verify observation (authorize)"}
        </button>
      )}
    </div>
  );
}

export function RealizationCheckpointsSection({
  caseId,
  canRealize,
  startupAt,
  onChanged,
}: {
  caseId: string;
  canRealize: boolean;
  startupAt: string | null;
  onChanged: () => void;
}) {
  const [payload, setPayload] = useState<CaseRealizationCheckpoints | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [startup, setStartup] = useState("");

  const load = () => {
    getCaseRealizationCheckpoints(caseId)
      .then(setPayload)
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Could not load checkpoints"),
      );
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId]);

  const grouped = CHECKPOINT_HORIZONS.map((h) => ({
    horizon: h,
    rows: (payload?.checkpoints ?? []).filter((c) => c.horizonDays === h),
  }));

  return (
    <Section
      icon={<Milestone className="h-4 w-4 text-slate-500" aria-hidden />}
      title="Realization checkpoints"
      subtitle="30/90/180/365 shells on value_metrics, auto-created when a named human opens the post-startup window. Observation is not verification — verify_value_metric is the one loop."
    >
      <ErrorLine error={error} />
      {payload != null && payload.checkpoints.length === 0 ? (
        <p className="text-xs text-slate-500">
          No 30/90/180/365 shells yet. Opening the realization window generates
          them from recorded warranties and benefits — they are not typed in by
          hand.
        </p>
      ) : null}
      {grouped.map(
        (g) =>
          g.rows.length > 0 && (
            <div key={g.horizon} className="space-y-1.5">
              <div className="text-[11px] uppercase tracking-wide text-slate-500">
                Day {g.horizon}
              </div>
              {g.rows.map((row) => (
                <CheckpointRow
                  key={row.id}
                  row={row}
                  startupAt={startupAt}
                  canRealize={canRealize}
                  onChanged={() => {
                    load();
                    onChanged();
                  }}
                />
              ))}
            </div>
          ),
      )}
      {canRealize && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <input
            type="date"
            value={startup}
            onChange={(e) => setStartup(e.target.value)}
            className={inputClass}
          />
          <button
            onClick={() => {
              setBusy(true);
              setError(null);
              openRealizationWindow({ caseId, startupOn: startup })
                .then(() => {
                  setStartup("");
                  load();
                  onChanged();
                })
                .catch((e) =>
                  setError(e instanceof Error ? e.message : "Refused"),
                )
                .finally(() => setBusy(false));
            }}
            disabled={busy || !startup}
            className="rounded-lg bg-signal-cyan/10 border border-signal-cyan/30 px-3 py-1.5 text-xs font-semibold text-signal-cyan disabled:opacity-50"
          >
            {busy
              ? "Opening…"
              : "Open realization window (generates 30/90/180/365 shells)"}
          </button>
        </div>
      )}
    </Section>
  );
}

export function ProjectLessonsSection({
  caseId,
  canRealize,
  onChanged,
}: {
  caseId: string;
  canRealize: boolean;
  onChanged: () => void;
}) {
  const [payload, setPayload] = useState<CaseProjectLessons | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [failureModeKey, setFailureModeKey] = useState("");
  const [cause, setCause] = useState("");
  const [correctiveAction, setCorrectiveAction] = useState("");
  const [applicability, setApplicability] = useState("");

  const load = () => {
    getCaseProjectLessons(caseId)
      .then(setPayload)
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Could not load lessons"),
      );
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId]);

  return (
    <Section
      icon={<BookOpen className="h-4 w-4 text-slate-500" aria-hidden />}
      title="Project FRACAS / lessons"
      subtitle="learning_events is the one learning store. The eight delivery failure types are a taxonomy_definitions branch (spec I.37). Capturing a lesson does not adopt a standard."
    >
      <ErrorLine error={error} />
      {payload != null && payload.lessons.length === 0 ? (
        <p className="text-xs text-slate-500">
          No project lessons recorded on this case yet.
        </p>
      ) : (
        <div className="space-y-1.5">
          {(payload?.lessons ?? []).map((lesson) => (
            <div
              key={lesson.id}
              className="rounded-lg bg-white/[0.03] px-3 py-2 text-xs"
            >
              <div className="font-semibold text-slate-200">{lesson.title}</div>
              <div className="mt-0.5 text-[11px] text-slate-500">
                {DELIVERY_FAILURE_LABELS[
                  lesson.failureModeKey as keyof typeof DELIVERY_FAILURE_LABELS
                ] ?? lesson.failureModeKey}
              </div>
              <div className="mt-1 text-slate-400">Cause: {lesson.cause}</div>
              <div className="text-slate-400">
                Corrective action: {lesson.correctiveAction}
              </div>
              <div className="text-slate-400">
                Applies to: {lesson.applicability}
              </div>
            </div>
          ))}
        </div>
      )}
      {canRealize &&
        (adding ? (
          <div className="grid grid-cols-1 gap-2">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Lesson title"
              className={inputClass}
            />
            <select
              value={failureModeKey}
              onChange={(e) => setFailureModeKey(e.target.value)}
              className={inputClass}
            >
              <option value="">Delivery failure type (one of eight)</option>
              {DELIVERY_FAILURE_TYPES.map((key) => (
                <option key={key} value={key}>
                  {DELIVERY_FAILURE_LABELS[key]}
                </option>
              ))}
            </select>
            <input
              value={cause}
              onChange={(e) => setCause(e.target.value)}
              placeholder="Cause (10+ characters)"
              className={inputClass}
            />
            <input
              value={correctiveAction}
              onChange={(e) => setCorrectiveAction(e.target.value)}
              placeholder="Corrective action (10+ characters)"
              className={inputClass}
            />
            <input
              value={applicability}
              onChange={(e) => setApplicability(e.target.value)}
              placeholder="Applicability — where a future case should see this (10+ characters)"
              className={inputClass}
            />
            <button
              onClick={() => {
                setBusy(true);
                setError(null);
                recordProjectLesson({
                  caseId,
                  failureModeKey,
                  title,
                  cause,
                  correctiveAction,
                  applicability,
                })
                  .then(() => {
                    setAdding(false);
                    setTitle("");
                    setFailureModeKey("");
                    setCause("");
                    setCorrectiveAction("");
                    setApplicability("");
                    load();
                    onChanged();
                  })
                  .catch((e) =>
                    setError(e instanceof Error ? e.message : "Refused"),
                  )
                  .finally(() => setBusy(false));
              }}
              disabled={busy}
              className="rounded-lg bg-signal-cyan/10 border border-signal-cyan/30 px-3 py-1.5 text-xs font-semibold text-signal-cyan disabled:opacity-50"
            >
              {busy
                ? "Recording…"
                : "Record project lesson (does not adopt a standard)"}
            </button>
          </div>
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="text-xs font-semibold text-signal-cyan hover:underline"
          >
            + Record a project lesson
          </button>
        ))}
    </Section>
  );
}

function verdictTone(verdict: string): string {
  if (verdict === "met" || verdict === "success") return "text-emerald-300";
  if (verdict === "not_met" || verdict === "not_success") return "text-red-300";
  return "text-amber-300";
}

export function ApplicableLessonsBanner({ caseId }: { caseId: string }) {
  const [payload, setPayload] = useState<ApplicableProjectLessons | null>(null);
  const [agentResult, setAgentResult] = useState<LessonsAgentResult | null>(null);
  const [agentBusy, setAgentBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    screenApplicableProjectLessons(caseId)
      .then(setPayload)
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Could not screen lessons"),
      );
  }, [caseId]);

  if (error) {
    return (
      <div className="rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-xs text-red-300">
        {error}
      </div>
    );
  }
  if (payload == null) return null;
  return (
    <div className="mt-4 space-y-2">
      <div
        className={`rounded-xl border px-4 py-3 ${payload.count === 0 ? "border-white/6 bg-[#0D1520]" : "border-signal-cyan/30 bg-signal-cyan/5"}`}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-slate-100">
              {payload.count === 0
                ? (payload.emptyReason ?? "0 applicable lessons.")
                : `${payload.count} applicable lesson${payload.count === 1 ? "" : "s"} before the first engineering dollar`}
            </div>
            <p className="mt-1 text-[11px] text-slate-500">{payload.basis}</p>
          </div>
          <button
            type="button"
            disabled={agentBusy}
            className="rounded-lg border border-signal-cyan/30 px-3 py-1.5 text-xs font-semibold text-signal-cyan disabled:opacity-40"
            onClick={() => {
              setAgentBusy(true);
              setError(null);
              runLessonsAgent(caseId)
                .then(setAgentResult)
                .catch((caught) =>
                  setError(
                    caught instanceof Error
                      ? caught.message
                      : "Lessons Agent failed",
                  ),
                )
                .finally(() => setAgentBusy(false));
            }}
          >
            {agentBusy ? "Comparing history…" : "Run Lessons Agent"}
          </button>
        </div>
        {payload.count > 0 && (
          <ul className="mt-2 space-y-1.5">
            {payload.lessons.map((lesson) => (
              <li key={lesson.id} className="text-xs text-slate-300">
                <span className="font-semibold">{lesson.title}</span>
                <span className="text-slate-500"> — {lesson.matchReason}</span>
                <div className="text-[11px] text-slate-500">
                  {lesson.applicability}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      {agentResult && (
        <div className="rounded-xl border border-signal-cyan/20 bg-[#0D1520] px-4 py-3 text-xs">
          <div className="flex items-center gap-1.5 font-semibold text-slate-100">
            <Sparkles className="h-3.5 w-3.5 text-signal-cyan" aria-hidden />
            Lessons Agent · project-history comparison
          </div>
          <p className="mt-2 font-semibold text-signal-cyan">
            {agentResult.analysis.headline}
          </p>
          {agentResult.analysis.findings.map((finding) => (
            <div
              key={finding.lessonId}
              className="mt-2 rounded-lg border border-white/6 bg-white/[0.02] p-2.5 text-slate-300"
            >
              <div className="font-semibold">{finding.title}</div>
              <div className="mt-1 text-slate-400">
                Why it matched: {finding.matchReason}
              </div>
              <div className="mt-1">Cause: {finding.cause}</div>
              <div className="mt-1">
                Recorded corrective action: {finding.correctiveAction}
              </div>
              <div className="mt-1 break-all text-[10px] text-slate-500">
                Records: {finding.sourceRefs.join(" · ")}
              </div>
            </div>
          ))}
          <ul className="mt-2 list-disc space-y-1 pl-4 text-amber-200">
            {agentResult.analysis.limitations.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p className="mt-2 text-[10px] text-slate-500">
            {agentResult.disclaimer}
          </p>
        </div>
      )}
    </div>
  );
}

export function ValueRealizationSection({ caseId }: { caseId: string }) {
  const [payload, setPayload] = useState<CaseValueRealization | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getCaseValueRealization(caseId)
      .then(setPayload)
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Could not load VR"),
      );
  }, [caseId]);

  return (
    <Section
      icon={<Scale className="h-4 w-4 text-slate-500" aria-hidden />}
      title="Value Realization"
      subtitle="VR = RealizedBenefit / ApprovedExpectedBenefit (spec §52). No approved BENEFITS baseline → no percentage. Unverified benefits are omitted, not zeroed."
    >
      <ErrorLine error={error} />
      {payload == null ? (
        <p className="text-xs text-slate-500">Loading value realization…</p>
      ) : !payload.evaluable ? (
        <p className="text-xs text-amber-300">{payload.reason}</p>
      ) : (
        <div className="text-xs text-slate-300">
          <div className="text-lg font-semibold text-slate-100">
            {(payload.ratio ?? 0).toFixed(3)}
            <span className="ml-2 text-xs font-normal text-slate-500">
              {payload.unit}
            </span>
          </div>
          <div className="mt-1 text-slate-500">
            Realized {payload.realizedBenefit} / approved{" "}
            {payload.approvedExpectedBenefit}.{" "}
            {payload.unverifiedBenefitCount ?? 0} unverified benefit
            {(payload.unverifiedBenefitCount ?? 0) === 1 ? "" : "s"} omitted.
          </div>
          <div className="mt-1 text-[11px] text-slate-500">{payload.note}</div>
        </div>
      )}
    </Section>
  );
}

function humanize(value: string) {
  return value.replaceAll("_", " ");
}

function BenefitsAgentPanel({
  caseId,
  onError,
}: {
  caseId: string;
  onError: (message: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BenefitsAgentResult | null>(null);

  return (
    <div className="rounded-lg border border-signal-cyan/15 bg-signal-cyan/[0.03] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
            <Sparkles className="h-3.5 w-3.5 text-signal-cyan" aria-hidden />
            Benefits Agent · did we get what we paid for?
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            Reads the governed benefit, checkpoint and leakage records. It
            cannot verify a value, prove cause, approve investment or change an
            operating record.
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          className="rounded-lg border border-signal-cyan/30 px-3 py-1.5 text-xs font-semibold text-signal-cyan disabled:opacity-40"
          onClick={() => {
            setBusy(true);
            onError(null);
            runBenefitsAgent(caseId)
              .then(setResult)
              .catch((e) =>
                onError(
                  e instanceof Error ? e.message : "Benefits Agent failed",
                ),
              )
              .finally(() => setBusy(false));
          }}
        >
          {busy ? "Reading records…" : "Run Benefits Agent"}
        </button>
      </div>
      {result && (
        <div className="mt-3 space-y-2 border-t border-white/6 pt-3 text-xs">
          <p
            className={
              result.analysis.verdict === "shortfall"
                ? "font-semibold text-amber-200"
                : result.analysis.verdict === "incomplete"
                  ? "font-semibold text-slate-300"
                  : "font-semibold text-emerald-300"
            }
          >
            {result.analysis.headline}
          </p>
          <div className="grid gap-1 sm:grid-cols-2">
            {result.analysis.findings.map((finding) => (
              <div key={finding.benefitId} className="text-slate-300">
                {finding.label} · {humanize(finding.status)} · owner{" "}
                {finding.owner}
              </div>
            ))}
          </div>
          {result.analysis.leakage.recordedAttributions.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-slate-500">
                Independently verified attribution statements
              </div>
              {result.analysis.leakage.recordedAttributions.map((item) => (
                <p
                  key={`${item.bucket}-${item.value}`}
                  className="mt-1 text-slate-300"
                >
                  {humanize(item.bucket)} · {item.value}{" "}
                  {result.analysis.leakage.unit} · {item.kind} — {item.basis}
                </p>
              ))}
            </div>
          )}
          {result.analysis.limitations.length > 0 && (
            <ul className="list-disc space-y-1 pl-4 text-amber-200">
              {result.analysis.limitations.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
          <p className="break-all text-[10px] text-slate-500">
            Records: {result.analysis.evidenceRefs.join(" · ") || "none"}
          </p>
          <p className="text-[10px] text-slate-500">{result.disclaimer}</p>
        </div>
      )}
    </div>
  );
}

export function BenefitsAndLeakageSection({
  caseId,
  evidence,
  canRealize,
}: {
  caseId: string;
  evidence: WorkspaceEvidence[];
  canRealize: boolean;
}) {
  const [payload, setPayload] = useState<CaseBenefitsScreen | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"point" | "attribution" | null>(null);

  const load = () => {
    getCaseBenefitsScreen(caseId)
      .then(setPayload)
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Could not load benefits"),
      );
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId]);

  const leakage = payload?.valueLeakage;
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      setMode(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Refused");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      icon={<Scale className="h-4 w-4 text-slate-500" aria-hidden />}
      title="Benefits and value leakage"
      subtitle="Expected → forecast → human-verified actual, plus the six lifecycle value points and all seven §53 leakage buckets. Missing and unattributed value stay visible; nothing is auto-allocated."
    >
      <ErrorLine error={error} />
      <BenefitsAgentPanel caseId={caseId} onError={setError} />
      {payload == null ? (
        <p className="text-xs text-slate-500">Loading the benefits screen…</p>
      ) : payload.benefits.length === 0 ? (
        <p className="text-xs text-slate-500">No case benefits recorded.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-xs">
            <thead className="text-[10px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-2">Benefit</th>
                <th>Owner</th>
                <th>Expected</th>
                <th>Forecast</th>
                <th>Actual</th>
                <th>Variance</th>
              </tr>
            </thead>
            <tbody>
              {payload.benefits.map((row) => (
                <tr
                  key={row.id}
                  className="border-t border-white/6 text-slate-300"
                >
                  <td className="py-2 pr-3">
                    <div className="font-semibold text-slate-200">
                      {row.label}
                    </div>
                    <div className="text-[10px] text-slate-500">
                      due {row.expectedDate}
                    </div>
                  </td>
                  <td className="pr-3">{row.owner}</td>
                  <td>
                    {row.expected} {row.unit}
                  </td>
                  <td>
                    {row.currentForecast == null
                      ? "missing"
                      : `${row.currentForecast} ${row.unit}`}
                    <div className="text-[10px] text-slate-500">
                      {humanize(row.forecastStatus)}
                    </div>
                  </td>
                  <td>
                    {row.actual == null
                      ? "missing"
                      : `${row.actual} ${row.unit}`}
                  </td>
                  <td
                    className={
                      row.variance != null && row.variance < 0
                        ? "text-red-300"
                        : "text-slate-300"
                    }
                  >
                    {row.variance == null
                      ? "not calculable"
                      : `${row.variance} ${row.unit}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {leakage && !leakage.leakageEvaluable ? (
        <p className="text-xs text-amber-300">{leakage.reason}</p>
      ) : leakage ? (
        <div className="space-y-3 rounded-lg border border-white/8 bg-white/[0.02] p-3">
          <div className="grid gap-2 sm:grid-cols-3">
            <div>
              <div className="text-[10px] uppercase text-slate-500">
                Approved
              </div>
              <div className="font-semibold text-slate-200">
                {leakage.approvedValue} {leakage.unit}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-slate-500">
                Realized
              </div>
              <div className="font-semibold text-slate-200">
                {leakage.realizedValue} {leakage.unit}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-slate-500">
                Leakage
              </div>
              <div className="font-semibold text-amber-200">
                {leakage.approvedToRealizedLeakage} {leakage.unit}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(leakage.trajectory ?? []).map((row) => (
              <span
                key={row.point}
                className={`rounded-full border px-2 py-1 text-[10px] ${row.status === "missing" || row.status === "unit_mismatch" ? "border-amber-400/20 text-amber-200" : "border-emerald-400/20 text-emerald-200"}`}
              >
                {humanize(row.point)} ·{" "}
                {row.value == null ? row.status : `${row.value} ${row.unit}`}
              </span>
            ))}
          </div>
          {(leakage.missingPoints?.length ?? 0) > 0 && (
            <p className="text-[11px] text-amber-200">
              Named trajectory gaps:{" "}
              {leakage.missingPoints?.map(humanize).join(", ")}.
            </p>
          )}
          <div className="grid gap-1 sm:grid-cols-2">
            {(leakage.attributions ?? []).map((row) => (
              <div key={row.id} className="text-xs text-slate-300">
                {humanize(row.bucket)} · {row.value} {leakage.unit} · {row.kind}
              </div>
            ))}
            <div
              className={
                leakage.attributionValid
                  ? "text-xs text-slate-300"
                  : "text-xs text-red-300"
              }
            >
              unattributed residual · {leakage.unattributedResidual}{" "}
              {leakage.unit}
            </div>
          </div>
          {!leakage.attributionValid && (
            <p className="text-xs text-red-300">
              Attribution is invalid: verified allocations exceed positive
              approved-to-realized leakage, or the case realized a gain. Nothing
              was normalized.
            </p>
          )}
          {(leakage.pendingVerification ?? []).map((row) => (
            <div
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded border border-amber-400/15 px-2 py-1.5 text-xs text-amber-100"
            >
              <span>
                Awaiting independent verification · {row.label} · {row.value}{" "}
                {row.unit}
              </span>
              {canRealize && (
                <button
                  disabled={busy}
                  className="font-semibold text-signal-cyan"
                  onClick={() =>
                    void run(() =>
                      verifyValueMetric(
                        row.id,
                        true,
                        "Independent review confirms the cited value record; this is not causal proof or investment approval.",
                      ),
                    )
                  }
                >
                  Verify evidence
                </button>
              )}
            </div>
          ))}
          <p className="text-[10px] text-slate-500">
            {leakage.decisionBoundary}
          </p>
        </div>
      ) : null}

      {canRealize && (
        <div className="flex flex-wrap gap-3 text-xs font-semibold text-signal-cyan">
          <button onClick={() => setMode("point")}>
            + Record lifecycle point
          </button>
          <button onClick={() => setMode("attribution")}>
            + Attribute leakage
          </button>
        </div>
      )}
      {mode && (
        <form
          className="grid gap-2 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const value = Number(data.get("value"));
            const evidenceItemId = String(data.get("evidenceItemId") ?? "");
            const basis = String(data.get("basis") ?? "");
            void run(() =>
              mode === "point"
                ? recordCaseValueTrajectoryPoint({
                    caseId,
                    point: String(data.get("point") ?? ""),
                    value,
                    unit: String(data.get("unit") ?? ""),
                    basis,
                    evidenceItemId,
                  })
                : recordCaseValueLeakageAttribution({
                    caseId,
                    bucket: String(data.get("bucket") ?? ""),
                    value,
                    attributionKind: String(data.get("kind") ?? "") as
                      "causal" | "contributing",
                    basis,
                    evidenceItemId,
                  }),
            );
          }}
        >
          {mode === "point" ? (
            <>
              <select
                name="point"
                required
                defaultValue=""
                className={inputClass}
              >
                <option value="" disabled>
                  Lifecycle point…
                </option>
                {RECORDABLE_VALUE_TRAJECTORY_POINTS.map((point) => (
                  <option key={point} value={point}>
                    {humanize(point)}
                  </option>
                ))}
              </select>
              <input
                name="unit"
                required
                placeholder="Unit (must match approved benefits)"
                className={inputClass}
              />
            </>
          ) : (
            <>
              <select
                name="bucket"
                required
                defaultValue=""
                className={inputClass}
              >
                <option value="" disabled>
                  Leakage bucket…
                </option>
                {VALUE_LEAKAGE_BUCKETS.map((bucket) => (
                  <option key={bucket} value={bucket}>
                    {humanize(bucket)}
                  </option>
                ))}
              </select>
              <select
                name="kind"
                required
                defaultValue="causal"
                className={inputClass}
              >
                <option value="causal">causal</option>
                <option value="contributing">contributing</option>
              </select>
            </>
          )}
          <input
            name="value"
            required
            type="number"
            step="any"
            min={mode === "attribution" ? 0 : undefined}
            placeholder="Value"
            className={inputClass}
          />
          <select
            name="evidenceItemId"
            required
            defaultValue=""
            className={inputClass}
          >
            <option value="" disabled>
              Evidence source…
            </option>
            {evidence.map((item) => (
              <option key={item.id} value={item.id}>
                {item.description ?? item.sourceReference ?? item.id}
              </option>
            ))}
          </select>
          <input
            name="basis"
            required
            minLength={mode === "attribution" ? 20 : 10}
            placeholder={
              mode === "point"
                ? "Point basis (10+ characters)"
                : "Causal basis (20+ characters)"
            }
            className="sm:col-span-2 w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
          />
          <button
            disabled={busy || evidence.length === 0}
            className="rounded-lg border border-signal-cyan/30 px-3 py-2 text-xs font-semibold text-signal-cyan disabled:opacity-40"
          >
            Record for independent verification
          </button>
        </form>
      )}
    </Section>
  );
}

export function ProjectSuccessSection({ caseId }: { caseId: string }) {
  const [payload, setPayload] = useState<CaseProjectSuccess | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getCaseProjectSuccess(caseId)
      .then(setPayload)
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Could not load success"),
      );
  }, [caseId]);

  return (
    <Section
      icon={<Target className="h-4 w-4 text-slate-500" aria-hidden />}
      title="Project success (eight dimensions)"
      subtitle="Spec §55: Safety, Value, Quality, Schedule, Cost, RAM, Operations, Stakeholders. Missing slots are named, never zeroed. Never merely on-time + on-budget."
    >
      <ErrorLine error={error} />
      {payload == null ? (
        <p className="text-xs text-slate-500">Loading project success…</p>
      ) : (
        <>
          <p className="text-xs text-slate-300">{payload.headline}</p>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {(payload.dimensions ?? []).map((slot) => (
              <div
                key={slot.key}
                className="rounded-lg bg-white/[0.03] px-3 py-2 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-200">
                    {slot.label}
                  </span>
                  <span className={verdictTone(slot.verdict)}>
                    {slot.verdict.replace(/_/g, " ")}
                  </span>
                </div>
                <div className="mt-0.5 text-[11px] text-slate-500">
                  {slot.missingReason ?? slot.value ?? slot.source}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </Section>
  );
}

export function LifecycleSuccessSection({ caseId }: { caseId: string }) {
  const [payload, setPayload] = useState<CaseLifecycleSuccess | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getCaseLifecycleSuccess(caseId)
      .then(setPayload)
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Could not load phases"),
      );
  }, [caseId]);

  return (
    <Section
      icon={<Milestone className="h-4 w-4 text-slate-500" aria-hidden />}
      title="Lifecycle success (per phase)"
      subtitle="Phases are the adopted framework's stages. On-budget-but-unreliable is failure. Cost and RAM stay case-level and are labelled so."
    >
      <ErrorLine error={error} />
      {payload == null ? (
        <p className="text-xs text-slate-500">Loading lifecycle success…</p>
      ) : !payload.available ? (
        <p className="text-xs text-slate-500">{payload.reason}</p>
      ) : (
        <>
          <p className="text-[11px] text-slate-500">{payload.rule}</p>
          <div className="space-y-2">
            {(payload.phases ?? []).map((phase) => (
              <div
                key={phase.stageKey}
                className="rounded-lg bg-white/[0.03] px-3 py-2 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-200">
                    {phase.displayName}
                    {phase.isCurrent ? " · current" : ""}
                  </span>
                  <span className={verdictTone(phase.verdict)}>
                    {phase.verdict.replace(/_/g, " ")}
                  </span>
                </div>
                <div className="mt-0.5 text-[11px] text-slate-500">
                  Gates {phase.reviewedCount}/{phase.gateCount} · cost{" "}
                  {phase.costVerdict.replace(/_/g, " ")} ({phase.costScope}) ·
                  RAM {phase.ramVerdict.replace(/_/g, " ")} ({phase.ramScope})
                  {phase.onBudgetUnreliable
                    ? " · on-budget-but-unreliable"
                    : ""}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </Section>
  );
}

export function RealizeCluster({
  caseId,
  canRealize,
  evidence,
}: {
  caseId: string;
  canRealize: boolean;
  evidence: WorkspaceEvidence[];
}) {
  const [tick, setTick] = useState(0);
  const [startupAt, setStartupAt] = useState<string | null>(null);

  useEffect(() => {
    getCaseOperationalWarranty(caseId)
      .then((w) => {
        const started = (w.warranties ?? []).find((row) => row.startupAt);
        setStartupAt(started?.startupAt ?? null);
      })
      .catch(() => setStartupAt(null));
  }, [caseId, tick]);

  const refresh = () => setTick((n) => n + 1);

  return (
    <>
      <ValueRealizationSection caseId={caseId} />
      <BenefitsAndLeakageSection
        caseId={caseId}
        evidence={evidence}
        canRealize={canRealize}
      />
      <ProjectSuccessSection caseId={caseId} />
      <LifecycleSuccessSection caseId={caseId} />
      <OperationalWarrantySection
        caseId={caseId}
        canRealize={canRealize}
        onChanged={refresh}
      />
      <RealizationCheckpointsSection
        caseId={caseId}
        canRealize={canRealize}
        startupAt={startupAt}
        onChanged={refresh}
      />
      <ProjectLessonsSection
        caseId={caseId}
        canRealize={canRealize}
        onChanged={refresh}
      />
    </>
  );
}
