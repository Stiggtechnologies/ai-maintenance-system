/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RecommendationRow } from "../types/operating";

const state: {
  result: { data: any; error: { message: string } | null };
  byTable: Record<string, { data: any; error: { message: string } | null }>;
  inserts: { table: string; payload: any }[];
  rpcCalls: { name: string; args: any }[];
} = {
  result: { data: [], error: null },
  byTable: {},
  inserts: [],
  rpcCalls: [],
};

function resolveFor(table: string) {
  return state.byTable[table] ?? state.result;
}

vi.mock("../lib/supabase", () => {
  const makeBuilder = (table: string) => {
    const builder: any = {};
    [
      "select",
      "eq",
      "in",
      "gte",
      "order",
      "limit",
      "update",
      "upsert",
      "returns",
    ].forEach((m) => (builder[m] = vi.fn(() => builder)));
    builder.insert = vi.fn((payload: any) => {
      state.inserts.push({ table, payload });
      return builder;
    });
    // getOrgContext calls `.maybeSingle().returns<T>()` — maybeSingle must
    // stay chainable, and the await lands on `then`.
    builder.maybeSingle = vi.fn(() => builder);
    builder.then = (resolve: (v: unknown) => unknown) =>
      resolve(resolveFor(table));
    return builder;
  };
  return {
    supabase: {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }),
      },
      from: vi.fn((table: string) => makeBuilder(table)),
      rpc: vi.fn((name: string, args: any) => {
        state.rpcCalls.push({ name, args });
        return Promise.resolve(state.result);
      }),
    },
  };
});

import {
  approveRecommendation,
  clearOrgContextCache,
  getAssets,
  getMissionControl,
  getPilotScorecard,
  recordVerificationResult,
  verifyValueMetric,
} from "./operatingLoopService";
import { supabase } from "../lib/supabase";

const rec: RecommendationRow = {
  id: "rec-1",
  organization_id: "org-1",
  asset_id: "asset-1",
  agent_id: "agent-1",
  title: "Replace seal on P-101",
  issue: "Leak",
  action: "Replace mechanical seal",
  impact: "Avoid $12k leak downtime",
  confidence: 82,
  urgency: "action",
  status: "pending",
  approval_required: "Reliability Manager",
  accountable: "Reliability Manager",
  responsible: null,
  consulted: null,
  informed: null,
  financial_impact: "$12k",
  risk_impact: "Medium",
  rationale: "Seal leak is progressing",
  created_at: "2026-08-01T00:00:00Z",
  updated_at: "2026-08-01T00:00:00Z",
};

describe("operatingLoopService", () => {
  beforeEach(() => {
    state.result = { data: [], error: null };
    state.byTable = {};
    state.inserts = [];
    state.rpcCalls = [];
    clearOrgContextCache();
    vi.mocked(supabase.rpc).mockClear();
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

describe("recordVerificationResult", () => {
  beforeEach(() => {
    state.result = { data: [], error: null };
    state.rpcCalls = [];
    vi.mocked(supabase.rpc).mockClear();
  });

  it("calls record_verification_result with the obligation, result, and note", async () => {
    state.result = {
      data: [
        {
          outcome: "recorded",
          learningEventId: null,
          detail:
            "Outcome verified as achieved, with the measurement on record. This loop is closed.",
        },
      ],
      error: null,
    };
    const recorded = await recordVerificationResult(
      "obl-1",
      "achieved",
      "  vibration 2.1 mm/s vs 3.0 limit, 2026-08-29  ",
    );
    expect(state.rpcCalls).toEqual([
      {
        name: "record_verification_result",
        args: {
          p_obligation_id: "obl-1",
          p_result: "achieved",
          p_measured_note: "vibration 2.1 mm/s vs 3.0 limit, 2026-08-29",
          // Slice 5A: §11's evidence_id. Explicitly null when the caller
          // cites none, so an omitted argument can never be mistaken for an
          // evidence item the RPC failed to receive.
          p_evidence_id: null,
        },
      },
    ]);
    expect(recorded.outcome).toBe("recorded");
    expect(recorded.learningEventId).toBeNull();
  });

  it("passes §11's evidence id through when one is cited", async () => {
    state.result = {
      data: [{ outcome: "recorded", learningEventId: null, detail: "ok" }],
      error: null,
    };
    await recordVerificationResult(
      "obl-9",
      "achieved",
      "measured 2.1 mm/s against the 3.0 limit on 2026-12-04",
      "ev-1",
    );
    expect(state.rpcCalls[0]?.args.p_evidence_id).toBe("ev-1");
  });

  it("returns the learning event id when not_achieved is recorded", async () => {
    state.result = {
      data: [
        {
          outcome: "recorded",
          learningEventId: "le-failed-1",
          detail: "Outcome NOT achieved — recorded honestly.",
        },
      ],
      error: null,
    };
    const recorded = await recordVerificationResult(
      "obl-2",
      "not_achieved",
      "leak rate unchanged at 4 drops/min after seal change",
    );
    expect(recorded.learningEventId).toBe("le-failed-1");
    expect(state.rpcCalls[0]?.args.p_result).toBe("not_achieved");
  });

  it("surfaces a second-call refusal using the server sentence", async () => {
    state.result = {
      data: [
        {
          outcome: "refused",
          learningEventId: null,
          detail:
            "Obligation is already completed. A verification is recorded once; a second opinion belongs in a new observation, not an overwrite.",
        },
      ],
      error: null,
    };
    await expect(
      recordVerificationResult("obl-1", "achieved", "looked again"),
    ).rejects.toThrow(/recorded once/);
  });

  it("refuses an empty measured note before calling the RPC", async () => {
    await expect(
      recordVerificationResult("obl-1", "achieved", "   "),
    ).rejects.toThrow(/no measurement is an opinion/);
    expect(state.rpcCalls).toEqual([]);
  });

  it("surfaces RPC transport errors instead of swallowing them", async () => {
    state.result = {
      data: null,
      error: { message: "not in your organization" },
    };
    await expect(
      recordVerificationResult("obl-1", "inconclusive", "gauge unreadable"),
    ).rejects.toThrow(/not in your organization/);
  });
});

describe("approveRecommendation — approval is not achievement", () => {
  beforeEach(() => {
    state.result = { data: null, error: null };
    state.byTable = {
      user_profiles: {
        data: { organization_id: "org-1", role: "reliability_engineer" },
        error: null,
      },
      decisions: { data: { id: "dec-1" }, error: null },
      approvals: { data: null, error: null },
      work_orders: { data: { id: "wo-1" }, error: null },
    };
    state.inserts = [];
    clearOrgContextCache();
  });

  it("does not write recommendation_accepted as if the outcome happened", async () => {
    await approveRecommendation(rec);
    const learning = state.inserts.find(
      (row) => row.table === "learning_events",
    );
    expect(learning).toBeDefined();
    expect(learning?.payload.event_type).toBe("recommendation_approved");
    expect(learning?.payload.event_type).not.toBe("recommendation_accepted");
    expect(learning?.payload.detail).toMatch(/Outcome is not verified/);
  });

  it("logs the decision as open, not executed", async () => {
    await approveRecommendation(rec);
    const decision = state.inserts.find((row) => row.table === "decisions");
    expect(decision?.payload.outcome_status).toBe("open");
    expect(decision?.payload.approval_status).toBe("approved");
  });

  it("projects value from approval and does not mark it verified", async () => {
    await approveRecommendation(rec);
    const metric = state.inserts.find((row) => row.table === "value_metrics");
    expect(metric?.payload.status).toBe("projected");
    expect(metric?.payload.status).not.toBe("verified");
  });
});
