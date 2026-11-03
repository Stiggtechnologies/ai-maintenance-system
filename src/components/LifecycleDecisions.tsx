/**
 * LifecycleDecisions — repair, replace, redesign or defer
 * (capability register C8.09, C2.10).
 *
 * The failure model comes from the validated Weibull engine in
 * src/lib/reliability. Ranking uses the discounted life-cycle-cost kernel
 * through buildDiscountedLifecycleComparison. The database supplies the
 * governed discount rate and the asset economics, then stores the frozen
 * inputs. It does not keep a second copy of the arithmetic.
 *
 * An option that cannot be priced is shown as unpriced with its missing inputs
 * named, and is never ranked. Uncertainty travels with every verdict, because
 * the cheapest option computed from six failures and two guessed costs is not
 * a finding — and a recommendation without its uncertainty invites a decision
 * the evidence cannot support.
 */
import { useState, type FormEvent } from "react";
import { Scale3d, TriangleAlert, CircleHelp } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import { supabase } from "../lib/supabase";
import { weibullMLE } from "../lib/reliability";
import { deferralRisk, type AssetEconomics } from "../lib/lifecycle";
import {
  buildDiscountedLifecycleComparison,
  type DiscountedOptionView,
} from "../lib/lifecycle/discounted-evaluation";
import { LoadingState, ErrorState } from "./ui/AsyncStates";
import { useAuth } from "./AuthProvider";

interface Evaluation {
  id: string;
  asset: string;
  recommended: string | null;
  uncertainty: "low" | "moderate" | "high";
  uncertainty_reasons: string[];
  rationale: string;
  evaluated_at: string;
  decision: string | null;
  decision_note: string | null;
  options: DiscountedOptionView[];
}

interface DiscountPolicyView {
  assumptionId: string | null;
  rateText: string | null;
  owner: string | null;
  basis: string | null;
  effectiveFrom: string | null;
  reviewDue: string | null;
  refusal: string | null;
  error?: string;
  operative?: boolean;
}

interface Position {
  assets: number;
  assets_with_economics: number;
  economics_coverage_pct: number | null;
  evaluations: Evaluation[];
  note: string;
  discountPolicy?: DiscountPolicyView | null;
}

interface Inputs {
  asset_id: string;
  asset_name: string;
  inter_failure_hours: number[];
  failures: number;
  hours_since_last_failure: number;
  economics: AssetEconomics;
  missing_inputs: string[];
  sufficient_for_failure_model: boolean;
  criticality: string | null;
  note: string;
  error?: string;
}

const UNCERTAINTY_STYLE: Record<string, string> = {
  low: "border-green-500/30 bg-green-500/10 text-green-300",
  moderate: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  high: "border-red-500/30 bg-red-500/10 text-red-300",
};

const money = (v: number | null) =>
  v == null ? "unpriced" : `$${Math.round(v).toLocaleString()}/yr`;

