import { FormEvent, useCallback, useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";
import {
  acknowledgeSubjectEscalation,
  adoptEscalationRule,
  endOnCallDuty,
  getEscalationPaths,
  proposeEscalationRule,
  raiseSubjectEscalation,
  recordOnCallDuty,
  retireEscalationRule,
  withdrawSubjectEscalation,
  type EscalationPaths,
} from "../services/escalationPathService";

const input =
  "w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-signal-cyan/50 focus:outline-none";
const button =
  "rounded-lg bg-signal-cyan/15 px-3 py-2 text-xs font-semibold text-signal-cyan hover:bg-signal-cyan/25 disabled:opacity-40";

const BOUNDARY =
  "SyncAI does not raise, acknowledge, or close these paths by itself. Acknowledging an escalation does not approve a decision, release work, or clear an alert.";

function localToIso(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Enter a valid duty start and end.");
  }
  return parsed.toISOString();
}

export function EscalationPathsPage() {
  const [paths, setPaths] = useState<EscalationPaths | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [subjectKind, setSubjectKind] = useState("work_order");
  const [conditionKind, setConditionKind] = useState("blocked");
  const [incidentPath, setIncidentPath] = useState(true);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    try {
      setError(null);
      setPaths(await getEscalationPaths());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function propose(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    const windowHours = String(form.get("response_window_hours") ?? "").trim();
    await run(async () => {
      await proposeEscalationRule({
        ruleKey: String(form.get("rule_key") ?? ""),
        subjectKind: String(form.get("subject_kind") ?? subjectKind),
        conditionKind: String(form.get("condition_kind") ?? conditionKind),
        incidentPath: form.get("incident_path") === "on",
        responseWindowHours:
          subjectKind === "condition_alert" && conditionKind === "overdue"
            ? Number(windowHours)
            : null,
        escalatesToRole: String(form.get("escalates_to_role") ?? ""),
        basis: String(form.get("basis") ?? ""),
      });
      formEl.reset();
    });
  }

  async function recordDuty(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    await run(async () => {
      await recordOnCallDuty({
        roleKey: String(form.get("role_key") ?? ""),
        userId: String(form.get("user_id") ?? ""),
        startsAt: localToIso(String(form.get("starts_at") ?? "")),
        endsAt: localToIso(String(form.get("ends_at") ?? "")),
        basis: String(form.get("basis") ?? ""),
      });
      formEl.reset();
    });
  }

  async function raiseManual(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await run(() =>
      raiseSubjectEscalation({
        ruleId: String(form.get("rule_id") ?? ""),
        subjectId: String(form.get("subject_id") ?? ""),
        note: String(form.get("note") ?? ""),
      }),
    );
  }

  const alertWindow =
    subjectKind === "condition_alert" && conditionKind === "overdue";
  const adopted = (paths?.rules ?? []).filter(
    (rule) => rule.status === "adopted",
  );

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-white">
          <ShieldAlert className="h-6 w-6 text-signal-cyan" aria-hidden />
          Escalation paths
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-400">{BOUNDARY}</p>
        {paths?.control ? (
          <p className="mt-2 max-w-3xl text-sm text-slate-500">
            {paths.control}
          </p>
        ) : null}
      </header>

      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200"
        >
          {error}
        </p>
      ) : null}

      <section
        aria-labelledby="escalation-rules-heading"
        className="space-y-3 rounded-xl border border-white/10 bg-[#0D1520] p-4"
      >
        <h2
          id="escalation-rules-heading"
          className="text-lg font-semibold text-white"
        >
          Rules
        </h2>
        <ul className="space-y-2">
          {(paths?.rules ?? []).map((rule) => (
            <li
              key={rule.id}
              className="rounded-lg border border-white/10 p-3 text-sm text-slate-300"
            >
              <p>
                <span className="font-medium text-white">{rule.ruleKey}</span> v
                {rule.version} · {rule.status} · {rule.subjectKind}{" "}
                {rule.conditionKind}
                {rule.incidentPath ? " · incident / on-call" : ""} · to{" "}
                {rule.escalatesToRole}
              </p>
              <p className="mt-1 text-slate-400">{rule.basis}</p>
              {rule.status === "draft" &&
              paths?.canAuthor &&
              !rule.isOwnDraft ? (
                <button
                  type="button"
                  className={`${button} mt-2`}
                  disabled={busy || note.trim().length < 20}
                  onClick={() =>
                    void run(() =>
                      adoptEscalationRule({ ruleId: rule.id, note }),
                    )
                  }
                >
                  Adopt rule
                </button>
              ) : null}
              {paths?.canAuthor ? (
                <button
                  type="button"
                  className={`${button} mt-2 ml-2`}
                  disabled={busy || note.trim().length < 20}
                  onClick={() =>
                    void run(() =>
                      retireEscalationRule({ ruleId: rule.id, note }),
                    )
                  }
                >
                  Retire rule
                </button>
              ) : null}
            </li>
          ))}
        </ul>
        {paths?.canAuthor ? (
          <form
            onSubmit={(event) => void propose(event)}
            className="grid gap-3 md:grid-cols-2"
          >
            <label className="text-xs text-slate-400">
              Rule key
              <input
                name="rule_key"
                className={input}
                required
                pattern="[a-z][a-z0-9_]{1,63}"
              />
            </label>
            <label className="text-xs text-slate-400">
              Subject
              <select
                name="subject_kind"
                className={input}
                value={subjectKind}
                onChange={(event) => setSubjectKind(event.target.value)}
              >
                <option value="decision">Decision</option>
                <option value="work_order">Work order</option>
                <option value="condition_alert">Condition alert</option>
              </select>
            </label>
            <label className="text-xs text-slate-400">
              Condition
              <select
                name="condition_kind"
                className={input}
                value={conditionKind}
                onChange={(event) => setConditionKind(event.target.value)}
              >
                <option value="overdue">Overdue</option>
                <option value="blocked">Blocked</option>
              </select>
            </label>
            <label className="text-xs text-slate-400">
              Escalates to role
              <select
                name="escalates_to_role"
                className={input}
                required
                defaultValue=""
              >
                <option value="" disabled>
                  Authority ladder role
                </option>
                {(paths?.ladderRoles ?? []).map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>
            </label>
            {alertWindow ? (
              <label className="text-xs text-slate-400">
                Response window hours
                <input
                  name="response_window_hours"
                  type="number"
                  min={1}
                  max={8760}
                  className={input}
                  required
                />
              </label>
            ) : null}
            <label className="flex items-center gap-2 text-xs text-slate-300 md:col-span-2">
              <input
                name="incident_path"
                type="checkbox"
                checked={incidentPath}
                onChange={(event) => setIncidentPath(event.target.checked)}
              />
              Incident path — require a current on-call holder
            </label>
            <label className="text-xs text-slate-400 md:col-span-2">
              Basis
              <textarea
                name="basis"
                className={input}
                minLength={20}
                required
                rows={3}
              />
            </label>
            <button type="submit" className={button} disabled={busy}>
              Propose escalation rule
            </button>
          </form>
        ) : null}
      </section>

      <section
        aria-labelledby="on-call-heading"
        className="space-y-3 rounded-xl border border-white/10 bg-[#0D1520] p-4"
      >
        <h2 id="on-call-heading" className="text-lg font-semibold text-white">
          On-call duties
        </h2>
        <ul className="space-y-2">
          {(paths?.duties ?? []).map((duty) => (
            <li
              key={duty.id}
              className="rounded-lg border border-white/10 p-3 text-sm text-slate-300"
            >
              <p>
                {duty.roleKey} · {duty.userId}
                {duty.covering ? " · covering now" : ""}
                {duty.endedEarlyAt ? " · ended" : ""}
              </p>
              <p className="text-slate-500">
                {new Date(duty.startsAt).toLocaleString()} –{" "}
                {new Date(duty.endsAt).toLocaleString()}
              </p>
              {!duty.endedEarlyAt && paths?.canAuthor ? (
                <button
                  type="button"
                  className={`${button} mt-2`}
                  disabled={busy || note.trim().length < 20}
                  onClick={() =>
                    void run(() => endOnCallDuty({ dutyId: duty.id, note }))
                  }
                >
                  End duty
                </button>
              ) : null}
            </li>
          ))}
        </ul>
        {paths?.canAuthor ? (
          <form
            onSubmit={(event) => void recordDuty(event)}
            className="grid gap-3 md:grid-cols-2"
          >
            <label className="text-xs text-slate-400">
              On-call role
              <select
                name="role_key"
                className={input}
                required
                defaultValue=""
              >
                <option value="" disabled>
                  Authority ladder role
                </option>
                {(paths?.ladderRoles ?? []).map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-400">
              On-call person
              <select name="user_id" className={input} required defaultValue="">
                <option value="" disabled>
                  Same-tenant member
                </option>
                {(paths?.members ?? []).map((member) => (
                  <option key={member.userId} value={member.userId}>
                    {member.name} · {member.role}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-400">
              Duty starts
              <input
                name="starts_at"
                type="datetime-local"
                className={input}
                required
              />
            </label>
            <label className="text-xs text-slate-400">
              Duty ends
              <input
                name="ends_at"
                type="datetime-local"
                className={input}
                required
              />
            </label>
            <label className="text-xs text-slate-400 md:col-span-2">
              Duty basis
              <textarea
                name="basis"
                className={input}
                minLength={20}
                required
                rows={2}
              />
            </label>
            <button type="submit" className={button} disabled={busy}>
              Record on-call duty
            </button>
          </form>
        ) : null}
      </section>

      <section aria-labelledby="escalation-note-heading" className="space-y-3">
        <h2
          id="escalation-note-heading"
          className="text-lg font-semibold text-white"
        >
          Act on a path
        </h2>
        <label className="block text-xs text-slate-400">
          Escalation note
          <textarea
            className={input}
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="At least 20 characters. This note is the human basis for adopt, raise, acknowledge, withdraw, or end."
          />
        </label>
      </section>

      <section
        aria-labelledby="candidates-heading"
        className="space-y-3 rounded-xl border border-white/10 bg-[#0D1520] p-4"
      >
        <h2
          id="candidates-heading"
          className="text-lg font-semibold text-white"
        >
          Qualifying subjects
        </h2>
        <ul className="space-y-2">
          {(paths?.candidates ?? []).map((candidate) => (
            <li
              key={`${candidate.ruleId}:${candidate.subjectId}:${candidate.conditionKind}`}
              className="rounded-lg border border-white/10 p-3 text-sm text-slate-300"
            >
              <p>
                {candidate.subjectKind} {candidate.conditionKind}
                {candidate.incidentPath ? " · incident" : ""} ·{" "}
                {candidate.subjectId}
              </p>
              <p className="text-slate-400">{candidate.stateBasis}</p>
              <button
                type="button"
                className={`${button} mt-2`}
                disabled={busy || note.trim().length < 20}
                onClick={() =>
                  void run(() =>
                    raiseSubjectEscalation({
                      ruleId: candidate.ruleId,
                      subjectId: candidate.subjectId,
                      note,
                    }),
                  )
                }
              >
                Raise this subject
              </button>
            </li>
          ))}
        </ul>
        <form
          onSubmit={(event) => void raiseManual(event)}
          className="grid gap-3 md:grid-cols-2"
        >
          <label className="text-xs text-slate-400">
            Adopted rule
            <select name="rule_id" className={input} required defaultValue="">
              <option value="" disabled>
                Choose a rule
              </option>
              {adopted.map((rule) => (
                <option key={rule.id} value={rule.id}>
                  {rule.ruleKey} · {rule.subjectKind} {rule.conditionKind}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-400">
            Subject id
            <input name="subject_id" className={input} required />
          </label>
          <label className="text-xs text-slate-400 md:col-span-2">
            Note for this subject
            <textarea
              name="note"
              className={input}
              minLength={20}
              required
              rows={2}
            />
          </label>
          <button type="submit" className={button} disabled={busy}>
            Raise escalation
          </button>
        </form>
      </section>

      <section
        aria-labelledby="open-escalations-heading"
        className="space-y-3 rounded-xl border border-white/10 bg-[#0D1520] p-4"
      >
        <h2
          id="open-escalations-heading"
          className="text-lg font-semibold text-white"
        >
          Escalations
        </h2>
        <ul className="space-y-2">
          {(paths?.escalations ?? []).map((item) => (
            <li
              key={item.id}
              className="rounded-lg border border-white/10 p-3 text-sm text-slate-300"
            >
              <p>
                {item.status} · {item.subjectKind} {item.conditionKind}
                {item.incidentPath ? " · incident" : ""} · to{" "}
                {item.escalatesToRole}
              </p>
              <p className="text-slate-400">{item.stateBasis}</p>
              <p className="text-slate-500">{item.raiseNote}</p>
              {item.status === "open" ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={button}
                    disabled={busy || note.trim().length < 20}
                    onClick={() =>
                      void run(() =>
                        acknowledgeSubjectEscalation({
                          escalationId: item.id,
                          note,
                        }),
                      )
                    }
                  >
                    Acknowledge escalation
                  </button>
                  <button
                    type="button"
                    className={button}
                    disabled={busy || note.trim().length < 20}
                    onClick={() =>
                      void run(() =>
                        withdrawSubjectEscalation({
                          escalationId: item.id,
                          note,
                        }),
                      )
                    }
                  >
                    Withdraw escalation
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
