import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CircleCheck,
  ClipboardCheck,
  LockKeyhole,
  Plus,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import {
  createEthicalBoundaryReview,
  getEthicalBoundaryWorkspace,
  reviewEthicalBoundaries,
  setEthicalBoundaryDetermination,
  submitEthicalBoundaryReview,
  type EthicalBoundaryDefinition,
  type EthicalBoundaryDetermination,
  type EthicalBoundaryOutcome,
  type EthicalBoundaryReview,
} from "../services/ethicalBoundaryService";
import { ErrorState, LoadingState } from "./ui/AsyncStates";

interface DeterminationDraft {
  outcome: EthicalBoundaryOutcome;
  controlDescription: string;
  verificationProcedure: string;
  evidenceItemId: string;
  accountableOwnerId: string;
  remediation: string;
}

const emptyDetermination = (): DeterminationDraft => ({
  outcome: "enforced",
  controlDescription: "",
  verificationProcedure: "",
  evidenceItemId: "",
  accountableOwnerId: "",
  remediation: "",
});

function toDraft(
  determination?: EthicalBoundaryDetermination,
): DeterminationDraft {
  if (!determination) return emptyDetermination();
  return {
    outcome: determination.outcome,
    controlDescription: determination.controlDescription,
    verificationProcedure: determination.verificationProcedure,
    evidenceItemId: determination.evidenceItemId,
    accountableOwnerId: determination.accountableOwnerId,
    remediation: determination.remediation ?? "",
  };
}

function statusTone(status: EthicalBoundaryReview["status"]): string {
  if (status === "adopted")
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
  if (status === "review_pending")
    return "border-signal-cyan/30 bg-signal-cyan/10 text-signal-cyan";
  if (status === "remediation_required")
    return "border-amber-500/30 bg-amber-500/10 text-amber-200";
  if (status === "rejected")
    return "border-rose-500/30 bg-rose-500/10 text-rose-200";
  return "border-white/10 bg-white/5 text-slate-300";
}

