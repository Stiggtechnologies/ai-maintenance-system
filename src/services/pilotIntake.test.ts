/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const state: {
  result: { data: any; error: { message: string; code?: string } | null };
  queue: Array<{ data: any; error: { message: string; code?: string } | null }>;
  selects: string[];
  rpcCalls: Array<[string, unknown]>;
  rpcResult: {
    data: any;
    error: { message: string; code?: string } | null;
  };
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
  builder.then = (resolve: (v: unknown) => unknown) =>
    resolve(state.queue.length > 0 ? state.queue.shift() : state.result);
  return {
    supabase: {
      from: vi.fn((table: string) => {
        state.calls.from = table;
        return builder;
      }),
      rpc: vi.fn((fn: string, args?: unknown) => {
        state.rpcCalls.push([fn, args]);
        return Promise.resolve(state.rpcResult);
      }),
    },
  };
});

import {
  activateRiaFromIntake,
  listPilotIntakeRequests,
  listRiaActivationOrganizations,
  markPilotLeadResponded,
} from "./pilotIntake";

function resetState() {
  state.result = { data: [], error: null };
  state.queue = [];
  state.selects = [];
  state.rpcCalls = [];
  state.rpcResult = { data: null, error: null };
  state.calls = {};
}

describe("listPilotIntakeRequests", () => {
  beforeEach(resetState);

  it("reads pilot_intake_requests newest first, bounded", async () => {
    await listPilotIntakeRequests();
    expect(state.calls.from).toBe("pilot_intake_requests");
    expect(state.calls.order).toEqual(["created_at", { ascending: false }]);
    expect(state.calls.limit).toBe(300);
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
    expect(leads[0].ria_assessment_id).toBeNull();
  });

  it("returns an empty array when the admin's scope has no leads", async () => {
    state.result = { data: [], error: null };
    await expect(listPilotIntakeRequests()).resolves.toEqual([]);
  });

  it("throws instead of swallowing a Supabase error", async () => {
    state.result = { data: null, error: { message: "permission denied" } };
    await expect(listPilotIntakeRequests()).rejects.toThrow(/permission denied/);
  });
});

