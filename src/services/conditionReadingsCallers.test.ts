import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  listAssetConditionReadings,
  listRecentConditionReadings,
} from "./conditionStateService";

const limit = vi.fn();

vi.mock("../lib/supabase", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: () => ({
        eq: () => ({
          order: () => ({ limit }),
        }),
        order: () => ({ limit }),
      }),
    })),
    rpc: vi.fn(),
  },
}));

import { supabase } from "../lib/supabase";

describe("condition reading callers", () => {
  beforeEach(() => {
    limit.mockReset();
    vi.mocked(supabase.from).mockClear();
  });

  it("reads condition_readings for an asset, not a health score", async () => {
    limit.mockResolvedValue({
      data: [
        {
          id: 7,
          asset_id: "a1",
          value: 2.4,
          quality: "good",
          taken_at: "2026-09-01T00:00:00Z",
          source_system: "plant-historian",
          sensors: { name: "DE vibration", signal_type: "vibration", unit: "mm/s" },
        },
      ],
      error: null,
    });
    const rows = await listAssetConditionReadings("a1");
    expect(supabase.from).toHaveBeenCalledWith("condition_readings");
    expect(rows[0]).toMatchObject({
      value: 2.4,
      quality: "good",
      sensor_name: "DE vibration",
      unit: "mm/s",
      source_system: "plant-historian",
    });
    expect(rows[0]).not.toHaveProperty("health_score");
  });

  it("reads the recent series for the dashboard caller", async () => {
    limit.mockResolvedValue({ data: [], error: null });
    await expect(listRecentConditionReadings(100)).resolves.toEqual([]);
    expect(supabase.from).toHaveBeenCalledWith("condition_readings");
  });
});