function BoundaryCard({
  boundary,
  determination,
  editable,
  draft,
  onDraft,
}: {
  boundary: EthicalBoundaryDefinition;
  determination?: EthicalBoundaryDetermination;
  editable: boolean;
  draft: DeterminationDraft;
  onDraft: (patch: Partial<DeterminationDraft>) => void;
}) {
  const complete = Boolean(determination);
  const hasGap = determination?.outcome === "gap";

  return (
    <details className="rounded-xl border border-white/8 bg-[#0D1520] open:border-signal-cyan/20">
      <summary className="flex cursor-pointer list-none items-start gap-3 p-4">
        <div
          className={`mt-0.5 rounded-lg p-2 ${
            hasGap
              ? "bg-amber-500/10 text-amber-300"
              : complete
                ? "bg-emerald-500/10 text-emerald-300"
                : "bg-white/5 text-slate-400"
          }`}
        >
          {hasGap ? (
            <AlertTriangle className="h-4 w-4" />
          ) : (
            <ShieldCheck className="h-4 w-4" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-sm font-semibold text-white">
              {boundary.title}
            </h4>
            <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-500">
              {boundary.controlFamily.replace(/_/g, " ")}
            </span>
            <span
              className={`text-xs ${
                hasGap
                  ? "text-amber-300"
                  : complete
                    ? "text-emerald-300"
                    : "text-slate-500"
              }`}
            >
              {hasGap ? "Gap" : complete ? "Enforced" : "Not assessed"}
            </span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">
            {boundary.prohibition}
          </p>
        </div>
      </summary>

      <div className="space-y-4 border-t border-white/6 p-4">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border border-white/6 bg-white/[0.02] p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Required verification
            </p>
            <p className="mt-1 text-xs leading-relaxed text-slate-300">
              {boundary.verificationRequirement}
            </p>
          </div>
          <div className="rounded-lg border border-white/6 bg-white/[0.02] p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Existing platform control
            </p>
            <p className="mt-1 text-xs leading-relaxed text-slate-300">
              {boundary.platformControlReference}
            </p>
          </div>
        </div>

        {editable ? (
          <div className="space-y-3">
            <label className="block text-xs text-slate-300">
              Determination
              <select
                value={draft.outcome}
                onChange={(event) =>
                  onDraft({
                    outcome: event.target.value as EthicalBoundaryOutcome,
                  })
                }
                className="mt-1 w-full rounded-lg border border-white/10 bg-[#08111b] px-3 py-2 text-sm text-white"
              >
                <option value="enforced">Enforced</option>
                <option value="gap">Gap requiring remediation</option>
              </select>
            </label>
            <label className="block text-xs text-slate-300">
              Implemented control
              <textarea
                value={draft.controlDescription}
                onChange={(event) =>
                  onDraft({ controlDescription: event.target.value })
                }
                rows={3}
                placeholder="Describe the implemented control and its exact scope."
                className="mt-1 w-full rounded-lg border border-white/10 bg-[#08111b] px-3 py-2 text-sm text-white placeholder:text-slate-600"
              />
            </label>
            <label className="block text-xs text-slate-300">
              Verification procedure
              <textarea
                value={draft.verificationProcedure}
                onChange={(event) =>
                  onDraft({
                    verificationProcedure: event.target.value,
                  })
                }
                rows={3}
                placeholder="Explain how a reviewer can reproduce the control check."
                className="mt-1 w-full rounded-lg border border-white/10 bg-[#08111b] px-3 py-2 text-sm text-white placeholder:text-slate-600"
              />
            </label>
            {draft.outcome === "gap" && (
              <label className="block text-xs text-slate-300">
                Required remediation
                <textarea
                  value={draft.remediation}
                  onChange={(event) =>
                    onDraft({ remediation: event.target.value })
                  }
                  rows={2}
                  placeholder="State the specific control change needed to close this gap."
                  className="mt-1 w-full rounded-lg border border-amber-500/20 bg-[#08111b] px-3 py-2 text-sm text-white placeholder:text-slate-600"
                />
              </label>
            )}
          </div>
        ) : determination ? (
          <div className="grid gap-3 text-xs md:grid-cols-2">
            <div>
              <p className="font-semibold text-slate-400">Control</p>
              <p className="mt-1 leading-relaxed text-slate-200">
                {determination.controlDescription}
              </p>
            </div>
            <div>
              <p className="font-semibold text-slate-400">Verification</p>
              <p className="mt-1 leading-relaxed text-slate-200">
                {determination.verificationProcedure}
              </p>
            </div>
            <div>
              <p className="font-semibold text-slate-400">Accountable owner</p>
              <p className="mt-1 text-slate-200">
                {determination.accountableOwner}
              </p>
            </div>
            {determination.remediation && (
              <div>
                <p className="font-semibold text-amber-300">Remediation</p>
                <p className="mt-1 leading-relaxed text-amber-100/80">
                  {determination.remediation}
                </p>
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-slate-500">
            No determination was recorded for this version.
          </p>
        )}
      </div>
    </details>
  );
}

export function EthicalBoundariesPanel() {
  const { data, loading, error, refetch } =
    useAsyncData(getEthicalBoundaryWorkspace, []);
  const [selectedReviewId, setSelectedReviewId] = useState("");
  const [drafts, setDrafts] = useState<Record<string, DeterminationDraft>>({});
  const [action, setAction] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [submissionBasis, setSubmissionBasis] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  const [newReview, setNewReview] = useState({
    title: "",
    scope: "",
    purpose: "",
    effectiveOn: "",
    nextReviewOn: "",
  });

  useEffect(() => {
    if (!data?.reviews.length || selectedReviewId) return;
    const initial =
      data.reviews.find((review) =>
        ["draft", "remediation_required", "review_pending"].includes(
          review.status,
        ),
      ) ?? data.reviews[0];
    setSelectedReviewId(initial.id);
  }, [data, selectedReviewId]);

  const selectedReview = useMemo(
    () => data?.reviews.find((review) => review.id === selectedReviewId) ?? null,
    [data, selectedReviewId],
  );
  const editable = Boolean(
    selectedReview &&
      ["draft", "remediation_required"].includes(selectedReview.status),
  );

  useEffect(() => {
    if (!data || !selectedReview) return;
    const next: Record<string, DeterminationDraft> = {};
    for (const boundary of data.boundaries) {
      next[boundary.key] = toDraft(
        selectedReview.determinations.find(
          (item) => item.boundaryKey === boundary.key,
        ),
      );
    }
    setDrafts(next);
  }, [data, selectedReview]);

  const runAction = async (key: string, task: () => Promise<unknown>) => {
    setAction(key);
    setMessage(null);
    setActionError(null);
    try {
      await task();
      setMessage("Governed ethical-boundary record updated.");
      await refetch();
    } catch (caught) {
      setActionError(
        caught instanceof Error ? caught.message : "The governed action failed.",
      );
    } finally {
      setAction(null);
    }
  };

  if (loading) return <LoadingState label="Loading ethical boundaries" />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;
  if (!data) return null;

  const current = data.reviews.find((review) => review.current);
  const determined = selectedReview?.determinations.length ?? 0;
  const gaps =
    selectedReview?.determinations.filter((item) => item.outcome === "gap")
      .length ?? 0;

  return (
    <section aria-labelledby="ethical-boundaries-heading" className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            id="ethical-boundaries-heading"
            className="flex items-center gap-2 text-lg font-semibold text-white"
          >
            <LockKeyhole className="h-5 w-5 text-signal-cyan" />
            Explicit ethical boundaries
          </h2>
          <p className="mt-1 max-w-4xl text-sm text-slate-300">
            Nine prohibitions, each tied to a named owner, independently
            verified canonical evidence, a reproducible check and independent
            human adoption.
          </p>
        </div>
        <span
          className={`rounded-full border px-3 py-1 text-xs font-semibold ${
            current
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
              : "border-amber-500/30 bg-amber-500/10 text-amber-200"
          }`}
        >
          {current ? "Current adopted posture" : "No current adopted posture"}
        </span>
      </div>

      <div className="rounded-xl border border-white/8 bg-white/[0.02] p-4 text-xs leading-relaxed text-slate-400">
        {data.basis}
      </div>

      {message && (
        <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
          {message}
        </div>
      )}
      {actionError && (
        <div className="rounded-lg border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          {actionError}
        </div>
      )}

      <details className="rounded-xl border border-white/8 bg-[#0D1520]">
        <summary className="flex cursor-pointer list-none items-center gap-2 p-4 text-sm font-semibold text-white">
          <Plus className="h-4 w-4 text-signal-cyan" /> Create a governed review
        </summary>
        <div className="grid gap-3 border-t border-white/6 p-4 md:grid-cols-2">
          <label className="text-xs text-slate-300">
            Review title
            <input
              value={newReview.title}
              onChange={(event) =>
                setNewReview({ ...newReview, title: event.target.value })
              }
              className="mt-1 w-full rounded-lg border border-white/10 bg-[#08111b] px-3 py-2 text-sm text-white"
            />
          </label>
          <label className="text-xs text-slate-300">
            Purpose
            <input
              value={newReview.purpose}
              onChange={(event) =>
                setNewReview({ ...newReview, purpose: event.target.value })
              }
              className="mt-1 w-full rounded-lg border border-white/10 bg-[#08111b] px-3 py-2 text-sm text-white"
            />
          </label>
          <label className="text-xs text-slate-300 md:col-span-2">
            Scope
            <textarea
              value={newReview.scope}
              onChange={(event) =>
                setNewReview({ ...newReview, scope: event.target.value })
              }
              rows={2}
              className="mt-1 w-full rounded-lg border border-white/10 bg-[#08111b] px-3 py-2 text-sm text-white"
            />
          </label>
          <label className="text-xs text-slate-300">
            Effective on
            <input
              type="date"
              value={newReview.effectiveOn}
              onChange={(event) =>
                setNewReview({ ...newReview, effectiveOn: event.target.value })
              }
              className="mt-1 w-full rounded-lg border border-white/10 bg-[#08111b] px-3 py-2 text-sm text-white"
            />
          </label>
          <label className="text-xs text-slate-300">
            Review again on
            <input
              type="date"
              value={newReview.nextReviewOn}
              onChange={(event) =>
                setNewReview({ ...newReview, nextReviewOn: event.target.value })
              }
              className="mt-1 w-full rounded-lg border border-white/10 bg-[#08111b] px-3 py-2 text-sm text-white"
            />
          </label>
          <div className="md:col-span-2">
            <button
              type="button"
              disabled={action === "create"}
              onClick={() =>
                runAction("create", async () => {
                  const result = (await createEthicalBoundaryReview(
                    newReview,
                  )) as { reviewId?: string };
                  setNewReview({
                    title: "",
                    scope: "",
                    purpose: "",
                    effectiveOn: "",
                    nextReviewOn: "",
                  });
                  if (result.reviewId) setSelectedReviewId(result.reviewId);
                })
              }
              className="rounded-lg border border-signal-cyan/30 bg-signal-cyan/10 px-3 py-2 text-xs font-semibold text-signal-cyan disabled:opacity-50"
            >
              Create draft review
            </button>
          </div>
        </div>
      </details>

      {data.reviews.length > 0 && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-[18rem] flex-1 text-xs text-slate-300">
              Review version
              <select
                value={selectedReviewId}
                onChange={(event) => setSelectedReviewId(event.target.value)}
                className="mt-1 w-full rounded-lg border border-white/10 bg-[#08111b] px-3 py-2 text-sm text-white"
              >
                {data.reviews.map((review) => (
                  <option key={review.id} value={review.id}>
                    {review.title} · {review.status.replace(/_/g, " ")} · {review.effectiveOn}
                  </option>
                ))}
              </select>
            </label>
            {selectedReview && (
              <span
                className={`rounded-full border px-3 py-2 text-xs font-semibold ${statusTone(selectedReview.status)}`}
              >
                {selectedReview.status.replace(/_/g, " ")}
              </span>
            )}
          </div>

          {selectedReview && (
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-white/8 bg-[#0D1520] p-3">
                <p className="text-2xl font-black text-white">
                  {determined}/{data.boundaries.length}
                </p>
                <p className="text-xs text-slate-500">Determined</p>
              </div>
              <div className="rounded-xl border border-white/8 bg-[#0D1520] p-3">
                <p className="text-2xl font-black text-amber-300">{gaps}</p>
                <p className="text-xs text-slate-500">Open gaps</p>
              </div>
              <div className="rounded-xl border border-white/8 bg-[#0D1520] p-3">
                <p className="text-sm font-semibold text-white">
                  {selectedReview.nextReviewOn}
                </p>
                <p className="text-xs text-slate-500">Next review date</p>
              </div>
            </div>
          )}

          <div className="space-y-3">
            {data.boundaries.map((boundary) => {
              const determination = selectedReview?.determinations.find(
                (item) => item.boundaryKey === boundary.key,
              );
              const draft = drafts[boundary.key] ?? emptyDetermination();
              return (
                <div key={boundary.key} className="space-y-3">
                  <BoundaryCard
                    boundary={boundary}
                    determination={determination}
                    editable={editable}
                    draft={draft}
                    onDraft={(patch) =>
                      setDrafts((currentDrafts) => ({
                        ...currentDrafts,
                        [boundary.key]: {
                          ...(currentDrafts[boundary.key] ??
                            emptyDetermination()),
                          ...patch,
                        },
                      }))
                    }
                  />
                  {editable && (
                    <div className="-mt-2 grid gap-3 rounded-b-xl border-x border-b border-white/8 bg-[#0D1520] px-4 pb-4 md:grid-cols-2">
                      <label className="text-xs text-slate-300">
                        Independently verified evidence
                        <select
                          value={draft.evidenceItemId}
                          onChange={(event) =>
                            setDrafts((current) => ({
                              ...current,
                              [boundary.key]: {
                                ...(current[boundary.key] ??
                                  emptyDetermination()),
                                evidenceItemId: event.target.value,
                              },
                            }))
                          }
                          className="mt-1 w-full rounded-lg border border-white/10 bg-[#08111b] px-3 py-2 text-sm text-white"
                        >
                          <option value="">Select verified evidence…</option>
                          {data.verifiedEvidence.map((evidence) => (
                            <option key={evidence.id} value={evidence.id}>
                              {(evidence.description ?? evidence.id).slice(0, 90)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="text-xs text-slate-300">
                        Accountable owner
                        <select
                          value={draft.accountableOwnerId}
                          onChange={(event) =>
                            setDrafts((current) => ({
                              ...current,
                              [boundary.key]: {
                                ...(current[boundary.key] ??
                                  emptyDetermination()),
                                accountableOwnerId: event.target.value,
                              },
                            }))
                          }
                          className="mt-1 w-full rounded-lg border border-white/10 bg-[#08111b] px-3 py-2 text-sm text-white"
                        >
                          <option value="">Select named owner…</option>
                          {data.people.map((person) => (
                            <option key={person.id} value={person.id}>
                              {person.name} · {person.role}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="md:col-span-2">
                        <button
                          type="button"
                          onClick={() => {
                            if (!selectedReview) return;
                            void runAction(`save-${boundary.key}`, () =>
                              setEthicalBoundaryDetermination({
                                reviewId: selectedReview.id,
                                boundaryKey: boundary.key,
                                ...draft,
                              }),
                            );
                          }}
                          disabled={action === `save-${boundary.key}`}
                          className="inline-flex items-center gap-2 rounded-lg border border-signal-cyan/30 bg-signal-cyan/10 px-3 py-2 text-xs font-semibold text-signal-cyan disabled:opacity-50"
                        >
                          {action === `save-${boundary.key}` ? (
                            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <ClipboardCheck className="h-3.5 w-3.5" />
                          )}
                          Save determination
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {editable && selectedReview && (
            <div className="rounded-xl border border-white/8 bg-[#0D1520] p-4">
              <label className="block text-xs text-slate-300">
                Submission basis
                <textarea
                  value={submissionBasis}
                  onChange={(event) => setSubmissionBasis(event.target.value)}
                  rows={2}
                  placeholder="Explain why this review is complete and ready for independent disposition."
                  className="mt-1 w-full rounded-lg border border-white/10 bg-[#08111b] px-3 py-2 text-sm text-white"
                />
              </label>
              <button
                type="button"
                disabled={action === "submit"}
                onClick={() =>
                  void runAction("submit", () =>
                    submitEthicalBoundaryReview(
                      selectedReview.id,
                      submissionBasis,
                    ),
                  )
                }
                className="mt-3 inline-flex items-center gap-2 rounded-lg bg-signal-cyan px-4 py-2 text-xs font-bold text-slate-950 disabled:opacity-50"
              >
                <CircleCheck className="h-3.5 w-3.5" /> Submit governed review
              </button>
            </div>
          )}

          {selectedReview?.status === "review_pending" && (
            <div className="rounded-xl border border-signal-cyan/20 bg-signal-cyan/5 p-4">
              <h3 className="text-sm font-semibold text-white">
                Independent disposition
              </h3>
              <p className="mt-1 text-xs text-slate-400">
                An administrator or executive who did not author, submit or
                assess any determination must decide this review.
              </p>
              <textarea
                value={reviewNote}
                onChange={(event) => setReviewNote(event.target.value)}
                rows={3}
                placeholder="Record the independent review basis and material limitations."
                className="mt-3 w-full rounded-lg border border-white/10 bg-[#08111b] px-3 py-2 text-sm text-white"
              />
              <div className="mt-3 flex gap-2">
                {(["approved", "rejected"] as const).map((decision) => (
                  <button
                    key={decision}
                    type="button"
                    disabled={action === `review-${decision}`}
                    onClick={() =>
                      void runAction(`review-${decision}`, () =>
                        reviewEthicalBoundaries({
                          reviewId: selectedReview.id,
                          decision,
                          reviewNote,
                        }),
                      )
                    }
                    className={`rounded-lg border px-3 py-2 text-xs font-semibold disabled:opacity-50 ${
                      decision === "approved"
                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                        : "border-rose-500/30 bg-rose-500/10 text-rose-200"
                    }`}
                  >
                    {decision === "approved" ? "Adopt" : "Reject"}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
