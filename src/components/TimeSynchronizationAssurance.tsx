import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Clock3, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import {
  timeSynchronizationActions,
  TimeAssuranceRefusalError,
  type ClockConfigurationIntent,
  type ConnectorTimeAssurance,
  type EventTimeAssessment,
} from "../services/timeSynchronization";
import { useAuth } from "./AuthProvider";
import { ErrorState, LoadingState } from "./ui/AsyncStates";

const inputClass =
  "w-full rounded-lg border border-industrial-border bg-industrial-slate px-3 py-2 text-sm text-industrial-text outline-none focus:border-signal-cyan";

const stateClass: Record<ConnectorTimeAssurance["state"], string> = {
  synchronized: "bg-emerald-500/10 text-emerald-300",
  untrusted: "bg-rose-500/10 text-rose-300",
  stale: "bg-amber-500/10 text-amber-300",
  unproven: "bg-amber-500/10 text-amber-300",
  disabled: "bg-white/5 text-slate-400",
  unconfigured: "bg-white/5 text-slate-400",
};

export function TimeSynchronizationAssurance() {
  const { profile } = useAuth();
  const isAdmin = String(profile?.role ?? "").toLowerCase() === "admin";
  const organizationId =
    profile &&
    "organization_id" in profile &&
    typeof profile.organization_id === "string"
      ? profile.organization_id
      : "";
  const contextKey = `${profile?.id ?? ""}|${organizationId}|${profile?.role ?? ""}`;
  const contextRef = useRef({ key: contextKey, generation: 0 });
  const mounted = useRef(true);
  const { data, loading, error, refetch } = useAsyncData(
    () => timeSynchronizationActions.status(),
    [contextKey],
  );
  const connectors = useMemo(() => data?.connectors ?? [], [data]);
  const [connectorId, setConnectorId] = useState("");
  const [protocol, setProtocol] = useState<
    "ntp" | "ptp" | "gnss" | "vendor_managed" | "system_managed"
  >("ntp");
  const [referenceAuthority, setReferenceAuthority] = useState("");
  const [toleranceMs, setToleranceMs] = useState("");
  const [maxAgeMinutes, setMaxAgeMinutes] = useState("");
  const [evidenceReference, setEvidenceReference] = useState("");
  const [basis, setBasis] = useState("");
  const [working, setWorking] = useState(false);
  const [submittedProposal, setSubmittedProposal] =
    useState<Readonly<ClockConfigurationIntent> | null>(null);
  const proposalRef = useRef<Readonly<ClockConfigurationIntent> | null>(null);
  const proposalContextRef = useRef<string | null>(null);
  const configurationInFlight = useRef(false);
  const [message, setMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [eventConnectorId, setEventConnectorId] = useState("");
  const [eventTime, setEventTime] = useState("");
  const [assessing, setAssessing] = useState(false);
  const [assessment, setAssessment] = useState<EventTimeAssessment | null>(
    null,
  );
  const [assessmentError, setAssessmentError] = useState<string | null>(null);
  const assessmentRequest = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useLayoutEffect(() => {
    if (contextRef.current.key !== contextKey) {
      contextRef.current = {
        key: contextKey,
        generation: contextRef.current.generation + 1,
      };
      assessmentRequest.current += 1;
      setAssessment(null);
      setAssessmentError(null);
      setMessage(null);
    }
  }, [contextKey]);

  function clearAssessment() {
    assessmentRequest.current += 1;
    setAssessment(null);
    setAssessmentError(null);
  }

  async function assessEvent() {
    clearAssessment();
    const timestamp = eventTime.trim();
    if (
      !/(?:Z|[+-]\d{2}:\d{2})$/i.test(timestamp) ||
      !Number.isFinite(Date.parse(timestamp))
    ) {
      setAssessmentError(
        "Include an explicit timezone in a valid ISO timestamp, for example 2026-10-03T14:05:12.000Z.",
      );
      return;
    }
    const requestId = assessmentRequest.current;
    setAssessing(true);
    try {
      const result = await timeSynchronizationActions.evaluateEventTime(
        eventConnectorId,
        timestamp,
      );
      if (requestId === assessmentRequest.current) setAssessment(result);
    } catch (caught) {
      if (requestId === assessmentRequest.current)
        setAssessmentError((caught as Error).message);
    } finally {
      setAssessing(false);
    }
  }

  const counts = useMemo(
    () => ({
      synchronized: connectors.filter((row) => row.state === "synchronized")
        .length,
      refused: connectors.filter((row) => !row.eligibleForTimeSensitiveEvidence)
        .length,
    }),
    [connectors],
  );

  async function submitConfiguration(
    proposal: Readonly<ClockConfigurationIntent>,
  ) {
    if (
      configurationInFlight.current ||
      !mounted.current ||
      proposalContextRef.current !== contextRef.current.key
    )
      return;
    const requestContext = contextRef.current;
    configurationInFlight.current = true;
    setWorking(true);
    setMessage(null);
    setFormError(null);
    try {
      const result = await timeSynchronizationActions.configure(proposal);
      if (!mounted.current) return;
      if (requestContext !== contextRef.current)
        throw new Error(
          "Configuration authority changed while the request was in flight.",
        );
      setMessage(
        result.replay
          ? `Clock contract receipt confirmed for original revision ${result.configuration_revision}; current revision ${result.current_configuration_revision}. This historical replay does not establish the active contract, evidence approval or clock synchronization.`
          : `Clock contract recorded as revision ${result.configuration_revision}. A current service observation is still required; canonical evidence approval remains unverified.`,
      );
      proposalRef.current = null;
      proposalContextRef.current = null;
      setSubmittedProposal(null);
      // The canonical hook schedules a refresh; it does not return fresh proof.
      refetch();
    } catch (caught) {
      if (!mounted.current) return;
      if (
        caught instanceof TimeAssuranceRefusalError &&
        requestContext === contextRef.current
      ) {
        proposalRef.current = null;
        proposalContextRef.current = null;
        setSubmittedProposal(null);
        setFormError(caught.message);
      } else {
        setFormError(
          "Configuration outcome is unknown. Inputs remain locked. Retry only this same immutable configuration intent safely from the original administrator context; do not submit a new revision. Do not reload or navigate away before reconciliation: this screen does not persist the unresolved intent across browser sessions.",
        );
      }
    } finally {
      configurationInFlight.current = false;
      if (mounted.current) setWorking(false);
    }
  }

  function configure() {
    if (configurationInFlight.current || proposalRef.current) return;
    let idempotencyKey: string;
    try {
      idempotencyKey = crypto.randomUUID();
    } catch {
      setFormError(
        "A secure configuration intent UUID could not be created; no configuration was submitted.",
      );
      return;
    }
    const proposal = Object.freeze({
      connectorId,
      idempotencyKey,
      protocol,
      referenceAuthority,
      toleranceMs: Number(toleranceMs),
      maxObservationAgeMinutes: Number(maxAgeMinutes),
      evidenceReference,
      basis,
    });
    proposalRef.current = proposal;
    proposalContextRef.current = contextRef.current.key;
    setSubmittedProposal(proposal);
    void submitConfiguration(proposal);
  }

  if (loading) return <LoadingState label="Loading time assurance" />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  return (
    <section
      aria-labelledby="time-assurance-heading"
      className="space-y-4 rounded-xl border border-white/6 p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3
            id="time-assurance-heading"
            className="flex items-center gap-2 text-sm font-semibold text-white"
          >
            <Clock3 className="h-4 w-4 text-signal-cyan" aria-hidden />
            Event-time assurance
          </h3>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-400">
            SyncAI compares source timestamps against a named-human clock
            contract. It does not set plant clocks, prove causality, or approve
            an operational action.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refetch()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-industrial-border px-3 py-2 text-xs text-slate-300"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>

      <p
        role="status"
        className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-200"
      >
        Draft clock assurance: an opaque evidence reference is not verified
        engineering approval. Numerical synchronization alone cannot qualify
        time-sensitive evidence. Canonical evidence approval, collector
        integration and production qualification remain pending.
      </p>

      <div className="flex flex-wrap gap-3 text-xs text-slate-400">
        <span>
          <strong className="font-mono text-emerald-300">
            {counts.synchronized}
          </strong>{" "}
          current and within tolerance
        </span>
        <span>
          <strong className="font-mono text-amber-300">{counts.refused}</strong>{" "}
          refused for time-sensitive evidence
        </span>
      </div>

      {connectors.length === 0 ? (
        <p className="rounded-lg border border-industrial-border p-3 text-sm text-slate-400">
          No tenant connectors are registered. Register a source before defining
          its clock contract.
        </p>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {connectors.map((row) => (
            <article
              key={row.connectorId}
              className="rounded-lg border border-industrial-border bg-industrial-graphite p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-industrial-text">
                    {row.name}
                  </p>
                  <p className="font-mono text-[11px] text-slate-500">
                    {row.connectorKey ?? row.connectorId}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2 py-1 text-[11px] font-medium ${stateClass[row.state]}`}
                >
                  {row.state.replace(/_/g, " ")}
                </span>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-slate-400">
                {row.reason}
              </p>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <dt className="text-slate-500">Clock / authority</dt>
                <dd className="text-right text-slate-300">
                  {row.protocol?.toUpperCase() ?? "Not configured"}
                  {row.referenceAuthority ? ` · ${row.referenceAuthority}` : ""}
                </dd>
                <dt className="text-slate-500">Worst-case offset</dt>
                <dd className="text-right font-mono text-slate-300">
                  {row.worstCaseOffsetMs == null
                    ? "—"
                    : `${row.worstCaseOffsetMs} ms / ${row.toleranceMs} ms`}
                </dd>
                <dt className="text-slate-500">Observation</dt>
                <dd className="text-right text-slate-300">
                  {row.receivedAt
                    ? new Date(row.receivedAt).toLocaleString()
                    : "No current evidence"}
                </dd>
              </dl>
              {!row.eligibleForTimeSensitiveEvidence && (
                <p className="mt-3 flex items-start gap-1.5 text-xs text-amber-200">
                  <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Source timestamps remain visible but must not be treated as
                  synchronized evidence.
                </p>
              )}
            </article>
          ))}
        </div>
      )}

      {connectors.length > 0 && (
        <div className="space-y-3 rounded-lg border border-industrial-border bg-industrial-graphite p-4">
          <h4 className="text-sm font-semibold text-white">
            Assess a recorded event
          </h4>
          <p className="text-xs leading-relaxed text-slate-400">
            Read-only assessment against the clock contract recorded at the
            event. Later observations or tolerance changes cannot qualify an
            earlier event. Include a timezone; SyncAI does not rewrite the
            source timestamp.
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            <select
              aria-label="Event assessment connector"
              className={inputClass}
              value={eventConnectorId}
              onChange={(event) => {
                setEventConnectorId(event.target.value);
                clearAssessment();
              }}
            >
              <option value="">Select connector</option>
              {connectors.map((row) => (
                <option key={row.connectorId} value={row.connectorId}>
                  {row.name}
                </option>
              ))}
            </select>
            <input
              aria-label="Event timestamp with timezone"
              className={inputClass}
              value={eventTime}
              placeholder="2026-10-03T14:05:12.000Z"
              onChange={(event) => {
                setEventTime(event.target.value);
                clearAssessment();
              }}
            />
          </div>
          <button
            type="button"
            onClick={() => void assessEvent()}
            disabled={assessing || !eventConnectorId || !eventTime.trim()}
            className="rounded-lg border border-signal-cyan/30 px-3 py-2 text-xs font-semibold text-signal-cyan disabled:opacity-40"
          >
            {assessing ? "Assessing event time…" : "Assess recorded event time"}
          </button>
          {assessmentError && (
            <p role="alert" className="text-xs text-rose-300">
              {assessmentError}
            </p>
          )}
          {assessment && (
            <div
              role="status"
              className="space-y-2 rounded-lg border border-amber-500/20 p-3 text-xs text-slate-300"
            >
              <p className="font-medium">
                {assessment.configuration_revision == null
                  ? "No reconstructable recorded contract"
                  : `Recorded revision ${assessment.configuration_revision}`}
                {" · "}
                {assessment.state}
              </p>
              {assessment.configuration_audit_id && (
                <p className="break-all font-mono text-[11px]">
                  {assessment.configuration_audit_id}
                </p>
              )}
              {assessment.tolerance_ms != null && (
                <p>
                  Recorded tolerance: {assessment.tolerance_ms} ms · freshness:{" "}
                  {assessment.max_observation_age_minutes} minutes
                </p>
              )}
              {assessment.history_reason && <p>{assessment.history_reason}</p>}
              <p className="text-amber-200">
                Time-sensitive evidence remains ineligible. Recorded numerical
                posture is not engineering approval or operational authority.
              </p>
            </div>
          )}
        </div>
      )}

      {isAdmin ? (
        <div className="rounded-lg border border-signal-cyan/20 bg-signal-cyan/5 p-4">
          <h4 className="text-sm font-semibold text-white">
            Record the governed clock contract
          </h4>
          <p className="mt-1 text-xs text-slate-400">
            Reconfiguration starts a new revision. Older measurements remain
            immutable history and cannot qualify the new contract.
          </p>
          <fieldset
            disabled={working || submittedProposal !== null}
            className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3"
          >
            <select
              aria-label="Time-assurance connector"
              className={inputClass}
              value={connectorId}
              onChange={(event) => setConnectorId(event.target.value)}
            >
              <option value="">Select connector</option>
              {connectors.map((row) => (
                <option key={row.connectorId} value={row.connectorId}>
                  {row.name}
                </option>
              ))}
            </select>
            <select
              aria-label="Clock synchronization protocol"
              className={inputClass}
              value={protocol}
              onChange={(event) =>
                setProtocol(event.target.value as typeof protocol)
              }
            >
              <option value="ntp">NTP</option>
              <option value="ptp">PTP / IEEE 1588</option>
              <option value="gnss">GNSS disciplined</option>
              <option value="vendor_managed">Vendor managed</option>
              <option value="system_managed">System managed</option>
            </select>
            <input
              className={inputClass}
              placeholder="Authoritative source, e.g. site PTP grandmaster"
              value={referenceAuthority}
              onChange={(event) => setReferenceAuthority(event.target.value)}
            />
            <input
              aria-label="Recorded tolerance in milliseconds"
              className={inputClass}
              type="number"
              min="0.000001"
              step="any"
              value={toleranceMs}
              onChange={(event) => setToleranceMs(event.target.value)}
            />
            <input
              aria-label="Maximum observation age in minutes"
              className={inputClass}
              type="number"
              min="1"
              step="1"
              value={maxAgeMinutes}
              onChange={(event) => setMaxAgeMinutes(event.target.value)}
            />
            <input
              className={inputClass}
              placeholder="Evidence reference, e.g. ENG-TIME-STD-004"
              value={evidenceReference}
              onChange={(event) => setEvidenceReference(event.target.value)}
            />
          </fieldset>
          <textarea
            disabled={working || submittedProposal !== null}
            className={`${inputClass} mt-3`}
            rows={3}
            placeholder="Clock authority, engineering tolerance and freshness basis (40+ characters)"
            value={basis}
            onChange={(event) => setBasis(event.target.value)}
          />
          {formError && (
            <p className="mt-3 text-sm text-rose-300">{formError}</p>
          )}
          {message && (
            <p className="mt-3 text-sm text-emerald-300">{message}</p>
          )}
          {submittedProposal !== null && !working && (
            <button
              type="button"
              disabled={proposalContextRef.current !== contextKey}
              className="mt-4 rounded-lg border border-amber-500/40 px-4 py-2 text-sm text-amber-200"
              onClick={() => {
                if (proposalRef.current)
                  void submitConfiguration(proposalRef.current);
              }}
            >
              Retry same configuration safely
            </button>
          )}
          <button
            type="button"
            onClick={() => void configure()}
            disabled={
              working ||
              submittedProposal !== null ||
              connectorId.length === 0 ||
              referenceAuthority.trim().length < 5 ||
              evidenceReference.trim().length < 8 ||
              basis.trim().length < 40 ||
              !Number.isFinite(Number(toleranceMs)) ||
              Number(toleranceMs) <= 0 ||
              !Number.isInteger(Number(maxAgeMinutes)) ||
              Number(maxAgeMinutes) <= 0
            }
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-signal-cyan px-4 py-2 text-sm font-semibold text-overlook-void disabled:opacity-40"
          >
            <ShieldCheck className="h-4 w-4" /> Save clock contract
          </button>
        </div>
      ) : (
        <p className="text-xs text-slate-500">
          A named human administrator must configure clock authority, tolerance
          and observation freshness.
        </p>
      )}
    </section>
  );
}
