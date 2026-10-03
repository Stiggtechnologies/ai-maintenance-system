import { supabase } from "../lib/supabase";

export interface GovernedTwinTemplate {
  id: string;
  template_key: string;
  version: string;
  asset_family: string;
  asset_class: string;
  title: string;
  maturity: string;
  review_outcome: "pending" | "engineer_reviewed" | "rejected";
  sharing_scope: "tenant_private" | "shared";
  created_by: string | null;
  reviewed_by: string | null;
  review_basis: string | null;
  component_count: number;
}

export interface NumberingRule {
  id: number;
  number_prefix: string;
  expected_class: string | null;
  manufacturer: string | null;
  model: string | null;
  ambiguity_note: string | null;
  source: string;
  effective_from: string;
  evidence_basis: string | null;
}

export interface AssetClassMapping {
  local_class: string;
  catalogue_class: string;
  template_key: string | null;
  fit: "direct" | "approximate" | "none";
  rationale: string;
  source: string;
  evidence_basis: string | null;
}

export interface AssetMasterWorkspace {
  actor_role: string;
  can_manage: boolean;
  governance: Record<string, string>;
  templates: GovernedTwinTemplate[];
  numbering_rules: NumberingRule[];
  class_mappings: AssetClassMapping[];
  available_templates: Array<{
    template_key: string;
    version: string;
    title: string;
    maturity: string;
    sharing_scope: string;
  }>;
}

function unwrap<T>(data: unknown, error: { message: string } | null): T {
  if (error) throw new Error(error.message);
  const payload = data as ({ error?: unknown } & T) | null;
  if (!payload) throw new Error("Asset-master workspace returned no data.");
  if (payload.error) throw new Error(String(payload.error));
  return payload;
}

export async function getAssetMasterWorkspace() {
  const { data, error } = await supabase.rpc(
    "get_asset_master_governance_workspace",
  );
  return unwrap<AssetMasterWorkspace>(data, error);
}

export async function recordTenantTwinTemplate(record: {
  template_key: string;
  version: string;
  asset_family: string;
  asset_class: string;
  title: string;
  description?: string;
  template: { components: unknown[]; [key: string]: unknown };
  evidence_reference: string;
  evidence_basis: string;
}) {
  const { data, error } = await supabase.rpc(
    "record_tenant_asset_twin_template",
    { p_record: record },
  );
  return unwrap<Record<string, unknown>>(data, error);
}

export async function reviewTenantTwinTemplate(
  templateId: string,
  decision: "engineer_reviewed" | "rejected",
  basis: string,
) {
  const { data, error } = await supabase.rpc(
    "review_tenant_asset_twin_template",
    { p_template_id: templateId, p_decision: decision, p_basis: basis },
  );
  return unwrap<Record<string, unknown>>(data, error);
}

export async function recordAssetClassGovernance(record: {
  local_class: string;
  catalogue_class: string;
  template_key?: string | null;
  fit: "direct" | "approximate" | "none";
  rationale: string;
  source: string;
  evidence_basis: string;
}) {
  const { data, error } = await supabase.rpc("record_asset_class_governance", {
    p_record: record,
  });
  return unwrap<Record<string, unknown>>(data, error);
}

export async function recordUnitNumberingRule(record: {
  number_prefix: string;
  expected_class?: string;
  manufacturer?: string;
  model?: string;
  ambiguity_note?: string;
  source: string;
  effective_from?: string;
  evidence_basis: string;
}) {
  const { data, error } = await supabase.rpc("record_unit_numbering_rule", {
    p_record: record,
  });
  return unwrap<Record<string, unknown>>(data, error);
}

export async function runGovernedUnitNumbering(apply: boolean, basis: string) {
  const { data, error } = await supabase.rpc("run_governed_unit_numbering", {
    p_apply: apply,
    p_basis: basis,
  });
  return unwrap<Record<string, unknown>>(data, error);
}

export async function runGovernedTwinProvisioning(
  apply: boolean,
  basis: string,
) {
  const { data, error } = await supabase.rpc("run_governed_twin_provisioning", {
    p_apply: apply,
    p_basis: basis,
  });
  return unwrap<Record<string, unknown>>(data, error);
}
