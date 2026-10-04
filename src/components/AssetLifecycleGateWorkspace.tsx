import { FormEvent, useMemo, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  Recycle,
  ShieldAlert,
} from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import {
  advanceAssetLifecycleStage,
  getAssetLifecycleGateWorkspace,
  recordAssetDisposal,
  recordAssetLifecycleGateReview,
  type DisposalRoute,
  type FindingStatus,
} from "../services/assetLifecycleGateService";
import { ErrorState, LoadingState } from "./ui/AsyncStates";

interface FindingDraft {
  status: FindingStatus;
  evidenceItemId: string;
}

const ROUTES: Array<{ value: DisposalRoute; label: string }> = [
  { value: "resale", label: "Resale" },
  { value: "redeployment", label: "Redeployment" },
  { value: "scrap_recycle", label: "Scrap or recycle" },
  { value: "return_to_vendor", label: "Return to vendor" },
  { value: "hazardous_disposal", label: "Hazardous disposal" },
  { value: "abandonment_in_place", label: "Abandonment in place" },
];

function allowedTargets(stageKey: string | null) {
  if (["operation", "maintenance", "modification"].includes(stageKey ?? ""))
    return ["life_extension", "replacement", "decommissioning"];
  if (stageKey === "life_extension") return ["replacement", "decommissioning"];
  if (stageKey === "replacement") return ["decommissioning"];
  if (stageKey === "decommissioning") return ["disposal"];
  return [];
}

