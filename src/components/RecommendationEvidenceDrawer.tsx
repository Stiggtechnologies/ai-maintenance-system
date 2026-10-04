import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FileSearch,
  LockKeyhole,
  Scale,
  ShieldCheck,
  X,
} from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import {
  getRecommendationEvidenceWorkspace,
  proposeRecommendationEvidenceClassification,
  RECOMMENDATION_EVIDENCE_LEVELS,
  reviewRecommendationEvidenceClassification,
  reviewRecommendationEvidencePacket,
  setRecommendationMissingEvidence,
  type RecommendationEvidenceItem,
  type RecommendationEvidenceLevel,
  type RecommendationClaimRole,
} from "../services/recommendationEvidenceService";
import type { RecommendationRow } from "../types/operating";
import { EmptyState, ErrorState, LoadingState } from "./ui/AsyncStates";

function words(value: string | null | undefined) {
  return value?.replaceAll("_", " ") ?? "not recorded";
}

function StatusPill({ value }: { value: string }) {
  const tone =
    value === "validated"
      ? "bg-emerald-500/15 text-emerald-300"
      : value === "stale" || value === "rejected"
        ? "bg-red-500/15 text-red-300"
        : value === "pending_review"
          ? "bg-amber-500/15 text-amber-200"
          : "bg-white/5 text-slate-400";
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone}`}
    >
      {words(value)}
    </span>
  );
}

function Confidence({ evidence }: { evidence: RecommendationEvidenceItem }) {
  if (typeof evidence.confidence.evidenceConfidencePct === "number") {
    return (
      <span className="font-mono text-cyan-300">
        {evidence.confidence.evidenceConfidencePct}% EC
      </span>
    );
  }
  return (
    <span className="text-amber-300" title={evidence.confidence.error}>
      EC refused · {words(evidence.confidence.refusal)}
    </span>
  );
}

export function RecommendationEvidenceDrawer({
  rec,
  currentUserId,
  canGovern,
  onClose,
}: {
  rec: RecommendationRow;
  currentUserId: string | null;
  canGovern: boolean;
  onClose: () => void;
}) {
  const workspace = useAsyncData(
    () => getRecommendationEvidenceWorkspace(rec.id),
    [rec.id],
    { isEmpty: () => false },
  );
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [classificationDrafts, setClassificationDrafts] = useState<
    Record<
      string,
      {
        level: RecommendationEvidenceLevel;
        role: RecommendationClaimRole;
        reference: string;
        revision: string;
        sourceDate: string;
        applicability: string;
      }
    >
  >({});
  const [gaps, setGaps] = useState("");
  const [basis, setBasis] = useState("");
  const [packetNote, setPacketNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);

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
        error instanceof Error
          ? error.message
          : "Governed evidence operation failed.",
      );
    } finally {
      setBusy(false);
    }
  };

  const data = workspace.data;
  const packetCanReview =
    canGovern &&
    data?.packet.validationStatus === "pending_review" &&
    data.packet.recordedBy !== currentUserId;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <aside className="relative h-full w-full max-w-2xl overflow-y-auto border-l border-white/10 bg-[#0D1520] p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-cyan-300">
              <FileSearch className="h-4 w-4" /> Recommendation evidence
            </div>
            <h3 className="mt-1 text-base font-semibold text-white">
              {rec.title}
            </h3>
            <p className="text-xs text-slate-500">
              {rec.asset?.name ?? "No linked asset"}
            </p>
          </div>
          <button
            aria-label="Close"
            onClick={onClose}
            className="text-slate-400 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {workspace.loading ? (
          <LoadingState label="Loading governed evidence…" />
        ) : null}
        {workspace.error ? (
          <ErrorState message={workspace.error} onRetry={workspace.refetch} />
        ) : null}
        {notice ? (
          <div
            role="status"
            className="mt-4 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-300"
          >
            {notice}
          </div>
        ) : null}
        {mutationError ? (
          <div
            role="alert"
            className="mt-4 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300"
          >
            {mutationError}
          </div>
        ) : null}

        {data ? (
          <div className="mt-5 space-y-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                ["Linked", data.posture.linkedEvidence],
                ["Classified", data.posture.validatedClassifications],
                ["Contradicting", data.posture.contradicting],
                ["Missing", data.posture.missingCount],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="rounded-xl border border-white/6 bg-black/20 p-3"
                >
                  <div className="text-lg font-black text-white">{value}</div>
                  <div className="text-[11px] text-slate-500">{label}</div>
                </div>
              ))}
            </div>

            <div className="flex items-start gap-2 rounded-xl border border-amber-400/15 bg-amber-400/5 p-3 text-xs leading-relaxed text-slate-400">
              <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
              <p>{data.boundary}</p>
            </div>

            {data.evidence.length === 0 ? (
              <EmptyState message="No evidence is linked to this recommendation." />
            ) : null}
            {data.evidence.map((evidence) => {
              const classification = classificationDrafts[evidence.id] ?? {
                level: "verified_measurement" as const,
                role: "supporting" as const,
                reference: evidence.sourceReference ?? "",
                revision: evidence.revision ?? "",
                sourceDate: evidence.sourceDate ?? "",
                applicability: evidence.applicability ?? "",
              };
              const updateClassification = (
                patch: Partial<typeof classification>,
              ) =>
                setClassificationDrafts((current) => ({
                  ...current,
                  [evidence.id]: { ...classification, ...patch },
                }));
              const canReview =
                canGovern &&
                evidence.classificationStatus === "pending_review" &&
                evidence.recordedBy !== currentUserId;
              return (
                <article
                  key={evidence.id}
                  className={`rounded-xl border p-4 ${evidence.claimRole === "contradicting" ? "border-red-400/25 bg-red-400/5" : "border-white/7 bg-black/20"}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {evidence.claimRole === "contradicting" ? (
                        <Scale className="h-4 w-4 text-red-300" />
                      ) : (
                        <ShieldCheck className="h-4 w-4 text-cyan-300" />
                      )}
                      <span className="text-sm font-semibold text-slate-200">
                        {words(evidence.evidenceLevel ?? evidence.evidenceType)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-[11px]">
                      <Confidence evidence={evidence} />
                      <StatusPill value={evidence.classificationStatus} />
                    </div>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-slate-400">
                    {evidence.description ?? "No description recorded."}
                  </p>
                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-slate-500">
                    <div>
                      Role:{" "}
                      <span className="text-slate-300">
                        {words(evidence.claimRole)}
                      </span>
                    </div>
                    <div>
                      Verification:{" "}
                      <span className="text-slate-300">
                        {words(evidence.verificationStatus)}
                      </span>
                    </div>
                    <div>
                      Source:{" "}
                      <span className="text-slate-300">
                        {evidence.sourceSystem ?? "—"}
                      </span>
                    </div>
                    <div>
                      Reference:{" "}
                      <span className="text-slate-300">
                        {evidence.sourceReference ?? "—"}
                      </span>
                    </div>
                    <div>
                      Revision:{" "}
                      <span className="text-slate-300">
                        {evidence.revision ?? "—"}
                      </span>
                    </div>
                    <div>
                      Source date:{" "}
                      <span className="text-slate-300">
                        {evidence.sourceDate ?? "—"}
                      </span>
                    </div>
                  </dl>
                  {evidence.applicability ? (
                    <p className="mt-2 text-[11px] text-slate-500">
                      Applicability: {evidence.applicability}
                    </p>
                  ) : null}
                  {canGovern &&
                  evidence.classificationStatus === "unclassified" ? (
                    <div className="mt-3 grid gap-2 border-t border-white/6 pt-3 sm:grid-cols-2">
                      <select
                        value={classification.level}
                        onChange={(event) =>
                          updateClassification({
                            level: event.target
                              .value as RecommendationEvidenceLevel,
                          })
                        }
                        className="rounded-lg border border-white/10 bg-[#111c29] p-2 text-xs text-slate-200"
                      >
                        {RECOMMENDATION_EVIDENCE_LEVELS.map((level) => (
                          <option key={level} value={level}>
                            {words(level)}
                          </option>
                        ))}
                      </select>
                      <select
                        value={classification.role}
                        onChange={(event) =>
                          updateClassification({
                            role: event.target.value as RecommendationClaimRole,
                          })
                        }
                        className="rounded-lg border border-white/10 bg-[#111c29] p-2 text-xs text-slate-200"
                      >
                        {(
                          ["supporting", "contradicting", "context"] as const
                        ).map((role) => (
                          <option key={role} value={role}>
                            {role}
                          </option>
                        ))}
                      </select>
                      <input
                        value={classification.reference}
                        onChange={(event) =>
                          updateClassification({
                            reference: event.target.value,
                          })
                        }
                        placeholder="Source reference"
                        className="rounded-lg border border-white/10 bg-black/20 p-2 text-xs text-slate-200"
                      />
                      <input
                        value={classification.revision}
                        onChange={(event) =>
                          updateClassification({ revision: event.target.value })
                        }
                        placeholder="Revision"
                        className="rounded-lg border border-white/10 bg-black/20 p-2 text-xs text-slate-200"
                      />
                      <input
                        type="date"
                        value={classification.sourceDate}
                        onChange={(event) =>
                          updateClassification({
                            sourceDate: event.target.value,
                          })
                        }
                        className="rounded-lg border border-white/10 bg-black/20 p-2 text-xs text-slate-200"
                      />
                      <textarea
                        value={classification.applicability}
                        onChange={(event) =>
                          updateClassification({
                            applicability: event.target.value,
                          })
                        }
                        placeholder="Applicability to this recommendation (20+ characters)"
                        className="min-h-16 rounded-lg border border-white/10 bg-black/20 p-2 text-xs text-slate-200"
                      />
                      <button
                        disabled={
                          busy ||
                          classification.reference.trim().length < 3 ||
                          !classification.revision.trim() ||
                          !classification.sourceDate ||
                          classification.applicability.trim().length < 20
                        }
                        onClick={() =>
                          run(
                            () =>
                              proposeRecommendationEvidenceClassification({
                                evidenceId: evidence.id,
                                evidenceLevel: classification.level,
                                claimRole: classification.role,
                                sourceReference: classification.reference,
                                revision: classification.revision,
                                sourceDate: classification.sourceDate,
                                applicability: classification.applicability,
                              }),
                            "Evidence classification submitted for independent review.",
                          )
                        }
                        className="rounded-lg bg-cyan-500/15 px-3 py-1.5 text-xs font-semibold text-cyan-200 disabled:opacity-40 sm:col-span-2"
                      >
                        Submit classification
                      </button>
                    </div>
                  ) : null}
                  {canReview ? (
                    <div className="mt-3 space-y-2 border-t border-white/6 pt-3">
                      <textarea
                        value={reviewNotes[evidence.id] ?? ""}
                        onChange={(event) =>
                          setReviewNotes((current) => ({
                            ...current,
                            [evidence.id]: event.target.value,
                          }))
                        }
                        placeholder="Independent review basis (20+ characters)"
                        className="min-h-16 w-full rounded-lg border border-white/10 bg-black/20 p-2 text-xs text-slate-200"
                      />
                      <div className="flex gap-2">
                        {(["validated", "rejected"] as const).map(
                          (decision) => (
                            <button
                              key={decision}
                              disabled={
                                busy ||
                                (reviewNotes[evidence.id]?.trim().length ?? 0) <
                                  20
                              }
                              onClick={() =>
                                run(
                                  () =>
                                    reviewRecommendationEvidenceClassification({
                                      evidenceId: evidence.id,
                                      decision,
                                      reviewNote:
                                        reviewNotes[evidence.id] ?? "",
                                    }),
                                  `Classification ${decision}. This did not verify the source or approve the recommendation.`,
                                )
                              }
                              className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300 disabled:opacity-40"
                            >
                              {decision === "validated"
                                ? "Validate classification"
                                : "Reject classification"}
                            </button>
                          ),
                        )}
                      </div>
                    </div>
                  ) : null}
                </article>
              );
            })}

            <section className="rounded-xl border border-white/8 bg-black/20 p-4">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-sm font-semibold text-white">
                  Evidence completeness packet
                </h4>
                <StatusPill value={data.packet.validationStatus} />
              </div>
              {data.missingEvidence.length ? (
                <ul className="mt-3 space-y-1 text-xs text-amber-200">
                  {data.missingEvidence.map((gap) => (
                    <li key={gap}>• {gap}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-xs text-slate-500">
                  No decision-relevant gap is currently declared.
                </p>
              )}
              {data.missingEvidenceBasis ? (
                <p className="mt-2 text-xs text-slate-400">
                  Basis: {data.missingEvidenceBasis}
                </p>
              ) : null}

              {canGovern ? (
                <div className="mt-4 space-y-2 border-t border-white/6 pt-3">
                  <textarea
                    value={gaps}
                    onChange={(event) => setGaps(event.target.value)}
                    placeholder="Missing evidence — one item per line. Leave blank only when completeness has been assessed."
                    className="min-h-20 w-full rounded-lg border border-white/10 bg-black/20 p-2 text-xs text-slate-200"
                  />
                  <textarea
                    value={basis}
                    onChange={(event) => setBasis(event.target.value)}
                    placeholder="How completeness was assessed (20+ characters)"
                    className="min-h-16 w-full rounded-lg border border-white/10 bg-black/20 p-2 text-xs text-slate-200"
                  />
                  <button
                    disabled={busy || basis.trim().length < 20}
                    onClick={() =>
                      run(
                        () =>
                          setRecommendationMissingEvidence({
                            recommendationId: rec.id,
                            missingEvidence: gaps
                              .split("\n")
                              .map((item) => item.trim())
                              .filter(Boolean),
                            basis,
                          }),
                        "Evidence completeness packet submitted for independent review.",
                      )
                    }
                    className="rounded-lg bg-cyan-500/15 px-3 py-1.5 text-xs font-semibold text-cyan-200 disabled:opacity-40"
                  >
                    Submit exact packet digest
                  </button>
                </div>
              ) : null}

              {packetCanReview ? (
                <div className="mt-4 space-y-2 border-t border-white/6 pt-3">
                  <textarea
                    value={packetNote}
                    onChange={(event) => setPacketNote(event.target.value)}
                    placeholder="Independent packet review basis (20+ characters)"
                    className="min-h-16 w-full rounded-lg border border-white/10 bg-black/20 p-2 text-xs text-slate-200"
                  />
                  <div className="flex gap-2">
                    {(["validated", "rejected"] as const).map((decision) => (
                      <button
                        key={decision}
                        disabled={busy || packetNote.trim().length < 20}
                        onClick={() =>
                          run(
                            () =>
                              reviewRecommendationEvidencePacket({
                                recommendationId: rec.id,
                                decision,
                                reviewNote: packetNote,
                              }),
                            `Evidence packet ${decision}; recommendation authority is unchanged.`,
                          )
                        }
                        className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300 disabled:opacity-40"
                      >
                        {decision === "validated"
                          ? "Validate packet"
                          : "Reject packet"}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              {data.packet.validationStatus === "stale" ? (
                <div className="mt-3 flex items-start gap-2 text-xs text-red-300">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Evidence changed after review. Reassess and submit a new exact
                  digest.
                </div>
              ) : null}
              {data.packet.validationStatus === "validated" ? (
                <div className="mt-3 flex items-center gap-2 text-xs text-emerald-300">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Exact evidence packet independently validated.
                </div>
              ) : null}
            </section>
          </div>
        ) : null}
      </aside>
    </div>
  );
}
