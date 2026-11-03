import { supabase } from "../lib/supabase";

export interface SapApmIndicatorBinding {
  characteristicsInternalId: string;
  positionId: string;
  categoryName: string;
  technicalObjectType: string;
  sensorId: string;
}

const TOKEN = /^[A-Za-z0-9._:-]{1,80}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseSapApmIndicatorBindings(
  value: string,
): SapApmIndicatorBinding[] {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 1 || lines.length > 40) {
    throw new Error("Provide between 1 and 40 indicator bindings.");
  }
  const seen = new Set<string>();
  return lines.map((line, index) => {
    const parts = line.split("|").map((part) => part.trim());
    if (parts.length !== 5 || parts.some((part) => !part)) {
      throw new Error(
        `Binding line ${index + 1} must be: characteristic | position | category | technical object type | sensor id.`,
      );
    }
    const [
      characteristicsInternalId,
      positionId,
      categoryName,
      technicalObjectType,
      sensorId,
    ] = parts;
    if (
      !TOKEN.test(characteristicsInternalId) ||
      !TOKEN.test(positionId) ||
      !TOKEN.test(categoryName) ||
      !TOKEN.test(technicalObjectType) ||
      !UUID.test(sensorId)
    ) {
      throw new Error(`Binding line ${index + 1} contains an invalid token.`);
    }
    const key = `${technicalObjectType}\u0000${characteristicsInternalId}\u0000${positionId}\u0000${categoryName}`;
    if (seen.has(key)) {
      throw new Error(
        `Binding line ${index + 1} repeats an indicator identity.`,
      );
    }
    seen.add(key);
    return {
      characteristicsInternalId,
      positionId,
      categoryName,
      technicalObjectType,
      sensorId,
    };
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

export const sapApmIndicatorReadActions = {
  configure: (args: {
    key: string;
    name: string;
    serviceRoot: string;
    technicalObjectNumber: string;
    siteId: string;
    bindings: SapApmIndicatorBinding[];
    maxRows: number;
    maxPages: number;
    interval: number;
    credentialRef: string;
    enabled: boolean;
    basis: string;
  }) =>
    rpc("configure_sap_apm_indicator_source", {
      p_key: args.key,
      p_name: args.name,
      p_service_root: args.serviceRoot,
      p_technical_object_number: args.technicalObjectNumber,
      p_site_id: args.siteId,
      p_indicator_bindings: args.bindings,
      p_max_rows: args.maxRows,
      p_max_pages: args.maxPages,
      p_expected_interval_minutes: args.interval,
      p_credential_binding_ref: args.credentialRef,
      p_enabled: args.enabled,
      p_basis: args.basis,
    }),

  pull: async (key: string, dryRun: boolean) => {
    const { data, error } = await supabase.functions.invoke(
      "sap-apm-indicator-read-pull",
      { body: { connector_key: key, dry_run: dryRun } },
    );
    if (error) throw new Error(error.message);
    if ((data as { error?: string } | null)?.error) {
      throw new Error(String((data as { error: unknown }).error));
    }
    return data as Record<string, unknown>;
  },
};
