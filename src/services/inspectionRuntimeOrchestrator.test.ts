import { beforeEach, describe, expect, it, vi } from "vitest";
import { electricRopeShovelTemplate } from "../lib/asset-twins/mining-library";
import { getKomatsu4100XpcInspectionZone } from "../lib/asset-twins/komatsu-4100xpc-inspections";
import type {
  InspectionEvidenceArtifact,
  InspectionFinding,
} from "../lib/asset-twins/inspection-findings";

const mocks = vi.hoisted(() => ({
  persist: vi.fn(),
}));

vi.mock("./inspectionRecommendationPersistence", () => ({
  persistInspectionRecommendationPackage: mocks.persist,
}));

import { runInspectionFindingWorkflow } from "./inspectionRuntimeOrchestrator";

const contract = getKomatsu4100XpcInspectionZone(
  "4100XPC-INSPECT-HOIST",
)!;

const artifact: InspectionEvidenceArtifact = {
  id: "artifact-runtime-1",
  modality: "drone_rgb",
  uri: "s3://authorized-inspections/shovel-04/hoist/image-001.jpg",
  capturedAt: "2026-07-27T10:00:00.000Z",
  repeatabilityKey: "4100xpc-hoist-rgb",
  metadata: { missionId: "mission-runtime-1" },
};

const finding: InspectionFinding = {
  schemaVersion: "0.1.0",
  id: "finding-runtime-1",
  assetId: "aaaaaaaa-0000-0000-0000-000000000006",
  inspectionZoneCode: contract.code,
  componentCode: "ERS-HOIST",
  candidateFailureModeCodes: ["ERS-HOIST-ROPE-DAMAGE"],
  title: "Possible localized rope deterioration",
  description:
    "RGB evidence indicates a candidate surface discontinuity requiring qualified inspection.",
  severity: 3,
  confidence: 0.72,
  disposition: "triage_required",
  evidenceArtifactIds: [artifact.id],
  verificationRequired: [
    "qualified_rope_inspection",
    "magnetic_rope_test",
  ],
  assumptions: [
    "capture location and rope identity were recorded correctly",
  ],
  createdAt: "2026-07-27T10:05:00.000Z",
  reviewState: "ai_extracted",
};

const request = {
  finding,
  artifacts: [artifact],
  contract,
  template: electricRopeShovelTemplate,
};

describe("inspection runtime orchestrator", () => {
  beforeEach(() => {
    mocks.persist.mockReset();
  });

  it("validates, packages, and persists a finding into the approval queue", async () => {
    mocks.persist.mockResolvedValue({
      recommendationId: "recommendation-runtime-1",
      approvalId: "approval-runtime-1",
      evidenceItemIds: ["evidence-runtime-1"],
      created: true,
    });

    await expect(runInspectionFindingWorkflow(request)).resolves.toEqual({
      recommendationId: "recommendation-runtime-1",
      approvalId: "approval-runtime-1",
      evidenceItemIds: ["evidence-runtime-1"],
      created: true,
      findingId: "finding-runtime-1",
      queueStatus: "pending_approval",
      autonomousExecutionAllowed: false,
      approvalOwnerRole: "reliability_engineer",
      urgency: "action",
    });

    expect(mocks.persist).toHaveBeenCalledTimes(1);
    expect(mocks.persist.mock.calls[0][0]).toMatchObject({
      sourceFindingId: finding.id,
      autonomousExecutionAllowed: false,
      recommendation: {
        asset_id: finding.assetId,
        status: "pending",
        financial_impact: null,
      },
      approval: { status: "required" },
    });
  });

  it("refuses an invalid finding before persistence", async () => {
    await expect(
      runInspectionFindingWorkflow({
        ...request,
        finding: { ...finding, evidenceArtifactIds: ["missing-artifact"] },
      }),
    ).rejects.toThrow(/Unknown evidence artifact/);

    expect(mocks.persist).not.toHaveBeenCalled();
  });

  it("refuses a finding attached to the wrong inspection contract", async () => {
    await expect(
      runInspectionFindingWorkflow({
        ...request,
        finding: {
          ...finding,
          inspectionZoneCode: "4100XPC-INSPECT-UPPER-STRUCTURE",
        },
      }),
    ).rejects.toThrow(/does not match the inspection contract/);

    expect(mocks.persist).not.toHaveBeenCalled();
  });

  it("does not generate recommendations from rejected findings", async () => {
    await expect(
      runInspectionFindingWorkflow({
        ...request,
        finding: { ...finding, disposition: "rejected" },
      }),
    ).rejects.toThrow(/Rejected inspection findings/);

    expect(mocks.persist).not.toHaveBeenCalled();
  });

  it("returns idempotent persistence results without changing queue governance", async () => {
    mocks.persist.mockResolvedValue({
      recommendationId: "recommendation-existing-1",
      approvalId: "approval-existing-1",
      evidenceItemIds: ["evidence-existing-1"],
      created: false,
    });

    const result = await runInspectionFindingWorkflow(request);
    expect(result.created).toBe(false);
    expect(result.queueStatus).toBe("pending_approval");
    expect(result.autonomousExecutionAllowed).toBe(false);
  });
});
