import { supabase } from "../lib/supabase";

async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  if ((data as { error?: string } | null)?.error) {
    throw new Error(String((data as { error: unknown }).error));
  }
  return data as Record<string, unknown>;
}

export const mqttReadActions = {
  configure: (args: {
    key: string;
    name: string;
    brokerUrl: string;
    topicFilters: string[];
    windowSeconds: number;
    maxMessages: number;
    subscribeQos: number;
    interval: number;
    credentialRef: string;
    enabled: boolean;
    basis: string;
  }) =>
    rpc("configure_mqtt_read_source", {
      p_key: args.key,
      p_name: args.name,
      p_broker_url: args.brokerUrl,
      p_topic_filters: args.topicFilters,
      p_window_seconds: args.windowSeconds,
      p_max_messages: args.maxMessages,
      p_subscribe_qos: args.subscribeQos,
      p_expected_interval_minutes: args.interval,
      p_credential_binding_ref: args.credentialRef,
      p_enabled: args.enabled,
      p_basis: args.basis,
    }),

  pull: async (key: string, dryRun: boolean) => {
    const { data, error } = await supabase.functions.invoke("mqtt-read-pull", {
      body: { connector_key: key, dry_run: dryRun },
    });
    if (error) throw new Error(error.message);
    if ((data as { error?: string } | null)?.error) {
      throw new Error(String((data as { error: unknown }).error));
    }
    return data as Record<string, unknown>;
  },
};
