/**
 * VerificationLoop — did the approved action produce the intended outcome?
 * (register C4.08; the closing question of the enterprise target state.)
 *
 * The panel's job is to keep three silent states apart, because all three
 * render as "nothing to see" if unmanaged:
 *
 *   unwatched — actioned before obligations existed; nothing tracks them.
 *   overdue   — an obligation exists and its date passed. A verification that
 *               never happens is indistinguishable from one that passed.
 *   pending   — open and in date. The one healthy quiet state.
 *
 * A recorded FAILURE is displayed as the system working: a verification
 * process that has never failed anything has never been tested by reality.
 */
import { useMemo, useState } from "react";
import {
  CalendarCheck2,
  CheckCircle2,
  Clock,
  Info,
  RefreshCcw,
} from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import { supabase } from "../lib/supabase";
import {
  recordVerificationResult,
  type OpenVerification,
  type VerificationResultKind,
} from "../services/operatingLoopService";
import { assessLoop, type VerificationPosture } from "../lib/verification-loop";
import { LoadingState, ErrorState } from "./ui/AsyncStates";
import { useAuth } from "./AuthProvider";
import { RecommendationVerificationPlanDrawer } from "./RecommendationVerificationPlanDrawer";

const VERIFICATION_PLAN_ROLES = new Set([
  "admin",
  "executive",
  "maintenance_manager",
  "reliability_engineer",
  "planner",
]);

