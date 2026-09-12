import { supabase } from "../lib/supabase";

export const DIGITAL_MAINTAINABILITY_FIELDS = [
  "firmware",
  "software_version",
  "dependencies",
  "licenses",
  "patches",
  "vendor_support_horizon",
  "backup",
  "restore_procedures",
  "configuration_files",
] as const;

export type DigitalMaintainabilityField =
  (typeof DIGITAL_MAINTAINABILITY_FIELDS)[number];

export interface DigitalItemReadiness {
  configurationItemId: number;
  positionRef: string;
  firmware: string | null;
  softwareVersion: string | null;
  dependencies: unknown[] | null;
  licenses: unknown[] | null;
  patches: string | null;
  vendorSupportHorizon: string | null;
  backupEvidenceItemId: string | null;
  restoreProcedureEvidenceItemId: string | null;
  configurationFileEvidenceItemId: string | null;
  exemptions: DigitalMaintainabilityField[];
  complete: boolean;
}

export interface AssetDigitalMaintainability {
  assetId: string;
  baselineId?: number;
  baselineKind: "as_designed" | "as_built" | "as_maintained";
  status: "READY" | "NOT_READY" | "NOT_ASSESSED" | "NOT_APPLICABLE";
  applicability: "applicable" | "not_applicable" | null;
  basis?: string;
  assessmentEvidenceItemId?: string;
  completeItems?: number;
  totalItems?: number;
  items: DigitalItemReadiness[];
  gaps: Array<string | { configurationItemId: number; positionRef: string; missing: string[] }>;
  fieldContract?: string[];
  decisionBoundary: string;
}

function requireResult<T>(data: unknown, error: { message: string } | null): T {
  if (error) throw new Error(error.message);
  const result = data as Record<string, unknown> | null;
  if (result?.error) throw new Error(String(result.error));
  return data as T;
}

export async function getAssetDigitalMaintainability(
  assetId: string,
  baselineKind: AssetDigitalMaintainability["baselineKind"] = "as_built",
): Promise<AssetDigitalMaintainability> {
  const { data, error } = await supabase.rpc("get_asset_digital_maintainability", {
    p_asset_id: assetId,
    p_baseline_kind: baselineKind,
  });
  return requireResult<AssetDigitalMaintainability>(data, error);
}

export async function assessAssetDigitalMaintainability(input: {
  assetId: string;
  baselineKind: AssetDigitalMaintainability["baselineKind"];
  applicability: "applicable" | "not_applicable";
  basis: string;
  sourceReference: string;
  evidenceItemId: string;
}): Promise<{ baselineId: number }> {
  const { data, error } = await supabase.rpc("assess_asset_digital_maintainability", {
    p_asset_id: input.assetId,
    p_baseline_kind: input.baselineKind,
    p_applicability: input.applicability,
    p_basis: input.basis,
    p_source_reference: input.sourceReference,
    p_evidence_item_id: input.evidenceItemId,
  });
  return requireResult<{ baselineId: number }>(data, error);
}

export async function recordDigitalConfigurationItem(input: {
  baselineId: number;
  positionRef: string;
  firmwareVersion?: string;
  softwareVersion?: string;
  dependencies: unknown[] | null;
  licenses: unknown[] | null;
  patchStatus?: string;
  vendorSupportHorizon?: string;
  backupEvidenceItemId?: string;
  restoreProcedureEvidenceItemId?: string;
  configurationFileEvidenceItemId?: string;
  fieldExemptions: DigitalMaintainabilityField[];
  basis: string;
  recordEvidenceItemId: string;
}): Promise<{ configurationItemId: number }> {
  const { data, error } = await supabase.rpc("record_digital_configuration_item", {
    p_baseline_id: input.baselineId,
    p_position_ref: input.positionRef,
    p_firmware_version: input.firmwareVersion || null,
    p_software_version: input.softwareVersion || null,
    p_dependency_manifest: input.dependencies,
    p_license_inventory: input.licenses,
    p_patch_status: input.patchStatus || null,
    p_vendor_support_horizon: input.vendorSupportHorizon || null,
    p_backup_evidence_item_id: input.backupEvidenceItemId || null,
    p_restore_procedure_evidence_item_id:
      input.restoreProcedureEvidenceItemId || null,
    p_configuration_file_evidence_item_id:
      input.configurationFileEvidenceItemId || null,
    p_field_exemptions: input.fieldExemptions,
    p_basis: input.basis,
    p_record_evidence_item_id: input.recordEvidenceItemId,
  });
  return requireResult<{ configurationItemId: number }>(data, error);
}
