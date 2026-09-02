/**
 * Sync Develop Slice 5D — the event bus, the two agents and the composed
 * Sync Information module.
 *
 *   D11.26  the five §71-78 events, what the ONE consumer did with each, and
 *           the answer act. An unanswered BLOCKING consequence is a gate
 *           blocker on the same machinery a breached permit condition rides,
 *           and this panel says so where it can be acted on.
 *   D12.10  the Change Impact Agent. It runs Slice 5C's traversal and NOTHING
 *           else; where that traversal refuses, the refusal is what is shown
 *           and no model is asked. Model output is labelled every time.
 *   D12.13  the RAM kernel scoped to this case's asset set. Every figure is
 *           the shipped kernel's; every leg that could not be computed is
 *           named rather than omitted.
 *   D11.09  the Sync Information module, composed — with the leg it does not
 *           have named and NO composite score over the ones it does.
 *
 * THE SURFACE CONVENTION, unchanged from 5A/5B/5C: a REFUSAL is an answer and
 * is rendered as prose, never as an error and never as a zero.
 */
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Radio, GitBranch, Activity, Library } from "lucide-react";

import {
  answerBlockedReason,
  developEventLabel,
  readDevelopEvents,
  type DevelopEventRow,
  type DevelopEventsPayload,
} from "../../lib/develop/events";
import {
  aiConsequenceDisclaimer,
  readChangeImpactReports,
  type ChangeImpactReportsPayload,
} from "../../lib/develop/changeImpact";
import { ramProfileLines, type RamProfile } from "../../lib/develop/ram";
import {
  answerDevelopEventConsequence,
  getCaseDevelopEvents,
  getCaseInformationEngine,
  getChangeImpactReports,
  getCaseEventGateBlockers,
  getCaseThreadGraph,
  getRamAgentReports,
  runCaseRamAgent,
  runChangeImpactAgent,
  type ChangeImpactAgentResult,
} from "../../services/developService";

const inputClass =
  "w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-signal-cyan/50 focus:outline-none";
const btnClass =
  "rounded-lg bg-signal-cyan/15 px-3 py-1.5 text-xs font-semibold text-signal-cyan hover:bg-signal-cyan/25 disabled:opacity-40";

function Section({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-white/6 bg-[#0D1520] p-5">
      <div className="flex items-center gap-2">
        {icon}
        <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
      </div>
      <p className="mt-1 text-xs text-slate-400">{subtitle}</p>
      <div className="mt-3 space-y-3">{children}</div>
    </div>
  );
}

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div className="rounded border border-red-400/30 bg-red-400/10 px-2.5 py-1.5 text-xs text-red-300">
      {error}
    </div>
  );
}

function Refusal({ text }: { text: string | null | undefined }) {
  if (!text) return null;
  return (
    <div className="rounded border border-amber-400/25 bg-amber-400/5 px-2.5 py-1.5 text-xs text-amber-200">
      {text}
    </div>
  );
}

function AiLabel({ model }: { model: string | null }) {
  return (
    <div className="rounded border border-fuchsia-400/25 bg-fuchsia-400/5 px-2.5 py-1.5 text-[11px] text-fuchsia-200">
      {aiConsequenceDisclaimer(model)}
    </div>
  );
}

/* ─────────────────────────── D11.26 — the bus ───────────────────────────── */

