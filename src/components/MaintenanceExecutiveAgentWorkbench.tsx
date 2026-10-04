import { useEffect, useMemo, useState } from "react";
import { Bot, ClipboardCheck, Landmark, ShieldCheck } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import {
  acknowledgeMaintenanceExecutiveBriefing,
  assignMaintenanceExecutiveReview,
  loadMaintenanceExecutiveWorkspace,
  runMaintenanceExecutiveAgent,
} from "../services/maintenanceExecutiveAgentService";
import { ErrorState, LoadingState } from "./ui/AsyncStates";
import { useAuth } from "./AuthProvider";

const input =
  "mt-1 w-full rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm text-white";
const defaultDue = new Date(Date.now() + 7 * 86_400_000)
  .toISOString()
  .slice(0, 10);

function value(record: Record<string, unknown>, key: string): string {
  const found = record[key];
  if (found === null || found === undefined) return "—";
  return typeof found === "object" ? JSON.stringify(found) : String(found);
}

const sections = [
  ["performance", "Performance"],
  ["governance", "Governance"],
  ["budgets", "Budgets"],
  ["risks", "Risk"],
  ["strategy", "Strategy"],
] as const;

function AuthorizedMaintenanceExecutiveAgentWorkbench({
  currentUserId,
}: {
  currentUserId: string;
}) {
  const { data, loading, error, refetch } = useAsyncData(
    loadMaintenanceExecutiveWorkspace,
    [],
    { isEmpty: () => false },
  );
  const [briefingId, setBriefingId] = useState("");
  const [reviewerId, setReviewerId] = useState("");
  const [dueDate, setDueDate] = useState(defaultDue);
  const [assignmentNote, setAssignmentNote] = useState(
    "Independently verify the source fingerprints, enterprise facts, evidence gaps and stated authority boundary.",
  );
  const [reviewNote, setReviewNote] = useState(
    "",
  );
  const [disposition, setDisposition] = useState<
    "acknowledged" | "challenged" | "update_requested"
  >("acknowledged");
  const [evidenceReference, setEvidenceReference] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState<{
    kind: "ok" | "error";
    text: string;
  } | null>(null);

  useEffect(() => {
    if (!briefingId && data?.briefings[0]) setBriefingId(data.briefings[0].id);
    if (!reviewerId && data?.reviewers[0]) setReviewerId(data.reviewers[0].id);
  }, [briefingId, data, reviewerId]);

  const briefing = useMemo(
    () => data?.briefings.find((item) => item.id === briefingId) ?? null,
    [briefingId, data],
  );
  const assignedToCurrentUser = Boolean(
    briefing?.assignments.some((item) => item.assignedTo === currentUserId),
  );
  const currentUserReceipt = briefing?.acknowledgements.find(
    (item) => item.reviewedBy === currentUserId,
  );

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
            : "The governed executive-agent action failed.",
      });
    } finally {
      setBusy("");
    }
  }

  if (loading && !data)
    return <LoadingState label="Loading Maintenance Executive agent" />;
  if (error && !data) return <ErrorState message={error} onRetry={refetch} />;

  return (
    <section
      className="overflow-hidden rounded-2xl border border-teal-400/20 bg-[#07131a]"
      data-testid="maintenance-executive-agent"
    >
      <div className="border-b border-white/8 bg-[radial-gradient(circle_at_top_right,rgba(45,212,191,0.14),transparent_46%)] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-teal-300">
              <Bot className="h-4 w-4" aria-hidden /> Maintenance Executive
            </div>
            <h2 className="text-xl font-semibold text-white">
              Enterprise evidence to independent executive review
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              The agent freezes KPI, governance, budget, risk and strategy
              evidence into an immutable briefing. It cannot approve, accept
              risk, adopt strategy, commit spend, release work, change limits or
              return equipment to service.
            </p>
          </div>
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() =>
              void act(
                "run",
                async () => {
                  const receipt = await runMaintenanceExecutiveAgent();
                  setBriefingId(receipt.briefingId);
                },
                "Retained executive briefing created from exact source fingerprints. No approval or operational action was created.",
              )
            }
            className="rounded-lg bg-teal-300 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-40"
          >
            {busy === "run" ? "Preparing…" : "Run retained briefing"}
          </button>
        </div>
        {notice && (
          <p
            className={`mt-4 rounded-lg border px-3 py-2 text-sm ${
              notice.kind === "ok"
                ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
                : "border-red-400/30 bg-red-400/10 text-red-200"
            }`}
          >
            {notice.text}
          </p>
        )}
      </div>

      <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Retained briefing
            <select
              className={input}
              value={briefingId}
              onChange={(event) => setBriefingId(event.target.value)}
            >
              <option value="">No briefing yet</option>
              {(data?.briefings ?? []).map((item) => (
                <option key={item.id} value={item.id}>
                  {new Date(item.asOf).toLocaleString()} ·{" "}
                  {item.evidenceGaps.length} gap(s)
                </option>
              ))}
            </select>
          </label>

          {briefing ? (
            <div className="mt-4 space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                {sections.map(([key, title]) => {
                  const record = briefing[key];
                  const first = Object.keys(record)[0];
                  return (
                    <article
                      key={key}
                      className="rounded-xl border border-white/8 bg-white/3 p-3"
                    >
                      <p className="text-xs font-semibold uppercase tracking-wide text-teal-300">
                        {title}
                      </p>
                      <p className="mt-2 text-lg font-semibold text-white">
                        {first ? value(record, first) : "—"}
                      </p>
                      <p className="mt-1 text-xs text-slate-400">
                        {first?.replaceAll("_", " ") ?? "No recorded fact"}
                      </p>
                    </article>
                  );
                })}
              </div>

              <article className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-4">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-amber-200">
                  <Landmark className="h-4 w-4" aria-hidden /> Evidence gaps
                </h3>
                <ul className="mt-3 space-y-2 text-sm text-slate-300">
                  {briefing.evidenceGaps.map((gap, index) => (
                    <li
                      key={`${String(gap.key)}-${index}`}
                      className="rounded-lg border border-white/8 bg-black/15 px-3 py-2"
                    >
                      <span className="font-medium text-white">
                        {String(gap.key ?? "recorded_gap").replaceAll("_", " ")}
                      </span>
                      {gap.count !== undefined
                        ? ` · ${String(gap.count)} record(s)`
                        : ""}
                    </li>
                  ))}
                </ul>
              </article>

              <article className="rounded-xl border border-white/8 bg-white/3 p-4">
                <h3 className="text-sm font-semibold text-white">
                  Independent review trail
                </h3>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Assignments
                    </p>
                    {briefing.assignments.length ? (
                      <ul className="mt-2 space-y-2 text-xs text-slate-300">
                        {briefing.assignments.map((item) => (
                          <li key={item.id}>
                            {item.reviewerName ?? item.reviewerEmail ?? item.assignedTo}
                            {" · due "}
                            {item.dueDate}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 text-xs text-amber-200">
                        No independent reviewer assigned.
                      </p>
                    )}
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Receipts
                    </p>
                    {briefing.acknowledgements.length ? (
                      <ul className="mt-2 space-y-2 text-xs text-slate-300">
                        {briefing.acknowledgements.map((item) => (
                          <li key={item.id}>
                            {item.reviewerName ?? item.reviewedBy}
                            {" · "}
                            {item.disposition.replaceAll("_", " ")}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 text-xs text-slate-400">
                        No review receipt recorded.
                      </p>
                    )}
                  </div>
                </div>
              </article>

              <details className="rounded-xl border border-white/8 bg-white/3 p-4">
                <summary className="cursor-pointer text-sm font-semibold text-slate-200">
                  Source fingerprints and limitations
                </summary>
                <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-xs text-slate-400">
                  {JSON.stringify(briefing.sourceSnapshot, null, 2)}
                </pre>
                <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-slate-400">
                  {briefing.limitations.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </details>
            </div>
          ) : (
            <p className="mt-4 rounded-xl border border-dashed border-white/10 p-5 text-sm text-slate-400">
              Run the agent to create the first immutable enterprise briefing.
            </p>
          )}
        </div>

        <aside className="space-y-4">
          <div className="rounded-xl border border-white/8 bg-white/3 p-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
              <ClipboardCheck className="h-4 w-4 text-teal-300" aria-hidden />{" "}
              Independent review
            </h3>
            <label className="mt-3 block text-xs text-slate-400">
              Reviewer
              <select
                className={input}
                value={reviewerId}
                onChange={(event) => setReviewerId(event.target.value)}
              >
                <option value="">Select reviewer…</option>
                {(data?.reviewers ?? []).map((reviewer) => (
                  <option key={reviewer.id} value={reviewer.id}>
                    {reviewer.name ?? reviewer.email ?? reviewer.id} ·{" "}
                    {reviewer.role.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </label>
            <label className="mt-3 block text-xs text-slate-400">
              Due date
              <input
                className={input}
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
              />
            </label>
            <label className="mt-3 block text-xs text-slate-400">
              Review assignment basis
              <textarea
                className={input}
                rows={3}
                value={assignmentNote}
                onChange={(event) => setAssignmentNote(event.target.value)}
              />
            </label>
            <button
              type="button"
              disabled={
                !briefing ||
                !reviewerId ||
                assignmentNote.trim().length < 10 ||
                Boolean(busy)
              }
              onClick={() =>
                void act(
                  "assign",
                  async () => {
                    if (!briefing) return;
                    await assignMaintenanceExecutiveReview({
                      briefingId: briefing.id,
                      assignedTo: reviewerId,
                      dueDate,
                      note: assignmentNote,
                    });
                  },
                  "Independent review assigned. The briefing remains advisory.",
                )
              }
              className="mt-3 w-full rounded-lg border border-teal-300/30 bg-teal-300/10 px-3 py-2 text-sm font-semibold text-teal-100 disabled:opacity-40"
            >
              Assign independent review
            </button>
          </div>

          <div className="rounded-xl border border-white/8 bg-white/3 p-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
              <ShieldCheck className="h-4 w-4 text-teal-300" aria-hidden />{" "}
              Review receipt
            </h3>
            <label className="mt-3 block text-xs text-slate-400">
              Disposition
              <select
                className={input}
                value={disposition}
                onChange={(event) =>
                  setDisposition(event.target.value as typeof disposition)
                }
              >
                <option value="acknowledged">Acknowledged</option>
                <option value="challenged">Challenged</option>
                <option value="update_requested">Update requested</option>
              </select>
            </label>
            <label className="mt-3 block text-xs text-slate-400">
              Review note
              <textarea
                className={input}
                rows={4}
                value={reviewNote}
                onChange={(event) => setReviewNote(event.target.value)}
              />
            </label>
            <label className="mt-3 block text-xs text-slate-400">
              Evidence reference (optional)
              <input
                className={input}
                value={evidenceReference}
                onChange={(event) => setEvidenceReference(event.target.value)}
              />
            </label>
            <button
              type="button"
              disabled={
                !briefing ||
                !assignedToCurrentUser ||
                Boolean(currentUserReceipt) ||
                reviewNote.trim().length < 20 ||
                Boolean(busy)
              }
              onClick={() =>
                void act(
                  "acknowledge",
                  async () => {
                    if (!briefing) return;
                    await acknowledgeMaintenanceExecutiveBriefing({
                      briefingId: briefing.id,
                      disposition,
                      reviewNote,
                      evidenceReference,
                    });
                  },
                  "Review receipt recorded. It creates no approval, risk acceptance, strategy adoption, spend commitment or operational authorization.",
                )
              }
              className="mt-3 w-full rounded-lg bg-teal-300 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-40"
            >
              Record review receipt
            </button>
            {briefing && !assignedToCurrentUser && (
              <p className="mt-2 text-xs text-amber-200">
                Only the assigned independent reviewer can record this receipt.
              </p>
            )}
            {currentUserReceipt && (
              <p className="mt-2 text-xs text-emerald-200">
                Your {currentUserReceipt.disposition.replaceAll("_", " ")} receipt
                is retained and cannot be overwritten.
              </p>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}

export function MaintenanceExecutiveAgentWorkbench() {
  const { profile, user } = useAuth();
  if (
    !user ||
    (profile?.role !== "executive" && profile?.role !== "admin")
  )
    return null;
  return <AuthorizedMaintenanceExecutiveAgentWorkbench currentUserId={user.id} />;
}
