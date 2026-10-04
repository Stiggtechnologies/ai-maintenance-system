import { useEffect, useMemo, useState } from "react";
import { ClipboardCheck, GitBranch, ShieldCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAsyncData } from "../hooks/useAsyncData";
import {
  loadGovernedRcmWorkspace,
  reviewGovernedRcmAnalysis,
  submitGovernedRcmAnalysis,
  type RcmAnswers,
  type RcmDefaultAction,
  type RcmProactiveTask,
} from "../services/governedRcmService";
import { useAuth } from "./AuthProvider";
import { ErrorState, LoadingState } from "./ui/AsyncStates";

const fieldClass =
  "mt-1 w-full rounded-lg border border-white/10 bg-[#071019] px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400/60";
const labelClass = "text-xs font-semibold text-slate-300";

const blankAnswers: RcmAnswers = {
  functionStatement: "",
  functionalFailure: "",
  failureMode: "",
  failureEffect: "",
  consequenceCategory: "operational",
  consequenceRationale: "",
  hiddenFailure: false,
  proposedTask: "none",
  taskApplicable: null,
  applicabilityBasis: "",
  taskEffective: null,
  effectivenessBasis: "",
  defaultAction: "",
};

function title(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function BooleanChoice({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean | null;
  onChange: (value: boolean | null) => void;
}) {
  return (
    <label className={labelClass}>
      {label}
      <select
        className={fieldClass}
        value={value == null ? "" : String(value)}
        onChange={(event) =>
          onChange(
            event.target.value === "" ? null : event.target.value === "true",
          )
        }
      >
        <option value="">Not determined</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    </label>
  );
}

export function GovernedRcmWorkbench() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data, loading, error, refetch } = useAsyncData(
    loadGovernedRcmWorkspace,
    [],
    { isEmpty: () => false },
  );
  const [assetId, setAssetId] = useState("");
  const [reviewerId, setReviewerId] = useState("");
  const [answers, setAnswers] = useState<RcmAnswers>(blankAnswers);
  const [evidenceIds, setEvidenceIds] = useState<string[]>([]);
  const [fmeca, setFmeca] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{
    kind: "error" | "success";
    text: string;
  } | null>(null);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [supersedesId, setSupersedesId] = useState<string | null>(null);

  useEffect(() => {
    if (!assetId && data?.assets[0]) setAssetId(data.assets[0].id);
    if (!reviewerId && data?.reviewers[0]) setReviewerId(data.reviewers[0].id);
  }, [assetId, data, reviewerId]);

  const evidence = useMemo(
    () => data?.evidence.filter((item) => item.assetId === assetId) ?? [],
    [assetId, data?.evidence],
  );
  const analyses = useMemo(
    () => data?.analyses.filter((item) => item.assetId === assetId) ?? [],
    [assetId, data?.analyses],
  );
  const needsDefault =
    answers.proposedTask === "none" ||
    answers.taskApplicable === false ||
    answers.taskEffective === false;

  function set<K extends keyof RcmAnswers>(key: K, value: RcmAnswers[K]) {
    setAnswers((current) => ({ ...current, [key]: value }));
  }

  function chooseTask(value: RcmProactiveTask) {
    setAnswers((current) => ({
      ...current,
      proposedTask: value,
      taskApplicable: value === "none" ? null : current.taskApplicable,
      taskEffective: value === "none" ? null : current.taskEffective,
      defaultAction: value === "none" ? current.defaultAction : "",
    }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      await submitGovernedRcmAnalysis({
        assetId,
        reviewerId,
        evidenceItemIds: evidenceIds,
        supersedesFailureModeId: supersedesId,
        answers: fmeca
          ? answers
          : {
              ...answers,
              severityRank: undefined,
              occurrenceRank: undefined,
              detectabilityRank: undefined,
              criticalityScaleReference: undefined,
              criticalityBasis: undefined,
            },
      });
      setAnswers(blankAnswers);
      setEvidenceIds([]);
      setFmeca(false);
      setSupersedesId(null);
      setNotice({
        kind: "success",
        text: "The versioned RCM analysis was submitted to the assigned independent reviewer. No maintenance change was executed.",
      });
      refetch();
    } catch (submissionError) {
      setNotice({
        kind: "error",
        text:
          submissionError instanceof Error
            ? submissionError.message
            : "RCM submission failed.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function review(
    strategyId: string,
    disposition: "approved" | "rejected",
  ) {
    setBusy(true);
    setNotice(null);
    try {
      await reviewGovernedRcmAnalysis({
        strategyId,
        disposition,
        note: reviewNote,
      });
      setReviewing(null);
      setReviewNote("");
      setNotice({
        kind: "success",
        text: `Engineering disposition recorded as ${disposition}. The maintenance programme remains unchanged.`,
      });
      refetch();
    } catch (reviewError) {
      setNotice({
        kind: "error",
        text:
          reviewError instanceof Error
            ? reviewError.message
            : "RCM review failed.",
      });
    } finally {
      setBusy(false);
    }
  }

  function beginRevision(
    analysis: NonNullable<typeof data>["analyses"][number],
  ) {
    setAnswers(analysis.strategy.rcmAnswers);
    setEvidenceIds(analysis.evidenceItemIds);
    setFmeca(Boolean(analysis.strategy.rcmAnswers.severityRank));
    setSupersedesId(analysis.failureModeId);
    setNotice({
      kind: "success",
      text: `Revision v${analysis.version + 1} is loaded. The retained v${analysis.version} record will be marked superseded only when the replacement is submitted.`,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (loading && !data)
    return <LoadingState label="Loading governed FMEA and RCM workspace" />;
  if (error && !data) return <ErrorState message={error} onRetry={refetch} />;

  return (
    <section className="overflow-hidden rounded-2xl border border-cyan-400/20 bg-[#09131d] shadow-[0_24px_80px_rgba(0,0,0,0.2)]">
      <div className="border-b border-white/8 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.12),transparent_45%)] p-5 lg:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">
              <GitBranch className="h-4 w-4" aria-hidden /> Seven-question RCM
            </div>
            <h2 className="text-xl font-semibold text-white">
              Governed FMEA / FMECA decision workbench
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              Define function, failure and effects; classify consequence; test
              whether a proposed task is applicable and effective; and state the
              default action when it is not. Exact verified evidence and an
              independent reviewer are mandatory.
            </p>
          </div>
          <div className="rounded-xl border border-amber-300/20 bg-amber-300/5 px-4 py-3 text-xs leading-5 text-amber-100">
            Advisory engineering disposition only
            <br />
            No work, plan, risk, spend or operating authority
          </div>
        </div>
      </div>

      {notice && (
        <div
          className={`mx-5 mt-5 rounded-lg border px-3 py-2 text-sm ${notice.kind === "error" ? "border-rose-400/30 bg-rose-400/10 text-rose-200" : "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"}`}
        >
          {notice.text}
        </div>
      )}

      <form
        onSubmit={submit}
        className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1fr)_20rem] lg:p-6"
      >
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={labelClass}>
              Asset
              <select
                className={fieldClass}
                value={assetId}
                onChange={(event) => {
                  setAssetId(event.target.value);
                  setEvidenceIds([]);
                }}
                required
              >
                <option value="">Select an asset</option>
                {data?.assets.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.tag || asset.name} · {asset.name}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelClass}>
              Independent reviewer
              <select
                className={fieldClass}
                value={reviewerId}
                onChange={(event) => setReviewerId(event.target.value)}
                required
              >
                <option value="">Select a reviewer</option>
                {data?.reviewers.map((reviewer) => (
                  <option key={reviewer.id} value={reviewer.id}>
                    {reviewer.name} · {title(reviewer.role)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid gap-4 rounded-xl border border-white/8 bg-white/[0.025] p-4 sm:grid-cols-2">
            <label className={labelClass}>
              1 · What must the asset do?
              <textarea
                className={fieldClass}
                rows={3}
                value={answers.functionStatement}
                onChange={(event) =>
                  set("functionStatement", event.target.value)
                }
                placeholder="Function and required performance standard"
                required
              />
            </label>
            <label className={labelClass}>
              2 · How can it fail to fulfil that function?
              <textarea
                className={fieldClass}
                rows={3}
                value={answers.functionalFailure}
                onChange={(event) =>
                  set("functionalFailure", event.target.value)
                }
                placeholder="Loss or degraded functional performance"
                required
              />
            </label>
            <label className={labelClass}>
              3 · What causes the functional failure?
              <textarea
                className={fieldClass}
                rows={3}
                value={answers.failureMode}
                onChange={(event) => set("failureMode", event.target.value)}
                placeholder="Specific credible failure mode"
                required
              />
            </label>
            <label className={labelClass}>
              4 · What happens when it occurs?
              <textarea
                className={fieldClass}
                rows={3}
                value={answers.failureEffect}
                onChange={(event) => set("failureEffect", event.target.value)}
                placeholder="Observable local and system effects"
                required
              />
            </label>
          </div>

          <div className="grid gap-4 rounded-xl border border-white/8 bg-white/[0.025] p-4 sm:grid-cols-2">
            <label className={labelClass}>
              5 · Consequence category
              <select
                className={fieldClass}
                value={answers.consequenceCategory}
                onChange={(event) =>
                  set(
                    "consequenceCategory",
                    event.target.value as RcmAnswers["consequenceCategory"],
                  )
                }
              >
                {[
                  "hidden",
                  "safety",
                  "environmental",
                  "operational",
                  "non_operational",
                ].map((value) => (
                  <option key={value} value={value}>
                    {title(value)}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelClass}>
              Is the failed function hidden in normal operation?
              <select
                className={fieldClass}
                value={String(answers.hiddenFailure)}
                onChange={(event) =>
                  set("hiddenFailure", event.target.value === "true")
                }
              >
                <option value="false">No</option>
                <option value="true">Yes</option>
              </select>
            </label>
            <label className={`${labelClass} sm:col-span-2`}>
              Consequence rationale
              <textarea
                className={fieldClass}
                rows={2}
                value={answers.consequenceRationale}
                onChange={(event) =>
                  set("consequenceRationale", event.target.value)
                }
                required
              />
            </label>
          </div>

          <div className="grid gap-4 rounded-xl border border-white/8 bg-white/[0.025] p-4 sm:grid-cols-2">
            <label className={`${labelClass} sm:col-span-2`}>
              6 · Candidate proactive task
              <select
                className={fieldClass}
                value={answers.proposedTask}
                onChange={(event) =>
                  chooseTask(event.target.value as RcmProactiveTask)
                }
              >
                <option value="none">No candidate task</option>
                <option value="condition_based">
                  Condition based / on-condition
                </option>
                <option value="failure_finding">
                  Failure finding / functional test
                </option>
                <option value="time_based_restoration">
                  Scheduled restoration
                </option>
                <option value="time_based_replacement">
                  Scheduled replacement
                </option>
              </select>
            </label>
            {answers.proposedTask !== "none" && (
              <>
                <BooleanChoice
                  label="Technically applicable?"
                  value={answers.taskApplicable}
                  onChange={(value) => set("taskApplicable", value)}
                />
                <BooleanChoice
                  label="Worth doing / effective?"
                  value={answers.taskEffective}
                  onChange={(value) => set("taskEffective", value)}
                />
                <label className={labelClass}>
                  Applicability basis
                  <textarea
                    className={fieldClass}
                    rows={2}
                    value={answers.applicabilityBasis}
                    onChange={(event) =>
                      set("applicabilityBasis", event.target.value)
                    }
                  />
                </label>
                <label className={labelClass}>
                  Effectiveness basis
                  <textarea
                    className={fieldClass}
                    rows={2}
                    value={answers.effectivenessBasis}
                    onChange={(event) =>
                      set("effectivenessBasis", event.target.value)
                    }
                  />
                </label>
              </>
            )}
            {needsDefault && (
              <label className={`${labelClass} sm:col-span-2`}>
                7 · Default action
                <select
                  className={fieldClass}
                  value={answers.defaultAction}
                  onChange={(event) =>
                    set("defaultAction", event.target.value as RcmDefaultAction)
                  }
                  required
                >
                  <option value="">Select the explicit default</option>
                  <option value="failure_finding">Failure finding</option>
                  <option value="run_to_failure">
                    No scheduled maintenance / run to failure
                  </option>
                  <option value="redesign">Redesign</option>
                  <option value="one_time_change">One-time change</option>
                </select>
              </label>
            )}
          </div>

          <div className="rounded-xl border border-white/8 bg-white/[0.025] p-4">
            {supersedesId && (
              <div className="mb-4 rounded-lg border border-cyan-400/20 bg-cyan-400/5 p-3 text-xs text-cyan-100">
                Recording a new retained version. The prior analysis remains in
                history.
                <button
                  type="button"
                  className="ml-2 underline"
                  onClick={() => {
                    setSupersedesId(null);
                    setAnswers(blankAnswers);
                    setEvidenceIds([]);
                  }}
                >
                  Cancel revision
                </button>
              </div>
            )}
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-200">
              <input
                type="checkbox"
                checked={fmeca}
                onChange={(event) => setFmeca(event.target.checked)}
              />{" "}
              Add FMECA criticality classification
            </label>
            <p className="mt-1 text-xs text-slate-400">
              SyncAI records your named scale and basis. It does not invent a
              scale or multiply ordinal ranks into a false-precision RPN.
            </p>
            {fmeca && (
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                {(
                  [
                    ["severityRank", "Severity"],
                    ["occurrenceRank", "Occurrence"],
                    ["detectabilityRank", "Detectability"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className={labelClass}>
                    {label}
                    <input
                      className={fieldClass}
                      value={answers[key] ?? ""}
                      onChange={(event) => set(key, event.target.value)}
                      required
                    />
                  </label>
                ))}
                <label className={`${labelClass} sm:col-span-3`}>
                  Scale reference
                  <input
                    className={fieldClass}
                    value={answers.criticalityScaleReference ?? ""}
                    onChange={(event) =>
                      set("criticalityScaleReference", event.target.value)
                    }
                    placeholder="Site FMECA scale, revision"
                    required
                  />
                </label>
                <label className={`${labelClass} sm:col-span-3`}>
                  Criticality basis
                  <textarea
                    className={fieldClass}
                    rows={2}
                    value={answers.criticalityBasis ?? ""}
                    onChange={(event) =>
                      set("criticalityBasis", event.target.value)
                    }
                    required
                  />
                </label>
              </div>
            )}
          </div>
        </div>

        <aside className="space-y-4">
          <div className="rounded-xl border border-white/8 bg-white/[0.025] p-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
              <ShieldCheck className="h-4 w-4 text-cyan-300" /> Verified asset
              evidence
            </h3>
            {evidence.length ? (
              <div className="mt-3 space-y-2">
                {evidence.map((item) => (
                  <label
                    key={item.id}
                    className="flex gap-2 rounded-lg border border-white/6 p-2 text-xs text-slate-300"
                  >
                    <input
                      type="checkbox"
                      checked={evidenceIds.includes(item.id)}
                      onChange={(event) =>
                        setEvidenceIds((current) =>
                          event.target.checked
                            ? [...current, item.id]
                            : current.filter((id) => id !== item.id),
                        )
                      }
                    />
                    <span>
                      <strong className="text-slate-100">
                        {item.description || title(item.type || "Evidence")}
                      </strong>
                      <br />
                      {item.sourceSystem || "Recorded source"} ·{" "}
                      {title(item.class || "documented")}
                    </span>
                  </label>
                ))}
              </div>
            ) : (
              <div className="mt-3 rounded-lg border border-amber-300/20 bg-amber-300/5 p-3 text-xs leading-5 text-amber-100">
                No verified canonical evidence is linked to this asset. Record
                and independently verify evidence before submitting.
                <button
                  type="button"
                  className="mt-2 block text-cyan-300 underline"
                  onClick={() => navigate("/knowledge-base")}
                >
                  Open governed knowledge
                </button>
              </div>
            )}
          </div>
          <button
            type="submit"
            disabled={
              busy || !assetId || !reviewerId || evidenceIds.length === 0
            }
            className="w-full rounded-lg bg-cyan-300 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Submit for independent review
          </button>
        </aside>
      </form>

      <div className="border-t border-white/8 p-5 lg:p-6">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
          <ClipboardCheck className="h-4 w-4 text-cyan-300" /> Retained analyses
        </h3>
        <div className="mt-3 space-y-3">
          {analyses.map((analysis) => (
            <article
              key={analysis.failureModeId}
              className="rounded-xl border border-white/8 bg-white/[0.025] p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="font-semibold text-slate-100">
                    {analysis.failureMode}
                  </div>
                  <div className="mt-1 text-xs text-slate-400">
                    {analysis.functionalFailure} ·{" "}
                    {title(analysis.consequenceCategory)} · v{analysis.version}
                  </div>
                </div>
                <span className="rounded-full bg-white/5 px-2 py-1 text-xs text-slate-300">
                  {title(analysis.status)}
                </span>
              </div>
              <div className="mt-3 text-sm text-slate-300">
                {analysis.strategy.recommendation}
              </div>
              {analysis.reviewNote && (
                <div className="mt-2 text-xs text-slate-400">
                  Review: {analysis.reviewNote}
                </div>
              )}
              {(analysis.status === "reviewed" ||
                analysis.status === "rejected") && (
                <button
                  type="button"
                  onClick={() => beginRevision(analysis)}
                  className="mt-3 rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-white/5"
                >
                  Create superseding revision
                </button>
              )}
              {analysis.status === "submitted" &&
                analysis.strategy.reviewerId === user?.id && (
                  <div className="mt-4 rounded-lg border border-cyan-400/20 bg-cyan-400/5 p-3">
                    <textarea
                      className={fieldClass}
                      rows={2}
                      value={
                        reviewing === analysis.strategy.id ? reviewNote : ""
                      }
                      onFocus={() => setReviewing(analysis.strategy.id)}
                      onChange={(event) => {
                        setReviewing(analysis.strategy.id);
                        setReviewNote(event.target.value);
                      }}
                      placeholder="Independent review note (minimum 20 characters)"
                    />
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        disabled={
                          busy ||
                          reviewing !== analysis.strategy.id ||
                          reviewNote.trim().length < 20
                        }
                        onClick={() => review(analysis.strategy.id, "approved")}
                        className="rounded-lg bg-emerald-300 px-3 py-2 text-xs font-semibold text-slate-950 disabled:opacity-50"
                      >
                        Approve engineering disposition
                      </button>
                      <button
                        type="button"
                        disabled={
                          busy ||
                          reviewing !== analysis.strategy.id ||
                          reviewNote.trim().length < 20
                        }
                        onClick={() => review(analysis.strategy.id, "rejected")}
                        className="rounded-lg border border-rose-300/30 px-3 py-2 text-xs font-semibold text-rose-200 disabled:opacity-50"
                      >
                        Reject
                      </button>
                    </div>
                    <p className="mt-2 text-[11px] text-slate-400">
                      A verified MFA factor and current AAL2 session are
                      required. This decision still does not alter the
                      maintenance programme.
                    </p>
                  </div>
                )}
            </article>
          ))}
          {analyses.length === 0 && (
            <div className="rounded-xl border border-dashed border-white/10 p-5 text-sm text-slate-400">
              No governed RCM analysis has been recorded for this asset.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
