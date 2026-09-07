import { supabase } from "../lib/supabase";

async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  if ((data as { error?: string } | null)?.error) throw new Error((data as { error: string }).error);
  return data as Record<string, unknown>;
}

export const cmmsReadActions = {
  configure: (args: { key: string; name: string; systemKind: string; endpointUrl: string; interval: number; credentialRef: string; enabled: boolean; basis: string }) => rpc("configure_cmms_read_source", { p_key: args.key, p_name: args.name, p_system_kind: args.systemKind, p_endpoint_url: args.endpointUrl || null, p_expected_interval_minutes: args.interval, p_credential_binding_ref: args.credentialRef || null, p_enabled: args.enabled, p_basis: args.basis }),
  map: (key: string, path: string, approve: boolean, basis: string) => rpc("save_cmms_work_order_mapping", { p_connector_key: key, p_source_array_path: path, p_column_mapping: { external_id: "external_id", title: "title", asset_external_id: "asset_external_id", wo_number: "wo_number", status: "status", priority: "priority", work_type: "work_type", planned_hours: "planned_hours", created_at: "created_at", completed_at: "completed_at", failure_mode: "failure_mode", downtime_hours: "downtime_hours" }, p_approve: approve, p_basis: basis }),
  pull: async (key: string, dryRun: boolean) => { const { data, error } = await supabase.functions.invoke("cmms-read-pull", { body: { connector_key: key, dry_run: dryRun } }); if (error) throw new Error(error.message); if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error); return data as Record<string, unknown>; },
};
