/**
 * Preventive-maintenance policies — block replacement, opportunistic
 * grouping and multi-component comparison (capability register C7.08).
 *
 * The calculation runs in the authenticated calculation service. This panel
 * records a human access-cost fact, shows the frozen result, and sends
 * adoption through a different assigned reviewer. It does not change an
 * interval by itself.
 */
import { useEffect, useMemo, useState } from "react";
import { Layers, ShieldCheck } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import {
  adoptPmPolicyAssessment,
  assignPmPolicyReview,
  loadPmPolicyWorkspace,
  recordPmGroupingBasis,
  runPmPolicyOptimization,
} from "../services/pmPolicyOptimizationService";
import { ErrorState, LoadingState } from "./ui/AsyncStates";

const inputClass =
  "mt-1 w-full rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm text-white";
const defaultDue = new Date(Date.now() + 7 * 86_400_000)
  .toISOString()
  .slice(0, 10);

function money(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "not recorded";
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export function PmPolicyOptimization() {
  const { data, loading, error, refetch } = useAsyncData(
    loadPmPolicyWorkspace,
    [],
    {
      isEmpty: () => false,
    },
  );
  const [assetId, setAssetId] = useState("");
  const [assessmentId, setAssessmentId] = useState("");
  const [reviewerId, setReviewerId] = useState("");
  const [accessCost, setAccessCost] = useState("");
  const [accessExcluded, setAccessExcluded] = useState<"" | "yes" | "no">("");
  const [accessBasis, setAccessBasis] = useState("");
  const [dueDate, setDueDate] = useState(defaultDue);
  const [reviewNote, setReviewNote] = useState(
    "Independently review the life evidence, costs and policy comparison before adoption.",
  );
  const [action, setAction] = useState<
    "record_policy" | "apply_standing_intervals"
  >("record_policy");
  const [adoptionNote, setAdoptionNote] = useState(
    "Independent reliability review confirms the frozen evidence and the selected policy.",
  );
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState<{
    kind: "ok" | "error";
    text: string;
  } | null>(null);

  useEffect(() => {
    if (!assetId && data?.assets[0]) setAssetId(data.assets[0].id);
    if (!assessmentId && data?.assessments[0])
      setAssessmentId(data.assessments[0].id);
    if (!reviewerId && data?.reviewers[0]) setReviewerId(data.reviewers[0].id);
  }, [assetId, assessmentId, data, reviewerId]);

  const asset = useMemo(
    () => data?.assets.find((item) => item.id === assetId) ?? null,
    [assetId, data],
  );
  const assessment = useMemo(
    () => data?.assessments.find((item) => item.id === assessmentId) ?? null,
    [assessmentId, data],
  );

  async function run(
    task: string,
    actionFn: () => Promise<unknown>,
    ok: string,
  ) {
    setBusy(task);
    setNotice(null);
    try {
      await actionFn();
      setNotice({ kind: "ok", text: ok });
      refetch();
    } catch (caught) {
      setNotice({
        kind: "error",
        text: caught instanceof Error ? caught.message : "The request failed.",
      });
    } finally {
      setBusy("");
    }
  }

  if (loading)
    return <LoadingState label="Loading preventive-maintenance policies" />;
  if (error || !data)
    return (
      <ErrorState
        message={error ?? "Policies are unavailable."}
        onRetry={refetch}
      />
    );

  const analysis = assessment?.analysis;

  return (
    <section aria-labelledby="pm-policy-heading" className="space-y-4">
      <div>
        <h2
          id="pm-policy-heading"
          className="flex items-center gap-2 text-lg font-semibold text-white"
        >
          <Layers className="h-5 w-5 text-signal-cyan" aria-hidden />
          Block, opportunistic and multi-component policies
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-300">{data.basis}</p>
      </div>

      {notice ? (
        <p
          role={notice.kind === "error" ? "alert" : "status"}
          className={`rounded-lg border p-3 text-xs ${notice.kind === "error" ? "border-red-500/25 bg-red-500/5 text-red-200" : "border-emerald-500/25 bg-emerald-500/5 text-emerald-100"}`}
        >
          {notice.text}
        </p>
      ) : null}

      {data.assets.length === 0 ? (
        <p className="rounded-xl border border-white/6 bg-white/2 p-4 text-sm text-slate-400">
          No asset with a maintenance plan is visible in this organization. A
          policy is not calculated from an empty programme.
        </p>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          <article className="space-y-3 rounded-xl border border-white/6 bg-overlook-deep/40 p-4">
            <label
              className="block text-xs uppercase tracking-wide text-slate-400"
              htmlFor="pm-policy-asset"
            >
              Asset
              <select
                id="pm-policy-asset"
                className={inputClass}
                value={assetId}
                onChange={(event) => setAssetId(event.target.value)}
              >
                {data.assets.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.tag ? `${item.tag} · ` : ""}
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <ul className="space-y-2">
              {(asset?.plans ?? []).map((plan) => (
                <li
                  key={plan.id}
                  className="rounded-lg border border-white/5 p-3 text-xs text-slate-300"
                >
                  <strong className="text-slate-100">{plan.taskLabel}</strong>
                  <p className="mt-1">
                    {plan.componentScope ?? "Component scope not recorded"} ·{" "}
                    {plan.failureEvents} failures · {plan.suspensionEvents}{" "}
                    suspensions
                  </p>
                  <p className="mt-1">
                    Planned {money(plan.plannedItemCost)} · failure{" "}
                    {money(plan.failureCost)} · current {plan.intervalValue}{" "}
                    {plan.intervalBasis === "run_hours" ? "h" : "d"}
                  </p>
                  <p className="mt-1 text-slate-500">
                    Safety{" "}
                    {plan.safetyCritical == null
                      ? "unknown"
                      : plan.safetyCritical
                        ? "critical"
                        : "not critical"}{" "}
                    · regulatory{" "}
                    {plan.regulatoryRequired == null
                      ? "unknown"
                      : plan.regulatoryRequired
                        ? "required"
                        : "not required"}
                  </p>
                </li>
              ))}
            </ul>
            <p className="text-xs text-slate-400">
              {asset?.groupingBasis
                ? `Shared access ${money(asset.groupingBasis.sharedAccessCostUsd)} is recorded. Task costs ${asset.groupingBasis.accessExcludedFromTaskCosts ? "exclude" : "already include"} it. ${asset.groupingBasis.basis}`
                : "No shared access cost is recorded, so no grouping saving will be claimed."}
            </p>
            <label
              className="block text-xs uppercase tracking-wide text-slate-400"
              htmlFor="pm-access-cost"
            >
              Shared access cost
              <input
                id="pm-access-cost"
                className={inputClass}
                inputMode="decimal"
                value={accessCost}
                onChange={(event) => setAccessCost(event.target.value)}
              />
            </label>
            <label
              className="block text-xs uppercase tracking-wide text-slate-400"
              htmlFor="pm-access-excluded"
            >
              Task costs exclude this access cost
              <select
                id="pm-access-excluded"
                className={inputClass}
                value={accessExcluded}
                onChange={(event) =>
                  setAccessExcluded(event.target.value as "" | "yes" | "no")
                }
              >
                <option value="">Choose</option>
                <option value="yes">Yes, task costs exclude it</option>
                <option value="no">
                  No, task costs already include an opening
                </option>
              </select>
            </label>
            <label
              className="block text-xs uppercase tracking-wide text-slate-400"
              htmlFor="pm-access-basis"
            >
              Access-cost provenance
              <textarea
                id="pm-access-basis"
                className={inputClass}
                rows={3}
                value={accessBasis}
                onChange={(event) => setAccessBasis(event.target.value)}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-slate-200 disabled:opacity-50"
                disabled={
                  busy !== "" ||
                  !asset ||
                  accessExcluded === "" ||
                  accessBasis.trim().length < 20 ||
                  !(Number(accessCost) > 0)
                }
                onClick={() =>
                  void run(
                    "basis",
                    () =>
                      recordPmGroupingBasis({
                        assetId,
                        sharedAccessCostUsd: Number(accessCost),
                        accessExcludedFromTaskCosts: accessExcluded === "yes",
                        basis: accessBasis,
                      }),
                    "Shared access cost recorded. It does not change any interval.",
                  )
                }
              >
                Record access cost
              </button>
              <button
                type="button"
                className="rounded-lg border border-signal-cyan/30 bg-signal-cyan/10 px-3 py-2 text-xs font-semibold text-signal-cyan disabled:opacity-50"
                disabled={busy !== "" || !asset}
                onClick={() =>
                  void run(
                    "run",
                    async () => {
                      const receipt = await runPmPolicyOptimization(assetId);
                      setAssessmentId(receipt.assessment_id);
                    },
                    "Advisory policy assessment stored. A different assigned reviewer must adopt it.",
                  )
                }
              >
                Run policy assessment
              </button>
            </div>
          </article>

          <article className="space-y-3 rounded-xl border border-white/6 bg-overlook-deep/40 p-4">
            <label
              className="block text-xs uppercase tracking-wide text-slate-400"
              htmlFor="pm-policy-assessment"
            >
              Assessment
              <select
                id="pm-policy-assessment"
                className={inputClass}
                value={assessmentId}
                onChange={(event) => setAssessmentId(event.target.value)}
              >
                {data.assessments.length === 0 ? (
                  <option value="">No assessment yet</option>
                ) : null}
                {data.assessments.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.assetName} · {item.selected} ·{" "}
                    {new Date(item.createdAt).toLocaleString()}
                  </option>
                ))}
              </select>
            </label>
            {analysis ? (
              <div className="space-y-2 text-xs text-slate-300">
                <p className="flex items-start gap-2">
                  <ShieldCheck
                    className="mt-0.5 h-3.5 w-3.5 text-signal-gold"
                    aria-hidden
                  />
                  <span>{analysis.recommendation.reason}</span>
                </p>
                <p>
                  Separate age cost rate{" "}
                  {analysis.separateAge.costRate ?? "not priced"} · separate
                  block {analysis.separateBlock.costRate ?? "not priced"} ·
                  common block {analysis.commonBlock.costRate ?? "not priced"}
                  {analysis.commonBlock.intervalHours != null
                    ? ` at ${analysis.commonBlock.intervalHours} h`
                    : ""}
                  .
                </p>
                <p>{analysis.opportunistic.reason}</p>
                <ul className="space-y-2">
                  {analysis.components.map((component) => (
                    <li
                      key={component.key}
                      className="rounded-lg border border-white/5 p-3"
                    >
                      <strong className="text-slate-100">
                        {component.label}
                      </strong>
                      <p className="mt-1">
                        Block{" "}
                        {component.blockReplacement.recommended
                          ? `every ${component.blockReplacement.optimalInterval?.toFixed(0)} h`
                          : "refused"}
                        {component.blockReplacement.premiumOverAgePct != null
                          ? ` · ${component.blockReplacement.premiumOverAgePct}% versus age`
                          : ""}
                        . Standing interval{" "}
                        {component.standingIntervalHours ?? "none"}
                        {component.applyInterval
                          ? ", eligible for a named-human interval write"
                          : ", not eligible for an interval write"}
                        .
                      </p>
                      <p className="mt-1 text-slate-400">
                        {component.opportunistic.reason}
                      </p>
                    </li>
                  ))}
                </ul>
                {analysis.refusals.length > 0 ? (
                  <ul className="list-disc space-y-1 pl-4 text-amber-200/90">
                    {analysis.refusals.map((refusal) => (
                      <li key={refusal}>{refusal}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : (
              <p className="text-xs text-slate-500">
                Run an assessment to compare block, opportunistic and
                common-interval policies.
              </p>
            )}

            <label
              className="block text-xs uppercase tracking-wide text-slate-400"
              htmlFor="pm-policy-reviewer"
            >
              Assigned reviewer
              <select
                id="pm-policy-reviewer"
                className={inputClass}
                value={reviewerId}
                onChange={(event) => setReviewerId(event.target.value)}
              >
                {data.reviewers.map((reviewer) => (
                  <option key={reviewer.id} value={reviewer.id}>
                    {reviewer.name ?? reviewer.email ?? reviewer.id} ·{" "}
                    {reviewer.role}
                  </option>
                ))}
              </select>
            </label>
            <label
              className="block text-xs uppercase tracking-wide text-slate-400"
              htmlFor="pm-policy-due"
            >
              Review due date
              <input
                id="pm-policy-due"
                type="date"
                className={inputClass}
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
              />
            </label>
            <label
              className="block text-xs uppercase tracking-wide text-slate-400"
              htmlFor="pm-policy-review-note"
            >
              Review note
              <textarea
                id="pm-policy-review-note"
                className={inputClass}
                rows={2}
                value={reviewNote}
                onChange={(event) => setReviewNote(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-slate-200 disabled:opacity-50"
              disabled={busy !== "" || !assessmentId || !reviewerId}
              onClick={() =>
                void run(
                  "assign",
                  () =>
                    assignPmPolicyReview({
                      assessmentId,
                      assignedTo: reviewerId,
                      dueDate,
                      note: reviewNote,
                    }),
                  "Review assigned. The requester cannot adopt their own assessment.",
                )
              }
            >
              Assign review
            </button>
            <label
              className="block text-xs uppercase tracking-wide text-slate-400"
              htmlFor="pm-policy-action"
            >
              Adoption
              <select
                id="pm-policy-action"
                className={inputClass}
                value={action}
                onChange={(event) =>
                  setAction(
                    event.target.value as
                      "record_policy" | "apply_standing_intervals",
                  )
                }
              >
                <option value="record_policy">
                  Record the policy without changing intervals
                </option>
                <option value="apply_standing_intervals">
                  Apply standing intervals where explicitly non-safety
                </option>
              </select>
            </label>
            <label
              className="block text-xs uppercase tracking-wide text-slate-400"
              htmlFor="pm-policy-adoption-note"
            >
              Adoption note
              <textarea
                id="pm-policy-adoption-note"
                className={inputClass}
                rows={2}
                value={adoptionNote}
                onChange={(event) => setAdoptionNote(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="rounded-lg border border-signal-gold/30 bg-signal-gold/10 px-3 py-2 text-xs font-semibold text-signal-gold disabled:opacity-50"
              disabled={
                busy !== "" || !assessment || assessment.adoption != null
              }
              onClick={() =>
                void run(
                  "adopt",
                  () =>
                    adoptPmPolicyAssessment({
                      assessmentId,
                      action,
                      note: adoptionNote,
                    }),
                  action === "record_policy"
                    ? "Policy recorded. No maintenance-plan interval was changed."
                    : "Adoption recorded. Only explicitly non-safety standing intervals can change, and only through this review.",
                )
              }
            >
              Record governed decision
            </button>
            {assessment?.adoption ? (
              <p className="text-xs text-slate-400">
                Already adopted as {assessment.adoption.action}. Programme{" "}
                {assessment.adoption.programmeChanged
                  ? "intervals were updated"
                  : "intervals were not changed"}
                .
              </p>
            ) : null}
          </article>
        </div>
      )}
    </section>
  );
}