describe("listPilotIntakeRequests — frontend/schema deploy skew", () => {
  beforeEach(resetState);

  it("asks for conversion and SLA columns first", async () => {
    await listPilotIntakeRequests();
    expect(state.selects).toHaveLength(1);
    expect(state.selects[0]).toContain("ria_assessment_id");
    expect(state.selects[0]).toContain("activated_organization_id");
    expect(state.selects[0]).toContain("commercial_acceptance_reference");
    expect(state.selects[0]).toContain("first_response_due");
    expect(state.selects[0]).toContain("first_responded_at");
  });

  it("drops only activation columns when conversion schema has not caught up", async () => {
    state.queue = [
      {
        data: null,
        error: {
          code: "42703",
          message: "column pilot_intake_requests.ria_assessment_id does not exist",
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
            first_response_due: "2026-09-14T15:00:00Z",
            first_responded_at: null,
          },
        ],
        error: null,
      },
    ];

    const [lead] = await listPilotIntakeRequests();

    expect(state.selects).toHaveLength(2);
    expect(state.selects[1]).toContain("first_response_due");
    expect(state.selects[1]).not.toContain("ria_assessment_id");
    expect(lead.first_response_due).toBe("2026-09-14T15:00:00Z");
    expect(lead.ria_assessment_id).toBeNull();
  });

  it("then drops SLA columns when the project is older still", async () => {
    state.queue = [
      {
        data: null,
        error: { code: "42703", message: "ria_assessment_id does not exist" },
      },
      {
        data: null,
        error: { code: "42703", message: "first_response_due does not exist" },
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

    const [lead] = await listPilotIntakeRequests();

    expect(state.selects).toHaveLength(3);
    expect(state.selects[2]).not.toContain("first_response_due");
    expect(state.selects[2]).not.toContain("first_responded_at");
    expect(state.selects[2]).not.toContain("ria_assessment_id");
    expect(lead.first_response_due).toBeNull();
    expect(lead.first_responded_at).toBeNull();
    expect(lead.ria_assessment_id).toBeNull();
  });

  it("does not retry or hide an error that is not a missing column", async () => {
    state.result = {
      data: null,
      error: { code: "42501", message: "permission denied" },
    };
    await expect(listPilotIntakeRequests()).rejects.toThrow(/permission denied/);
    expect(state.selects).toHaveLength(1);
  });

  it("still throws when the degraded read fails with a real error", async () => {
    state.queue = [
      { data: null, error: { code: "42703", message: "does not exist" } },
      { data: null, error: { code: "42501", message: "permission denied" } },
    ];
    await expect(listPilotIntakeRequests()).rejects.toThrow(/permission denied/);
  });

  it("normalises every optional deployment-era field to null", async () => {
    state.queue = [
      { data: null, error: { code: "42703", message: "does not exist" } },
      { data: null, error: { code: "42703", message: "does not exist" } },
      { data: [{ id: "lead-2", status: "new" }], error: null },
    ];
    const [lead] = await listPilotIntakeRequests();
    expect(lead.first_response_due).toBeNull();
    expect(lead.first_responded_at).toBeNull();
    expect(lead.ria_assessment_id).toBeNull();
    expect(lead.activated_organization_id).toBeNull();
    expect(lead.activated_by).toBeNull();
    expect(lead.activated_at).toBeNull();
    expect(lead.commercial_acceptance_reference).toBeNull();
  });
});

describe("markPilotLeadResponded", () => {
  beforeEach(resetState);

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

describe("RIA commercial activation callers", () => {
  beforeEach(resetState);

  it("uses only the narrow activation RPC and returns its assessment id", async () => {
    state.rpcResult = {
      data: "44444444-4444-4444-8444-444444444444",
      error: null,
    };

    await expect(
      activateRiaFromIntake({
        leadId: "lead-1",
        organizationId: "11111111-1111-4111-8111-111111111111",
        scopeLabel: "Haul truck fleet",
        targetEndOn: "2026-11-15",
        acceptanceReference: "SOW-2026-081",
      }),
    ).resolves.toEqual({
      assessmentId: "44444444-4444-4444-8444-444444444444",
    });

    expect(state.rpcCalls).toEqual([
      [
        "activate_ria_from_intake",
        {
          p_lead_id: "lead-1",
          p_organization_id: "11111111-1111-4111-8111-111111111111",
          p_scope_label: "Haul truck fleet",
          p_target_end_on: "2026-11-15",
          p_acceptance_reference: "SOW-2026-081",
        },
      ],
    ]);
    expect(state.calls.from).toBeUndefined();
  });

  it("fails clearly while the governed activation contract is undeployed", async () => {
    state.rpcResult = {
      data: null,
      error: { code: "PGRST202", message: "Could not find the function" },
    };
    await expect(
      activateRiaFromIntake({
        leadId: "lead-1",
        organizationId: "11111111-1111-4111-8111-111111111111",
        scopeLabel: "Haul truck fleet",
        targetEndOn: null,
        acceptanceReference: "PO-8841",
      }),
    ).rejects.toThrow(/not deployed yet/i);
  });

  it("uses the narrow organization directory when available", async () => {
    state.rpcResult = {
      data: [
        { organization_id: "b", organization_name: "Zulu Mining" },
        { organization_id: "a", organization_name: "Acme Mining" },
      ],
      error: null,
    };
    await expect(listRiaActivationOrganizations()).resolves.toEqual({
      available: true,
      organizations: [
        { id: "a", name: "Acme Mining" },
        { id: "b", name: "Zulu Mining" },
      ],
    });
    expect(state.rpcCalls[0][0]).toBe("list_ria_activation_organizations");
  });

  it("degrades to explicit UUID entry if the directory contract is not deployed", async () => {
    state.rpcResult = {
      data: null,
      error: { code: "42883", message: "function does not exist" },
    };
    await expect(listRiaActivationOrganizations()).resolves.toEqual({
      available: false,
      organizations: [],
    });
  });
});
