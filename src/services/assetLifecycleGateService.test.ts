import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();

vi.mock("../lib/supabase", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

import {
  advanceAssetLifecycleStage,
  getAssetLifecycleGateWorkspace,
  recordAssetDisposal,
  recordAssetLifecycleGateReview,
} from "./assetLifecycleGateService";

beforeEach(() => vi.clearAllMocks());

describe("assetLifecycleGateService", () => {
  it("loads the tenant-scoped canonical workspace for one asset", async () => {
    rpc.mockResolvedValue({
      data: {
        authority: { canAct: true, requiredAal: "aal2" },
        assets: [{ id: "asset-1", stageKey: "operation" }],
        stages: [],
        criteria: [],
        evidence: [],
        evaluations: [],
        reviews: [],
        disposal: null,
      },
      error: null,
    });
    const result = await getAssetLifecycleGateWorkspace("asset-1");
    expect(result.assets[0]?.stageKey).toBe("operation");
    expect(rpc).toHaveBeenCalledWith("get_asset_lifecycle_gate_workspace", {
      p_asset_id: "asset-1",
    });
  });

  it("serializes an exact criterion review with linked evidence", async () => {
    rpc.mockResolvedValue({
      data: { reviewId: 12, outcome: "pass", mayAdvance: true },
      error: null,
    });
    await recordAssetLifecycleGateReview({
      assetId: "asset-1",
      targetStageKey: "replacement",
      outcome: "pass",
      note: "Independent evidence and an accepted evaluation support replacement.",
      evaluationId: "evaluation-1",
      findings: [
        {
          criterionId: 7,
          status: "met",
          evidenceItemId: "evidence-1",
        },
      ],
    });
    expect(rpc).toHaveBeenCalledWith(
      "record_asset_lifecycle_gate_review",
      expect.objectContaining({
        p_asset_id: "asset-1",
        p_to_stage: "replacement",
        p_evaluation_id: "evaluation-1",
        p_findings: [
          expect.objectContaining({
            criterion_id: 7,
            status: "met",
            evidence_item_id: "evidence-1",
          }),
        ],
      }),
    );
  });

  it("requires a moved outcome from the separate movement act", async () => {
    rpc.mockResolvedValue({
      data: [{ outcome: "blocked", detail: "Fresh passing review required." }],
      error: null,
    });
    await expect(
      advanceAssetLifecycleStage({
        assetId: "asset-1",
        targetStageKey: "replacement",
        reason: "This reason is long enough but the current gate is not passing.",
      }),
    ).rejects.toThrow(/fresh passing review/i);
  });

  it("records versioned disposal without inventing financial authority", async () => {
    rpc.mockResolvedValue({
      data: {
        assetId: "asset-1",
        version: 2,
        disposalRoute: "scrap_recycle",
        restorationComplete: false,
        operationalAuthority: false,
        financialAuthority: false,
      },
      error: null,
    });
    const result = await recordAssetDisposal({
      assetId: "asset-1",
      disposalRoute: "scrap_recycle",
      disposedAt: "2026-10-04",
      recoveredValue: 1200,
      disposalCost: 300,
      currency: "cad",
      siteRestorationRequired: true,
      siteRestorationComplete: false,
      restorationObligation:
        "Remove the pad and verify that the soil meets the adopted closeout basis.",
      hazardousMaterialsRemoved: true,
      certificateReference: "CERT-1",
      evidenceItemId: "evidence-1",
      expectedVersion: 1,
    });
    expect(result.financialAuthority).toBe(false);
    expect(rpc).toHaveBeenCalledWith(
      "record_asset_disposal",
      expect.objectContaining({
        p_currency: "CAD",
        p_expected_version: 1,
        p_evidence_item_id: "evidence-1",
      }),
    );
  });
});
