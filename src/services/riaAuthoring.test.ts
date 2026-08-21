/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state: {
  rpcCalls: Array<[string, unknown]>;
  rpcResult: { data: any; error: { code?: string; message: string } | null };
  fromCalls: string[];
  queryResult: { data: any; error: { message: string } | null };
} = {
  rpcCalls: [],
  rpcResult: { data: null, error: null },
  fromCalls: [],
  queryResult: { data: [], error: null },
};

vi.mock("../lib/supabase", () => {
  const builder: any = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.is = vi.fn(() => builder);
  builder.order = vi.fn(() => builder);
  builder.then = (resolve: (value: unknown) => unknown) => resolve(state.queryResult);
  return {
    supabase: {
      from: vi.fn((table: string) => {
        state.fromCalls.push(table);
        return builder;
      }),
      rpc: vi.fn((name: string, args: unknown) => {
        state.rpcCalls.push([name, args]);
        return Promise.resolve(state.rpcResult);
      }),
    },
  };
});

import {
  createActionDraft,
  createCriticalityDraft,
  createDecisionDraft,
  createFindingDraft,
  createOpportunityDraft,
  recordVerification,
  saveBaselineMetric,
  transitionAssessmentPhase,
} from "./riaAuthoring";

const assessmentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

beforeEach(() => {
  state.rpcCalls = [];
  state.rpcResult = { data: null, error: null };
  state.fromCalls = [];
  state.queryResult = { data: [], error: null };
});

describe("RIA governed authoring callers", () => {
  it("upserts a baseline metric with method, population and source fields", async () => {
    state.rpcResult.data = { metric_id: "metric-1" };
    await expect(
      saveBaselineMetric({
        assessmentId,
        metricKey: "mtbf_hours",
        label: "MTBF",
        valueText: "412",
        unit: "h",
        method: "operating hours / functional failures",
        population: "42 haul trucks, Jan-Dec 2025",
        sourceFields: ["operating_hours", "functional_failure"],
        exclusions: "commissioning failures",
        evidenceGrade: "supported",
        evidenceSourceIds: ["source-1"],
      }),
    ).resolves.toBe("metric-1");

    expect(state.rpcCalls[0]).toEqual([
      "upsert_ria_baseline_metric",
      expect.objectContaining({
        p_assessment_id: assessmentId,
        p_metric_key: "mtbf_hours",
        p_population: "42 haul trucks, Jan-Dec 2025",
        p_source_fields: ["operating_hours", "functional_failure"],
        p_evidence_source_ids: ["source-1"],
      }),
    ]);
    expect(state.fromCalls).toHaveLength(0);
  });

  it("creates a criticality draft rather than directly approving one", async () => {
    state.rpcResult.data = "criticality-1";
    await createCriticalityDraft({
      assessmentId,
      assetRef: "HT-104",
      assetName: "Haul truck 104",
      criticality: "high",
      rationale: "Single-point production exposure",
    });
    expect(state.rpcCalls[0][0]).toBe("create_ria_criticality_draft");
  });

  it("sends finding evidence linkage with the draft in one governed call", async () => {
    state.rpcResult.data = { finding_id: "finding-1" };
    await createFindingDraft({
      assessmentId,
      title: "Startup lubrication events cluster",
      statement: "Five of seven trips occur within 20 minutes of startup.",
      severity: "high",
      confidence: "medium",
      evidenceGrade: "partially_supported",
      decisionBoundary: "Do not change trip setpoint from this evidence alone.",
      evidence: [
        {
          dataSourceId: "source-1",
          recordReference: "events 101-107",
          note: "Historian export",
          provenance: "customer export / validated row mapping",
          confidence: "high",
        },
      ],
    });
    expect(state.rpcCalls[0]).toEqual([
      "create_ria_finding_draft",
      expect.objectContaining({
        p_assessment_id: assessmentId,
        p_evidence: [
          expect.objectContaining({
            data_source_id: "source-1",
            record_reference: "events 101-107",
          }),
        ],
      }),
    ]);
  });

  it("keeps value working attached to a quantified opportunity", async () => {
    state.rpcResult.data = { opportunity_id: "opp-1" };
    await createOpportunityDraft({
      assessmentId,
      findingId: "finding-1",
      title: "Improve startup controls",
      priority: "high",
      rationale: "Concentrated startup exposure",
      effort: "medium",
      recommendedAction: "Run controlled startup evidence plan",
      owner: "Reliability Lead",
      valueLow: 100000,
      valueHigh: 250000,
      valueCurrency: "USD",
      method: "avoided downtime scenarios",
      valueSource: "2025 downtime ledger",
      assumptions: "1-2 avoided events per year",
      confidence: "low",
    });
    expect(state.rpcCalls[0]).toEqual([
      "create_ria_opportunity_draft",
      expect.objectContaining({
        p_value_low: 100000,
        p_value_high: 250000,
        p_method: "avoided downtime scenarios",
        p_value_source: "2025 downtime ledger",
        p_assumptions: "1-2 avoided events per year",
      }),
    ]);
  });

  it("routes decisions, actions, verification and phase transitions through named RPCs", async () => {
    state.rpcResult.data = "id-1";
    await createDecisionDraft({
      assessmentId,
      findingId: "finding-1",
      decisionRequired: "Approve controlled startup test?",
      recommendation: "Approve bounded test",
      evidenceSummary: "Trips cluster after startup",
      uncertainty: "pressure scaling conflict",
      authorityRole: "Maintenance Manager",
      boundary: "No setpoint change",
      verification: "post-start pressure and trip recurrence",
      dueOn: null,
    });
    await createActionDraft({
      assessmentId,
      findingId: "finding-1",
      horizon: "day_30",
      action: "Run controlled startup test",
      owner: "Reliability Engineer",
      dueOn: null,
      verificationMetric: "validated lube pressure",
      authorityRole: "Maintenance Manager",
      boundary: "approved test procedure only",
    });
    await recordVerification({
      assessmentId,
      checkpoint: "day_30",
      metric: "startup trips",
      baseline: "5 of 7",
      observed: "0 of 4",
      method: "controlled startup observation",
      evidenceSourceIds: ["source-2"],
      status: "partially_supported",
    });
    state.rpcResult.data = null;
    await transitionAssessmentPhase(assessmentId, "customer_review");

    expect(state.rpcCalls.map(([name]) => name)).toEqual([
      "create_ria_decision_draft",
      "create_ria_action_draft",
      "record_ria_verification",
      "transition_ria_assessment_phase",
    ]);
  });

  it("fails closed when the invariant contract has not landed", async () => {
    state.rpcResult = {
      data: null,
      error: { code: "PGRST202", message: "Could not find the function" },
    };
    await expect(
      transitionAssessmentPhase(assessmentId, "analysis"),
    ).rejects.toThrow(/not deployed yet/i);
  });
});
