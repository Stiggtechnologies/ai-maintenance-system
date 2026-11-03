import { supabase } from "../lib/supabase";
import { listSites, type SiteOption } from "./reliabilityCallers";

export interface ConstraintLimitInput {
  key: string;
  kind: string;
  availableQuantity: string | null;
  unitOfMeasure: string;
  basis: string;
  assetId: string | null;
  constraintSignalId: string | null;
}

export interface ProductionConstraintLimit {
  id: string;
  key: string;
  kind: string;
  assetId: string | null;
  assetTag: string | null;
  constraintSignalId: string | null;
  availableQuantity: string | null;
  unitOfMeasure: string;
  basis: string;
  provenance: {
    signalState?: string | null;
    signalKind?: string | null;
    signalKey?: string | null;
    stateConvertedToQuantity?: boolean;
  };
}

export interface ProductionConstraintStudy {
  id: string;
  title: string;
  siteId: string;
  siteName: string;
  horizonStart: string;
  horizonEnd: string;
  requiredQuantity: string;
  unitOfMeasure: string;
  basis: string;
  assessable: boolean;
  result: {
    assessable: boolean;
    reasons: string[];
    method: string;
    limitsAreAdditive: boolean;
    bottleneckKeys: string[];
    primaryKey: string | null;
    availableQuantity: string | null;
    headroom: string | null;
    binding: boolean | null;
    demonstratedOutput: string | null;
    demonstratedRecordCount: number;
    demonstratedOutputUsedAsCapacity: boolean;
    releasesWork: boolean;
    changesOperatingLimit: boolean;
    forecastsLoss: boolean;
  };
  supersedesStudyId: string | null;
  recordedBy: string;
  recordedAt: string;
  constraints: ProductionConstraintLimit[];
}

export interface ProductionConstraintWorkspace {
  studies: ProductionConstraintStudy[];
  sites: SiteOption[];
  method: string;
  authority: string;
}

export interface ConstraintAssetOption {
  id: string;
  name: string;
  assetTag: string | null;
}

type RpcPayload = { error?: string };

async function governedRpc<T>(
  fn: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  const payload = data as (T & RpcPayload) | null;
  if (!payload)
    throw new Error("Production constraint study returned no response.");
  if (payload.error) throw new Error(payload.error);
  return payload;
}

export async function getProductionConstraintStudies(): Promise<
  Omit<ProductionConstraintWorkspace, "sites">
> {
  return governedRpc("get_production_constraint_studies");
}

export async function loadProductionConstraintWorkspace(): Promise<ProductionConstraintWorkspace> {
  const [studies, sites] = await Promise.all([
    getProductionConstraintStudies(),
    listSites(),
  ]);
  return { ...studies, sites };
}

export async function listConstraintAssets(
  siteId: string,
): Promise<ConstraintAssetOption[]> {
  const { data, error } = await supabase
    .from("assets")
    .select("id, name, asset_tag, tag")
    .eq("site_id", siteId)
    .order("name")
    .limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    const asset = row as {
      id: string;
      name: string;
      asset_tag: string | null;
      tag: string | null;
    };
    return {
      id: asset.id,
      name: asset.name,
      assetTag: asset.asset_tag || asset.tag,
    };
  });
}

export async function recordProductionConstraintStudy(input: {
  title: string;
  siteId: string;
  horizonStart: string;
  horizonEnd: string;
  requiredQuantity: string;
  unitOfMeasure: string;
  basis: string;
  limits: ConstraintLimitInput[];
  supersedesStudyId?: string | null;
}): Promise<{
  recorded: boolean;
  idempotent: boolean;
  study: ProductionConstraintStudy;
}> {
  return governedRpc("record_production_constraint_study", {
    p_title: input.title.trim(),
    p_site_id: input.siteId,
    p_horizon_start: input.horizonStart,
    p_horizon_end: input.horizonEnd,
    p_required_quantity: input.requiredQuantity.trim(),
    p_unit_of_measure: input.unitOfMeasure.trim(),
    p_basis: input.basis.trim(),
    p_constraints: input.limits.map((limit) => ({
      key: limit.key.trim(),
      kind: limit.kind,
      availableQuantity: limit.availableQuantity?.trim()
        ? limit.availableQuantity.trim()
        : null,
      unitOfMeasure: limit.unitOfMeasure.trim(),
      basis: limit.basis.trim(),
      assetId: limit.assetId,
      constraintSignalId: limit.constraintSignalId,
    })),
    p_supersedes_study_id: input.supersedesStudyId ?? null,
  });
}
