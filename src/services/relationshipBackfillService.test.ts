import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../lib/supabase", () => ({ supabase: { rpc } }));

import {
  backfillEngineeringRelationships,
  backfillRelationshipsFromKnowledgeChunks,
} from "./relationshipBackfillService";

const result = {
  organizationId: "org",
  inserted: 1,
  alreadyPresent: 0,
  reviewState: "draft",
  grantsAuthority: false,
  grantsWorkRelease: false,
  grantsApproval: false,
  decisionBoundary: "draft",
};

describe("relationship backfill service", () => {
  beforeEach(() => rpc.mockReset());

  it("sends canonical edges and reads chunk provenance through the governed RPCs", async () => {
    rpc.mockResolvedValue({ data: result, error: null });
    await backfillEngineeringRelationships([]);
    await backfillRelationshipsFromKnowledgeChunks();
    expect(rpc).toHaveBeenNthCalledWith(
      1,
      "backfill_engineering_relationships",
      { p_edges: [] },
    );
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      "backfill_relationships_from_knowledge_chunks",
    );
  });
});
