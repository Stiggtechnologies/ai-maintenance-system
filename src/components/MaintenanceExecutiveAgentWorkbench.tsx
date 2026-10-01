import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Bot,
  BriefcaseBusiness,
  CalendarRange,
  CheckCircle2,
  Fingerprint,
  ShieldCheck,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAsyncData } from "../hooks/useAsyncData";
import {
  assignMaintenanceExecutiveReview,
  loadMaintenanceExecutiveWorkspace,
  recordMaintenanceExecutiveDisposition,
  runMaintenanceExecutiveAgent,
  type MaintenanceExecutiveDisposition,
} from "../services/maintenanceExecutiveAgentService";
import { ErrorState, LoadingState } from "./ui/AsyncStates";

const input =
  "mt-1 w-full rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm text-white";
const today = new Date().toISOString().slice(0, 10);
const periodStartDefault = new Date(Date.now() - 29 * 86_400_000)
  .toISOString()
  .slice(0, 10);
const reviewDueDefault = new Date(Date.now() + 7 * 86_400_000)
  .toISOString()
  .slice(0, 10);

const severityStyle: Record<string, string> = {
  critical: "border-red-400/35 bg-red-400/10 text-red-100",
  high: "border-amber-400/35 bg-amber-400/10 text-amber-100",
  medium: "border-cyan-400/30 bg-cyan-400/10 text-cyan-100",
  information: "border-white/10 bg-white/4 text-slate-200",
};

