import { describe, expect, it } from "vitest";
import { loadGeospatialPanelData } from "../services/geospatialPanelData";

describe("geospatial Context transport isolation", () => {
  it("keeps the canonical workspace and references when optional Context fails", async () => {
    const workspace = { features: [{ id: "feature-1" }] };
    const references = { assets: [{ id: "asset-1" }] };
    const result = await loadGeospatialPanelData({
      workspace: async () => workspace as never,
      references: async () => references as never,
      context: async () => {
        throw new Error("relation secret_context does not exist");
      },
    });

    expect(result.workspace).toBe(workspace);
    expect(result.references).toBe(references);
    expect(result.context).toBeNull();
    expect(result.incomplete).toBe(true);
  });
});
