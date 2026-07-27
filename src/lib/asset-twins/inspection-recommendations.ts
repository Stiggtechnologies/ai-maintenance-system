import {
  toEvidenceItemDraft,
  type EvidenceItemDraft,
  type InspectionFinding,
} from "./inspection-findings";
import type { AssetClassTemplate, FailureModeTemplate } from "./types";

export type RecommendationUrgency = "critical" | "action" | "advisory";
export type RecommendationRiskImpact = "High" | "Medium" | "Low";

/**
 * Insert-ready fields for the existing operating-loop `recommendations` table.
 * Organization and agent identities are stamped by the persistence boundary.
 */
export interface InspectionRecommendationDraft {
  asset_id: string;
  agent_id: null;
  title: string;
  issue: string;
  action: string;
  impact: string;
  confidence: number;
  urgency: RecommendationUrgency;
  status: "pending";
  approval_required: string;
  accountable: string;
  responsible: string;
  consulted: string;
  informed: string;
  financial_impact: null;
  risk_impact: RecommendationRiskImpact;
  rationale: string;
}

/** Insert-ready fields for the existing operating-loop `approvals` table. */
export interface InspectionApprovalDraft {
  recommendation_id: string | null;
  work_order_id: null;
  status: "required";
  owner_role: string;
  approver: null;
  reason: string;
  consequence_of_wrong: string;
  required_validation: string;
}

export interface InspectionRecommendationPackage {
  sourceFindingId: string;
  recommendation: InspectionRecommendationDraft;
  approval: InspectionApprovalDraft;
  evidenceItems: EvidenceItemDraft[];
  autonomousExecutionAllowed: false;
  prohibitedAutonomousActions: string[];
}

export interface InspectionRecommendationValidationIssue {
  path: string;
  message: string;
}

const PROHIBITED_AUTONOMOUS_ACTIONS = [
  "change shutdown or return-to-service state",
  "change operating limits or protection settings",
  "bypass safeguards or interlocks",
  "approve safety-critical work",
  "declare the asset fit for service",
];

function riskImpact(severity: number): RecommendationRiskImpact {
  if (severity >= 4) return "High";
  if (severity >= 3) return "Medium";
  return "Low";
}

function urgency(severity: number): RecommendationUrgency {
  if (severity >= 5) return "critical";
  if (severity >= 3) return "action";
  return "advisory";
}

function boundedConfidence(confidence: number): number {
  return Math.max(0, Math.min(100, Math.round(confidence * 100)));
}

function candidateFailureModes(
  finding: InspectionFinding,
  template: AssetClassTemplate,
): FailureModeTemplate[] {
  const component = template.components.find((item) => item.code === finding.componentCode);
  if (!component) throw new Error(`Unknown canonical component ${finding.componentCode}.`);

  const byCode = new Map(component.failureModes.map((item) => [item.code, item]));
  return finding.candidateFailureModeCodes.map((code) => {
    const failureMode = byCode.get(code);
    if (!failureMode) throw new Error(`Unknown failure mode ${code} for ${finding.componentCode}.`);
    return failureMode;
  });
}

function recommendationAction(finding: InspectionFinding): string {
  if (finding.disposition !== "engineer_confirmed") {
    return [
      `Complete independent verification using: ${finding.verificationRequired.join(", ")}.`,
      "Keep the finding in human review until the evidence is validated.",
      "Obtain site-authorized engineering and operations direction before changing operating conditions or creating safety-critical work.",
    ].join(" ");
  }

  if (finding.severity >= 4) {
    return [
      "Escalate to qualified engineering and operations for an approved risk-control and corrective-work decision.",
      "Use the existing approval and work-order process; do not autonomously change shutdown state, return-to-service status, operating limits, or protection settings.",
    ].join(" ");
  }

  return [
    "Develop a site-approved corrective work scope and schedule through the existing approval and work-order process.",
    "Confirm applicable OEM and site requirements before execution.",
  ].join(" ");
}