export function VerificationLoop() {
  const { profile } = useAuth();
  const canPlanVerification = VERIFICATION_PLAN_ROLES.has(profile?.role ?? "");
  const [planRow, setPlanRow] = useState<OpenVerification | null>(null);
  const { data, loading, error, refetch } = useAsyncData<{
    posture: VerificationPosture | null;
    open: OpenVerification[];
  }>(async () => {
    const [p, o] = await Promise.all([
      supabase.rpc("get_verification_posture"),
      supabase.rpc("get_open_verifications", { p_limit: 20 }),
    ]);
    if (p.error) throw new Error(p.error.message);
    if (o.error) throw new Error(o.error.message);
    const raw = (p.data as Record<string, number>[])?.[0] ?? null;
    return {
      posture: raw
        ? {
            actionedRecommendations: Number(raw.actionedRecommendations),
            withObligation: Number(raw.withObligation),
            openObligations: Number(raw.openObligations),
            overdue: Number(raw.overdue),
            achieved: Number(raw.achieved),
            notAchieved: Number(raw.notAchieved),
            inconclusive: Number(raw.inconclusive),
            waived: Number(raw.waived),
            actionedWithoutObligation: Number(raw.actionedWithoutObligation),
            unplannedOpen: Number(raw.unplannedOpen ?? 0),
            evidenceBackedCompleted: Number(
              raw.evidenceBackedCompleted ?? 0,
            ),
            legacyCompletedWithoutEvidence: Number(
              raw.legacyCompletedWithoutEvidence ?? 0,
            ),
          }
        : null,
      open: (o.data as OpenVerification[]) ?? [],
    };
  }, []);

  const loop = useMemo(() => assessLoop(data?.posture ?? null), [data]);

  if (loading) return <LoadingState label="Loading verification loop" />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  return (
    <section aria-labelledby="verify-heading" className="space-y-4">
      <div>
        <h2
          id="verify-heading"
          className="flex items-center gap-2 text-lg font-semibold text-white"
        >
          <RefreshCcw className="h-5 w-5 text-signal-cyan" aria-hidden />
          Verification Loop
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-300">
          Every released recommendation states how, when and by whom its
          intended outcome will be measured. The named owner closes the loop
          only against independently validated evidence or a completed work
          order from an approved read-only CMMS source.
        </p>
      </div>

      <div
        className={`flex items-start gap-2 rounded-xl border p-4 text-sm ${
          loop.overdue > 0 || loop.healthiest === "unwatched"
            ? "border-amber-500/30 bg-amber-500/5 text-amber-100"
            : "border-white/6 bg-white/2 text-slate-300"
        }`}
      >
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <p>{loop.reason}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-white/6 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">
            Loop closure
          </p>
          <p className="mt-1 font-mono text-2xl tabular-nums text-signal-cyan">
            {loop.loopClosureRate === null
              ? "—"
              : `${(loop.loopClosureRate * 100).toFixed(0)}%`}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Actioned recommendations with a recorded outcome.
          </p>
        </div>
        <div className="rounded-xl border border-white/6 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">
            Outcomes achieved
          </p>
          <p className="mt-1 font-mono text-2xl tabular-nums text-slate-300">
            {loop.outcomeSuccessRate === null
              ? "—"
              : `${(loop.outcomeSuccessRate * 100).toFixed(0)}%`}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Of verifications executed.
          </p>
        </div>
        <div className="rounded-xl border border-white/6 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">
            Overdue
          </p>
          <p
            className={`mt-1 font-mono text-2xl tabular-nums ${loop.overdue > 0 ? "text-amber-300" : "text-slate-300"}`}
          >
            {loop.overdue}
          </p>
          <p className="mt-1 text-xs text-slate-500">The number to escalate.</p>
        </div>
        <div className="rounded-xl border border-white/6 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">
            Unwatched
          </p>
          <p
            className={`mt-1 font-mono text-2xl tabular-nums ${loop.unwatched > 0 ? "text-rose-300" : "text-slate-300"}`}
          >
            {loop.unwatched}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Actioned with no obligation at all.
          </p>
        </div>
      </div>

      {data && data.open.length === 0 && (
        <div className="rounded-xl border border-white/6 p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
            <Clock className="h-4 w-4 text-signal-cyan" aria-hidden />
            Open verifications
          </h3>
          <p className="mt-2 text-sm text-slate-400">
            No open verification obligations. Approving a recommendation creates
            one. Until an obligation is open, there is nothing here to record.
          </p>
        </div>
      )}

      {data && data.open.length > 0 && (
        <div className="rounded-xl border border-white/6 p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
            <Clock className="h-4 w-4 text-signal-cyan" aria-hidden />
            Open verifications
          </h3>
          <ul className="mt-2 space-y-2">
            {data.open.map((o) => (
              <li
                key={o.obligationId}
                className="rounded-lg border border-white/4 p-3 text-sm"
              >
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-slate-200">
                    {o.recommendationTitle}
                  </span>
                  {o.subjectKind === "requirement" && (
                    <span className="rounded bg-white/5 px-1.5 py-0.5 text-xs text-slate-400">
                      requirement
                      {o.requirementRef ? ` ${o.requirementRef}` : ""} · counted
                      on the case, not in the posture above
                    </span>
                  )}
                  {o.assetName && (
                    <span className="text-xs text-slate-500">
                      {o.assetName}
                    </span>
                  )}
                  <span
                    className={`font-mono text-xs tabular-nums ${o.daysOverdue > 0 ? "text-amber-300" : "text-slate-500"}`}
                  >
                    due {o.dueDate}
                    {o.daysOverdue > 0 && ` · ${o.daysOverdue}d overdue`}
                  </span>
                  {o.dueDateAssumed && (
                    <span className="rounded bg-white/5 px-1.5 py-0.5 text-xs text-slate-500">
                      date assumed
                    </span>
                  )}
                </div>
                <p className="text-xs leading-relaxed text-slate-500">
                  {o.method}
                </p>
                {o.intendedOutcome && (
                  <p className="mt-1 text-xs text-slate-500">
                    Intended: {o.intendedOutcome}
                  </p>
                )}
                {o.acceptanceCriteria && (
                  <p className="mt-1 text-xs text-slate-500">
                    Accept when: {o.acceptanceCriteria}
                  </p>
                )}
                {o.verificationOwnerName && (
                  <p className="mt-1 text-xs text-slate-500">
                    Named owner: {o.verificationOwnerName}
                  </p>
                )}
                {o.subjectKind === "recommendation" &&
                !o.planComplete &&
                o.recommendationId ? (
                  <div className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/5 p-3">
                    <p className="text-xs text-amber-200">
                      This legacy obligation cannot be closed until a named
                      human records its method, acceptance criteria, intended
                      outcome, explicit date and accountable owner.
                    </p>
                    <button
                      onClick={() => setPlanRow(o)}
                      className="mt-2 flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-200"
                    >
                      <CalendarCheck2 className="h-3 w-3" aria-hidden />
                      {canPlanVerification
                        ? "Complete verification plan"
                        : "View verification plan"}
                    </button>
                  </div>
                ) : (
                  <RecordVerificationForm
                    obligation={o}
                    onRecorded={refetch}
                  />
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {loop.hasRecordedFailure && (
        <div className="flex items-start gap-2 rounded-xl border border-signal-cyan/25 bg-signal-cyan/5 p-4 text-sm text-slate-200">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>
            At least one verification has recorded a failed outcome and fed it
            into the learning loop. That is the loop working — a verification
            process that has never failed anything has never been tested.
          </p>
        </div>
      )}

      {planRow?.recommendationId && (
        <RecommendationVerificationPlanDrawer
          recommendationId={planRow.recommendationId}
          recommendationTitle={planRow.recommendationTitle}
          canGovern={canPlanVerification}
          onSaved={() => {
            setPlanRow(null);
            refetch();
          }}
          onClose={() => setPlanRow(null)}
        />
      )}
    </section>
  );
}

const RESULT_OPTIONS: {
  value: VerificationResultKind;
  label: string;
}[] = [
  { value: "achieved", label: "Achieved" },
  { value: "not_achieved", label: "Not achieved" },
  { value: "inconclusive", label: "Inconclusive" },
];

function RecordVerificationForm({
  obligation,
  onRecorded,
}: {
  obligation: OpenVerification;
  onRecorded: () => void;
}) {
  const [result, setResult] = useState<VerificationResultKind | null>(null);
  const [note, setNote] = useState("");
  const [sourceKey, setSourceKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    kind: "ok" | "err";
    text: string;
  } | null>(null);
  const evidenceRequired = obligation.evidenceRequired === true;
  const candidates = obligation.evidenceCandidates ?? [];
  const canSubmit =
    result !== null &&
    note.trim().length >= 10 &&
    (!evidenceRequired || sourceKey !== "");

  const submit = async () => {
    if (!canSubmit || result === null) return;
    const selected = candidates.find(
      (candidate) => `${candidate.kind}:${candidate.id}` === sourceKey,
    );
    setBusy(true);
    setMessage(null);
    try {
      const recorded = await recordVerificationResult(
        obligation.obligationId,
        result,
        note,
        selected?.kind === "evidence_item" ? selected.id : null,
        selected?.kind === "cmms_work_order" ? selected.id : null,
      );
      setMessage({ kind: "ok", text: recorded.detail });
      setNote("");
      setResult(null);
      setSourceKey("");
      onRecorded();
    } catch (e) {
      setMessage({
        kind: "err",
        text: e instanceof Error ? e.message : "Verification was not recorded.",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="mt-3 space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <fieldset className="flex flex-wrap gap-2" disabled={busy}>
        <legend className="sr-only">Verification result</legend>
        {RESULT_OPTIONS.map((opt) => (
          <label
            key={opt.value}
            className={`cursor-pointer rounded-lg border px-2.5 py-1 text-xs font-medium ${
              result === opt.value
                ? "border-signal-cyan/40 bg-signal-cyan/10 text-signal-cyan"
                : "border-white/8 bg-white/2 text-slate-400"
            }`}
          >
            <input
              type="radio"
              name={`verify-${obligation.obligationId}`}
              value={opt.value}
              checked={result === opt.value}
              onChange={() => setResult(opt.value)}
              className="sr-only"
            />
            {opt.label}
          </label>
        ))}
      </fieldset>
      <label className="block">
        <span className="text-xs text-slate-500">
          Measured note — what was measured, against what, and when
        </span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          required
          disabled={busy}
          placeholder="e.g. vibration at 4.1 mm/s vs 2.5 mm/s limit, 2026-08-29 after 48h run"
          className="mt-1 w-full rounded-lg border border-white/8 bg-[#0A1018] px-3 py-2 text-xs text-slate-200 placeholder:text-slate-600 focus:border-signal-cyan/40 focus:outline-none"
        />
      </label>
      {evidenceRequired && (
        <label className="block">
          <span className="text-xs text-slate-500">
            Governed evidence source — exactly one is required
          </span>
          <select
            value={sourceKey}
            onChange={(event) => setSourceKey(event.target.value)}
            disabled={busy || candidates.length === 0}
            className="mt-1 w-full rounded-lg border border-white/8 bg-[#0A1018] px-3 py-2 text-xs text-slate-200 disabled:opacity-50"
          >
            <option value="">Select validated evidence…</option>
            {candidates.map((candidate) => (
              <option
                key={`${candidate.kind}:${candidate.id}`}
                value={`${candidate.kind}:${candidate.id}`}
              >
                {candidate.kind === "cmms_work_order"
                  ? "CMMS work order"
                  : "Validated evidence"}
                {` · ${candidate.label}`}
              </option>
            ))}
          </select>
          {candidates.length === 0 && (
            <span className="mt-1 block text-xs text-amber-300">
              No eligible source yet. Independently validate recommendation
              evidence or synchronize a completed same-asset work order through
              an active approved read-only CMMS connector.
            </span>
          )}
        </label>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={busy || !canSubmit}
          className="rounded-lg border border-signal-cyan/30 bg-signal-cyan/10 px-3 py-1.5 text-xs font-semibold text-signal-cyan disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Recording…" : "Record verification"}
        </button>
        <p className="text-xs text-slate-500">
          Recorded once. A second call is refused.
        </p>
      </div>
      {message && (
        <p
          className={`text-xs ${message.kind === "ok" ? "text-teal-300" : "text-amber-300"}`}
          role={message.kind === "err" ? "alert" : "status"}
        >
          {message.text}
        </p>
      )}
    </form>
  );
}
