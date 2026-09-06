import { shaftResonanceModelPack } from "../lib/engineering-models/resonance";
import type {
  ModelEvaluationContext,
  ModelEvidenceRequirement,
} from "../lib/engineering-models/types";
import { supabase } from "../lib/supabase";

export interface EngineeringModelDebt {
  id: string;
  debtKey: string;
  description: string;
  blocking: boolean;
  temporaryApprovalExpiresAt: string | null;
  raisedAt: string;
}

export interface EngineeringModelRegistryRow {
  id: number;
  modelKey: string;
  version: string;
  name: string;
  description: string;
  modelKind: string;
  domain: string;
  lifeModelType: string | null;
  lifecycleState: string;
  productionEligible: boolean;
  humanInLoop: boolean;
  requiredReviewerRoleKey: string;
  certificationClass: string;
  escalationClass: string;
  sourceTool: string;
  sourceLicense: string;
  airGapCompatible: boolean;
  manifestChecksum: string;
  evidenceRequirements: ModelEvidenceRequirement[];
  verificationState: "passed" | "not_passed";
  openDebt: number;
  openDebtRecords: EngineeringModelDebt[];
  evidenceBound: number;
  recentRuns: number;
  openImpacts: number;
}

export interface EngineeringModelRegistry {
  models: EngineeringModelRegistryRow[];
  posture: {
    registered: number;
    productionEligible: number;
    revalidationRequired: number;
    openBlockingDebt: number;
    outcomesRecorded: number;
    basis: string;
  };
}

interface RpcResult {
  error?: string;
  [key: string]: unknown;
}

function assertRpc(data: unknown, message: string): RpcResult {
  const value = (data ?? {}) as RpcResult;
  if (value.error) throw new Error(value.error);
  if (!data) throw new Error(message);
  return value;
}

export async function getEngineeringModelRegistry(): Promise<EngineeringModelRegistry> {
  const { data, error } = await supabase.rpc("get_engineering_model_registry");
  if (error) throw new Error(error.message);
  return assertRpc(
    data,
    "Engineering model registry returned no data.",
  ) as unknown as EngineeringModelRegistry;
}

export async function registerBuiltInResonancePack(): Promise<RpcResult> {
  const { data, error } = await supabase.functions.invoke(
    "engineering-model-supply-chain",
    {
      body: { action: "ingest", manifest: shaftResonanceModelPack },
    },
  );
  if (error) throw new Error(error.message);
  return assertRpc(data, "Model ingestion returned no data.");
}

export async function independentlyVerifyEngineeringModel(
  modelRegisterId: number,
): Promise<RpcResult> {
  const { data, error } = await supabase.functions.invoke(
    "engineering-model-supply-chain",
    {
      body: { action: "verify", modelRegisterId },
    },
  );
  if (error) throw new Error(error.message);
  return assertRpc(data, "Model verification returned no data.");
}

export async function promoteEngineeringModel(
  modelRegisterId: number,
  targetState: string,
  reviewNote: string,
): Promise<RpcResult> {
  const { data, error } = await supabase.rpc("promote_engineering_model", {
    p_model_register_id: modelRegisterId,
    p_target_state: targetState,
    p_review_note: reviewNote,
  });
  if (error) throw new Error(error.message);
  return assertRpc(data, "Model promotion returned no data.");
}

export async function bindEngineeringModelEvidence(input: {
  modelRegisterId: number;
  evidenceItemId: string;
  requirement: ModelEvidenceRequirement;
  evidenceGrade: "A" | "B" | "C" | "D";
  sourceRights: string;
  parameterCode?: string;
}): Promise<RpcResult> {
  const { data, error } = await supabase.rpc(
    "bind_engineering_model_evidence",
    {
      p_model_register_id: input.modelRegisterId,
      p_evidence_item_id: input.evidenceItemId,
      p_requirement_key: input.requirement.key,
      p_parameter_code: input.parameterCode ?? null,
      p_purpose: input.requirement.purpose,
      p_evidence_grade: input.evidenceGrade,
      p_source_rights: input.sourceRights,
    },
  );
  if (error) throw new Error(error.message);
  return assertRpc(data, "Evidence binding returned no data.");
}

export async function addEngineeringModelDebt(
  modelRegisterId: number,
  debtKey: string,
  description: string,
): Promise<RpcResult> {
  const { data, error } = await supabase.rpc(
    "add_engineering_model_verification_debt",
    {
      p_model_register_id: modelRegisterId,
      p_debt_key: debtKey,
      p_description: description,
      p_blocking: true,
      p_expires_at: null,
    },
  );
  if (error) throw new Error(error.message);
  return assertRpc(data, "Verification-debt recording returned no data.");
}

export async function resolveEngineeringModelDebt(
  debtId: string,
  resolutionNote: string,
): Promise<RpcResult> {
  const { data, error } = await supabase.rpc(
    "resolve_engineering_model_verification_debt",
    {
      p_debt_id: debtId,
      p_resolution_note: resolutionNote,
    },
  );
  if (error) throw new Error(error.message);
  return assertRpc(data, "Verification-debt resolution returned no data.");
}

