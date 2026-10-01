import { useEffect, useState } from "react";
import { Activity, Bot, ClipboardCheck, UserRoundCheck } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import {
  assignConditionMonitoringReview,
  loadConditionAgentWorkspace,
  runConditionMonitoringAgent,
} from "../services/conditionMonitoringAgentService";
import { ErrorState, LoadingState } from "./ui/AsyncStates";

const defaultDue = new Date(Date.now() + 7 * 86_400_000)
  .toISOString()
  .slice(0, 10);

function readable(value: string) {
  return value.replaceAll("_", " ");
}

export function ConditionMonitoringAgentWorkbench() {
  const { data, loading, error, refetch } = useAsyncData(
    loadConditionAgentWorkspace,
    [],
    { isEmpty: () => false },
  );
  const [sensorId, setSensorId] = useState("");
  const [windowDays, setWindowDays] = useState(30);
  const [packId, setPackId] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [dueDate, setDueDate] = useState(defaultDue);
  const [note, setNote] = useState(
    "Review signal evidence, operating context and required follow-up.",
  );
  const [busy, setBusy] = useState<"run" | "assign" | null>(null);
  const [notice, setNotice] = useState<{
    kind: "ok" | "error";
    text: string;
  } | null>(null);

  useEffect(() => {
    if (!sensorId && data?.sensors?.[0])
      setSensorId(data.sensors[0].sensorId);
    if (!packId && data?.packs?.[0]) setPackId(data.packs[0].packId);
    if (!ownerId && data?.members?.[0]) setOwnerId(data.members[0].id);
  }, [data, ownerId, packId, sensorId]);

  const pack = data?.packs?.find((item) => item.packId === packId) ?? null;

  async function act(kind: "run" | "assign", fn: () => Promise<void>) {
    setBusy(kind);
    setNotice(null);
    try {
      await fn();
      setNotice({
        kind: "ok",
        text:
          kind === "run"
            ? "Immutable signal assessment created from exact condition and operating-context evidence."
            : "Named-human review ownership recorded. No operational action was taken.",
      });
      await refetch();
    } catch (actionError) {
      setNotice({
        kind: "error",
        text:
          actionError instanceof Error
            ? actionError.message
            : "Governed condition action failed.",
      });
    } finally {
      setBusy(null);
    }
  }

  if (loading && !data)
    return <LoadingState label="Loading Condition Monitoring Analyst" />;
  if (error && !data) return <ErrorState message={error} onRetry={refetch} />;

  return (
    <section className="overflow-hidden rounded-2xl border border-cyan-400/20 bg-[#07131a]">
      <div className="border-b border-white/8 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.12),transparent_48%)] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">
              <Bot className="h-4 w-4" aria-hidden /> Condition Monitoring
              Analyst
            </div>
            <h3 className="text-xl font-semibold text-white">
              Governed signal interpretation
            </h3>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              Screen vibration, oil, thermography, motor-current and process
              signals against their recorded limits and exact-time duty. The
              agent freezes every source row and exposes evidence gaps; it does
              not diagnose failures or execute maintenance decisions.
            </p>
          </div>
          <div className="grid min-w-80 gap-2 sm:grid-cols-[minmax(0,1fr)_92px_auto]">
            <select
              aria-label="Condition sensor"
              value={sensorId}
              onChange={(event) => setSensorId(event.target.value)}
              className="min-w-0 rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm text-white"
            >
              <option value="">Select sensor…</option>
              {(data?.sensors ?? []).map((sensor) => (
                <option key={sensor.sensorId} value={sensor.sensorId}>
                  {sensor.assetTag} · {sensor.name} · {sensor.readingCount} rows
                </option>
              ))}
            </select>
            <select
              aria-label="Assessment window"
              value={windowDays}
              onChange={(event) => setWindowDays(Number(event.target.value))}
              className="rounded-lg border border-white/10 bg-black/25 px-2 py-2 text-sm text-white"
            >
              <option value={7}>7 days</option>
              <option value={30}>30 days</option>
              <option value={90}>90 days</option>
              <option value={365}>365 days</option>
            </select>
            <button
              type="button"
              disabled={!sensorId || busy !== null}
              onClick={() =>
                act("run", () =>
                  runConditionMonitoringAgent({ sensorId, windowDays }),
                )
              }
              className="rounded-lg bg-cyan-300 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-200 disabled:opacity-40"
            >
              {busy === "run" ? "Screening…" : "Run assessment"}
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-5 p-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Retained assessment
            <select
              value={packId}
              onChange={(event) => setPackId(event.target.value)}
              className="mt-2 w-full rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm normal-case tracking-normal text-white"
            >
              <option value="">No retained assessment</option>
              {(data?.packs ?? []).map((item) => (
                <option key={item.packId} value={item.packId}>
                  {item.assetTag} · {item.sensorName} ·{" "}
                  {new Date(item.createdAt).toLocaleDateString()}
                </option>
              ))}
            </select>
          </label>
          <p className="mt-3 text-xs leading-5 text-slate-500">{data?.basis}</p>
        </div>

        {pack ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-white/8 bg-white/[0.025] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h4 className="font-semibold text-white">
                    {pack.assetTag} · {pack.sensorName}
                  </h4>
                  <p className="mt-1 text-xs text-slate-500">
                    {readable(pack.assessment.modality)} · {pack.windowDays}-day
                    window · retained run {pack.agentRunId.slice(0, 8)}
                  </p>
                </div>
                <span className="rounded-full border border-cyan-400/25 bg-cyan-400/10 px-2 py-1 text-xs font-semibold text-cyan-200">
                  {readable(pack.assessment.signalState)}
                </span>
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-300">
                {pack.assessment.interpretation}
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Metric
                label="Good readings"
                value={pack.assessment.population.good}
              />
              <Metric
                label="Context known"
                value={`${pack.assessment.population.contextKnown}/${pack.assessment.population.retained}`}
              />
              <Metric
                label="Plant-backed"
                value={`${pack.assessment.population.connectorBacked}/${pack.assessment.population.retained}`}
              />
              <Metric label="Trend" value={readable(pack.assessment.trend)} />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-white/8 p-4">
                <h5 className="flex items-center gap-2 text-sm font-semibold text-white">
                  <Activity className="h-4 w-4 text-cyan-300" aria-hidden />
                  Evidence gaps
                </h5>
                {pack.assessment.evidenceGaps.length ? (
                  <ul className="mt-3 space-y-2">
                    {pack.assessment.evidenceGaps.map((gap) => (
                      <li
                        key={gap.code}
                        className="text-sm leading-5 text-slate-300"
                      >
                        <span className="mr-2 text-xs font-semibold uppercase text-amber-300">
                          {gap.severity}
                        </span>
                        {gap.detail}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3 text-sm text-slate-400">
                    No configured evidence gaps were found. Human review is
                    still mandatory.
                  </p>
                )}
              </div>
              <div className="rounded-xl border border-white/8 p-4">
                <h5 className="flex items-center gap-2 text-sm font-semibold text-white">
                  <ClipboardCheck
                    className="h-4 w-4 text-cyan-300"
                    aria-hidden
                  />
                  Modality evidence plan
                </h5>
                <ol className="mt-3 space-y-2">
                  {pack.assessment.evidencePlan.map((step) => (
                    <li key={step.sequence} className="flex gap-3 text-sm">
                      <span className="font-mono text-cyan-300">
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
            </div>

            <div className="rounded-xl border border-white/8 p-4">
              <h5 className="flex items-center gap-2 text-sm font-semibold text-white">
                <UserRoundCheck className="h-4 w-4 text-cyan-300" aria-hidden />
                Named-human review
              </h5>
              {pack.assignment ? (
                <p className="mt-2 text-sm text-slate-300">
                  {pack.assignment.ownerName} owns review by{" "}
                  {pack.assignment.dueDate}. {pack.assignment.note}
                </p>
              ) : (
                <div className="mt-3 grid gap-2 md:grid-cols-[minmax(0,1fr)_140px_minmax(0,1.4fr)_auto]">
                  <select
                    aria-label="Condition review owner"
                    value={ownerId}
                    onChange={(event) => setOwnerId(event.target.value)}
                    className="rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm text-white"
                  >
                    <option value="">Select reviewer…</option>
                    {(data?.members ?? []).map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name} · {member.role}
                      </option>
                    ))}
                  </select>
                  <input
                    aria-label="Condition review due date"
                    type="date"
                    value={dueDate}
                    onChange={(event) => setDueDate(event.target.value)}
                    className="rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm text-white"
                  />
                  <input
                    aria-label="Condition review note"
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    className="rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm text-white"
                  />
                  <button
                    type="button"
                    disabled={
                      !ownerId ||
                      !dueDate ||
                      note.trim().length < 10 ||
                      busy !== null
                    }
                    onClick={() =>
                      act("assign", () =>
                        assignConditionMonitoringReview({
                          packId: pack.packId,
                          assignedTo: ownerId,
                          dueDate,
                          note,
                        }),
                      )
                    }
                    className="rounded-lg border border-cyan-300/30 px-3 py-2 text-sm font-semibold text-cyan-200 hover:bg-cyan-300/10 disabled:opacity-40"
                  >
                    {busy === "assign" ? "Assigning…" : "Assign review"}
                  </button>
                </div>
              )}
            </div>

            <div className="rounded-lg border border-amber-400/15 bg-amber-400/5 p-3 text-xs leading-5 text-amber-100/80">
              {pack.assessment.limitations.join(" ")}
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-white/10 p-8 text-center text-sm text-slate-500">
            Run a governed assessment to retain exact signal evidence and its
            human-review boundary.
          </div>
        )}
      </div>

      {notice ? (
        <div
          role="status"
          className={`border-t border-white/8 px-5 py-3 text-sm ${
            notice.kind === "ok" ? "text-emerald-300" : "text-rose-300"
          }`}
        >
          {notice.text}
        </div>
      ) : null}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-white/8 bg-black/10 p-3">
      <div className="text-xs uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold capitalize text-white">
        {value}
      </div>
    </div>
  );
}
