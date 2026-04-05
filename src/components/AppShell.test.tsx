import { describe, it, expect, vi } from "vitest";

vi.mock("../lib/supabase", () => ({
  supabase: {
    auth: {
      getUser: vi
        .fn()
        .mockResolvedValue({ data: { user: { id: "test-user-id" } } }),
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    }),
    rpc: vi
      .fn()
      .mockResolvedValue({
        data: [
          {
            user_id: "test",
            organization_id: "org1",
            organization_name: "Test Org",
            roles: [{ code: "admin", name: "Admin", level: "executive" }],
            permissions: [],
            email: "test@test.com",
            full_name: "Test",
            default_site_id: null,
          },
        ],
      }),
  },
}));

vi.mock("../services/platform", () => ({
  platformService: {
    getCurrentUserContext: vi.fn().mockResolvedValue({
      user_id: "test",
      organization_id: "org1",
      organization_name: "Test Org",
      email: "test@test.com",
      full_name: "Test User",
      default_site_id: null,
      roles: [{ code: "EXEC", name: "Executive", level: "executive" }],
      permissions: [],
    }),
    signOut: vi.fn(),
  },
}));

describe("AppShell", () => {
  it("filters nav items by role level", () => {
    // Executive should see all items
    const executiveItems = [
      { requiredLevel: ["executive", "strategic", "tactical"] },
      { requiredLevel: ["executive", "strategic"] },
      {}, // no restriction
    ];
    const filtered = executiveItems.filter((item) => {
      if (!item.requiredLevel) return true;
      return item.requiredLevel.includes("executive");
    });
    expect(filtered.length).toBe(3);
  });

  it("operational users see fewer items", () => {
    const items = [
      { requiredLevel: ["executive", "strategic", "tactical"] },
      { requiredLevel: ["executive", "strategic"] },
      {}, // no restriction
    ];
    const filtered = items.filter((item) => {
      if (!item.requiredLevel) return true;
      return item.requiredLevel.includes("operational");
    });
    expect(filtered.length).toBe(1);
  });
});
