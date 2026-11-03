import { supabase } from "../lib/supabase";
import { SAP_MAINTENANCE_ORDER_STATUSES } from "../../supabase/functions/_shared/sap-s4-maintenance-order-read";

export interface SapMaintenancePhaseMapping {
  phaseCode: string;
  status: string;
}

export function parseSapMaintenancePhaseMap(
  value: string,
): SapMaintenancePhaseMapping[] {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length > 20) {
    throw new Error("Provide at most 20 phase mappings.");
  }
  const seen = new Set<string>();
  return lines.map((line, index) => {
    const parts = line.split("|").map((part) => part.trim());
    if (parts.length !== 2 || parts.some((part) => !part)) {
      throw new Error(
        `Phase line ${index + 1} must be: MaintOrdProcessPhaseCode | canonical status.`,
      );
    }
    const [phaseCode, status] = parts;
    if (!/^[A-Za-z0-9]{1,2}$/.test(phaseCode)) {
      throw new Error(`Phase line ${index + 1} code must be 1-2 characters.`);
    }
    if (
      !SAP_MAINTENANCE_ORDER_STATUSES.includes(
        status as (typeof SAP_MAINTENANCE_ORDER_STATUSES)[number],
      )
    ) {
      throw new Error(
        `Phase line ${index + 1} status must be one of ${SAP_MAINTENANCE_ORDER_STATUSES.join(", ")}.`,
      );
    }
    if (seen.has(phaseCode)) {
      throw new Error(`Phase line ${index + 1} repeats ${phaseCode}.`);
    }
    seen.add(phaseCode);
    return { phaseCode, status };
  });
}

async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  if ((data as { error?: string } | null)?.error) {
    throw new Error(String((data as { error: unknown }).error));
  }
  return data as Record<string, unknown>;
}

export const sapS4MaintenanceOrderReadActions = {
  configure: (args: {
    key: string;
    name: string;
    serviceRoot: string;
    planningPlant: string;
    siteId: string;
    phaseMap: SapMaintenancePhaseMapping[];
    maxRows: number;
    pageSize: number;
    maxPages: number;
    interval: number;
    credentialRef: string;
    enabled: boolean;
    basis: string;
  }) =>
    rpc("configure_sap_s4_maintenance_order_source", {
      p_key: args.key,
      p_name: args.name,
      p_service_root: args.serviceRoot,
      p_planning_plant: args.planningPlant,
      p_site_id: args.siteId,
      p_phase_map: args.phaseMap,
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
      "sap-s4-maintenance-order-read-pull",
      { body: { connector_key: key, dry_run: dryRun } },
    );
    if (error) throw new Error(error.message);
    if ((data as { error?: string } | null)?.error) {
      throw new Error(String((data as { error: unknown }).error));
    }
    return data as Record<string, unknown>;
  },
};
