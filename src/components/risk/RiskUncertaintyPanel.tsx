import { useMemo, useState, type FormEvent } from "react";
import { AlertTriangle, BarChart3, BadgeCheck, Scale } from "lucide-react";
import { useAsyncData } from "../../hooks/useAsyncData";
import { evaluateValueOfInformation } from "../../lib/risk-operating-system";
import {
  getRiskUncertaintyWorkspace,
  reviewRiskUncertaintyAnalysis,
  submitRiskUncertaintyAnalysis,
  type RiskUncertaintySensitivityInput,
} from "../../services/riskOperatingService";
import { ErrorState, LoadingState } from "../ui/AsyncStates";

const INPUT =
  "w-full rounded-lg border border-white/10 bg-[#101B27] p-2 text-xs text-white placeholder:text-slate-600";
const GOVERNANCE_ROLES = new Set([
  "reliability_engineer",
  "maintenance_manager",
  "executive",
  "admin",
]);

interface Props {
  riskId: string;
  currentUserId: string | null;
  currentUserRole: string | null;
  onChanged?: () => void;
}

interface SensitivityDraft {
  name: string;
  basis: string;
  lowInput: string;
  baseInput: string;
  highInput: string;
  lowOutput: string;
  baseOutput: string;
  highOutput: string;
}

const emptySensitivity = (): SensitivityDraft => ({
  name: "",
  basis: "",
  lowInput: "",
  baseInput: "",
  highInput: "",
  lowOutput: "",
  baseOutput: "",
  highOutput: "",
});

function number(value: string): number {
  return Number(value);
}

