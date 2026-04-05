import { describe, it, expect, vi } from "vitest";

// Mock supabase
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
      gte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
    }),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  },
}));

import {
  getWorkOrders,
  getAssets,
  getAlerts,
} from "../services/dashboardServices";

describe("dashboardServices", () => {
  it("getWorkOrders returns empty array on no data", async () => {
    const result = await getWorkOrders();
    expect(result).toEqual([]);
  });

  it("getAssets returns empty array on no data", async () => {
    const result = await getAssets();
    expect(result).toEqual([]);
  });

  it("getAlerts returns empty array on no data", async () => {
    const result = await getAlerts();
    expect(result).toEqual([]);
  });

  it("getWorkOrders accepts filters", async () => {
    const result = await getWorkOrders({
      status: "pending",
      priority: "high",
      limit: 5,
    });
    expect(result).toEqual([]);
  });
});
