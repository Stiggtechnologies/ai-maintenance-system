import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getOperatingDutyReadings,
  previewOperatingDuty,
  recordOperatingDutyReading,
} from "./operatingDutyService";

const rpc = vi.fn();

vi.mock("../lib/supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
  },
}));

const picture = {
  asset_id: "a1",
  window_days: 90,
  starts: 2,
  stops: 1,
  cycles_completed: 1,
  excursions: 1,
  trips: 0,
  states: [],
  basis: "Load was not recorded.",
  condition_alerts_consulted: false,
  source_digest: "abc",
};

beforeEach(() => {
  rpc.mockReset();
});

describe("operating duty callers", () => {
  it("previews the computed picture for the asset and window", async () => {
    rpc.mockResolvedValue({ data: picture, error: null });
    const result = await previewOperatingDuty("a1", 30);
    expect(rpc).toHaveBeenCalledWith("preview_operating_duty", {
      p_asset_id: "a1",
      p_window_days: 30,
    });
    expect(result.condition_alerts_consulted).toBe(false);
    expect(result.starts).toBe(2);
  });

  it("retains a reading without sending a blank note as a count", async () => {
    rpc.mockResolvedValue({
      data: { reading: { ...picture, id: 4 }, replayed: false },
      error: null,
    });
    const result = await recordOperatingDutyReading("a1", 90, "   ");
    expect(rpc).toHaveBeenCalledWith("record_operating_duty_reading", {
      p_asset_id: "a1",
      p_window_days: 90,
      p_note: null,
    });
    expect(result.replayed).toBe(false);
    expect(result.reading.id).toBe(4);
  });

  it("surfaces a database refusal in the database's words", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "AI cannot record an operating-duty reading; a named human must retain it" },
    });
    await expect(recordOperatingDutyReading("a1", 90, "note")).rejects.toThrow(
      /AI cannot record/,
    );
  });

  it("reads retained readings for the asset", async () => {
    rpc.mockResolvedValue({
      data: { readings: [{ ...picture, id: 4, recorded_at: "2026-11-03T00:00:00Z" }] },
      error: null,
    });
    const rows = await getOperatingDutyReadings("a1");
    expect(rpc).toHaveBeenCalledWith("get_operating_duty_readings", {
      p_asset_id: "a1",
      p_limit: 10,
    });
    expect(rows).toHaveLength(1);
  });
});
