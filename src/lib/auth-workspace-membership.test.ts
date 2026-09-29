import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.hoisted(() => ({
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  maybeSingle: vi.fn(),
}));

vi.mock("./supabase", () => ({
  supabase: {
    from: query.from,
  },
}));

import { hasWorkspaceMembership } from "./auth";

describe("workspace membership authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    query.from.mockReturnValue({ select: query.select });
    query.select.mockReturnValue({ eq: query.eq });
    query.eq.mockReturnValue({ maybeSingle: query.maybeSingle });
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