export async function executeEngineeringModel(input: {
  modelRegisterId: number;
  assetId: string;
  recommendationId?: string;
  configurationBaselineId: number;
  context: ModelEvaluationContext;
}): Promise<RpcResult> {
  const { data, error } = await supabase.functions.invoke(
    "engineering-model-supply-chain",
    {
      body: {
        action: "execute",
        modelRegisterId: input.modelRegisterId,
        assetId: input.assetId,
        recommendationId: input.recommendationId ?? null,
        configurationBaselineId: input.configurationBaselineId,
        context: input.context,
      },
    },
  );
  if (error) throw new Error(error.message);
  return assertRpc(data, "Engineering model execution returned no data.");
}

export interface EngineeringModelCounterfactualReview {
  observedBasis: string;
  predictionAssessment: string;
  designFeedback: string;
}

export async function recordEngineeringModelFieldOutcome(input: {
  calculationRunId: string;
  outcome: boolean;
  workOrderId?: string;
  counterfactualReview: EngineeringModelCounterfactualReview;
}): Promise<RpcResult> {
  const { data, error } = await supabase.rpc(
    "record_engineering_model_field_outcome",
    {
      p_calculation_run_id: input.calculationRunId,
      p_outcome: input.outcome,
      p_work_order_id: input.workOrderId ?? null,
      p_counterfactual_review: input.counterfactualReview,
    },
  );
  if (error) throw new Error(error.message);
  return assertRpc(data, "Engineering field outcome returned no data.");
}

export async function recordEngineeringModelIntervention(input: {
  modelRegisterId: number;
  assetId: string;
  workOrderId: string;
  preDamageState: Record<string, unknown>;
  effectKind: "no_change" | "partial_reset" | "full_reset" | "rate_change_only";
  effectModelReference: string;
  postDamageState: Record<string, unknown>;
  configurationBaselineId: number;
  evidenceItemId: string;
}): Promise<RpcResult> {
  const { data, error } = await supabase.rpc(
    "record_engineering_model_intervention",
    {
      p_model_register_id: input.modelRegisterId,
      p_asset_id: input.assetId,
      p_work_order_id: input.workOrderId,
      p_pre_damage_state: input.preDamageState,
      p_effect_kind: input.effectKind,
      p_effect_model_reference: input.effectModelReference,
      p_post_damage_state: input.postDamageState,
      p_configuration_baseline_id: input.configurationBaselineId,
      p_evidence_item_id: input.evidenceItemId,
    },
  );
  if (error) throw new Error(error.message);
  return assertRpc(data, "Engineering intervention returned no data.");
}

export async function recordFmmeaModelBinding(input: {
  failureModeLibraryId: string;
  canonicalAssetId?: string;
  mechanismId?: string;
  stressors: Array<Record<string, unknown>>;
  damageVariable?: string;
  modelRegisterId?: number;
  occurrenceBasis?: string;
  evidenceItemIds: string[];
  localEffect?: string;
  systemEffect?: string;
  recommendedAction?: string;
  nonPhysicsBranch: boolean;
  modelConflictStatus:
    "not_assessed" | "none" | "unresolved" | "human_resolved";
}): Promise<RpcResult> {
  const { data, error } = await supabase.rpc("record_fmmea_model_binding", {
    p_failure_mode_library_id: input.failureModeLibraryId,
    p_canonical_asset_id: input.canonicalAssetId ?? null,
    p_mechanism_id: input.mechanismId ?? null,
    p_stressors: input.stressors,
    p_damage_variable: input.damageVariable ?? null,
    p_model_register_id: input.modelRegisterId ?? null,
    p_occurrence_basis: input.occurrenceBasis ?? null,
    p_evidence_item_ids: input.evidenceItemIds,
    p_local_effect: input.localEffect ?? null,
    p_system_effect: input.systemEffect ?? null,
    p_recommended_action: input.recommendedAction ?? null,
    p_non_physics_branch: input.nonPhysicsBranch,
    p_model_conflict_status: input.modelConflictStatus,
  });
  if (error) throw new Error(error.message);
  return assertRpc(data, "FMMEA model binding returned no data.");
}

export async function reviewEngineeringModelImpact(input: {
  impactId: string;
  status: "reviewed" | "not_affected" | "recomputed" | "closed";
  reviewNote: string;
}): Promise<RpcResult> {
  const { data, error } = await supabase.rpc(
    "review_engineering_model_impact",
    {
      p_impact_id: input.impactId,
      p_status: input.status,
      p_review_note: input.reviewNote,
    },
  );
  if (error) throw new Error(error.message);
  return assertRpc(data, "Engineering model impact review returned no data.");
}

export interface RecommendationModelTrace {
  calculationRunId: string;
  modelKey: string;
  modelVersion: string;
  calculationStatus: string;
  verification: "pass" | "not_passed";
  fieldValidation: "present" | "missing";
  applicability: "within_range" | "refused";
  engineeringApproval: "approved" | "not_approved";
  productionEligibleAtRead: boolean;
  humanApprovalRequired: true;
  operationalAuthorization: false;
  refusals: Array<{ code: string; message: string; path?: string }>;
  computedAt: string;
}

export async function getRecommendationEngineeringModelTrace(
  recommendationId: string,
): Promise<RecommendationModelTrace[]> {
  const { data, error } = await supabase.rpc(
    "get_recommendation_engineering_model_trace",
    {
      p_recommendation_id: recommendationId,
    },
  );
  if (error) throw new Error(error.message);
  const value = data as { error?: string } | RecommendationModelTrace[] | null;
  if (value && !Array.isArray(value) && value.error)
    throw new Error(value.error);
  return Array.isArray(value) ? value : [];
}
