import { useMemo, useState } from "react";
import { Clock3, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import {
  timeSynchronizationActions,
  type ConnectorTimeAssurance,
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
  const { data, loading, error, refetch } = useAsyncData(
    () => timeSynchronizationActions.status(),
    [],
  );
  const connectors = useMemo(() => data?.connectors ?? [], [data]);
  const [connectorId, setConnectorId] = useState("");
  const [protocol, setProtocol] = useState<
    "ntp" | "ptp" | "gnss" | "vendor_managed" | "system_managed"
  >("ntp");
  const [referenceAuthority, setReferenceAuthority] = useState("");
  const [toleranceMs, setToleranceMs] = useState("100");
  const [maxAgeMinutes, setMaxAgeMinutes] = useState("15");
  const [evidenceReference, setEvidenceReference] = useState("");
  const [basis, setBasis] = useState("");
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const counts = useMemo(
    () => ({
      synchronized: connectors.filter((row) => row.state === "synchronized")
        .length,
      refused: connectors.filter((row) => !row.eligibleForTimeSensitiveEvidence)
        .length,
    }),
    [connectors],
  );

  async function configure() {
    setWorking(true);
    setMessage(null);
    setFormError(null);
    try {
      const result = await timeSynchronizationActions.configure({
        connectorId,
        protocol,
        referenceAuthority,
        toleranceMs: Number(toleranceMs),
        maxObservationAgeMinutes: Number(maxAgeMinutes),
        evidenceReference,
        basis,
      });
      setMessage(
        String(
          result.note ??
            "Clock contract recorded. A current service observation is required.",
        ),
      );
      await refetch();
    } catch (caught) {
      setFormError((caught as Error).message);
    } finally {
      setWorking(false);
    }
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
            SyncAI qualifies source timestamps against a named-human clock
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

      {isAdmin ? (
        <div className="rounded-lg border border-signal-cyan/20 bg-signal-cyan/5 p-4">
          <h4 className="text-sm font-semibold text-white">
            Record the governed clock contract
          </h4>
          <p className="mt-1 text-xs text-slate-400">
            Reconfiguration starts a new revision. Older measurements remain
            immutable history and cannot qualify the new contract.
          </p>
          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
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
              aria-label="Approved tolerance in milliseconds"
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
          </div>
          <textarea
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
          <button
            type="button"
            onClick={() => void configure()}
            disabled={
              working ||
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
