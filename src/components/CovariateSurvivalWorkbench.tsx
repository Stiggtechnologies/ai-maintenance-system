import { useMemo, useState } from "react";
import { useAsyncData } from "../hooks/useAsyncData";
import {
  prepareSurvivalSource,
  type SurvivalOverlay,
  type SurvivalSourceEvent,
} from "../lib/reliability/survival-source";
import {
  captureSurvivalOverlay,
  loadSurvivalWorkspace,
  reviewSurvivalOverlay,
  runSurvivalAnalysis,
  type SurvivalCovariate,
  type SurvivalReceipt,
} from "../services/survivalCovariateService";
import { ErrorState, LoadingState } from "./ui/AsyncStates";
import type { CoxDiagnostics } from "../lib/reliability/cox";

function DiagnosticSummary({
  diagnostics,
  names,
}: {
  diagnostics: CoxDiagnostics | undefined;
  names: string[] | undefined;
}) {
  if (!diagnostics)
    return (
      <p className="text-xs text-amber-200">
        No retained clustered/PH diagnostic exists for this historical fit.
      </p>
    );
  if (diagnostics.status === "refused")
    return (
      <p className="text-xs text-amber-200">
        Diagnostic refused: {diagnostics.reason}
      </p>
    );
  return (
    <div className="space-y-2 rounded-lg border border-white/10 p-3">
      <h5 className="font-medium text-white">
        Canonical-asset clustered uncertainty · {diagnostics.clusterCount}{" "}
        assets
      </h5>
      <p className="text-xs text-slate-400">
        {diagnostics.diagnosticVersion} · Efron infinitesimal jackknife
      </p>
      {diagnostics.clusteredStandardErrors.map((value, i) => (
        <p key={i}>
          {names?.[i] ?? `Predictor ${i + 1}`}: clustered standard error{" "}
          {value.toPrecision(6)}
        </p>
      ))}
      <h5 className="font-medium text-white">
        Formal PH score tests · identity time transform
      </h5>
      {diagnostics.phIdentity.status === "refused" ? (
        <p className="text-amber-200">{diagnostics.phIdentity.reason}</p>
      ) : (
        <>
          {diagnostics.phIdentity.covariates.map((test, i) => (
            <p key={i}>
              {names?.[i] ?? `Predictor ${i + 1}`}: χ²{" "}
              {test.statistic.toPrecision(6)} · df {test.degreesOfFreedom} · p{" "}
              {test.pValue.toPrecision(6)}
            </p>
          ))}
          <p>
            Global: χ² {diagnostics.phIdentity.global.statistic.toPrecision(6)}{" "}
            · df {diagnostics.phIdentity.global.degreesOfFreedom} · p{" "}
            {diagnostics.phIdentity.global.pValue.toPrecision(6)}
          </p>
        </>
      )}
      <p className="text-xs text-amber-200">
        A non-significant test is not proof of proportional hazards. Cluster
        adequacy, measurement applicability and predictive calibration still
        require review; no automatic acceptance threshold or operational
        authority.
      </p>
    </div>
  );
}

const inputClass =
  "mt-1 w-full rounded-lg border border-white/15 bg-[#0b1620] p-2 text-sm text-white focus:border-cyan-400";
const buttonClass =
  "rounded-lg border border-cyan-400/25 bg-cyan-400/10 px-3 py-2 text-sm text-cyan-200 disabled:opacity-40";
function Field({
  label,
  value,
  onChange,
  numeric = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  numeric?: boolean;
}) {
  return (
    <label className="block text-xs text-slate-400">
      {label}
      <input
        className={inputClass}
        required
        value={value}
        onChange={(event) => onChange(event.target.value)}
        type={numeric ? "number" : "text"}
        step={numeric ? "any" : undefined}
      />
    </label>
  );
}

interface DraftMeasurement {
  value: string;
  evidenceItemId: string;
  observedAtHours: string;
  availableAtHours: string;
  validThroughHours: string;
  observedAt: string;
  availableAt: string;
}
interface DraftInterval {
  startHours: string;
  stopHours: string;
  startedAt: string;
  endedAt: string;
  values: DraftMeasurement[];
}
const blankMeasurement = (): DraftMeasurement => ({
  value: "",
  evidenceItemId: "",
  observedAtHours: "",
  availableAtHours: "",
  validThroughHours: "",
  observedAt: "",
  availableAt: "",
});
const blankInterval = (count: number): DraftInterval => ({
  startHours: "",
  stopHours: "",
  startedAt: "",
  endedAt: "",
  values: Array.from({ length: count }, blankMeasurement),
});
function statedNumber(value: string): number {
  if (!value.trim() || !Number.isFinite(Number(value)))
    throw new Error(
      "Every operating-hour boundary and measurement needs an explicit finite value.",
    );
  return Number(value);
}

