/**
 * Field capture service — the E6.13 first slice.
 *
 * reportFailure(): raise the governed maintenance notification, upload the
 * camera photo into the tenant folder, and attach it as field evidence.
 * All three steps go through governed paths (definer RPCs, org-scoped
 * storage policies).
 */
import QRCode from "qrcode";
import { supabase } from "../lib/supabase";

export interface ReportFailureInput {
  assetId: string;
  description: string;
  notificationType: "fault" | "observation" | "safety" | "request";
  photo?: File;
}

export interface ReportFailureResult {
  notificationId: string;
  photoPath?: string;
}

/** The governed failure report + photo chain. */
export async function reportFailure(
  input: ReportFailureInput,
): Promise<ReportFailureResult> {
  const { data, error } = await supabase.rpc("raise_maintenance_notification", {
    p_asset_id: input.assetId,
    p_description: input.description,
    p_notification_type: input.notificationType,
  });
  if (error) throw new Error(error.message);
  const d = (data ?? {}) as { error?: string; id?: string };
  if (d.error) throw new Error(d.error);
  if (!d.id) throw new Error("notification id not returned");

  if (input.photo) {
    const path = `${input.assetId}/${d.id}/${Date.now()}-${input.photo.name.replace(/[^\w.-]/g, "_")}`;
    const { error: upErr } = await supabase.storage
      .from("failure-evidence")
      .upload(path, input.photo, {
        contentType: input.photo.type || "image/jpeg",
      });
    if (upErr) throw new Error(`photo upload failed: ${upErr.message}`);

    const { error: attachErr } = await supabase.rpc("attach_failure_photo", {
      p_notification_id: d.id,
      p_asset_id: input.assetId,
      p_storage_path: path,
    });
    if (attachErr) throw new Error(`photo attach failed: ${attachErr.message}`);
    return { notificationId: d.id, photoPath: path };
  }

  return { notificationId: d.id };
}

/** QR payload for the asset label — the phone camera opens the asset detail. */
export async function assetQrDataUrl(assetId: string): Promise<string> {
  const url = `${window.location.origin}/assets/${assetId}`;
  return QRCode.toDataURL(url, {
    width: 240,
    margin: 1,
    errorCorrectionLevel: "M",
  });
}
