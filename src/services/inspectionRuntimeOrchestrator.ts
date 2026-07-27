import {
  validateInspectionFinding,
  type InspectionEvidenceArtifact,
  type InspectionFinding,
} from "../lib/asset-twins/inspection-findings";
import {
  createInspectionRecommendationPackage,
  type InspectionRecommendationPackage,
} from "../lib/asset-twins/inspection-recommendations";
import type { InspectionZoneContract } from "../lib/asset-twins/inspection-contracts";
import type { AssetClassTemplate } from "../lib/asset-twins/types";
import {
  persistInspectionRecommendationPackage,
  type PersistedInspectionRecommendationPackage,
} from "./inspectionRecommendationPersistence";

export interface InspectionRuntimeRequest {
  finding: InspectionFinding;
  artifacts: readonly InspectionEvidenceArtifact[];
  contract: InspectionZoneContract;
  template: AssetClassTemplate;
}

export interface InspectionRuntimeResult
  extends PersistedInspectionRecommendationPackage {
  findingId: string;
  queueStatus: "pending_approval";
  autonomousExecutionAllowed: false;
  approvalOwnerRole: string;
  urgency: InspectionRecommendationPackage["recommendation"]["urgency"];
}

function formatValidationIssues(
  issues: ReadonlyArray<{ path: string; message: string }>,
): string {
  return issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
}

/**
 * Runs the governed inspection-to-approval workflow.
 *
 * This is the application runtime boundary for inspection intelligence:
 * evidence and finding validation -> bounded recommendation generation ->
 * transactional persistence. Persisted recommendations remain pending and are
 * surfaced by the existing Mission Control recommendation/approval queries.
 * No work order, operating-state change, or autonomous side effect occurs here.
 */
export async function runInspectionFindingWorkflow(
  request: InspectionRuntimeRequest,
): Promise<InspectionRuntimeResult> {
  const { finding, artifacts, contract, template } = request;
  const findingIssues = validateInspectionFinding(
    finding,
    artifacts,
    contract,
    template,
  );

  if (findingIssues.length > 0) {
    throw new Error(
      `Invalid inspection finding: ${formatValidationIssues(findingIssues)}`,
    );
  }

  const packageDraft = createInspectionRecommendationPackage(finding, template);
  const persisted = await persistInspectionRecommendationPackage(packageDraft);

  return {
    ...persisted,
    findingId: finding.id,
    queueStatus: "pending_approval",
    autonomousExecutionAllowed: false,
    approvalOwnerRole: packageDraft.approval.owner_role,
    urgency: packageDraft.recommendation.urgency,
  };
}
