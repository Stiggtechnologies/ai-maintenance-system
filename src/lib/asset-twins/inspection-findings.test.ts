import { describe, expect, it } from "vitest";
import { electricRopeShovelTemplate } from "./mining-library";
import { getKomatsu4100XpcInspectionZone } from "./komatsu-4100xpc-inspections";
import {
  toEvidenceItemDraft,
  validateInspectionFinding,
  type InspectionEvidenceArtifact,
  type InspectionFinding,
} from "./inspection-findings";

const contract = getKomatsu4100XpcInspectionZone("4100XPC-INSPECT-HOIST")!;

const artifact: InspectionEvidenceArtifact = {
  id: "artifact-1",
  modality: "drone_rgb",
  uri: "s3://authorized-inspections/shovel-04/hoist/image-001.jpg",
  capturedAt: "2026-07-27T10:00:00.000Z",
  repeatabilityKey: "4100xpc-hoist-rgb",
  metadata: { missionId: "mission-1" },
};

const finding: InspectionFinding = {
  schemaVersion: "0.1.0",
  id: "finding-1",
  assetId: "shovel-04",
  inspectionZoneCode: contract.code,
  componentCode: "ERS-HOIST",
  candidateFailureModeCodes: ["ERS-HOIST-ROPE-DAMAGE"],
  title: "Possible localized rope deterioration",
  description: "Image evidence indicates a candidate surface discontinuity requiring qualified rope inspection.",
  severity: 3,
  confidence: 0.72,
  disposition: "triage_required",
  evidenceArtifactIds: [artifact.id],
  verificationRequired: ["qualified_rope_inspection", "magnetic_rope_test"],
  assumptions: ["capture location and rope identity were recorded correctly"],
  createdAt: "2026-07-27T10:05:00.000Z",
  reviewState: "ai_extracted",
};

describe("inspection findings", () => {
  it("validates a candidate finding against the canonical contract and failure library", () => {
    expect(validateInspectionFinding(finding, [artifact], contract, electricRopeShovelTemplate)).toEqual([]);
  });

  it("rejects unknown failure modes and artifacts", () => {
    const issues = validateInspectionFinding(
      {
        ...finding,
        candidateFailureModeCodes: ["ERS-HOIST-NOT-REAL"],
        evidenceArtifactIds: ["missing"],
      },
      [artifact],
      contract,
      electricRopeShovelTemplate,
    );

    expect(issues.map((item) => item.path)).toEqual(
      expect.arrayContaining(["candidateFailureModeCodes[0]", "evidenceArtifactIds[0]"]),
    );
  });

  it("requires independent verification before a finding is engineer confirmed", () => {
    const issues = validateInspectionFinding(
      { ...finding, verificationRequired: [] },
      [artifact],
      contract,
      electricRopeShovelTemplate,
    );
    expect(issues.some((item) => item.path === "verificationRequired")).toBe(true);
  });

  it("adapts findings into the existing operating-loop evidence shape", () => {
    expect(toEvidenceItemDraft(finding)).toEqual({
      recommendation_id: null,
      asset_id: "shovel-04",
      source_system: "inspection_intelligence",
      evidence_type: "inspection_finding:ERS-HOIST",
      description:
        "Possible localized rope deterioration: Image evidence indicates a candidate surface discontinuity requiring qualified rope inspection.",
      confidence_contribution: 0.72,
      data_quality: "unverified",
      related_asset: "shovel-04",
      ts: "2026-07-27T10:05:00.000Z",
    });
  });

  it("does not allow a draft finding to claim engineer confirmation", () => {
    const issues = validateInspectionFinding(
      { ...finding, disposition: "engineer_confirmed", reviewState: "draft" },
      [artifact],
      contract,
      electricRopeShovelTemplate,
    );
    expect(issues.some((item) => item.path === "reviewState")).toBe(true);
  });
});
