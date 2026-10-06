import { useCallback, useEffect, useState } from "react";
import { CalendarCheck2, Loader2, ShieldCheck, X } from "lucide-react";
import {
  getRecommendationVerificationPlan,
  getVerificationPlanOwners,
  recordRecommendationVerificationPlan,
  type RecommendationVerificationPlan,
  type VerificationPlanOwner,
} from "../services/operatingLoopService";
import { ErrorState, LoadingState } from "./ui/AsyncStates";

export function RecommendationVerificationPlanDrawer({
  recommendationId,
  recommendationTitle,
  canGovern,
  onClose,
  onSaved,
}: {
  recommendationId: string;
  recommendationTitle: string;
  canGovern: boolean;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const [plan, setPlan] = useState<RecommendationVerificationPlan | null>(null);
  const [owners, setOwners] = useState<VerificationPlanOwner[]>([]);
  const [method, setMethod] = useState("");
  const [acceptance, setAcceptance] = useState("");
  const [outcome, setOutcome] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [nextPlan, nextOwners] = await Promise.all([
        getRecommendationVerificationPlan(recommendationId),
        getVerificationPlanOwners(),
      ]);
      setPlan(nextPlan);
      setOwners(nextOwners);
      setMethod(nextPlan.method ?? "");
      setAcceptance(nextPlan.acceptanceCriteria ?? "");
      setOutcome(nextPlan.intendedOutcome ?? "");
      setDueDate(nextPlan.dueDate ?? "");
      setOwnerId(nextPlan.ownerId ?? "");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not load verification plan.",
      );
    }
  }, [recommendationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const editable =
    canGovern && plan !== null && plan.state !== "closed";
  const canSave =
    editable &&
    method.trim().length >= 10 &&
    acceptance.trim().length >= 20 &&
    outcome.trim().length >= 10 &&
    dueDate !== "" &&
    ownerId !== "";

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const next = await recordRecommendationVerificationPlan({
        recommendationId,
        method,
        acceptanceCriteria: acceptance,
        intendedOutcome: outcome,
        dueDate,
        ownerId,
      });
      setPlan(next);
      setSaved(
        next.state === "open_obligation"
          ? "Open verification debt replanned. The named owner must still measure and cite governed evidence."
          : "Verification plan recorded. Approval will snapshot it into the outcome obligation.",
      );
      onSaved?.();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not record verification plan.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="verification-plan-heading"
        className="h-full w-full max-w-xl overflow-y-auto border-l border-white/10 bg-[#0D1520] p-6"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2
              id="verification-plan-heading"
              className="flex items-center gap-2 text-sm font-semibold text-slate-200"
            >
              <CalendarCheck2 className="h-4 w-4 text-teal-400" aria-hidden />
              Outcome verification plan
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              {recommendationTitle}
            </p>
          </div>
          <button
            aria-label="Close"
            onClick={onClose}
            className="text-slate-400 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {!plan && !error && <LoadingState label="Loading verification plan…" />}
        {error && (
          <div className="mt-4">
            <ErrorState message={error} onRetry={load} />
          </div>
        )}

        {plan && (
          <>
            <div
              className={`mt-5 rounded-xl border p-4 text-xs ${
                plan.planComplete
                  ? "border-teal-500/25 bg-teal-500/5 text-slate-300"
                  : "border-amber-500/25 bg-amber-500/5 text-amber-100"
              }`}
            >
              <p className="flex items-center gap-2 font-semibold">
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
                {plan.planComplete
                  ? "Plan complete"
                  : plan.legacyDebt
                    ? "Legacy obligation requires an explicit plan"
                    : "Approval is blocked until this plan is complete"}
              </p>
              <p className="mt-2 text-slate-400">
                Planning and verification do not authorize work, change plant
                settings or accept operational risk. The customer retains those
                authorities.
              </p>
            </div>

            <div className="mt-5 space-y-3">
              <label className="block text-xs text-slate-400">
                Verification method
                <textarea
                  value={method}
                  onChange={(event) => setMethod(event.target.value)}
                  rows={3}
                  disabled={!editable || busy}
                  placeholder="How and from which governed source will the outcome be measured?"
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-slate-200 placeholder:text-slate-600 disabled:opacity-60"
                />
              </label>
              <label className="block text-xs text-slate-400">
                Intended outcome
                <textarea
                  value={outcome}
                  onChange={(event) => setOutcome(event.target.value)}
                  rows={2}
                  disabled={!editable || busy}
                  placeholder="What observable change should the approved action produce?"
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-slate-200 placeholder:text-slate-600 disabled:opacity-60"
                />
              </label>
              <label className="block text-xs text-slate-400">
                Acceptance criteria
                <textarea
                  value={acceptance}
                  onChange={(event) => setAcceptance(event.target.value)}
                  rows={3}
                  disabled={!editable || busy}
                  placeholder="State the measurable threshold and observation window that count as achieved."
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-slate-200 placeholder:text-slate-600 disabled:opacity-60"
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-xs text-slate-400">
                  Outcome verification date
                  <input
                    type="date"
                    value={dueDate}
                    min={new Date().toISOString().slice(0, 10)}
                    onChange={(event) => setDueDate(event.target.value)}
                    disabled={!editable || busy}
                    className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-slate-200 disabled:opacity-60"
                  />
                </label>
                <label className="block text-xs text-slate-400">
                  Named verification owner
                  <select
                    value={ownerId}
                    onChange={(event) => setOwnerId(event.target.value)}
                    disabled={!editable || busy}
                    className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-slate-200 disabled:opacity-60"
                  >
                    <option value="">Select a named human…</option>
                    {owners.map((owner) => (
                      <option key={owner.ownerId} value={owner.ownerId}>
                        {owner.fullName} · {owner.role.replaceAll("_", " ")}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            {editable && (
              <button
                onClick={() => void save()}
                disabled={busy || !canSave}
                className="mt-5 flex items-center gap-2 rounded-lg border border-teal-500/30 bg-teal-500/20 px-3 py-2 text-xs font-medium text-teal-300 disabled:opacity-40"
              >
                {busy && <Loader2 className="h-3 w-3 animate-spin" />}
                Record governed verification plan
              </button>
            )}
            {!canGovern && (
              <p className="mt-5 text-xs text-slate-500">
                Read-only view. A planning, engineering, maintenance or
                governance role must record or reassign this plan.
              </p>
            )}
            {saved && (
              <p className="mt-3 text-xs text-teal-300" role="status">
                {saved}
              </p>
            )}
          </>
        )}
      </section>
    </div>
  );
}
