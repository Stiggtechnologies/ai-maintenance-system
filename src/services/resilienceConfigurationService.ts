import { supabase } from "../lib/supabase";

export const THREAT_KINDS = [
  "wildfire",
  "smoke",
  "flood",
  "extreme_cold",
  "grid_interruption",
  "cyber_incident",
  "supply_chain",
  "utility_failure",
  "labour_shortage",
  "major_equipment_loss",
  "site_evacuation",
  "emergency_shutdown",
  "communications_failure",
] as const;
export type ThreatKind = (typeof THREAT_KINDS)[number];

export const ENTERPRISE_OPERATING_MODES = [
  "normal",
  "degraded",
  "emergency",
  "recovery",
] as const;
export type EnterpriseOperatingMode =
  (typeof ENTERPRISE_OPERATING_MODES)[number];

export interface ResilienceScenarioRecord {
  id: number;
  scenario_key: string;
  title: string;
  threat_kind: ThreatKind;
  description: string | null;
  site_id: string | null;
  annual_likelihood: number | null;
  plan_reference: string | null;
  last_exercised_on: string | null;
  exercise_outcome: string | null;
  linked_continuity_procedure: number | null;
  linked_supplier: number | null;
  governance_basis: string | null;
  evidence_item_ids: string[];
  missing_evidence: string[];
  asset_ids: string[];
}

export interface OperatingModeDefinitionRecord {
  id: number;
  mode: EnterpriseOperatingMode;
  entry_criteria: string | null;
  exit_criteria: string | null;
  declared_by_role: string | null;
  authority_changes: string | null;
  governance_basis: string | null;
  evidence_item_ids: string[];
  missing_evidence: string[];
}

interface NamedRecord<T extends string | number = string> {
  id: T;
  name?: string;
  title?: string;
  description?: string;
}

export interface ResilienceConfigurationWorkspace {
  scenarios: ResilienceScenarioRecord[];
  modes: OperatingModeDefinitionRecord[];
  assets: Array<NamedRecord & { site_id: string | null }>;
  sites: NamedRecord[];
  evidence: Array<
    NamedRecord & { description: string; verification_status: string | null }
  >;
  continuity_procedures: Array<NamedRecord<number> & { title: string }>;
  suppliers: Array<NamedRecord<number> & { name: string }>;
  authority_boundary: string;
}

function checked<T>(value: unknown): T {
  const result = value as { error?: string };
  if (result?.error) throw new Error(result.error);
  return value as T;
}

async function rpc<T>(name: string, args: Record<string, unknown> = {}) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  return checked<T>(data);
}

export const getResilienceConfigurationWorkspace = () =>
  rpc<ResilienceConfigurationWorkspace>(
    "get_resilience_configuration_workspace",
  );

export const saveThreatScenario = (scenario: Record<string, unknown>) =>
  rpc<{ scenario_id: number; scenario_key: string; status: string }>(
    "save_threat_scenario",
    { p_scenario: scenario },
  );

export const replaceScenarioExposure = (
  scenarioId: number,
  assetIds: string[],
  basis: string,
  evidenceItemId?: string,
) =>
  rpc<{ scenario_id: number; mapped_assets: number; status: string }>(
    "replace_scenario_exposure",
    {
      p_scenario_id: scenarioId,
      p_asset_ids: assetIds,
      p_basis: basis,
      p_evidence_item_id: evidenceItemId || null,
    },
  );

export const saveOperatingModeDefinition = (
  definition: Record<string, unknown>,
) =>
  rpc<{ definition_id: number; mode: EnterpriseOperatingMode; status: string }>(
    "save_operating_mode_definition",
    { p_definition: definition },
  );
