/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mutable result the mocked Supabase query builder resolves to, plus a record
// of how the builder was called so the read shape can be asserted.
const state: {
  result: { data: any; error: { message: string; code?: string } | null };
  /** Consumed in order when present, so a retry can get a different answer. */
  queue: Array<{ data: any; error: { message: string; code?: string } | null }>;
  selects: string[];
  rpcCalls: Array<[string, unknown]>;
  rpcResult: { data: any; error: { message: string } | null };
  calls: {
    from?: string;
    select?: string;
    order?: [string, any];
    limit?: number;
  };
} = {
  result: { data: [], error: null },
  queue: [],
  selects: [],
  rpcCalls: [],
  rpcResult: { data: null, error: null },
  calls: {},
};

vi.mock("../lib/supabase", () => {
  const builder: any = {};
  builder.select = vi.fn((cols: string) => {
    state.calls.select = cols;
    state.selects.push(cols);
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
  builder.then = (resolve: (v: unknown) => unknown) =>
    resolve(state.queue.length > 0 ? state.queue.shift() : state.result);
  return {
    supabase: {
      from: vi.fn((table: string) => {
        state.calls.from = table;
        return builder;
      }),
      rpc: vi.fn((fn: string, args: unknown) => {
        state.rpcCalls.push([fn, args]);
        return Promise.resolve(state.rpcResult);
      }),
    },
  };
});

import { listPilotIntakeRequests, markPilotLeadResponded } from "./pilotIntake";

describe("listPilotIntakeRequests", () => {
  beforeEach(() => {
    state.result = { data: [], error: null };
    state.queue = [];
    state.selects = [];
    state.rpcCalls = [];
    state.rpcResult = { data: null, error: null };
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

describe("listPilotIntakeRequests — the frontend and the schema deploy separately", () => {
  beforeEach(() => {
    state.result = { data: [], error: null };
    state.queue = [];
    state.selects = [];
    state.calls = {};
  });

  // Vercel ships this frontend on push to main; deploy-migrations.yml applies
  // the schema on an entirely different path, and that workflow's own comment
  // records it failing for three weeks while CI stayed green and frontends
  // kept shipping. If a select names a column production does not have yet,
  // PostgREST rejects the WHOLE query and /pilot-leads renders nothing but an
  // error — the page that exists as the human fallback for a cold lead would
  // be the first casualty of the migration being late.
  it("asks for the SLA columns first", async () => {
    await listPilotIntakeRequests();
    expect(state.selects).toHaveLength(1);
    expect(state.selects[0]).toContain("first_response_due");
    expect(state.selects[0]).toContain("first_responded_at");
  });

  it("retries without them when the schema has not caught up", async () => {
    state.queue = [
      {
        data: null,
        error: {
          code: "42703",
          message:
            "column pilot_intake_requests.first_response_due does not exist",
        },
      },
      {
        data: [
          {
            id: "lead-1",
            created_at: "2026-09-13T10:00:00Z",
            status: "new",
            name: "Dana Ops",
            email: "dana@acme.example",
            company: "Acme",
            role: null,
            industry: null,
            asset_scope: "Haul truck fleet",
            primary_pain: "Repeat gearbox failures",
            notification_status: "queued",
            source_path: "/pilot/reliability",
          },
        ],
        error: null,
      },
    ];

    const leads = await listPilotIntakeRequests();

    expect(state.selects).toHaveLength(2);
    expect(state.selects[1]).not.toContain("first_response_due");
    expect(state.selects[1]).not.toContain("first_responded_at");
    // The page still renders the lead; the deadline cell simply shows an em dash.
    expect(leads).toHaveLength(1);
    expect(leads[0].email).toBe("dana@acme.example");
    expect(leads[0].first_response_due).toBeNull();
    expect(leads[0].first_responded_at).toBeNull();
  });

  it("does not retry — or hide — an error that is not a missing column", async () => {
    state.result = {
      data: null,
      error: { code: "42501", message: "permission denied" },
    };
    await expect(listPilotIntakeRequests()).rejects.toThrow(
      /permission denied/,
    );
    expect(state.selects).toHaveLength(1);
  });

  it("still throws when the degraded read fails too", async () => {
    state.queue = [
      { data: null, error: { code: "42703", message: "does not exist" } },
      { data: null, error: { code: "42501", message: "permission denied" } },
    ];
    await expect(listPilotIntakeRequests()).rejects.toThrow(
      /permission denied/,
    );
  });

  it("normalises a row from the degraded read to the full shape", async () => {
    // Nothing downstream may see `undefined` where the type says `| null`.
    state.queue = [
      { data: null, error: { code: "42703", message: "does not exist" } },
      { data: [{ id: "lead-2", status: "new" }], error: null },
    ];
    const [lead] = await listPilotIntakeRequests();
    expect(lead.first_response_due).toBeNull();
    expect(lead.first_responded_at).toBeNull();
  });
});

describe("markPilotLeadResponded", () => {
  beforeEach(() => {
    state.rpcCalls = [];
    state.rpcResult = { data: null, error: null };
  });

  it("goes through the admin-gated RPC, because the table has no write policy", async () => {
    await markPilotLeadResponded("lead-1");
    expect(state.rpcCalls).toEqual([
      ["mark_pilot_lead_responded", { p_lead_id: "lead-1" }],
    ]);
  });

  it("surfaces a refusal rather than pretending the lead was answered", async () => {
    state.rpcResult = {
      data: null,
      error: { message: "Pilot leads are administrator-only" },
    };
    await expect(markPilotLeadResponded("lead-1")).rejects.toThrow(
      /administrator-only/,
    );
  });
});
