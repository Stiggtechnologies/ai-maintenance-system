import type { InspectionModality, InspectionZoneContract } from "./inspection-contracts";
import type { AssetClassTemplate, ReviewState } from "./types";

export type FindingDisposition =
  | "ai_detected"
  | "triage_required"
  | "engineer_confirmed"
  | "rejected";

export type FindingSeverity = 1 | 2 | 3 | 4 | 5;

export interface InspectionEvidenceArtifact {
  id: string;
  modality: InspectionModality;
  uri: string;
  capturedAt: string;
  repeatabilityKey: string;
  sha256?: string;
  metadata: Record<string, unknown>;
}

export interface InspectionFinding {
  schemaVersion: string;
  id: string;
  assetId: string;
  inspectionZoneCode: string;
  componentCode: string;
  candidateFailureModeCodes: string[];
  title: string;
  description: string;
  severity: FindingSeverity;
  confidence: number;
  disposition: FindingDisposition;
  evidenceArtifactIds: string[];
  verificationRequired: string[];
  assumptions: string[];
  createdAt: string;
  reviewState: ReviewState;
}

/**
 * Insert shape for the existing operating-loop `evidence_items` table.
 * This is deliberately an adapter, not a second evidence persistence model.
 */
export interface EvidenceItemDraft {
  recommendation_id: string | null;
  asset_id: string;
  source_system: "inspection_intelligence";
  evidence_type: string;
  description: string;
  confidence_contribution: number;
  data_quality: "unverified" | "reviewed" | "validated";
  related_asset: string;
  ts: string;
}

export interface InspectionFindingValidationIssue {
  path: string;
  message: string;
}

export function validateInspectionFinding(
  finding: InspectionFinding,
  artifacts: readonly InspectionEvidenceArtifact[],
  contract: InspectionZoneContract,
  template: AssetClassTemplate,
): InspectionFindingValidationIssue[] {
  const issues: InspectionFindingValidationIssue[] = [];
  const component = template.components.find((item) => item.code === finding.componentCode);
  const knownArtifactIds = new Set(artifacts.map((item) => item.id));
  const allowedRepeatabilityKeys = new Set(contract.captures.map((item) => item.repeatabilityKey));

  if (finding.inspectionZoneCode !== contract.code) {
    issues.push({ path: "inspectionZoneCode", message: "Finding does not match the inspection contract." });
  }
  if (finding.componentCode !== contract.componentCode || !component) {
    issues.push({ path: "componentCode", message: "Finding must reference the contract's canonical component." });
  }
  if (finding.confidence < 0 || finding.confidence > 1) {
    issues.push({ path: "confidence", message: "Confidence must be between 0 and 1." });
  }
  if (finding.evidenceArtifactIds.length === 0) {
    issues.push({ path: "evidenceArtifactIds", message: "At least one evidence artifact is required." });
  }
  for (const [index, artifactId] of finding.evidenceArtifactIds.entries()) {
    if (!knownArtifactIds.has(artifactId)) {
      issues.push({ path: `evidenceArtifactIds[${index}]`, message: `Unknown evidence artifact ${artifactId}.` });
    }
  }
  for (const [index, artifact] of artifacts.entries()) {
    if (!allowedRepeatabilityKeys.has(artifact.repeatabilityKey)) {
      issues.push({ path: `artifacts[${index}].repeatabilityKey`, message: "Artifact is not part of the inspection contract." });
    }
  }

  const knownFailureCodes = new Set(component?.failureModes.map((item) => item.code) ?? []);
  for (const [index, code] of finding.candidateFailureModeCodes.entries()) {
    if (!knownFailureCodes.has(code)) {
      issues.push({ path: `candidateFailureModeCodes[${index}]`, message: `Unknown failure mode ${code} for ${finding.componentCode}.` });
    }
  }

  if (finding.disposition === "engineer_confirmed" && finding.reviewState === "draft") {
    issues.push({ path: "reviewState", message: "Engineer-confirmed findings cannot remain in draft review state." });
  }
  if (finding.disposition !== "engineer_confirmed" && finding.verificationRequired.length === 0) {
    issues.push({ path: "verificationRequired", message: "Unconfirmed findings require an independent verification path." });
  }

  return issues;
}

export function toEvidenceItemDraft(finding: InspectionFinding): EvidenceItemDraft {
  const dataQuality: EvidenceItemDraft["data_quality"] =
    finding.disposition === "engineer_confirmed"
      ? "validated"
      : finding.reviewState === "engineer_reviewed" || finding.reviewState === "field_validated"
        ? "reviewed"
        : "unverified";

  return {
    recommendation_id: null,
    asset_id: finding.assetId,
    source_system: "inspection_intelligence",
    evidence_type: `inspection_finding:${finding.componentCode}`,
    description: `${finding.title}: ${finding.description}`,
    confidence_contribution: finding.confidence,
    data_quality: dataQuality,
    related_asset: finding.assetId,
    ts: finding.createdAt,
  };
}
