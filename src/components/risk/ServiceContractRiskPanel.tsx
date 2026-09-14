import { useState, type FormEvent } from "react";
import { BadgeCheck, FileWarning, Scale } from "lucide-react";
import { useAsyncData } from "../../hooks/useAsyncData";
import {
  adoptServiceContractObligation,
  getServiceContractReferences,
  getServiceContractRiskWorkspace,
  recordRecommendationContractRisk,
  recordServiceContractObligation,
  verifyRecommendationContractRisk,
  type ServiceCommitmentType,
} from "../../services/serviceContractRiskService";
import { useAuth } from "../AuthProvider";
import { ErrorState, LoadingState } from "../ui/AsyncStates";

const LABELS: Record<ServiceCommitmentType, string> = {
  availability_guarantee: "Availability guarantee",
  response_time_guarantee: "Response-time guarantee",
  reliability_guarantee: "Reliability guarantee",
  punctuality_target: "Punctuality target",
  service_standard: "Service standard",
  maintenance_contract: "Maintenance contract",
  performance_based_logistics: "Performance-based logistics",
  warranty: "Warranty",
  concession_requirement: "Concession requirement",
};
const QUANTIFIED = new Set<ServiceCommitmentType>([
  "availability_guarantee",
  "response_time_guarantee",
  "reliability_guarantee",
  "punctuality_target",
]);
const REVIEW_ROLES = new Set(["maintenance_manager", "executive", "admin"]);

