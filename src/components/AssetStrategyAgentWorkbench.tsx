import { useEffect, useMemo, useState } from "react";
import {
  Bot,
  ClipboardCheck,
  Gauge,
  History,
  RefreshCw,
  Save,
  ShieldCheck,
} from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import {
  adoptAssetStrategyAssessment,
  assignAssetStrategyReview,
  loadAssetStrategyWorkspace,
  recordAssetStrategyContext,
  runAssetStrategyAgent,
  type StrategyKind,
} from "../services/assetStrategyAgentService";
import { ErrorState, LoadingState } from "./ui/AsyncStates";

const input =
  "mt-1 w-full rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm text-white";
const defaultDue = new Date(Date.now() + 7 * 86_400_000)
  .toISOString()
  .slice(0, 10);

function label(value: string) {
  return value.replaceAll("_", " ");
}

export function AssetStrategyAgentWorkbench() {
  const { data, loading, error, refetch } = useAsyncData(
    loadAssetStrategyWorkspace,
    [],
    { isEmpty: () => false },
  );
  const [planId, setPlanId] = useState("");
  const [assessmentId, setAssessmentId] = useState("");
  const [reviewerId, setReviewerId] = useState("");
  const [component, setComponent] = useState("");
  const [failureMode, setFailureMode] = useState("");
  const [strategyKind, setStrategyKind] =
    useState<StrategyKind>("time_based_pm");
  const [plannedCost, setPlannedCost] = useState("");
  const [failureCost, setFailureCost] = useState("");
  const [costBasis, setCostBasis] = useState("");
  const [safetyCritical, setSafetyCritical] = useState<"" | "yes" | "no">("");
  const [regulatoryRequired, setRegulatoryRequired] = useState<
    "" | "yes" | "no"
  >("");
  const [objective, setObjective] = useState("");
  const [dueDate, setDueDate] = useState(defaultDue);
  const [reviewNote, setReviewNote] = useState(
    "Independently review the exact evidence, model result and programme consequence before adoption.",
  );
  const [action, setAction] = useState<
    "apply_recommended" | "retain_current" | "defer"
  >("apply_recommended");
  const [horizonYears, setHorizonYears] = useState(5);
  const [adoptionNote, setAdoptionNote] = useState(
    "Independent reliability review confirms the stated evidence and controlled programme decision.",
  );
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState<{
    kind: "ok" | "error";
    text: string;
  } | null>(null);

  useEffect(() => {
    if (!planId && data?.plans[0]) setPlanId(data.plans[0].id);
    if (!assessmentId && data?.assessments[0])
      setAssessmentId(data.assessments[0].id);
    if (!reviewerId && data?.reviewers[0]) setReviewerId(data.reviewers[0].id);
  }, [assessmentId, data, planId, reviewerId]);

  const plan = useMemo(
    () => data?.plans.find((item) => item.id === planId) ?? null,
    [data, planId],
  );
  const assessment = useMemo(
    () => data?.assessments.find((item) => item.id === assessmentId) ?? null,
    [assessmentId, data],
  );
  const learning = useMemo(
    () => data?.learning.find((item) => item.planId === planId)?.state ?? null,
    [data?.learning, planId],
  );

  useEffect(() => {
    if (!plan) return;
    setComponent(plan.componentScope ?? "");
    setFailureMode(plan.failureMode ?? "");
    setStrategyKind(plan.strategyKind ?? "time_based_pm");
    setPlannedCost(plan.plannedTaskCostUsd?.toString() ?? "");
    setFailureCost(plan.failureConsequenceCostUsd?.toString() ?? "");
    setCostBasis(plan.costBasis ?? "");
    setSafetyCritical(
      plan.safetyCritical == null ? "" : plan.safetyCritical ? "yes" : "no",
    );
    setRegulatoryRequired(
      plan.regulatoryRequired == null
        ? ""
        : plan.regulatoryRequired
          ? "yes"
          : "no",
    );
    setObjective(plan.lifecycleObjective ?? "");
  }, [plan]);

  async function act(key: string, task: () => Promise<void>, success: string) {
    setBusy(key);
    setNotice(null);
    try {
      await task();
      setNotice({ kind: "ok", text: success });
      await refetch();
    } catch (caught) {
      setNotice({
        kind: "error",
        text:
          caught instanceof Error
            ? caught.message
            : "The governed asset-strategy action failed.",
      });
    } finally {
      setBusy("");
    }
  }

  if (loading && !data)
    return <LoadingState label="Loading Asset Strategy Specialist" />;
  if (error && !data) return <ErrorState message={error} onRetry={refetch} />;

  return (
    <section className="overflow-hidden rounded-2xl border border-cyan-400/20 bg-[#07131a]">
      <div className="border-b border-white/8 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.12),transparent_46%)] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">
              <Bot className="h-4 w-4" aria-hidden /> Asset Strategy Specialist
            </div>
            <h2 className="text-xl font-semibold text-white">
              PM optimization to controlled programme adoption
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              The controlled service applies the shared censored-life,
              age-replacement and P-F kernels to one canonical maintenance task.
              The agent retains evidence and proposes. It cannot change an
              interval, deactivate a task, approve strategy, create work or
              accept risk.
            </p>
          </div>
          <div className="min-w-72">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Maintenance task
              <select
                value={planId}
                onChange={(event) => setPlanId(event.target.value)}
                className={input}
              >
                <option value="">Select a canonical plan…</option>
                {(data?.plans ?? []).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.assetName ?? "Unlinked asset"} · {item.taskLabel}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={!plan || Boolean(busy)}
              onClick={() =>
                void act(
                  "run",
                  async () => {
                    if (!plan) return;
                    const receipt = await runAssetStrategyAgent(plan.id);
                    setAssessmentId(receipt.assessment_id);
                  },
                  "Immutable assessment created. No maintenance-programme state changed.",
                )
              }
              className="mt-3 w-full rounded-lg bg-cyan-300 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-40"
            >
              {busy === "run"
                ? "Running controlled kernels…"
                : learning?.refreshRequired
                  ? "Refresh from verified field experience"
                  : "Run retained assessment"}
            </button>
            {plan ? (
              <div
                className={`mt-3 rounded-lg border px-3 py-2 text-xs leading-5 ${
                  learning?.revisionRequired
                    ? "border-rose-400/30 bg-rose-400/10 text-rose-100"
                    : learning?.refreshRequired
                      ? "border-amber-300/30 bg-amber-300/10 text-amber-100"
                      : learning && learning.eventIds.length > 0
                        ? "border-emerald-300/20 bg-emerald-300/5 text-emerald-100"
                        : "border-white/8 bg-white/[0.025] text-slate-400"
                }`}
              >
                <div className="flex items-center gap-2 font-semibold">
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                  {learning?.revisionRequired
                    ? "Verified recurrence requires strategy review"
                    : learning?.refreshRequired
                      ? "New verified field outcome awaits assessment"
                      : learning && learning.eventIds.length > 0
                        ? "Field experience is incorporated"
                        : "Awaiting concluded field experience"}
                </div>
                <p className="mt-1">
                  {learning
                    ? `${learning.currentEffectiveCount} effective · ${learning.currentIneffectiveCount} ineffective against plan v${learning.currentPlanVersion}.`
                    : "No concluded corrective-action outcome is tied to this exact maintenance task yet."}
                </p>
                <p className="mt-1 opacity-80">
                  A refresh creates an advisory assessment only. Independent
                  review and named-human adoption remain mandatory.
                </p>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="grid gap-5 p-5 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <div className="space-y-4">
          <div className="rounded-xl border border-white/8 bg-black/15 p-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
              <Gauge className="h-4 w-4 text-cyan-300" aria-hidden />
              Human-authored engineering context
            </h3>
            <p className="mt-1 text-xs leading-5 text-slate-400">
              Unknown is not false. Explicitly classify safety and regulatory
              applicability before the specialist may even surface a
              run-to-failure review.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-xs text-slate-300">
                Component population
                <input
                  className={input}
                  value={component}
                  onChange={(e) => setComponent(e.target.value)}
                />
              </label>
              <label className="text-xs text-slate-300">
                Failure mode
                <input
                  className={input}
                  value={failureMode}
                  onChange={(e) => setFailureMode(e.target.value)}
                />
              </label>
              <label className="text-xs text-slate-300">
                Current strategy
                <select
                  className={input}
                  value={strategyKind}
                  onChange={(e) =>
                    setStrategyKind(e.target.value as StrategyKind)
                  }
                >
                  <option value="time_based_pm">Time-based PM</option>
                  <option value="condition_based">Condition-based</option>
                  <option value="failure_finding">Failure finding</option>
                  <option value="run_to_failure">Run to failure</option>
                </select>
              </label>
              <label className="text-xs text-slate-300">
                Planned task cost (USD)
                <input
                  className={input}
                  type="number"
                  min="0"
                  value={plannedCost}
                  onChange={(e) => setPlannedCost(e.target.value)}
                />
              </label>
              <label className="text-xs text-slate-300">
                Failure consequence cost (USD)
                <input
                  className={input}
                  type="number"
                  min="0"
                  value={failureCost}
                  onChange={(e) => setFailureCost(e.target.value)}
                />
              </label>
              <label className="text-xs text-slate-300">
                Safety-critical applicability
                <select
                  className={input}
                  value={safetyCritical}
                  onChange={(event) =>
                    setSafetyCritical(event.target.value as "" | "yes" | "no")
                  }
                >
                  <option value="">Unknown — classify explicitly</option>
                  <option value="yes">Yes — safety critical</option>
                  <option value="no">No — not safety critical</option>
                </select>
              </label>
              <label className="text-xs text-slate-300">
                Regulatory or statutory requirement
                <select
                  className={input}
                  value={regulatoryRequired}
                  onChange={(event) =>
                    setRegulatoryRequired(
                      event.target.value as "" | "yes" | "no",
                    )
                  }
                >
                  <option value="">Unknown — classify explicitly</option>
                  <option value="yes">Yes — requirement applies</option>
                  <option value="no">No — no requirement applies</option>
                </select>
              </label>
            </div>
            <label className="mt-3 block text-xs text-slate-300">
              Cost provenance
              <textarea
                className={input}
                rows={2}
                value={costBasis}
                onChange={(e) => setCostBasis(e.target.value)}
              />
            </label>
            <label className="mt-3 block text-xs text-slate-300">
              Lifecycle objective
              <textarea
                className={input}
                rows={2}
                value={objective}
                onChange={(e) => setObjective(e.target.value)}
              />
            </label>
            <button
              type="button"
              disabled={
                !plan ||
                Boolean(busy) ||
                component.trim().length < 2 ||
                failureMode.trim().length < 5 ||
                objective.trim().length < 20 ||
                !safetyCritical ||
                !regulatoryRequired
              }
              onClick={() =>
                void act(
                  "context",
                  async () => {
                    if (!plan) return;
                    await recordAssetStrategyContext({
                      planId: plan.id,
                      componentScope: component,
                      failureMode,
                      strategyKind,
                      plannedTaskCostUsd: plannedCost
                        ? Number(plannedCost)
                        : null,
                      failureConsequenceCostUsd: failureCost
                        ? Number(failureCost)
                        : null,
                      costBasis,
                      safetyCritical: safetyCritical === "yes",
                      regulatoryRequired: regulatoryRequired === "yes",
                      lifecycleObjective: objective,
                    });
                  },
                  "Engineering context recorded as named-human evidence. Run a new assessment against the new plan version.",
                )
              }
              className="mt-3 inline-flex items-center gap-2 rounded-lg border border-cyan-300/30 px-3 py-2 text-xs font-semibold text-cyan-200 disabled:opacity-40"
            >
              <Save className="h-3.5 w-3.5" aria-hidden /> Save governed context
            </button>
          </div>

          <div className="rounded-xl border border-white/8 bg-black/15 p-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
              <History className="h-4 w-4 text-cyan-300" aria-hidden />
              Immutable lifecycle-plan history
            </h3>
            <ul className="mt-3 space-y-2">
              {(data?.lifecyclePlans ?? []).slice(0, 6).map((item) => (
                <li
                  key={item.id}
                  className="rounded-lg border border-white/6 p-3 text-xs text-slate-300"
                >
                  <div className="flex justify-between gap-3">
                    <span className="font-medium text-white">
                      {item.assetName} · v{item.version}
                    </span>
                    <span className="text-slate-500">{item.horizonYears}y</span>
                  </div>
                  <p className="mt-1">{item.objective}</p>
                  <p className="mt-1 text-slate-500">
                    {label(item.adoptedAction)} ·{" "}
                    {new Date(item.adoptedAt).toLocaleString()}
                  </p>
                </li>
              ))}
              {!data?.lifecyclePlans.length ? (
                <li className="text-xs text-slate-500">
                  No lifecycle-plan version has been human-adopted.
                </li>
              ) : null}
            </ul>
          </div>
        </div>

        <div className="space-y-4">
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
            Retained assessment
            <select
              value={assessmentId}
              onChange={(e) => setAssessmentId(e.target.value)}
              className={input}
            >
              <option value="">No assessment selected</option>
              {(data?.assessments ?? []).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.assetName} · {item.taskLabel} ·{" "}
                  {label(item.recommendation.kind)}
                </option>
              ))}
            </select>
          </label>

          {assessment ? (
            <div className="rounded-xl border border-cyan-300/15 bg-cyan-300/[0.03] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-white">
                    {assessment.assetName} · {assessment.taskLabel}
                  </p>
                  <p className="mt-1 text-xs text-cyan-200">
                    {label(assessment.recommendation.kind)}
                  </p>
                </div>
                <span className="rounded-full border border-white/10 px-2 py-1 font-mono text-[11px] text-slate-400">
                  {assessment.kernelVersion} · plan v{assessment.planVersion}
                </span>
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-300">
                {assessment.recommendation.reason}
              </p>
              <div className="mt-3 rounded-lg border border-white/8 bg-black/20 p-3 text-xs text-slate-300">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-white">
                    Frozen field experience
                  </span>
                  <span>
                    {assessment.analysis.fieldExperience?.effectiveCount ?? 0}{" "}
                    effective{" · "}
                    {assessment.analysis.fieldExperience?.ineffectiveCount ??
                      0}{" "}
                    ineffective
                  </span>
                </div>
                <p className="mt-1 text-slate-400">
                  {assessment.analysis.fieldExperience?.basis ??
                    "This assessment predates field-learning provenance; run a new retained assessment to capture current verified outcomes."}
                </p>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div>
                  <dt className="text-[10px] uppercase text-slate-500">
                    Method
                  </dt>
                  <dd className="mt-1 text-xs text-white">
                    {assessment.analysis.methodSelection.method}
                  </dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase text-slate-500">β</dt>
                  <dd className="mt-1 font-mono text-xs text-white">
                    {assessment.analysis.methodSelection.beta?.toFixed(2) ??
                      "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase text-slate-500">η</dt>
                  <dd className="mt-1 font-mono text-xs text-white">
                    {assessment.analysis.methodSelection.eta?.toFixed(0) ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase text-slate-500">
                    Source events
                  </dt>
                  <dd className="mt-1 font-mono text-xs text-white">
                    {assessment.sourceEventIds.length}
                  </dd>
                </div>
              </dl>
              {assessment.analysis.refusals.length ? (
                <ul className="mt-3 space-y-1 text-xs text-amber-200/90">
                  {assessment.analysis.refusals.map((item) => (
                    <li key={item}>• {item}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : (
            <p className="rounded-xl border border-white/6 p-4 text-sm text-slate-500">
              Run the specialist after recording the task’s engineering context.
              Missing evidence is retained as a refusal, never converted into a
              default interval.
            </p>
          )}

          <div className="grid gap-4 rounded-xl border border-white/8 bg-black/15 p-4 lg:grid-cols-2">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
                <ClipboardCheck className="h-4 w-4 text-cyan-300" aria-hidden />{" "}
                Assign independent review
              </h3>
              <select
                className={input}
                value={reviewerId}
                onChange={(e) => setReviewerId(e.target.value)}
              >
                <option value="">Named reviewer…</option>
                {(data?.reviewers ?? []).map((reviewer) => (
                  <option key={reviewer.id} value={reviewer.id}>
                    {reviewer.name ?? reviewer.email} · {label(reviewer.role)}
                  </option>
                ))}
              </select>
              <input
                className={input}
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
              <textarea
                className={input}
                rows={3}
                value={reviewNote}
                onChange={(e) => setReviewNote(e.target.value)}
              />
              <button
                type="button"
                disabled={!assessment || !reviewerId || Boolean(busy)}
                onClick={() =>
                  void act(
                    "assign",
                    async () => {
                      if (!assessment) return;
                      await assignAssetStrategyReview({
                        assessmentId: assessment.id,
                        assignedTo: reviewerId,
                        dueDate,
                        note: reviewNote,
                      });
                    },
                    "Independent named-human review assigned. No programme change was made.",
                  )
                }
                className="mt-3 rounded-lg border border-cyan-300/30 px-3 py-2 text-xs font-semibold text-cyan-200 disabled:opacity-40"
              >
                {busy === "assign" ? "Assigning…" : "Assign review"}
              </button>
            </div>

            <div>
              <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
                <ShieldCheck className="h-4 w-4 text-emerald-300" aria-hidden />{" "}
                Human adoption
              </h3>
              <select
                className={input}
                value={action}
                onChange={(e) => setAction(e.target.value as typeof action)}
              >
                <option value="apply_recommended">
                  Apply recommended programme change
                </option>
                <option value="retain_current">Retain current strategy</option>
                <option value="defer">Defer decision</option>
              </select>
              <input
                className={input}
                type="number"
                min="1"
                max="30"
                value={horizonYears}
                onChange={(e) => setHorizonYears(Number(e.target.value))}
              />
              <textarea
                className={input}
                rows={2}
                value={objective}
                onChange={(e) => setObjective(e.target.value)}
                placeholder="Lifecycle objective"
              />
              <textarea
                className={input}
                rows={3}
                value={adoptionNote}
                onChange={(e) => setAdoptionNote(e.target.value)}
              />
              <button
                type="button"
                disabled={
                  !assessment ||
                  Boolean(busy) ||
                  objective.trim().length < 20 ||
                  adoptionNote.trim().length < 20
                }
                onClick={() =>
                  void act(
                    "adopt",
                    async () => {
                      if (!assessment) return;
                      await adoptAssetStrategyAssessment({
                        assessmentId: assessment.id,
                        action,
                        horizonYears,
                        objective,
                        note: adoptionNote,
                      });
                    },
                    "Named-human decision and immutable lifecycle-plan version recorded.",
                  )
                }
                className="mt-3 rounded-lg bg-emerald-300 px-3 py-2 text-xs font-semibold text-slate-950 disabled:opacity-40"
              >
                {busy === "adopt"
                  ? "Recording decision…"
                  : "Record governed decision"}
              </button>
            </div>
          </div>

          {notice ? (
            <p
              className={`rounded-lg border p-3 text-xs ${notice.kind === "ok" ? "border-emerald-400/25 bg-emerald-400/5 text-emerald-200" : "border-red-400/25 bg-red-400/5 text-red-200"}`}
            >
              {notice.text}
            </p>
          ) : null}
          <p className="text-xs leading-5 text-slate-500">{data?.basis}</p>
        </div>
      </div>
    </section>
  );
}
