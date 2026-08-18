/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mutable result the mocked Supabase query builder resolves to, plus a record
// of how the builder was called so the read shape can be asserted.
const state: {
  result: { data: any; error: { message: string } | null };
  calls: {
    from?: string;
    select?: string;
    order?: [string, any];
    limit?: number;
  };
} = { result: { data: [], error: null }, calls: {} };

vi.mock("../lib/supabase", () => {
  const builder: any = {};
  builder.select = vi.fn((cols: string) => {
    state.calls.select = cols;
    return builder;
  });
  builder.order = vi.fn((col: string, opts: any) => {
    state.calls.order = [col, opts];
    return builder;
  });
  builder.limit = vi.fn((n: number) => {
    state.calls.limit = n;
    return builder;
  });
  // Awaitable: `await supabase.from(t).select()...limit()` resolves here.
  builder.then = (resolve: (v: unknown) => unknown) => resolve(state.result);
  return {
    supabase: {
      from: vi.fn((table: string) => {
        state.calls.from = table;
        return builder;
      }),
      rpc: vi.fn(() => Promise.resolve(state.result)),
    },
  };
});

import { listPilotIntakeRequests } from "./pilotIntake";

describe("listPilotIntakeRequests", () => {
  beforeEach(() => {
    state.result = { data: [], error: null };
    state.calls = {};
  });

  it("reads pilot_intake_requests newest first, bounded", async () => {
    await listPilotIntakeRequests();
    expect(state.calls.from).toBe("pilot_intake_requests");
    expect(state.calls.order).toEqual(["created_at", { ascending: false }]);
    expect(state.calls.limit).toBe(300);
    // Only real, stored columns are requested — no derived or invented fields.
    expect(state.calls.select).toContain("name");
    expect(state.calls.select).toContain("email");
    expect(state.calls.select).toContain("company");
    expect(state.calls.select).toContain("notification_status");
    expect(state.calls.select).toContain("created_at");
  });

  it("returns the leads the admin's RLS scope allows", async () => {
    state.result = {
      data: [
        {
          id: "lead-1",
          created_at: "2026-09-13T10:00:00Z",
          status: "new",
          name: "Dana Ops",
          email: "dana@acme.example",
          company: "Acme",
          role: "Reliability leader",
          industry: "Mining",
          asset_scope: "Haul truck fleet",
          primary_pain: "Repeat gearbox failures",
          notification_status: "queued",
          source_path: "/pilot/reliability",
        },
      ],
      error: null,
    };
    const leads = await listPilotIntakeRequests();
    expect(leads).toHaveLength(1);
    expect(leads[0].email).toBe("dana@acme.example");
    expect(leads[0].notification_status).toBe("queued");
  });

  it("returns an empty array when the admin's scope has no leads", async () => {
    // A non-admin session reads zero rows via RLS; the function must surface
    // that as an empty list, never a thrown error.
    state.result = { data: [], error: null };
    await expect(listPilotIntakeRequests()).resolves.toEqual([]);
  });

  it("throws instead of swallowing a Supabase error", async () => {
    state.result = { data: null, error: { message: "permission denied" } };
    await expect(listPilotIntakeRequests()).rejects.toThrow(
      /permission denied/,
    );
  });
});
