import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
const from = vi.hoisted(() => vi.fn());

vi.mock("../lib/supabase", () => ({
  supabase: { rpc, from },
}));

import { checkDifferentiation } from "../lib/industry-profiles";
import {
  differentiateFailureContexts,
  listFailureContextAssets,
  listFailureContextBindings,
  recordFailureContextBinding,
} from "./failureContextRiskModelService";

describe("failure context risk model service", () => {
  beforeEach(() => {
    rpc.mockReset();
    from.mockReset();
  });

  it("previews with the canonical differentiation check", () => {
    const preview = differentiateFailureContexts(
      "process_trip",
      "mobile_plant_failure",
    );
    expect(preview).toEqual(
      checkDifferentiation("process_trip", "mobile_plant_failure"),
    );
    expect(preview.differentiated).toBe(true);
    expect(preview.differentWorkflow).toBe(true);
  });

  it("refuses to treat a weld defect as either a trip or a haul-truck failure", () => {
    expect(
      differentiateFailureContexts("quality_loss", "process_trip")
        .differentiated,
    ).toBe(true);
    expect(
      differentiateFailureContexts("quality_loss", "mobile_plant_failure")
        .differentiated,
    ).toBe(true);
  });

  it("reads tenant assets and recorded bindings without a client write", async () => {
    const limit = vi.fn().mockResolvedValue({
      data: [{ id: "asset-1", name: "C-101", tag: "C-101" }],
      error: null,
    });
    const order = vi.fn().mockReturnValue({ limit });
    from.mockReturnValueOnce({ select: vi.fn().mockReturnValue({ order }) });
    await expect(listFailureContextAssets()).resolves.toEqual([
      { id: "asset-1", name: "C-101", tag: "C-101" },
    ]);
    expect(from).toHaveBeenCalledWith("assets");

    const bindingLimit = vi.fn().mockResolvedValue({ data: [], error: null });
    const bindingOrder = vi.fn().mockReturnValue({ limit: bindingLimit });
    const eq = vi.fn().mockReturnValue({ order: bindingOrder });
    from.mockReturnValueOnce({ select: vi.fn().mockReturnValue({ eq }) });
    await expect(listFailureContextBindings("asset-1")).resolves.toEqual([]);
    expect(from).toHaveBeenLastCalledWith("failure_context_bindings");
    expect(eq).toHaveBeenCalledWith("asset_id", "asset-1");
  });

  it("records only the asset, the two contexts, and the human basis", async () => {
    rpc.mockResolvedValue({
      data: {
        recorded: true,
        bindingId: "binding-1",
        workAuthorized: false,
        riskAccepted: false,
      },
      error: null,
    });
    await expect(
      recordFailureContextBinding({
        assetId: "asset-1",
        contextKey: "process_trip",
        comparisonKey: "quality_loss",
        basis: "The compressor trip is a protective demand, not a weld defect.",
      }),
    ).resolves.toMatchObject({
      recorded: true,
      workAuthorized: false,
      riskAccepted: false,
    });
    expect(rpc).toHaveBeenCalledWith("record_failure_context_binding", {
      p_asset_id: "asset-1",
      p_context_key: "process_trip",
      p_comparison_key: "quality_loss",
      p_basis: "The compressor trip is a protective demand, not a weld defect.",
    });
  });

  it("surfaces a server refusal instead of treating it as stored", async () => {
    rpc.mockResolvedValue({
      data: { recorded: false, error: "asset is outside the active tenant" },
      error: null,
    });
    await expect(
      recordFailureContextBinding({
        assetId: "other-tenant",
        contextKey: "process_trip",
        comparisonKey: "mobile_plant_failure",
        basis: "This basis is long enough to be considered.",
      }),
    ).rejects.toThrow("asset is outside the active tenant");
  });
});