export function ServiceContractRiskPanel() {
  const { profile } = useAuth();
  const workspace = useAsyncData(getServiceContractRiskWorkspace, []);
  const refs = useAsyncData(getServiceContractReferences, []);
  const [kind, setKind] = useState<ServiceCommitmentType>(
    "availability_guarantee",
  );
  const [sourceType, setSourceType] = useState<"contract" | "oem_requirement">(
    "contract",
  );
  const [sourceReference, setSourceReference] = useState("");
  const [requirement, setRequirement] = useState("");
  const [scope, setScope] = useState("");
  const [responsibleRole, setResponsibleRole] = useState("");
  const [basis, setBasis] = useState("");
  const [assetId, setAssetId] = useState("");
  const [serviceLevelAssetId, setServiceLevelAssetId] = useState("");
  const [contractId, setContractId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [warrantyId, setWarrantyId] = useState("");
  const [metric, setMetric] = useState("");
  const [target, setTarget] = useState("");
  const [unit, setUnit] = useState("");
  const [window, setWindow] = useState("");
  const [remedy, setRemedy] = useState("");
  const [penalty, setPenalty] = useState("");
  const [incentive, setIncentive] = useState("");
  const [currency, setCurrency] = useState("");
  const [evidenceId, setEvidenceId] = useState("");
  const [recommendationId, setRecommendationId] = useState("");
  const [obligationId, setObligationId] = useState("");
  const [breachState, setBreachState] = useState<
    "compliant" | "at_risk" | "breached" | "unknown"
  >("unknown");
  const [riskRating, setRiskRating] = useState<
    "low" | "medium" | "high" | "critical" | "unknown"
  >("unknown");
  const [exposureBasis, setExposureBasis] = useState("");
  const [missingEvidence, setMissingEvidence] = useState("");
  const [review, setReview] = useState<{
    kind: "obligation" | "assessment";
    id: string;
  } | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if ((workspace.loading && !workspace.data) || (refs.loading && !refs.data)) {
    return <LoadingState label="Loading contractual service risk" />;
  }
  if (workspace.error || refs.error) {
    return (
      <ErrorState
        message={
          workspace.error ?? refs.error ?? "Contractual risk unavailable"
        }
        onRetry={() => {
          workspace.refetch();
          refs.refetch();
        }}
      />
    );
  }
  const obligations = workspace.data?.obligations ?? [];
  const assessments = workspace.data?.assessments ?? [];
  const canAdopt = REVIEW_ROLES.has(profile?.role ?? "");

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      setMessage(success);
      workspace.refetch();
      return true;
    } catch (error) {
      setMessage((error as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  function submitObligation(event: FormEvent) {
    event.preventDefault();
    void run(
      () =>
        recordServiceContractObligation({
          service_commitment_type: kind,
          source_type: sourceType,
          source_reference: sourceReference,
          requirement,
          applicable_scope: scope,
          responsible_role: responsibleRole,
          measurement_basis: basis,
          asset_id: assetId || null,
          service_level_asset_id: serviceLevelAssetId || null,
          contract_package_id: contractId || null,
          supplier_id: supplierId || null,
          warranty_term_id: warrantyId || null,
          metric_name: metric || null,
          target_value: target || null,
          target_unit: unit || null,
          measurement_window: window || null,
          remedy: remedy || null,
          penalty_value: penalty || null,
          incentive_value: incentive || null,
          commercial_currency: currency || null,
          evidence_item_ids: evidenceId ? [evidenceId] : [],
        }),
      "Draft obligation recorded for independent human adoption.",
    );
  }
  function submitAssessment(event: FormEvent) {
    event.preventDefault();
    void run(
      () =>
        recordRecommendationContractRisk({
          recommendation_id: recommendationId,
          obligation_id: obligationId,
          breach_state: breachState,
          risk_rating: riskRating,
          exposure_basis: exposureBasis,
          evidence_item_ids: evidenceId ? [evidenceId] : [],
          missing_evidence: missingEvidence
            ? missingEvidence
                .split("\n")
                .map((x) => x.trim())
                .filter(Boolean)
            : [],
        }),
      "Draft contractual exposure recorded without changing recommendation authority.",
    );
  }
  function submitReview(event: FormEvent) {
    event.preventDefault();
    if (!review) return;
    const action =
      review.kind === "obligation"
        ? () => adoptServiceContractObligation(review.id, reviewNote)
        : () => verifyRecommendationContractRisk(review.id, reviewNote);
    void run(
      action,
      "Independent review recorded; approval and work authority remain unchanged.",
    ).then((succeeded) => {
      if (succeeded) {
        setReview(null);
        setReviewNote("");
      }
    });
  }

  return (
    <section
      data-testid="service-contract-risk-workspace"
      className="space-y-5"
    >
      <div className="rounded-2xl border border-teal-500/20 bg-teal-500/5 p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
          <Scale className="h-4 w-4 text-teal-300" />
          Service &amp; contractual risk
        </h2>
        <p className="mt-1 max-w-4xl text-xs leading-relaxed text-slate-400">
          {workspace.data?.basis}
        </p>
      </div>
      {message && (
        <p className="rounded-lg border border-teal-500/20 bg-teal-500/5 p-3 text-xs text-slate-200">
          {message}
        </p>
      )}
      <div className="grid gap-5 xl:grid-cols-2">
        <div className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-300">
            Governed obligations
          </h3>
          {obligations.length === 0 && (
            <p className="rounded-xl border border-white/7 bg-[#0D1520] p-4 text-xs text-slate-400">
              No service obligation is recorded. SyncAI will not infer a
              guarantee, remedy, penalty or incentive from supplier identity.
            </p>
          )}
          {obligations.map((item) => (
            <article
              key={item.id}
              className="rounded-xl border border-white/7 bg-[#0D1520] p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-white">
                    {LABELS[item.service_commitment_type]}
                  </p>
                  <p className="text-xs text-slate-500">
                    {item.source_reference} · {item.status}
                  </p>
                </div>
                {item.target_value != null && (
                  <span className="rounded-full border border-teal-500/25 px-2 py-1 text-xs text-teal-300">
                    {item.target_value} {item.target_unit}
                  </span>
                )}
              </div>
              <p className="mt-2 text-xs text-slate-300">{item.requirement}</p>
              <p className="mt-1 text-xs text-slate-500">
                Basis: {item.measurement_basis}
              </p>
              {canAdopt && item.status === "draft" && (
                <button
                  type="button"
                  className="mt-2 text-xs font-semibold text-teal-300"
                  onClick={() => setReview({ kind: "obligation", id: item.id })}
                >
                  Independently adopt
                </button>
              )}
            </article>
          ))}
        </div>
        <div className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-300">
            Recommendation exposure
          </h3>
          {assessments.length === 0 && (
            <p className="rounded-xl border border-white/7 bg-[#0D1520] p-4 text-xs text-slate-400">
              No recommendation has verified contractual exposure. Unknown
              remains unknown until evidence or an explicit evidence gap is
              recorded.
            </p>
          )}
          {assessments.map((item) => (
            <article
              key={item.id}
              className="rounded-xl border border-white/7 bg-[#0D1520] p-4"
            >
              <div className="flex justify-between gap-2">
                <p className="text-sm font-semibold text-white">
                  {item.recommendation_title}
                </p>
                <span className="text-xs text-amber-300">
                  {item.breach_state} · {item.risk_rating}
                </span>
              </div>
              <p className="mt-2 text-xs text-slate-300">
                {item.exposure_basis}
              </p>
              {item.missing_evidence.length > 0 && (
                <p className="mt-1 text-xs text-amber-200">
                  Missing: {item.missing_evidence.join("; ")}
                </p>
              )}
              {item.status === "draft" && (
                <button
                  type="button"
                  className="mt-2 text-xs font-semibold text-teal-300"
                  onClick={() => setReview({ kind: "assessment", id: item.id })}
                >
                  Independently verify
                </button>
              )}
            </article>
          ))}
        </div>
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <form
          onSubmit={submitObligation}
          className="space-y-3 rounded-2xl border border-white/7 bg-[#0D1520] p-5"
        >
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
            <BadgeCheck className="h-4 w-4 text-teal-300" />
            Record obligation
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as ServiceCommitmentType)}
              className="rounded-lg border border-white/10 bg-[#101B27] p-2 text-xs text-white"
            >
              {Object.entries(LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <select
              value={sourceType}
              onChange={(e) =>
                setSourceType(e.target.value as "contract" | "oem_requirement")
              }
              className="rounded-lg border border-white/10 bg-[#101B27] p-2 text-xs text-white"
            >
              <option value="contract">Contract</option>
              <option value="oem_requirement">OEM requirement</option>
            </select>
            <input
              required
              value={sourceReference}
              onChange={(e) => setSourceReference(e.target.value)}
              placeholder="Source reference"
              className="rounded-lg border border-white/10 bg-[#101B27] p-2 text-xs text-white"
            />
            <input
              required
              value={responsibleRole}
              onChange={(e) => setResponsibleRole(e.target.value)}
              placeholder="Responsible role"
              className="rounded-lg border border-white/10 bg-[#101B27] p-2 text-xs text-white"
            />
            <select
              value={assetId}
              onChange={(e) => setAssetId(e.target.value)}
              className="rounded-lg border border-white/10 bg-[#101B27] p-2 text-xs text-white"
            >
              <option value="">No asset link</option>
              {refs.data?.assets.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
            <select
              value={contractId}
              onChange={(e) => setContractId(e.target.value)}
              className="rounded-lg border border-white/10 bg-[#101B27] p-2 text-xs text-white"
            >
              <option value="">No contract package</option>
              {refs.data?.contracts.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.package_code} — {x.title}
                </option>
              ))}
            </select>
            <select
              value={serviceLevelAssetId}
              onChange={(e) => setServiceLevelAssetId(e.target.value)}
              className="rounded-lg border border-white/10 bg-[#101B27] p-2 text-xs text-white"
            >
              <option value="">No service-level link</option>
              {refs.data?.serviceLevels.map((x) => (
                <option key={x.asset_id} value={x.asset_id}>
                  {x.service_name}
                </option>
              ))}
            </select>
            <select
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              className="rounded-lg border border-white/10 bg-[#101B27] p-2 text-xs text-white"
            >
              <option value="">No supplier link</option>
              {refs.data?.suppliers.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
            <select
              value={warrantyId}
              onChange={(e) => setWarrantyId(e.target.value)}
              className="rounded-lg border border-white/10 bg-[#101B27] p-2 text-xs text-white"
            >
              <option value="">No warranty link</option>
              {refs.data?.warranties.map((x) => (
                <option key={x.id} value={x.id}>
                  Warranty {x.id} · {x.ends_on ?? "no end date"}
                </option>
              ))}
            </select>
          </div>
          <textarea
            required
            minLength={20}
            value={requirement}
            onChange={(e) => setRequirement(e.target.value)}
            placeholder="Requirement stated by the source"
            className="min-h-20 w-full rounded-lg border border-white/10 bg-[#101B27] p-2 text-xs text-white"
          />
          <input
            required
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            placeholder="Applicable scope"
            className="w-full rounded-lg border border-white/10 bg-[#101B27] p-2 text-xs text-white"
          />
          <textarea
            required
            minLength={20}
            value={basis}
            onChange={(e) => setBasis(e.target.value)}
            placeholder="Measurement basis, source and limitations"
            className="min-h-20 w-full rounded-lg border border-white/10 bg-[#101B27] p-2 text-xs text-white"
          />
          <div className="grid gap-3 sm:grid-cols-3">
            <input
              value={metric}
              onChange={(e) => setMetric(e.target.value)}
              placeholder="Metric"
              className="rounded-lg border border-white/10 bg-[#101B27] p-2 text-xs text-white"
            />
            <input
              required={QUANTIFIED.has(kind)}
              type="number"
              step="any"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="Target"
              className="rounded-lg border border-white/10 bg-[#101B27] p-2 text-xs text-white"
            />
            <input
              required={QUANTIFIED.has(kind)}
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder="Unit"
              className="rounded-lg border border-white/10 bg-[#101B27] p-2 text-xs text-white"
            />
          </div>
          <input
            value={window}
            onChange={(e) => setWindow(e.target.value)}
            placeholder="Measurement window"
            className="w-full rounded-lg border border-white/10 bg-[#101B27] p-2 text-xs text-white"
          />
          <textarea
            value={remedy}
            onChange={(e) => setRemedy(e.target.value)}
            placeholder="Remedy or service-credit mechanism"
            className="w-full rounded-lg border border-white/10 bg-[#101B27] p-2 text-xs text-white"
          />
          <div className="grid gap-3 sm:grid-cols-3">
            <input
              type="number"
              min="0"
              step="any"
              value={penalty}
              onChange={(e) => setPenalty(e.target.value)}
              placeholder="Penalty"
              className="rounded-lg border border-white/10 bg-[#101B27] p-2 text-xs text-white"
            />
            <input
              type="number"
              min="0"
              step="any"
              value={incentive}
              onChange={(e) => setIncentive(e.target.value)}
              placeholder="Incentive"
              className="rounded-lg border border-white/10 bg-[#101B27] p-2 text-xs text-white"
            />
            <input
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              maxLength={3}
              placeholder="CAD"
              className="rounded-lg border border-white/10 bg-[#101B27] p-2 text-xs text-white"
            />
          </div>
          <select
            value={evidenceId}
            onChange={(e) => setEvidenceId(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-[#101B27] p-2 text-xs text-white"
          >
            <option value="">Verified evidence required before adoption</option>
            {refs.data?.evidence.map((x) => (
              <option key={x.id} value={x.id}>
                {x.description}
              </option>
            ))}
          </select>
          <button
            disabled={busy}
            className="rounded-lg bg-teal-500 px-3 py-2 text-xs font-bold text-[#04100f] disabled:opacity-40"
          >
            Record draft obligation
          </button>
        </form>
        <form
          onSubmit={submitAssessment}
          className="space-y-3 rounded-2xl border border-white/7 bg-[#0D1520] p-5"
        >
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
            <FileWarning className="h-4 w-4 text-amber-300" />
            Put obligation in recommendation risk
          </h3>
          <select
            required
            value={recommendationId}
            onChange={(e) => setRecommendationId(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-[#101B27] p-2 text-xs text-white"
          >
            <option value="">Recommendation…</option>
            {refs.data?.recommendations.map((x) => (
              <option key={x.id} value={x.id}>
                {x.title} · {x.status}
              </option>
            ))}
          </select>
          <select
            required
            value={obligationId}
            onChange={(e) => setObligationId(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-[#101B27] p-2 text-xs text-white"
          >
            <option value="">Adopted obligation…</option>
            {obligations
              .filter((x) => x.status === "adopted")
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {x.source_reference} — {LABELS[x.service_commitment_type]}
                </option>
              ))}
          </select>
          <div className="grid grid-cols-2 gap-3">
            <select
              value={breachState}
              onChange={(e) =>
                setBreachState(e.target.value as typeof breachState)
              }
              className="rounded-lg border border-white/10 bg-[#101B27] p-2 text-xs text-white"
            >
              {["unknown", "compliant", "at_risk", "breached"].map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
            <select
              value={riskRating}
              onChange={(e) =>
                setRiskRating(e.target.value as typeof riskRating)
              }
              className="rounded-lg border border-white/10 bg-[#101B27] p-2 text-xs text-white"
            >
              {["unknown", "low", "medium", "high", "critical"].map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
          </div>
          <textarea
            required
            minLength={20}
            value={exposureBasis}
            onChange={(e) => setExposureBasis(e.target.value)}
            placeholder="Evidence-backed exposure basis and limitations"
            className="min-h-24 w-full rounded-lg border border-white/10 bg-[#101B27] p-2 text-xs text-white"
          />
          <textarea
            value={missingEvidence}
            onChange={(e) => setMissingEvidence(e.target.value)}
            placeholder="Missing evidence — one item per line"
            className="min-h-20 w-full rounded-lg border border-white/10 bg-[#101B27] p-2 text-xs text-white"
          />
          <p className="text-xs text-slate-500">
            The verified-evidence selector is shared with the obligation form.
            Select evidence there, or explicitly name what is missing.
          </p>
          <button
            disabled={busy}
            className="rounded-lg bg-amber-400 px-3 py-2 text-xs font-bold text-[#161006] disabled:opacity-40"
          >
            Record draft exposure
          </button>
        </form>
      </div>
      {review && (
        <form
          onSubmit={submitReview}
          className="rounded-2xl border border-teal-500/20 bg-[#0D1520] p-5"
        >
          <h3 className="text-sm font-semibold text-white">
            Independent human review
          </h3>
          <p className="mt-1 text-xs text-slate-400">
            You cannot verify your own record. This review confirms evidence and
            interpretation only; it grants no recommendation approval, risk
            acceptance or work authority.
          </p>
          <textarea
            required
            minLength={20}
            value={reviewNote}
            onChange={(e) => setReviewNote(e.target.value)}
            className="mt-3 min-h-20 w-full rounded-lg border border-white/10 bg-[#101B27] p-2 text-xs text-white"
            placeholder="Verification method and conclusion"
          />
          <div className="mt-3 flex gap-2">
            <button
              disabled={busy}
              className="rounded-lg bg-teal-500 px-3 py-2 text-xs font-bold text-[#04100f]"
            >
              Record independent review
            </button>
            <button
              type="button"
              onClick={() => setReview(null)}
              className="rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
