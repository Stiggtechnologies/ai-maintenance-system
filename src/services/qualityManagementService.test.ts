import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));
vi.mock("../lib/supabase", () => ({ supabase: { rpc: rpcMock } }));

import {
  executeQualityAction,
  getQualityCockpit,
} from "./qualityManagementService";

describe("quality management service", () => {
  beforeEach(() => rpcMock.mockReset());

  it("loads the derived cockpit with explicit period arguments", async () => {
    rpcMock.mockResolvedValue({ data: { metrics: [] }, error: null });
    await getQualityCockpit("2026-01-01", "2027-01-01");
    expect(rpcMock).toHaveBeenCalledWith("get_quality_cockpit", {
      p_from: "2026-01-01",
      p_to: "2027-01-01",
    });
  });

  it("routes every write through a governed RPC", async () => {
    rpcMock.mockResolvedValue({ data: { id: 1 }, error: null });
    await executeQualityAction("approve_requirement", {
      id: 4,
      note: "Independent review completed against source evidence.",
    });
    expect(rpcMock).toHaveBeenCalledWith("approve_quality_requirement", {
      p_id: 4,
      p_note: "Independent review completed against source evidence.",
    });
  });

  it("rejects malformed lifecycle action inputs before the database call", async () => {
    await expect(
      executeQualityAction("transition_ncr", {
        id: 1,
        transition: "contain",
        detail: "not-an-object",
      }),
    ).rejects.toThrow(/detail must be an object/);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