export function createInspectionRecommendationPackage(
  finding: InspectionFinding,
  template: AssetClassTemplate,
): InspectionRecommendationPackage {
  if (finding.disposition === "rejected") {
    throw new Error("Rejected inspection findings cannot generate recommendations.");
  }

  const component = template.components.find((item) => item.code === finding.componentCode);
  if (!component) throw new Error(`Unknown canonical component ${finding.componentCode}.`);

  const failureModes = candidateFailureModes(finding, template);
  const effectiveSeverity = Math.max(
    finding.severity,
    ...failureModes.map((item) => item.severity),
  );
  const highConsequence = effectiveSeverity >= 4;
  const unconfirmed = finding.disposition !== "engineer_confirmed";
  const ownerRole = highConsequence
    ? "qualified_engineering_and_operations"
    : unconfirmed
      ? "reliability_engineer"
      : "maintenance_manager";
  const failureCodes = finding.candidateFailureModeCodes.length
    ? finding.candidateFailureModeCodes.join(", ")
    : "not yet assigned";
  const assumptions = finding.assumptions.length
    ? finding.assumptions.join("; ")
    : "none recorded";
  const requiredValidation = unconfirmed
    ? finding.verificationRequired.join(", ")
    : "Confirm engineering disposition, applicable OEM/site limits, operating state, and approved work scope.";

  return {
    sourceFindingId: finding.id,
    recommendation: {
      asset_id: finding.assetId,
      agent_id: null,
      title: unconfirmed
        ? `Verify inspection finding: ${finding.title}`
        : `Review corrective action: ${finding.title}`,
      issue: `${finding.description} Canonical component: ${component.name} (${component.code}).`,
      action: recommendationAction(finding),
      impact: `Potential ${riskImpact(effectiveSeverity).toLowerCase()} impact to safe and reliable operation. Quantify production and financial exposure from site data before approval.`,
      confidence: boundedConfidence(finding.confidence),
      urgency: urgency(effectiveSeverity),
      status: "pending",
      approval_required: ownerRole,
      accountable: ownerRole,
      responsible: "reliability_engineer",
      consulted: "operations, maintenance, safety, and qualified engineering as applicable",
      informed: "asset_owner",
      financial_impact: null,
      risk_impact: riskImpact(effectiveSeverity),
      rationale: [
        `Source finding: ${finding.id}`,
        `Candidate failure modes: ${failureCodes}`,
        `Evidence artifacts: ${finding.evidenceArtifactIds.join(", ")}`,
        `Assumptions: ${assumptions}`,
        `Review state: ${finding.reviewState}`,
      ].join(" | "),
    },
    approval: {
      recommendation_id: null,
      work_order_id: null,
      status: "required",
      owner_role: ownerRole,
      approver: null,
      reason: `Inspection finding ${finding.id} requires a human decision before downstream work action.`,
      consequence_of_wrong:
        "A false positive may create unnecessary inspection or work; a false negative may leave a developing failure or safety exposure unmitigated.",
      required_validation: requiredValidation || "Qualified human review and site-approved validation are required.",
    },
    evidenceItems: [toEvidenceItemDraft(finding)],
    autonomousExecutionAllowed: false,
    prohibitedAutonomousActions: [...PROHIBITED_AUTONOMOUS_ACTIONS],
  };
}

export function linkInspectionRecommendationPackage(
  recommendationId: string,
  packageDraft: InspectionRecommendationPackage,
): InspectionRecommendationPackage {
  if (!recommendationId.trim()) throw new Error("Recommendation ID is required.");
  return {
    ...packageDraft,
    approval: { ...packageDraft.approval, recommendation_id: recommendationId },
    evidenceItems: packageDraft.evidenceItems.map((item) => ({
      ...item,
      recommendation_id: recommendationId,
    })),
  };
}

export function validateInspectionRecommendationPackage(
  packageDraft: InspectionRecommendationPackage,
): InspectionRecommendationValidationIssue[] {
  const issues: InspectionRecommendationValidationIssue[] = [];
  const { recommendation, approval } = packageDraft;

  if (recommendation.status !== "pending") {
    issues.push({ path: "recommendation.status", message: "Inspection recommendations must start pending." });
  }
  if (approval.status !== "required") {
    issues.push({ path: "approval.status", message: "Inspection recommendations require a human approval record." });
  }
  if (packageDraft.autonomousExecutionAllowed !== false) {
    issues.push({ path: "autonomousExecutionAllowed", message: "Inspection recommendations cannot authorize autonomous execution." });
  }
  if (recommendation.financial_impact !== null) {
    issues.push({ path: "recommendation.financial_impact", message: "Financial impact must come from site evidence, not inspection inference." });
  }
  if (!Number.isInteger(recommendation.confidence) || recommendation.confidence < 0 || recommendation.confidence > 100) {
    issues.push({ path: "recommendation.confidence", message: "Recommendation confidence must be an integer from 0 to 100." });
  }
  if (!recommendation.approval_required.trim() || recommendation.approval_required !== approval.owner_role) {
    issues.push({ path: "recommendation.approval_required", message: "Recommendation and approval ownership must match." });
  }
  if (packageDraft.evidenceItems.length === 0) {
    issues.push({ path: "evidenceItems", message: "At least one evidence item is required." });
  }
  if (packageDraft.prohibitedAutonomousActions.length === 0) {
    issues.push({ path: "prohibitedAutonomousActions", message: "The autonomous-action boundary must be explicit." });
  }

  return issues;
}