const statedNumber = (raw: string, label: string): number | null => {
  if (raw.trim() === "") return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${label} is not a number.`);
  return value;
};

const LIFECYCLE_DECISION_ROLES = new Set([
  "maintenance_manager",
  "reliability_engineer",
  "executive",
  "admin",
]);

const HIGH_UNCERTAINTY_ACCEPTANCE_ROLES = new Set([
  "reliability_engineer",
  "executive",
  "admin",
]);

const DISCOUNT_POLICY_ROLES = new Set(["executive", "admin"]);

type LifecycleDecision = "accepted" | "rejected" | "deferred_decision";

interface DecisionResult {
  evaluation_id?: string;
  decision?: LifecycleDecision;
  error?: string;
}

export function LifecycleDecisions() {
  const { profile } = useAuth();
  const [running, setRunning] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [decisionNotes, setDecisionNotes] = useState<Record<string, string>>(
    {},
  );
  const [processingDecision, setProcessingDecision] = useState<string | null>(
    null,
  );
  const [decisionMessages, setDecisionMessages] = useState<
    Record<string, string>
  >({});
  const [redesignCost, setRedesignCost] = useState("");
  const [redesignReduction, setRedesignReduction] = useState("");
  const [policyRate, setPolicyRate] = useState("");
  const [policyOwner, setPolicyOwner] = useState("");
  const [policyBasis, setPolicyBasis] = useState("");
  const [policyEffective, setPolicyEffective] = useState("");
  const [policyReview, setPolicyReview] = useState("");
  const [policyMessage, setPolicyMessage] = useState<string | null>(null);
  const [recordingPolicy, setRecordingPolicy] = useState(false);
  const { data, loading, error, refetch } = useAsyncData<Position>(async () => {
    const { data: r, error: e } = await supabase.rpc(
      "get_lifecycle_position",
      {},
    );
    if (e) throw new Error(e.message);
    return r as Position;
  }, []);

  /**
   * Runs the analysis for the asset with the most corrective history — the one
   * where a life model is best supported — and records it with its inputs.
   */
  async function evaluateWorstActor() {
    setRunning(true);
    setPreview(null);
    const { data: assetRows } = await supabase
      .from("work_orders")
      .select("asset_id")
      .eq("work_type", "corrective")
      .not("completed_at", "is", null)
      .limit(2000);
    const counts = new Map<string, number>();
    for (const r of (assetRows ?? []) as { asset_id: string | null }[]) {
      if (r.asset_id) counts.set(r.asset_id, (counts.get(r.asset_id) ?? 0) + 1);
    }
    const worst = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (!worst) {
      setRunning(false);
      setPreview("No corrective history to analyse.");
      return;
    }

    const { data: raw } = await supabase.rpc("get_lifecycle_inputs", {
      p_asset_id: worst,
    });
    const inputs = raw as Inputs;
    if (inputs?.error || !inputs.sufficient_for_failure_model) {
      setRunning(false);
      setPreview(inputs?.note ?? inputs?.error ?? "Inputs unavailable.");
      return;
    }

    let fit;
    try {
      fit = weibullMLE(inputs.inter_failure_hours.filter((t) => t > 0));
    } catch (e) {
      setRunning(false);
      setPreview(e instanceof Error ? e.message : "Failure model unavailable.");
      return;
    }

    let redesignCostUsd: number | null;
    let redesignMaintenanceReductionPct: number | null;
    try {
      redesignCostUsd = statedNumber(redesignCost, "Redesign cost");
      redesignMaintenanceReductionPct = statedNumber(
        redesignReduction,
        "Expected maintenance reduction",
      );
    } catch (invalid) {
      setRunning(false);
      setPreview(
        invalid instanceof Error
          ? invalid.message
          : "Redesign inputs are not usable.",
      );
      return;
    }

    const { data: policyRaw, error: policyError } = await supabase.rpc(
      "get_lifecycle_discount_policy",
      {},
    );
    if (policyError) {
      setRunning(false);
      setPreview(policyError.message);
      return;
    }
    const policy = policyRaw as DiscountPolicyView | null;
    if (policy?.error) {
      setRunning(false);
      setPreview(policy.error);
      return;
    }

    const risk = deferralRisk(
      fit,
      inputs.hours_since_last_failure,
      30,
      inputs.economics,
    );
    const usablePolicy =
      policy &&
      policy.refusal == null &&
      policy.rateText != null &&
      policy.owner != null &&
      policy.basis != null
        ? {
            rate: Number(policy.rateText),
            owner: policy.owner,
            basis: policy.basis,
          }
        : null;
    const verdict = buildDiscountedLifecycleComparison({
      economics: inputs.economics,
      risk,
      redesignCostUsd,
      redesignMaintenanceReductionPct,
      policy: usablePolicy,
      fit,
    });
    const consequence = `Conditional failure probability over 30 days is ${(risk.probability * 100).toFixed(1)}%. Asset criticality: ${inputs.criticality ?? "not recorded"}.`;

    const { data: recorded, error: recordError } = await supabase.rpc(
      "record_lifecycle_evaluation",
      {
        p_asset_id: worst,
        p_inputs: {
          ...inputs,
          weibull: { beta: fit.beta, eta: fit.eta, failures: fit.failures },
          deferral_probability_30d: risk.probability,
          discountPolicy:
            usablePolicy && policy
              ? {
                  assumptionId: policy.assumptionId,
                  rateText: policy.rateText,
                  owner: policy.owner,
                  basis: policy.basis,
                }
              : { refusal: policy?.refusal ?? verdict.refusal },
          discounted: {
            preferred: verdict.recommended,
            refusal: verdict.refusal,
            reason: verdict.comparison?.reason ?? null,
          },
        },
        p_options: verdict.options,
        p_recommended: verdict.recommended,
        p_uncertainty_level: verdict.uncertainty.level,
        p_uncertainty_reasons: verdict.uncertainty.reasons,
        p_rationale: `${verdict.rationale} ${consequence}`,
      },
    );
    setRunning(false);
    if (recordError) {
      setPreview(recordError.message);
      return;
    }
    const recordedBody = recorded as { error?: string } | null;
    if (recordedBody?.error) {
      setPreview(recordedBody.error);
      return;
    }
    setPreview(
      `${inputs.asset_name}: β=${fit.beta.toFixed(2)}, ${(risk.probability * 100).toFixed(1)}% chance of failure in 30 days. ${verdict.rationale} ${consequence}`,
    );
    refetch();
  }

  async function recordDiscountPolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRecordingPolicy(true);
    setPolicyMessage(null);
    try {
      const rate = statedNumber(policyRate, "Discount rate");
      if (rate == null)
        throw new Error("Record the discount rate as a decimal.");
      const { data: raw, error: rpcError } = await supabase.rpc(
        "record_lifecycle_discount_policy",
        {
          p_rate: rate,
          p_owner: policyOwner.trim(),
          p_basis: policyBasis.trim(),
          p_effective_from: policyEffective,
          p_review_due: policyReview,
        },
      );
      if (rpcError) throw new Error(rpcError.message);
      const result = raw as DiscountPolicyView | null;
      if (result?.error) throw new Error(result.error);
      setPolicyMessage(
        result?.operative === false
          ? "Discount policy recorded. It is not operative until its effective date."
          : "Discount policy recorded. It does not itself approve a repair, replacement, redesign, or deferral.",
      );
      refetch();
    } catch (policyError) {
      setPolicyMessage(
        policyError instanceof Error
          ? policyError.message
          : "The discount policy was not recorded.",
      );
    } finally {
      setRecordingPolicy(false);
    }
  }

  async function decideEvaluation(
    evaluation: Evaluation,
    decision: LifecycleDecision,
  ) {
    const note = decisionNotes[evaluation.id]?.trim() ?? "";
    if (note.length < 10) {
      setDecisionMessages((current) => ({
        ...current,
        [evaluation.id]: "Record at least 10 characters of decision reasoning.",
      }));
      return;
    }

    setProcessingDecision(evaluation.id);
    setDecisionMessages((current) => ({
      ...current,
      [evaluation.id]: "",
    }));
    try {
      const { data: raw, error: rpcError } = await supabase.rpc(
        "decide_lifecycle_evaluation",
        {
          p_id: evaluation.id,
          p_decision: decision,
          p_note: note,
        },
      );
      if (rpcError) throw new Error(rpcError.message);
      const result = raw as DecisionResult | null;
      if (result?.error) throw new Error(result.error);
      if (result?.decision !== decision) {
        throw new Error("The database did not confirm the lifecycle decision.");
      }
      setDecisionMessages((current) => ({
        ...current,
        [evaluation.id]: `Human decision recorded: ${decision}.`,
      }));
      refetch();
    } catch (decisionError) {
      setDecisionMessages((current) => ({
        ...current,
        [evaluation.id]:
          decisionError instanceof Error
            ? decisionError.message
            : "The lifecycle decision was not recorded.",
      }));
    } finally {
      setProcessingDecision(null);
    }
  }

  if (loading) return <LoadingState label="Loading lifecycle position" />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  const evals = data?.evaluations ?? [];
  const policy = data?.discountPolicy;
  const policyReady =
    policy != null && policy.refusal == null && policy.rateText != null;

  return (
    <section aria-labelledby="lifecycle-heading" className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            id="lifecycle-heading"
            className="flex items-center gap-2 text-lg font-semibold text-white"
          >
            <Scale3d className="h-5 w-5 text-signal-gold" aria-hidden />
            Repair · Replace · Redesign · Defer
            <span className="text-xs font-normal text-slate-500">
              {data?.assets_with_economics}/{data?.assets} assets priced
            </span>
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-300">{data?.note}</p>
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <label className="text-xs text-slate-400" htmlFor="redesign-cost">
              Redesign cost (USD)
              <input
                id="redesign-cost"
                value={redesignCost}
                onChange={(event) => setRedesignCost(event.target.value)}
                inputMode="decimal"
                className="mt-1 block w-36 rounded-lg border border-white/10 bg-slate-950 px-2 py-1 text-sm text-white"
              />
            </label>
            <label
              className="text-xs text-slate-400"
              htmlFor="redesign-reduction"
            >
              Expected maintenance reduction (%)
              <input
                id="redesign-reduction"
                value={redesignReduction}
                onChange={(event) => setRedesignReduction(event.target.value)}
                inputMode="decimal"
                className="mt-1 block w-36 rounded-lg border border-white/10 bg-slate-950 px-2 py-1 text-sm text-white"
              />
            </label>
          </div>
          <button
            onClick={evaluateWorstActor}
            disabled={running}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-slate-200 hover:bg-white/10 disabled:opacity-50 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-signal-cyan"
          >
            {running ? "Analysing…" : "Evaluate worst actor"}
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-white/6 bg-white/2 p-4 text-sm text-slate-300">
        <p className="font-medium text-slate-100">Governed discount rate</p>
        {policyReady ? (
          <p className="mt-1 text-xs leading-relaxed text-slate-400">
            {(Number(policy.rateText) * 100).toFixed(2)}% set by {policy.owner}.{" "}
            {policy.basis} Review due {policy.reviewDue}. The comparison uses
            this single rate and does not invent a sensitivity band.
          </p>
        ) : (
          <p className="mt-1 text-xs leading-relaxed text-slate-400">
            {policy?.refusal ??
              "No governed real discount rate is loaded for this tenant. Repair, replace, redesign and defer are not ranked until an executive or administrator records one."}
          </p>
        )}
        {DISCOUNT_POLICY_ROLES.has(profile?.role ?? "") ? (
          <form
            className="mt-3 grid gap-2 sm:grid-cols-2"
            onSubmit={(event) => void recordDiscountPolicy(event)}
          >
            <label className="text-xs text-slate-400" htmlFor="discount-rate">
              Rate (decimal)
              <input
                id="discount-rate"
                required
                value={policyRate}
                onChange={(event) => setPolicyRate(event.target.value)}
                inputMode="decimal"
                className="mt-1 block w-full rounded-lg border border-white/10 bg-slate-950 px-2 py-1 text-sm text-white"
              />
            </label>
            <label className="text-xs text-slate-400" htmlFor="discount-owner">
              Finance owner
              <input
                id="discount-owner"
                required
                minLength={3}
                value={policyOwner}
                onChange={(event) => setPolicyOwner(event.target.value)}
                className="mt-1 block w-full rounded-lg border border-white/10 bg-slate-950 px-2 py-1 text-sm text-white"
              />
            </label>
            <label
              className="text-xs text-slate-400 sm:col-span-2"
              htmlFor="discount-basis"
            >
              Basis
              <textarea
                id="discount-basis"
                required
                minLength={15}
                rows={2}
                value={policyBasis}
                onChange={(event) => setPolicyBasis(event.target.value)}
                className="mt-1 block w-full rounded-lg border border-white/10 bg-slate-950 px-2 py-1 text-sm text-white"
              />
            </label>
            <label
              className="text-xs text-slate-400"
              htmlFor="discount-effective"
            >
              Effective from
              <input
                id="discount-effective"
                required
                type="date"
                value={policyEffective}
                onChange={(event) => setPolicyEffective(event.target.value)}
                className="mt-1 block w-full rounded-lg border border-white/10 bg-slate-950 px-2 py-1 text-sm text-white"
              />
            </label>
            <label className="text-xs text-slate-400" htmlFor="discount-review">
              Review due
              <input
                id="discount-review"
                required
                type="date"
                value={policyReview}
                onChange={(event) => setPolicyReview(event.target.value)}
                className="mt-1 block w-full rounded-lg border border-white/10 bg-slate-950 px-2 py-1 text-sm text-white"
              />
            </label>
            <div className="sm:col-span-2">
              <button
                type="submit"
                disabled={recordingPolicy}
                className="rounded-lg border border-signal-cyan/30 px-3 py-1.5 text-xs font-semibold text-signal-cyan disabled:opacity-50"
              >
                {recordingPolicy ? "Recording…" : "Record discount policy"}
              </button>
              <p className="mt-2 text-xs text-slate-500">
                Requires a verified second factor and an AAL2 session. Recording
                the rate does not approve work, spend, or a return to service,
                and this screen does not call an external finance system.
              </p>
              {policyMessage && (
                <p aria-live="polite" className="mt-2 text-xs text-slate-300">
                  {policyMessage}
                </p>
              )}
            </div>
          </form>
        ) : (
          <p className="mt-2 text-xs text-slate-500">
            An executive or administrator records the rate. Other roles can
            evaluate and, where authorized, decide against the rate already in
            force.
          </p>
        )}
      </div>

      {preview && (
        <p className="rounded-xl border border-white/6 bg-white/2 p-3 text-xs leading-relaxed text-slate-300">
          {preview}
        </p>
      )}

      {evals.length === 0 ? (
        <p className="rounded-xl border border-white/6 bg-white/2 p-4 text-sm text-slate-400">
          No lifecycle evaluation has been recorded. The deferral question — can
          this wait until the next window? — is answerable from failure history
          alone; the repair-versus-replace question needs a replacement value,
          which is yours to supply.
        </p>
      ) : (
        <ul className="space-y-2">
          {evals.map((e) => (
            <li
              key={e.id}
              className="rounded-xl border border-white/6 bg-overlook-deep/40 p-4"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium text-slate-200">
                  {e.asset}
                  {e.recommended ? (
                    <span className="ml-2 text-signal-cyan">
                      → {e.recommended}
                    </span>
                  ) : (
                    <span className="ml-2 text-slate-500">
                      → no ranking possible
                    </span>
                  )}
                </p>
                <div className="flex items-center gap-2 text-xs">
                  <span
                    className={`rounded-full border px-2 py-0.5 ${UNCERTAINTY_STYLE[e.uncertainty]}`}
                  >
                    {e.uncertainty} uncertainty
                  </span>
                  {e.decision && (
                    <span className="rounded-full border border-white/10 px-2 py-0.5 text-slate-400">
                      {e.decision}
                    </span>
                  )}
                </div>
              </div>

              <p className="mt-1 text-xs text-slate-400">{e.rationale}</p>

              <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                {(e.options ?? []).map((o) => (
                  <li
                    key={o.option}
                    className="flex items-baseline justify-between gap-2 text-xs"
                  >
                    <span
                      className={
                        o.option === e.recommended
                          ? "text-signal-cyan"
                          : "text-slate-400"
                      }
                    >
                      {o.option}
                    </span>
                    <span
                      className={`font-mono tabular-nums ${o.annualCostUsd == null ? "text-slate-600" : "text-slate-300"}`}
                    >
                      {money(o.annualCostUsd)}
                      {o.npv != null
                        ? ` · NPV ${money(o.npv).replace("/yr", "")}`
                        : ""}
                    </span>
                  </li>
                ))}
              </ul>

              {(e.options ?? []).some((o) => o.missingInputs?.length > 0) && (
                <p className="mt-1.5 flex items-start gap-1.5 text-xs text-slate-500">
                  <CircleHelp className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                  Unpriced because these are not recorded:{" "}
                  {[
                    ...new Set(
                      (e.options ?? []).flatMap((o) => o.missingInputs ?? []),
                    ),
                  ].join(", ")}
                  .
                </p>
              )}

              {e.uncertainty_reasons?.length > 0 && (
                <ul className="mt-1.5 space-y-0.5">
                  {e.uncertainty_reasons.map((r) => (
                    <li
                      key={r}
                      className="flex items-start gap-1.5 text-xs text-amber-200/80"
                    >
                      <TriangleAlert
                        className="mt-0.5 h-3 w-3 shrink-0"
                        aria-hidden
                      />
                      {r}
                    </li>
                  ))}
                </ul>
              )}

              {e.decision ? (
                e.decision_note && (
                  <p className="mt-3 rounded-lg border border-white/8 bg-white/3 p-3 text-xs text-slate-300">
                    Human decision basis: {e.decision_note}
                  </p>
                )
              ) : LIFECYCLE_DECISION_ROLES.has(profile?.role ?? "") ? (
                <div className="mt-4 space-y-2 border-t border-white/8 pt-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">
                      Human decision required
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Accepting adopts the recorded recommendation; rejecting or
                      deferring records the determination but performs no work,
                      purchase, operating-limit change, or return to service.
                    </p>
                  </div>
                  <label
                    className="block text-xs text-slate-400"
                    htmlFor={`lifecycle-decision-note-${e.id}`}
                  >
                    Decision basis for {e.asset}
                  </label>
                  <textarea
                    id={`lifecycle-decision-note-${e.id}`}
                    rows={3}
                    minLength={10}
                    value={decisionNotes[e.id] ?? ""}
                    onChange={(event) =>
                      setDecisionNotes((current) => ({
                        ...current,
                        [e.id]: event.target.value,
                      }))
                    }
                    placeholder="State the evidence reviewed, uncertainty accepted, and reason for this decision."
                    className="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-signal-cyan"
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      aria-label={
                        e.recommended
                          ? `Accept ${e.recommended} recommendation`
                          : "Accept recommendation unavailable"
                      }
                      disabled={
                        processingDecision === e.id ||
                        (decisionNotes[e.id]?.trim().length ?? 0) < 10 ||
                        !e.recommended ||
                        (e.uncertainty === "high" &&
                          !HIGH_UNCERTAINTY_ACCEPTANCE_ROLES.has(
                            profile?.role ?? "",
                          ))
                      }
                      onClick={() => void decideEvaluation(e, "accepted")}
                      className="rounded-lg bg-signal-cyan px-3 py-2 text-xs font-semibold text-overlook-void disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {e.recommended
                        ? `Accept ${e.recommended}`
                        : "No recommendation to accept"}
                    </button>
                    <button
                      type="button"
                      disabled={
                        processingDecision === e.id ||
                        (decisionNotes[e.id]?.trim().length ?? 0) < 10
                      }
                      onClick={() => void decideEvaluation(e, "rejected")}
                      className="rounded-lg border border-red-400/40 px-3 py-2 text-xs font-semibold text-red-200 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Reject recommendation
                    </button>
                    <button
                      type="button"
                      disabled={
                        processingDecision === e.id ||
                        (decisionNotes[e.id]?.trim().length ?? 0) < 10
                      }
                      onClick={() =>
                        void decideEvaluation(e, "deferred_decision")
                      }
                      className="rounded-lg border border-amber-400/40 px-3 py-2 text-xs font-semibold text-amber-200 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Defer decision
                    </button>
                  </div>
                  {e.uncertainty === "high" &&
                    !HIGH_UNCERTAINTY_ACCEPTANCE_ROLES.has(
                      profile?.role ?? "",
                    ) && (
                      <p className="text-xs text-amber-200/80">
                        High-uncertainty acceptance requires reliability
                        engineering or executive authority. You may still reject
                        or defer it with a recorded basis.
                      </p>
                    )}
                  {decisionMessages[e.id] && (
                    <p aria-live="polite" className="text-xs text-slate-300">
                      {decisionMessages[e.id]}
                    </p>
                  )}
                </div>
              ) : (
                <p className="mt-4 border-t border-white/8 pt-3 text-xs text-slate-500">
                  AI may prepare the evaluation, but cannot decide it. An
                  authorized maintenance, reliability, executive, or
                  administrator identity must record the human determination.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
