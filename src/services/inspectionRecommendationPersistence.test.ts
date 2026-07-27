import { beforeEach, describe, expect, it, vi } from "vitest";
import { electricRopeShovelTemplate } from "../lib/asset-twins/mining-library";
import type { InspectionFinding } from "../lib/asset-twins/inspection-findings";
import { createInspectionRecommendationPackage } from "../lib/asset-twins/inspection-recommendations";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock("../lib/supabase", () => ({
  supabase: {
    rpc: mocks.rpc,
  },
}));

import { persistInspectionRecommendationPackage } from "./inspectionRecommendationPersistence";

const finding: InspectionFinding = {
  schemaVersion: "0.1.0",
  id: "finding-hoist-rope-atomic-1",
  assetId: "aaaaaaaa-0000-0000-0000-000000000006",
  inspectionZoneCode: "4100XPC-INSPECT-HOIST",
  componentCode: "ERS-HOIST",
  candidateFailureModeCodes: ["ERS-HOIST-ROPE-DAMAGE"],
  title: "Possible localized rope deterioration",
  description: "RGB evidence indicates a candidate surface discontinuity requiring qualified inspection.",
  severity: 3,
  confidence: 0.72,
  disposition: "triage_required",
  evidenceArtifactIds: ["artifact-atomic-1"],
  verificationRequired: ["qualified_rope_inspection", "magnetic_rope_test"],
  assumptions: ["capture location and rope identity were recorded correctly"],
  createdAt: "2026-07-27T10:05:00.000Z",
  reviewState: "ai_extracted",
};

const packageDraft = createInspectionRecommendationPackage(
  finding,
  electricRopeShovelTemplate,
);

describe("inspection recommendation persistence", () => {
  beforeEach(() => {
    mocks.rpc.mockReset();
  });

  it("persists the recommendation, approval, and evidence through one RPC call", async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        recommendation_id: "recommendation-atomic-1",
        approval_id: "approval-atomic-1",
        evidence_item_ids: ["evidence-atomic-1"],
        created: true,
      },
      error: null,
    });

    await expect(
      persistInspectionRecommendationPackage(packageDraft),
    ).resolves.toEqual({
      recommendationId: "recommendation-atomic-1",
      approvalId: "approval-atomic-1",
      evidenceItemIds: ["evidence-atomic-1"],
      created: true,
    });

    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "persist_inspection_recommendation_package",
      {
        p_source_finding_id: packageDraft.sourceFindingId,
        p_recommendation: packageDraft.recommendation,
        p_approval: packageDraft.approval,
        p_evidence_items: packageDraft.evidenceItems,
      },
    );
  });

  it("accepts an idempotent retry result without creating a duplicate", async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        recommendation_id: "recommendation-existing-1",
        approval_id: "approval-existing-1",
        evidence_item_ids: ["evidence-existing-1"],
        created: false,
      },
      error: null,
    });

    const result = await persistInspectionRecommendationPackage(packageDraft);
    expect(result.created).toBe(false);
    expect(result.recommendationId).toBe("recommendation-existing-1");
  });

  it("surfaces a database rollback or tenancy error", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "Asset not found in current organization" },
    });

    await expect(
      persistInspectionRecommendationPackage(packageDraft),
    ).rejects.toThrow(/Asset not found in current organization/);
  });

  it("rejects malformed RPC results instead of reporting partial success", async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        recommendation_id: "recommendation-1",
        approval_id: null,
        evidence_item_ids: [],
        created: true,
      },
      error: null,
    });

    await expect(
      persistInspectionRecommendationPackage(packageDraft),
    ).rejects.toThrow(/approval ID/);
  });

  it("does not call persistence for an invalid recommendation package", async () => {
    await expect(
      persistInspectionRecommendationPackage({
        ...packageDraft,
        evidenceItems: [],
      }),
    ).rejects.toThrow(/At least one evidence item is required/);

    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
