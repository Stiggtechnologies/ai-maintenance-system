import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("../lib/supabase", () => ({ supabase: { rpc } }));

import { persistDocumentEngineeringMappings } from "./documentEngineeringMappingService";

describe("persistDocumentEngineeringMappings", () => {
  beforeEach(() => {
    rpc.mockReset();
  });

  it("sends canonical references to the governed mapping RPC", async () => {
    rpc.mockResolvedValue({
      data: {
        sourceId: "source-1",
        mappingIds: ["map-1"],
        count: 1,
        grantsAuthority: false,
        grantsWorkRelease: false,
        grantsApproval: false,
        decisionBoundary: "no authority",
      },
      error: null,
    });

    const result = await persistDocumentEngineeringMappings("source-1", [
      {
        entityType: "asset_twin",
        canonicalId: "twin-1",
        relationship: "applies_to",
        reviewState: "draft",
        provenanceChunkIds: ["chunk-1"],
      },
    ]);

    expect(rpc).toHaveBeenCalledWith("persist_document_engineering_mappings", {
      p_source_id: "source-1",
      p_mappings: [
        {
          entityType: "asset_twin",
          canonicalId: "twin-1",
          relationship: "applies_to",
          reviewState: "draft",
          provenanceChunkIds: ["chunk-1"],
        },
      ],
    });
    expect(result.grantsAuthority).toBe(false);
    expect(result.mappingIds).toEqual(["map-1"]);
  });

  it("refuses a payload that claims the mapping grants authority", async () => {
    rpc.mockResolvedValue({
      data: {
        sourceId: "source-1",
        mappingIds: [],
        count: 0,
        grantsAuthority: true,
        grantsWorkRelease: false,
        grantsApproval: false,
        decisionBoundary: "no",
      },
      error: null,
    });
    await expect(
      persistDocumentEngineeringMappings("source-1", [
        {
          entityType: "component",
          canonicalId: "PUMP-WET-END",
          relationship: "applies_to",
          reviewState: "draft",
          provenanceChunkIds: ["chunk-1"],
        },
      ]),
    ).rejects.toThrow(/must not grant authority/);
  });
});
