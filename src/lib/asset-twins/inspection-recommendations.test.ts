import { describe, expect, it } from "vitest";
import { electricRopeShovelTemplate } from "./mining-library";
import type { InspectionFinding } from "./inspection-findings";
import {
  createInspectionRecommendationPackage,
  linkInspectionRecommendationPackage,
  validateInspectionRecommendationPackage,
} from "./inspection-recommendations";

const finding: InspectionFinding = {
  schemaVersion: "0.1.0",
  id: "finding-hoist-rope-1",
  assetId: "shovel-04",
  inspectionZoneCode: "4100XPC-INSPECT-HOIST",
  componentCode: "ERS-HOIST",
  candidateFailureModeCodes: ["ERS-HOIST-ROPE-DAMAGE"],
  title: "Possible localized rope deterioration",
  description: "RGB evidence indicates a candidate surface discontinuity requiring qualified inspection.",
  severity: 3,
  confidence: 0.72,
  disposition: "triage_required",
  evidenceArtifactIds: ["artifact-1"],
  verificationRequired: ["qualified_rope_inspection", "magnetic_rope_test"],
  assumptions: ["capture location and rope identity were recorded correctly"],
  createdAt: "2026-07-27T10:05:00.000Z",
  reviewState: "ai_extracted",
};

describe("inspection recommendation bridge", () => {
  it("creates a bounded pending recommendation with an explicit approval gate", () => {
    const packageDraft = createInspectionRecommendationPackage(
      finding,
      electricRopeShovelTemplate,
    );

    expect(validateInspectionRecommendationPackage(packageDraft)).toEqual([]);
    expect(packageDraft.recommendation).toMatchObject({
      asset_id: "shovel-04",
      confidence: 72,
      urgency: "action",
      status: "pending",
      approval_required: "reliability_engineer",
      financial_impact: null,
      risk_impact: "Medium",
    });
    expect(packageDraft.recommendation.action).toContain("Complete independent verification");
    expect(packageDraft.approval.status).toBe("required");
    expect(packageDraft.autonomousExecutionAllowed).toBe(false);
  });

  it("escalates a severity-five finding to qualified engineering and operations", () => {
    const packageDraft = createInspectionRecommendationPackage(
      { ...finding, severity: 5, confidence: 0.91 },
      electricRopeShovelTemplate,
    );

    expect(packageDraft.recommendation.urgency).toBe("critical");
    expect(packageDraft.recommendation.risk_impact).toBe("High");
    expect(packageDraft.recommendation.approval_required).toBe(
      "qualified_engineering_and_operations",
    );
    expect(packageDraft.approval.owner_role).toBe(
      "qualified_engineering_and_operations",
    );
  });

  it("does not infer financial value or grant autonomous operating authority", () => {
    const packageDraft = createInspectionRecommendationPackage(
      { ...finding, disposition: "engineer_confirmed", reviewState: "engineer_reviewed" },
      electricRopeShovelTemplate,
    );

    expect(packageDraft.recommendation.financial_impact).toBeNull();
    expect(packageDraft.autonomousExecutionAllowed).toBe(false);
    expect(packageDraft.prohibitedAutonomousActions).toEqual(
      expect.arrayContaining([
        "change shutdown or return-to-service state",
        "change operating limits or protection settings",
        "approve safety-critical work",
      ]),
    );
    expect(packageDraft.recommendation.action).toContain("existing approval and work-order process");
  });

  it("preserves failure, evidence, and assumption provenance in the rationale", () => {
    const packageDraft = createInspectionRecommendationPackage(
      finding,
      electricRopeShovelTemplate,
    );

    expect(packageDraft.recommendation.rationale).toContain("ERS-HOIST-ROPE-DAMAGE");
    expect(packageDraft.recommendation.rationale).toContain("artifact-1");
    expect(packageDraft.recommendation.rationale).toContain("capture location and rope identity");
  });

  it("links approval and evidence drafts after the recommendation is persisted", () => {
    const linked = linkInspectionRecommendationPackage(
      "recommendation-1",
      createInspectionRecommendationPackage(finding, electricRopeShovelTemplate),
    );

    expect(linked.approval.recommendation_id).toBe("recommendation-1");
    expect(linked.evidenceItems.every((item) => item.recommendation_id === "recommendation-1")).toBe(true);
  });

  it("refuses to generate a recommendation from a rejected finding", () => {
    expect(() =>
      createInspectionRecommendationPackage(
        { ...finding, disposition: "rejected" },
        electricRopeShovelTemplate,
      ),
    ).toThrow("Rejected inspection findings");
  });
});
