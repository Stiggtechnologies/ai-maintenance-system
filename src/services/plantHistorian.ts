import { supabase } from "../lib/supabase";
import type { PlantHistorianStatus } from "../lib/plant-historian";

interface RpcResult {
  error?: string;
  ok?: boolean;
  note?: string;
  [key: string]: unknown;
}

async function call<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  const payload = data as RpcResult | null;
  if (payload?.error) throw new Error(payload.error);
  return data as T;
}

export const plantHistorianActions = {
  status: () => call<PlantHistorianStatus>("get_plant_historian_status", {}),

  configureSource: (args: {
    key: string;
    name: string;
    systemKind: "historian" | "condition_monitoring";
    endpointUrl?: string | null;
    expectedIntervalMinutes?: number | null;
    credentialBindingRef?: string | null;
    enabled: boolean;
    basis: string;
  }) =>
    call<RpcResult>("configure_plant_historian_source", {
      p_key: args.key,
      p_name: args.name,
      p_system_kind: args.systemKind,
      p_endpoint_url: args.endpointUrl ?? null,
      p_expected_interval_minutes: args.expectedIntervalMinutes ?? null,
      p_credential_binding_ref: args.credentialBindingRef ?? null,
      p_enabled: args.enabled,
      p_basis: args.basis,
    }),

  saveMapping: (args: {
    connectorKey: string;
    sourceArrayPath: string;
    columnMapping: Record<string, string>;
    approve: boolean;
    basis: string;
  }) =>
    call<RpcResult>("save_plant_historian_mapping", {
      p_connector_key: args.connectorKey,
      p_source_array_path: args.sourceArrayPath,
      p_column_mapping: args.columnMapping,
      p_value_mappings: {},
      p_constants: {},
      p_approve: args.approve,
      p_basis: args.basis,
    }),

  attachEvidence: (recommendationId: string) =>
    call<RpcResult>("attach_plant_historian_evidence", {
      p_recommendation_id: recommendationId,
    }),

  pull: async (
    connectorKey: string,
    dryRun: boolean,
  ): Promise<RpcResult> => {
    const { data, error } = await supabase.functions.invoke(
      "plant-historian-pull",
      {
        body: { connector_key: connectorKey, dry_run: dryRun },
      },
    );
    if (error) throw new Error(error.message);
    const payload = data as RpcResult;
    if (payload?.error) throw new Error(payload.error);
    return payload;
  },
};