/** Scope-keyed by the parent so receipts and edits never bleed across cohorts. */
export function CovariateSurvivalWorkbench({
  component,
}: {
  component: string;
}) {
  const { data, loading, error, refetch } = useAsyncData(
    () => loadSurvivalWorkspace(component),
    [component],
  );
  const [covariates, setCovariates] = useState<SurvivalCovariate[]>([
    { name: "", unit: "" },
  ]);
  const [eventId, setEventId] = useState("");
  const [mode, setMode] = useState<"include" | "exclude">("include");
  const [lifeRef, setLifeRef] = useState("");
  const [stratum, setStratum] = useState("");
  const [entryHours, setEntryHours] = useState("");
  const [serviceStartedAt, setServiceStartedAt] = useState("");
  const [terminalObservedAt, setTerminalObservedAt] = useState("");
  const [basis, setBasis] = useState("");
  const [exclusionEvidence, setExclusionEvidence] = useState("");
  const [intervals, setIntervals] = useState<DraftInterval[]>([
    blankInterval(1),
  ]);
  const [reviewBasis, setReviewBasis] = useState("");
  const [receipt, setReceipt] = useState<SurvivalReceipt | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const event = data?.events.find((row) => String(row.id) === eventId);
  const evidence =
    data?.evidence.filter((row) => row.asset_id === event?.assetId) ?? [];
  const prepared = useMemo(
    () => prepareSurvivalSource(data?.events ?? [], covariates),
    [data?.events, covariates],
  );

  async function perform(action: () => Promise<void>) {
    setBusy(true);
    setNotice(null);
    try {
      await action();
      refetch();
    } catch (failure) {
      setNotice(
        failure instanceof Error
          ? failure.message
          : "Governed survival action failed.",
      );
    } finally {
      setBusy(false);
    }
  }
  function updateInterval(index: number, changes: Partial<DraftInterval>) {
    setIntervals((rows) =>
      rows.map((row, position) =>
        position === index ? { ...row, ...changes } : row,
      ),
    );
  }
  function selectEvent(id: string) {
    setEventId(id);
    setReviewBasis("");
    setReceipt(null);
    setMode("include");
    setLifeRef("");
    setStratum("");
    setEntryHours("");
    setServiceStartedAt("");
    setTerminalObservedAt("");
    setBasis("");
    setExclusionEvidence("");
    setIntervals([blankInterval(covariates.length)]);
  }
  function updateMeasurement(
    index: number,
    predictor: number,
    changes: Partial<DraftMeasurement>,
  ) {
    setIntervals((rows) =>
      rows.map((row, position) =>
        position !== index
          ? row
          : {
              ...row,
              values: row.values.map((value, column) =>
                column === predictor ? { ...value, ...changes } : value,
              ),
            },
      ),
    );
  }
  function resizePredictors(next: SurvivalCovariate[]) {
    setCovariates(next);
    setReceipt(null);
    setIntervals((rows) =>
      rows.map((row) => ({
        ...row,
        values: next.map((_, index) => row.values[index] ?? blankMeasurement()),
      })),
    );
  }
  function loadRecordedOverlay(row: SurvivalSourceEvent) {
    const overlay = row.overlay;
    if (!overlay) return;
    setMode(overlay.mode);
    setBasis(overlay.basis);
    setLifeRef(overlay.lifeRef ?? "");
    setStratum(overlay.stratum ?? "");
    setEntryHours(overlay.entryHours == null ? "" : String(overlay.entryHours));
    setServiceStartedAt(overlay.serviceStartedAt ?? "");
    setTerminalObservedAt(overlay.terminalObservedAt ?? "");
    setExclusionEvidence(overlay.evidenceItemId ?? "");
    const predictors = overlay.intervals?.[0]?.values.map(({ name, unit }) => ({
      name,
      unit,
    }));
    if (predictors?.length) {
      setCovariates(predictors);
      setIntervals(
        overlay.intervals!.map((interval) => ({
          startHours: String(interval.startHours),
          stopHours: String(interval.stopHours),
          startedAt: interval.startedAt,
          endedAt: interval.endedAt,
          values: predictors.map((predictor) => {
            const value = interval.values.find(
              (entry) => entry.name === predictor.name,
            );
            return value
              ? {
                  ...value,
                  value: String(value.value),
                  observedAtHours: String(value.observedAtHours),
                  availableAtHours: String(value.availableAtHours),
                  validThroughHours: String(value.validThroughHours),
                }
              : blankMeasurement();
          }),
        })),
      );
    }
    setReceipt(null);
  }
  function buildOverlay(): SurvivalOverlay {
    if (basis.trim().length < 20)
      throw new Error(
        "State a supporting evidence basis of at least 20 characters.",
      );
    if (mode === "exclude")
      return { mode, basis, evidenceItemId: exclusionEvidence };
    return {
      mode,
      basis,
      lifeRef,
      stratum,
      serviceStartedAt,
      terminalObservedAt,
      entryHours: statedNumber(entryHours),
      intervals: intervals.map((interval) => ({
        startHours: statedNumber(interval.startHours),
        stopHours: statedNumber(interval.stopHours),
        startedAt: interval.startedAt,
        endedAt: interval.endedAt,
        values: interval.values.map((measurement, index) => ({
          ...measurement,
          ...covariates[index],
          value: statedNumber(measurement.value),
          observedAtHours: statedNumber(measurement.observedAtHours),
          availableAtHours: statedNumber(measurement.availableAtHours),
          validThroughHours: statedNumber(measurement.validThroughHours),
        })),
      })),
    };
  }

  if (loading && !data)
    return (
      <LoadingState label="Loading governed covariate survival evidence" />
    );
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  return (
    <div
      className="space-y-5 border-t border-white/10 p-5 lg:p-6"
      data-testid="covariate-survival-workbench"
    >
      <div>
        <h3 className="text-lg font-semibold text-white">
          Covariate survival · governed draft
        </h3>
        <p className="mt-2 text-sm leading-6 text-amber-200">
          Numerical association only. Model suitability, independent-asset
          adequacy and predictive calibration remain unproven. Numerical
          diagnostics are not model acceptance. No PM change, work execution,
          risk acceptance or return-to-service authority.
        </p>
        <p className="mt-2 text-xs text-slate-400">
          Actual component lives and complete exposure intervals are required.
          Scheduled working removals remain censored; uncertain removals require
          an evidenced independent exclusion. Capture and review require
          MFA/AAL2 and different named humans.
        </p>
      </div>

      <fieldset disabled={busy || loading} className="space-y-3">
        <legend className="text-sm font-semibold text-white">
          Predictors and declared units
        </legend>
        {covariates.map((predictor, index) => (
          <div key={index} className="grid gap-3 sm:grid-cols-2">
            <Field
              label={`Predictor ${index + 1} name`}
              value={predictor.name}
              onChange={(name) =>
                resizePredictors(
                  covariates.map((entry, column) =>
                    column === index ? { ...entry, name } : entry,
                  ),
                )
              }
            />
            <Field
              label={`Predictor ${index + 1} unit`}
              value={predictor.unit}
              onChange={(unit) =>
                resizePredictors(
                  covariates.map((entry, column) =>
                    column === index ? { ...entry, unit } : entry,
                  ),
                )
              }
            />
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <button
            className={buttonClass}
            disabled={covariates.length >= 8}
            onClick={() =>
              resizePredictors([...covariates, { name: "", unit: "" }])
            }
          >
            Add predictor
          </button>
          <button
            className={buttonClass}
            disabled={covariates.length === 1}
            onClick={() => resizePredictors(covariates.slice(0, -1))}
          >
            Remove last predictor
          </button>
          <button
            className={buttonClass}
            disabled={covariates.some(
              (entry) => !entry.name.trim() || !entry.unit.trim(),
            )}
            onClick={() =>
              perform(async () => {
                const next = await runSurvivalAnalysis(component, covariates);
                setReceipt(next);
                setNotice(
                  `Retained ${next.result.status}: calculation ${next.calculationRunId}; agent run ${next.agentRunId}.`,
                );
              })
            }
          >
            Run retained survival analysis
          </button>
        </div>
      </fieldset>

      <div className="rounded-xl border border-white/10 p-4">
        <h4 className="font-medium text-white">Whole-population readiness</h4>
        <p className="mt-1 text-xs text-slate-400">
          {data?.events.length ?? 0} canonical events · {prepared.rows.length}{" "}
          fit-ready intervals · {prepared.excludedEventIds.length} reviewed
          exclusions. Any gap refuses the whole model; no rows are silently
          dropped.
        </p>
        {prepared.gaps.length > 0 && (
          <ul className="mt-3 list-inside list-disc space-y-1 text-xs text-amber-200">
            {prepared.gaps.map((gap, index) => (
              <li key={index}>{gap}</li>
            ))}
          </ul>
        )}
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead>
              <tr>
                <th className="p-2">Event / asset</th>
                <th className="p-2">Outcome / exposure</th>
                <th className="p-2">Exact overlay</th>
                <th className="p-2">Source / approval</th>
              </tr>
            </thead>
            <tbody>
              {data?.events.map((row) => (
                <tr key={row.id} className="border-t border-white/8">
                  <td className="p-2">
                    #{row.id}
                    <br />
                    {row.assetId ?? "No exact asset"}
                  </td>
                  <td className="p-2">
                    {row.eventKind} · {row.hoursAtChangeOut} h
                  </td>
                  <td className="p-2">
                    v{row.overlayVersion} · {row.overlayStatus}
                  </td>
                  <td className="p-2">
                    {row.sourceCurrent ? "Current source" : "Source gap"} /{" "}
                    {row.approvalCurrent ? "Exact approval" : "Approval gap"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <form
        className="space-y-4 rounded-xl border border-white/10 p-4"
        onSubmit={(submit) => {
          submit.preventDefault();
          if (!event) return;
          perform(async () => {
            await captureSurvivalOverlay(event, buildOverlay());
            setReceipt(null);
            setNotice(
              "Exact overlay captured for independent review. This is not an approved model input yet.",
            );
          });
        }}
      >
        <fieldset disabled={busy || loading} className="space-y-4">
          <legend className="font-medium text-white">
            Capture or revise canonical life evidence
          </legend>
          <label className="block text-xs text-slate-400">
            Canonical life event
            <select
              required
              className={inputClass}
              value={eventId}
              onChange={(change) => selectEvent(change.target.value)}
            >
              <option value="">Select actual recorded life event</option>
              {data?.events.map((row) => (
                <option key={row.id} value={row.id}>
                  #{row.id} · {row.eventKind} · {row.hoursAtChangeOut} h · v
                  {row.overlayVersion}
                </option>
              ))}
            </select>
          </label>
          {event?.overlay && (
            <button
              type="button"
              className={buttonClass}
              onClick={() => loadRecordedOverlay(event)}
            >
              Load recorded overlay for revision
            </button>
          )}
          <label className="block text-xs text-slate-400">
            Population treatment
            <select
              className={inputClass}
              value={mode}
              onChange={(change) =>
                setMode(change.target.value as "include" | "exclude")
              }
            >
              <option value="include">
                Include with actual exposure and covariates
              </option>
              <option value="exclude">Explicit evidenced exclusion</option>
            </select>
          </label>
          {mode === "exclude" ? (
            <label className="block text-xs text-slate-400">
              Exclusion evidence
              <select
                required
                className={inputClass}
                value={exclusionEvidence}
                onChange={(change) => setExclusionEvidence(change.target.value)}
              >
                <option value="">Select exact-asset verified evidence</option>
                {evidence.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.description ?? row.id}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Field
                  label="Physical component life reference"
                  value={lifeRef}
                  onChange={setLifeRef}
                />
                <Field
                  label="Approved design / operating stratum"
                  value={stratum}
                  onChange={setStratum}
                />
                <Field
                  label="Observed entry operating hours"
                  value={entryHours}
                  onChange={setEntryHours}
                  numeric
                />
                <Field
                  label="Actual service start (ISO with timezone)"
                  value={serviceStartedAt}
                  onChange={setServiceStartedAt}
                />
                <Field
                  label="Actual terminal observation (ISO with timezone)"
                  value={terminalObservedAt}
                  onChange={setTerminalObservedAt}
                />
              </div>
              {intervals.map((interval, index) => (
                <fieldset
                  key={index}
                  className="space-y-3 rounded-lg border border-white/10 p-3"
                >
                  <legend className="px-2 text-sm text-cyan-200">
                    Exposure interval {index + 1}
                  </legend>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field
                      label={`Interval ${index + 1} start hours`}
                      value={interval.startHours}
                      onChange={(startHours) =>
                        updateInterval(index, { startHours })
                      }
                      numeric
                    />
                    <Field
                      label={`Interval ${index + 1} stop hours`}
                      value={interval.stopHours}
                      onChange={(stopHours) =>
                        updateInterval(index, { stopHours })
                      }
                      numeric
                    />
                    <Field
                      label={`Interval ${index + 1} actual start (ISO)`}
                      value={interval.startedAt}
                      onChange={(startedAt) =>
                        updateInterval(index, { startedAt })
                      }
                    />
                    <Field
                      label={`Interval ${index + 1} actual end (ISO)`}
                      value={interval.endedAt}
                      onChange={(endedAt) => updateInterval(index, { endedAt })}
                    />
                  </div>
                  {interval.values.map((measurement, predictor) => (
                    <div
                      key={predictor}
                      className="space-y-3 border-t border-white/10 pt-3"
                    >
                      <p className="text-xs text-slate-300">
                        {covariates[predictor].name ||
                          `Predictor ${predictor + 1}`}{" "}
                        · {covariates[predictor].unit || "Unit required"}
                      </p>
                      <label className="block text-xs text-slate-400">
                        Interval {index + 1} predictor {predictor + 1} evidence
                        <select
                          required
                          className={inputClass}
                          value={measurement.evidenceItemId}
                          onChange={(change) => {
                            const selected = evidence.find(
                              (row) => row.id === change.target.value,
                            );
                            updateMeasurement(index, predictor, {
                              evidenceItemId: change.target.value,
                              observedAt: selected?.ts ?? "",
                            });
                          }}
                        >
                          <option value="">
                            Select exact-asset verified observation
                          </option>
                          {evidence.map((row) => (
                            <option key={row.id} value={row.id}>
                              {row.ts} · {row.description ?? row.id}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        <Field
                          label={`Interval ${index + 1} predictor ${predictor + 1} value`}
                          value={measurement.value}
                          onChange={(value) =>
                            updateMeasurement(index, predictor, { value })
                          }
                          numeric
                        />
                        <Field
                          label={`Interval ${index + 1} predictor ${predictor + 1} observed hours`}
                          value={measurement.observedAtHours}
                          onChange={(observedAtHours) =>
                            updateMeasurement(index, predictor, {
                              observedAtHours,
                            })
                          }
                          numeric
                        />
                        <Field
                          label={`Interval ${index + 1} predictor ${predictor + 1} available hours`}
                          value={measurement.availableAtHours}
                          onChange={(availableAtHours) =>
                            updateMeasurement(index, predictor, {
                              availableAtHours,
                            })
                          }
                          numeric
                        />
                        <Field
                          label={`Interval ${index + 1} predictor ${predictor + 1} valid through hours`}
                          value={measurement.validThroughHours}
                          onChange={(validThroughHours) =>
                            updateMeasurement(index, predictor, {
                              validThroughHours,
                            })
                          }
                          numeric
                        />
                        <Field
                          label={`Interval ${index + 1} predictor ${predictor + 1} observed at (ISO)`}
                          value={measurement.observedAt}
                          onChange={(observedAt) =>
                            updateMeasurement(index, predictor, { observedAt })
                          }
                        />
                        <Field
                          label={`Interval ${index + 1} predictor ${predictor + 1} available at (ISO)`}
                          value={measurement.availableAt}
                          onChange={(availableAt) =>
                            updateMeasurement(index, predictor, { availableAt })
                          }
                        />
                      </div>
                    </div>
                  ))}
                </fieldset>
              ))}
              <div className="flex gap-2">
                <button
                  type="button"
                  className={buttonClass}
                  disabled={intervals.length >= 50}
                  onClick={() =>
                    setIntervals([
                      ...intervals,
                      blankInterval(covariates.length),
                    ])
                  }
                >
                  Add exposure interval
                </button>
                <button
                  type="button"
                  className={buttonClass}
                  disabled={intervals.length === 1}
                  onClick={() => setIntervals(intervals.slice(0, -1))}
                >
                  Remove last interval
                </button>
              </div>
            </>
          )}
          <label className="block text-xs text-slate-400">
            Capture evidence basis
            <textarea
              required
              minLength={20}
              maxLength={4000}
              className={inputClass}
              value={basis}
              onChange={(change) => setBasis(change.target.value)}
            />
          </label>
          <button type="submit" disabled={!event} className={buttonClass}>
            Submit exact overlay for review
          </button>
        </fieldset>
      </form>

      {event?.overlay && (
        <div className="space-y-3 rounded-xl border border-white/10 p-4">
          <h4 className="font-medium text-white">
            Independent review · event #{event.id} v{event.overlayVersion}
          </h4>
          <p className="text-xs text-slate-400">
            Author: {event.overlayAuthor}. Review covers the persisted snapshot
            below, not unsaved form edits. The server refuses self-review, stale
            versions and changed source evidence.
          </p>
          <details>
            <summary className="cursor-pointer text-sm text-cyan-200">
              Inspect exact recorded overlay and current source
            </summary>
            <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-all text-xs text-slate-300">
              {JSON.stringify(
                {
                  overlay: event.overlay,
                  currentSource: event.sourceEvidence,
                  approvalId: event.approvalId,
                },
                null,
                2,
              )}
            </pre>
          </details>
          <label className="block text-xs text-slate-400">
            Independent review basis
            <textarea
              minLength={20}
              maxLength={4000}
              className={inputClass}
              value={reviewBasis}
              onChange={(change) => setReviewBasis(change.target.value)}
            />
          </label>
          <div className="flex gap-2">
            {(["validated", "rejected"] as const).map((decision) => (
              <button
                key={decision}
                className={buttonClass}
                disabled={
                  busy ||
                  loading ||
                  event.overlayStatus !== "pending_review" ||
                  reviewBasis.trim().length < 20
                }
                onClick={() =>
                  perform(async () => {
                    await reviewSurvivalOverlay(event, decision, reviewBasis);
                    setReceipt(null);
                    setNotice(`Exact overlay review recorded: ${decision}.`);
                  })
                }
              >
                {decision === "validated"
                  ? "Validate exact overlay"
                  : "Reject exact overlay"}
              </button>
            ))}
          </div>
        </div>
      )}

      {notice && (
        <p
          role="status"
          className="break-words rounded-lg border border-cyan-300/20 p-3 text-sm text-cyan-100"
        >
          {notice}
        </p>
      )}
      {receipt && (
        <div className="rounded-xl border border-white/10 p-4">
          <h4 className="font-medium text-white">
            Retained advisory {receipt.result.status}
          </h4>
          <p className="mt-1 break-all text-xs text-slate-400">
            Calculation {receipt.calculationRunId} · Agent run{" "}
            {receipt.agentRunId}
          </p>
          {receipt.result.status === "fitted" ? (
            <div className="mt-3 space-y-2 text-sm text-slate-300">
              <p>
                {receipt.result.subjects} physical lives ·{" "}
                {receipt.result.failures} failures ·{" "}
                {receipt.result.kernelVersion}
              </p>
              {receipt.result.coefficients.map((coefficient, index) => (
                <p key={index}>
                  {receipt.result.status === "fitted"
                    ? (receipt.result.covariateNames?.[index] ??
                      `Predictor ${index + 1}`)
                    : ""}
                  : log-hazard coefficient {coefficient.toPrecision(6)} ·
                  model-based standard error{" "}
                  {receipt.result.status === "fitted"
                    ? receipt.result.standardErrors[index].toPrecision(6)
                    : ""}
                </p>
              ))}
              <p className="text-xs text-amber-200">
                These standard errors assume independent lives. They are not
                cluster-robust or calibrated predictive uncertainty.
              </p>
              <DiagnosticSummary
                diagnostics={receipt.result.diagnostics}
                names={receipt.result.covariateNames}
              />
            </div>
          ) : (
            <p className="mt-2 text-sm text-amber-200">
              {receipt.result.reason}
            </p>
          )}
          <ul className="mt-3 list-inside list-disc text-xs text-amber-200">
            {receipt.refusals.map((reason, index) => (
              <li key={index}>{reason}</li>
            ))}
          </ul>
        </div>
      )}
      <div>
        <h4 className="font-medium text-white">
          Immutable calculation history · most recent 20
        </h4>
        {!data?.calculations.length && (
          <p className="mt-2 text-sm text-slate-400">
            No retained survival calculations for this component.
          </p>
        )}
        {data?.calculations.map((calculation) => (
          <details
            key={calculation.id}
            className="mt-2 rounded-lg border border-white/10 p-3 text-xs text-slate-300"
          >
            <summary className="cursor-pointer break-words">
              {calculation.computed_at} · {calculation.status} ·{" "}
              {calculation.id}
            </summary>
            <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-all">
              {JSON.stringify(calculation, null, 2)}
            </pre>
          </details>
        ))}
      </div>
    </div>
  );
}
