import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

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
    }),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  },
}));

import {
  useWorkOrderStats,
  useAssetStats,
  useAlertStats,
} from "../hooks/useDashboardData";

describe("useDashboardData hooks", () => {
  it("useWorkOrderStats returns null initially then loads", async () => {
    const { result } = renderHook(() => useWorkOrderStats());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it("useAssetStats returns null initially then loads", async () => {
    const { result } = renderHook(() => useAssetStats());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it("useAlertStats returns null initially then loads", async () => {
    const { result } = renderHook(() => useAlertStats());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
  });
});
