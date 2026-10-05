import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();

vi.mock("../lib/supabase", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

import { loadAssetOperationalMonitor } from "./assetOperationalMonitorService";

beforeEach(() => vi.clearAllMocks());

describe("assetOperationalMonitorService", () => {
  it("loads the exact asset and bounded evidence window", async () => {
    rpc.mockResolvedValue({
      data: {
        asset: { id: "asset-1", tag: "P-101", name: "Pump 101" },
        windowDays: 90,
        condition: { summary: {}, readings: [], alerts: [] },
        work: { summary: {}, orders: [] },
        production: { summary: {}, states: [] },
        risk: { summary: {}, risks: [] },
        authority: { readOnly: true },
      },
      error: null,
    });

    const result = await loadAssetOperationalMonitor("asset-1", 90);
    expect(result.asset.id).toBe("asset-1");
    expect(rpc).toHaveBeenCalledWith("get_asset_operational_monitor", {
      p_asset_id: "asset-1",
      p_window_days: 90,
    });
  });

  it("surfaces in-band tenancy refusals", async () => {
    rpc.mockResolvedValue({
      data: { error: "asset not found" },
      error: null,
    });
    await expect(
      loadAssetOperationalMonitor("foreign-asset", 30),
    ).rejects.toThrow(/asset not found/i);
  });
});
