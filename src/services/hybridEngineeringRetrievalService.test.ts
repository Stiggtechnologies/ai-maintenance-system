import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../lib/supabase", () => ({ supabase: { rpc } }));

import { retrieveEngineeringKnowledgeHybrid } from "./hybridEngineeringRetrievalService";

describe("retrieveEngineeringKnowledgeHybrid", () => {
  beforeEach(() => rpc.mockReset());

  it("calls the canonical hybrid RPC with metadata filters", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await retrieveEngineeringKnowledgeHybrid({
      claimType: "failure_behaviour",
      query: "cavitation",
      entityType: "asset_class",
      canonicalId: "ROT-CENT-PUMP",
      minimumSemanticScore: 0.2,
    });
    expect(rpc).toHaveBeenCalledWith("retrieve_engineering_knowledge_hybrid", {
      p_claim_type: "failure_behaviour",
      p_query: "cavitation",
      p_query_embedding: null,
      p_entity_type: "asset_class",
      p_canonical_id: "ROT-CENT-PUMP",
      p_asset_class: null,
      p_minimum_semantic_score: 0.2,
      p_limit: 8,
    });
  });
});
