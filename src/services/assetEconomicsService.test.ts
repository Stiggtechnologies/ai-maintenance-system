import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();

vi.mock("../lib/supabase", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

import {
  getAssetEconomicsWorkspace,
  recordAssetEconomics,
} from "./assetEconomicsService";

beforeEach(() => vi.clearAllMocks());

describe("assetEconomicsService", () => {
  it("loads the canonical economics and capital-plan read model", async () => {
    rpc.mockResolvedValue({
      data: {
        assets: [],
        economics: [],
        verifiedEvidence: [],
        coverage: {
          assets: 0,
          assetsWithEconomics: 0,
          assetsWithCompleteEconomics: 0,
          snapshots: 0,
          overdueReviews: 0,
        },
        capitalPlans: [],
        currency: "USD",
        basis: "Explicit evidence only.",
        decisionBoundary: "No approval authority.",
      },
      error: null,
    });
    const result = await getAssetEconomicsWorkspace();
    expect(result.currency).toBe("USD");
    expect(rpc).toHaveBeenCalledWith("get_asset_economics_workspace", {});
  });

  it("sends an explicit versioned snapshot with unknown inputs left null", async () => {
    rpc.mockResolvedValue({
      data: {
        assetEconomicsId: "economics-1",
        version: 2,
        scope: "asset",
        currency: "USD",
        status: "recorded",
        expenditureAuthorized: false,
        projectSanctioned: false,
        workAuthorized: false,
        riskAccepted: false,
        returnToServiceAuthorized: false,
      },
      error: null,
    });
    await recordAssetEconomics({
      assetId: "asset-1",
      replacementValueUsd: 1_200_000,
      annualMaintenanceCostUsd: 95_000,
      downtimeCostPerHourUsd: null,
      expectedRepairCostUsd: 70_000,
      expectedRepairHours: 36,
      expectedRemainingLifeYears: 8,
      basis:
        "Approved 2027 lifecycle-cost estimate and maintained asset ledger.",
      sourceSystem: "ERP-2027-BUDGET",
      evidenceItemId: "evidence-1",
      effectiveFrom: "2027-01-01",
      reviewDue: "2027-12-31",
      expectedVersion: 1,
    });
    expect(rpc).toHaveBeenCalledWith("record_asset_economics_snapshot", {
      p_snapshot: expect.objectContaining({
        assetId: "asset-1",
        assetClass: null,
        replacementValueUsd: 1_200_000,
        downtimeCostPerHourUsd: null,
        evidenceItemId: "evidence-1",
        expectedVersion: 1,
      }),
    });
  });

  it("refuses ambiguous scope, invented emptiness and malformed economics before the RPC", async () => {
    const common = {
      basis: "Approved economics basis with sufficient context.",
      sourceSystem: "ERP",
      evidenceItemId: "evidence-1",
      effectiveFrom: "2027-01-01",
      expectedVersion: 0,
    };
    await expect(
      recordAssetEconomics({
        ...common,
        assetId: "asset-1",
        assetClass: "pump",
        replacementValueUsd: 10,
      }),
    ).rejects.toThrow(/exactly one/i);
    await expect(
      recordAssetEconomics({ ...common, assetId: "asset-1" }),
    ).rejects.toThrow(/at least one known/i);
    await expect(
      recordAssetEconomics({
        ...common,
        assetId: "asset-1",
        replacementValueUsd: Number.NaN,
      }),
    ).rejects.toThrow(/replacement value must be positive/i);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("surfaces database refusal envelopes", async () => {
    rpc.mockResolvedValue({
      data: { error: "Asset economics changed after it was loaded" },
      error: null,
    });
    await expect(
      recordAssetEconomics({
        assetClass: "pump",
        annualMaintenanceCostUsd: 15_000,
        basis: "Approved maintenance ledger for the governed pump class.",
        sourceSystem: "CMMS",
        evidenceItemId: "evidence-1",
        effectiveFrom: "2027-01-01",
        expectedVersion: 1,
      }),
    ).rejects.toThrow(/changed after it was loaded/i);
  });
});
