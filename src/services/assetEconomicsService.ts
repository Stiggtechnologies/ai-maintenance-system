import { supabase } from "../lib/supabase";

type RpcEnvelope = { error?: unknown };

async function callRpc<T>(name: string, args: Record<string, unknown> = {}) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  const body = data as (T & RpcEnvelope) | null;
  if (body && typeof body.error === "string") throw new Error(body.error);
  if (body == null) throw new Error(`${name} returned nothing`);
  return body;
}

export interface AssetEconomicsAsset {
  id: string;
  name: string;
  assetClass: string | null;
  criticality: string | null;
}

export interface AssetEconomicsEvidence {
  id: string;
  description: string | null;
  sourceSystem: string | null;
  assetId: string | null;
  verifiedBy: string;
  verifiedAt: string;
}

export interface AssetEconomicsSnapshot {
  id: string;
  scope: "asset" | "asset_class";
  assetId: string | null;
  assetName: string | null;
  assetClass: string | null;
  replacementValueUsd: number | null;
  annualMaintenanceCostUsd: number | null;
  downtimeCostPerHourUsd: number | null;
  expectedRepairCostUsd: number | null;
  expectedRepairHours: number | null;
  expectedRemainingLifeYears: number | null;
  currency: "USD";
  basis: string;
  sourceSystem: string | null;
  evidenceItemId: string | null;
  evidenceDescription: string | null;
  evidenceVerifiedBy: string | null;
  evidenceVerifiedAt: string | null;
  effectiveFrom: string;
  reviewDue: string | null;
  version: number;
  updatedBy: string | null;
  updatedAt: string;
}

export interface AssetEconomicsWorkspace {
  assets: AssetEconomicsAsset[];
  economics: AssetEconomicsSnapshot[];
  verifiedEvidence: AssetEconomicsEvidence[];
  coverage: {
    assets: number;
    assetsWithEconomics: number;
    assetsWithCompleteEconomics: number;
    snapshots: number;
    overdueReviews: number;
  };
  capitalPlans: Array<{
    planYear: number;
    itemCount: number;
    mandatoryCount: number;
    governedCandidateCount: number;
    totalCost: number | null;
  }>;
  currency: "USD";
  basis: string;
  decisionBoundary: string;
}

export interface RecordAssetEconomicsInput {
  assetId?: string | null;
  assetClass?: string | null;
  replacementValueUsd?: number | null;
  annualMaintenanceCostUsd?: number | null;
  downtimeCostPerHourUsd?: number | null;
  expectedRepairCostUsd?: number | null;
  expectedRepairHours?: number | null;
  expectedRemainingLifeYears?: number | null;
  basis: string;
  sourceSystem: string;
  evidenceItemId: string;
  effectiveFrom: string;
  reviewDue?: string | null;
  expectedVersion: number;
}

function validateOptionalNumber(
  value: number | null | undefined,
  label: string,
  positive: boolean,
) {
  if (value == null) return null;
  if (!Number.isFinite(value) || (positive ? value <= 0 : value < 0)) {
    throw new Error(
      `${label} must be ${positive ? "positive" : "zero or greater"}.`,
    );
  }
  return value;
}

export async function getAssetEconomicsWorkspace() {
  return callRpc<AssetEconomicsWorkspace>("get_asset_economics_workspace");
}

export async function recordAssetEconomics(input: RecordAssetEconomicsInput) {
  const assetId = input.assetId?.trim() || null;
  const assetClass = input.assetClass?.trim() || null;
  if ((assetId == null) === (assetClass == null)) {
    throw new Error("Choose exactly one asset or asset-class scope.");
  }
  if (input.basis.trim().length < 20) {
    throw new Error("Record at least 20 characters of economic basis.");
  }
  if (input.sourceSystem.trim().length < 2) {
    throw new Error("Record the source system or source reference.");
  }
  if (!input.evidenceItemId.trim()) {
    throw new Error("Choose independently verified canonical evidence.");
  }
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 0) {
    throw new Error("Expected version must be a non-negative integer.");
  }

  const snapshot = {
    assetId,
    assetClass,
    replacementValueUsd: validateOptionalNumber(
      input.replacementValueUsd,
      "Replacement value",
      true,
    ),
    annualMaintenanceCostUsd: validateOptionalNumber(
      input.annualMaintenanceCostUsd,
      "Annual maintenance cost",
      false,
    ),
    downtimeCostPerHourUsd: validateOptionalNumber(
      input.downtimeCostPerHourUsd,
      "Downtime cost per hour",
      false,
    ),
    expectedRepairCostUsd: validateOptionalNumber(
      input.expectedRepairCostUsd,
      "Expected repair cost",
      false,
    ),
    expectedRepairHours: validateOptionalNumber(
      input.expectedRepairHours,
      "Expected repair hours",
      true,
    ),
    expectedRemainingLifeYears: validateOptionalNumber(
      input.expectedRemainingLifeYears,
      "Expected remaining life",
      true,
    ),
    basis: input.basis.trim(),
    sourceSystem: input.sourceSystem.trim(),
    evidenceItemId: input.evidenceItemId.trim(),
    effectiveFrom: input.effectiveFrom,
    reviewDue: input.reviewDue || null,
    expectedVersion: input.expectedVersion,
  };
  if (
    [
      snapshot.replacementValueUsd,
      snapshot.annualMaintenanceCostUsd,
      snapshot.downtimeCostPerHourUsd,
      snapshot.expectedRepairCostUsd,
      snapshot.expectedRepairHours,
      snapshot.expectedRemainingLifeYears,
    ].every((value) => value == null)
  ) {
    throw new Error("Record at least one known economic input.");
  }

  return callRpc<{
    assetEconomicsId: string;
    version: number;
    scope: "asset" | "asset_class";
    currency: "USD";
    status: "recorded";
    expenditureAuthorized: false;
    projectSanctioned: false;
    workAuthorized: false;
    riskAccepted: false;
    returnToServiceAuthorized: false;
  }>("record_asset_economics_snapshot", { p_snapshot: snapshot });
}
