import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  CalendarRange,
  GitBranch,
  LockKeyhole,
  PlayCircle,
  Plus,
  RefreshCw,
  ShieldCheck,
  UserCheck,
  Workflow,
} from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import {
  addOutageWork,
  assignTurnaroundReview,
  createTurnaroundSchedule,
  freezeOutageScope,
  linkOutageSchedule,
  linkTaskToWork,
  loadTurnaroundWorkspace,
  recordTurnaroundActivity,
  recordTurnaroundDependency,
  releaseTurnaroundScope,
  runTurnaroundAgent,
} from "../services/turnaroundAgentService";
import { ErrorState, LoadingState } from "./ui/AsyncStates";

const INPUT =
  "mt-1 w-full rounded border border-white/10 bg-overlook-deep px-3 py-2 text-sm text-white";
const BUTTON =
  "rounded-lg border border-signal-cyan/30 bg-signal-cyan/10 px-3 py-2 text-xs font-semibold text-signal-cyan disabled:opacity-50";

function localIso(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text ? new Date(text).toISOString() : null;
}

function Metric({ label, value, tone = "text-slate-200" }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="rounded-lg border border-white/6 bg-black/10 p-3">
      <dt className="text-[11px] uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={`mt-1 font-mono text-lg tabular-nums ${tone}`}>{value}</dd>
    </div>
  );
}