function formatMoney(value: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "validated"
      ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-300"
      : status === "stale" || status === "rejected"
        ? "border-red-500/25 bg-red-500/10 text-red-300"
        : "border-amber-500/25 bg-amber-500/10 text-amber-300";
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${tone}`}>
      {status.replaceAll("_", " ")}
    </span>
  );
}

export function RiskUncertaintyPanel({
  riskId,
  currentUserId,
  currentUserRole,
  onChanged,
}: Props) {
  const workspace = useAsyncData(
    () => getRiskUncertaintyWorkspace(riskId),
    [riskId],
  );
  const [method, setMethod] = useState("");
  const [basis, setBasis] = useState("");
  const [probability, setProbability] = useState(["", "", ""]);
  const [confidence, setConfidence] = useState(["", "", ""]);
  const [loss, setLoss] = useState(["", "", ""]);
  const [currency, setCurrency] = useState("");
  const [reviewDue, setReviewDue] = useState("");
  const [triggers, setTriggers] = useState("");
  const [sensitivity, setSensitivity] = useState<SensitivityDraft[]>([
    emptySensitivity(),
  ]);
  const [voiAction, setVoiAction] = useState("");
  const [voi, setVoi] = useState(["", "", ""]);
  const [selectedEvidence, setSelectedEvidence] = useState<string[]>([]);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [reviewDecision, setReviewDecision] = useState<
    "validated" | "rejected"
  >("validated");
  const [reviewNote, setReviewNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const canGovern = GOVERNANCE_ROLES.has(currentUserRole ?? "");
  const preview = useMemo(() => {
    if (voi.some((value) => value === "" || Number.isNaN(Number(value)))) return null;
    return evaluateValueOfInformation({
      informationCost: number(voi[0]),
      decisionCostIfWrong: number(voi[1]),
      uncertaintyReduction: number(voi[2]),
      probabilityDecisionChanges: number(probability[1]),
    });
  }, [voi, probability]);

  if (workspace.loading && !workspace.data) {
    return <LoadingState label="Loading governed uncertainty analysis…" />;
  }
  if (workspace.error || !workspace.data) {
    return (
      <ErrorState
        message={workspace.error ?? "Uncertainty analysis unavailable"}
        onRetry={workspace.refetch}
      />
    );
  }

  const data = workspace.data;
  const verified = data.evidence.filter(
    (item) => item.verificationStatus === "verified",
  );
  const latest = data.analyses[0];
  const adopted = data.criteria?.status === "adopted";

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      setMessage(success);
      workspace.refetch();
      onChanged?.();
      return true;
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Action failed");
      return false;
    } finally {
      setBusy(false);
    }
  }

  function updateRange(
    setter: React.Dispatch<React.SetStateAction<string[]>>,
    index: number,
    value: string,
  ) {
    setter((current) => current.map((item, i) => (i === index ? value : item)));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const sensitivityPayload: RiskUncertaintySensitivityInput[] = sensitivity.map(
      (item) => ({
        name: item.name,
        basis: item.basis,
        low_input: number(item.lowInput),
        base_input: number(item.baseInput),
        high_input: number(item.highInput),
        low_output: number(item.lowOutput),
        base_output: number(item.baseOutput),
        high_output: number(item.highOutput),
      }),
    );
    void run(
      () =>
        submitRiskUncertaintyAnalysis(
          riskId,
          {
            method,
            basis,
            probability_lower: number(probability[0]),
            probability_central: number(probability[1]),
            probability_upper: number(probability[2]),
            confidence_level: number(confidence[0]),
            confidence_interval_lower: number(confidence[1]),
            confidence_interval_upper: number(confidence[2]),
            best_case_loss: number(loss[0]),
            expected_case_loss: number(loss[1]),
            worst_case_loss: number(loss[2]),
            currency: currency || data.risk.currency,
            sensitivity: sensitivityPayload,
            reassessment_triggers: triggers
              .split("\n")
              .map((item) => item.trim())
              .filter(Boolean),
            review_due_at: new Date(reviewDue).toISOString(),
            voi_action: voiAction,
            voi_information_cost: number(voi[0]),
            voi_decision_cost_if_wrong: number(voi[1]),
            voi_uncertainty_reduction: number(voi[2]),
            voi_probability_decision_changes: number(probability[1]),
          },
          selectedEvidence,
        ),
      "Analysis submitted for independent review. No risk decision or operating authority changed.",
    );
  }

  function review(event: FormEvent) {
    event.preventDefault();
    if (!reviewing) return;
    void run(
      () =>
        reviewRiskUncertaintyAnalysis(
          reviewing,
          reviewDecision,
          reviewNote,
        ),
      "Independent packet review recorded without accepting risk or authorizing operation.",
    ).then((success) => {
      if (success) {
        setReviewing(null);
        setReviewNote("");
      }
    });
  }

  return (
    <section className="rounded-2xl border border-violet-500/20 bg-[#0D1520] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
            <BarChart3 className="h-4 w-4 text-violet-300" />
            Governed uncertainty analysis
          </h3>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-400">
            {data.boundary} This analysis does not accept risk or authorize operation.
          </p>
        </div>
        <span className="rounded-full border border-white/8 px-2 py-1 text-[10px] text-slate-400">
          Operational authorization: false
        </span>
      </div>

      {!adopted && (
        <div className="mt-4 flex gap-2 rounded-xl border border-amber-500/25 bg-amber-500/7 p-3 text-xs text-amber-100/80">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Adopt a criteria profile with decision thresholds before submitting an analysis.
        </div>
      )}

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <div className="rounded-xl border border-white/7 bg-white/2 p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Adopted threshold snapshot
          </p>
          <p className="mt-2 text-sm font-semibold text-slate-200">
            {data.criteria
              ? `${data.criteria.name} · v${data.criteria.version}`
              : "No criteria profile"}
          </p>
          <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap text-[10px] text-slate-500">
            {JSON.stringify(data.criteria?.decisionThresholds ?? {}, null, 2)}
          </pre>
        </div>
        <div className="rounded-xl border border-white/7 bg-white/2 p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Evidence eligibility
          </p>
          <p className="mt-2 text-2xl font-black text-white">{verified.length}</p>
          <p className="text-xs text-slate-500">
            verified · {data.evidence.length - verified.length} unverified and excluded
          </p>
        </div>
        <div className="rounded-xl border border-white/7 bg-white/2 p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Latest packet
          </p>
          {latest ? (
            <div className="mt-2 flex items-center gap-2">
              <span className="text-sm font-semibold text-slate-200">v{latest.version}</span>
              <StatusBadge status={latest.validationStatus} />
            </div>
          ) : (
            <p className="mt-2 text-xs text-slate-500">No analysis submitted.</p>
          )}
        </div>
      </div>

      {latest && (
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <div className="rounded-xl border border-white/7 p-4">
            <h4 className="text-xs font-semibold text-white">Probability and confidence</h4>
            <p className="mt-2 text-xs text-slate-300">
              Probability {latest.probability.lower}–{latest.probability.upper}; central {latest.probability.central}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {Math.round(latest.confidence.level * 100)}% confidence interval {latest.confidence.lower}–{latest.confidence.upper}
            </p>
          </div>
          <div className="rounded-xl border border-white/7 p-4">
            <h4 className="text-xs font-semibold text-white">Sensitivity ranking</h4>
            <ol className="mt-2 space-y-1 text-xs text-slate-400">
              {latest.sensitivityResults.map((item, index) => (
                <li key={`${item.name}-${index}`}>{index + 1}. {item.name} · swing {item.swing}</li>
              ))}
            </ol>
          </div>
          <div className="rounded-xl border border-white/7 p-4">
            <h4 className="text-xs font-semibold text-white">Value of information</h4>
            <p className="mt-2 text-xs text-slate-300">
              {latest.valueOfInformation.recommendation.replaceAll("_", " ")}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Net {formatMoney(latest.valueOfInformation.netValue, latest.lossCases.currency)}
            </p>
          </div>
        </div>
      )}

      {canGovern && !data.analyses.some((item) => item.validationStatus === "pending_review") && (
        <form onSubmit={submit} className="mt-5 space-y-4 border-t border-white/7 pt-5">
          <div>
            <h4 className="text-sm font-semibold text-white">Submit a new version</h4>
            <p className="mt-1 text-xs text-slate-500">All values must come from named evidence or stated assumptions; SyncAI supplies no engineering defaults.</p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <input className={INPUT} placeholder="Method" value={method} onChange={(e) => setMethod(e.target.value)} required />
            <input className={INPUT} placeholder={`Currency (${data.risk.currency})`} value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={3} />
            <textarea className={`${INPUT} min-h-20 md:col-span-2`} placeholder="Source, assumption and method basis" value={basis} onChange={(e) => setBasis(e.target.value)} required />
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            {[
              ["Probability", probability, setProbability, ["Lower", "Central", "Upper"]],
              ["Confidence", confidence, setConfidence, ["Level", "Interval lower", "Interval upper"]],
              ["Loss cases", loss, setLoss, ["Best", "Expected", "Worst"]],
            ].map(([label, values, setter, labels]) => (
              <fieldset key={label as string} className="rounded-xl border border-white/7 p-3">
                <legend className="px-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label as string}</legend>
                <div className="grid grid-cols-3 gap-2">
                  {(values as string[]).map((value, index) => (
                    <input key={(labels as string[])[index]} className={INPUT} type="number" step="any" min="0" placeholder={(labels as string[])[index]} value={value} onChange={(e) => updateRange(setter as React.Dispatch<React.SetStateAction<string[]>>, index, e.target.value)} required />
                  ))}
                </div>
              </fieldset>
            ))}
          </div>

          <div className="rounded-xl border border-white/7 p-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-white">Sensitivity factors</p>
              <button type="button" onClick={() => setSensitivity((items) => [...items, emptySensitivity()])} className="text-[10px] font-semibold text-violet-300">+ Add factor</button>
            </div>
            {sensitivity.map((item, index) => (
              <div key={index} className="mt-3 grid gap-2 md:grid-cols-2 lg:grid-cols-4">
                <input className={INPUT} placeholder="Factor name" value={item.name} onChange={(e) => setSensitivity((items) => items.map((entry, i) => i === index ? { ...entry, name: e.target.value } : entry))} required />
                <input className={`${INPUT} lg:col-span-3`} placeholder="Evidence or assumption basis" value={item.basis} onChange={(e) => setSensitivity((items) => items.map((entry, i) => i === index ? { ...entry, basis: e.target.value } : entry))} required />
                {(["lowInput", "baseInput", "highInput", "lowOutput", "baseOutput", "highOutput"] as const).map((key) => (
                  <input key={key} className={INPUT} type="number" step="any" min="0" placeholder={key.replace(/([A-Z])/g, " $1")} value={item[key]} onChange={(e) => setSensitivity((items) => items.map((entry, i) => i === index ? { ...entry, [key]: e.target.value } : entry))} required />
                ))}
              </div>
            ))}
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <textarea className={`${INPUT} min-h-24`} placeholder="One measurable reassessment trigger per line" value={triggers} onChange={(e) => setTriggers(e.target.value)} required />
            <input className={INPUT} type="datetime-local" aria-label="Review due" value={reviewDue} onChange={(e) => setReviewDue(e.target.value)} required />
            <input className={`${INPUT} md:col-span-2`} placeholder="Information-gathering action" value={voiAction} onChange={(e) => setVoiAction(e.target.value)} required />
            {[
              "Information cost",
              "Decision cost if wrong",
              "Uncertainty reduction (0–1)",
            ].map((label, index) => (
              <input key={label} className={INPUT} type="number" step="any" min="0" max={index === 2 ? 1 : undefined} placeholder={label} value={voi[index]} onChange={(e) => updateRange(setVoi, index, e.target.value)} required />
            ))}
            {preview && (
              <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 p-3 text-xs text-violet-100/80">
                Client preview: {preview.recommendation.replaceAll("_", " ")} · net {formatMoney(preview.netValue, currency || data.risk.currency)}. Server recomputes the authoritative value.
              </div>
            )}
          </div>

          <fieldset className="rounded-xl border border-white/7 p-3">
            <legend className="px-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Verified same-risk evidence</legend>
            <div className="grid gap-2 md:grid-cols-2">
              {verified.map((item) => (
                <label key={item.id} className="flex gap-2 rounded-lg border border-white/6 p-2 text-xs text-slate-300">
                  <input type="checkbox" checked={selectedEvidence.includes(item.id)} onChange={() => setSelectedEvidence((ids) => ids.includes(item.id) ? ids.filter((id) => id !== item.id) : [...ids, item.id])} />
                  <span>{item.description}<span className="block text-[10px] text-slate-500">{item.sourceSystem} · {item.evidenceClass ?? "unclassified"}</span></span>
                </label>
              ))}
              {verified.length === 0 && <p className="text-xs text-slate-500">No verified evidence is eligible.</p>}
            </div>
          </fieldset>
          <button disabled={busy || !adopted || selectedEvidence.length === 0} className="rounded-lg bg-violet-500 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40">{busy ? "Submitting…" : "Submit for independent review"}</button>
        </form>
      )}

      {canGovern && data.analyses.filter((item) => item.validationStatus === "pending_review").map((item) => (
        <div key={item.id} className="mt-5 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-amber-100/80">Version {item.version} awaits an independent named-human review.</p>
            {item.authorId !== currentUserId ? (
              <button type="button" onClick={() => setReviewing(item.id)} className="rounded-lg border border-amber-500/30 px-3 py-1.5 text-xs font-semibold text-amber-200">Review packet</button>
            ) : (
              <span className="text-[10px] text-slate-500">Author cannot review this packet.</span>
            )}
          </div>
        </div>
      ))}

      {reviewing && (
        <form onSubmit={review} className="mt-4 rounded-xl border border-teal-500/20 bg-teal-500/5 p-4">
          <h4 className="flex items-center gap-2 text-xs font-semibold text-white"><BadgeCheck className="h-4 w-4 text-teal-300" />Independent packet review</h4>
          <div className="mt-3 grid gap-3 md:grid-cols-[180px_1fr_auto]">
            <select className={INPUT} value={reviewDecision} onChange={(e) => setReviewDecision(e.target.value as "validated" | "rejected")}><option value="validated">Validate packet</option><option value="rejected">Reject packet</option></select>
            <textarea className={INPUT} placeholder="Independent review basis (minimum 20 characters)" value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} required />
            <button disabled={busy || reviewNote.trim().length < 20} className="rounded-lg bg-teal-500 px-4 py-2 text-xs font-semibold text-[#04100f] disabled:opacity-40">Record review</button>
          </div>
          <p className="mt-2 flex items-center gap-1 text-[10px] text-slate-500"><Scale className="h-3 w-3" />Review validates the frozen packet, not source truth, risk acceptance, work release or spend.</p>
        </form>
      )}

      {message && <p className="mt-4 rounded-lg border border-white/8 bg-white/3 p-3 text-xs text-slate-300">{message}</p>}
    </section>
  );
}
