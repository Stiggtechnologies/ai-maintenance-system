import { supabase } from "../lib/supabase";

export interface ConfigurationAuthoringWorkspace {
  assets: Array<{
    id: string;
    name: string;
    tag: string | null;
    serialNumber: string | null;
  }>;
  materials: Array<{ id: string; code: string; description: string }>;
  variants: Array<{
    id: number;
    manufacturer: string;
    model: string;
    variantCode: string;
    distinguishingAttributes: string;
  }>;
  pendingAuthority: Array<{
    kind: "substitution" | "interchangeability";
    id: number;
    label: string;
    status: "pending";
    createdAt: string;
    proposedBy: string;
    approvalId: string;
  }>;
  controls: { authority: string; approval: string };
}

async function rpc<T>(name: string, args: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  const result = data as T & { error?: string };
  if (result?.error) throw new Error(result.error);
  return result;
}

export function getConfigurationAuthoringWorkspace() {
  return rpc<ConfigurationAuthoringWorkspace>(
    "get_configuration_authoring_workspace",
    {},
  );
}

export interface ConfigurationItemInput {
  positionRef: string;
  materialId?: string;
  partNumber?: string;
  description?: string;
  quantity: number;
  serialNumber?: string;
  firmwareVersion?: string;
  softwareVersion?: string;
  safetyCritical: boolean;
  safetyBasis?: string;
}

export function recordConfigurationBaseline(input: {
  assetId: string;
  baselineKind: "as_designed" | "as_built" | "as_maintained";
  effectiveFrom?: string;
  sourceReference: string;
  evidenceBasis: string;
  engineeringChangeReference?: string;
  notes?: string;
  items: ConfigurationItemInput[];
}) {
  return rpc<{ baseline_id: number; status: "recorded"; revision: number }>(
    "record_configuration_baseline",
    {
      p_record: {
        asset_id: input.assetId,
        baseline_kind: input.baselineKind,
        effective_from: input.effectiveFrom || null,
        source_reference: input.sourceReference,
        evidence_basis: input.evidenceBasis,
        engineering_change_reference: input.engineeringChangeReference || null,
        notes: input.notes || null,
        items: input.items.map((item) => ({
          position_ref: item.positionRef,
          material_id: item.materialId || null,
          part_number: item.partNumber || null,
          description: item.description || null,
          quantity: item.quantity,
          serial_number: item.serialNumber || null,
          firmware_version: item.firmwareVersion || null,
          software_version: item.softwareVersion || null,
          safety_critical: item.safetyCritical,
          safety_basis: item.safetyBasis || null,
        })),
      },
    },
  );
}

export function recordModelVariant(input: {
  manufacturer: string;
  model: string;
  variantCode: string;
  distinguishingAttributes: string;
  supersedesVariantCode?: string;
  evidenceBasis: string;
}) {
  return rpc<{ variant_id: number; status: "recorded" }>(
    "record_model_variant",
    {
      p_record: {
        manufacturer: input.manufacturer,
        model: input.model,
        variant_code: input.variantCode,
        distinguishing_attributes: input.distinguishingAttributes,
        supersedes_variant_code: input.supersedesVariantCode || null,
        evidence_basis: input.evidenceBasis,
      },
    },
  );
}

export function proposeConfigurationAuthority(
  kind: "substitution" | "interchangeability",
  record: Record<string, unknown>,
) {
  return rpc<{ record_id: number; approval_id: string; status: "pending" }>(
    "propose_configuration_authority",
    { p_kind: kind, p_record: record },
  );
}

export function decideConfigurationAuthority(
  kind: "substitution" | "interchangeability",
  recordId: number,
  outcome: "approved" | "rejected",
  note: string,
) {
  return rpc<{ record_id: number; approval_id: string; status: string }>(
    "decide_configuration_authority",
    {
      p_kind: kind,
      p_record_id: recordId,
      p_outcome: outcome,
      p_note: note,
    },
  );
}

export function recordRedLine(input: {
  assetId?: string;
  drawingReference: string;
  drawingRevision?: string;
  changeDescription: string;
  evidenceBasis: string;
}) {
  return rpc<{ red_line_id: number; status: "open" }>("record_red_line", {
    p_record: {
      asset_id: input.assetId || null,
      drawing_reference: input.drawingReference,
      drawing_revision: input.drawingRevision || null,
      change_description: input.changeDescription,
      evidence_basis: input.evidenceBasis,
    },
  });
}

export function disposeRedLine(
  redLineId: number,
  outcome: "in_review" | "incorporated" | "rejected",
  incorporatedRevision: string,
  note: string,
) {
  return rpc<{ red_line_id: number; status: string }>("dispose_red_line", {
    p_red_line_id: redLineId,
    p_outcome: outcome,
    p_incorporated_revision: incorporatedRevision,
    p_note: note,
  });
}

export function recordConfigurationReconciliation(input: {
  assetId: string;
  trigger:
    "outage" | "project" | "audit" | "incident" | "scheduled" | "onboarding";
  differencesFound: number;
  safetyCriticalDifferences: number;
  summary: string;
  evidenceBasis: string;
  engineeringChangeReference?: string;
}) {
  return rpc<{ reconciliation_id: number; status: "recorded" }>(
    "record_configuration_reconciliation",
    {
      p_record: {
        asset_id: input.assetId,
        trigger: input.trigger,
        differences_found: input.differencesFound,
        safety_critical_differences: input.safetyCriticalDifferences,
        summary: input.summary,
        evidence_basis: input.evidenceBasis,
        engineering_change_reference: input.engineeringChangeReference || null,
      },
    },
  );
}

export const CONFIGURATION_AUTHOR_ROLES = [
  "reliability_engineer",
  "maintenance_manager",
  "executive",
  "admin",
] as const;
export const CONFIGURATION_REVIEWER_ROLES = [
  "reliability_engineer",
  "executive",
  "admin",
] as const;
