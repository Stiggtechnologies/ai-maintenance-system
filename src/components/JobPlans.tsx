/**
 * JobPlans — executable job plans and planning accuracy
 * (capability register C8.07, C4.05, C6.14).
 *
 * The spec is explicit about what makes a job plan executable rather than a
 * title: scope, sequence, labour, duration, materials, tools, permits,
 * isolations, quality checks and acceptance criteria. All ten are modelled, and
 * two rules are enforced in the database rather than suggested here:
 *
 *   * a plan cannot be ADOPTED without at least one acceptance criterion — a
 *     plan whose completion cannot be verified is a to-do list;
 *   * only an ADOPTED plan can be applied to real work.
 *
 * Planning accuracy shows absolute error AND bias, never one average. A job
 * estimated at 4 h that took 8 and one estimated at 8 h that took 4 average to
 * zero variance — perfect-looking planning, two wrecked shifts.
 *
 * Authoring, adoption and application are product acts on this surface.
 * Saving a draft is not authorization. Revising an adopted plan writes the
 * next version as a draft and leaves the adopted plan in force. The Planning
 * agent may draft from exact evidence, but it cannot authorize a plan here.
 */
import { useState } from "react";
import { Bot, ClipboardList, ShieldAlert, Target } from "lucide-react";
import { Link } from "react-router-dom";
import { useAsyncData } from "../hooks/useAsyncData";
import { useAuth } from "./AuthProvider";
import { LoadingState, ErrorState } from "./ui/AsyncStates";
import { JobPlanEditor } from "./JobPlanEditor";
import {
  adoptJobPlan,
  applyJobPlan,
  canAuthorJobPlans,
  draftFromDetail,
  emptyDraft,
  getJobPlanDetail,
  getPlanningAccuracy,
  listJobPlanDocuments,
  listJobPlans,
  listMaterials,
  listOpenWorkOrders,
  runPlanningAgent,
  upsertJobPlan,
  type DocumentOption,
  type JobPlanDraft,
  type JobPlanSummary,
  type MaterialOption,
  type PlanningAgentResult,
  type WorkOrderOption,
} from "../services/jobPlanService";

type Mode =
  | { kind: "idle" }
  | {
      kind: "author";
      draft: JobPlanDraft;
      existingKey: boolean;
      asNewVersion: boolean;
    }
  | { kind: "adopt"; plan: JobPlanSummary }
  | { kind: "apply"; plan: JobPlanSummary };

