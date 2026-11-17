import { supabase } from "../lib/supabase";
import { uploadSyncAttachment, type SyncAttachment } from "./syncConversation";

export const RECOVERY_FIELD_EVIDENCE_KINDS = [
  "note",
  "photo",
  "video",
  "voice",
  "document",
  "measurement",
  "checklist",
  "scan",
  "signature",
  "location",
  "drawing",
] as const;

export type RecoveryFieldEvidenceKind =
  (typeof RECOVERY_FIELD_EVIDENCE_KINDS)[number];

export const RECOVERY_ATTACHMENT_KINDS = new Set<RecoveryFieldEvidenceKind>([
  "photo",
  "video",
  "voice",
  "document",
  "signature",
  "drawing",
]);

export const RECOVERY_FIELD_EVIDENCE_LABELS: Record<
  RecoveryFieldEvidenceKind,
  string
> = {
  note: "Text note",
  photo: "Photo / image",
  video: "Video clip",
  voice: "Voice / audio",
  document: "Document / file",
  measurement: "Measurement",
  checklist: "Checklist observations",
  scan: "Barcode / QR / RFID / NFC",
  signature: "Signature / attestation",
  location: "Location / GPS",
  drawing: "Drawing / markup",
};

export function recoveryEvidenceAccept(
  kind: RecoveryFieldEvidenceKind,
): string | undefined {
  switch (kind) {
    case "photo":
      return "image/*";
    case "video":
      return "video/*";
    case "voice":
      return "audio/*";
    case "signature":
    case "drawing":
      return "image/*,application/pdf";
    case "document":
      return ".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.rtf,.ppt,.pptx,application/pdf,text/*";
    default:
      return undefined;
  }
}

export function validateRecoveryEvidenceFile(
  kind: RecoveryFieldEvidenceKind,
  file: Pick<File, "type"> | null,
): string | null {
  if (!RECOVERY_ATTACHMENT_KINDS.has(kind)) return null;
  if (!file) return `${RECOVERY_FIELD_EVIDENCE_LABELS[kind]} requires a file.`;
  const mime = file.type.toLowerCase();
  if (kind === "photo" && !mime.startsWith("image/"))
    return "Photo evidence requires an image file.";
  if (kind === "video" && !mime.startsWith("video/"))
    return "Video evidence requires a video file.";
  if (kind === "voice" && !mime.startsWith("audio/"))
    return "Voice evidence requires an audio file.";
  if (
    (kind === "signature" || kind === "drawing") &&
    !mime.startsWith("image/") &&
    mime !== "application/pdf"
  )
    return `${RECOVERY_FIELD_EVIDENCE_LABELS[kind]} requires an image or PDF file.`;
  return null;
}

export async function uploadRecoveryFieldAttachment(
  eventId: string,
  file: File,
): Promise<SyncAttachment> {
  const { data, error } = await supabase.rpc(
    "get_or_create_recovery_evidence_workspace",
    { p_event_id: eventId },
  );
  if (error) throw error;
  const workspaceId = typeof data === "string" ? data : "";
  if (!workspaceId) {
    throw new Error("Recovery evidence upload context was not created.");
  }
  return uploadSyncAttachment(workspaceId, file);
}

export type RecoveryEvidenceMetadataInput = {
  measurementValue?: string;
  measurementUnit?: string;
  instrument?: string;
  checklistText?: string;
  scanCode?: string;
  scanSymbology?: string;
  latitude?: string;
  longitude?: string;
  accuracyMetres?: string;
  locationSource?: "device_geolocation" | "manual";
};

export function buildRecoveryEvidenceMetadata(
  kind: RecoveryFieldEvidenceKind,
  input: RecoveryEvidenceMetadataInput,
): Record<string, unknown> {
  if (kind === "measurement") {
    return {
      value: input.measurementValue?.trim() ?? "",
      unit: input.measurementUnit?.trim() ?? "",
      instrument: input.instrument?.trim() || null,
      capture_method: "human_field_entry",
    };
  }
  if (kind === "checklist") {
    return {
      items: (input.checklistText ?? "")
        .split(/\r?\n/)
        .map((observation) => observation.trim())
        .filter(Boolean)
        .map((observation) => ({ observation })),
      capture_method: "human_checklist_entry",
    };
  }
  if (kind === "scan") {
    return {
      code: input.scanCode?.trim() ?? "",
      symbology: input.scanSymbology?.trim() || "unspecified",
      capture_method: "human_or_device_scan",
    };
  }
  if (kind === "location") {
    const latitude = Number(input.latitude);
    const longitude = Number(input.longitude);
    const accuracy = Number(input.accuracyMetres);
    return {
      latitude: Number.isFinite(latitude) ? latitude : null,
      longitude: Number.isFinite(longitude) ? longitude : null,
      accuracy_m: Number.isFinite(accuracy) && accuracy >= 0 ? accuracy : null,
      capture_method: input.locationSource ?? "manual",
    };
  }
  if (kind === "signature") {
    return {
      capture_method: "uploaded_attestation",
      authority_boundary: "evidence_only_not_approval_or_release",
    };
  }
  return {};
}

export function validateRecoveryEvidenceMetadata(
  kind: RecoveryFieldEvidenceKind,
  metadata: Record<string, unknown>,
): string | null {
  if (kind === "measurement") {
    if (
      !String(metadata.value ?? "").trim() ||
      !String(metadata.unit ?? "").trim()
    )
      return "Measurement requires an observed value and unit.";
  }
  if (kind === "checklist") {
    if (!Array.isArray(metadata.items) || metadata.items.length === 0)
      return "Checklist evidence requires at least one observation.";
  }
  if (kind === "scan" && !String(metadata.code ?? "").trim())
    return "Scan evidence requires the observed identifier.";
  if (kind === "location") {
    const latitude = metadata.latitude;
    const longitude = metadata.longitude;
    if (
      typeof latitude !== "number" ||
      typeof longitude !== "number" ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    )
      return "Location requires valid latitude and longitude.";
  }
  return null;
}
