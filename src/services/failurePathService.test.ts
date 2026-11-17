import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../lib/supabase", () => ({ supabase: { rpc } }));

import { queryFailureDetectionPaths } from "./failurePathService";

const result = {
  rootCanonicalId: "PUMP-WET-END",
  paths: [],
  truncated: false,
  grantsAuthority: false,
  grantsWorkRelease: false,
  grantsApproval: false,
  decisionBoundary: "no authority",
};

describe("failure path service", () => {
  beforeEach(() => rpc.mockReset());

  it("queries canonical paths and refuses an authorizing payload", async () => {
    rpc.mockResolvedValue({ data: result, error: null });
    await queryFailureDetectionPaths("PUMP-WET-END", 4);
    expect(rpc).toHaveBeenCalledWith("query_failure_detection_paths", {
      p_root_canonical_id: "PUMP-WET-END",
      p_max_depth: 4,
    });

    rpc.mockResolvedValue({
      data: { ...result, grantsApproval: true },
      error: null,
    });
    await expect(queryFailureDetectionPaths("PUMP-WET-END")).rejects.toThrow(
      /must not grant authority/,
    );
  });
});