export function JobPlans() {
  const { profile } = useAuth();
  const canAuthor = canAuthorJobPlans(profile?.role as string | undefined);

  const plans = useAsyncData(listJobPlans, []);
  const acc = useAsyncData(getPlanningAccuracy, []);
  const materials = useAsyncData(listMaterials, []);
  const documents = useAsyncData(listJobPlanDocuments, []);
  const workOrders = useAsyncData(listOpenWorkOrders, []);

  const [mode, setMode] = useState<Mode>({ kind: "idle" });
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [adoptNote, setAdoptNote] = useState("");
  const [workOrderId, setWorkOrderId] = useState("");
  const [plannerWorkOrderId, setPlannerWorkOrderId] = useState("");
  const [planningResult, setPlanningResult] =
    useState<PlanningAgentResult | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  if (plans.loading || acc.loading)
    return <LoadingState label="Loading job plans" />;
  if (plans.error)
    return <ErrorState message={plans.error} onRetry={plans.refetch} />;

  const list = plans.data?.plans ?? [];
  const adopted = list.filter((p) => p.status === "adopted").length;
  const a = acc.data;
  const catalogue: MaterialOption[] = materials.data ?? [];
  const documentOptions: DocumentOption[] = documents.data ?? [];
  const openWork: WorkOrderOption[] = workOrders.data ?? [];
  const canRunPlanningAgent = [
    "planner",
    "reliability_engineer",
    "maintenance_manager",
    "admin",
  ].includes(profile?.role as string);

  const refresh = () => {
    plans.refetch();
    acc.refetch();
    workOrders.refetch();
  };

  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    setFlash(null);
    setDetailError(null);
    try {
      setFlash(await fn());
      setMode({ kind: "idle" });
      setAdoptNote("");
      setWorkOrderId("");
      refresh();
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  };

  const openAuthor = async (plan?: JobPlanSummary, notice?: string) => {
    setFlash(notice ?? null);
    setDetailError(null);
    if (!plan) {
      setMode({
        kind: "author",
        draft: emptyDraft(),
        existingKey: false,
        asNewVersion: false,
      });
      return;
    }
    try {
      const detail = await getJobPlanDetail(plan.id);
      setMode({
        kind: "author",
        draft: draftFromDetail(detail),
        existingKey: true,
        asNewVersion: false,
      });
    } catch (e) {
      setDetailError(
        e instanceof Error ? e.message : "Could not load that plan.",
      );
    }
  };

  const openRevision = async (plan: JobPlanSummary) => {
    const openDraft = list.find(
      (row) => row.plan_key === plan.plan_key && row.status === "draft",
    );
    if (openDraft) {
      await openAuthor(
        openDraft,
        `A draft of ${plan.plan_key} is already open. Edit that draft; another version was not created.`,
      );
      return;
    }
    setFlash(null);
    setDetailError(null);
    try {
      const detail = await getJobPlanDetail(plan.id);
      setMode({
        kind: "author",
        draft: draftFromDetail(detail),
        existingKey: true,
        asNewVersion: true,
      });
    } catch (e) {
      setDetailError(
        e instanceof Error ? e.message : "Could not load that plan.",
      );
    }
  };

  const runAgent = async () => {
    if (!plannerWorkOrderId) return;
    setBusy(true);
    setFlash(null);
    setDetailError(null);
    setPlanningResult(null);
    try {
      const result = await runPlanningAgent(plannerWorkOrderId);
      setPlanningResult(result);
      refresh();
      const detail = await getJobPlanDetail(result.job_plan_id);
      setMode({
        kind: "author",
        draft: draftFromDetail(detail),
        existingKey: true,
        asNewVersion: false,
      });
      setFlash(
        result.draft_created
          ? `Planning agent created one non-authoritative draft and found ${result.gaps.length} readiness gap(s). Review and edit it below; adoption remains a separate named-human act.`
          : `Planning agent assessed the existing plan without overwriting it and found ${result.gaps.length} readiness gap(s).`,
      );
    } catch (e) {
      setDetailError(
        e instanceof Error ? e.message : "Planning agent run failed.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="jobplans-heading" className="space-y-4">
      <div>
        <h2
          id="jobplans-heading"
          className="flex items-center gap-2 text-lg font-semibold text-white"
        >
          <ClipboardList className="h-5 w-5 text-signal-cyan" aria-hidden />
          Job Plans
          <span className="text-xs font-normal text-slate-500">
            {adopted} adopted of {list.length}
          </span>
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-300">
          {plans.data?.note}
        </p>
      </div>

      <div
        data-testid="job-plan-honesty"
        className="rounded-xl border border-white/8 bg-industrial-black/60 px-4 py-3 text-sm text-slate-400"
      >
        Saving a draft writes a proposal. It does not authorize work. Revising
        an adopted plan writes the next version as a draft and leaves the
        adopted plan in force. Adoption records the signed-in person and is
        refused without a sequenced step and a quality check that states an
        acceptance criterion. Only an adopted plan may be applied to a work
        order. The Planning agent may create a traceable draft and identify
        missing inputs; it cannot adopt, apply, release, spend, or return
        equipment to service.
      </div>

      <div className="space-y-3 rounded-xl border border-signal-cyan/20 bg-signal-cyan/5 p-4">
        <div className="flex items-start gap-3">
          <Bot
            className="mt-0.5 h-5 w-5 shrink-0 text-signal-cyan"
            aria-hidden
          />
          <div>
            <h3 className="text-sm font-semibold text-slate-100">
              Planning &amp; Scheduling agent
            </h3>
            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-400">
              Reads one tenant work order, its tasks, material demand, asset
              context, adopted reference plans and indexed documents. It may
              create one canonical draft from exact recorded content and list
              what is missing. It never invents planning content or grants
              execution authority.
            </p>
          </div>
        </div>
        {canRunPlanningAgent ? (
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-72 flex-1 md:max-w-xl">
              <span className="mb-1 block text-xs font-medium text-slate-400">
                Work order to assess
              </span>
              <select
                aria-label="Work order for Planning agent"
                value={plannerWorkOrderId}
                onChange={(e) => setPlannerWorkOrderId(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-industrial-black px-3 py-2 text-sm text-slate-200"
              >
                <option value="">Select an open work order…</option>
                {openWork.map((wo) => (
                  <option key={wo.id} value={wo.id}>
                    {wo.wo_number || wo.id.slice(0, 8)} — {wo.title}
                    {wo.job_plan_id ? " (plan attached)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={busy || !plannerWorkOrderId}
              onClick={runAgent}
              className="rounded-lg border border-signal-cyan/40 bg-signal-cyan/10 px-3 py-2 text-sm text-signal-cyan disabled:opacity-50"
            >
              Run Planning agent
            </button>
          </div>
        ) : (
          <p className="text-xs text-slate-500">
            Running this agent requires a named planner, reliability engineer,
            maintenance manager, or admin. Its control profile must also bind
            both the draft-plan and material/document-check rights and tools.
          </p>
        )}
        {planningResult && <PlanningAgentReading result={planningResult} />}
      </div>

      <div className="rounded-xl border border-white/6 bg-overlook-deep/40 p-4">
        <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-slate-400">
          <Target className="h-3.5 w-3.5" aria-hidden />
          Planning accuracy
        </p>
        {a?.available ? (
          <>
            <div className="mt-2 flex flex-wrap items-baseline gap-x-6 gap-y-1">
              <span className="font-mono text-2xl text-slate-100">
                {a.mean_absolute_error_pct}
                <span className="ml-1 text-sm text-slate-500">
                  % mean absolute error
                </span>
              </span>
              <span
                className={`font-mono text-lg ${Math.abs(a.bias_pct ?? 0) > 10 ? "text-amber-300" : "text-slate-300"}`}
              >
                {(a.bias_pct ?? 0) > 0 ? "+" : ""}
                {a.bias_pct}
                <span className="ml-1 text-xs text-slate-500">% bias</span>
              </span>
              <span className="font-mono text-sm text-slate-400">
                {a.within_10_pct}%
                <span className="ml-1 text-xs text-slate-500">within ±10%</span>
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-400">{a.bias_reading}</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              Error and bias are shown separately on purpose: a job estimated at
              4 h that took 8, and one estimated at 8 h that took 4, average to
              zero variance — perfect-looking planning and two wrecked shifts.
            </p>
          </>
        ) : (
          <p className="mt-1.5 text-sm text-slate-400">{a?.basis}</p>
        )}
      </div>

      {flash && (
        <div
          role="status"
          className="rounded-lg border border-white/10 bg-industrial-black px-4 py-3 text-sm text-slate-300"
        >
          {flash}
        </div>
      )}
      {detailError && (
        <div
          role="alert"
          className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300"
        >
          {detailError}
        </div>
      )}

      {canAuthor ? (
        <div className="flex flex-wrap gap-2">
          {mode.kind === "idle" && (
            <button
              type="button"
              onClick={() => openAuthor()}
              className="rounded-lg border border-teal-500/40 bg-teal-500/10 px-3 py-2 text-sm text-teal-300"
            >
              Author a plan
            </button>
          )}
        </div>
      ) : (
        <p className="text-xs text-slate-500">
          Authoring and adoption require a planner, reliability engineer,
          maintenance manager, or admin role. The database refuses other roles.
        </p>
      )}

      {mode.kind === "author" && (
        <JobPlanEditor
          draft={mode.draft}
          catalogue={catalogue}
          documents={documentOptions}
          busy={busy}
          planKeyLocked={mode.existingKey}
          revising={mode.asNewVersion}
          onChange={(draft) =>
            setMode({
              kind: "author",
              draft,
              existingKey: mode.existingKey,
              asNewVersion: mode.asNewVersion,
            })
          }
          onCancel={() => setMode({ kind: "idle" })}
          onSave={() =>
            run(async () => {
              if (mode.kind !== "author") return "";
              const revising = mode.asNewVersion;
              const result = await upsertJobPlan(
                mode.draft,
                catalogue,
                revising ? { asNewVersion: true } : undefined,
              );
              const version =
                result.version != null ? ` version ${result.version}` : "";
              return revising
                ? `Draft${version} saved (${result.plan_key}, ${result.steps} step(s)). The adopted plan is unchanged until a named person adopts this draft.`
                : `Draft saved (${result.plan_key}${version}, ${result.steps} step(s)). Adoption is a separate named-human act.`;
            })
          }
        />
      )}

      {mode.kind === "adopt" && (
        <div className="space-y-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
          <p className="text-sm text-slate-200">
            Adopt “{mode.plan.title}” ({mode.plan.plan_key} v{mode.plan.version}
            ). This records you as the adopting human. A draft with no steps or
            no acceptance criterion will be refused.
          </p>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-400">
              Adoption basis (required — at least 10 characters)
            </span>
            <textarea
              aria-label="Adoption basis"
              value={adoptNote}
              onChange={(e) => setAdoptNote(e.target.value)}
              rows={3}
              placeholder="Why this plan is executable and may be applied to real work."
              className="w-full rounded-lg border border-white/10 bg-industrial-black px-3 py-2 text-sm text-slate-200"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || adoptNote.trim().length < 10}
              onClick={() =>
                run(async () => {
                  const result = await adoptJobPlan(mode.plan.id, adoptNote);
                  return `Adopted. ${result.steps} step(s), ${result.checks} check(s). It may now be applied to a work order.`;
                })
              }
              className="rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm text-amber-200 disabled:opacity-50"
            >
              Adopt plan
            </button>
            <button
              type="button"
              onClick={() => {
                setMode({ kind: "idle" });
                setAdoptNote("");
              }}
              className="rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-300"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {mode.kind === "apply" && (
        <div className="space-y-3 rounded-xl border border-teal-500/20 bg-teal-500/5 p-4">
          <p className="text-sm text-slate-200">
            Apply adopted plan “{mode.plan.title}” to an open work order. Drafts
            are not offered — the database refuses them on real work.
          </p>
          {openWork.length === 0 ? (
            <p className="text-xs text-slate-500">
              No open work orders are visible. Apply is also available on a work
              order&apos;s Tasks tab once one exists.
            </p>
          ) : (
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-400">
                Work order
              </span>
              <select
                aria-label="Work order to apply plan"
                value={workOrderId}
                onChange={(e) => setWorkOrderId(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-industrial-black px-3 py-2 text-sm text-slate-200 md:max-w-lg"
              >
                <option value="">Select a work order…</option>
                {openWork.map((wo) => (
                  <option key={wo.id} value={wo.id}>
                    {wo.wo_number || wo.id.slice(0, 8)} — {wo.title}
                    {wo.job_plan_id ? " (already has a plan)" : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || !workOrderId}
              onClick={() =>
                run(async () => {
                  const result = await applyJobPlan(
                    workOrderId,
                    mode.plan.plan_key,
                  );
                  return (
                    `Applied to work order: ${result.tasks_created} task(s), ${result.planned_hours}h planned, ${result.materials_requested} material demand(s)` +
                    (result.schedule_approval_required
                      ? ". Permits required — the work order is safety-flagged and parked in approval until an independent maintenance manager approves its schedule."
                      : result.safety_flagged
                        ? ". Permits required — the work order is now safety-flagged."
                      : ".")
                  );
                })
              }
              className="rounded-lg border border-teal-500/40 bg-teal-500/10 px-3 py-2 text-sm text-teal-300 disabled:opacity-50"
            >
              Apply to work order
            </button>
            <button
              type="button"
              onClick={() => {
                setMode({ kind: "idle" });
                setWorkOrderId("");
              }}
              className="rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-300"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {list.length === 0 && mode.kind === "idle" ? (
        <p className="rounded-xl border border-white/6 bg-white/2 p-4 text-sm text-slate-400">
          No job plan has been authored. A plan carries scope, sequence, labour,
          duration, materials, tools, permits, isolations and acceptance
          criteria — the last of which is what makes it verifiable. This list is
          empty because none have been written, not because a demo library is
          hidden.
        </p>
      ) : list.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-white/6">
          <table className="w-full min-w-[50rem] text-left text-sm">
            <caption className="sr-only">
              Job plans with their content and adoption state
            </caption>
            <thead className="bg-white/2 text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">
                  Plan
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Applies to
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Steps
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Hours
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Content
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Used
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  State
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Acts
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.id} className="border-t border-white/6 align-top">
                  <td className="px-4 py-2.5">
                    <p className="text-slate-200">{p.title}</p>
                    <p className="font-mono text-[11px] text-slate-500">
                      {p.plan_key} v{p.version}
                    </p>
                  </td>
                  <td className="px-4 py-2.5 text-slate-400">{p.applies_to}</td>
                  <td className="px-4 py-2.5 font-mono text-slate-300 tabular-nums">
                    {p.steps}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-slate-300 tabular-nums">
                    {p.estimated_hours}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-400">
                    {p.materials}m · {p.tools}t · {p.documents ?? 0}d ·{" "}
                    {p.permits > 0 ? (
                      <span className="inline-flex items-center gap-0.5 text-amber-300">
                        <ShieldAlert className="h-3 w-3" aria-hidden />
                        {p.permits} permit{p.permits > 1 ? "s" : ""}
                      </span>
                    ) : (
                      "no permit"
                    )}{" "}
                    ·{" "}
                    <span className={p.checks === 0 ? "text-red-300" : ""}>
                      {p.checks} check{p.checks === 1 ? "" : "s"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-slate-300 tabular-nums">
                    {p.applied_to_work_orders}
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs ${
                        p.status === "adopted"
                          ? "border-green-500/30 bg-green-500/10 text-green-300"
                          : "border-amber-500/30 bg-amber-500/10 text-amber-300"
                      }`}
                    >
                      {p.status}
                    </span>
                    {p.draft_origin === "agent" && (
                      <span className="ml-1 rounded-full border border-signal-cyan/30 bg-signal-cyan/10 px-2 py-0.5 text-xs text-signal-cyan">
                        agent draft
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <PlanActs
                      plan={p}
                      canAuthor={canAuthor}
                      onEdit={() => openAuthor(p)}
                      onRevise={() => openRevision(p)}
                      onAdopt={() => {
                        setAdoptNote("");
                        setMode({ kind: "adopt", plan: p });
                      }}
                      onApply={() => {
                        setWorkOrderId("");
                        setMode({ kind: "apply", plan: p });
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <p className="text-xs text-slate-600">
        Apply is also available on a work order&apos;s Tasks tab via{" "}
        <Link to="/work" className="text-signal-cyan underline">
          Work
        </Link>
        . An adopted plan is not edited in place. Revise writes the next version
        as a draft through upsert_job_plan; that draft has no execution
        authority, and the adopted plan remains the one that may be applied
        until a named person adopts the draft. An unresolved material code
        refuses the save and nothing is written.
      </p>
    </section>
  );
}

function PlanningAgentReading({ result }: { result: PlanningAgentResult }) {
  return (
    <div
      data-testid="planning-agent-reading"
      className="space-y-3 rounded-lg border border-white/8 bg-industrial-black/60 p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-slate-200">
          Retained run {result.run_id.slice(0, 8)} · {result.gaps.length} gap(s)
        </p>
        <span className="text-xs text-amber-300">
          Human adoption required · no release authority
        </span>
      </div>
      {result.gaps.length === 0 ? (
        <p className="text-xs text-green-300">
          No structural readiness gap was found in the recorded context. A named
          human must still verify and adopt the plan.
        </p>
      ) : (
        <ul className="grid gap-2 md:grid-cols-2">
          {result.gaps.map((gap) => (
            <li
              key={gap.code}
              className={`rounded-lg border px-3 py-2 text-xs ${
                gap.severity === "blocker"
                  ? "border-red-500/20 bg-red-500/5 text-red-200"
                  : "border-amber-500/20 bg-amber-500/5 text-amber-100"
              }`}
            >
              <span className="font-semibold">{gap.label}:</span> {gap.detail}
            </li>
          ))}
        </ul>
      )}
      {result.materials.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium text-slate-300">
            Material readiness
          </p>
          <ul className="space-y-1 text-xs text-slate-400">
            {result.materials.map((material) => (
              <li key={material.materialId}>
                <span
                  className={
                    material.ready ? "text-green-300" : "text-amber-300"
                  }
                >
                  {material.ready ? "Ready" : "Not ready"}
                </span>{" "}
                · {material.materialCode} · {material.quantityReserved}/
                {material.quantityRequired} reserved ·{" "}
                {material.workOrderStatus}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-[11px] leading-relaxed text-slate-500">
        {result.basis}
      </p>
    </div>
  );
}

function PlanActs({
  plan,
  canAuthor,
  onEdit,
  onRevise,
  onAdopt,
  onApply,
}: {
  plan: JobPlanSummary;
  canAuthor: boolean;
  onEdit: () => void;
  onRevise: () => void;
  onAdopt: () => void;
  onApply: () => void;
}) {
  if (plan.status === "adopted") {
    return (
      <div className="flex flex-wrap gap-1">
        {canAuthor && (
          <button
            type="button"
            onClick={onRevise}
            className="rounded-lg border border-amber-400/30 px-2 py-1 text-xs text-amber-200"
          >
            Revise
          </button>
        )}
        <button
          type="button"
          onClick={onApply}
          className="rounded-lg border border-teal-500/30 px-2 py-1 text-xs text-teal-300"
        >
          Apply
        </button>
      </div>
    );
  }
  if (!canAuthor) {
    return <span className="text-xs text-slate-600">draft</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      <button
        type="button"
        onClick={onEdit}
        className="rounded-lg border border-white/10 px-2 py-1 text-xs text-slate-300"
      >
        Edit
      </button>
      <button
        type="button"
        onClick={onAdopt}
        className="rounded-lg border border-amber-400/30 px-2 py-1 text-xs text-amber-200"
      >
        Adopt
      </button>
    </div>
  );
}
