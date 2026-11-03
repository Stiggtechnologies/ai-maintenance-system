import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const from = vi.fn();
const listSites = vi.fn();

vi.mock("../lib/supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: (...args: unknown[]) => from(...args),
  },
}));

vi.mock("./reliabilityCallers", () => ({
  listSites: () => listSites(),
}));

import {
  listConstraintAssets,
  loadProductionConstraintWorkspace,
  recordProductionConstraintStudy,
} from "./productionConstraintService";

describe("productionConstraintService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listSites.mockResolvedValue([{ id: "site-1", name: "North" }]);
  });

  it("loads studies and canonical sites together", async () => {
    rpc.mockResolvedValue({
      data: {
        studies: [],
        method: "lowest declared limit",
        authority: "does not release work",
      },
      error: null,
    });
    const workspace = await loadProductionConstraintWorkspace();
    expect(rpc).toHaveBeenCalledWith("get_production_constraint_studies", {});
    expect(workspace.sites).toEqual([{ id: "site-1", name: "North" }]);
    expect(workspace.studies).toEqual([]);
  });

  it("sends quantities as text and surfaces a database refusal", async () => {
    rpc.mockResolvedValue({
      data: { error: "ai_admin cannot record a production constraint study" },
      error: null,
    });
    await expect(
      recordProductionConstraintStudy({
        title: "Week 12",
        siteId: "site-1",
        horizonStart: "2026-11-01T00:00:00.000Z",
        horizonEnd: "2026-11-08T00:00:00.000Z",
        requiredQuantity: "50",
        unitOfMeasure: "t",
        basis: "Operations committed this tonne total for the week.",
        limits: [
          {
            key: "crusher",
            kind: "equipment",
            availableQuantity: "40",
            unitOfMeasure: "t",
            basis:
              "The crusher crew stated the week limit from the current liner.",
            assetId: null,
            constraintSignalId: null,
          },
        ],
      }),
    ).rejects.toThrow(/ai_admin/);
    expect(rpc).toHaveBeenCalledWith(
      "record_production_constraint_study",
      expect.objectContaining({
        p_required_quantity: "50",
        p_constraints: [
          expect.objectContaining({ availableQuantity: "40", key: "crusher" }),
        ],
      }),
    );
  });

  it("reads site assets from the canonical asset table", async () => {
    const limit = vi.fn().mockResolvedValue({
      data: [{ id: "asset-1", name: "Crusher", asset_tag: "", tag: "CR-1" }],
      error: null,
    });
    const order = vi.fn().mockReturnValue({ limit });
    const eq = vi.fn().mockReturnValue({ order });
    const select = vi.fn().mockReturnValue({ eq });
    from.mockReturnValue({ select });
    const assets = await listConstraintAssets("site-1");
    expect(from).toHaveBeenCalledWith("assets");
    expect(eq).toHaveBeenCalledWith("site_id", "site-1");
    expect(assets).toEqual([
      { id: "asset-1", name: "Crusher", assetTag: "CR-1" },
    ]);
  });
});
