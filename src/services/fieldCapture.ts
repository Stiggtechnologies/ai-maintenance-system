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
  photoWarning?: string;
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
    const warning = {
      notificationId: d.id,
      photoWarning:
        "The report was filed, but the photo was not confirmed attached. Do not file the report again.",
    };
    try {
      // Resolve the organization from the actual asset under RLS. The storage
      // policy also checks the active organization independently when uploading.
      const { data: asset, error: assetError } = await supabase
        .from("assets")
        .select("organization_id")
        .eq("id", input.assetId)
        .maybeSingle();
      if (assetError || !asset?.organization_id) return warning;

      const path = `${asset.organization_id}/${input.assetId}/${d.id}/${Date.now()}-${input.photo.name.replace(/[^\w.-]/g, "_")}`;
      const { error: uploadError } = await supabase.storage
        .from("failure-evidence")
        .upload(path, input.photo, {
          contentType: input.photo.type || "image/jpeg",
        });
      if (uploadError) return warning;

      const { data: attached, error: attachError } = await supabase.rpc(
        "attach_failure_photo",
        {
          p_notification_id: d.id,
          p_asset_id: input.assetId,
          p_storage_path: path,
        },
      );
      if (attachError || attached?.attached !== path) return warning;
      return { notificationId: d.id, photoPath: path };
    } catch {
      // The notification already committed. A network or photo failure must not
      // be presented as a failed filing, which would invite a duplicate report.
      return warning;
    }
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
