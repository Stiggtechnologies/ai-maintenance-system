import { useEffect, useState } from "react";
import {
  Bot,
  CheckCircle2,
  CircleAlert,
  ClipboardCheck,
  UserRoundCheck,
} from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import {
  assignFracasInvestigation,
  loadFracasWorkspace,
  runFracasAgent,
  startFracasVerification,
} from "../services/fracasAgentService";
import { ErrorState, LoadingState } from "./ui/AsyncStates";

const defaultDue = new Date(Date.now() + 14 * 86_400_000)
  .toISOString()
  .slice(0, 10);

export function FracasAgentWorkbench() {
  const { data, loading, error, refetch } = useAsyncData(
    loadFracasWorkspace,
    [],
    { isEmpty: () => false },
  );
  const [workOrderId, setWorkOrderId] = useState("");
  const [selectedPackId, setSelectedPackId] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [dueDate, setDueDate] = useState(defaultDue);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"run" | "assign" | "verify" | null>(null);
  const [notice, setNotice] = useState<{
    kind: "ok" | "error";
    text: string;
  } | null>(null);

  useEffect(() => {
    if (!workOrderId) {
      const candidate = data?.candidates.find((item) => !item.hasPack);
      if (candidate) setWorkOrderId(candidate.workOrderId);
    }
    if (!selectedPackId && data?.packs[0])
      setSelectedPackId(data.packs[0].packId);
    if (!ownerId && data?.members[0]) setOwnerId(data.members[0].id);
  }, [data, ownerId, selectedPackId, workOrderId]);

  const pack =
    data?.packs.find((item) => item.packId === selectedPackId) ?? null;

  async function act(
    kind: "run" | "assign" | "verify",
    fn: () => Promise<void>,
  ) {
    setBusy(kind);
    setNotice(null);
    try {
      await fn();
      setNotice({
        kind: "ok",
        text:
          kind === "run"
            ? "Immutable investigation pack created from the exact closeout and recurrence history."
            : kind === "assign"
              ? "Named-human ownership recorded in the append-only assignment history."
              : "Handed off to corrective-action verification; human attestations remain required.",
      });
      refetch();
    } catch (actionError) {
      setNotice({
        kind: "error",
        text:
          actionError instanceof Error
            ? actionError.message
            : "Governed action failed.",
      });
    } finally {
      setBusy(null);
    }
  }

  if (loading && !data)
    return <LoadingState label="Loading governed FRACAS workspace" />;
  if (error && !data) return <ErrorState message={error} onRetry={refetch} />;

  return (
    <section className="overflow-hidden rounded-2xl border border-violet-400/20 bg-[#0a111c]">
      <div className="border-b border-white/8 bg-[radial-gradient(circle_at_top_right,rgba(167,139,250,0.12),transparent_48%)] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-violet-300">
              <Bot className="h-4 w-4" aria-hidden /> RCA / FRACAS Investigator
            </div>
            <h2 className="text-xl font-semibold text-white">
              Closed-loop causal investigation
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              Build a retained case from completed corrective work, expose
              recurrence and evidence gaps, assign a named human, then hand off
              to measured corrective-action verification. Reported cause is
              never presented as verified root cause.
            </p>
          </div>
          <div className="flex min-w-72 gap-2">
            <select
              aria-label="Completed corrective work order"
              value={workOrderId}
              onChange={(event) => setWorkOrderId(event.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm text-white"
            >
              <option value="">Select completed corrective work…</option>
              {(data?.candidates ?? []).map((candidate) => (
                <option
                  key={candidate.workOrderId}
                  value={candidate.workOrderId}
                  disabled={candidate.hasPack}
                >
                  {candidate.workOrderNumber} · {candidate.assetTag}
                  {candidate.hasPack ? " · investigated" : ""}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!workOrderId || busy !== null}
              onClick={() =>
                act("run", async () => {
                  await runFracasAgent(workOrderId);
                  setWorkOrderId("");
                })
              }
              className="rounded-lg bg-violet-300 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-violet-200 disabled:opacity-40"
            >
              {busy === "run" ? "Building…" : "Build investigation"}
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-5 p-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Retained investigation
            <select
              value={selectedPackId}
              onChange={(event) => setSelectedPackId(event.target.value)}
              className="mt-2 w-full rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm normal-case tracking-normal text-white"
            >
              <option value="">No retained pack</option>
              {(data?.packs ?? []).map((item) => (
                <option key={item.packId} value={item.packId}>
                  {item.workOrderNumber} · {item.assetTag}
                </option>
              ))}
            </select>
          </label>
          <p className="mt-3 text-xs leading-5 text-slate-500">{data?.basis}</p>
        </div>

        {pack ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-white/8 bg-white/[0.025] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="font-semibold text-white">
                    {pack.workOrderNumber} · {pack.assetTag}
                  </h3>
                  <p className="mt-1 text-xs text-slate-500">
                    Pack {pack.packId.slice(0, 8)} · retained run{" "}
                    {pack.agentRunId.slice(0, 8)}
                  </p>
                </div>
                <span className="rounded-full border border-amber-400/25 bg-amber-400/10 px-2 py-1 text-xs font-semibold text-amber-300">
                  root cause unverified
                </span>
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-300">
                {pack.investigation.problemStatement}
              </p>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-xl border border-white/8 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Reported hypothesis
                </div>
                <p className="mt-2 text-sm text-slate-200">
                  {pack.investigation.hypotheses[0]?.statement}
                </p>
                <p className="mt-2 text-xs leading-5 text-amber-300">
                  {pack.investigation.hypotheses[0]?.warning}
                </p>
              </div>
              <div className="rounded-xl border border-white/8 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Recurrence reading
                </div>
                <div className="mt-2 text-3xl font-semibold text-white">
                  {pack.investigation.recurrence.matchingEvents}
                </div>
                <p className="mt-2 text-xs leading-5 text-slate-400">
                  {pack.investigation.recurrence.basis}
                </p>
              </div>
              <div className="rounded-xl border border-white/8 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Evidence gaps
                </div>
                <div className="mt-2 text-3xl font-semibold text-white">
                  {pack.investigation.evidenceGaps.length}
                </div>
                <p className="mt-2 text-xs text-slate-400">
                  Nothing missing was silently inferred.
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-white/8 p-4">
              <h4 className="flex items-center gap-2 text-sm font-semibold text-white">
                <ClipboardCheck
                  className="h-4 w-4 text-violet-300"
                  aria-hidden
                />{" "}
                Evidence plan
              </h4>
              <ol className="mt-3 space-y-2">
                {pack.investigation.evidencePlan.map((step) => (
                  <li key={step.sequence} className="flex gap-3 text-sm">
                    <span className="font-mono text-violet-300">
                      {step.sequence}
                    </span>
                    <div>
                      <div className="text-slate-200">{step.question}</div>
                      <div className="mt-0.5 text-xs text-slate-500">
                        {step.owner} · {step.completion}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </div>

            <div className="rounded-xl border border-white/8 bg-black/15 p-4">
              {pack.verification ? (
                <div className="flex items-center gap-2 text-sm text-teal-300">
                  <CheckCircle2 className="h-4 w-4" aria-hidden />
                  Verification {pack.verification.status} · effectiveness{" "}
                  {pack.verification.effectiveness}
                </div>
              ) : (
                <div className="grid gap-3 md:grid-cols-[1fr_150px_1.4fr_auto]">
                  <select
                    value={ownerId}
                    onChange={(event) => setOwnerId(event.target.value)}
                    className="rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm text-white"
                  >
                    <option value="">Named owner…</option>
                    {(data?.members ?? []).map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name} · {member.role}
                      </option>
                    ))}
                  </select>
                  <input
                    type="date"
                    value={dueDate}
                    min={new Date().toISOString().slice(0, 10)}
                    onChange={(event) => setDueDate(event.target.value)}
                    className="rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm text-white"
                  />
                  <input
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="Assignment basis and expected evidence"
                    className="rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm text-white"
                  />
                  <button
                    type="button"
                    disabled={
                      !ownerId || note.trim().length < 10 || busy !== null
                    }
                    onClick={() =>
                      act("assign", () =>
                        assignFracasInvestigation({
                          packId: pack.packId,
                          assignedTo: ownerId,
                          dueDate,
                          note,
                        }),
                      )
                    }
                    className="rounded-lg border border-violet-300/30 px-3 py-2 text-sm font-semibold text-violet-200 disabled:opacity-40"
                  >
                    {busy === "assign"
                      ? "Assigning…"
                      : pack.assignment
                        ? "Reassign"
                        : "Assign"}
                  </button>
                </div>
              )}
              {pack.assignment && !pack.verification && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-white/8 pt-3">
                  <div className="flex items-center gap-2 text-sm text-slate-300">
                    <UserRoundCheck
                      className="h-4 w-4 text-violet-300"
                      aria-hidden
                    />
                    {pack.assignment.ownerName} owns the investigation · due{" "}
                    {pack.assignment.dueDate}
                  </div>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() =>
                      act("verify", () => startFracasVerification(pack.packId))
                    }
                    className="rounded-lg bg-teal-300 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-40"
                  >
                    {busy === "verify"
                      ? "Starting…"
                      : "Start 90-day verification"}
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex min-h-56 items-center justify-center rounded-xl border border-dashed border-white/12 p-6 text-center text-sm text-slate-400">
            Select an eligible closeout and build the first governed
            investigation pack.
          </div>
        )}
      </div>

      {notice && (
        <div
          className={`mx-5 mb-5 flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${notice.kind === "ok" ? "border-teal-400/20 bg-teal-400/8 text-teal-200" : "border-red-400/20 bg-red-400/8 text-red-200"}`}
        >
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{" "}
          {notice.text}
        </div>
      )}
    </section>
  );
}
