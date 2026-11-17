import { supabase } from "../lib/supabase";

export interface AzureIotRunSummary {
  run_id: string;
  delivery_id: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  read: number;
  accepted: number;
  duplicate: number;
  rejected: number;
}

export interface AzureIotOperationsStatus {
  configured: boolean;
  enabled: boolean;
  live: boolean;
  connector_key?: string;
  name?: string;
  endpoint_hint?: string;
  direction?: string;
  write_enabled?: boolean;
  ingress_key_id?: string;
  context_health_state?: string;
  context_health_detail?: string;
  last_success_at?: string | null;
  confirmed_tag_mappings: number;
  unconfirmed_tag_mappings: number;
  recent_runs: AzureIotRunSummary[];
  basis: string;
}

interface RpcResult {
  error?: string;
  [key: string]: unknown;
}

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  const result = data as RpcResult | null;
  if (result?.error) throw new Error(result.error);
  return data as T;
}

export const azureIotOperationsActions = {
  status: () =>
    rpc<AzureIotOperationsStatus>("get_azure_iot_operations_status", {}),

  configure: (input: {
    key: string;
    name: string;
    eventHubsNamespace: string;
    eventHubName: string;
    expectedIntervalMinutes: number;
    ingressKeyId: string;
    credentialBindingRef: string;
    contextPurpose: string;
    rightsReference: string;
    enabled: boolean;
    basis: string;
  }) =>
    rpc<RpcResult>("configure_azure_iot_operations_source", {
      p_key: input.key,
      p_name: input.name,
      p_event_hubs_namespace: input.eventHubsNamespace,
      p_event_hub_name: input.eventHubName,
      p_expected_interval_minutes: input.expectedIntervalMinutes,
      p_ingress_key_id: input.ingressKeyId,
      p_credential_binding_ref: input.credentialBindingRef,
      p_context_purpose: input.contextPurpose,
      p_rights_reference: input.rightsReference,
      p_enabled: input.enabled,
      p_basis: input.basis,
    }),
};
