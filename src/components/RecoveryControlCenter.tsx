import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BrainCircuit,
  Cable,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import {
  donorCandidatesFromPayload,
  economicAssumptionsReady,
  getRecoveryControlSnapshot,
  recoveryActions,
  type RecoveryCapabilityPayload,
  type RecoveryControlSnapshot,
  type RecoveryEventDetail,
} from "../services/syncRecoveryService";

export type RecoveryAdvancedView = "control" | "optimize" | "learn";

type Props = {
  view: RecoveryAdvancedView;
  detail: RecoveryEventDetail;
  disabled: boolean;
  role: string;
  onChanged: () => Promise<void>;
};

const inputClass =
  "w-full rounded-lg border border-industrial-border bg-industrial-slate px-3 py-2 text-sm text-industrial-text outline-none focus:border-teal-500";
const cardClass =
  "rounded-xl border border-industrial-border bg-industrial-graphite p-5";

function JsonEvidence({
  title,
  value,
  empty,
}: {
  title: string;
  value: RecoveryCapabilityPayload | null | undefined;
  empty: string;
}) {
  return (
    <section className={cardClass}>
      <h3 className="font-semibold text-industrial-text">{title}</h3>
      {value ? (
        <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-industrial-slate p-3 text-xs leading-5 text-slate-300">
          {JSON.stringify(value, null, 2)}
        </pre>
      ) : (
        <p className="mt-3 text-sm text-slate-400">{empty}</p>
      )}
    </section>
  );
}

