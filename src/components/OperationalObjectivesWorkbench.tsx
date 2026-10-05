import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Gauge,
  Link2,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import {
  loadOperationalObjectiveWorkspace,
  proposeOperationalRamObjective,
  reviewOperationalRamObjective,
  type RamObjectiveDecision,
} from "../services/operationalObjectivesService";
import { ErrorState, LoadingState } from "./ui/AsyncStates";

type Notice = { kind: "ok" | "error"; text: string };

const pct = (value: number) => `${(Number(value) * 100).toFixed(2)}%`;

export function OperationalObjectivesWorkbench() {
  const { data, loading, error, refetch } = useAsyncData(
    loadOperationalObjectiveWorkspace,
    [],
    { isEmpty: () => false },
  );
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [requirementId, setRequirementId] = useState("");
  const [lifecyclePlanId, setLifecyclePlanId] = useState("");
  const [evidenceItemId, setEvidenceItemId] = useState("");
  const [systemLabel, setSystemLabel] = useState("");
  const [availabilityTarget, setAvailabilityTarget] = useState("");
  const [reliabilityTarget, setReliabilityTarget] = useState("");
  const [reliabilityUnit, setReliabilityUnit] = useState("");
  const [maintainabilityTarget, setMaintainabilityTarget] = useState("");
  const [maintainabilityUnit, setMaintainabilityUnit] = useState("");
  const [maintainabilityMeasure, setMaintainabilityMeasure] = useState("");
  const [configuration, setConfiguration] = useState<
    "series" | "parallel" | "mixed"
  >("series");
  const [basis, setBasis] = useState("");
  const [reviewTargetId, setReviewTargetId] = useState("");
  const [reviewNote, setReviewNote] = useState("");

  const eligibleRequirements = useMemo(
    () => data?.requirements.filter((item) => item.eligible) ?? [],
    [data],
  );
  const selectedRequirement = useMemo(
    () =>
      eligibleRequirements.find((item) => String(item.id) === requirementId) ??
      null,
    [eligibleRequirements, requirementId],
  );
  const matchingPlans = useMemo(
    () =>
      (data?.lifecyclePlans ?? []).filter(
        (plan) => plan.assetId === selectedRequirement?.assetId,
      ),
    [data, selectedRequirement],
  );
  const matchingEvidence = useMemo(
    () =>
      (data?.verifiedEvidence ?? []).filter(
        (item) => item.assetId === selectedRequirement?.assetId,
      ),
    [data, selectedRequirement],
  );
  const pending = useMemo(
    () => data?.translations.filter((item) => item.status === "proposed") ?? [],
    [data],
  );
  const verified = useMemo(
    () => data?.translations.filter((item) => item.status === "verified") ?? [],
    [data],
  );
  const selectedReview = useMemo(
    () => pending.find((item) => String(item.id) === reviewTargetId) ?? null,
    [pending, reviewTargetId],
  );

  useEffect(() => {
    if (
      !eligibleRequirements.some((item) => String(item.id) === requirementId)
    ) {
      setRequirementId(
        eligibleRequirements[0] ? String(eligibleRequirements[0].id) : "",
      );
    }
  }, [eligibleRequirements, requirementId]);

  useEffect(() => {
    if (!matchingPlans.some((item) => item.id === lifecyclePlanId)) {
      setLifecyclePlanId(matchingPlans[0]?.id ?? "");
    }
    if (!matchingEvidence.some((item) => item.id === evidenceItemId)) {
      setEvidenceItemId(matchingEvidence[0]?.id ?? "");
    }
  }, [evidenceItemId, lifecyclePlanId, matchingEvidence, matchingPlans]);

  useEffect(() => {
    if (!pending.some((item) => String(item.id) === reviewTargetId)) {
      setReviewTargetId(pending[0] ? String(pending[0].id) : "");
    }
  }, [pending, reviewTargetId]);

  async function act(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setNotice(null);
    try {
      await action();
      setNotice({ kind: "ok", text: success });
      await refetch();
    } catch (actionError) {
      setNotice({
        kind: "error",
        text:
          actionError instanceof Error
            ? actionError.message
            : "The governed RAM-objective action failed.",
      });
    } finally {
      setBusy(false);
    }
  }

  function propose() {
    if (!selectedRequirement) return;
    return act(
      () =>
        proposeOperationalRamObjective({
          requirementId: selectedRequirement.id,
          lifecyclePlanId,
          evidenceItemId,
          systemLabel,
          availabilityTarget: Number(availabilityTarget),
          reliabilityTarget: Number(reliabilityTarget),
          reliabilityUnit,
          maintainabilityTarget: Number(maintainabilityTarget),
          maintainabilityUnit,
          maintainabilityMeasure,
          configuration,
          basis,
        }),
      "Conversion proposed. The exact requirement, objective, RAM values, KPI, evidence and lifecycle-plan version are frozen for independent review.",
    );
  }

  function review(decision: RamObjectiveDecision) {
    if (!selectedReview) return;
    return act(
      () =>
        reviewOperationalRamObjective({
          ramTargetId: selectedReview.id,
          decision,
          reviewNote,
        }),
      `RAM-objective conversion ${decision}. The decision records definition and measurement only; it grants no operating authority.`,
    );
  }

  if (loading && !data)
    return <LoadingState label="Loading operational RAM objectives" />;
  if (error && !data) return <ErrorState message={error} onRetry={refetch} />;

  const canPropose = Boolean(
    selectedRequirement &&
    lifecyclePlanId &&
    evidenceItemId &&
    systemLabel.trim().length >= 2 &&
    Number(availabilityTarget) > 0 &&
    Number(availabilityTarget) < 1 &&
    Number(reliabilityTarget) > 0 &&
    reliabilityUnit.trim().length >= 2 &&
    Number(maintainabilityTarget) > 0 &&
    maintainabilityUnit.trim() &&
    maintainabilityMeasure.trim().length >= 5 &&
    basis.trim().length >= 20,
  );

  return (
    <section className="overflow-hidden rounded-2xl border border-violet-400/20 bg-[#0a111c]">
      <div className="border-b border-white/8 bg-[radial-gradient(circle_at_top_right,rgba(139,92,246,0.15),transparent_46%)] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-violet-300">
              <Link2 className="h-4 w-4" aria-hidden /> C8.02 governed
              conversion
            </div>
            <h2 className="text-xl font-semibold text-white">
              Operational requirement → RAM → lifecycle
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              Turn an owned operational requirement into explicit reliability,
              availability and maintainability targets. The server freezes the
              adopted objective, one operating KPI, verified evidence and the
              latest independently adopted lifecycle-plan version—without
              inventing engineering values.
            </p>
          </div>
          <button
            type="button"
            onClick={refetch}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300 hover:border-violet-300/40 hover:text-white disabled:opacity-50"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Refresh
          </button>
        </div>
      </div>

      <div className="space-y-5 p-5">
        {notice && (
          <div
            className={`rounded-lg border px-4 py-3 text-sm ${notice.kind === "ok" ? "border-teal-400/25 bg-teal-400/8 text-teal-200" : "border-rose-400/25 bg-rose-400/8 text-rose-200"}`}
          >
            {notice.text}
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="space-y-4 rounded-xl border border-white/8 bg-white/[0.025] p-4">
            <div className="flex items-center gap-2">
              <Gauge className="h-4 w-4 text-violet-300" aria-hidden />
              <h3 className="font-semibold text-white">
                Propose measurable conversion
              </h3>
            </div>

            {eligibleRequirements.length === 0 ? (
              <div className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-3 text-sm text-amber-100">
                No requirement is ready. A candidate must already name its
                case/project, installed asset, accountable owner, adopted
                objective, one catalogued operating KPI, verification method and
                measurable acceptance criteria.
              </div>
            ) : (
              <>
                <SelectField
                  label="Operational requirement"
                  value={requirementId}
                  onChange={setRequirementId}
                  options={eligibleRequirements.map((item) => ({
                    value: String(item.id),
                    label: `${item.reference} · ${item.assetName ?? "Unlinked asset"}`,
                  }))}
                />

                {selectedRequirement && (
                  <div className="grid gap-3 rounded-lg border border-violet-300/15 bg-violet-400/[0.04] p-3 text-xs sm:grid-cols-2">
                    <Fact
                      label="Requirement"
                      value={`${selectedRequirement.reference} · ${selectedRequirement.requirement}`}
                    />
                    <Fact
                      label="Acceptance"
                      value={
                        selectedRequirement.acceptanceCriteria ?? "Missing"
                      }
                    />
                    <Fact
                      label="Adopted objective"
                      value={`${selectedRequirement.objectiveTarget ?? "Missing target"} · ${selectedRequirement.objectiveMeasurement ?? "Missing measurement"}`}
                    />
                    <Fact
                      label="Operating KPI"
                      value={`${selectedRequirement.operatingKpiName ?? "Missing"} (${selectedRequirement.operatingKpiKey ?? "—"})`}
                    />
                  </div>
                )}

                <div className="grid gap-3 sm:grid-cols-2">
                  <SelectField
                    label="Latest adopted lifecycle plan"
                    value={lifecyclePlanId}
                    onChange={setLifecyclePlanId}
                    options={matchingPlans.map((plan) => ({
                      value: plan.id,
                      label: `v${plan.version} · ${plan.horizonYears} years · ${plan.objective}`,
                    }))}
                  />
                  <SelectField
                    label="Verified evidence"
                    value={evidenceItemId}
                    onChange={setEvidenceItemId}
                    options={matchingEvidence.map((item) => ({
                      value: item.id,
                      label: `${item.evidenceClass ?? "Verified"} · ${item.description}`,
                    }))}
                  />
                  <TextField
                    label="System or service boundary"
                    value={systemLabel}
                    onChange={setSystemLabel}
                    placeholder="e.g. Cooling-water train A"
                  />
                  <SelectField
                    label="Configuration"
                    value={configuration}
                    onChange={(value) =>
                      setConfiguration(value as "series" | "parallel" | "mixed")
                    }
                    options={[
                      { value: "series", label: "Series" },
                      { value: "parallel", label: "Parallel" },
                      { value: "mixed", label: "Mixed" },
                    ]}
                  />
                  <NumberField
                    label="Availability target (fraction)"
                    value={availabilityTarget}
                    onChange={setAvailabilityTarget}
                    placeholder="0.995"
                    step="0.0001"
                  />
                  <div className="hidden sm:block" />
                  <NumberField
                    label="Reliability target"
                    value={reliabilityTarget}
                    onChange={setReliabilityTarget}
                    placeholder="No value inferred"
                  />
                  <TextField
                    label="Reliability unit"
                    value={reliabilityUnit}
                    onChange={setReliabilityUnit}
                    placeholder="e.g. operating hours between failures"
                  />
                  <NumberField
                    label="Maintainability target"
                    value={maintainabilityTarget}
                    onChange={setMaintainabilityTarget}
                    placeholder="No value inferred"
                  />
                  <TextField
                    label="Maintainability unit"
                    value={maintainabilityUnit}
                    onChange={setMaintainabilityUnit}
                    placeholder="e.g. hours"
                  />
                  <div className="sm:col-span-2">
                    <TextField
                      label="Maintainability measure"
                      value={maintainabilityMeasure}
                      onChange={setMaintainabilityMeasure}
                      placeholder="e.g. mean time to restore service"
                    />
                  </div>
                </div>

                <TextAreaField
                  label="Evidence-backed conversion basis"
                  value={basis}
                  onChange={setBasis}
                  placeholder="State how the requirement, evidence and lifecycle objective support these exact targets."
                />
                <button
                  type="button"
                  onClick={propose}
                  disabled={!canPropose || busy}
                  className="inline-flex items-center gap-2 rounded-lg bg-violet-400 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-violet-300 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ArrowRight className="h-4 w-4" aria-hidden /> Propose
                  conversion
                </button>
              </>
            )}
          </div>

          <div className="space-y-4 rounded-xl border border-white/8 bg-white/[0.025] p-4">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-teal-300" aria-hidden />
              <h3 className="font-semibold text-white">
                Pending independent review
              </h3>
            </div>
            {pending.length === 0 ? (
              <p className="text-sm text-slate-400">
                No proposed conversion is awaiting review.
              </p>
            ) : (
              <>
                <SelectField
                  label="Proposed conversion"
                  value={reviewTargetId}
                  onChange={setReviewTargetId}
                  options={pending.map((item) => ({
                    value: String(item.id),
                    label: `${item.requirementRef} · revision ${item.revision}`,
                  }))}
                />
                {selectedReview && (
                  <div className="space-y-2 rounded-lg border border-white/8 bg-black/15 p-3 text-xs text-slate-300">
                    <p className="font-medium text-white">
                      {selectedReview.systemLabel}
                    </p>
                    <p>
                      A {pct(selectedReview.availabilityTarget)} · R{" "}
                      {selectedReview.reliabilityTarget}{" "}
                      {selectedReview.reliabilityUnit}
                    </p>
                    <p>
                      M {selectedReview.maintainabilityTarget}{" "}
                      {selectedReview.maintainabilityUnit} ·{" "}
                      {selectedReview.maintainabilityMeasure}
                    </p>
                    <p className="text-slate-400">
                      Lifecycle: {selectedReview.lifecycleObjective}
                    </p>
                  </div>
                )}
                <TextAreaField
                  label="Independent review note"
                  value={reviewNote}
                  onChange={setReviewNote}
                  placeholder="Confirm or reject the exact requirement, evidence, values, KPI and lifecycle version."
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => review("verified")}
                    disabled={busy || reviewNote.trim().length < 20}
                    className="rounded-lg bg-teal-400 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-40"
                  >
                    Verify
                  </button>
                  <button
                    type="button"
                    onClick={() => review("rejected")}
                    disabled={busy || reviewNote.trim().length < 20}
                    className="rounded-lg border border-rose-400/30 px-4 py-2 text-sm font-semibold text-rose-200 disabled:opacity-40"
                  >
                    Reject
                  </button>
                </div>
              </>
            )}

            <div className="rounded-lg border border-teal-300/15 bg-teal-400/[0.04] p-3 text-xs leading-5 text-teal-100">
              <strong>Authority boundary:</strong> verification records that the
              requirement has a measurable, traceable objective. It does not
              approve work, accept risk, commit spend, change an operating limit
              or authorize return to service.
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-white/8 bg-white/[0.02] p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="flex items-center gap-2 font-semibold text-white">
              <CheckCircle2 className="h-4 w-4 text-teal-300" aria-hidden />
              Verified current conversions
            </h3>
            <span className="text-xs text-slate-500">
              {verified.length} verified
            </span>
          </div>
          {verified.length === 0 ? (
            <p className="text-sm text-slate-400">
              Nothing is represented as verified until an independent named
              human completes review.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[56rem] text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="py-2 pr-4 font-medium">Requirement</th>
                    <th className="py-2 pr-4 font-medium">Asset / system</th>
                    <th className="py-2 pr-4 font-medium">RAM</th>
                    <th className="py-2 pr-4 font-medium">KPI</th>
                    <th className="py-2 font-medium">Lifecycle</th>
                  </tr>
                </thead>
                <tbody>
                  {verified.map((item) => (
                    <tr key={item.id} className="border-t border-white/6">
                      <td className="py-3 pr-4 text-white">
                        {item.requirementRef} · v{item.revision}
                      </td>
                      <td className="py-3 pr-4 text-slate-300">
                        {item.assetName} · {item.systemLabel}
                      </td>
                      <td className="py-3 pr-4 text-slate-300">
                        A {pct(item.availabilityTarget)} · R{" "}
                        {item.reliabilityTarget} {item.reliabilityUnit} · M{" "}
                        {item.maintainabilityTarget} {item.maintainabilityUnit}
                      </td>
                      <td className="py-3 pr-4 text-slate-300">
                        {item.operatingKpiKey}
                      </td>
                      <td className="py-3 text-slate-300">
                        {item.lifecycleHorizonYears} years ·{" "}
                        {item.lifecycleObjective}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {(data?.requirements ?? []).some((item) => !item.eligible) && (
          <div className="rounded-xl border border-amber-400/15 bg-amber-400/[0.035] p-4">
            <h3 className="text-sm font-semibold text-amber-100">
              Requirements not yet convertible
            </h3>
            <div className="mt-2 space-y-1 text-xs text-amber-100/75">
              {(data?.requirements ?? [])
                .filter((item) => !item.eligible)
                .map((item) => (
                  <p key={item.id}>
                    {item.reference}: {item.gaps.join(", ").replace(/_/g, " ")}
                  </p>
                ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-violet-200/70">
        {label}
      </div>
      <div className="mt-1 leading-5 text-slate-300">{value}</div>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block text-xs text-slate-400">
      <span className="mb-1 block">{label}</span>
      <input
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-violet-300/50"
      />
    </label>
  );
}

function NumberField({
  label,
  value,
  onChange,
  placeholder,
  step = "any",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  step?: string;
}) {
  return (
    <label className="block text-xs text-slate-400">
      <span className="mb-1 block">{label}</span>
      <input
        type="number"
        aria-label={label}
        min="0"
        step={step}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-violet-300/50"
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="block text-xs text-slate-400">
      <span className="mb-1 block">{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={options.length === 0}
        className="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-violet-300/50 disabled:opacity-50"
      >
        {options.length === 0 && <option value="">No eligible record</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function TextAreaField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block text-xs text-slate-400">
      <span className="mb-1 block">{label}</span>
      <textarea
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={3}
        className="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-violet-300/50"
      />
    </label>
  );
}
