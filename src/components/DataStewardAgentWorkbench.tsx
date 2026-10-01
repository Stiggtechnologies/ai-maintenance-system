import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Archive,
  Bot,
  ClipboardCheck,
  Database,
  Save,
  ShieldCheck,
} from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import {
  assignDataStewardReview,
  confirmHistorianTagMapping,
  loadDataStewardWorkspace,
  recordArchiveDisposition,
  recordDataQualitySla,
  recordDataStewardDisposition,
  recordInstrumentCalibration,
  runDataStewardAgent,
  upsertDataDomain,
  type DataQualityMetric,
} from "../services/dataStewardAgentService";
import { ErrorState, LoadingState } from "./ui/AsyncStates";

const input =
  "mt-1 w-full rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm text-white";
const today = new Date().toISOString().slice(0, 10);
const defaultDue = new Date(Date.now() + 7 * 86_400_000)
  .toISOString()
  .slice(0, 10);

function label(value: string) {
  return value.replaceAll("_", " ");
}

function numberOrNull(value: string): number | null {
  return value.trim() === "" ? null : Number(value);
}

export function DataStewardAgentWorkbench() {
  const { data, loading, error, refetch } = useAsyncData(
    loadDataStewardWorkspace,
    [],
    { isEmpty: () => false },
  );
  const [domainId, setDomainId] = useState("");
  const [assessmentId, setAssessmentId] = useState("");
  const [reviewerId, setReviewerId] = useState("");
  const [findingKey, setFindingKey] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState<{
    kind: "ok" | "error";
    text: string;
  } | null>(null);

  const [domainEditId, setDomainEditId] = useState("");
  const [domainKey, setDomainKey] = useState("");
  const [domainLabel, setDomainLabel] = useState("");
  const [domainDescription, setDomainDescription] = useState("");
  const [ownerRole, setOwnerRole] = useState("reliability_engineer");
  const [ownerUserId, setOwnerUserId] = useState("");
  const [stewardRole, setStewardRole] = useState("reliability_engineer");
  const [domainBasis, setDomainBasis] = useState(
    "Accountability recorded from the approved data-governance operating model.",
  );

  const [metric, setMetric] = useState<DataQualityMetric>("completeness");
  const [targetValue, setTargetValue] = useState("95");
  const [measuredValue, setMeasuredValue] = useState("");
  const [measuredOn, setMeasuredOn] = useState("");
  const [slaBasis, setSlaBasis] = useState(
    "Target and measurement use the stated governed source population.",
  );
  const [slaSource, setSlaSource] = useState("");

  const [calibrationSensorId, setCalibrationSensorId] = useState("");
  const [instrumentRef, setInstrumentRef] = useState("");
  const [calibratedOn, setCalibratedOn] = useState(today);
  const [intervalMonths, setIntervalMonths] = useState("12");
  const [asFound, setAsFound] = useState<"yes" | "no">("yes");
  const [asLeft, setAsLeft] = useState<"yes" | "no">("yes");
  const [certificate, setCertificate] = useState("");
  const [calibrationBasis, setCalibrationBasis] = useState(
    "Recorded from the signed calibration certificate and as-found result.",
  );

  const [mappingEditId, setMappingEditId] = useState("");
  const [mappingSensorId, setMappingSensorId] = useState("");
  const [historianTag, setHistorianTag] = useState("");
  const [measurement, setMeasurement] = useState("");
  const [unit, setUnit] = useState("");
  const [sourceSystem, setSourceSystem] = useState("");
  const [mappingBasis, setMappingBasis] = useState(
    "Named-human confirmation against the source historian and canonical equipment register.",
  );

  const [recordClass, setRecordClass] = useState("");
  const [archiveReference, setArchiveReference] = useState("");
  const [archiveDisposition, setArchiveDisposition] = useState<
    "archived" | "superseded" | "obsolete" | "destroyed"
  >("archived");
  const [supersededBy, setSupersededBy] = useState("");
  const [retentionUntil, setRetentionUntil] = useState("");
  const [archiveReason, setArchiveReason] = useState("");
  const [archiveEvidence, setArchiveEvidence] = useState("");

  const [dueDate, setDueDate] = useState(defaultDue);
  const [reviewNote, setReviewNote] = useState(
    "Independently verify the source fingerprints, facts, exception and proposed remediation route.",
  );
  const [disposition, setDisposition] = useState<
    "accepted" | "remediated" | "deferred" | "rejected"
  >("accepted");
  const [dispositionNote, setDispositionNote] = useState(
    "Independent review confirms the finding and preserves master-data authority with the named human owner.",
  );
  const [dispositionEvidence, setDispositionEvidence] = useState("");

  useEffect(() => {
    if (!domainId && data?.domains[0]) setDomainId(String(data.domains[0].id));
    if (!assessmentId && data?.assessments[0])
      setAssessmentId(data.assessments[0].id);
    if (!reviewerId && data?.reviewers[0]) setReviewerId(data.reviewers[0].id);
    if (!calibrationSensorId && data?.sensors[0])
      setCalibrationSensorId(data.sensors[0].id);
    if (!mappingSensorId && data?.sensors[0])
      setMappingSensorId(data.sensors[0].id);
  }, [
    assessmentId,
    calibrationSensorId,
    data,
    domainId,
    mappingSensorId,
    reviewerId,
  ]);

  const assessment = useMemo(
    () => data?.assessments.find((item) => item.id === assessmentId) ?? null,
    [assessmentId, data],
  );
  const selectedDomain = useMemo(
    () => data?.domains.find((item) => String(item.id) === domainId) ?? null,
    [data, domainId],
  );
  const mappingSensor = useMemo(
    () => data?.sensors.find((item) => item.id === mappingSensorId) ?? null,
    [data, mappingSensorId],
  );

  useEffect(() => {
    if (!assessment) return;
    const unresolved = assessment.findings.find(
      (finding) =>
        !assessment.dispositions.some(
          (receipt) => receipt.findingKey === finding.findingKey,
        ),
    );
    setFindingKey(
      unresolved?.findingKey ?? assessment.findings[0]?.findingKey ?? "",
    );
  }, [assessment]);

  useEffect(() => {
    if (!domainEditId) {
      setDomainKey("");
      setDomainLabel("");
      setDomainDescription("");
      setOwnerRole("reliability_engineer");
      setOwnerUserId("");
      setStewardRole("reliability_engineer");
      return;
    }
    const domain = data?.domains.find(
      (item) => String(item.id) === domainEditId,
    );
    if (!domain) return;
    setDomainKey(domain.key);
    setDomainLabel(domain.label);
    setDomainDescription(domain.description ?? "");
    setOwnerRole(domain.ownerRole);
    setOwnerUserId(domain.ownerUserId ?? "");
    setStewardRole(domain.stewardRole ?? "");
    setDomainBasis(domain.basis ?? domainBasis);
  }, [data, domainBasis, domainEditId]);

  useEffect(() => {
    if (!mappingEditId) return;
    const mapping = data?.historianMappings.find(
      (item) => String(item.id) === mappingEditId,
    );
    if (!mapping) return;
    setMappingSensorId(mapping.sensorId ?? "");
    setHistorianTag(mapping.historianTag);
    setMeasurement(mapping.measurement ?? "");
    setUnit(mapping.unit ?? "");
    setSourceSystem(mapping.sourceSystem ?? "");
    setMappingBasis(mapping.basis ?? mappingBasis);
  }, [data, mappingBasis, mappingEditId]);

  async function act(key: string, task: () => Promise<void>, success: string) {
    setBusy(key);
    setNotice(null);
    try {
      await task();
      setNotice({ kind: "ok", text: success });
      await refetch();
    } catch (caught) {
      setNotice({
        kind: "error",
        text:
          caught instanceof Error
            ? caught.message
            : "The governed data-steward action failed.",
      });
    } finally {
      setBusy("");
    }
  }

  if (loading && !data)
    return <LoadingState label="Loading Data Steward Specialist" />;
  if (error && !data) return <ErrorState message={error} onRetry={refetch} />;

  const findings = assessment?.findings ?? [];
  const alreadyDisposed = new Set(
    assessment?.dispositions.map((item) => item.findingKey) ?? [],
  );

  return (
    <section className="overflow-hidden rounded-2xl border border-cyan-400/20 bg-[#07131a]">
      <div className="border-b border-white/8 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.12),transparent_46%)] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">
              <Bot className="h-4 w-4" aria-hidden /> Data Steward Specialist
            </div>
            <h2 className="text-xl font-semibold text-white">
              Canonical data posture to controlled human remediation
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              The specialist fingerprints the one asset hierarchy, human-coded
              failure history and governed master-data records. It proposes and
              retains evidence. It cannot merge assets, recode history, confirm
              mappings, change master data, archive records or authorize work.
            </p>
          </div>
          <div className="min-w-72">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Accountable data domain
              <select
                className={input}
                value={domainId}
                onChange={(event) => setDomainId(event.target.value)}
              >
                <option value="">Create or select a domain…</option>
                {(data?.domains ?? []).map((domain) => (
                  <option key={domain.id} value={domain.id}>
                    {domain.label} · {domain.ownerRole}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={!selectedDomain || Boolean(busy)}
              onClick={() =>
                void act(
                  "run",
                  async () => {
                    if (!selectedDomain) return;
                    const receipt = await runDataStewardAgent(
                      selectedDomain.id,
                    );
                    setAssessmentId(receipt.assessmentId);
                  },
                  "Immutable assessment created from exact source fingerprints. No master data changed.",
                )
              }
              className="mt-3 w-full rounded-lg bg-cyan-300 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-40"
            >
              {busy === "run"
                ? "Assessing canonical evidence…"
                : "Run retained assessment"}
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-5 p-5 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <div className="space-y-4">
          <details
            open
            className="rounded-xl border border-white/8 bg-black/15 p-4"
          >
            <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-white">
              <Database className="h-4 w-4 text-cyan-300" aria-hidden />{" "}
              Data-domain ownership
            </summary>
            <select
              className={input}
              value={domainEditId}
              onChange={(event) => setDomainEditId(event.target.value)}
            >
              <option value="">New canonical domain</option>
              {(data?.domains ?? []).map((domain) => (
                <option key={domain.id} value={domain.id}>
                  Edit {domain.label} · v{domain.version}
                </option>
              ))}
            </select>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <input
                className={input}
                value={domainKey}
                onChange={(e) => setDomainKey(e.target.value)}
                placeholder="domain key"
                disabled={Boolean(domainEditId)}
              />
              <input
                className={input}
                value={domainLabel}
                onChange={(e) => setDomainLabel(e.target.value)}
                placeholder="domain label"
              />
              <input
                className={input}
                value={ownerRole}
                onChange={(e) => setOwnerRole(e.target.value)}
                placeholder="accountable owner role"
              />
              <input
                className={input}
                value={stewardRole}
                onChange={(e) => setStewardRole(e.target.value)}
                placeholder="steward role"
              />
              <select
                className={input}
                value={ownerUserId}
                onChange={(e) => setOwnerUserId(e.target.value)}
              >
                <option value="">No named owner — remains a finding</option>
                {(data?.reviewers ?? []).map((reviewer) => (
                  <option key={reviewer.id} value={reviewer.id}>
                    {reviewer.name ?? reviewer.email} · {label(reviewer.role)}
                  </option>
                ))}
              </select>
            </div>
            <textarea
              className={input}
              rows={2}
              value={domainDescription}
              onChange={(e) => setDomainDescription(e.target.value)}
              placeholder="domain scope and definition"
            />
            <textarea
              className={input}
              rows={2}
              value={domainBasis}
              onChange={(e) => setDomainBasis(e.target.value)}
              placeholder="ownership evidence basis"
            />
            <button
              type="button"
              disabled={
                Boolean(busy) ||
                domainKey.trim().length < 2 ||
                domainLabel.trim().length < 2 ||
                domainBasis.trim().length < 10
              }
              onClick={() =>
                void act(
                  "domain",
                  async () => {
                    const existing = data?.domains.find(
                      (item) => String(item.id) === domainEditId,
                    );
                    const result = await upsertDataDomain({
                      domainId: existing?.id,
                      domainKey,
                      label: domainLabel,
                      description: domainDescription,
                      ownerRole,
                      ownerUserId: ownerUserId || null,
                      stewardRole,
                      basis: domainBasis,
                      expectedVersion: existing?.version,
                    });
                    setDomainId(String(result.domainId));
                    setDomainEditId(String(result.domainId));
                  },
                  "Named-human domain accountability recorded with optimistic version control.",
                )
              }
              className="mt-3 inline-flex items-center gap-2 rounded-lg border border-cyan-300/30 px-3 py-2 text-xs font-semibold text-cyan-200 disabled:opacity-40"
            >
              <Save className="h-3.5 w-3.5" aria-hidden /> Record governed
              domain
            </button>
          </details>

          <details className="rounded-xl border border-white/8 bg-black/15 p-4">
            <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-white">
              <Activity className="h-4 w-4 text-cyan-300" aria-hidden />{" "}
              Data-quality service level
            </summary>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <select
                className={input}
                value={metric}
                onChange={(e) => setMetric(e.target.value as DataQualityMetric)}
              >
                {(
                  [
                    "completeness",
                    "timeliness",
                    "validity",
                    "uniqueness",
                    "consistency",
                  ] as const
                ).map((item) => (
                  <option key={item} value={item}>
                    {label(item)}
                  </option>
                ))}
              </select>
              <input
                className={input}
                type="number"
                min="0"
                value={targetValue}
                onChange={(e) => setTargetValue(e.target.value)}
                placeholder={
                  metric === "timeliness" ? "target lag hours" : "target %"
                }
              />
              <input
                className={input}
                type="number"
                min="0"
                value={measuredValue}
                onChange={(e) => setMeasuredValue(e.target.value)}
                placeholder={
                  metric === "timeliness"
                    ? "measured lag hours (optional)"
                    : "measured % (optional)"
                }
              />
              <input
                className={input}
                type="date"
                value={measuredOn}
                onChange={(e) => setMeasuredOn(e.target.value)}
              />
              <input
                className={input}
                value={slaSource}
                onChange={(e) => setSlaSource(e.target.value)}
                placeholder="source reference"
              />
            </div>
            <textarea
              className={input}
              rows={2}
              value={slaBasis}
              onChange={(e) => setSlaBasis(e.target.value)}
            />
            <button
              type="button"
              disabled={
                !selectedDomain ||
                Boolean(busy) ||
                !targetValue ||
                slaBasis.trim().length < 10
              }
              onClick={() =>
                void act(
                  "sla",
                  async () => {
                    if (!selectedDomain) return;
                    const target = numberOrNull(targetValue);
                    const measured = numberOrNull(measuredValue);
                    await recordDataQualitySla({
                      domainId: selectedDomain.id,
                      metric,
                      targetPct: metric === "timeliness" ? null : target,
                      targetLagHours: metric === "timeliness" ? target : null,
                      measuredPct: metric === "timeliness" ? null : measured,
                      measuredLagHours:
                        metric === "timeliness" ? measured : null,
                      measuredOn: measured === null ? null : measuredOn,
                      basis: slaBasis,
                      sourceReference: slaSource,
                    });
                  },
                  "Append-only target and measurement evidence recorded. Unknown remains unknown.",
                )
              }
              className="mt-3 rounded-lg border border-cyan-300/30 px-3 py-2 text-xs font-semibold text-cyan-200 disabled:opacity-40"
            >
              Record SLA evidence
            </button>
          </details>

          <details className="rounded-xl border border-white/8 bg-black/15 p-4">
            <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-white">
              <ShieldCheck className="h-4 w-4 text-cyan-300" aria-hidden />{" "}
              Instrument calibration
            </summary>
            <select
              className={input}
              value={calibrationSensorId}
              onChange={(e) => setCalibrationSensorId(e.target.value)}
            >
              <option value="">Select a canonical sensor…</option>
              {(data?.sensors ?? []).map((sensor) => (
                <option key={sensor.id} value={sensor.id}>
                  {sensor.assetName} · {sensor.name}
                </option>
              ))}
            </select>
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                className={input}
                value={instrumentRef}
                onChange={(e) => setInstrumentRef(e.target.value)}
                placeholder="instrument reference"
              />
              <input
                className={input}
                type="date"
                value={calibratedOn}
                onChange={(e) => setCalibratedOn(e.target.value)}
              />
              <input
                className={input}
                type="number"
                min="1"
                value={intervalMonths}
                onChange={(e) => setIntervalMonths(e.target.value)}
                placeholder="interval months"
              />
              <input
                className={input}
                value={certificate}
                onChange={(e) => setCertificate(e.target.value)}
                placeholder="certificate reference"
              />
              <select
                className={input}
                value={asFound}
                onChange={(e) => setAsFound(e.target.value as "yes" | "no")}
              >
                <option value="yes">As found — within tolerance</option>
                <option value="no">As found — outside tolerance</option>
              </select>
              <select
                className={input}
                value={asLeft}
                onChange={(e) => setAsLeft(e.target.value as "yes" | "no")}
              >
                <option value="yes">As left — within tolerance</option>
                <option value="no">As left — outside tolerance</option>
              </select>
            </div>
            <textarea
              className={input}
              rows={2}
              value={calibrationBasis}
              onChange={(e) => setCalibrationBasis(e.target.value)}
            />
            <button
              type="button"
              disabled={
                !calibrationSensorId ||
                Boolean(busy) ||
                instrumentRef.trim().length < 2 ||
                certificate.trim().length < 3
              }
              onClick={() =>
                void act(
                  "calibration",
                  async () => {
                    const sensor = data?.sensors.find(
                      (item) => item.id === calibrationSensorId,
                    );
                    await recordInstrumentCalibration({
                      sensorId: calibrationSensorId,
                      assetId: sensor?.assetId,
                      instrumentRef,
                      calibratedOn,
                      intervalMonths: Number(intervalMonths),
                      asFoundWithinTolerance: asFound === "yes",
                      asLeftWithinTolerance: asLeft === "yes",
                      certificateReference: certificate,
                      basis: calibrationBasis,
                    });
                  },
                  "Append-only as-found/as-left calibration evidence recorded.",
                )
              }
              className="mt-3 rounded-lg border border-cyan-300/30 px-3 py-2 text-xs font-semibold text-cyan-200 disabled:opacity-40"
            >
              Record calibration evidence
            </button>
          </details>

          <details className="rounded-xl border border-white/8 bg-black/15 p-4">
            <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-white">
              <Database className="h-4 w-4 text-cyan-300" aria-hidden />{" "}
              Historian-context mapping
            </summary>
            <select
              className={input}
              value={mappingEditId}
              onChange={(e) => setMappingEditId(e.target.value)}
            >
              <option value="">New mapping confirmation</option>
              {(data?.historianMappings ?? []).map((mapping) => (
                <option key={mapping.id} value={mapping.id}>
                  Edit {mapping.historianTag} · v{mapping.version}
                </option>
              ))}
            </select>
            <select
              className={input}
              value={mappingSensorId}
              onChange={(e) => setMappingSensorId(e.target.value)}
            >
              <option value="">Select a canonical sensor…</option>
              {(data?.sensors ?? []).map((sensor) => (
                <option key={sensor.id} value={sensor.id}>
                  {sensor.assetName} · {sensor.name}
                </option>
              ))}
            </select>
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                className={input}
                value={historianTag}
                onChange={(e) => setHistorianTag(e.target.value)}
                placeholder="historian tag"
              />
              <input
                className={input}
                value={measurement}
                onChange={(e) => setMeasurement(e.target.value)}
                placeholder="measurement"
              />
              <input
                className={input}
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder="engineering unit"
              />
              <input
                className={input}
                value={sourceSystem}
                onChange={(e) => setSourceSystem(e.target.value)}
                placeholder="source system"
              />
            </div>
            <textarea
              className={input}
              rows={2}
              value={mappingBasis}
              onChange={(e) => setMappingBasis(e.target.value)}
            />
            <button
              type="button"
              disabled={
                !mappingSensor ||
                Boolean(busy) ||
                historianTag.trim().length < 2 ||
                measurement.trim().length < 2 ||
                !unit ||
                sourceSystem.trim().length < 2
              }
              onClick={() =>
                void act(
                  "mapping",
                  async () => {
                    const existing = data?.historianMappings.find(
                      (item) => String(item.id) === mappingEditId,
                    );
                    await confirmHistorianTagMapping({
                      mappingId: existing?.id,
                      historianTag,
                      assetId: mappingSensor?.assetId,
                      sensorId: mappingSensor?.id,
                      measurement,
                      unit,
                      sourceSystem,
                      basis: mappingBasis,
                      expectedVersion: existing?.version,
                    });
                  },
                  "Named-human mapping confirmation recorded with optimistic version control.",
                )
              }
              className="mt-3 rounded-lg border border-cyan-300/30 px-3 py-2 text-xs font-semibold text-cyan-200 disabled:opacity-40"
            >
              Confirm canonical mapping
            </button>
          </details>

          <details className="rounded-xl border border-white/8 bg-black/15 p-4">
            <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-white">
              <Archive className="h-4 w-4 text-cyan-300" aria-hidden /> Archive
              and obsolescence register
            </summary>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <input
                className={input}
                value={recordClass}
                onChange={(e) => setRecordClass(e.target.value)}
                placeholder="record class"
              />
              <input
                className={input}
                value={archiveReference}
                onChange={(e) => setArchiveReference(e.target.value)}
                placeholder="record reference"
              />
              <select
                className={input}
                value={archiveDisposition}
                onChange={(e) =>
                  setArchiveDisposition(
                    e.target.value as typeof archiveDisposition,
                  )
                }
              >
                <option value="archived">Archived</option>
                <option value="superseded">Superseded</option>
                <option value="obsolete">Obsolete</option>
                <option value="destroyed">Destroyed</option>
              </select>
              <input
                className={input}
                value={supersededBy}
                onChange={(e) => setSupersededBy(e.target.value)}
                placeholder="superseded by (when applicable)"
              />
              <input
                className={input}
                type="date"
                value={retentionUntil}
                onChange={(e) => setRetentionUntil(e.target.value)}
              />
              <input
                className={input}
                value={archiveEvidence}
                onChange={(e) => setArchiveEvidence(e.target.value)}
                placeholder="evidence reference"
              />
            </div>
            <textarea
              className={input}
              rows={2}
              value={archiveReason}
              onChange={(e) => setArchiveReason(e.target.value)}
              placeholder="disposition reason"
            />
            <button
              type="button"
              disabled={
                Boolean(busy) ||
                recordClass.trim().length < 2 ||
                archiveReference.trim().length < 2 ||
                archiveReason.trim().length < 10 ||
                archiveEvidence.trim().length < 3
              }
              onClick={() =>
                void act(
                  "archive",
                  async () => {
                    await recordArchiveDisposition({
                      recordClass,
                      reference: archiveReference,
                      archivedOn: today,
                      disposition: archiveDisposition,
                      supersededBy: supersededBy || null,
                      retentionUntil: retentionUntil || null,
                      reason: archiveReason,
                      evidenceReference: archiveEvidence,
                    });
                  },
                  "Append-only archive disposition and evidence reference recorded.",
                )
              }
              className="mt-3 rounded-lg border border-cyan-300/30 px-3 py-2 text-xs font-semibold text-cyan-200 disabled:opacity-40"
            >
              Record archive disposition
            </button>
          </details>
        </div>

        <div className="space-y-4">
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
            Retained assessment
            <select
              className={input}
              value={assessmentId}
              onChange={(e) => setAssessmentId(e.target.value)}
            >
              <option value="">No assessment selected</option>
              {(data?.assessments ?? []).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.domainLabel} · {item.findings.length} findings
                </option>
              ))}
            </select>
          </label>

          {assessment ? (
            <div className="rounded-xl border border-cyan-300/15 bg-cyan-300/[0.03] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold text-white">
                  {assessment.domainLabel}
                </p>
                <span className="font-mono text-[11px] text-slate-500">
                  {new Date(assessment.createdAt).toLocaleString()}
                </span>
              </div>
              <ul className="mt-3 space-y-2">
                {assessment.findings.map((finding) => (
                  <li
                    key={finding.findingKey}
                    className="rounded-lg border border-white/8 p-3 text-xs"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium text-white">
                        {label(finding.findingKey)}
                      </span>
                      <span
                        className={
                          finding.severity === "critical" ||
                          finding.severity === "high"
                            ? "text-amber-200"
                            : "text-slate-400"
                        }
                      >
                        {finding.severity}
                      </span>
                    </div>
                    <p className="mt-1 leading-5 text-slate-300">
                      {finding.observed}
                    </p>
                    <p className="mt-1 leading-5 text-slate-500">
                      Expected: {finding.expected}
                    </p>
                    <p className="mt-1 text-cyan-300">
                      Human route: {finding.route}
                    </p>
                    {alreadyDisposed.has(finding.findingKey) ? (
                      <p className="mt-1 text-emerald-300">
                        Independent disposition recorded
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
              <details className="mt-3 text-xs text-slate-500">
                <summary className="cursor-pointer">
                  Evidence limitations and population fingerprints
                </summary>
                <ul className="mt-2 space-y-1">
                  {assessment.limitations.map((item) => (
                    <li key={item}>• {item}</li>
                  ))}
                </ul>
                <pre className="mt-2 max-h-48 overflow-auto rounded bg-black/25 p-2">
                  {JSON.stringify(assessment.sourceSnapshot, null, 2)}
                </pre>
              </details>
            </div>
          ) : (
            <p className="rounded-xl border border-white/6 p-4 text-sm text-slate-500">
              Create a governed domain, then run the specialist. Missing records
              remain explicit gaps; they are never replaced by assumed
              completeness.
            </p>
          )}

          <div className="grid gap-4 rounded-xl border border-white/8 bg-black/15 p-4 lg:grid-cols-2">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
                <ClipboardCheck className="h-4 w-4 text-cyan-300" aria-hidden />{" "}
                Assign independent review
              </h3>
              <select
                className={input}
                value={reviewerId}
                onChange={(e) => setReviewerId(e.target.value)}
              >
                <option value="">Named reviewer…</option>
                {(data?.reviewers ?? []).map((reviewer) => (
                  <option key={reviewer.id} value={reviewer.id}>
                    {reviewer.name ?? reviewer.email} · {label(reviewer.role)}
                  </option>
                ))}
              </select>
              <input
                className={input}
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
              <textarea
                className={input}
                rows={3}
                value={reviewNote}
                onChange={(e) => setReviewNote(e.target.value)}
              />
              <button
                type="button"
                disabled={!assessment || !reviewerId || Boolean(busy)}
                onClick={() =>
                  void act(
                    "assign",
                    async () => {
                      if (!assessment) return;
                      await assignDataStewardReview({
                        assessmentId: assessment.id,
                        assignedTo: reviewerId,
                        dueDate,
                        note: reviewNote,
                      });
                    },
                    "Independent named-human review assigned. No master data changed.",
                  )
                }
                className="mt-3 rounded-lg border border-cyan-300/30 px-3 py-2 text-xs font-semibold text-cyan-200 disabled:opacity-40"
              >
                Assign review
              </button>
            </div>
            <div>
              <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
                <ShieldCheck className="h-4 w-4 text-emerald-300" aria-hidden />{" "}
                Review finding
              </h3>
              <select
                className={input}
                value={findingKey}
                onChange={(e) => setFindingKey(e.target.value)}
              >
                <option value="">Finding…</option>
                {findings.map((finding) => (
                  <option key={finding.findingKey} value={finding.findingKey}>
                    {label(finding.findingKey)}
                  </option>
                ))}
              </select>
              <select
                className={input}
                value={disposition}
                onChange={(e) =>
                  setDisposition(e.target.value as typeof disposition)
                }
              >
                <option value="accepted">Accept finding</option>
                <option value="remediated">Remediated with evidence</option>
                <option value="deferred">Defer with basis</option>
                <option value="rejected">Reject with basis</option>
              </select>
              <textarea
                className={input}
                rows={3}
                value={dispositionNote}
                onChange={(e) => setDispositionNote(e.target.value)}
              />
              <input
                className={input}
                value={dispositionEvidence}
                onChange={(e) => setDispositionEvidence(e.target.value)}
                placeholder="stable evidence reference (required for remediated)"
              />
              <button
                type="button"
                disabled={
                  !assessment ||
                  !findingKey ||
                  Boolean(busy) ||
                  dispositionNote.trim().length < 20 ||
                  (disposition === "remediated" &&
                    dispositionEvidence.trim().length < 3)
                }
                onClick={() =>
                  void act(
                    "disposition",
                    async () => {
                      if (!assessment) return;
                      await recordDataStewardDisposition({
                        assessmentId: assessment.id,
                        findingKey,
                        disposition,
                        note: dispositionNote,
                        evidenceReference: dispositionEvidence || null,
                      });
                    },
                    "Independent immutable disposition recorded. Master-data action remains separate.",
                  )
                }
                className="mt-3 rounded-lg bg-emerald-300 px-3 py-2 text-xs font-semibold text-slate-950 disabled:opacity-40"
              >
                Record governed disposition
              </button>
            </div>
          </div>

          {notice ? (
            <p
              className={`rounded-lg border p-3 text-xs ${notice.kind === "ok" ? "border-emerald-400/25 bg-emerald-400/5 text-emerald-200" : "border-red-400/25 bg-red-400/5 text-red-200"}`}
            >
              {notice.text}
            </p>
          ) : null}
          <p className="text-xs leading-5 text-slate-500">{data?.basis}</p>
        </div>
      </div>
    </section>
  );
}