export function DevelopEventBusPanel({
  caseId,
  viewer,
  reloadKey,
}: {
  caseId: string;
  viewer: { id: string | null; role: string | null };
  reloadKey?: number;
}) {
  const [payload, setPayload] = useState<DevelopEventsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [note, setNote] = useState("");
  // THE ROWS THE GATE WALL READS, read from the wall's own predicate rather
  // than re-derived here. Enforced truth and displayed truth are the same
  // rows or they are two answers.
  //
  // AND THE SCOPE IS CARRIED THROUGH, not dropped. This panel calls the
  // predicate WITHOUT a gate, which is the honest "what is outstanding on this
  // case" question — but ruling 5D-R18 makes a GateRequirementChanged
  // consequence block ITS OWN GATE ONLY, so the un-gated list is not the list
  // the wall refuses over at any particular gate. The first draft printed it
  // under the sentence "a gate review recorded while they stand is refused at
  // the database", which was false for every gate but one: proven live, a
  // `proceed` at G2 went through the shipped wall while this box said the
  // database would refuse it. The predicate already returns the gate each row
  // concerns, so the screen says which is which instead of implying they are
  // all the same.
  const [gateBlockers, setGateBlockers] = useState<
    {
      id: number;
      name: string;
      eventName: string;
      gateId: number | null;
      gateName: string | null;
    }[]
  >([]);

  const load = useCallback(async () => {
    try {
      const [events, blockers] = await Promise.all([
        getCaseDevelopEvents(caseId),
        getCaseEventGateBlockers(caseId),
      ]);
      setPayload(events);
      setGateBlockers(
        blockers.map((b) => ({
          id: b.id,
          name: b.name,
          eventName: b.eventName,
          gateId: b.gateId,
          gateName: b.gateName,
        })),
      );
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [caseId]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  const reading = readDevelopEvents(payload);

  const answer = async (row: DevelopEventRow) => {
    if (row.deliveryId === null) return;
    setBusy(true);
    try {
      await answerDevelopEventConsequence(row.deliveryId, note);
      setNote("");
      setOpenId(null);
      await load();
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      icon={<Radio className="h-4 w-4 text-signal-cyan" />}
      title="Event bus (spec §71–78)"
      subtitle="Five named events, emitted by the acts that cause them. One consumer acts on every one of them, and a BLOCKING consequence nobody has answered stops a gate review at the database — not on a screen."
    >
      <ErrorLine error={error} />
      <p className="text-xs text-slate-300">{reading.headline}</p>
      <p className="text-[11px] text-slate-500">
        Watched: {reading.watched.map(developEventLabel).join(" · ")}
      </p>
      {gateBlockers.length > 0 && (
        <div className="rounded border border-red-400/30 bg-red-400/5 px-2.5 py-2 text-xs text-red-200">
          <div className="font-semibold">
            {gateBlockers.length} unanswered consequence(s) STOP a gate review
            on this case until somebody answers them.
          </div>
          <p className="mt-1 text-[11px] text-red-200/80">
            These are the rows the persistence wall reads — not a second list
            computed on this screen.{" "}
            {gateBlockers.every((b) => b.gateId === null)
              ? "Every one of them blocks a review at ANY gate on this case, and a review recorded while they stand is refused at the database."
              : "A consequence marked for one gate blocks THAT gate only; the rest block a review at any gate. The wall refuses a review over exactly the rows listed for the gate being reviewed."}
          </p>
          {gateBlockers.map((b) => (
            <p key={b.id} className="mt-1 text-[11px]">
              ·{" "}
              {b.gateId === null
                ? "blocks every gate"
                : `blocks gate ${b.gateName ?? b.gateId} only`}
              : {b.name}
            </p>
          ))}
        </div>
      )}
      {reading.undelivered.length > 0 && (
        <Refusal
          text={`${reading.undelivered.length} event(s) have NO delivery row. That is structurally impossible — the emitter dispatches inside its own transaction — so it means an emitter has lost its subscriber and is surfaced rather than hidden.`}
        />
      )}
      {reading.empty ? null : (
        <div className="space-y-2">
          {reading.open.map((e) => {
            const blocked = answerBlockedReason(e, viewer, note);
            return (
              <div
                key={e.eventId}
                className={`rounded border px-2.5 py-2 text-xs ${
                  e.consequence === "blocking"
                    ? "border-red-400/30 bg-red-400/5 text-red-200"
                    : "border-white/10 bg-white/[0.02] text-slate-300"
                }`}
              >
                <div className="font-semibold">
                  {developEventLabel(e.eventName)}
                  {e.consequence === "blocking" ? " — BLOCKS THE GATE" : ""}
                </div>
                <div className="mt-1 text-slate-400">{e.subject}</div>
                <div className="mt-1">{e.obligation}</div>
                {openId === e.eventId ? (
                  <div className="mt-2 space-y-2">
                    <input
                      value={note}
                      onChange={(ev) => setNote(ev.target.value)}
                      placeholder="What did you do about it? (20 characters minimum)"
                      className={inputClass}
                    />
                    {blocked && <Refusal text={blocked} />}
                    <button
                      className={btnClass}
                      disabled={busy || Boolean(blocked)}
                      onClick={() => void answer(e)}
                    >
                      Record the answer
                    </button>
                  </div>
                ) : (
                  <button
                    className={`${btnClass} mt-2`}
                    onClick={() => {
                      setOpenId(e.eventId);
                      setNote("");
                    }}
                  >
                    Answer this
                  </button>
                )}
              </div>
            );
          })}
          {reading.answered.map((e) => (
            <div
              key={e.eventId}
              className="rounded border border-white/8 bg-white/[0.02] px-2.5 py-2 text-[11px] text-slate-400"
            >
              <span className="text-slate-300">
                {developEventLabel(e.eventName)}
              </span>{" "}
              — {e.subject}. Answered by {e.answeredByName ?? "a named person"}:{" "}
              {e.answerNote}
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

/* ────────────────────── D12.10 — the Change Impact Agent ────────────────── */

export function ChangeImpactAgentPanel({
  caseId,
  canPlan,
  reloadKey,
}: {
  caseId: string;
  canPlan: boolean;
  reloadKey?: number;
}) {
  const [reports, setReports] = useState<ChangeImpactReportsPayload | null>(
    null,
  );
  // The selectable objects come from the SAME graph read the thread panel
  // uses. A second query for "which objects are on this case" would be a
  // second answer to a question that already has one.
  const [objects, setObjects] = useState<
    { id: number; objectRef: string; objectKind: string }[]
  >([]);
  const [result, setResult] = useState<ChangeImpactAgentResult | null>(null);
  const [objectId, setObjectId] = useState<number | "">("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [reportPayload, graph] = await Promise.all([
        getChangeImpactReports(caseId),
        getCaseThreadGraph(caseId),
      ]);
      setReports(reportPayload);
      setObjects(
        (graph.objects ?? [])
          .filter((o) => o.status === "live")
          .map((o) => ({
            id: o.id,
            objectRef: o.objectRef,
            objectKind: o.objectKind,
          })),
      );
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [caseId]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  const run = async (record: boolean) => {
    if (objectId === "") return;
    setBusy(true);
    try {
      const res = await runChangeImpactAgent({
        caseId,
        objectId: Number(objectId),
        record,
      });
      setResult(res);
      if (record) await load();
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const reading = readChangeImpactReports(reports);

  return (
    <Section
      icon={<GitBranch className="h-4 w-4 text-signal-cyan" />}
      title="Change Impact Agent (spec §60)"
      subtitle="What does this change touch? The walk is the digital thread's ONE traversal — this agent adds no second graph and no second predicate. Where the thread is gapped it REFUSES and names the gap; it can change nothing."
    >
      <ErrorLine error={error} />
      <p className="text-xs text-slate-300">{reading.headline}</p>
      {canPlan && (
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={objectId}
            onChange={(e) =>
              setObjectId(e.target.value === "" ? "" : Number(e.target.value))
            }
            className={`${inputClass} max-w-xs`}
          >
            <option value="">Which object changed?</option>
            {objects.map((o) => (
              <option key={o.id} value={o.id}>
                {o.objectRef} ({o.objectKind})
              </option>
            ))}
          </select>
          <button
            className={btnClass}
            disabled={busy || objectId === ""}
            onClick={() => void run(false)}
          >
            Read the impact
          </button>
          <button
            className={btnClass}
            disabled={busy || objectId === ""}
            onClick={() => void run(true)}
          >
            Read and record
          </button>
        </div>
      )}
      {result && (
        <div className="space-y-2">
          {result.refused ? (
            <Refusal text={result.reading.headline} />
          ) : (
            <p className="text-xs text-slate-300">{result.reading.headline}</p>
          )}
          {result.reading.gapLines.map((g, i) => (
            <Refusal key={i} text={g} />
          ))}
          {result.reading.affectedLines.length > 0 && (
            <ul className="space-y-1 text-[11px] text-slate-400">
              {result.reading.affectedLines.map((l, i) => (
                <li key={i}>· {l}</li>
              ))}
            </ul>
          )}
          {result.providerNote && (
            <p className="text-[11px] text-slate-500">{result.providerNote}</p>
          )}
          {result.aiConsequences.length > 0 && (
            <div className="space-y-1">
              <AiLabel model={result.model} />
              {result.aiConsequences.map((c, i) => (
                <p key={i} className="text-[11px] text-fuchsia-200/80">
                  {c.objectRef}: {c.consequence}
                </p>
              ))}
            </div>
          )}
          {result.aiDropped.map((d, i) => (
            <p key={i} className="text-[11px] text-slate-500">
              dropped: {d}
            </p>
          ))}
          {result.recordNote && <Refusal text={result.recordNote} />}
          <p className="text-[11px] text-slate-500">{result.disclaimer}</p>
        </div>
      )}
      {reading.reports.length > 0 && (
        <div className="space-y-1">
          {reading.reports.slice(0, 5).map((r) => (
            <div
              key={r.id}
              className="rounded border border-white/8 bg-white/[0.02] px-2.5 py-1.5 text-[11px] text-slate-400"
            >
              {new Date(r.asAt).toISOString().slice(0, 10)} · {r.objectRef} ·{" "}
              {r.refused
                ? `REFUSED with ${r.gapCount} gap(s); the ${r.reachedCount} object(s) reached are a floor`
                : `${r.downstreamCount} downstream object(s)`}
              {r.model ? ` · narrative from ${r.model}, labelled` : ""}
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

/* ───────────────────────── D12.13 — RAM, case-scoped ────────────────────── */

export function CaseRamPanel({
  caseId,
  canPlan,
  reloadKey,
}: {
  caseId: string;
  canPlan: boolean;
  reloadKey?: number;
}) {
  const [profile, setProfile] = useState<RamProfile | null>(null);
  const [recorded, setRecorded] = useState<{
    report_id?: number;
    run_id?: string;
    refusalCount?: number;
  } | null>(null);
  const [history, setHistory] = useState<
    { id: number; asAt: string; refused: boolean; refusals: string[] }[]
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await getRamAgentReports(caseId);
      setHistory(
        res.reports.map((r) => ({
          id: r.id,
          asAt: r.asAt,
          refused: r.refused,
          refusals: r.refusals,
        })),
      );
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [caseId]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  const run = async () => {
    setBusy(true);
    try {
      const res = await runCaseRamAgent(caseId);
      setProfile(res.profile);
      setRecorded(res.recorded);
      await load();
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      icon={<Activity className="h-4 w-4 text-signal-cyan" />}
      title="RAM for this case (spec §63)"
      subtitle="The shipped reliability kernel, scoped to the assets bound to this case and the availability targets recorded on its capital project. No arithmetic is re-implemented here, and every leg that cannot be computed is named."
    >
      <ErrorLine error={error} />
      {canPlan && (
        <button className={btnClass} disabled={busy} onClick={() => void run()}>
          Run the RAM reading
        </button>
      )}
      {profile && (
        <div className="space-y-1">
          {profile.refused ? (
            <Refusal text={profile.headline} />
          ) : (
            <p className="text-xs text-slate-300">{profile.headline}</p>
          )}
          {ramProfileLines(profile)
            .slice(1)
            .map((l, i) => (
              <p key={i} className="text-[11px] text-slate-400">
                {l}
              </p>
            ))}
          {profile.refusals.map((r, i) => (
            <Refusal key={`r${i}`} text={r} />
          ))}
          {recorded?.run_id && (
            <p className="text-[11px] text-slate-500">
              Lineage run {recorded.run_id} records the method, the kernel
              version, the inputs and{" "}
              {recorded.refusalCount === undefined
                ? "an unreported number of"
                : recorded.refusalCount}{" "}
              refusal(s).
            </p>
          )}
        </div>
      )}
      {history.length > 0 && (
        <div className="space-y-1">
          {history.slice(0, 5).map((h) => (
            <div
              key={h.id}
              className="rounded border border-white/8 bg-white/[0.02] px-2.5 py-1.5 text-[11px] text-slate-400"
            >
              {new Date(h.asAt).toISOString().slice(0, 10)} ·{" "}
              {h.refused ? "REFUSED" : "read"} · {h.refusals.length} refusal(s)
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

/* ───────────────── D11.09 — Sync Information, composed ──────────────────── */

interface EngineLeg {
  built: boolean;
  reason?: string;
  registerRows?: string[];
}

export function InformationEnginePanel({
  caseId,
  reloadKey,
}: {
  caseId: string;
  reloadKey?: number;
}) {
  const [engine, setEngine] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setEngine(await getCaseInformationEngine(caseId));
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [caseId, reloadKey]);

  const legs = (engine?.legs ?? {}) as Record<string, EngineLeg>;
  const refusals = (engine?.refusals ?? []) as string[];
  const graph = (engine?.graph ?? {}) as { absentEdgeCount?: number };

  return (
    <Section
      icon={<Library className="h-4 w-4 text-signal-cyan" />}
      title="Sync Information (module)"
      subtitle="Digital thread, documentation, asset-data readiness — composed from the reads that exist. There is deliberately NO composite score: averaging the legs that are built over the one that is not is how a partial module reads as a finished one."
    >
      <ErrorLine error={error} />
      {engine && (
        <>
          <p className="text-xs text-slate-300">{String(engine.headline)}</p>
          <div className="space-y-1">
            {Object.entries(legs).map(([key, leg]) => (
              <p
                key={key}
                className={`text-[11px] ${leg.built ? "text-slate-400" : "text-amber-200"}`}
              >
                {key}: {leg.built ? "built" : "NOT BUILT"}
                {leg.reason ? ` — ${leg.reason}` : ""}
                {leg.registerRows ? ` (${leg.registerRows.join(", ")})` : ""}
              </p>
            ))}
          </div>
          {typeof graph.absentEdgeCount === "number" && (
            <p className="text-[11px] text-slate-500">
              §34: {graph.absentEdgeCount} of nineteen relationships are absent
              because an endpoint object is unbuilt.
            </p>
          )}
          {refusals.map((r, i) => (
            <Refusal key={i} text={r} />
          ))}
        </>
      )}
    </Section>
  );
}
