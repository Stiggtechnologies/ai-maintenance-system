import { supabase } from "../lib/supabase";

async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  if ((data as { error?: string } | null)?.error) {
    throw new Error(String((data as { error: unknown }).error));
  }
  return data as Record<string, unknown>;
}

export const sapS4WriteActions = {
  setEnabled: (enabled: boolean, basis: string) =>
    rpc("set_sap_s4_write_enabled", { p_enabled: enabled, p_basis: basis }),

  configure: (args: {
    key: string;
    name: string;
    serviceRoot: string;
    credentialRef: string;
    enabled: boolean;
    basis: string;
  }) =>
    rpc("configure_sap_s4_write_source", {
      p_key: args.key,
      p_name: args.name,
      p_service_root: args.serviceRoot,
      p_credential_binding_ref: args.credentialRef,
      p_enabled: args.enabled,
      p_basis: args.basis,
    }),

  propose: (args: {
    connectorKey: string;
    operation: string;
    payload: Record<string, string>;
    idempotencyKey: string;
    basis: string;
  }) =>
    rpc("propose_sap_s4_write", {
      p_connector_key: args.connectorKey,
      p_operation: args.operation,
      p_payload: args.payload,
      p_idempotency_key: args.idempotencyKey,
      p_basis: args.basis,
    }),

  decide: (
    requestId: string,
    decision: "approved" | "rejected",
    note: string,
  ) =>
    rpc("decide_sap_s4_write", {
      p_request_id: requestId,
      p_decision: decision,
      p_note: note,
    }),

  workspace: () => rpc("get_sap_s4_write_workspace", {}),

  execute: async (requestId: string) => {
    const { data, error } = await supabase.functions.invoke(
      "sap-s4-write-execute",
      { body: { request_id: requestId } },
    );
    if (error) throw new Error(error.message);
    if ((data as { error?: string } | null)?.error) {
      throw new Error(String((data as { error: unknown }).error));
    }
    return data as Record<string, unknown>;
  },
};
