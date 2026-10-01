import { useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Database,
  Gauge,
  LockKeyhole,
} from "lucide-react";
import { useAuth } from "./AuthProvider";
import { ErrorState, LoadingState } from "./ui/AsyncStates";
import { useAsyncData } from "../hooks/useAsyncData";
import { parseMonitoringDistribution } from "../lib/model-monitoring";
import { populationStabilityIndex } from "../lib/model-risk";
import { recordEngineeringModelFieldOutcome } from "../services/engineeringModelService";
import {
  captureModelInputSnapshot,
  getModelMonitoringWorkspace,
  reviewModelPerformanceAssessment,
  runModelPerformanceAssessment,
} from "../services/modelMonitoringService";

type ReviewDecision =
  | "accepted_no_change"
  | "require_revalidation"
  | "retire";

function words(value: string): string {
  return value.replaceAll("_", " ");
}

export function ModelPerformanceMonitoringPanel() {
  const { profile } = useAuth();
  const role = String(profile?.role ?? "");
  const canCapture = [
    "admin",
    "executive",
    "maintenance_manager",
    "reliability_engineer",
  ].includes(role);
  const canReview = ["admin", "executive", "reliability_engineer"].includes(
    role,
  );
  const workspace = useAsyncData(getModelMonitoringWorkspace, [], {
    isEmpty: () => false,
  });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const [outcomeRunId, setOutcomeRunId] = useState("");
  const [outcome, setOutcome] = useState<"true" | "false">("false");
  const [observedBasis, setObservedBasis] = useState("");
  const [predictionAssessment, setPredictionAssessment] = useState("");
  const [designFeedback, setDesignFeedback] = useState("");

  const [snapshotModelId, setSnapshotModelId] = useState("");
  const [snapshotFeature, setSnapshotFeature] = useState("operating_regime");
  const [snapshotLabel, setSnapshotLabel] = useState("");
  const [windowStart, setWindowStart] = useState("");
  const [windowEnd, setWindowEnd] = useState("");
  const [distributionText, setDistributionText] = useState(
    "normal=0\nintermittent=0",
  );
  const [isReference, setIsReference] = useState(false);
  const [snapshotEvidenceId, setSnapshotEvidenceId] = useState("");

  const [assessmentModelId, setAssessmentModelId] = useState("");
  const [referenceSnapshotId, setReferenceSnapshotId] = useState("");
  const [currentSnapshotId, setCurrentSnapshotId] = useState("");
  const [assessmentBasis, setAssessmentBasis] = useState("");

  const [reviewAssessmentId, setReviewAssessmentId] = useState("");
  const [reviewDecision, setReviewDecision] =
    useState<ReviewDecision>("accepted_no_change");
  const [reviewEvidenceId, setReviewEvidenceId] = useState("");
  const [reviewNote, setReviewNote] = useState("");

  const data = workspace.data;
  const modelId = Number(assessmentModelId);
  const modelSnapshots = (data?.snapshots ?? []).filter(
    (snapshot) => snapshot.modelRegisterId === modelId,
  );
  const references = modelSnapshots.filter((snapshot) => snapshot.reference);
  const currents = modelSnapshots.filter((snapshot) => !snapshot.reference);
  const reference = references.find(
    (snapshot) => String(snapshot.id) === referenceSnapshotId,
  );
  const current = currents.find(
    (snapshot) => String(snapshot.id) === currentSnapshotId,
  );
  const preview =
    reference && current && reference.feature === current.feature
      ? populationStabilityIndex(
          reference.distribution,
          current.distribution,
        )
      : null;

  const run = async (operation: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setNotice(null);
    setMutationError(null);
    try {
      await operation();
      setNotice(success);
      await workspace.refetch();
    } catch (error) {
      setMutationError(
        error instanceof Error ? error.message : "The governed operation failed.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (workspace.loading)
    return <LoadingState label="Loading model monitoring evidence…" />;
  if (workspace.error)
    return <ErrorState message={workspace.error} onRetry={workspace.refetch} />;
  if (!data)
    return (
      <ErrorState
        message="Model monitoring workspace returned no data."
        onRetry={workspace.refetch}
      />
    );

  const selectedAssessment = data.assessments.find(
    (assessment) => assessment.id === reviewAssessmentId,
  );

  return (
    <section aria-labelledby="model-monitoring-heading" className="space-y-5">
      <div className="rounded-2xl border border-cyan-400/15 bg-[#0D1520] p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2
              id="model-monitoring-heading"
              className="flex items-center gap-2 text-lg font-semibold text-white"
            >
              <Gauge className="h-5 w-5 text-cyan-300" /> Model performance &
              drift
            </h2>
            <p className="mt-1 max-w-4xl text-sm text-slate-400">
              Close the outcome loop, compare retained input populations and
              screen operational cohorts for material performance gaps against
              the exact approved model version.
            </p>
          </div>
          <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1 text-xs font-semibold text-amber-200">
            detection only · human disposition
          </span>
        </div>
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-white/6 bg-black/20 p-3 text-xs leading-relaxed text-slate-400">
          <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" />
          <p>{data.boundary}</p>
        </div>
      </div>

      {notice ? (
        <div role="status" className="flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-300">
          <CheckCircle2 className="h-4 w-4" /> {notice}
        </div>
      ) : null}
      {mutationError ? (
        <div role="alert" className="flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">
          <AlertTriangle className="h-4 w-4" /> {mutationError}
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-3">
        <section className="rounded-2xl border border-white/8 bg-[#0D1520] p-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
            <Activity className="h-4 w-4 text-cyan-300" /> 1. Record field
            outcome
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            A prediction is not evidence of performance until a named human
            records what actually happened and why that observation is valid.
          </p>
          {canCapture ? (
            <div className="mt-4 space-y-2">
              <select
                aria-label="Calculation awaiting field outcome"
                value={outcomeRunId}
                onChange={(event) => setOutcomeRunId(event.target.value)}
                className="w-full rounded-lg border border-white/8 bg-[#111b28] p-2 text-xs text-white"
              >
                <option value="">Select a computed model run…</option>
                {data.openOutcomes.map((candidate) => (
                  <option key={candidate.calculationRunId} value={candidate.calculationRunId}>
                    {candidate.modelKey} v{candidate.modelVersion} · {candidate.computedAt}
                  </option>
                ))}
              </select>
              <select
                aria-label="Observed outcome"
                value={outcome}
                onChange={(event) => setOutcome(event.target.value as "true" | "false")}
                className="w-full rounded-lg border border-white/8 bg-[#111b28] p-2 text-xs text-white"
              >
                <option value="false">Predicted event did not occur</option>
                <option value="true">Predicted event occurred</option>
              </select>
              {[
                ["Observed evidence basis", observedBasis, setObservedBasis],
                ["Prediction assessment", predictionAssessment, setPredictionAssessment],
                ["Design / strategy feedback", designFeedback, setDesignFeedback],
              ].map(([label, value, setter]) => (
                <textarea
                  key={String(label)}
                  aria-label={String(label)}
                  value={String(value)}
                  onChange={(event) =>
                    (setter as (next: string) => void)(event.target.value)
                  }
                  placeholder={`${label} (what was checked, not a conclusion without evidence)`}
                  className="min-h-16 w-full rounded-lg border border-white/8 bg-black/20 p-2 text-xs text-white placeholder:text-slate-600"
                />
              ))}
              <button
                disabled={
                  busy ||
                  !outcomeRunId ||
                  observedBasis.trim().length < 3 ||
                  predictionAssessment.trim().length < 3 ||
                  designFeedback.trim().length < 3
                }
                onClick={() =>
                  run(
                    () =>
                      recordEngineeringModelFieldOutcome({
                        calculationRunId: outcomeRunId,
                        outcome: outcome === "true",
                        counterfactualReview: {
                          observedBasis,
                          predictionAssessment,
                          designFeedback,
                        },
                      }),
                    "Field outcome and counterfactual review retained.",
                  )
                }
                className="w-full rounded-lg bg-cyan-500/15 px-3 py-2 text-xs font-semibold text-cyan-300 disabled:opacity-40"
              >
                Record governed outcome
              </button>
            </div>
          ) : (
            <p className="mt-4 text-xs text-slate-500">Read-only for this role.</p>
          )}
        </section>

        <section className="rounded-2xl border border-white/8 bg-[#0D1520] p-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
            <Database className="h-4 w-4 text-cyan-300" /> 2. Capture input
            population
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            Snapshots are immutable, evidence-backed and scoped to one exact
            model version. Enter one bucket and count per line.
          </p>
          {canCapture ? (
            <div className="mt-4 space-y-2">
              <select
                aria-label="Snapshot model version"
                value={snapshotModelId}
                onChange={(event) => setSnapshotModelId(event.target.value)}
                className="w-full rounded-lg border border-white/8 bg-[#111b28] p-2 text-xs text-white"
              >
                <option value="">Select model version…</option>
                {data.models
                  .filter((model) => model.lifecycleState !== "retired")
                  .map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name} · v{model.version} · {words(model.lifecycleState)}
                  </option>
                  ))}
              </select>
              <div className="grid grid-cols-2 gap-2">
                <input aria-label="Monitoring feature" value={snapshotFeature} onChange={(event) => setSnapshotFeature(event.target.value)} placeholder="operating_regime" className="rounded-lg border border-white/8 bg-black/20 p-2 text-xs text-white" />
                <input aria-label="Snapshot label" value={snapshotLabel} onChange={(event) => setSnapshotLabel(event.target.value)} placeholder="2026 Q3 baseline" className="rounded-lg border border-white/8 bg-black/20 p-2 text-xs text-white" />
                <input aria-label="Snapshot window start" type="date" value={windowStart} onChange={(event) => setWindowStart(event.target.value)} className="rounded-lg border border-white/8 bg-black/20 p-2 text-xs text-white" />
                <input aria-label="Snapshot window end" type="date" value={windowEnd} onChange={(event) => setWindowEnd(event.target.value)} className="rounded-lg border border-white/8 bg-black/20 p-2 text-xs text-white" />
              </div>
              <textarea aria-label="Distribution buckets" value={distributionText} onChange={(event) => setDistributionText(event.target.value)} className="min-h-24 w-full rounded-lg border border-white/8 bg-black/20 p-2 font-mono text-xs text-white" />
              <select aria-label="Snapshot evidence" value={snapshotEvidenceId} onChange={(event) => setSnapshotEvidenceId(event.target.value)} className="w-full rounded-lg border border-white/8 bg-[#111b28] p-2 text-xs text-white">
                <option value="">Select verified source evidence…</option>
                {data.evidence.map((item) => (
                  <option key={item.id} value={item.id}>{item.description}</option>
                ))}
              </select>
              <label className="flex items-center gap-2 text-xs text-slate-400">
                <input type="checkbox" checked={isReference} onChange={(event) => setIsReference(event.target.checked)} />
                Approved reference population
              </label>
              <button
                disabled={busy || !snapshotModelId || !snapshotFeature || !snapshotLabel || !windowStart || !windowEnd || !snapshotEvidenceId}
                onClick={() =>
                  run(
                    () => captureModelInputSnapshot({
                      modelRegisterId: Number(snapshotModelId),
                      feature: snapshotFeature,
                      label: snapshotLabel,
                      windowStart,
                      windowEnd,
                      distribution: parseMonitoringDistribution(distributionText),
                      reference: isReference,
                      evidenceItemId: snapshotEvidenceId,
                    }),
                    "Immutable model-input snapshot captured.",
                  )
                }
                className="w-full rounded-lg bg-cyan-500/15 px-3 py-2 text-xs font-semibold text-cyan-300 disabled:opacity-40"
              >
                Capture evidence-backed snapshot
              </button>
            </div>
          ) : (
            <p className="mt-4 text-xs text-slate-500">Read-only for this role.</p>
          )}
        </section>

        <section className="rounded-2xl border border-white/8 bg-[#0D1520] p-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
            <Gauge className="h-4 w-4 text-cyan-300" /> 3. Run exact-version
            assessment
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            The server records authoritative PSI, calibration and cohort-gap
            screening. This preview independently recomputes PSI from the two
            selected retained distributions.
          </p>
          {canCapture ? (
            <div className="mt-4 space-y-2">
              <select aria-label="Assessment model version" value={assessmentModelId} onChange={(event) => { setAssessmentModelId(event.target.value); setReferenceSnapshotId(""); setCurrentSnapshotId(""); }} className="w-full rounded-lg border border-white/8 bg-[#111b28] p-2 text-xs text-white">
                <option value="">Select model version…</option>
                {data.models
                  .filter((model) => model.lifecycleState !== "retired")
                  .map((model) => <option key={model.id} value={model.id}>{model.name} · v{model.version}</option>)}
              </select>
              <select aria-label="Reference snapshot" value={referenceSnapshotId} onChange={(event) => setReferenceSnapshotId(event.target.value)} className="w-full rounded-lg border border-white/8 bg-[#111b28] p-2 text-xs text-white">
                <option value="">Select retained reference…</option>
                {references.map((snapshot) => <option key={snapshot.id} value={snapshot.id}>{snapshot.label} · {snapshot.feature} · {snapshot.windowStart} → {snapshot.windowEnd}</option>)}
              </select>
              <select aria-label="Current snapshot" value={currentSnapshotId} onChange={(event) => setCurrentSnapshotId(event.target.value)} className="w-full rounded-lg border border-white/8 bg-[#111b28] p-2 text-xs text-white">
                <option value="">Select retained current population…</option>
                {currents.map((snapshot) => <option key={snapshot.id} value={snapshot.id}>{snapshot.label} · {snapshot.feature} · {snapshot.windowStart} → {snapshot.windowEnd}</option>)}
              </select>
              {preview ? (
                <div className="rounded-lg border border-white/6 bg-black/20 p-3 text-xs text-slate-300">
                  <div className="font-mono text-white">Preview PSI {preview.psi?.toFixed(4) ?? "not measurable"}</div>
                  <p className="mt-1 leading-relaxed text-slate-500">{preview.reason}</p>
                </div>
              ) : null}
              <textarea aria-label="Assessment basis" value={assessmentBasis} onChange={(event) => setAssessmentBasis(event.target.value)} placeholder="Why these periods, feature and evidence are comparable (20 characters minimum)" className="min-h-20 w-full rounded-lg border border-white/8 bg-black/20 p-2 text-xs text-white placeholder:text-slate-600" />
              <button
                disabled={busy || !assessmentModelId || !referenceSnapshotId || !currentSnapshotId || assessmentBasis.trim().length < 20 || !preview}
                onClick={() => run(() => runModelPerformanceAssessment({ modelRegisterId: Number(assessmentModelId), referenceSnapshotId: Number(referenceSnapshotId), currentSnapshotId: Number(currentSnapshotId), assessmentBasis }), "Model monitoring assessment retained for independent review.")}
                className="w-full rounded-lg bg-cyan-500/15 px-3 py-2 text-xs font-semibold text-cyan-300 disabled:opacity-40"
              >
                Assess drift, calibration & cohort gaps
              </button>
            </div>
          ) : (
            <p className="mt-4 text-xs text-slate-500">Read-only for this role.</p>
          )}
        </section>
      </div>

      <section className="rounded-2xl border border-white/8 bg-[#0D1520] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-white">Retained assessments & independent disposition</h3>
            <p className="mt-1 text-xs text-slate-500">A different named human must disposition each assessment. Accepting an alert does not erase it.</p>
          </div>
          <span className="text-xs text-slate-500">{data.assessments.length} retained assessment(s)</span>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {data.assessments.map((assessment) => {
            const model = data.models.find((item) => item.id === assessment.modelRegisterId);
            return (
              <article key={assessment.id} className={`rounded-xl border p-4 ${assessment.alertStatus === "review_required" ? "border-amber-500/25 bg-amber-500/5" : "border-white/6 bg-black/20"}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h4 className="text-sm font-semibold text-white">{model?.name ?? `Model ${assessment.modelRegisterId}`} · {assessment.feature}</h4>
                    <p className="mt-0.5 text-xs text-slate-500">{new Date(assessment.assessedAt).toLocaleString()} · {assessment.outcomeCount}/{assessment.predictionCount} outcomes</p>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-xs font-semibold ${assessment.alertStatus === "review_required" ? "bg-amber-500/15 text-amber-200" : assessment.alertStatus === "no_alert" ? "bg-emerald-500/15 text-emerald-300" : "bg-slate-500/15 text-slate-300"}`}>{words(assessment.alertStatus)}</span>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                  <div className="rounded-lg border border-white/6 p-2"><div className="font-mono text-white">{assessment.psi == null ? "—" : assessment.psi.toFixed(4)}</div><div className="text-slate-500">PSI · {words(assessment.driftStatus)}</div></div>
                  <div className="rounded-lg border border-white/6 p-2"><div className="font-mono text-white">{assessment.skillScore == null ? "—" : assessment.skillScore.toFixed(3)}</div><div className="text-slate-500">skill · {words(assessment.calibrationStatus)}</div></div>
                  <div className="rounded-lg border border-white/6 p-2"><div className="font-mono text-white">{assessment.cohortCount}</div><div className="text-slate-500">cohorts · {words(assessment.biasScreenStatus)}</div></div>
                </div>
                <p className="mt-3 text-xs leading-relaxed text-slate-400">{assessment.assessmentBasis}</p>
                {assessment.review ? (
                  <div className="mt-3 rounded-lg border border-emerald-500/15 bg-emerald-500/5 p-3 text-xs text-emerald-200">
                    {words(assessment.review.decision)} · {assessment.review.note}
                  </div>
                ) : canReview ? (
                  <button onClick={() => setReviewAssessmentId(assessment.id)} className="mt-3 rounded-lg border border-cyan-400/20 bg-cyan-400/10 px-3 py-2 text-xs font-semibold text-cyan-300">Independently disposition</button>
                ) : (
                  <p className="mt-3 text-xs text-amber-200">Awaiting an independent authorized reviewer.</p>
                )}
              </article>
            );
          })}
          {data.assessments.length === 0 ? (
            <p className="text-sm text-slate-500">No governed model monitoring assessment has been recorded yet.</p>
          ) : null}
        </div>

        {selectedAssessment && !selectedAssessment.review && canReview ? (
          <div className="mt-5 grid gap-2 border-t border-white/6 pt-4 md:grid-cols-[1fr_1fr_2fr_auto]">
            <select aria-label="Monitoring disposition" value={reviewDecision} onChange={(event) => setReviewDecision(event.target.value as ReviewDecision)} className="rounded-lg border border-white/8 bg-[#111b28] p-2 text-xs text-white">
              <option value="accepted_no_change">Accept evidence; no model change</option>
              <option value="require_revalidation">Require revalidation</option>
              <option value="retire">Retire exact model version</option>
            </select>
            <select aria-label="Disposition evidence" value={reviewEvidenceId} onChange={(event) => setReviewEvidenceId(event.target.value)} className="rounded-lg border border-white/8 bg-[#111b28] p-2 text-xs text-white">
              <option value="">Select verified review evidence…</option>
              {data.evidence.map((item) => <option key={item.id} value={item.id}>{item.description}</option>)}
            </select>
            <input aria-label="Independent disposition note" value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} placeholder="Independent evidence-based decision basis (20 characters minimum)" className="rounded-lg border border-white/8 bg-black/20 p-2 text-xs text-white placeholder:text-slate-600" />
            <button disabled={busy || !reviewEvidenceId || reviewNote.trim().length < 20} onClick={() => run(() => reviewModelPerformanceAssessment({ assessmentId: selectedAssessment.id, decision: reviewDecision, reviewNote, evidenceItemId: reviewEvidenceId }), "Independent model monitoring disposition retained." )} className="rounded-lg bg-emerald-500/15 px-3 py-2 text-xs font-semibold text-emerald-300 disabled:opacity-40">Record disposition</button>
          </div>
        ) : null}
      </section>
    </section>
  );
}
