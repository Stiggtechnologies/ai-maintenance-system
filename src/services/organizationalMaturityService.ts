import { supabase } from "../lib/supabase";

export const ORGANIZATIONAL_MATURITY_DOMAINS = [
  "leadership",
  "hierarchy",
  "work_management",
  "planning_scheduling",
  "failure_coding",
  "pm_quality",
  "condition_monitoring",
  "materials",
  "engineering_governance",
  "data_quality",
  "workforce",
  "financial_integration",
  "ai_governance",
] as const;

export type OrganizationalMaturityDomainKey =
  (typeof ORGANIZATIONAL_MATURITY_DOMAINS)[number];

export interface OrganizationalMaturityDomain {
  domainKey: OrganizationalMaturityDomainKey;
  score: number;
  finding: string;
  evidenceItemId: string;
  evidenceDescription?: string | null;
  evidenceVerificationStatus?: "verified";
}

export interface OrganizationalMaturityRecommendation {
  id: string;
  domainKey: OrganizationalMaturityDomainKey;
  title: string;
  action: string;
  status: string;
  approvalRequired: string;
}

export interface OrganizationalMaturityAssessment {
  id: string;
  title: string;
  scope: string;
  evidenceSummary: string;
  status: "submitted" | "approved" | "rejected" | "superseded";
  overallLevel: number;
  minimumLevel: number;
  assessedBy: string;
  assessedAt: string;
  nextReview: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  domains: OrganizationalMaturityDomain[];
  recommendations: OrganizationalMaturityRecommendation[];
  operationalAuthorization: false;
  certificationClaim: false;
}

export interface OrganizationalMaturityWorkspace {
  dimensions: OrganizationalMaturityDomainKey[];
  scale: Array<{ level: number; label: string }>;
  assessments: OrganizationalMaturityAssessment[];
  basis: string;
}

interface RpcResponse {
  error?: string;
  [key: string]: unknown;
}

function assertRpc<T>(data: unknown, fallback: string): T {
  const value = (data ?? {}) as RpcResponse;
  if (value.error) throw new Error(value.error);
  if (!data) throw new Error(fallback);
  return data as T;
}

export async function getOrganizationalMaturityWorkspace(): Promise<OrganizationalMaturityWorkspace> {
  const { data, error } = await supabase.rpc(
    "get_organizational_maturity_workspace",
  );
  if (error) throw new Error(error.message);
  return assertRpc<OrganizationalMaturityWorkspace>(
    data,
    "Organizational maturity workspace returned no data.",
  );
}

export async function recordOrganizationalMaturityAssessment(input: {
  title: string;
  scope: string;
  evidenceSummary: string;
  nextReview?: string;
  domains: OrganizationalMaturityDomain[];
}): Promise<RpcResponse> {
  const { data, error } = await supabase.rpc(
    "record_organizational_maturity_assessment",
    { p_assessment: input },
  );
  if (error) throw new Error(error.message);
  return assertRpc<RpcResponse>(data, "Maturity assessment was not recorded.");
}

export async function reviewOrganizationalMaturityAssessment(input: {
  assessmentId: string;
  decision: "approved" | "rejected";
  reviewNote: string;
}): Promise<RpcResponse> {
  const { data, error } = await supabase.rpc(
    "review_organizational_maturity_assessment",
    {
      p_assessment_id: input.assessmentId,
      p_decision: input.decision,
      p_review_note: input.reviewNote,
    },
  );
  if (error) throw new Error(error.message);
  return assertRpc<RpcResponse>(data, "Maturity review was not recorded.");
}
