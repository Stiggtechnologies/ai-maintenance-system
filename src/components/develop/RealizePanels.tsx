/**
 * Sync Develop — Realize / Learn on the Case Workspace
 * (D9.02, D9.03, D9.04, D9.11, D9.13).
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
import { BookOpen, Gauge, Milestone } from "lucide-react";
import {
  CHECKPOINT_HORIZONS,
  DELIVERY_FAILURE_LABELS,
  DELIVERY_FAILURE_TYPES,
  WARRANTY_METRIC_LABELS,
  checkpointLifecycle,
  checkpointLifecycleLabel,
  warrantyCompleteness,
  type WarrantyMetric,
} from "../../lib/develop/realize";
import {
  getCaseOperationalWarranty,
  getCaseProjectLessons,
  getCaseRealizationCheckpoints,
  openRealizationWindow,
  recordCheckpointObservation,
  recordOperationalWarranty,
  recordProjectLesson,
  type CaseOperationalWarranty,
  type CaseProjectLessons,
  type CaseRealizationCheckpoints,
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
                      [key]: { target: e.target.value, unit: prev[key]?.unit ?? "" },
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
                      [key]: { target: prev[key]?.target ?? "", unit: e.target.value },
                    }))
                  }
                  placeholder="Unit"
                  className={inputClass}
                />
              </div>
            ))}
            <button
              onClick={() => {
                const metrics: Record<string, { target: number; unit: string }> =
                  {};
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
      {canRealize && state === "awaiting_observation" && (
        observing ? (
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
        )
      )}
      {canRealize && state === "observed_unverified" && (
        <button
          onClick={() => {
            setBusy(true);
            setError(null);
            verifyValueMetric(row.id, true, "Case workspace realization checkpoint")
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
          them from recorded warranties and benefits — they are not typed in
          by hand.
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

export function RealizeCluster({
  caseId,
  canRealize,
}: {
  caseId: string;
  canRealize: boolean;
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
