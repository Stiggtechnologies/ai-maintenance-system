import { supabase } from "../lib/supabase";

export interface System1NodeBinding {
  nodeId: string;
  sensorId: string;
  unit: string;
}

export function parseSystem1NodeBindings(value: string): System1NodeBinding[] {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 1 || lines.length > 200) {
    throw new Error("Provide between 1 and 200 System 1 node bindings.");
  }
  const nodes = new Set<string>();
  const sensors = new Set<string>();
  return lines.map((line, index) => {
    const parts = line.split("|").map((part) => part.trim());
    if (parts.length !== 3 || parts.some((part) => !part)) {
      throw new Error(
        `Binding line ${index + 1} must be: System 1 OPC UA node ID | canonical sensor UUID | exact unit.`,
      );
    }
    const [nodeId, sensorId, unit] = parts;
    if (nodes.has(nodeId)) {
      throw new Error(`Binding line ${index + 1} duplicates node ${nodeId}.`);
    }
    if (sensors.has(sensorId)) {
      throw new Error(
        `Binding line ${index + 1} maps canonical sensor ${sensorId} more than once.`,
      );
    }
    nodes.add(nodeId);
    sensors.add(sensorId);
    return { nodeId, sensorId, unit };
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

export const bentlySystem1ReadActions = {
  configure: (args: {
    key: string;
    name: string;
    endpoint: string;
    credentialRef: string;
    bindings: System1NodeBinding[];
    maxRows: number;
    pageSize: number;
    maxPages: number;
    interval: number;
    enabled: boolean;
    basis: string;
  }) =>
    rpc("configure_bently_system1_source", {
      p_key: args.key,
      p_name: args.name,
      p_endpoint: args.endpoint,
      p_credential_binding_ref: args.credentialRef,
      p_node_bindings: args.bindings,
      p_max_rows: args.maxRows,
      p_page_size: args.pageSize,
      p_max_pages: args.maxPages,
      p_expected_interval_minutes: args.interval,
      p_enabled: args.enabled,
      p_basis: args.basis,
    }),

  pull: async (key: string, dryRun: boolean) => {
    const { data, error } = await supabase.functions.invoke(
      "bently-system1-condition-read-pull",
      { body: { connector_key: key, dry_run: dryRun } },
    );
    if (error) throw new Error(error.message);
    if ((data as { error?: string } | null)?.error) {
      throw new Error(String((data as { error: unknown }).error));
    }
    return data as Record<string, unknown>;
  },
};
