/**
 * Field reports service — the field surface reads the organization's
 * maintenance notifications (org-scoped via RLS). Filed reports carry their
 * notification type, status, and the asset they were observed on.
 */
import { supabase } from "../lib/supabase";

export interface FieldReport {
  id: string;
  description: string;
  notification_type: string;
  status: string;
  reported_by: string;
  created_at: string;
  asset_id: string | null;
  asset_tag: string | null;
  asset_name: string | null;
}

export async function listRecentFieldReports(limit = 20): Promise<FieldReport[]> {
  const { data, error } = await supabase
    .from("maintenance_notifications")
    .select(
      "id, description, notification_type, status, reported_by, created_at, asset_id, assets(asset_tag, name)",
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: String(row.id),
    description: String(row.description ?? ""),
    notification_type: String(row.notification_type ?? ""),
    status: String(row.status ?? ""),
    reported_by: String(row.reported_by ?? ""),
    created_at: String(row.created_at ?? ""),
    asset_id: (row.asset_id as string) ?? null,
    asset_tag: (row.assets as { asset_tag?: string } | null)?.asset_tag ?? null,
    asset_name: (row.assets as { name?: string } | null)?.name ?? null,
  }));
}
