import { supabase } from "../lib/supabase";

export const RECOMMENDATION_EVIDENCE_LEVELS = [
  "verified_measurement",
  "approved_inspection",
  "confirmed_history",
  "engineering_calculation",
  "oem_recommendation",
  "industry_reference",
  "similar_asset_inference",
  "expert_judgment",
  "ai_hypothesis",
] as const;

export type RecommendationEvidenceLevel =
  (typeof RECOMMENDATION_EVIDENCE_LEVELS)[number];
export type RecommendationClaimRole =
  "supporting" | "contradicting" | "context";
export type ProvenanceStatus =
  "unclassified" | "pending_review" | "validated" | "rejected";

export interface EvidenceConfidenceResult {
  evidenceConfidencePct?: number;
  factors?: Record<string, unknown>;
  profile?: { name?: string; version?: number; basis?: string };
  refusal?: string;
  error?: string;
  missingFactors?: string[];
}

export interface RecommendationEvidenceItem {
  id: string;
  description: string | null;
  evidenceType: string | null;
  evidenceClass: string | null;
  evidenceLevel: RecommendationEvidenceLevel | null;
  claimRole: RecommendationClaimRole | null;
  classificationStatus: ProvenanceStatus;
  sourceSystem: string | null;
  sourceReference: string | null;
  revision: string | null;
  sourceDate: string | null;
  observedAt: string | null;
  applicability: string | null;
  verificationStatus: string;
  qualityGrade: string | null;
  applicabilityGrade: string | null;
  confidence: EvidenceConfidenceResult;
  recordedBy: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
}

export interface RecommendationEvidenceWorkspace {
  recommendation: { id: string; title: string; status: string };
  evidence: RecommendationEvidenceItem[];
  missingEvidence: string[];
  missingEvidenceBasis: string | null;
  packet: {
    validationStatus:
      "unrecorded" | "pending_review" | "validated" | "rejected" | "stale";
    storedDigest: string | null;
    currentDigest: string | null;
    recordedBy: string | null;
    reviewedBy: string | null;
    reviewedAt: string | null;
    reviewNote: string | null;
  };
  posture: {
    linkedEvidence: number;
    validatedClassifications: number;
    supporting: number;
    contradicting: number;
    context: number;
    unclassified: number;
    missingCount: number;
  };
  levels: RecommendationEvidenceLevel[];
  boundary: string;
  operationalAuthorization: false;
}

interface RpcResult {
  error?: string;
  [key: string]: unknown;
}

function asserted<T>(data: unknown, fallback: string): T {
  const result = data as RpcResult | null;
  if (result?.error) throw new Error(result.error);
  if (!result) throw new Error(fallback);
  return result as unknown as T;
}

export async function getRecommendationEvidenceWorkspace(
  recommendationId: string,
): Promise<RecommendationEvidenceWorkspace> {
  const { data, error } = await supabase.rpc(
    "get_recommendation_evidence_workspace",
    { p_recommendation_id: recommendationId },
  );
  if (error) throw new Error(error.message);
  return asserted<RecommendationEvidenceWorkspace>(
    data,
    "Recommendation evidence workspace returned no data.",
  );
}

export async function proposeRecommendationEvidenceClassification(input: {
  evidenceId: string;
  evidenceLevel: RecommendationEvidenceLevel;
  claimRole: RecommendationClaimRole;
  sourceReference: string;
  revision: string;
  sourceDate: string;
  applicability: string;
}): Promise<RpcResult> {
  const { data, error } = await supabase.rpc(
    "propose_recommendation_evidence_classification",
    {
      p_evidence_id: input.evidenceId,
      p_evidence_level: input.evidenceLevel,
      p_claim_role: input.claimRole,
      p_source_reference: input.sourceReference,
      p_revision: input.revision,
      p_source_date: input.sourceDate,
      p_applicability: input.applicability,
    },
  );
  if (error) throw new Error(error.message);
  return asserted<RpcResult>(data, "Evidence classification returned no data.");
}

export async function reviewRecommendationEvidenceClassification(input: {
  evidenceId: string;
  decision: "validated" | "rejected";
  reviewNote: string;
}): Promise<RpcResult> {
  const { data, error } = await supabase.rpc(
    "review_recommendation_evidence_classification",
    {
      p_evidence_id: input.evidenceId,
      p_decision: input.decision,
      p_review_note: input.reviewNote,
    },
  );
  if (error) throw new Error(error.message);
  return asserted<RpcResult>(data, "Evidence review returned no data.");
}

export async function setRecommendationMissingEvidence(input: {
  recommendationId: string;
  missingEvidence: string[];
  basis: string;
}): Promise<RpcResult> {
  const { data, error } = await supabase.rpc(
    "set_recommendation_missing_evidence",
    {
      p_recommendation_id: input.recommendationId,
      p_missing_evidence: input.missingEvidence,
      p_basis: input.basis,
    },
  );
  if (error) throw new Error(error.message);
  return asserted<RpcResult>(
    data,
    "Missing-evidence submission returned no data.",
  );
}

export async function reviewRecommendationEvidencePacket(input: {
  recommendationId: string;
  decision: "validated" | "rejected";
  reviewNote: string;
}): Promise<RpcResult> {
  const { data, error } = await supabase.rpc(
    "review_recommendation_evidence_packet",
    {
      p_recommendation_id: input.recommendationId,
      p_decision: input.decision,
      p_review_note: input.reviewNote,
    },
  );
  if (error) throw new Error(error.message);
  return asserted<RpcResult>(data, "Evidence-packet review returned no data.");
}
