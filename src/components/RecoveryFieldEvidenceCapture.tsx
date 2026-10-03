import { useMemo, useState } from "react";
import { LocateFixed, Paperclip } from "lucide-react";
import { SYNC_ATTACHMENT_MAX_BYTES } from "../lib/sync/attachments";
import {
  buildRecoveryEvidenceMetadata,
  RECOVERY_ATTACHMENT_KINDS,
  RECOVERY_FIELD_EVIDENCE_KINDS,
  RECOVERY_FIELD_EVIDENCE_LABELS,
  recoveryEvidenceAccept,
  uploadRecoveryFieldAttachment,
  validateRecoveryEvidenceFile,
  validateRecoveryEvidenceMetadata,
  type RecoveryFieldEvidenceKind,
} from "../services/recoveryFieldEvidence";
import { recoveryActions } from "../services/syncRecoveryService";

type Props = {
  eventId: string;
  eventWorkId: string;
  disabled: boolean;
  onSaved: () => Promise<void>;
};

const inputClass =
  "w-full rounded-lg border border-industrial-border bg-industrial-slate px-3 py-2 text-sm text-industrial-text outline-none focus:border-teal-500";

export function RecoveryFieldEvidenceCapture({
  eventId,
  eventWorkId,
  disabled,
  onSaved,
}: Props) {
  const [kind, setKind] = useState<RecoveryFieldEvidenceKind>("note");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [measurementValue, setMeasurementValue] = useState("");
  const [measurementUnit, setMeasurementUnit] = useState("");
  const [instrument, setInstrument] = useState("");
  const [checklistText, setChecklistText] = useState("");
  const [scanCode, setScanCode] = useState("");
  const [scanSymbology, setScanSymbology] = useState("qr");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [accuracyMetres, setAccuracyMetres] = useState("");
  const [locationSource, setLocationSource] = useState<
    "device_geolocation" | "manual"
  >("manual");
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const metadata = useMemo(
    () =>
      buildRecoveryEvidenceMetadata(kind, {
        measurementValue,
        measurementUnit,
        instrument,
        checklistText,
        scanCode,
        scanSymbology,
        latitude,
        longitude,
        accuracyMetres,
        locationSource,
      }),
    [
      accuracyMetres,
      checklistText,
      instrument,
      kind,
      latitude,
      locationSource,
      longitude,
      measurementUnit,
      measurementValue,
      scanCode,
      scanSymbology,
    ],
  );

  const validation = !eventWorkId
    ? "Select event work before recording field evidence."
    : note.trim().length < 3
      ? "Describe what was observed."
      : (validateRecoveryEvidenceFile(kind, file) ??
        validateRecoveryEvidenceMetadata(kind, metadata));

  function reset() {
    setNote("");
    setFile(null);
    setMeasurementValue("");
    setMeasurementUnit("");
    setInstrument("");
    setChecklistText("");
    setScanCode("");
    setLatitude("");
    setLongitude("");
    setAccuracyMetres("");
    setLocationSource("manual");
  }

  function useDeviceLocation() {
    setError(null);
    if (!navigator.geolocation) {
      setError("This device does not expose geolocation to the browser.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLatitude(String(position.coords.latitude));
        setLongitude(String(position.coords.longitude));
        setAccuracyMetres(String(position.coords.accuracy));
        setLocationSource("device_geolocation");
        setMessage(
          "Device coordinates captured. Review them before recording; location remains evidence, not verified asset position.",
        );
      },
      (failure) => setError(`Location was not captured: ${failure.message}`),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  }

  async function save() {
    if (validation) {
      setError(validation);
      return;
    }
    setWorking(true);
    setError(null);
    setMessage(null);
    try {
      const attachment = file
        ? await uploadRecoveryFieldAttachment(eventId, file)
        : null;
      await recoveryActions.addFieldEvidence({
        eventId,
        eventWorkId,
        kind,
        note: note.trim(),
        attachmentId: attachment?.id ?? null,
        metadata,
        clientCommandId: crypto.randomUUID(),
      });
      reset();
      setMessage(
        `${RECOVERY_FIELD_EVIDENCE_LABELS[kind]} recorded with actor, event, work, source and idempotency provenance.`,
      );
      await onSaved();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="mt-5 rounded-xl border border-industrial-border bg-industrial-slate/40 p-4">
      <div className="flex items-center gap-2 font-semibold text-industrial-text">
        <Paperclip className="h-4 w-4 text-teal-400" /> Multimodal field
        evidence
      </div>
      <p className="mt-2 text-sm text-slate-400">
        Record a note, photo, video, voice clip, document, measurement,
        checklist, scan, signature, location, or drawing. Files are private,
        hashed and tenant-scoped. Nothing recorded here approves work, clears a
        safety gate, or verifies the observation.
      </p>

      {error && (
        <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
          {error}
        </div>
      )}
      {message && (
        <div className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-300">
          {message}
        </div>
      )}

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="text-xs text-slate-400">
          Input method
          <select
            aria-label="Recovery evidence input method"
            className={`${inputClass} mt-1`}
            value={kind}
            onChange={(event) => {
              setKind(event.target.value as RecoveryFieldEvidenceKind);
              setFile(null);
              setError(null);
            }}
          >
            {RECOVERY_FIELD_EVIDENCE_KINDS.map((item) => (
              <option key={item} value={item}>
                {RECOVERY_FIELD_EVIDENCE_LABELS[item]}
              </option>
            ))}
          </select>
        </label>

        {RECOVERY_ATTACHMENT_KINDS.has(kind) && (
          <label className="text-xs text-slate-400">
            Governed file · max {SYNC_ATTACHMENT_MAX_BYTES / 1024 / 1024} MB
            <input
              aria-label="Recovery evidence file"
              className={`${inputClass} mt-1 file:mr-3 file:rounded file:border-0 file:bg-teal-600 file:px-3 file:py-1 file:text-white`}
              type="file"
              accept={recoveryEvidenceAccept(kind)}
              capture={
                kind === "photo" || kind === "video"
                  ? "environment"
                  : kind === "voice"
                    ? "user"
                    : undefined
              }
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </label>
        )}
      </div>

      {kind === "measurement" && (
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <input
            aria-label="Observed measurement value"
            className={inputClass}
            placeholder="Observed value"
            value={measurementValue}
            onChange={(event) => setMeasurementValue(event.target.value)}
          />
          <input
            aria-label="Measurement unit"
            className={inputClass}
            placeholder="Unit"
            value={measurementUnit}
            onChange={(event) => setMeasurementUnit(event.target.value)}
          />
          <input
            aria-label="Measurement instrument"
            className={inputClass}
            placeholder="Instrument / source (optional)"
            value={instrument}
            onChange={(event) => setInstrument(event.target.value)}
          />
        </div>
      )}

      {kind === "checklist" && (
        <textarea
          aria-label="Checklist observations"
          className={`${inputClass} mt-3`}
          rows={4}
          placeholder="One observed checklist item per line"
          value={checklistText}
          onChange={(event) => setChecklistText(event.target.value)}
        />
      )}

      {kind === "scan" && (
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <input
            aria-label="Observed scan value"
            className={inputClass}
            placeholder="Observed code"
            value={scanCode}
            onChange={(event) => setScanCode(event.target.value)}
          />
          <select
            aria-label="Scan symbology"
            className={inputClass}
            value={scanSymbology}
            onChange={(event) => setScanSymbology(event.target.value)}
          >
            <option value="qr">QR</option>
            <option value="barcode">Barcode</option>
            <option value="data_matrix">Data Matrix</option>
            <option value="rfid_nfc">RFID / NFC</option>
            <option value="other">Other / unknown</option>
          </select>
        </div>
      )}

      {kind === "location" && (
        <div className="mt-3 grid gap-3 md:grid-cols-4">
          <input
            aria-label="Latitude"
            className={inputClass}
            inputMode="decimal"
            placeholder="Latitude"
            value={latitude}
            onChange={(event) => {
              setLatitude(event.target.value);
              setLocationSource("manual");
            }}
          />
          <input
            aria-label="Longitude"
            className={inputClass}
            inputMode="decimal"
            placeholder="Longitude"
            value={longitude}
            onChange={(event) => {
              setLongitude(event.target.value);
              setLocationSource("manual");
            }}
          />
          <input
            aria-label="Location accuracy metres"
            className={inputClass}
            inputMode="decimal"
            placeholder="Accuracy, m"
            value={accuracyMetres}
            onChange={(event) => setAccuracyMetres(event.target.value)}
          />
          <button
            type="button"
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-teal-500/30 px-3 py-2 text-sm text-teal-300"
            onClick={useDeviceLocation}
          >
            <LocateFixed className="h-4 w-4" /> Use device location
          </button>
        </div>
      )}

      {kind === "signature" && (
        <p className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-200">
          A signature or attestation is retained as evidence only. It cannot
          approve a plan, release work, clear isolation, or authorize return to
          service.
        </p>
      )}

      <textarea
        aria-label="Field evidence observation"
        className={`${inputClass} mt-3`}
        rows={3}
        placeholder="What was observed, by what method, and why it matters"
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />

      <button
        type="button"
        disabled={disabled || working || Boolean(validation)}
        onClick={() => void save()}
        className="mt-3 rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
      >
        {working ? "Recording evidence…" : "Record governed field evidence"}
      </button>
    </div>
  );
}
