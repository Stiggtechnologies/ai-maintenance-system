import { useEffect, useState } from "react";
import {
  RESOURCE_CATEGORIES,
  RESOURCE_CATEGORY_LABELS,
  type ResourceCategory,
} from "../lib/develop/workforce";
import type { P6XerResourceAssignment } from "../lib/p6-xer";
import { recordResourceDemand } from "../services/developService";

interface DemandDraft {
  category: ResourceCategory | "";
  demandHours: string;
  periodStart: string;
  periodEnd: string;
  basis: string;
  recordedId: number | null;
  message: string | null;
}

function isoDate(value: string | null): string {
  return value && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : "";
}

function exclusiveEnd(start: string, finish: string): string {
  if (!start || !finish || finish > start) return finish;
  const next = new Date(`${start}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

function newDraft(assignment: P6XerResourceAssignment): DemandDraft {
  const start = isoDate(assignment.plannedStart);
  const finish = isoDate(assignment.plannedFinish);
  return {
    // P6's RT_Labor/RT_Nonlabor distinction does not identify one of SyncAI's
    // nine governed categories. Leaving this blank prevents a plausible but
    // false mapping (for example, treating every labour row as a trade).
    category: "",
    // A P6 quantity is not necessarily hours. The detected value is shown
    // beside the field, but a person must state the hour quantity explicitly.
    demandHours: "",
    periodStart: start,
    periodEnd: exclusiveEnd(start, finish),
    basis: "",
    recordedId: null,
    message: null,
  };
}

export function P6ResourceDemandReview({
  caseId,
  assignments,
  scheduleReady,
}: {
  caseId: string;
  assignments: P6XerResourceAssignment[];
  scheduleReady: boolean;
}) {
  const [drafts, setDrafts] = useState<DemandDraft[]>([]);
  const [busyIndex, setBusyIndex] = useState<number | null>(null);

  useEffect(() => {
    setDrafts(assignments.map(newDraft));
  }, [assignments]);

  if (assignments.length === 0) return null;

  function patchDraft(index: number, patch: Partial<DemandDraft>) {
    setDrafts((current) =>
      current.map((draft, draftIndex) =>
        draftIndex === index ? { ...draft, ...patch } : draft,
      ),
    );
  }

  async function record(index: number) {
    const assignment = assignments[index];
    const draft = drafts[index];
    const hours = Number(draft.demandHours);
    if (!caseId.trim()) {
      patchDraft(index, {
        message:
          "A Development Case UUID is required to record canonical demand; a title is not a stable database identity.",
      });
      return;
    }
    if (!draft.category) {
      patchDraft(index, {
        message:
          "Choose one of SyncAI's nine resource categories; P6 resource type is not enough to infer it.",
      });
      return;
    }
    if (!Number.isFinite(hours) || hours <= 0) {
      patchDraft(index, {
        message:
          "State a finite positive hour quantity. SyncAI does not assume the P6 quantity is hours.",
      });
      return;
    }
    if (
      !draft.periodStart ||
      !draft.periodEnd ||
      draft.periodEnd <= draft.periodStart
    ) {
      patchDraft(index, {
        message: "State a demand window whose end is after its start.",
      });
      return;
    }
    if (draft.basis.trim().length < 20) {
      patchDraft(index, {
        message:
          "State the source and conversion basis in at least 20 characters.",
      });
      return;
    }

    setBusyIndex(index);
    patchDraft(index, { message: null });
    try {
      const result = await recordResourceDemand(caseId.trim(), {
        category: draft.category,
        pool: assignment.resourceName || assignment.resourceId,
        demandHours: draft.demandHours,
        periodStart: draft.periodStart,
        periodEnd: draft.periodEnd,
        sourceKind: "estimate",
        basis: `P6 XER assignment ${assignment.activityId}: ${draft.basis.trim()}`,
      });
      patchDraft(index, {
        recordedId: result.answered ? (result.demandId ?? null) : null,
        message: result.answered
          ? `Recorded as unapproved demand${result.demandId ? ` #${result.demandId}` : ""}. A human approval is still required before portfolio commitment.`
          : (result.refusal ?? "The demand line was refused."),
      });
    } catch (error) {
      patchDraft(index, {
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusyIndex(null);
    }
  }

  return (
    <section className="mt-3 rounded-lg border border-amber-400/15 bg-amber-400/[0.04] p-4">
      <h4 className="text-xs font-medium text-amber-100">
        P6 resource assignments — review before demand
      </h4>
      <p className="mt-1 text-xs leading-relaxed text-slate-400">
        P6 supplied {assignments.length} assignment(s). SyncAI will not infer a
        governed category or convert a P6 quantity into hours. Review each row,
        then record it into the canonical ResourceDemand ledger. Recording is
        evidence assembly only; approval remains a separate human act.
      </p>
      {!scheduleReady && (
        <p className="mt-2 text-xs text-amber-200">
          Finish the schedule import without refused rows before recording its
          resource evidence.
        </p>
      )}

      <div className="mt-3 space-y-3">
        {assignments.map((assignment, index) => {
          const draft = drafts[index] ?? newDraft(assignment);
          const detected =
            assignment.remainingUnits ?? assignment.plannedUnits ?? null;
          const key = `${assignment.activityId}:${assignment.resourceId}:${index}`;
          return (
            <div
              key={key}
              className="rounded-lg border border-white/8 bg-overlook-void/45 p-3"
            >
              <p className="text-xs text-slate-300">
                <span className="font-mono">{assignment.activityId}</span> ·{" "}
                {assignment.resourceName || assignment.resourceId}
              </p>
              <p className="mt-1 text-[11px] text-slate-500">
                P6 type {assignment.resourceType || "unstated"} · detected
                quantity {detected ?? "unstated"}{" "}
                {assignment.sourceUnit || "(unit unstated)"}
              </p>
              <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-5">
                <select
                  aria-label={`${assignment.activityId} resource category`}
                  value={draft.category}
                  onChange={(event) =>
                    patchDraft(index, {
                      category: event.target.value as ResourceCategory | "",
                    })
                  }
                  disabled={draft.recordedId !== null}
                  className="rounded border border-white/10 bg-overlook-void px-2 py-2 text-xs text-slate-200"
                >
                  <option value="">Choose governed category</option>
                  {RESOURCE_CATEGORIES.map((category) => (
                    <option key={category} value={category}>
                      {RESOURCE_CATEGORY_LABELS[category]}
                    </option>
                  ))}
                </select>
                <input
                  aria-label={`${assignment.activityId} demand hours`}
                  value={draft.demandHours}
                  onChange={(event) =>
                    patchDraft(index, { demandHours: event.target.value })
                  }
                  inputMode="decimal"
                  placeholder="Demand hours (verified)"
                  disabled={draft.recordedId !== null}
                  className="rounded border border-white/10 bg-overlook-void px-2 py-2 text-xs text-slate-200"
                />
                <input
                  aria-label={`${assignment.activityId} demand start`}
                  type="date"
                  value={draft.periodStart}
                  onChange={(event) =>
                    patchDraft(index, { periodStart: event.target.value })
                  }
                  disabled={draft.recordedId !== null}
                  className="rounded border border-white/10 bg-overlook-void px-2 py-2 text-xs text-slate-200"
                />
                <input
                  aria-label={`${assignment.activityId} demand end`}
                  type="date"
                  value={draft.periodEnd}
                  onChange={(event) =>
                    patchDraft(index, { periodEnd: event.target.value })
                  }
                  disabled={draft.recordedId !== null}
                  className="rounded border border-white/10 bg-overlook-void px-2 py-2 text-xs text-slate-200"
                />
                <input
                  aria-label={`${assignment.activityId} demand basis`}
                  value={draft.basis}
                  onChange={(event) =>
                    patchDraft(index, { basis: event.target.value })
                  }
                  placeholder="Hour conversion/source basis"
                  disabled={draft.recordedId !== null}
                  className="rounded border border-white/10 bg-overlook-void px-2 py-2 text-xs text-slate-200"
                />
              </div>
              <button
                type="button"
                disabled={
                  !scheduleReady ||
                  busyIndex !== null ||
                  draft.recordedId !== null
                }
                onClick={() => void record(index)}
                className="mt-2 rounded-lg border border-amber-300/30 bg-amber-300/5 px-3 py-1.5 text-xs text-amber-100 disabled:opacity-50"
              >
                {draft.recordedId !== null
                  ? "Recorded — awaiting human approval"
                  : busyIndex === index
                    ? "Recording…"
                    : "Record as unapproved demand"}
              </button>
              {draft.message && (
                <p className="mt-2 text-xs leading-relaxed text-slate-400">
                  {draft.message}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