export function ShutdownTurnaroundAgentWorkbench() {
  const [windowId, setWindowId] = useState("");
  const [packId, setPackId] = useState("");
  const [busy, setBusy] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const { data, loading, error, refetch } = useAsyncData(loadTurnaroundWorkspace, []);

  useEffect(() => {
    if (!windowId && data?.windows[0]) setWindowId(data.windows[0].windowId);
  }, [data, windowId]);

  const selected = useMemo(
    () => data?.windows.find((window) => window.windowId === windowId) ?? null,
    [data, windowId],
  );
  const packs = useMemo(
    () => data?.packs.filter((pack) => !windowId || pack.windowId === windowId) ?? [],
    [data, windowId],
  );
  useEffect(() => {
    if (!packId && packs[0]) setPackId(packs[0].packId);
  }, [packs, packId]);
  const pack = packs.find((item) => item.packId === packId) ?? null;

  async function act(key: string, task: () => Promise<unknown>) {
    setBusy(key);
    setActionError(null);
    try {
      await task();
      await refetch();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "The governed action could not be completed.");
    } finally {
      setBusy("");
    }
  }

  if (loading) return <LoadingState label="Loading shutdown and turnaround controls" />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  const availableWork = data?.openWork.filter(
    (work) => !selected?.work.some((scope) => scope.workOrderId === work.workOrderId),
  ) ?? [];

  return (
    <section aria-labelledby="turnaround-agent-heading" className="space-y-4 rounded-2xl border border-signal-cyan/15 bg-signal-cyan/[0.025] p-4 lg:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="turnaround-agent-heading" className="flex items-center gap-2 text-lg font-semibold text-white">
            <Workflow className="h-5 w-5 text-signal-cyan" aria-hidden />
            Shutdown / Turnaround Specialist
          </h2>
          <p className="mt-1 max-w-4xl text-sm text-slate-300">
            One governed view of scope, sequence, work readiness, late additions and release readiness. The specialist retains evidence and proposes review; only named humans can change or release scope.
          </p>
        </div>
        <button
          type="button"
          disabled={!selected || Boolean(busy)}
          onClick={() => void act("run", async () => {
            if (!selected) return;
            const receipt = await runTurnaroundAgent(selected.windowId);
            setPackId(receipt.packId);
          })}
          className={BUTTON}
        >
          <RefreshCw className={`mr-1.5 inline h-3.5 w-3.5 ${busy === "run" ? "animate-spin" : ""}`} aria-hidden />
          {busy === "run" ? "Assessing…" : "Run retained assessment"}
        </button>
      </div>

      <label className="block max-w-xl text-xs text-slate-300">
        Outage window
        <select value={windowId} onChange={(event) => { setWindowId(event.target.value); setPackId(""); }} className={INPUT}>
          {(data?.windows ?? []).map((window) => (
            <option key={window.windowId} value={window.windowId}>
              {window.windowKey} · {window.title} · {window.status}
            </option>
          ))}
        </select>
      </label>

      {!selected ? (
        <p className="rounded-xl border border-white/6 bg-white/2 p-4 text-sm text-slate-400">
          Record an outage window above before building governed scope and sequence evidence.
        </p>
      ) : (
        <>
          <div className="rounded-xl border border-white/6 bg-overlook-deep/40 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-100">{selected.windowKey} · {selected.title}</h3>
                <p className="mt-1 text-xs text-slate-500">
                  {new Date(selected.startsAt).toLocaleString()} – {new Date(selected.endsAt).toLocaleString()} · {selected.kind} · {selected.siteName ?? "No site assigned"}
                </p>
              </div>
              <span className="rounded-full border border-white/10 px-2 py-1 text-xs text-slate-300">{selected.status}</span>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
              <Metric label="Scope" value={selected.readiness.scope.workOrders} />
              <Metric label="Tasks" value={selected.readiness.sequence.tasks} />
              <Metric label="Dependencies" value={selected.readiness.sequence.dependencies} />
              <Metric label="Late work" value={selected.readiness.scope.lateAdditions} tone={selected.readiness.scope.lateAdditions ? "text-amber-300" : "text-slate-200"} />
              <Metric label="Material blocks" value={selected.readiness.readiness.materialBlockedWork} tone={selected.readiness.readiness.materialBlockedWork ? "text-red-300" : "text-slate-200"} />
              <Metric label="Blockers" value={selected.readiness.blockers} tone={selected.readiness.blockers ? "text-red-300" : "text-green-300"} />
              <Metric label="Release" value={selected.readiness.releaseReady ? "READY" : "NOT READY"} tone={selected.readiness.releaseReady ? "text-green-300" : "text-amber-300"} />
            </dl>
            <p className="mt-3 text-xs leading-relaxed text-slate-400">{selected.readiness.basis}</p>
          </div>

          {actionError ? (
            <p role="alert" className="rounded-lg border border-red-500/25 bg-red-500/5 p-3 text-xs text-red-200">{actionError}</p>
          ) : null}

          <div className="grid gap-4 xl:grid-cols-2">
            <article className="space-y-3 rounded-xl border border-white/6 bg-overlook-deep/30 p-4">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                <CalendarRange className="h-4 w-4 text-signal-gold" aria-hidden /> Scope control
              </h3>
              <ul className="space-y-2">
                {selected.work.map((work) => (
                  <li key={work.outageWorkId} className="rounded-lg border border-white/5 p-3 text-xs">
                    <div className="flex flex-wrap justify-between gap-2">
                      <strong className="text-slate-200">{work.workOrderNumber ?? "Unnumbered"} · {work.title}</strong>
                      <span className={work.addedAfterFreeze ? "text-amber-300" : "text-slate-400"}>{work.addedAfterFreeze ? "Late addition" : "Base scope"}</span>
                    </div>
                    <p className="mt-1 text-slate-500">{work.plannedHours ?? "Unsized"} h · {work.linkedTaskCount} linked task(s){work.justification ? ` · ${work.justification}` : ""}</p>
                  </li>
                ))}
                {selected.work.length === 0 ? <li className="text-xs text-slate-500">No work is in scope.</li> : null}
              </ul>
              {selected.status !== "closed" && selected.status !== "cancelled" ? (
                <form
                  className="grid gap-2 rounded-lg border border-white/5 p-3 sm:grid-cols-[1fr_1fr_auto]"
                  onSubmit={(event: FormEvent<HTMLFormElement>) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    void act("add", () => addOutageWork(selected.windowKey, String(form.get("work")), String(form.get("justification") ?? "")));
                  }}
                >
                  <label className="text-xs text-slate-400">Open work<select name="work" required className={INPUT}><option value="">Select work</option>{availableWork.map((work) => <option key={work.workOrderId} value={work.workOrderId}>{work.workOrderNumber ?? "Unnumbered"} · {work.title}</option>)}</select></label>
                  <label className="text-xs text-slate-400">Justification {selected.status === "planned" ? "(optional)" : "(required)"}<input name="justification" minLength={selected.status === "planned" ? undefined : 20} required={selected.status !== "planned"} className={INPUT} placeholder="Why this work belongs in scope" /></label>
                  <button disabled={Boolean(busy)} className={`${BUTTON} self-end`}><Plus className="mr-1 inline h-3.5 w-3.5" aria-hidden />Add</button>
                </form>
              ) : null}
              {selected.status === "planned" ? (
                <form
                  className="flex flex-wrap items-end gap-2 rounded-lg border border-white/5 p-3"
                  onSubmit={(event: FormEvent<HTMLFormElement>) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    void act("freeze", () => freezeOutageScope(selected.windowId, String(form.get("note"))));
                  }}
                >
                  <label className="min-w-64 flex-1 text-xs text-slate-400">Freeze note<input name="note" required minLength={10} className={INPUT} placeholder="Scope basis and review point" /></label>
                  <button disabled={Boolean(busy)} className={BUTTON}><LockKeyhole className="mr-1 inline h-3.5 w-3.5" aria-hidden />Freeze scope</button>
                </form>
              ) : null}
              {selected.status === "frozen" ? (
                <form
                  className="flex flex-wrap items-end gap-2 rounded-lg border border-green-500/15 bg-green-500/[0.03] p-3"
                  onSubmit={(event: FormEvent<HTMLFormElement>) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    void act("release", () => releaseTurnaroundScope(selected.windowId, String(form.get("note"))));
                  }}
                >
                  <label className="min-w-64 flex-1 text-xs text-slate-400">Independent release note<input name="note" required minLength={20} className={INPUT} placeholder="Independent readiness and release basis" /></label>
                  <button disabled={Boolean(busy) || !selected.readiness.releaseReady} className={BUTTON}><PlayCircle className="mr-1 inline h-3.5 w-3.5" aria-hidden />Release controlled execution</button>
                </form>
              ) : null}
            </article>

            <article className="space-y-3 rounded-xl border border-white/6 bg-overlook-deep/30 p-4">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                <GitBranch className="h-4 w-4 text-signal-cyan" aria-hidden /> Canonical schedule graph
              </h3>
              {!selected.shutdownEventId ? (
                <div className="space-y-2">
                  <form
                    className="grid gap-2 rounded-lg border border-white/5 p-3 sm:grid-cols-[1fr_1fr_auto]"
                    onSubmit={(event: FormEvent<HTMLFormElement>) => {
                      event.preventDefault(); const form = new FormData(event.currentTarget);
                      void act("create-schedule", () => createTurnaroundSchedule(selected.windowId, String(form.get("key")), String(form.get("title"))));
                    }}
                  >
                    <label className="text-xs text-slate-400">Schedule key<input name="key" required minLength={2} className={INPUT} placeholder={`${selected.windowKey}-SCHED`} /></label>
                    <label className="text-xs text-slate-400">Schedule title<input name="title" required minLength={3} className={INPUT} placeholder={`${selected.title} schedule`} /></label>
                    <button disabled={Boolean(busy)} className={`${BUTTON} self-end`}>Create</button>
                  </form>
                  {(data?.unlinkedSchedules.length ?? 0) > 0 ? (
                    <form
                      className="grid gap-2 rounded-lg border border-white/5 p-3 sm:grid-cols-[1fr_1fr_auto]"
                      onSubmit={(event: FormEvent<HTMLFormElement>) => {
                        event.preventDefault(); const form = new FormData(event.currentTarget);
                        void act("link-schedule", () => linkOutageSchedule(selected.windowId, String(form.get("event")), String(form.get("basis"))));
                      }}
                    >
                      <label className="text-xs text-slate-400">Existing schedule<select name="event" required className={INPUT}><option value="">Select schedule</option>{data?.unlinkedSchedules.map((schedule) => <option key={schedule.shutdownEventId} value={schedule.shutdownEventId}>{schedule.eventKey} · {schedule.title}</option>)}</select></label>
                      <label className="text-xs text-slate-400">Link basis<input name="basis" required minLength={10} className={INPUT} /></label>
                      <button disabled={Boolean(busy)} className={`${BUTTON} self-end`}>Link</button>
                    </form>
                  ) : null}
                </div>
              ) : (
                <>
                  <ul className="space-y-2">
                    {selected.tasks.map((task) => (
                      <li key={task.taskId} className="rounded-lg border border-white/5 p-3 text-xs">
                        <div className="flex flex-wrap justify-between gap-2"><strong className="text-slate-200">{task.taskKey} · {task.label}</strong><span className="text-slate-400">{task.durationHours} h · {task.origin}</span></div>
                        <p className="mt-1 text-slate-500">{task.plannedStart && task.plannedFinish ? `${new Date(task.plannedStart).toLocaleString()} – ${new Date(task.plannedFinish).toLocaleString()}` : "Dates missing"} · {task.outageWorkId ? "Scope linked" : "Support/unlinked task"}</p>
                      </li>
                    ))}
                    {selected.tasks.length === 0 ? <li className="text-xs text-slate-500">No schedule activities are recorded.</li> : null}
                  </ul>
                  {selected.status !== "executing" && selected.status !== "closed" && selected.status !== "cancelled" ? (
                    <form
                      className="grid gap-2 rounded-lg border border-white/5 p-3 sm:grid-cols-2"
                      onSubmit={(event: FormEvent<HTMLFormElement>) => {
                        event.preventDefault(); const form = new FormData(event.currentTarget);
                        void act("activity", () => recordTurnaroundActivity({
                          windowId: selected.windowId,
                          taskKey: String(form.get("key")), label: String(form.get("label")),
                          durationHours: Number(form.get("duration")),
                          optimisticHours: form.get("optimistic") ? Number(form.get("optimistic")) : null,
                          pessimisticHours: form.get("pessimistic") ? Number(form.get("pessimistic")) : null,
                          workOrderId: String(form.get("work") ?? "") || null,
                          plannedStart: localIso(form.get("start")), plannedFinish: localIso(form.get("finish")),
                        }));
                      }}
                    >
                      <label className="text-xs text-slate-400">Activity key<input name="key" required className={INPUT} /></label>
                      <label className="text-xs text-slate-400">Label<input name="label" required minLength={3} className={INPUT} /></label>
                      <label className="text-xs text-slate-400">Duration hours<input name="duration" required type="number" min="0" step="0.1" className={INPUT} /></label>
                      <label className="text-xs text-slate-400">Scope work<select name="work" className={INPUT}><option value="">Support task / no work link</option>{selected.work.map((work) => <option key={work.workOrderId} value={work.workOrderId}>{work.workOrderNumber ?? "Unnumbered"} · {work.title}</option>)}</select></label>
                      <label className="text-xs text-slate-400">Optimistic hours<input name="optimistic" type="number" min="0" step="0.1" className={INPUT} /></label>
                      <label className="text-xs text-slate-400">Pessimistic hours<input name="pessimistic" type="number" min="0" step="0.1" className={INPUT} /></label>
                      <label className="text-xs text-slate-400">Planned start<input name="start" type="datetime-local" className={INPUT} /></label>
                      <label className="text-xs text-slate-400">Planned finish<input name="finish" type="datetime-local" className={INPUT} /></label>
                      <button disabled={Boolean(busy)} className={`${BUTTON} sm:col-span-2`}><Plus className="mr-1 inline h-3.5 w-3.5" aria-hidden />Record local activity</button>
                    </form>
                  ) : null}
                  {selected.tasks.length > 1 && selected.status !== "executing" ? (
                    <form
                      className="grid gap-2 rounded-lg border border-white/5 p-3 sm:grid-cols-[1fr_1fr_auto]"
                      onSubmit={(event: FormEvent<HTMLFormElement>) => {
                        event.preventDefault(); const form = new FormData(event.currentTarget);
                        void act("dependency", () => recordTurnaroundDependency(selected.windowId, String(form.get("task")), String(form.get("predecessor"))));
                      }}
                    >
                      <label className="text-xs text-slate-400">Activity<select name="task" required className={INPUT}>{selected.tasks.map((task) => <option key={task.taskId} value={task.taskKey}>{task.taskKey}</option>)}</select></label>
                      <label className="text-xs text-slate-400">Predecessor<select name="predecessor" required className={INPUT}>{selected.tasks.map((task) => <option key={task.taskId} value={task.taskKey}>{task.taskKey}</option>)}</select></label>
                      <button disabled={Boolean(busy)} className={`${BUTTON} self-end`}>Add FS logic</button>
                    </form>
                  ) : null}
                  {selected.tasks.some((task) => !task.outageWorkId) && selected.work.length > 0 && selected.status !== "executing" ? (
                    <form
                      className="grid gap-2 rounded-lg border border-white/5 p-3 sm:grid-cols-[1fr_1fr_auto]"
                      onSubmit={(event: FormEvent<HTMLFormElement>) => {
                        event.preventDefault(); const form = new FormData(event.currentTarget);
                        void act("link-task", () => linkTaskToWork(selected.windowId, Number(form.get("task")), String(form.get("work"))));
                      }}
                    >
                      <label className="text-xs text-slate-400">Unlinked activity<select name="task" required className={INPUT}>{selected.tasks.filter((task) => !task.outageWorkId).map((task) => <option key={task.taskId} value={task.taskId}>{task.taskKey} · {task.label}</option>)}</select></label>
                      <label className="text-xs text-slate-400">Scope work<select name="work" required className={INPUT}>{selected.work.map((work) => <option key={work.workOrderId} value={work.workOrderId}>{work.workOrderNumber ?? "Unnumbered"} · {work.title}</option>)}</select></label>
                      <button disabled={Boolean(busy)} className={`${BUTTON} self-end`}>Link</button>
                    </form>
                  ) : null}
                </>
              )}
            </article>
          </div>

          <article className="space-y-3 rounded-xl border border-white/6 bg-overlook-deep/30 p-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-100"><ShieldCheck className="h-4 w-4 text-green-300" aria-hidden /> Retained assessment and human hand-off</h3>
            {packs.length ? (
              <>
                <select value={packId} onChange={(event) => setPackId(event.target.value)} className={`${INPUT} max-w-xl`}>
                  {packs.map((item) => <option key={item.packId} value={item.packId}>{new Date(item.createdAt).toLocaleString()} · {item.assessment.releaseReadiness.blockers} blocker(s)</option>)}
                </select>
                {pack ? (
                  <div className="grid gap-4 lg:grid-cols-[1fr_0.9fr]">
                    <div>
                      <p className="text-sm text-slate-300">{pack.assessment.interpretation}</p>
                      <ul className="mt-3 space-y-2">{pack.assessment.evidenceGaps.map((gap) => <li key={gap.code} className="rounded-lg border border-white/5 p-3 text-xs"><strong className={gap.severity === "blocker" ? "text-red-300" : "text-amber-300"}>{gap.code.replaceAll("_", " ")}</strong><p className="mt-1 text-slate-400">{gap.detail}</p></li>)}</ul>
                      {pack.assessment.evidenceGaps.length === 0 ? <p className="mt-2 text-xs text-green-300">No calculated evidence gap in the retained snapshot. Human release authority still applies.</p> : null}
                    </div>
                    <div>
                      {pack.assignment ? <p className="mb-3 rounded-lg border border-green-500/20 bg-green-500/5 p-3 text-xs text-green-200"><UserCheck className="mr-1.5 inline h-3.5 w-3.5" aria-hidden />Review owned by {pack.assignment.ownerName}, due {new Date(pack.assignment.dueDate).toLocaleDateString()}.</p> : null}
                      <form
                        className="space-y-2 rounded-lg border border-white/5 p-3"
                        onSubmit={(event: FormEvent<HTMLFormElement>) => {
                          event.preventDefault(); const form = new FormData(event.currentTarget);
                          void act("review", () => assignTurnaroundReview(pack.packId, String(form.get("owner")), String(form.get("due")), String(form.get("note"))));
                        }}
                      >
                        <label className="block text-xs text-slate-400">Named reviewer<select name="owner" required className={INPUT}><option value="">Select reviewer</option>{data?.members.map((member) => <option key={member.id} value={member.id}>{member.name} · {member.role}</option>)}</select></label>
                        <label className="block text-xs text-slate-400">Due date<input name="due" type="date" required className={INPUT} /></label>
                        <label className="block text-xs text-slate-400">Review note<textarea name="note" required minLength={10} rows={2} className={INPUT} /></label>
                        <button disabled={Boolean(busy)} className={BUTTON}><UserCheck className="mr-1 inline h-3.5 w-3.5" aria-hidden />Assign review</button>
                      </form>
                    </div>
                  </div>
                ) : null}
              </>
            ) : <p className="text-xs text-slate-500">Run the specialist to retain an immutable evidence snapshot and review plan.</p>}
          </article>
        </>
      )}
    </section>
  );
}