export function RecoveryControlCenter({
  view,
  detail,
  disabled,
  role,
  onChanged,
}: Props) {
  const [snapshot, setSnapshot] = useState<RecoveryControlSnapshot | null>(
    null,
  );
  const [result, setResult] = useState<RecoveryCapabilityPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [resourceKind, setResourceKind] = useState("weather");
  const [resourceKey, setResourceKey] = useState("");
  const [resourceBasis, setResourceBasis] = useState("");
  const [signalState, setSignalState] = useState<
    "available" | "unavailable" | "unknown"
  >("unknown");
  const [signalSource, setSignalSource] = useState("");
  const [signalBasis, setSignalBasis] = useState("");
  const [signalValidUntil, setSignalValidUntil] = useState("");
  const [selectedWorkId, setSelectedWorkId] = useState(
    detail.scope[0]?.event_work_id ?? "",
  );
  const [workZone, setWorkZone] = useState("");
  const [componentScope, setComponentScope] = useState("");
  const [fieldBasis, setFieldBasis] = useState("");
  const [energyType, setEnergyType] = useState("electrical");
  const [energyState, setEnergyState] = useState("unknown");
  const [energyValidUntil, setEnergyValidUntil] = useState("");
  const [whatIfChanges, setWhatIfChanges] = useState("{}");
  const [whatIfBasis, setWhatIfBasis] = useState("");
  const [uncertaintyGroup, setUncertaintyGroup] = useState("");
  const [uncertaintyWeight, setUncertaintyWeight] = useState("0");
  const [consequenceBasis, setConsequenceBasis] = useState("");
  const [consequenceScores, setConsequenceScores] = useState({
    safety: "0",
    environment: "0",
    business: "0",
    production: "0",
  });
  const [feedbackDisposition, setFeedbackDisposition] = useState("accepted");
  const [feedbackReason, setFeedbackReason] = useState("");
  const [delayHours, setDelayHours] = useState("");
  const [delayBasis, setDelayBasis] = useState("");
  const [zoneA, setZoneA] = useState("");
  const [zoneB, setZoneB] = useState("");
  const [parallelChoice, setParallelChoice] = useState<
    "" | "allowed" | "refused"
  >("");
  const [relationshipBasis, setRelationshipBasis] = useState("");
  const [relationshipSource, setRelationshipSource] = useState("");
  const [donorKey, setDonorKey] = useState("");
  const [proposalBasis, setProposalBasis] = useState("");
  const [recurrenceLinkId, setRecurrenceLinkId] = useState("");
  const [recurrenceVerdict, setRecurrenceVerdict] = useState<
    "" | "confirmed" | "rejected"
  >("");
  const [recurrenceBasis, setRecurrenceBasis] = useState("");
  const [economics, setEconomics] = useState({
    regular: "",
    overtime: "",
    overtimeShare: "",
    contractor: "",
    logistics: "",
    risk: "",
    lifeCycle: "",
    basis: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSnapshot(
        await getRecoveryControlSnapshot(detail.event.id, detail.event.site_id),
      );
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  }, [detail.event.id, detail.event.site_id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(
    action: () => Promise<RecoveryCapabilityPayload>,
    success: string,
    refreshEvent = false,
  ) {
    setWorking(true);
    setError(null);
    setMessage(null);
    try {
      const next = await action();
      setResult(next);
      setMessage(success);
      if (refreshEvent) await onChanged();
      await load();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setWorking(false);
    }
  }

  if (loading && !snapshot) {
    return <div className={cardClass}>Loading governed Recovery controls…</div>;
  }

  const baseDisabled = disabled || working;
  const canPlanningControl = [
    "planner",
    "supervisor",
    "maintenance_manager",
    "reliability_engineer",
    "admin",
    "ai_admin",
  ].includes(role);
  const canSignal = [
    "planner",
    "supervisor",
    "maintenance_manager",
    "reliability_engineer",
    "operator",
    "admin",
    "ai_admin",
  ].includes(role);
  const canField = [
    "technician",
    "supervisor",
    "maintenance_manager",
    "reliability_engineer",
    "operator",
    "admin",
    "ai_admin",
  ].includes(role);
  const canOptimize = [
    "planner",
    "maintenance_manager",
    "reliability_engineer",
    "admin",
    "ai_admin",
  ].includes(role);
  const canConsequence = [
    "maintenance_manager",
    "reliability_engineer",
    "operator",
    "admin",
    "ai_admin",
  ].includes(role);
  const canClassify = [
    "supervisor",
    "maintenance_manager",
    "reliability_engineer",
    "admin",
    "ai_admin",
  ].includes(role);
  const planningDisabled = baseDisabled || !canPlanningControl;
  const signalDisabled = baseDisabled || !canSignal;
  const fieldDisabled = baseDisabled || !canField;
  const optimizeDisabled = baseDisabled || !canOptimize;
  const consequenceDisabled = baseDisabled || !canConsequence;
  const classifyDisabled = baseDisabled || !canClassify;
  const learnDisabled = baseDisabled || !canSignal;
  const donors = donorCandidatesFromPayload(snapshot?.cannibalization);
  const selectedDonor = donors.find(
    (item) =>
      `${item.workOrderMaterialId}:${item.donorComponentInstanceId}` ===
      donorKey,
  );
  const economicsReady = economicAssumptionsReady(economics);
  const planId = detail.latest_plan?.id ?? null;
  const selectedWork = detail.scope.find(
    (item) => item.event_work_id === selectedWorkId,
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 rounded-xl border border-teal-500/20 bg-teal-500/5 p-4 text-sm text-slate-300 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2 font-semibold text-teal-200">
            <ShieldCheck className="h-4 w-4" /> Governed server controls
          </div>
          <p className="mt-1 text-slate-400">
            Results are computed by tenant-scoped database contracts. Missing or
            stale evidence stays unknown; these controls never self-approve
            work.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={working}
          className="inline-flex items-center gap-2 rounded-lg border border-industrial-border px-3 py-2 text-slate-300 disabled:opacity-40"
        >
          <RefreshCw className="h-4 w-4" /> Reload evidence
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
          {error}
        </div>
      )}
      {message && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-300">
          {message}
        </div>
      )}

      {view === "control" && (
        <>
          <div className="grid gap-5 xl:grid-cols-2">
            <section className={cardClass}>
              <div className="flex items-center gap-2 font-semibold text-industrial-text">
                <Activity className="h-4 w-4 text-teal-400" /> Readiness and
                planning-input refresh
              </div>
              <p className="mt-2 text-sm text-slate-400">
                Recomputes labour, material-lot condition/certification/staging,
                component-life, physical-zone and external-resource controls.
              </p>
              <button
                type="button"
                disabled={planningDisabled}
                onClick={() =>
                  void run(
                    () =>
                      recoveryActions.refreshPlanningInputs(detail.event.id),
                    "Planning inputs and readiness constraints refreshed.",
                    true,
                  )
                }
                className="mt-4 rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
              >
                Refresh governed inputs
              </button>
            </section>

            <section className={cardClass}>
              <div className="flex items-center gap-2 font-semibold text-industrial-text">
                <Cable className="h-4 w-4 text-teal-400" /> Required external
                evidence
              </div>
              <p className="mt-2 text-sm text-slate-400">
                Declares what the plan needs. A requirement remains unknown
                until a fresh tenant signal is received.
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <select
                  className={inputClass}
                  value={resourceKind}
                  onChange={(event) => setResourceKind(event.target.value)}
                >
                  {[
                    "bay",
                    "crane",
                    "tooling",
                    "vendor",
                    "documentation",
                    "weather",
                    "production",
                  ].map((kind) => (
                    <option key={kind}>{kind}</option>
                  ))}
                </select>
                <input
                  className={inputClass}
                  placeholder="Source key, e.g. site-weather"
                  value={resourceKey}
                  onChange={(event) => setResourceKey(event.target.value)}
                />
              </div>
              <textarea
                className={`${inputClass} mt-3`}
                rows={2}
                placeholder="Why this evidence is required (10+ characters)"
                value={resourceBasis}
                onChange={(event) => setResourceBasis(event.target.value)}
              />
              <button
                type="button"
                disabled={
                  planningDisabled ||
                  resourceKey.trim().length < 2 ||
                  resourceBasis.trim().length < 10
                }
                onClick={() =>
                  void run(
                    () =>
                      recoveryActions.setResourceRequirement({
                        eventId: detail.event.id,
                        kind: resourceKind,
                        key: resourceKey,
                        phase: "planning",
                        isHard: true,
                        basis: resourceBasis,
                      }),
                    "Required external evidence recorded. It remains fail-closed until a fresh signal exists.",
                    true,
                  )
                }
                className="mt-3 rounded-lg border border-teal-500/30 px-4 py-2 text-sm text-teal-300 disabled:opacity-40"
              >
                Add hard requirement
              </button>
            </section>
          </div>

          <section className={cardClass}>
            <div className="flex items-center gap-2 font-semibold text-industrial-text">
              <AlertTriangle className="h-4 w-4 text-amber-400" /> Authorized
              manual signal
            </div>
            <p className="mt-2 text-sm text-slate-400">
              For controlled fallback only. Automated tenant feeds use the same
              signal contract through the connector ingestion API and retain
              their source identity and freshness window.
            </p>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <select
                className={inputClass}
                value={signalState}
                onChange={(event) =>
                  setSignalState(
                    event.target.value as
                      "available" | "unavailable" | "unknown",
                  )
                }
              >
                <option value="available">Available</option>
                <option value="unavailable">Unavailable</option>
                <option value="unknown">Unknown</option>
              </select>
              <input
                className={inputClass}
                placeholder="Source system"
                value={signalSource}
                onChange={(event) => setSignalSource(event.target.value)}
              />
              <input
                className={inputClass}
                type="datetime-local"
                value={signalValidUntil}
                onChange={(event) => setSignalValidUntil(event.target.value)}
              />
            </div>
            <textarea
              className={`${inputClass} mt-3`}
              rows={2}
              placeholder="Observed evidence and provenance (10+ characters)"
              value={signalBasis}
              onChange={(event) => setSignalBasis(event.target.value)}
            />
            <button
              type="button"
              disabled={
                signalDisabled ||
                resourceKey.trim().length < 2 ||
                signalSource.trim().length < 2 ||
                signalBasis.trim().length < 10 ||
                !signalValidUntil
              }
              onClick={() =>
                void run(
                  () =>
                    recoveryActions.registerOperationalSignal({
                      kind: resourceKind,
                      key: resourceKey,
                      state: signalState,
                      observedAt: new Date().toISOString(),
                      validUntil: new Date(signalValidUntil).toISOString(),
                      sourceSystem: signalSource,
                      basis: signalBasis,
                      siteId: detail.event.site_id,
                      assetId: detail.event.asset_id,
                    }),
                  "Operational signal recorded with tenant, source and freshness provenance.",
                  true,
                )
              }
              className="mt-3 rounded-lg border border-amber-500/30 px-4 py-2 text-sm text-amber-200 disabled:opacity-40"
            >
              Record manual signal
            </button>
          </section>

          <section className={cardClass}>
            <h3 className="font-semibold text-industrial-text">
              Field control evidence
            </h3>
            <p className="mt-2 text-sm text-slate-400">
              Work-zone, component scope, energy state and field notes are
              explicit human evidence. Energy verification expires and is
              rechecked below the UI before work starts.
            </p>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <select
                className={inputClass}
                value={selectedWorkId}
                onChange={(event) => setSelectedWorkId(event.target.value)}
              >
                <option value="">Select event work</option>
                {detail.scope.map((item) => (
                  <option key={item.event_work_id} value={item.event_work_id}>
                    {item.wo_number ?? "WO"} · {item.title}
                  </option>
                ))}
              </select>
              <input
                className={inputClass}
                placeholder="Physical work zone"
                value={workZone}
                onChange={(event) => setWorkZone(event.target.value)}
              />
              <input
                className={inputClass}
                placeholder="Component scope"
                value={componentScope}
                onChange={(event) => setComponentScope(event.target.value)}
              />
              <select
                className={inputClass}
                value={energyType}
                onChange={(event) => setEnergyType(event.target.value)}
              >
                {[
                  "electrical",
                  "hydraulic",
                  "pneumatic",
                  "mechanical",
                  "thermal",
                  "gravity",
                  "chemical",
                  "process",
                  "other",
                ].map((kind) => (
                  <option key={kind}>{kind}</option>
                ))}
              </select>
              <select
                className={inputClass}
                value={energyState}
                onChange={(event) => setEnergyState(event.target.value)}
              >
                {[
                  "unknown",
                  "energized",
                  "isolated",
                  "dissipated",
                  "verified_zero",
                ].map((state) => (
                  <option key={state}>{state}</option>
                ))}
              </select>
              <input
                className={inputClass}
                type="datetime-local"
                value={energyValidUntil}
                onChange={(event) => setEnergyValidUntil(event.target.value)}
              />
            </div>
            <textarea
              className={`${inputClass} mt-3`}
              rows={2}
              placeholder="Observed field evidence / basis (10+ characters)"
              value={fieldBasis}
              onChange={(event) => setFieldBasis(event.target.value)}
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={
                  planningDisabled ||
                  !selectedWorkId ||
                  workZone.trim().length < 2 ||
                  fieldBasis.trim().length < 10
                }
                onClick={() =>
                  void run(
                    () =>
                      recoveryActions.setWorkZone({
                        eventWorkId: selectedWorkId,
                        zone: workZone,
                        componentScope,
                        basis: fieldBasis,
                      }),
                    "Physical work zone and component scope recorded.",
                    true,
                  )
                }
                className="rounded-lg border border-teal-500/30 px-3 py-2 text-sm text-teal-300 disabled:opacity-40"
              >
                Set work zone / component
              </button>
              <button
                type="button"
                disabled={
                  fieldDisabled ||
                  fieldBasis.trim().length < 10 ||
                  !energyValidUntil
                }
                onClick={() =>
                  void run(
                    () =>
                      recoveryActions.recordEnergyState({
                        assetId: detail.event.asset_id,
                        energyType,
                        state: energyState,
                        basis: fieldBasis,
                        validUntil: new Date(energyValidUntil).toISOString(),
                      }),
                    "Time-bound asset energy state recorded.",
                  )
                }
                className="rounded-lg border border-amber-500/30 px-3 py-2 text-sm text-amber-200 disabled:opacity-40"
              >
                Record energy state
              </button>
              {selectedWork?.job_plan_id && (
                <button
                  type="button"
                  disabled={planningDisabled || fieldBasis.trim().length < 10}
                  onClick={() =>
                    void run(
                      () =>
                        recoveryActions.setEnergyRequirement({
                          jobPlanId: selectedWork.job_plan_id as string,
                          energyType,
                          requiredState: "verified_zero",
                          basis: fieldBasis,
                        }),
                      "Job-plan energy requirement recorded; work start will enforce it.",
                    )
                  }
                  className="rounded-lg border border-industrial-border px-3 py-2 text-sm text-slate-200 disabled:opacity-40"
                >
                  Require verified zero
                </button>
              )}
              <button
                type="button"
                disabled={
                  fieldDisabled ||
                  !selectedWorkId ||
                  fieldBasis.trim().length < 10
                }
                onClick={() =>
                  void run(
                    () =>
                      recoveryActions.addFieldEvidence({
                        eventId: detail.event.id,
                        eventWorkId: selectedWorkId,
                        kind: "note",
                        note: fieldBasis,
                        clientCommandId: crypto.randomUUID(),
                      }),
                    "Idempotent field evidence added to the shift handoff.",
                  )
                }
                className="rounded-lg border border-industrial-border px-3 py-2 text-sm text-slate-200 disabled:opacity-40"
              >
                Add field note
              </button>
            </div>
          </section>

          <section className={cardClass}>
            <h3 className="font-semibold text-industrial-text">
              Work-zone relationship
            </h3>
            <p className="mt-2 text-sm text-slate-400">
              A named person records whether two zones on this event&apos;s site
              may run in parallel. This does not compute a spatial model and
              does not start work. Missing relationship evidence stays blocked
              when parallel work is claimed.
            </p>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <input
                className={inputClass}
                placeholder="Zone A"
                value={zoneA}
                onChange={(event) => setZoneA(event.target.value)}
              />
              <input
                className={inputClass}
                placeholder="Zone B"
                value={zoneB}
                onChange={(event) => setZoneB(event.target.value)}
              />
              <select
                className={inputClass}
                value={parallelChoice}
                onChange={(event) =>
                  setParallelChoice(
                    event.target.value as "" | "allowed" | "refused",
                  )
                }
              >
                <option value="">
                  Choose whether parallel work is permitted
                </option>
                <option value="allowed">Parallel work is permitted</option>
                <option value="refused">Parallel work is not permitted</option>
              </select>
              <input
                className={inputClass}
                placeholder="Source reference (optional)"
                value={relationshipSource}
                onChange={(event) => setRelationshipSource(event.target.value)}
              />
            </div>
            <textarea
              className={`${inputClass} mt-3`}
              rows={2}
              placeholder="Basis for this relationship (15+ characters)"
              value={relationshipBasis}
              onChange={(event) => setRelationshipBasis(event.target.value)}
            />
            <button
              type="button"
              disabled={
                planningDisabled ||
                zoneA.trim().length < 2 ||
                zoneB.trim().length < 2 ||
                parallelChoice === "" ||
                relationshipBasis.trim().length < 15
              }
              onClick={() => {
                if (parallelChoice === "") return;
                void run(
                  () =>
                    recoveryActions.setWorkZoneRelationship({
                      siteId: detail.event.site_id,
                      zoneA,
                      zoneB,
                      parallelAllowed: parallelChoice === "allowed",
                      basis: relationshipBasis,
                      sourceRef: relationshipSource.trim() || null,
                    }),
                  parallelChoice === "allowed"
                    ? "Work-zone relationship recorded: parallel work is permitted on the stated basis."
                    : "Work-zone relationship recorded: parallel work is not permitted.",
                  true,
                );
              }}
              className="mt-3 rounded-lg border border-teal-500/30 px-3 py-2 text-sm text-teal-300 disabled:opacity-40"
            >
              Record work-zone relationship
            </button>
          </section>

          <div className="grid gap-5 xl:grid-cols-2">
            <JsonEvidence
              title="Shift handoff"
              value={snapshot?.handoff}
              empty="No handoff evidence is available."
            />
            <JsonEvidence
              title="Supervisor decision queue"
              value={snapshot?.decisionQueue}
              empty="No intervention is waiting."
            />
          </div>
        </>
      )}

      {view === "optimize" && (
        <>
          <section className={cardClass}>
            <div className="flex items-center gap-2 font-semibold text-industrial-text">
              <BrainCircuit className="h-4 w-4 text-teal-400" /> Deterministic
              optimization
            </div>
            <p className="mt-2 text-sm text-slate-400">
              Simulations are advisory and immutable. They cannot release a plan
              or bypass independent approval.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={optimizeDisabled || !planId}
                onClick={() =>
                  planId &&
                  void run(
                    () => recoveryActions.runRiskSimulation(planId),
                    "Empirical duration-risk simulation completed.",
                  )
                }
                className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
              >
                Run P50/P80/P95 risk
              </button>
              <button
                type="button"
                disabled={optimizeDisabled}
                onClick={() =>
                  void run(
                    () =>
                      recoveryActions.runFleetOptimization(
                        detail.event.site_id,
                      ),
                    "Fleet scarce-resource allocation calculated.",
                  )
                }
                className="rounded-lg border border-teal-500/30 px-4 py-2 text-sm text-teal-300 disabled:opacity-40"
              >
                Optimize site fleet
              </button>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <textarea
                className={inputClass}
                rows={3}
                value={whatIfChanges}
                onChange={(event) => setWhatIfChanges(event.target.value)}
                aria-label="What-if changes as JSON"
              />
              <textarea
                className={inputClass}
                rows={3}
                placeholder="Scenario basis (10+ characters)"
                value={whatIfBasis}
                onChange={(event) => setWhatIfBasis(event.target.value)}
              />
            </div>
            <button
              type="button"
              disabled={
                optimizeDisabled || !planId || whatIfBasis.trim().length < 10
              }
              onClick={() => {
                if (!planId) return;
                try {
                  const changes = JSON.parse(whatIfChanges) as Record<
                    string,
                    unknown
                  >;
                  void run(
                    () =>
                      recoveryActions.simulateWhatIf(
                        planId,
                        changes,
                        whatIfBasis,
                      ),
                    "Non-mutating what-if scenario calculated.",
                  );
                } catch {
                  setError("What-if changes must be valid JSON.");
                }
              }}
              className="mt-3 rounded-lg border border-industrial-border px-4 py-2 text-sm text-slate-200 disabled:opacity-40"
            >
              Simulate what-if
            </button>
          </section>

          <div className="grid gap-5 xl:grid-cols-2">
            <section className={cardClass}>
              <h3 className="font-semibold text-industrial-text">
                Duration uncertainty group
              </h3>
              <p className="mt-2 text-sm text-slate-400">
                Shared-shock weight is a scenario input, not a fitted
                correlation coefficient.
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <select
                  className={inputClass}
                  value={selectedWorkId}
                  onChange={(event) => setSelectedWorkId(event.target.value)}
                >
                  <option value="">Select event work</option>
                  {detail.scope.map((item) => (
                    <option key={item.event_work_id} value={item.event_work_id}>
                      {item.wo_number ?? "WO"}
                    </option>
                  ))}
                </select>
                <input
                  className={inputClass}
                  placeholder="Uncertainty group"
                  value={uncertaintyGroup}
                  onChange={(event) => setUncertaintyGroup(event.target.value)}
                />
                <input
                  className={inputClass}
                  type="number"
                  min="0"
                  max="1"
                  step="0.1"
                  value={uncertaintyWeight}
                  onChange={(event) => setUncertaintyWeight(event.target.value)}
                />
              </div>
              <button
                type="button"
                disabled={
                  optimizeDisabled ||
                  !selectedWorkId ||
                  uncertaintyGroup.trim().length < 2 ||
                  whatIfBasis.trim().length < 10 ||
                  Number(uncertaintyWeight) < 0 ||
                  Number(uncertaintyWeight) > 1
                }
                onClick={() =>
                  void run(
                    () =>
                      recoveryActions.setUncertaintyGroup({
                        eventWorkId: selectedWorkId,
                        group: uncertaintyGroup,
                        sharedShockWeight: Number(uncertaintyWeight),
                        basis: whatIfBasis,
                      }),
                    "Duration uncertainty group recorded with its human basis.",
                  )
                }
                className="mt-3 rounded-lg border border-teal-500/30 px-3 py-2 text-sm text-teal-300 disabled:opacity-40"
              >
                Set uncertainty group
              </button>
            </section>

            <section className={cardClass}>
              <h3 className="font-semibold text-industrial-text">
                Failure consequence
              </h3>
              <p className="mt-2 text-sm text-slate-400">
                Set all four tenant-assessed dimensions. The optimizer uses the
                governed scoring contract and records the human basis.
              </p>
              <div className="mt-3 grid grid-cols-2 gap-3">
                {(
                  Object.keys(consequenceScores) as Array<
                    keyof typeof consequenceScores
                  >
                ).map((dimension) => (
                  <label
                    key={dimension}
                    className="text-xs capitalize text-slate-400"
                  >
                    {dimension} (0–5)
                    <input
                      className={`${inputClass} mt-1`}
                      type="number"
                      min="0"
                      max="5"
                      value={consequenceScores[dimension]}
                      onChange={(event) =>
                        setConsequenceScores((prior) => ({
                          ...prior,
                          [dimension]: event.target.value,
                        }))
                      }
                    />
                  </label>
                ))}
              </div>
              <textarea
                className={`${inputClass} mt-3`}
                rows={3}
                placeholder="Consequence basis (15+ characters). Scores default to zero until assessed."
                value={consequenceBasis}
                onChange={(event) => setConsequenceBasis(event.target.value)}
              />
              <button
                type="button"
                disabled={
                  consequenceDisabled ||
                  consequenceBasis.trim().length < 20 ||
                  Object.values(consequenceScores).some(
                    (score) => Number(score) < 0 || Number(score) > 5,
                  )
                }
                onClick={() =>
                  void run(
                    () =>
                      recoveryActions.setConsequence({
                        eventId: detail.event.id,
                        safety: Number(consequenceScores.safety),
                        environment: Number(consequenceScores.environment),
                        business: Number(consequenceScores.business),
                        production: Number(consequenceScores.production),
                        basis: consequenceBasis,
                      }),
                    "Human consequence assessment recorded for fleet prioritization.",
                  )
                }
                className="mt-3 rounded-lg border border-industrial-border px-3 py-2 text-sm text-slate-200 disabled:opacity-40"
              >
                Record consequence assessment
              </button>
            </section>
          </div>

          {result && (
            <JsonEvidence
              title="Latest optimization result"
              value={result}
              empty="Run an optimization."
            />
          )}
          <div className="grid gap-5 xl:grid-cols-3">
            <JsonEvidence
              title="Component life"
              value={snapshot?.componentLife}
              empty="No component scope/evidence is recorded."
            />
            <JsonEvidence
              title="Parts risk"
              value={snapshot?.partsRisk}
              empty="No material demand is recorded."
            />
            <JsonEvidence
              title="Alternates / donor options"
              value={snapshot?.cannibalization}
              empty="No governed option is available."
            />
          </div>

          <section className={cardClass}>
            <h3 className="font-semibold text-industrial-text">
              Cannibalization proposal
            </h3>
            <p className="mt-2 text-sm text-slate-400">
              Propose a listed donor for approval. No component is transferred
              and no stock moves. A proposal that is not in this
              organization&apos;s donor list cannot be typed in by id.
            </p>
            {donors.length === 0 ? (
              <p className="mt-3 text-sm text-slate-400">
                No donor candidate is listed for this event.
              </p>
            ) : (
              <>
                <select
                  className={`${inputClass} mt-3`}
                  value={donorKey}
                  onChange={(event) => setDonorKey(event.target.value)}
                >
                  <option value="">Select a listed donor candidate</option>
                  {donors.map((item) => (
                    <option
                      key={`${item.workOrderMaterialId}:${item.donorComponentInstanceId}`}
                      value={`${item.workOrderMaterialId}:${item.donorComponentInstanceId}`}
                    >
                      {item.requiredMaterial || "material"} from{" "}
                      {item.donorAsset || "donor asset"}
                      {item.donorState ? ` (${item.donorState})` : ""}
                    </option>
                  ))}
                </select>
                <textarea
                  className={`${inputClass} mt-3`}
                  rows={3}
                  placeholder="Trade-study basis (20+ characters)"
                  value={proposalBasis}
                  onChange={(event) => setProposalBasis(event.target.value)}
                />
                <button
                  type="button"
                  disabled={
                    optimizeDisabled ||
                    !selectedDonor ||
                    proposalBasis.trim().length < 20
                  }
                  onClick={() => {
                    if (!selectedDonor) return;
                    void run(
                      () =>
                        recoveryActions.proposeCannibalization({
                          eventId: detail.event.id,
                          workOrderMaterialId:
                            selectedDonor.workOrderMaterialId,
                          donorComponentInstanceId:
                            selectedDonor.donorComponentInstanceId,
                          basis: proposalBasis,
                        }),
                      "Pending approval recorded. No component was transferred.",
                    );
                  }}
                  className="mt-3 rounded-lg border border-amber-500/30 px-3 py-2 text-sm text-amber-200 disabled:opacity-40"
                >
                  Propose for approval
                </button>
              </>
            )}
          </section>
        </>
      )}

      {view === "learn" && (
        <>
          <section className={cardClass}>
            <h3 className="font-semibold text-industrial-text">
              Evidence-gated learning cadence
            </h3>
            <p className="mt-2 text-sm text-slate-400">
              Empty patterns remain empty until the tenant has enough qualifying
              history. Publishing snapshots records the current evidence; it
              does not manufacture a conclusion.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {(["shift", "daily", "weekly"] as const).map((cadence) => (
                <button
                  type="button"
                  key={cadence}
                  disabled={learnDisabled}
                  onClick={() =>
                    void run(
                      () =>
                        recoveryActions.publishCadence(
                          cadence,
                          detail.event.id,
                        ),
                      `${cadence} evidence snapshot published.`,
                    )
                  }
                  className="rounded-lg border border-industrial-border px-3 py-2 text-sm capitalize text-slate-200 disabled:opacity-40"
                >
                  Publish {cadence}
                </button>
              ))}
              <button
                type="button"
                disabled={planningDisabled}
                onClick={() =>
                  void run(
                    () =>
                      recoveryActions.refreshRecurrenceCandidates(
                        detail.event.id,
                      ),
                    "Recurrence candidates refreshed for human classification.",
                  )
                }
                className="rounded-lg border border-teal-500/30 px-3 py-2 text-sm text-teal-300 disabled:opacity-40"
              >
                Refresh recurrence candidates
              </button>
            </div>
          </section>

          <section className={cardClass}>
            <h3 className="font-semibold text-industrial-text">
              Recurrence classification
            </h3>
            <p className="mt-2 text-sm text-slate-400">
              Refresh does not confirm a recurrence. A named person classifies
              one candidate as confirmed or rejected. Only a confirmed verdict
              removes the event from first-time-right.
            </p>
            {(snapshot?.recurrenceCandidates.length ?? 0) === 0 ? (
              <p className="mt-3 text-sm text-slate-400">
                No unclassified recurrence candidate is on this event.
              </p>
            ) : (
              <>
                <select
                  className={`${inputClass} mt-3`}
                  value={recurrenceLinkId}
                  onChange={(event) => setRecurrenceLinkId(event.target.value)}
                >
                  <option value="">Select an unclassified candidate</option>
                  {snapshot?.recurrenceCandidates.map((item) => (
                    <option key={item.id} value={item.id}>
                      Notification {item.notificationId}
                    </option>
                  ))}
                </select>
                <select
                  className={`${inputClass} mt-3`}
                  value={recurrenceVerdict}
                  onChange={(event) =>
                    setRecurrenceVerdict(
                      event.target.value as "" | "confirmed" | "rejected",
                    )
                  }
                >
                  <option value="">Choose a verdict</option>
                  <option value="confirmed">Confirmed recurrence</option>
                  <option value="rejected">Not a recurrence</option>
                </select>
                <textarea
                  className={`${inputClass} mt-3`}
                  rows={3}
                  placeholder="Classification basis (15+ characters)"
                  value={recurrenceBasis}
                  onChange={(event) => setRecurrenceBasis(event.target.value)}
                />
                <button
                  type="button"
                  disabled={
                    classifyDisabled ||
                    recurrenceLinkId === "" ||
                    recurrenceVerdict === "" ||
                    recurrenceBasis.trim().length < 15
                  }
                  onClick={() => {
                    if (recurrenceVerdict === "") return;
                    void run(
                      () =>
                        recoveryActions.classifyRecurrence({
                          linkId: recurrenceLinkId,
                          verdict: recurrenceVerdict,
                          basis: recurrenceBasis,
                        }),
                      recurrenceVerdict === "confirmed"
                        ? "Recurrence confirmed by a named person."
                        : "Recurrence candidate rejected by a named person.",
                    );
                  }}
                  className="mt-3 rounded-lg border border-teal-500/30 px-3 py-2 text-sm text-teal-300 disabled:opacity-40"
                >
                  Classify recurrence
                </button>
              </>
            )}
          </section>

          <div className="grid gap-5 xl:grid-cols-2">
            <section className={cardClass}>
              <h3 className="font-semibold text-industrial-text">
                Recommendation feedback
              </h3>
              <select
                className={`${inputClass} mt-3`}
                value={feedbackDisposition}
                onChange={(event) => setFeedbackDisposition(event.target.value)}
              >
                <option value="accepted">Accepted</option>
                <option value="rejected">Rejected</option>
                <option value="modified">Modified</option>
                <option value="deferred">Deferred</option>
              </select>
              <textarea
                className={`${inputClass} mt-3`}
                rows={3}
                placeholder="Reason and evidence (10+ characters)"
                value={feedbackReason}
                onChange={(event) => setFeedbackReason(event.target.value)}
              />
              <button
                type="button"
                disabled={signalDisabled || feedbackReason.trim().length < 10}
                onClick={() =>
                  void run(
                    () =>
                      recoveryActions.recordFeedback({
                        eventId: detail.event.id,
                        kind: "integrated_plan",
                        key: detail.latest_plan?.id ?? detail.event.id,
                        disposition: feedbackDisposition,
                        reasonCode: "operator_evidence",
                        reasonText: feedbackReason,
                      }),
                    "Recommendation disposition recorded for learning.",
                  )
                }
                className="mt-3 rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
              >
                Record disposition
              </button>
            </section>

            <section className={cardClass}>
              <h3 className="font-semibold text-industrial-text">
                Counterfactual delay attribution
              </h3>
              <input
                className={`${inputClass} mt-3`}
                type="number"
                min="0"
                step="0.1"
                placeholder="Attributed hours"
                value={delayHours}
                onChange={(event) => setDelayHours(event.target.value)}
              />
              <textarea
                className={`${inputClass} mt-3`}
                rows={3}
                placeholder="Causal basis (10+ characters)"
                value={delayBasis}
                onChange={(event) => setDelayBasis(event.target.value)}
              />
              <button
                type="button"
                disabled={
                  consequenceDisabled ||
                  !(Number(delayHours) >= 0) ||
                  delayBasis.trim().length < 10
                }
                onClick={() =>
                  void run(
                    () =>
                      recoveryActions.recordDelayAttribution({
                        eventId: detail.event.id,
                        category: "operational_constraint",
                        hours: Number(delayHours),
                        attribution: "human_assessed",
                        basis: delayBasis,
                      }),
                    "Delay attribution recorded against the frozen baseline.",
                  )
                }
                className="mt-3 rounded-lg border border-teal-500/30 px-4 py-2 text-sm text-teal-300 disabled:opacity-40"
              >
                Record attribution
              </button>
            </section>
          </div>

          <section className={cardClass}>
            <h3 className="font-semibold text-industrial-text">
              Economic assumptions
            </h3>
            <p className="mt-2 text-sm text-slate-400">
              Record the labour, contractor, logistics, risk and life-cycle
              figures a named person is willing to state for this event. Blank
              is not zero. These figures do not verify value.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {(
                [
                  ["regular", "Regular labour rate (USD)"],
                  ["overtime", "Overtime labour rate (USD)"],
                  ["overtimeShare", "Overtime share (0 to 1)"],
                  ["contractor", "Contractor cost (USD)"],
                  ["logistics", "Logistics cost (USD)"],
                  ["risk", "Risk cost (USD)"],
                  ["lifeCycle", "Life-cycle cost (USD)"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="block text-xs text-slate-400">
                  {label}
                  <input
                    className={`${inputClass} mt-1`}
                    type="number"
                    min="0"
                    step="any"
                    value={economics[key]}
                    onChange={(event) =>
                      setEconomics((current) => ({
                        ...current,
                        [key]: event.target.value,
                      }))
                    }
                  />
                </label>
              ))}
            </div>
            <textarea
              className={`${inputClass} mt-3`}
              rows={3}
              placeholder="Basis for these figures (20+ characters)"
              value={economics.basis}
              onChange={(event) =>
                setEconomics((current) => ({
                  ...current,
                  basis: event.target.value,
                }))
              }
            />
            <button
              type="button"
              disabled={optimizeDisabled || !economicsReady}
              onClick={() =>
                void run(
                  () =>
                    recoveryActions.setEconomicAssumptions({
                      eventId: detail.event.id,
                      regular: Number(economics.regular),
                      overtime: Number(economics.overtime),
                      overtimeShare: Number(economics.overtimeShare),
                      contractor: Number(economics.contractor),
                      logistics: Number(economics.logistics),
                      risk: Number(economics.risk),
                      lifeCycle: Number(economics.lifeCycle),
                      basis: economics.basis,
                    }),
                  "Economic assumptions recorded. Value is not verified.",
                )
              }
              className="mt-3 rounded-lg border border-industrial-border px-3 py-2 text-sm text-slate-200 disabled:opacity-40"
            >
              Record economic assumptions
            </button>
          </section>

          <div className="grid gap-5 xl:grid-cols-2">
            <JsonEvidence
              title="First-time-right metrics"
              value={snapshot?.firstTimeRight}
              empty="No qualifying closed events."
            />
            <JsonEvidence
              title="Best-sequence patterns"
              value={snapshot?.sequencePatterns}
              empty="The minimum evidence threshold has not been met."
            />
            <JsonEvidence
              title="Normalized productivity"
              value={snapshot?.productivityNorms}
              empty="The minimum evidence threshold has not been met."
            />
            <JsonEvidence
              title="Governed economics"
              value={snapshot?.economics}
              empty="No governed economic assumptions exist."
            />
            <JsonEvidence
              title="Counterfactual attribution"
              value={snapshot?.delayAttribution}
              empty="No delay attribution has been recorded."
            />
          </div>
        </>
      )}
    </div>
  );
}