export function AssetLifecycleGateWorkspace() {
  const [assetId, setAssetId] = useState("");
  const [targetStageKey, setTargetStageKey] = useState("");
  const [outcome, setOutcome] = useState<"pass" | "hold">("hold");
  const [reviewNote, setReviewNote] = useState("");
  const [evaluationId, setEvaluationId] = useState("");
  const [findings, setFindings] = useState<Record<number, FindingDraft>>({});
  const [movementReason, setMovementReason] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<"review" | "move" | "disposal" | null>(null);

  const [disposalRoute, setDisposalRoute] =
    useState<DisposalRoute>("scrap_recycle");
  const [disposedAt, setDisposedAt] = useState("");
  const [recoveredValue, setRecoveredValue] = useState("");
  const [disposalCost, setDisposalCost] = useState("");
  const [currency, setCurrency] = useState("CAD");
  const [restorationRequired, setRestorationRequired] = useState(false);
  const [restorationComplete, setRestorationComplete] = useState(false);
  const [restorationObligation, setRestorationObligation] = useState("");
  const [hazardousRemoved, setHazardousRemoved] = useState(false);
  const [certificateReference, setCertificateReference] = useState("");
  const [disposalEvidenceId, setDisposalEvidenceId] = useState("");

  const { data, loading, error, refetch } = useAsyncData(
    () => getAssetLifecycleGateWorkspace(assetId || null),
    [assetId],
  );

  const selectedAsset = data?.assets.find((asset) => asset.id === assetId) ?? null;
  const targetKeys = allowedTargets(selectedAsset?.stageKey ?? null);
  const targetStages =
    data?.stages.filter((stage) => targetKeys.includes(stage.stageKey)) ?? [];
  const selectedTarget = data?.stages.find(
    (stage) => stage.stageKey === targetStageKey,
  );
  const needsEvaluation = ["life_extension", "replacement"].includes(
    targetStageKey,
  );
  const requiresAcceptedEvaluation = needsEvaluation && outcome === "pass";
  const eligibleEvaluations = useMemo(
    () =>
      (data?.evaluations ?? []).filter((evaluation) =>
        targetStageKey === "replacement"
          ? evaluation.recommended === "replace"
          : ["repair", "redesign", "defer"].includes(
              evaluation.recommended ?? "",
            ),
      ),
    [data?.evaluations, targetStageKey],
  );
  const latestMatchingPass = data?.reviews.find(
    (review) =>
      review.stageKey === selectedAsset?.stageKey &&
      review.targetStageKey === targetStageKey &&
      review.outcome === "pass" &&
      new Date(review.reviewedAt).getTime() >=
        new Date(selectedAsset?.enteredAt ?? 0).getTime(),
  );

  function changeAsset(nextAssetId: string) {
    setAssetId(nextAssetId);
    setTargetStageKey("");
    setEvaluationId("");
    setFindings({});
    setMessage("");
  }

  function changeTarget(nextTarget: string) {
    setTargetStageKey(nextTarget);
    setEvaluationId("");
    setMessage("");
  }

  function updateFinding(
    criterionId: number,
    patch: Partial<FindingDraft>,
  ) {
    setFindings((current) => ({
      ...current,
      [criterionId]: {
        status: current[criterionId]?.status ?? "not_assessed",
        evidenceItemId: current[criterionId]?.evidenceItemId ?? "",
        ...patch,
      },
    }));
  }

  async function submitReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data || !assetId || !targetStageKey) return;
    setBusy("review");
    setMessage("");
    try {
      await recordAssetLifecycleGateReview({
        assetId,
        targetStageKey,
        outcome,
        note: reviewNote,
        evaluationId: evaluationId || null,
        findings: data.criteria.map((criterion) => ({
          criterionId: criterion.id,
          status: findings[criterion.id]?.status ?? "not_assessed",
          evidenceItemId: findings[criterion.id]?.evidenceItemId || null,
        })),
      });
      setMessage(
        outcome === "pass"
          ? "Passing gate review recorded. Movement remains a separate named-human act."
          : "Hold recorded. The asset has not moved.",
      );
      setReviewNote("");
      refetch();
    } catch (reviewError) {
      setMessage(
        reviewError instanceof Error
          ? reviewError.message
          : "Gate review was not recorded.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function submitMovement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("move");
    setMessage("");
    try {
      const result = await advanceAssetLifecycleStage({
        assetId,
        targetStageKey,
        reason: movementReason,
      });
      setMessage(result.detail);
      setMovementReason("");
      setTargetStageKey("");
      setFindings({});
      refetch();
    } catch (movementError) {
      setMessage(
        movementError instanceof Error
          ? movementError.message
          : "Lifecycle stage was not advanced.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function submitDisposal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data) return;
    setBusy("disposal");
    setMessage("");
    try {
      const result = await recordAssetDisposal({
        assetId,
        disposalRoute,
        disposedAt,
        recoveredValue: recoveredValue === "" ? null : Number(recoveredValue),
        disposalCost: disposalCost === "" ? null : Number(disposalCost),
        currency,
        siteRestorationRequired: restorationRequired,
        siteRestorationComplete: restorationComplete,
        restorationObligation,
        hazardousMaterialsRemoved: hazardousRemoved,
        certificateReference,
        evidenceItemId: disposalEvidenceId,
        expectedVersion: data.disposal?.version ?? 0,
      });
      setMessage(`Disposal closeout version ${result.version} recorded.`);
      refetch();
    } catch (disposalError) {
      setMessage(
        disposalError instanceof Error
          ? disposalError.message
          : "Disposal closeout was not recorded.",
      );
    } finally {
      setBusy(null);
    }
  }

  if (loading && !data)
    return <LoadingState label="Loading asset lifecycle gate workspace" />;
  if (error && !data) return <ErrorState message={error} onRetry={refetch} />;
  if (!data) return null;

  return (
    <section
      aria-labelledby="asset-lifecycle-gate-heading"
      className="space-y-4 rounded-2xl border border-white/8 bg-slate-950/35 p-5"
    >
      <div className="flex items-start gap-3">
        <ClipboardCheck className="mt-0.5 h-5 w-5 text-cyan-300" aria-hidden />
        <div>
          <h2
            id="asset-lifecycle-gate-heading"
            className="text-lg font-semibold text-white"
          >
            Asset lifecycle gate workspace
          </h2>
          <p className="mt-1 max-w-4xl text-sm leading-relaxed text-slate-400">
            Review the evidence for the stage an asset is leaving, then record
            movement as a separate human act. A gate review never authorizes
            work, spending, risk acceptance, isolation, or return to service.
          </p>
        </div>
      </div>

      <label className="grid gap-1 text-xs text-slate-300">
        Asset
        <select
          value={assetId}
          onChange={(event) => changeAsset(event.target.value)}
          className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white"
        >
          <option value="">Select asset</option>
          {data.assets.map((asset) => (
            <option key={asset.id} value={asset.id}>
              {asset.tag ? `${asset.tag} — ` : ""}
              {asset.name}
              {asset.stageLabel ? ` · ${asset.stageLabel}` : " · no stage"}
            </option>
          ))}
        </select>
      </label>

      {selectedAsset && targetStages.length === 0 && (
        <div className="flex gap-2 rounded-xl border border-amber-400/20 bg-amber-400/[0.06] p-4 text-xs text-amber-100">
          <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden />
          This workspace governs forward end-of-life transitions. The selected
          asset has no eligible next stage here.
        </div>
      )}

      {selectedAsset && targetStages.length > 0 && data.authority.canAct && (
        <>
          <form
            onSubmit={submitReview}
            className="space-y-4 rounded-xl border border-cyan-400/20 bg-cyan-400/[0.04] p-4"
          >
            <div>
              <h3 className="text-sm font-semibold text-white">
                Record gate review
              </h3>
              <p className="mt-1 text-xs text-slate-400">
                Every current-stage criterion is explicit. An assessed finding
                requires independently verified evidence for this exact asset.
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <label className="grid gap-1 text-xs text-slate-300">
                Target stage
                <select
                  required
                  value={targetStageKey}
                  onChange={(event) => changeTarget(event.target.value)}
                  className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white"
                >
                  <option value="">Select target</option>
                  {targetStages.map((stage) => (
                    <option key={stage.stageKey} value={stage.stageKey}>
                      {stage.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-xs text-slate-300">
                Outcome
                <select
                  value={outcome}
                  onChange={(event) => {
                    const nextOutcome = event.target.value as "pass" | "hold";
                    setOutcome(nextOutcome);
                    if (nextOutcome === "hold") setEvaluationId("");
                  }}
                  className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white"
                >
                  <option value="hold">Hold</option>
                  <option value="pass">Pass</option>
                </select>
              </label>
              <label className="grid gap-1 text-xs text-slate-300">
                Accepted lifecycle evaluation
                <select
                  required={requiresAcceptedEvaluation}
                  disabled={!requiresAcceptedEvaluation}
                  value={evaluationId}
                  onChange={(event) => setEvaluationId(event.target.value)}
                  className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white disabled:opacity-50"
                >
                  <option value="">
                    {requiresAcceptedEvaluation
                      ? "Select evaluation"
                      : "Not required for a hold"}
                  </option>
                  {eligibleEvaluations.map((evaluation) => (
                    <option key={evaluation.id} value={evaluation.id}>
                      {evaluation.recommended} · {evaluation.uncertainty} uncertainty
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {targetStageKey && (
              <p className="rounded-lg border border-white/8 bg-black/10 p-3 text-xs text-slate-300">
                <strong className="text-white">Decision being reviewed:</strong>{" "}
                {selectedTarget?.decisionOwned}
              </p>
            )}

            <div className="space-y-2">
              {data.criteria.map((criterion) => {
                const draft = findings[criterion.id] ?? {
                  status: "not_assessed" as const,
                  evidenceItemId: "",
                };
                return (
                  <fieldset
                    key={criterion.id}
                    className="grid gap-3 rounded-lg border border-white/8 bg-black/10 p-3 md:grid-cols-[1fr_10rem_1fr]"
                  >
                    <legend className="sr-only">{criterion.criterion}</legend>
                    <div>
                      <p className="text-sm text-slate-200">
                        {criterion.criterion}
                        {criterion.isMandatory && (
                          <span className="ml-2 text-xs text-amber-300">
                            mandatory
                          </span>
                        )}
                      </p>
                      {criterion.guidance && (
                        <p className="mt-1 text-xs text-slate-500">
                          {criterion.guidance}
                        </p>
                      )}
                    </div>
                    <label className="grid gap-1 text-xs text-slate-300">
                      Finding
                      <select
                        value={draft.status}
                        onChange={(event) =>
                          updateFinding(criterion.id, {
                            status: event.target.value as FindingStatus,
                            evidenceItemId:
                              event.target.value === "not_assessed"
                                ? ""
                                : draft.evidenceItemId,
                          })
                        }
                        className="rounded-lg border border-white/10 bg-slate-950 px-2 py-2 text-sm text-white"
                      >
                        <option value="not_assessed">Not assessed</option>
                        <option value="met">Met</option>
                        <option value="not_met">Not met</option>
                      </select>
                    </label>
                    <label className="grid gap-1 text-xs text-slate-300">
                      Independent evidence
                      <select
                        required={draft.status !== "not_assessed"}
                        disabled={draft.status === "not_assessed"}
                        value={draft.evidenceItemId}
                        onChange={(event) =>
                          updateFinding(criterion.id, {
                            evidenceItemId: event.target.value,
                          })
                        }
                        className="rounded-lg border border-white/10 bg-slate-950 px-2 py-2 text-sm text-white disabled:opacity-50"
                      >
                        <option value="">Select evidence</option>
                        {data.evidence.map((evidence) => (
                          <option key={evidence.id} value={evidence.id}>
                            {evidence.description ?? evidence.sourceSystem ?? evidence.id}
                          </option>
                        ))}
                      </select>
                    </label>
                  </fieldset>
                );
              })}
            </div>
            <label className="grid gap-1 text-xs text-slate-300">
              Review basis
              <textarea
                required
                minLength={20}
                maxLength={4000}
                value={reviewNote}
                onChange={(event) => setReviewNote(event.target.value)}
                className="min-h-24 rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white"
              />
            </label>
            <button
              type="submit"
              disabled={busy !== null || !targetStageKey}
              className="rounded-lg bg-cyan-300 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50"
            >
              {busy === "review" ? "Recording…" : "Record gate review"}
            </button>
          </form>

          <form
            onSubmit={submitMovement}
            className="rounded-xl border border-white/8 bg-white/[0.025] p-4"
          >
            <div className="flex items-start gap-3">
              {latestMatchingPass ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-300" aria-hidden />
              ) : (
                <ShieldAlert className="h-5 w-5 text-amber-300" aria-hidden />
              )}
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-white">
                  Advance lifecycle stage
                </h3>
                <p className="mt-1 text-xs text-slate-400">
                  {latestMatchingPass
                    ? `Review #${latestMatchingPass.id} passes this exact transition. Movement still requires your stated basis.`
                    : "A fresh passing review for this current stage and exact target is required."}
                </p>
                <textarea
                  aria-label="Lifecycle movement basis"
                  required
                  minLength={20}
                  maxLength={4000}
                  value={movementReason}
                  onChange={(event) => setMovementReason(event.target.value)}
                  className="mt-3 min-h-20 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white"
                />
                <button
                  type="submit"
                  disabled={busy !== null || !latestMatchingPass}
                  className="mt-3 inline-flex items-center gap-2 rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-4 py-2 text-sm font-medium text-emerald-100 disabled:opacity-50"
                >
                  {busy === "move" ? "Advancing…" : "Advance lifecycle stage"}
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </button>
              </div>
            </div>
          </form>
        </>
      )}

      {selectedAsset?.stageKey === "disposal" && data.authority.canAct && (
        <form
          onSubmit={submitDisposal}
          className="space-y-3 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.04] p-4"
        >
          <div className="flex items-start gap-3">
            <Recycle className="h-5 w-5 text-emerald-300" aria-hidden />
            <div>
              <h3 className="text-sm font-semibold text-white">
                Record disposal and restoration
              </h3>
              <p className="mt-1 text-xs text-slate-400">
                Versioned physical closeout with asset-specific independent
                evidence. Values retain their currency and are never silently
                aggregated across currencies.
              </p>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <label className="grid gap-1 text-xs text-slate-300">
              Disposal route
              <select
                value={disposalRoute}
                onChange={(event) =>
                  setDisposalRoute(event.target.value as DisposalRoute)
                }
                className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white"
              >
                {ROUTES.map((route) => (
                  <option key={route.value} value={route.value}>
                    {route.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-xs text-slate-300">
              Disposed date
              <input
                required
                type="date"
                value={disposedAt}
                onChange={(event) => setDisposedAt(event.target.value)}
                className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="grid gap-1 text-xs text-slate-300">
              Independent closeout evidence
              <select
                required
                value={disposalEvidenceId}
                onChange={(event) => setDisposalEvidenceId(event.target.value)}
                className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white"
              >
                <option value="">Select evidence</option>
                {data.evidence.map((evidence) => (
                  <option key={evidence.id} value={evidence.id}>
                    {evidence.description ?? evidence.sourceSystem ?? evidence.id}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-xs text-slate-300">
              Recovered value
              <input
                type="number"
                min="0"
                step="0.01"
                value={recoveredValue}
                onChange={(event) => setRecoveredValue(event.target.value)}
                className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="grid gap-1 text-xs text-slate-300">
              Disposal cost
              <input
                type="number"
                min="0"
                step="0.01"
                value={disposalCost}
                onChange={(event) => setDisposalCost(event.target.value)}
                className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="grid gap-1 text-xs text-slate-300">
              Currency
              <input
                maxLength={3}
                value={currency}
                onChange={(event) => setCurrency(event.target.value.toUpperCase())}
                className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm uppercase text-white"
              />
            </label>
          </div>
          <div className="grid gap-2 text-sm text-slate-300 md:grid-cols-3">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={restorationRequired}
                onChange={(event) => setRestorationRequired(event.target.checked)}
              />
              Site restoration required
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={restorationComplete}
                onChange={(event) => setRestorationComplete(event.target.checked)}
              />
              Site restoration complete
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={hazardousRemoved}
                onChange={(event) => setHazardousRemoved(event.target.checked)}
              />
              Hazardous materials removed
            </label>
          </div>
          <label className="grid gap-1 text-xs text-slate-300">
            Restoration obligation
            <textarea
              required={restorationRequired}
              minLength={restorationRequired ? 20 : undefined}
              value={restorationObligation}
              onChange={(event) => setRestorationObligation(event.target.value)}
              className="min-h-20 rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white"
            />
          </label>
          <label className="grid gap-1 text-xs text-slate-300">
            Disposal certificate reference
            <input
              required={disposalRoute === "hazardous_disposal"}
              value={certificateReference}
              onChange={(event) => setCertificateReference(event.target.value)}
              className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white"
            />
          </label>
          <button
            type="submit"
            disabled={busy !== null}
            className="rounded-lg bg-emerald-300 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50"
          >
            {busy === "disposal"
              ? "Recording…"
              : data.disposal
                ? `Replace disposal record v${data.disposal.version}`
                : "Record disposal and restoration"}
          </button>
        </form>
      )}

      {selectedAsset && !data.authority.canAct && (
        <p className="rounded-xl border border-white/8 bg-white/[0.025] p-4 text-xs text-slate-400">
          This role may inspect lifecycle evidence but cannot record a gate,
          movement, or disposal closeout. A named lifecycle authority with a
          verified factor and AAL2 session is required.
        </p>
      )}

      {message && (
        <p role="status" className="rounded-lg border border-white/8 p-3 text-sm text-slate-200">
          {message}
        </p>
      )}
    </section>
  );
}
