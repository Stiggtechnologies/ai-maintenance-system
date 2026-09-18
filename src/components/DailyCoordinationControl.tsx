/* eslint-disable @typescript-eslint/no-explicit-any */
import { FormEvent } from "react";
import { CheckCircle2, Users } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import { supabase } from "../lib/supabase";
import { ErrorState, LoadingState } from "./ui/AsyncStates";

type AgendaItem = {
  sourceKey: string;
  kind: string;
  asset: string;
  summary: string;
  severity: string;
  critical: boolean;
  occurredAt: string;
};
type Payload = {
  meeting: null | {
    id: string;
    meetingDate: string;
    status: string;
    openedAt: string;
    agenda: { items: AgendaItem[]; basis: string; windowHours: number };
  };
  attendees: { userId: string; function: string; attestedAt: string }[];
  dispositions: {
    sourceKey: string;
    disposition: string;
    note: string;
    ownerRole?: string;
  }[];
  recent: {
    id: string;
    meetingDate: string;
    status: string;
    completedAt: string;
    closingNote: string;
  }[];
};
const control =
  "mt-1 w-full rounded border border-white/10 bg-industrial-black px-2 py-1.5 text-sm text-slate-100";

export function DailyCoordinationControl() {
  const { data, loading, error, refetch } = useAsyncData<Payload>(async () => {
    const response = await (supabase as any).rpc(
      "get_daily_coordination_control",
      {},
    );
    if (response.error) throw new Error(response.error.message);
    return response.data as Payload;
  }, []);

  async function call(name: string, args: Record<string, unknown>) {
    const response = await (supabase as any).rpc(name, args);
    if (response.error) throw new Error(response.error.message);
    await refetch();
  }

  async function openMeeting() {
    try {
      await call("open_daily_coordination_meeting", {
        p_site_id: null,
        p_window_hours: 24,
      });
    } catch (cause) {
      window.alert(
        cause instanceof Error ? cause.message : "Could not open the meeting.",
      );
    }
  }

  async function attest(attendanceFunction: "operations" | "maintenance") {
    if (!data?.meeting) return;
    try {
      await call("attest_daily_coordination_attendance", {
        p_meeting_id: data.meeting.id,
        p_function: attendanceFunction,
      });
    } catch (cause) {
      window.alert(
        cause instanceof Error ? cause.message : "Could not attest attendance.",
      );
    }
  }

  async function disposition(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data?.meeting) return;
    const form = new FormData(event.currentTarget);
    try {
      await call("record_daily_coordination_disposition", {
        p_record: {
          meeting_id: data.meeting.id,
          source_key: form.get("source_key"),
          disposition: form.get("disposition"),
          note: form.get("note"),
          owner_role: form.get("owner_role"),
          due_at: form.get("due_at"),
          work_order_id: form.get("work_order_id"),
          decision_id: form.get("decision_id"),
        },
      });
      event.currentTarget.reset();
    } catch (cause) {
      window.alert(
        cause instanceof Error
          ? cause.message
          : "Could not record the disposition.",
      );
    }
  }

  async function complete(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data?.meeting) return;
    const note = new FormData(event.currentTarget).get("closing_note");
    try {
      await call("complete_daily_coordination_meeting", {
        p_meeting_id: data.meeting.id,
        p_note: note,
      });
    } catch (cause) {
      window.alert(
        cause instanceof Error
          ? cause.message
          : "Could not complete the meeting.",
      );
    }
  }

  if (loading) return <LoadingState label="Loading daily coordination" />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;
  const meeting = data?.meeting;
  const items = meeting?.agenda.items ?? [];
  const dispositions = new Map(
    (data?.dispositions ?? []).map((item) => [item.sourceKey, item]),
  );
  return (
    <section
      aria-labelledby="daily-control-heading"
      className="space-y-4 rounded-xl border border-industrial-border bg-industrial-graphite p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            id="daily-control-heading"
            className="flex items-center gap-2 text-lg font-semibold text-white"
          >
            <Users className="h-5 w-5 text-signal-cyan" aria-hidden /> Daily
            operations–maintenance control room
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-400">
            A joint human meeting over the live operating picture. SyncAI
            prepares the agenda; it does not make or close operational
            decisions.
          </p>
        </div>
        {!meeting && (
          <button
            type="button"
            onClick={() => void openMeeting()}
            className="rounded bg-signal-cyan px-3 py-1.5 text-sm font-medium text-slate-950"
          >
            Open today’s meeting
          </button>
        )}
      </div>

      {meeting ? (
        <>
          <div className="rounded border border-white/10 bg-industrial-black p-3 text-xs text-slate-300">
            <p>{meeting.agenda.basis}</p>
            <p className="mt-1 text-slate-500">
              {items.length} agenda item(s) · {meeting.agenda.windowHours}-hour
              event window · opened{" "}
              {new Date(meeting.openedAt).toLocaleString()}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-400">
              Attest your participation:
            </span>
            <button
              type="button"
              onClick={() => void attest("operations")}
              className="rounded border border-sky-400/30 px-2.5 py-1.5 text-xs text-sky-200"
            >
              I represent Operations
            </button>
            <button
              type="button"
              onClick={() => void attest("maintenance")}
              className="rounded border border-amber-400/30 px-2.5 py-1.5 text-xs text-amber-200"
            >
              I represent Maintenance
            </button>
            {(data?.attendees ?? []).map((attendee) => (
              <span
                key={attendee.userId}
                className="rounded bg-white/5 px-2 py-1 text-xs text-slate-300"
              >
                {attendee.function} attested
              </span>
            ))}
          </div>
          {items.length === 0 ? (
            <p className="rounded border border-white/6 p-4 text-sm text-slate-400">
              No matching records were present when this agenda was opened. That
              is not a declaration that the site is risk-free.
            </p>
          ) : (
            <ul className="space-y-2">
              {items.map((item) => {
                const recorded = dispositions.get(item.sourceKey);
                return (
                  <li
                    key={item.sourceKey}
                    className={`rounded border p-3 ${item.critical ? "border-rose-500/30 bg-rose-500/5" : "border-white/6 bg-industrial-black"}`}
                  >
                    <div className="flex flex-wrap justify-between gap-2">
                      <p className="text-sm font-medium text-slate-200">
                        {item.asset} · {item.summary}
                      </p>
                      <span
                        className={
                          item.critical
                            ? "text-xs text-rose-300"
                            : "text-xs text-slate-400"
                        }
                      >
                        {item.severity}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {item.kind.replaceAll("_", " ")} ·{" "}
                      {new Date(item.occurredAt).toLocaleString()}
                    </p>
                    {recorded && (
                      <p className="mt-2 flex items-center gap-1 text-xs text-emerald-300">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        {recorded.disposition}: {recorded.note}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {items.length > 0 && (
            <form
              onSubmit={disposition}
              className="grid gap-3 rounded border border-white/10 p-4 lg:grid-cols-2"
            >
              <label className="text-xs text-slate-300">
                Agenda item
                <select name="source_key" required className={control}>
                  <option value="">Select an item</option>
                  {items.map((item) => (
                    <option key={item.sourceKey} value={item.sourceKey}>
                      {item.critical ? "CRITICAL · " : ""}
                      {item.asset} · {item.summary}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-slate-300">
                Disposition
                <select name="disposition" required className={control}>
                  <option value="acknowledged">Acknowledged</option>
                  <option value="monitor">Monitor</option>
                  <option value="action">Linked action</option>
                  <option value="escalated">Escalated decision</option>
                </select>
              </label>
              <Field name="note" label="Meeting note" />
              <Field
                name="owner_role"
                label="Owner role (actions/escalations)"
                optional
              />
              <Field
                name="due_at"
                label="Due date/time (actions/escalations)"
                type="datetime-local"
                optional
              />
              <Field
                name="work_order_id"
                label="Canonical work-order ID"
                optional
              />
              <Field
                name="decision_id"
                label="Canonical decision ID"
                optional
              />
              <button className="w-fit rounded bg-signal-cyan px-3 py-1.5 text-sm font-medium text-slate-950">
                Record disposition
              </button>
            </form>
          )}
          <form onSubmit={complete} className="border-t border-white/10 pt-4">
            <Field name="closing_note" label="Joint closing note" />
            <button className="mt-3 rounded border border-emerald-400/40 px-3 py-1.5 text-sm text-emerald-200">
              Complete joint meeting
            </button>
          </form>
        </>
      ) : (data?.recent?.length ?? 0) > 0 ? (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Recent meetings
          </h3>
          <ul className="mt-2 space-y-2">
            {data!.recent.map((item) => (
              <li
                key={item.id}
                className="rounded bg-industrial-black px-3 py-2 text-xs text-slate-300"
              >
                {item.meetingDate} · {item.closingNote}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function Field({
  name,
  label,
  type = "text",
  optional = false,
}: {
  name: string;
  label: string;
  type?: string;
  optional?: boolean;
}) {
  return (
    <label className="text-xs text-slate-300">
      {label}
      <input name={name} type={type} required={!optional} className={control} />
    </label>
  );
}
