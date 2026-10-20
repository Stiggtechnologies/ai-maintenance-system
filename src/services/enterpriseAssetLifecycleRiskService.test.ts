import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();

vi.mock("../lib/supabase", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

import { getEnterpriseAssetLifecycleRisk } from "./enterpriseAssetLifecycleRiskService";
import { recordInitialAssetLifecycleState } from "./enterpriseAssetLifecycleRiskService";

beforeEach(() => vi.clearAllMocks());

describe("enterpriseAssetLifecycleRiskService", () => {
  it("loads the canonical tenant posture", async () => {
    rpc
      .mockResolvedValueOnce({
        data: {
          detailAccess: false,
          index: { indexComputable: false, value: null },
          coverage: { assets: 4 },
          assets: [],
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          canRecord: false,
          requiredAal: "aal2",
          assets: [],
          stages: [],
          evidence: [],
        },
        error: null,
      });
    const result = await getEnterpriseAssetLifecycleRisk();
    expect(result.coverage.assets).toBe(4);
    expect(result.index.value).toBeNull();
    expect(rpc).toHaveBeenCalledWith("get_enterprise_asset_lifecycle_risk");
    expect(rpc).toHaveBeenCalledWith(
      "get_initial_asset_lifecycle_state_options",
    );
  });

  it("surfaces the database refusal envelope", async () => {
    rpc.mockResolvedValue({ data: { error: "forbidden" }, error: null });
    await expect(getEnterpriseAssetLifecycleRisk()).rejects.toThrow(
      /forbidden/i,
    );
  });

  it("surfaces transport failures", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "connection unavailable" },
    });
    await expect(getEnterpriseAssetLifecycleRisk()).rejects.toThrow(
      /connection unavailable/i,
    );
  });

  it("records an evidence-backed initial lifecycle state", async () => {
    rpc.mockResolvedValue({ data: { assetId: "asset-1" }, error: null });
    await recordInitialAssetLifecycleState({
      assetId: "asset-1",
      stageKey: "operation",
      evidenceItemId: "evidence-1",
      basis: "Verified commissioning record establishes current operation.",
    });
    expect(rpc).toHaveBeenCalledWith("record_initial_asset_lifecycle_state", {
      p_asset_id: "asset-1",
      p_stage_key: "operation",
      p_evidence_item_id: "evidence-1",
      p_basis: "Verified commissioning record establishes current operation.",
    });
  });
});
