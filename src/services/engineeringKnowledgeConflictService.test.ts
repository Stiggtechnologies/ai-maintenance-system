import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../lib/supabase", () => ({ supabase: { rpc } }));

import { detectEngineeringKnowledgeConflicts } from "./engineeringKnowledgeConflictService";

describe("detectEngineeringKnowledgeConflicts", () => {
  beforeEach(() => rpc.mockReset());

  it("reads conflicts and refuses an authorizing payload", async () => {
    rpc.mockResolvedValue({
      data: {
        entityType: "asset_class",
        canonicalId: "ROT-CENT-PUMP",
        findings: [],
        grantsAuthority: false,
        grantsWorkRelease: false,
        grantsApproval: false,
        decisionBoundary: "names disagreements",
      },
      error: null,
    });
    const report = await detectEngineeringKnowledgeConflicts(
      "asset_class",
      "ROT-CENT-PUMP",
    );
    expect(report.findings).toEqual([]);
    expect(rpc).toHaveBeenCalledWith("detect_engineering_knowledge_conflicts", {
      p_entity_type: "asset_class",
      p_canonical_id: "ROT-CENT-PUMP",
    });
  });
});
