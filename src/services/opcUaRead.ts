import { supabase } from "../lib/supabase";

async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  if ((data as { error?: string } | null)?.error) {
    throw new Error(String((data as { error: unknown }).error));
  }
  return data as Record<string, unknown>;
}

export const opcUaReadActions = {
  configure: (args: {
    key: string;
    name: string;
    endpointUrl: string;
    securityMode: string;
    securityPolicy: string;
    authMode: string;
    nodeIds: string[];
    interval: number;
    credentialRef: string;
    enabled: boolean;
    basis: string;
  }) =>
    rpc("configure_opc_ua_read_source", {
      p_key: args.key,
      p_name: args.name,
      p_endpoint_url: args.endpointUrl,
      p_security_mode: args.securityMode,
      p_security_policy: args.securityPolicy,
      p_auth_mode: args.authMode,
      p_node_ids: args.nodeIds,
      p_expected_interval_minutes: args.interval,
      p_credential_binding_ref: args.credentialRef,
      p_enabled: args.enabled,
      p_basis: args.basis,
    }),

  pull: async (key: string, dryRun: boolean) => {
    const { data, error } = await supabase.functions.invoke(
      "opc-ua-read-pull",
      {
        body: { connector_key: key, dry_run: dryRun },
      },
    );
    if (error) throw new Error(error.message);
    if ((data as { error?: string } | null)?.error) {
      throw new Error(String((data as { error: unknown }).error));
    }
    return data as Record<string, unknown>;
  },
};
