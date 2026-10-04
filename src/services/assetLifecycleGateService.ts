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

export interface LifecycleGateAsset {
  id: string;
  name: string;
  tag: string | null;
  stageKey: string | null;
  stageLabel: string | null;
  enteredAt: string | null;
  inherited: boolean | null;
}

export interface LifecycleGateStage {
  stageKey: string;
  label: string;
  phase: "pre_service" | "in_service" | "end_of_life";
  stageOrder: number;
  decisionOwned: string;
}

export interface LifecycleGateCriterion {
  id: number;
  criterion: string;
  isMandatory: boolean;
  guidance: string | null;
}

export interface LifecycleGateEvidence {
  id: string;
  description: string | null;
  sourceSystem: string | null;
  evidenceClass: string | null;
  verifiedAt: string;
}

export interface LifecycleGateEvaluation {
  id: string;
  recommended: "repair" | "replace" | "redesign" | "defer" | null;
  uncertainty: "low" | "moderate" | "high";
  decision: "accepted";
  decidedAt: string;
  rationale: string;
}

export interface LifecycleGateReview {
  id: number;
  stageKey: string;
  targetStageKey: string | null;
  outcome: "pass" | "hold";
  reviewedAt: string;
  note: string;
  evaluationId: string | null;
}

export interface DisposalRecord {
  assetId: string;
  disposalRoute: DisposalRoute;
  disposedAt: string;
  recoveredValue: number | null;
  disposalCost: number | null;
  currency: string | null;
  siteRestorationRequired: boolean;
  siteRestorationComplete: boolean;
  restorationObligation: string | null;
  hazardousMaterialsRemoved: boolean | null;
  certificateReference: string | null;
  evidenceItemId: string;
  version: number;
  updatedAt: string;
}

export interface AssetLifecycleGateWorkspace {
  authority: {
    canAct: boolean;
    requiredAal: "aal2";
    verifiedFactorRequired: true;
    operationalAuthority: false;
    financialAuthority: false;
  };
  assets: LifecycleGateAsset[];
  stages: LifecycleGateStage[];
  criteria: LifecycleGateCriterion[];
  evidence: LifecycleGateEvidence[];
  evaluations: LifecycleGateEvaluation[];
  reviews: LifecycleGateReview[];
  disposal: DisposalRecord | null;
}

export type FindingStatus = "met" | "not_met" | "not_assessed";

export interface RecordGateReviewInput {
  assetId: string;
  targetStageKey: string;
  outcome: "pass" | "hold";
  note: string;
  evaluationId?: string | null;
  findings: Array<{
    criterionId: number;
    status: FindingStatus;
    evidenceItemId?: string | null;
    evidenceNote?: string | null;
  }>;
}

export type DisposalRoute =
  | "resale"
  | "redeployment"
  | "scrap_recycle"
  | "return_to_vendor"
  | "hazardous_disposal"
  | "abandonment_in_place";

export interface RecordDisposalInput {
  assetId: string;
  disposalRoute: DisposalRoute;
  disposedAt: string;
  recoveredValue?: number | null;
  disposalCost?: number | null;
  currency?: string | null;
  siteRestorationRequired: boolean;
  siteRestorationComplete: boolean;
  restorationObligation?: string | null;
  hazardousMaterialsRemoved?: boolean | null;
  certificateReference?: string | null;
  evidenceItemId: string;
  expectedVersion: number;
}

export function getAssetLifecycleGateWorkspace(assetId?: string | null) {
  return callRpc<AssetLifecycleGateWorkspace>(
    "get_asset_lifecycle_gate_workspace",
    { p_asset_id: assetId || null },
  );
}

export function recordAssetLifecycleGateReview(input: RecordGateReviewInput) {
  if (input.note.trim().length < 20)
    throw new Error("Record at least 20 characters of gate-review basis.");
  if (input.findings.length === 0)
    throw new Error("Assess every current-stage criterion.");
  return callRpc<{
    reviewId: number;
    outcome: "pass" | "hold";
    mayAdvance: boolean;
    operationalAuthority: false;
    financialAuthority: false;
  }>("record_asset_lifecycle_gate_review", {
    p_asset_id: input.assetId,
    p_to_stage: input.targetStageKey,
    p_outcome: input.outcome,
    p_note: input.note.trim(),
    p_evaluation_id: input.evaluationId || null,
    p_findings: input.findings.map((finding) => ({
      criterion_id: finding.criterionId,
      status: finding.status,
      evidence_item_id: finding.evidenceItemId || null,
      evidence_note: finding.evidenceNote?.trim() || null,
    })),
  });
}

export async function advanceAssetLifecycleStage(input: {
  assetId: string;
  targetStageKey: string;
  reason: string;
}) {
  if (input.reason.trim().length < 20)
    throw new Error("Record at least 20 characters of movement basis.");
  const { data, error } = await supabase.rpc("advance_lifecycle_stage", {
    p_asset_id: input.assetId,
    p_to_stage: input.targetStageKey,
    p_reason: input.reason.trim(),
  });
  if (error) throw new Error(error.message);
  const row = (data as Array<{ outcome: string; detail: string }> | null)?.[0];
  if (!row) throw new Error("advance_lifecycle_stage returned nothing");
  if (row.outcome !== "moved") throw new Error(row.detail);
  return row;
}

export function recordAssetDisposal(input: RecordDisposalInput) {
  if (!input.disposedAt) throw new Error("Record the disposal date.");
  if (!input.evidenceItemId)
    throw new Error("Choose independently verified disposal evidence.");
  if (
    input.siteRestorationRequired &&
    (input.restorationObligation?.trim().length ?? 0) < 20
  )
    throw new Error("Describe the restoration obligation in 20 characters.");
  return callRpc<{
    assetId: string;
    version: number;
    disposalRoute: DisposalRoute;
    restorationComplete: boolean;
    operationalAuthority: false;
    financialAuthority: false;
  }>("record_asset_disposal", {
    p_asset_id: input.assetId,
    p_disposal_route: input.disposalRoute,
    p_disposed_at: input.disposedAt,
    p_recovered_value: input.recoveredValue ?? null,
    p_disposal_cost: input.disposalCost ?? null,
    p_currency: input.currency?.trim().toUpperCase() || null,
    p_site_restoration_required: input.siteRestorationRequired,
    p_site_restoration_complete: input.siteRestorationComplete,
    p_restoration_obligation: input.restorationObligation?.trim() || null,
    p_hazardous_materials_removed: input.hazardousMaterialsRemoved ?? null,
    p_certificate_reference: input.certificateReference?.trim() || null,
    p_evidence_item_id: input.evidenceItemId,
    p_expected_version: input.expectedVersion,
  });
}
