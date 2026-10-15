import { supabase } from "../lib/supabase";

type RpcEnvelope = { error?: unknown };

export type RecordedRiskLevel =
  "Very Low" | "Low" | "Medium" | "High" | "Critical";

export interface AssetLifecycleRiskIndex {
  indexComputable: boolean;
  value: number | null;
  unit: "score";
  formula: string;
  basis: string;
  criteriaProfile: {
    id: string;
    name: string;
    version: number;
    status: "adopted";
  } | null;
}

export interface AssetLifecycleRiskCoverage {
  assets: number;
  assetsWithoutCurrentLifecycle: number;
  assetsWithoutCurrentRisk: number;
  openRiskRecords: number;
  contractedRiskRecords: number;
  incompleteRiskRecords: number;
  staleOrUndatedRiskRecords: number;
  distinctCriteriaProfiles: number;
  assetsWithVerifiedCondition: number;
  assetsWithCurrentEconomics: number;
  assetsWithLifecycleEvaluation: number;
}

export interface AssetLifecycleRiskRecord {
  id: string;
  title: string;
  status: "evaluated" | "treatment_active" | "monitoring" | string;
  currentRiskScore: number | null;
  currentRiskLevel: RecordedRiskLevel | null;
  criteriaProfileId: string | null;
  criteriaName: string | null;
  criteriaVersion: number | null;
  analysisLevel: string | null;
  uncertainty: number | null;
  confidence: number | null;
  riskOwnerId: string | null;
  decisionOwnerId: string | null;
  reviewDate: string | null;
  reviewCurrent: boolean;
  contractComplete: boolean;
  contractGaps: string[];
  informationSensitivity: "public" | "internal" | "confidential" | "restricted";
}

export interface AssetLifecycleRiskAsset {
  id: string;
  name: string;
  tag: string | null;
  siteId: string | null;
  siteName: string | null;
  assetClass: string | null;
  criticality: string | null;
  lifecycleStatus: string | null;
  lifecycle: {
    stageKey: string;
    stageLabel: string;
    phase: string;
    enteredAt: string;
    expectedExit: string | null;
    inherited: boolean;
    basisEvidenceItemId: string | null;
  } | null;
  assetRiskScore: number | null;
  conditionKnowledgeState: string | null;
  condition: {
    id: string;
    knowledgeState: string;
    status: "draft" | "verified";
    validThrough: string | null;
    verifiedAt: string | null;
  } | null;
  economics: {
    id: string;
    version: number;
    evidenceItemId: string | null;
    reviewDue: string | null;
    economicsReviewOverdue: boolean;
  } | null;
  latestLifecycleEvaluation: {
    id: string;
    recommended: "repair" | "replace" | "redesign" | "defer" | null;
    uncertainty: "low" | "moderate" | "high";
    decision: "accepted" | "rejected" | "deferred_decision" | null;
    evaluatedAt: string;
  } | null;
  currentRiskRecords: AssetLifecycleRiskRecord[];
  restrictedRiskRecords: number;
  evidenceGaps: string[];
}

export interface EnterpriseAssetLifecycleRisk {
  detailAccess: boolean;
  detailRestriction: string | null;
  index: AssetLifecycleRiskIndex;
  coverage: AssetLifecycleRiskCoverage;
  evidenceGaps: string[];
  riskLevels: Array<{ level: RecordedRiskLevel; records: number }>;
  lifecycleStages: Array<{
    stageKey: string;
    stageLabel: string;
    phase: string;
    assets: number;
    assetsWithCurrentRisk: number;
  }>;
  assets: AssetLifecycleRiskAsset[];
  basis: string;
  decisionBoundary: string;
  initialStateSetup: InitialAssetLifecycleStateOptions;
}

export interface InitialAssetLifecycleStateOptions {
  canRecord: boolean;
  requiredAal: "aal2";
  assets: Array<{ id: string; name: string; tag: string | null }>;
  stages: Array<{
    stageKey: string;
    label: string;
    phase: string;
    decisionOwned: string;
  }>;
  evidence: Array<{
    id: string;
    assetId: string;
    description: string | null;
    sourceSystem: string | null;
    evidenceClass: string | null;
    verifiedAt: string;
  }>;
}

export interface InitialAssetLifecycleStateInput {
  assetId: string;
  stageKey: string;
  evidenceItemId: string;
  basis: string;
}

export async function getEnterpriseAssetLifecycleRisk(): Promise<EnterpriseAssetLifecycleRisk> {
  const [positionResponse, optionsResponse] = await Promise.all([
    supabase.rpc("get_enterprise_asset_lifecycle_risk"),
    supabase.rpc("get_initial_asset_lifecycle_state_options"),
  ]);
  if (positionResponse.error) throw new Error(positionResponse.error.message);
  if (optionsResponse.error) throw new Error(optionsResponse.error.message);
  const body = positionResponse.data as
    (EnterpriseAssetLifecycleRisk & RpcEnvelope) | null;
  if (body && typeof body.error === "string") throw new Error(body.error);
  if (!body) throw new Error("Lifecycle-risk service returned nothing.");
  const options = optionsResponse.data as
    (InitialAssetLifecycleStateOptions & RpcEnvelope) | null;
  if (options && typeof options.error === "string")
    throw new Error(options.error);
  if (!options)
    throw new Error("Lifecycle-state setup service returned nothing.");
  return { ...body, initialStateSetup: options };
}

export async function recordInitialAssetLifecycleState(
  input: InitialAssetLifecycleStateInput,
): Promise<void> {
  const { data, error } = await supabase.rpc(
    "record_initial_asset_lifecycle_state",
    {
      p_asset_id: input.assetId,
      p_stage_key: input.stageKey,
      p_evidence_item_id: input.evidenceItemId,
      p_basis: input.basis,
    },
  );
  if (error) throw new Error(error.message);
  const body = data as RpcEnvelope | null;
  if (body && typeof body.error === "string") throw new Error(body.error);
}
