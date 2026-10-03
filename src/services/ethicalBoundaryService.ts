import { supabase } from "../lib/supabase";

export type EthicalBoundaryOutcome = "enforced" | "gap";
export type EthicalBoundaryReviewStatus =
  | "draft"
  | "remediation_required"
  | "review_pending"
  | "adopted"
  | "rejected"
  | "superseded";

export interface EthicalBoundaryDefinition {
  key: string;
  title: string;
  prohibition: string;
  controlFamily: string;
  verificationRequirement: string;
  platformControlReference: string;
  version: number;
}

export interface EthicalBoundaryPerson {
  id: string;
  name: string;
  role: string;
}

export interface EthicalBoundaryEvidence {
  id: string;
  description: string | null;
  sourceSystem: string | null;
  evidenceType: string | null;
  verifiedBy: string;
  verifiedAt: string;
  qualityGrade: "high" | "moderate" | "low" | null;
  timestamp: string;
}

export interface EthicalBoundaryDetermination {
  id: string;
  boundaryKey: string;
  outcome: EthicalBoundaryOutcome;
  controlDescription: string;
  verificationProcedure: string;
  evidenceItemId: string;
  accountableOwnerId: string;
  accountableOwner: string;
  remediation: string | null;
  assessedBy: string;
  assessedAt: string;
}

export interface EthicalBoundaryReview {
  id: string;
  title: string;
  scope: string;
  purpose: string;
  effectiveOn: string;
  nextReviewOn: string;
  status: EthicalBoundaryReviewStatus;
  current: boolean;
  createdBy: string;
  submittedBy: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  determinations: EthicalBoundaryDetermination[];
}

export interface EthicalBoundaryWorkspace {
  boundaries: EthicalBoundaryDefinition[];
  people: EthicalBoundaryPerson[];
  verifiedEvidence: EthicalBoundaryEvidence[];
  reviews: EthicalBoundaryReview[];
  basis: string;
}

interface RpcEnvelope {
  error?: string;
  [key: string]: unknown;
}

function requirePayload<T>(data: unknown, fallback: string): T {
  const payload = (data ?? {}) as RpcEnvelope;
  if (payload.error) throw new Error(payload.error);
  if (!data) throw new Error(fallback);
  return data as T;
}

async function rpc<T>(
  name: string,
  args: Record<string, unknown>,
  fallback: string,
): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  return requirePayload<T>(data, fallback);
}

export function getEthicalBoundaryWorkspace(): Promise<EthicalBoundaryWorkspace> {
  return rpc(
    "get_ethical_boundary_workspace",
    {},
    "Ethical-boundary workspace returned no data.",
  );
}

export function createEthicalBoundaryReview(input: {
  title: string;
  scope: string;
  purpose: string;
  effectiveOn: string;
  nextReviewOn: string;
}): Promise<RpcEnvelope> {
  return rpc(
    "create_ethical_boundary_review",
    { p_review: input },
    "Ethical-boundary review was not created.",
  );
}

export function setEthicalBoundaryDetermination(input: {
  reviewId: string;
  boundaryKey: string;
  outcome: EthicalBoundaryOutcome;
  controlDescription: string;
  verificationProcedure: string;
  evidenceItemId: string;
  accountableOwnerId: string;
  remediation?: string;
}): Promise<RpcEnvelope> {
  const { reviewId, ...determination } = input;
  return rpc(
    "set_ethical_boundary_determination",
    { p_review_id: reviewId, p_determination: determination },
    "Ethical-boundary determination was not saved.",
  );
}

export function submitEthicalBoundaryReview(
  reviewId: string,
  basis: string,
): Promise<RpcEnvelope> {
  return rpc(
    "submit_ethical_boundary_review",
    { p_review_id: reviewId, p_basis: basis },
    "Ethical-boundary review was not submitted.",
  );
}

export function reviewEthicalBoundaries(input: {
  reviewId: string;
  decision: "approved" | "rejected";
  reviewNote: string;
}): Promise<RpcEnvelope> {
  return rpc(
    "review_ethical_boundaries",
    {
      p_review_id: input.reviewId,
      p_decision: input.decision,
      p_review_note: input.reviewNote,
    },
    "Independent ethical-boundary review was not recorded.",
  );
}
