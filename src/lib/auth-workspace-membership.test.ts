import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.hoisted(() => ({
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  maybeSingle: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("./supabase", () => ({
  supabase: {
    from: query.from,
    rpc: query.rpc,
  },
}));

import { hasWorkspaceMembership } from "./auth";

describe("workspace membership authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    query.from.mockReturnValue({ select: query.select });
    query.select.mockReturnValue({ eq: query.eq });
    query.eq.mockReturnValue({ maybeSingle: query.maybeSingle });
    query.rpc.mockResolvedValue({
      data: { authorized: true, source: "direct_or_evaluation" },
      error: null,
    });
  });

  it("authorizes only the matching canonical profile with an organization", async () => {
    query.maybeSingle.mockResolvedValue({
      data: { id: "user-1", organization_id: "org-1" },
      error: null,
    });

    await expect(hasWorkspaceMembership("user-1")).resolves.toBe(true);
    expect(query.from).toHaveBeenCalledWith("user_profiles");
    expect(query.select).toHaveBeenCalledWith("id, organization_id");
    expect(query.eq).toHaveBeenCalledWith("id", "user-1");
    expect(query.rpc).toHaveBeenCalledWith("get_current_workspace_entitlement");
  });

  it("refuses a canonical profile when commercial entitlement is inactive", async () => {
    query.maybeSingle.mockResolvedValue({
      data: { id: "user-1", organization_id: "org-1" },
      error: null,
    });
    query.rpc.mockResolvedValue({
      data: {
        authorized: false,
        source: "azure_marketplace",
        reason: "commercial_entitlement_inactive",
      },
      error: null,
    });

    await expect(hasWorkspaceMembership("user-1")).resolves.toBe(false);
  });

  it("refuses missing, foreign, unbound, and failed profile reads", async () => {
    query.maybeSingle
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({
        data: { id: "other-user", organization_id: "org-1" },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { id: "user-1", organization_id: null },
        error: null,
      })
      .mockResolvedValueOnce({ data: null, error: new Error("denied") })
      .mockRejectedValueOnce(new Error("network unavailable"));

    await expect(hasWorkspaceMembership("user-1")).resolves.toBe(false);
    await expect(hasWorkspaceMembership("user-1")).resolves.toBe(false);
    await expect(hasWorkspaceMembership("user-1")).resolves.toBe(false);
    await expect(hasWorkspaceMembership("user-1")).resolves.toBe(false);
    await expect(hasWorkspaceMembership("user-1")).resolves.toBe(false);
    await expect(hasWorkspaceMembership("")).resolves.toBe(false);
  });
});
