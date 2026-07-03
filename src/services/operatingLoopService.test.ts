/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mutable result the mocked Supabase builder resolves to.
const state: { result: { data: any; error: { message: string } | null } } = {
  result: { data: [], error: null },
};

vi.mock("../lib/supabase", () => {
  const builder: any = {};
  [
    "select",
    "eq",
    "in",
    "gte",
    "order",
    "limit",
    "insert",
    "update",
    "upsert",
    "returns",
  ].forEach((m) => (builder[m] = vi.fn(() => builder)));
  builder.maybeSingle = vi.fn(() => Promise.resolve(state.result));
  // Make the builder awaitable so `await supabase.from(t).select()...` resolves.
  builder.then = (resolve: (v: unknown) => unknown) => resolve(state.result);
  return {
    supabase: {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }),
      },
      from: vi.fn(() => builder),
      rpc: vi.fn(() => Promise.resolve(state.result)),
    },
  };
});

import {
  getAssets,
  getMissionControl,
  verifyValueMetric,
  getPilotScorecard,
} from "./operatingLoopService";

describe("operatingLoopService", () => {
  beforeEach(() => {
    state.result = { data: [], error: null };
  });

  it("returns an empty array when a table has no rows (graceful empty)", async () => {
    const assets = await getAssets();
    expect(assets).toEqual([]);
  });

  it("never silently swallows a Supabase error — it throws", async () => {
    state.result = { data: null, error: { message: "permission denied" } };
    await expect(getAssets()).rejects.toThrow(/permission denied/);
  });

  it("computes a coherent Mission Control aggregate from empty data", async () => {
    const mc = await getMissionControl();
    expect(mc.readinessScore).toBe(100);
    expect(mc.readinessStatus).toBe("Ready");
    expect(mc.topRisks).toEqual([]);
    expect(mc.topRecommendations).toEqual([]);
    expect(mc.valueCreated).toBe(0);
    expect(mc.factors.length).toBeGreaterThan(0);
  });

  it("verifyValueMetric surfaces RPC errors instead of swallowing them", async () => {
    state.result = {
      data: null,
      error: { message: "not in your organization" },
    };
    await expect(verifyValueMetric("m1", true)).rejects.toThrow(
      /not in your organization/,
    );
  });

  it("verifyValueMetric resolves on success", async () => {
    state.result = { data: { status: "verified" }, error: null };
    await expect(
      verifyValueMetric("m1", true, "confirmed"),
    ).resolves.toBeUndefined();
  });

  it("getPilotScorecard returns the RPC payload", async () => {
    state.result = {
      data: { pilot_day: 5, pilot_length_days: 90, value_verified_usd: 1000 },
      error: null,
    };
    const sc = await getPilotScorecard();
    expect(sc.pilot_day).toBe(5);
    expect(sc.value_verified_usd).toBe(1000);
  });
});