function title(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function factValue(value: unknown): string {
  if (value === null || value === undefined) return "Not recorded";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return value.toLocaleString();
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

export function MaintenanceExecutiveAgentWorkbench() {
  const navigate = useNavigate();
  const { data, loading, error, refetch } = useAsyncData(
    loadMaintenanceExecutiveWorkspace,
    [],
    { isEmpty: () => false },
  );
  const [periodStart, setPeriodStart] = useState(periodStartDefault);
  const [periodEnd, setPeriodEnd] = useState(today);
  const [briefId, setBriefId] = useState("");
  const [reviewerId, setReviewerId] = useState("");
  const [priorityKey, setPriorityKey] = useState("");
  const [reviewDue, setReviewDue] = useState(reviewDueDefault);
  const [reviewNote, setReviewNote] = useState(
    "Independently verify source coverage, facts, priorities and decision routes before executive use.",
  );
  const [disposition, setDisposition] =
    useState<MaintenanceExecutiveDisposition["disposition"]>("acknowledged");
  const [dispositionNote, setDispositionNote] = useState(
    "Independent review confirms the recorded fact and preserves all approval and operational authority with the named human owner.",
  );
  const [actionReference, setActionReference] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState<{
    kind: "ok" | "error";
    text: string;
  } | null>(null);

  useEffect(() => {
    if (!briefId && data?.briefs[0]) setBriefId(data.briefs[0].id);
  }, [briefId, data]);

  const brief = useMemo(
    () => data?.briefs.find((item) => item.id === briefId) ?? null,
    [briefId, data],
  );
  const reviewerOptions = useMemo(
    () =>
      (data?.reviewers ?? []).filter(
        (reviewer) =>
          reviewer.id !== brief?.createdBy &&
          (reviewer.role === "admin" ||
            reviewer.role === brief?.audienceRole ||
            (brief?.audienceRole === "maintenance_manager" &&
              reviewer.role === "executive")) &&
          (brief?.informationSensitivity !== "restricted" ||
            reviewer.role === "executive" ||
            reviewer.role === "admin"),
      ),
    [
      brief?.audienceRole,
      brief?.createdBy,
      brief?.informationSensitivity,
      data?.reviewers,
    ],
  );

  useEffect(() => {
    if (!brief) return;
    if (!reviewerOptions.some((reviewer) => reviewer.id === reviewerId)) {
      setReviewerId(reviewerOptions[0]?.id ?? "");
    }
  }, [brief, reviewerId, reviewerOptions]);

  useEffect(() => {
    if (!brief) return;
    const disposed = new Set(
      brief.dispositions.map((item) => item.priorityKey),
    );
    setPriorityKey(
      brief.priorities.find((item) => !disposed.has(item.priorityKey))
        ?.priorityKey ??
        brief.priorities[0]?.priorityKey ??
        "",
    );
  }, [brief]);

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
            : "The governed executive action failed.",
      });
    } finally {
      setBusy("");
    }
  }

  if (loading && !data)
    return <LoadingState label="Loading Maintenance Executive Specialist" />;
  if (error && !data) return <ErrorState message={error} onRetry={refetch} />;

  const disposed = new Set(
    brief?.dispositions.map((item) => item.priorityKey) ?? [],
  );

  return (
    <section className="overflow-hidden rounded-2xl border border-violet-400/20 bg-[#0c0b18]">
      <div className="border-b border-white/8 bg-[radial-gradient(circle_at_top_right,rgba(167,139,250,0.15),transparent_48%)] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-violet-300">
              <Bot className="h-4 w-4" aria-hidden /> Maintenance Executive
              Specialist
            </div>
            <h2 className="text-xl font-semibold text-white">
              Enterprise evidence to a controlled executive decision brief
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              The specialist freezes the canonical KPI, budget, risk, strategy,
              governance and verified-value populations. It frames decision
              questions; it cannot approve, accept risk, commit spend, release
              work, change strategy or alter a KPI target.
            </p>
          </div>
          <div className="grid min-w-80 grid-cols-2 gap-3">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Period start
              <input
                aria-label="Executive brief period start"
                className={input}
                type="date"
                value={periodStart}
                onChange={(event) => setPeriodStart(event.target.value)}
              />
            </label>
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Period end
              <input
                aria-label="Executive brief period end"
                className={input}
                type="date"
                max={today}
                value={periodEnd}
                onChange={(event) => setPeriodEnd(event.target.value)}
              />
            </label>
            <button
              type="button"
              disabled={busy !== ""}
              onClick={() =>
                act(
                  "run",
                  async () => {
                    await runMaintenanceExecutiveAgent({
                      periodStart,
                      periodEnd,
                    });
                  },
                  "Immutable maintenance-executive brief generated.",
                )
              }
              className="col-span-2 inline-flex items-center justify-center gap-2 rounded-lg bg-violet-300 px-4 py-2 text-sm font-semibold text-violet-950 hover:bg-violet-200 disabled:opacity-50"
            >
              <BriefcaseBusiness className="h-4 w-4" aria-hidden />
              {busy === "run" ? "Assembling…" : "Assemble retained brief"}
            </button>
          </div>
        </div>
        {notice && (
          <p
            role="status"
            className={`mt-4 rounded-lg border px-3 py-2 text-sm ${
              notice.kind === "ok"
                ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-100"
                : "border-red-400/30 bg-red-400/10 text-red-100"
            }`}
          >
            {notice.text}
          </p>
        )}
      </div>

      <div className="grid gap-5 p-5 xl:grid-cols-[1.35fr_0.65fr]">
        <div className="space-y-5">
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
            Retained brief
            <select
              className={input}
              value={briefId}
              onChange={(event) => setBriefId(event.target.value)}
            >
              <option value="">No retained brief yet</option>
              {(data?.briefs ?? []).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.periodStart} → {item.periodEnd} ·{" "}
                  {item.priorities.length} priorities
                </option>
              ))}
            </select>
          </label>

          {brief ? (
            <>
              <div className="flex flex-wrap gap-2 text-xs text-slate-300">
                <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/4 px-2.5 py-1">
                  <CalendarRange className="h-3.5 w-3.5" aria-hidden />
                  {brief.periodStart} → {brief.periodEnd}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/4 px-2.5 py-1">
                  <Fingerprint className="h-3.5 w-3.5" aria-hidden /> exact
                  source digests retained
                </span>
                <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/4 px-2.5 py-1">
                  <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
                  {title(brief.informationSensitivity)} handling ·{" "}
                  {title(brief.audienceRole)} audience
                </span>
              </div>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {Object.entries(brief.facts)
                  .filter(([key]) => key !== "period")
                  .map(([section, values]) => (
                    <article
                      key={section}
                      className="rounded-xl border border-white/8 bg-white/3 p-4"
                    >
                      <h3 className="text-sm font-semibold text-white">
                        {title(section)}
                      </h3>
                      <dl className="mt-3 space-y-2 text-xs">
                        {Object.entries(values).map(([key, value]) => (
                          <div
                            key={key}
                            className="flex items-start justify-between gap-3"
                          >
                            <dt className="text-slate-400">{title(key)}</dt>
                            <dd className="max-w-[60%] break-words text-right font-medium text-slate-100">
                              {factValue(value)}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </article>
                  ))}
              </div>

              <div className="space-y-3">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-300">
                  Governed decision questions
                </h3>
                {brief.priorities.map((priority) => (
                  <article
                    key={priority.priorityKey}
                    className={`rounded-xl border p-4 ${
                      severityStyle[priority.severity] ??
                      severityStyle.information
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-semibold uppercase tracking-wide">
                        {title(priority.category)} · {priority.severity}
                      </p>
                      {disposed.has(priority.priorityKey) && (
                        <span className="inline-flex items-center gap-1 text-xs text-emerald-200">
                          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                          independently reviewed
                        </span>
                      )}
                    </div>
                    <p className="mt-2 text-sm">{priority.observed}</p>
                    <p className="mt-2 text-sm font-medium text-white">
                      {priority.decisionQuestion}
                    </p>
                    <button
                      type="button"
                      onClick={() => navigate(priority.route)}
                      className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-violet-200 hover:text-white"
                    >
                      Open canonical workspace{" "}
                      <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  </article>
                ))}
              </div>

              <details className="rounded-xl border border-white/8 bg-white/3 p-4 text-xs text-slate-300">
                <summary className="cursor-pointer font-semibold text-white">
                  Evidence limitations and retained fingerprints
                </summary>
                <ul className="mt-3 list-disc space-y-2 pl-5">
                  {brief.limitations.map((limitation) => (
                    <li key={limitation}>{limitation}</li>
                  ))}
                </ul>
                <pre className="mt-4 max-h-64 overflow-auto rounded-lg bg-black/30 p-3 text-[10px] text-slate-400">
                  {JSON.stringify(brief.sourceSnapshot, null, 2)}
                </pre>
              </details>
            </>
          ) : (
            <div className="rounded-xl border border-dashed border-white/12 p-8 text-center text-sm text-slate-400">
              Assemble the first retained brief from a completed reporting
              window. Missing records remain visible as gaps; they are never
              replaced with demo values.
            </div>
          )}
        </div>

        <aside className="space-y-4">
          <div className="rounded-xl border border-white/8 bg-white/3 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <ShieldCheck className="h-4 w-4 text-violet-300" aria-hidden />
              Independent review
            </div>
            <p className="mt-2 text-xs leading-5 text-slate-400">
              The requester cannot review the same brief. A disposition is a
              receipt only; it grants no financial, risk, strategy or operating
              authority.
            </p>
            <label className="mt-4 block text-xs text-slate-400">
              Reviewer
              <select
                className={input}
                value={reviewerId}
                onChange={(event) => setReviewerId(event.target.value)}
              >
                <option value="">Select a different named human…</option>
                {reviewerOptions.map((reviewer) => (
                  <option key={reviewer.id} value={reviewer.id}>
                    {reviewer.name ?? reviewer.email ?? reviewer.id} ·{" "}
                    {title(reviewer.role)}
                  </option>
                ))}
              </select>
            </label>
            <label className="mt-3 block text-xs text-slate-400">
              Review due
              <input
                aria-label="Executive brief review due"
                className={input}
                type="date"
                min={today}
                value={reviewDue}
                onChange={(event) => setReviewDue(event.target.value)}
              />
            </label>
            <label className="mt-3 block text-xs text-slate-400">
              Assignment basis
              <textarea
                className={`${input} min-h-24`}
                value={reviewNote}
                onChange={(event) => setReviewNote(event.target.value)}
              />
            </label>
            <button
              type="button"
              disabled={!brief || !reviewerId || busy !== ""}
              onClick={() =>
                act(
                  "assign",
                  async () => {
                    if (!brief) return;
                    await assignMaintenanceExecutiveReview({
                      briefId: brief.id,
                      assignedTo: reviewerId,
                      dueDate: reviewDue,
                      note: reviewNote,
                    });
                  },
                  "Independent reviewer assigned.",
                )
              }
              className="mt-3 w-full rounded-lg border border-violet-300/30 bg-violet-300/10 px-3 py-2 text-sm font-semibold text-violet-100 hover:bg-violet-300/15 disabled:opacity-50"
            >
              Assign independent review
            </button>
          </div>

          <div className="rounded-xl border border-white/8 bg-white/3 p-4">
            <h3 className="text-sm font-semibold text-white">
              Record review receipt
            </h3>
            <label className="mt-3 block text-xs text-slate-400">
              Priority
              <select
                className={input}
                value={priorityKey}
                onChange={(event) => setPriorityKey(event.target.value)}
              >
                {(brief?.priorities ?? []).map((priority) => (
                  <option
                    key={priority.priorityKey}
                    value={priority.priorityKey}
                  >
                    {title(priority.priorityKey)}
                  </option>
                ))}
              </select>
            </label>
            <label className="mt-3 block text-xs text-slate-400">
              Disposition
              <select
                className={input}
                value={disposition}
                onChange={(event) =>
                  setDisposition(
                    event.target
                      .value as MaintenanceExecutiveDisposition["disposition"],
                  )
                }
              >
                <option value="acknowledged">Acknowledged</option>
                <option value="route_for_action">
                  Route to canonical action
                </option>
                <option value="deferred">Deferred</option>
                <option value="rejected">Rejected</option>
              </select>
            </label>
            {disposition === "route_for_action" && (
              <label className="mt-3 block text-xs text-slate-400">
                Canonical action reference
                <input
                  className={input}
                  value={actionReference}
                  placeholder="Recommendation, risk or work-order ID"
                  onChange={(event) => setActionReference(event.target.value)}
                />
              </label>
            )}
            <label className="mt-3 block text-xs text-slate-400">
              Review note
              <textarea
                className={`${input} min-h-28`}
                value={dispositionNote}
                onChange={(event) => setDispositionNote(event.target.value)}
              />
            </label>
            <button
              type="button"
              disabled={!brief || !priorityKey || busy !== ""}
              onClick={() =>
                act(
                  "dispose",
                  async () => {
                    if (!brief) return;
                    await recordMaintenanceExecutiveDisposition({
                      briefId: brief.id,
                      priorityKey,
                      disposition,
                      note: dispositionNote,
                      actionReference,
                    });
                  },
                  "Immutable review receipt recorded without granting authority.",
                )
              }
              className="mt-3 w-full rounded-lg bg-white px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-slate-100 disabled:opacity-50"
            >
              Record independent disposition
            </button>
          </div>
        </aside>
      </div>
    </section>
  );
}
