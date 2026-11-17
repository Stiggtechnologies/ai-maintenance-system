import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FlaskConical,
  Layers3,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import {
  getDegradationLibraryWorkspace,
  proposeDegradationProfileRevision,
  reviewDegradationProfile,
  type DegradationProfileFamily,
} from "../services/degradationLibraryService";
import { ErrorState, LoadingState } from "./ui/AsyncStates";

export interface DegradationEvidenceOption {
  id: string;
  description: string | null;
  source_system: string | null;
  data_quality: string;
  verification_status: "verified";
  quality_grade: "high" | "moderate" | "low" | null;
}

interface RevisionDraft {
  family: DegradationProfileFamily;
  title: string;
  description: string;
  stressors: string;
  damageState: string;
  observations: string;
  modelKinds: string[];
  applicability: string;
  limitations: string;
  evidenceItemId: string;
}

const MODEL_KINDS = [
  "standards_method",
  "deterministic_physics",
  "empirical_reliability",
  "oem_curve",
] as const;

function words(value: string): string {
  return value.replaceAll("_", " ");
}

function list(value: string): string[] {
  return value
    .split(/\n|,/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function draftFrom(family: DegradationProfileFamily): RevisionDraft {
  return {
    family,
    title: family.title,
    description: family.description,
    stressors: family.stressorRequirements.join("\n"),
    damageState: family.damageStateRequirements.join("\n"),
    observations: family.observationRequirements.join("\n"),
    modelKinds: family.candidateModelKinds,
    applicability: family.applicabilityQuestions.join("\n"),
    limitations: family.limitations,
    evidenceItemId: "",
  };
}

function StatusPill({ status }: { status: DegradationProfileFamily["status"] }) {
  const approved = status === "approved";
  const pending = status === "pending_review";
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
        approved
          ? "bg-emerald-500/15 text-emerald-300"
          : pending
            ? "bg-amber-500/15 text-amber-200"
            : "bg-white/5 text-slate-400"
      }`}
    >
      {words(status)}
    </span>
  );
}

export function DegradationLibraryPanel({
  evidence,
  canManage,
  currentUserId,
}: {
  evidence: DegradationEvidenceOption[];
  canManage: boolean;
  currentUserId: string | null;
}) {
  const workspace = useAsyncData(getDegradationLibraryWorkspace, [], {
    isEmpty: () => false,
  });
  const [draft, setDraft] = useState<RevisionDraft | null>(null);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
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
      setDraft(null);
      await workspace.refetch();
    } catch (error) {
      setMutationError(
        error instanceof Error
          ? error.message
          : "The governed degradation-library operation failed.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (workspace.loading)
    return <LoadingState label="Loading governed degradation library…" />;
  if (workspace.error)
    return <ErrorState message={workspace.error} onRetry={workspace.refetch} />;
  if (!workspace.data)
    return (
      <ErrorState
        message="Degradation library returned no data."
        onRetry={workspace.refetch}
      />
    );

  const data = workspace.data;

  return (
    <section aria-labelledby="degradation-library-heading" className="space-y-5">
      <div className="rounded-2xl border border-violet-400/15 bg-[#0D1520] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-violet-300">
              <Layers3 className="h-4 w-4" /> Materials & degradation science
            </div>
            <h2
              id="degradation-library-heading"
              className="mt-2 text-lg font-semibold text-white"
            >
              Governed degradation library
            </h2>
            <p className="mt-1 max-w-4xl text-sm leading-relaxed text-slate-400">
              Sixteen manufacturer-neutral mechanism families define the
              evidence, damage-state, applicability and model questions that
              must be answered before a site-specific degradation conclusion
              can be trusted.
            </p>
          </div>
          <span className="rounded-full border border-violet-400/20 bg-violet-400/10 px-3 py-1 text-xs font-semibold text-violet-200">
            {data.coverage.representedFamilies}/
            {data.coverage.requiredFamilies} represented
          </span>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {[
            ["Approved profiles", data.coverage.approvedFamilies],
            ["Families with models", data.coverage.familiesWithLinkedModels],
            ["Required families", data.coverage.requiredFamilies],
          ].map(([label, value]) => (
            <div
              key={label}
              className="rounded-xl border border-white/6 bg-black/20 p-3"
            >
              <div className="text-xl font-black text-white">{value}</div>
              <div className="mt-0.5 text-xs text-slate-500">{label}</div>
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-400/15 bg-amber-400/5 p-3 text-xs leading-relaxed text-slate-400">
          <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
          <p>{data.boundary}</p>
        </div>
      </div>

      {notice ? (
        <div
          role="status"
          className="flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-300"
        >
          <CheckCircle2 className="h-4 w-4" /> {notice}
        </div>
      ) : null}
      {mutationError ? (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300"
        >
          <AlertTriangle className="h-4 w-4" /> {mutationError}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {data.families.map((family) => {
          const canReview =
            canManage &&
            family.status === "pending_review" &&
            family.authorId !== currentUserId;
          return (
            <article
              key={family.familyKey}
              className="rounded-2xl border border-white/8 bg-[#0D1520] p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-white">
                    {family.title}
                  </h3>
                  <p className="mt-1 font-mono text-[11px] text-slate-500">
                    {family.mechanismKey} · profile v{family.version}
                  </p>
                </div>
                <StatusPill status={family.status} />
              </div>
              <p className="mt-3 text-xs leading-relaxed text-slate-400">
                {family.description}
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Required stressors
                  </div>
                  <ul className="mt-1 space-y-1 text-xs text-slate-300">
                    {family.stressorRequirements.map((item) => (
                      <li key={item}>• {item}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Damage-state evidence
                  </div>
                  <ul className="mt-1 space-y-1 text-xs text-slate-300">
                    {family.damageStateRequirements.map((item) => (
                      <li key={item}>• {item}</li>
                    ))}
                  </ul>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2 text-[11px]">
                {family.candidateModelKinds.map((kind) => (
                  <span
                    key={kind}
                    className="rounded-full border border-white/8 bg-white/5 px-2 py-1 text-slate-300"
                  >
                    {words(kind)}
                  </span>
                ))}
              </div>
              <div className="mt-4 flex items-center justify-between gap-3 border-t border-white/6 pt-3 text-xs text-slate-500">
                <span>
                  {family.linkedModels.length} linked exact-version model
                  {family.linkedModels.length === 1 ? "" : "s"}
                </span>
                {canManage ? (
                  <button
                    type="button"
                    disabled={busy || family.status === "pending_review"}
                    onClick={() => setDraft(draftFrom(family))}
                    className="rounded-lg border border-violet-400/20 bg-violet-400/10 px-3 py-1.5 font-semibold text-violet-200 disabled:opacity-40"
                  >
                    Propose revision
                  </button>
                ) : null}
              </div>

              {canReview ? (
                <div className="mt-4 space-y-2 rounded-xl border border-amber-400/15 bg-amber-400/5 p-3">
                  <div className="flex items-center gap-2 text-xs font-semibold text-amber-200">
                    <ShieldCheck className="h-4 w-4" /> Independent review
                  </div>
                  <textarea
                    aria-label={`Review basis for ${family.title}`}
                    value={reviewNotes[family.profileId] ?? ""}
                    onChange={(event) =>
                      setReviewNotes((current) => ({
                        ...current,
                        [family.profileId]: event.target.value,
                      }))
                    }
                    placeholder="State why the exact profile and verified evidence are fit—or not fit—for this tenant."
                    className="min-h-20 w-full rounded-lg border border-white/8 bg-[#111b28] p-2 text-xs text-white"
                  />
                  <div className="flex gap-2">
                    {(["approved", "rejected"] as const).map((decision) => (
                      <button
                        key={decision}
                        type="button"
                        disabled={
                          busy ||
                          (reviewNotes[family.profileId] ?? "").trim().length <
                            20
                        }
                        onClick={() =>
                          run(
                            () =>
                              reviewDegradationProfile({
                                profileId: family.profileId,
                                decision,
                                reviewNote:
                                  reviewNotes[family.profileId] ?? "",
                              }),
                            `Profile ${decision}.`,
                          )
                        }
                        className="rounded-lg border border-white/8 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-200 disabled:opacity-40"
                      >
                        {decision === "approved" ? "Approve" : "Reject"}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>

      {draft ? (
        <form
          aria-label="Propose degradation profile revision"
          className="rounded-2xl border border-violet-400/20 bg-[#0D1520] p-5"
          onSubmit={(event) => {
            event.preventDefault();
            void run(
              () =>
                proposeDegradationProfileRevision({
                  familyKey: draft.family.familyKey,
                  title: draft.title,
                  description: draft.description,
                  stressorRequirements: list(draft.stressors),
                  damageStateRequirements: list(draft.damageState),
                  observationRequirements: list(draft.observations),
                  candidateModelKinds: draft.modelKinds,
                  applicabilityQuestions: list(draft.applicability),
                  limitations: draft.limitations,
                  evidenceItemId: draft.evidenceItemId,
                }),
              `${draft.family.title} revision submitted for independent review.`,
            );
          }}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
                <FlaskConical className="h-4 w-4 text-violet-300" /> Propose a
                sourced {draft.family.title.toLowerCase()} revision
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                One entry per line. The proposal cannot approve itself or
                supply operational authority.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setDraft(null)}
              className="text-xs text-slate-400 hover:text-white"
            >
              Cancel
            </button>
          </div>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {[
              ["Profile title", draft.title, "title"],
              ["Profile description", draft.description, "description"],
              ["Stressor requirements", draft.stressors, "stressors"],
              ["Damage-state requirements", draft.damageState, "damageState"],
              ["Observation requirements", draft.observations, "observations"],
              ["Applicability questions", draft.applicability, "applicability"],
              ["Known limitations", draft.limitations, "limitations"],
            ].map(([label, value, key]) => (
              <label key={key} className="text-xs text-slate-400">
                {label}
                <textarea
                  aria-label={label}
                  value={value}
                  onChange={(event) =>
                    setDraft((current) =>
                      current
                        ? { ...current, [key]: event.target.value }
                        : current,
                    )
                  }
                  className="mt-1 min-h-24 w-full rounded-lg border border-white/8 bg-[#111b28] p-2 text-xs text-white"
                />
              </label>
            ))}
          </div>
          <fieldset className="mt-4">
            <legend className="text-xs text-slate-400">
              Candidate governed model kinds
            </legend>
            <div className="mt-2 flex flex-wrap gap-3">
              {MODEL_KINDS.map((kind) => (
                <label key={kind} className="flex items-center gap-2 text-xs text-slate-300">
                  <input
                    type="checkbox"
                    checked={draft.modelKinds.includes(kind)}
                    onChange={(event) =>
                      setDraft((current) =>
                        current
                          ? {
                              ...current,
                              modelKinds: event.target.checked
                                ? [...new Set([...current.modelKinds, kind])]
                                : current.modelKinds.filter(
                                    (item) => item !== kind,
                                  ),
                            }
                          : current,
                      )
                    }
                  />
                  {words(kind)}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="mt-4 block text-xs text-slate-400">
            Verified source evidence
            <select
              aria-label="Verified source evidence"
              value={draft.evidenceItemId}
              onChange={(event) =>
                setDraft((current) =>
                  current
                    ? { ...current, evidenceItemId: event.target.value }
                    : current,
                )
              }
              className="mt-1 w-full rounded-lg border border-white/8 bg-[#111b28] p-2 text-xs text-white"
            >
              <option value="">Select independently verified evidence…</option>
              {evidence.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.source_system ?? "source"} · {item.description ?? item.id}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            disabled={
              busy ||
              !draft.evidenceItemId ||
              draft.modelKinds.length === 0 ||
              list(draft.stressors).length === 0 ||
              list(draft.damageState).length === 0 ||
              list(draft.observations).length === 0 ||
              list(draft.applicability).length === 0
            }
            className="mt-4 rounded-lg border border-violet-400/20 bg-violet-400/10 px-4 py-2 text-sm font-semibold text-violet-200 disabled:opacity-40"
          >
            Submit for independent review
          </button>
        </form>
      ) : null}
    </section>
  );
}
