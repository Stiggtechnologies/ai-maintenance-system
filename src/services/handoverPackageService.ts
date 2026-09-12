import { supabase } from "../lib/supabase";

export interface HandoverReadinessDimension {
  status: "READY" | "NOT_READY" | "NOT_ASSESSED";
  satisfied: number;
  total: number;
  percent: number | null;
  source: string;
  categories?: string[];
  openPunchCount?: number;
  gaps: Array<{
    itemId?: string;
    testId?: number;
    assetId?: string;
    asset?: string;
    category?: string;
    item?: string;
    testRef?: string;
    status?: string;
    releaseStatus?: string;
    outcome?: string;
    evidenceReady?: boolean;
    openPunchCount?: number;
  }>;
}

export interface SystemHandoverReadiness {
  systemId: number;
  currentState: string | null;
  physicalReadiness: HandoverReadinessDimension;
  informationReadiness: HandoverReadinessDimension;
  operationalReadiness: HandoverReadinessDimension;
  residualRisks: Array<{
    riskId: string;
    title: string;
    status: string;
    riskLevel: string | null;
    accepted: boolean;
  }>;
  residualRiskCount: number;
  acceptedResidualRiskCount: number;
  canAccept: boolean;
  blockers: string[];
  decisionBoundary: string;
}

export interface CaseSystemHandoverPackages {
  caseId: string;
  systems: Array<{
    systemId: number;
    systemRef: string;
    title: string;
    systemOwnerId: string;
    currentState: string | null;
    package: null | {
      id: number;
      version: number;
      status: "draft" | "accepted";
      ownerFromId: string;
      ownerFrom: string | null;
      ownerToId: string;
      ownerTo: string | null;
      requiredAcceptanceDate: string;
      preparedBy: string;
      preparedAt: string;
      preparationEvidenceItemId: string;
      acceptedBy: string | null;
      acceptedAt: string | null;
      acceptanceEvidenceItemId: string | null;
    };
    readiness: SystemHandoverReadiness;
  }>;
  readinessStores: Record<string, string>;
  equipmentReleaseBoundary: string;
  decisionBoundary: string;
}

function unwrap<T>(data: unknown, error: { message: string } | null): T {
  if (error) throw new Error(error.message);
  if (data && typeof data === "object" && "error" in data) {
    const response = data as { error: unknown; blockers?: unknown };
    const blockers = Array.isArray(response.blockers)
      ? ` ${response.blockers.join(" ")}`
      : "";
    throw new Error(`${String(response.error)}${blockers}`);
  }
  return data as T;
}

export async function getCaseSystemHandoverPackages(caseId: string) {
  const { data, error } = await supabase.rpc(
    "get_case_system_handover_packages",
    { p_case_id: caseId },
  );
  return unwrap<CaseSystemHandoverPackages>(data, error);
}

export async function assembleSystemHandoverPackage(input: {
  systemId: number;
  ownerFrom: string;
  ownerTo: string;
  requiredAcceptanceDate: string;
  basis: string;
  evidenceItemId: string;
}) {
  const { data, error } = await supabase.rpc(
    "assemble_system_handover_package",
    {
      p_system_id: input.systemId,
      p_owner_from: input.ownerFrom,
      p_owner_to: input.ownerTo,
      p_required_acceptance_date: input.requiredAcceptanceDate,
      p_basis: input.basis,
      p_evidence_item_id: input.evidenceItemId,
    },
  );
  return unwrap<{
    packageId: number;
    systemId: number;
    version: number;
    status: "draft";
    residualRiskCount: number;
  }>(data, error);
}

export interface HandoverAgentResult {
  advisory: true;
  caseId: string;
  draft: {
    packageId: number;
    systemId: number;
    version: number;
    status: "draft";
    residualRiskCount: number;
    decisionBoundary: string;
  };
  readiness: SystemHandoverReadiness;
  evidenceRefs: string[];
  disclaimer: string;
}

export async function runHandoverAgent(input: {
  caseId: string;
  systemId: number;
  ownerFrom: string;
  ownerTo: string;
  requiredAcceptanceDate: string;
  basis: string;
  evidenceItemId: string;
}): Promise<HandoverAgentResult> {
  const { data, error } = await supabase.functions.invoke(
    "develop-handover-agent",
    {
      body: {
        case_id: input.caseId,
        system_id: input.systemId,
        owner_from: input.ownerFrom,
        owner_to: input.ownerTo,
        required_acceptance_date: input.requiredAcceptanceDate,
        basis: input.basis,
        evidence_item_id: input.evidenceItemId,
      },
    },
  );
  return unwrap<HandoverAgentResult>(data, error);
}

export async function acceptSystemHandoverPackage(input: {
  packageId: number;
  basis: string;
  evidenceItemId: string;
}) {
  const { data, error } = await supabase.rpc(
    "accept_system_handover_package",
    {
      p_package_id: input.packageId,
      p_basis: input.basis,
      p_evidence_item_id: input.evidenceItemId,
    },
  );
  return unwrap<{
    packageId: number;
    systemId: number;
    version: number;
    status: "accepted";
    acceptedAt: string;
    commissioningState: "ACCEPTED";
  }>(data, error);
}
