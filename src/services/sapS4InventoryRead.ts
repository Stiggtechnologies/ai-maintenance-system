import { supabase } from "../lib/supabase";

async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  if ((data as { error?: string } | null)?.error) {
    throw new Error(String((data as { error: unknown }).error));
  }
  return data as Record<string, unknown>;
}

export const sapS4InventoryReadActions = {
  configure: (args: {
    key: string;
    name: string;
    serviceRoot: string;
    plant: string;
    storageLocation: string;
    siteId: string;
    maxRows: number;
    pageSize: number;
    maxPages: number;
    interval: number;
    credentialRef: string;
    enabled: boolean;
    basis: string;
  }) =>
    rpc("configure_sap_s4_inventory_source", {
      p_key: args.key,
      p_name: args.name,
      p_service_root: args.serviceRoot,
      p_plant: args.plant,
      p_storage_location: args.storageLocation,
      p_site_id: args.siteId,
      p_max_rows: args.maxRows,
      p_page_size: args.pageSize,
      p_max_pages: args.maxPages,
      p_expected_interval_minutes: args.interval,
      p_credential_binding_ref: args.credentialRef,
      p_enabled: args.enabled,
      p_basis: args.basis,
    }),

  pull: async (key: string, dryRun: boolean) => {
    const { data, error } = await supabase.functions.invoke(
      "sap-s4-inventory-read-pull",
      { body: { connector_key: key, dry_run: dryRun } },
    );
    if (error) throw new Error(error.message);
    if ((data as { error?: string } | null)?.error) {
      throw new Error(String((data as { error: unknown }).error));
    }
    return data as Record<string, unknown>;
  },
};
