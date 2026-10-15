import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getRiskDecisionPreviewContext,
  getRiskAnalysisPreview,
  recordRiskAnalysis,
  createRiskTreatment,
  recordRiskValueOfInformation,
} from "./riskOperatingService";

const wire = vi.hoisted(() => ({
  body: null as unknown,
  fail: false,
  requests: [] as unknown[],
}));
vi.mock("../lib/supabase", async () => {
  const { createClient } = await import("@supabase/supabase-js");
  return {
    supabase: createClient(
      "https://synthetic-risk.invalid",
      "synthetic-public-key",
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
        global: {
          fetch: async (_url, init) => {
            wire.requests.push(JSON.parse(String(init?.body)));
            if (wire.fail) throw new TypeError("Synthetic response lost");
            return new Response(JSON.stringify(wire.body), {
              status: 200,
              headers: { "content-type": "application/json" },
            });
          },
        },
      },
    ),
  };
});
const riskId = "11111111-1111-4111-8111-111111111111";
const criteriaId = "22222222-2222-4222-8222-222222222222";
const evidenceId = "33333333-3333-4333-8333-333333333333";
const context = {
  risk_id: riskId,
  criteria: {
    id: criteriaId,
    name: "Synthetic adopted criteria",
    status: "adopted",
    version: 1,
    consequence_dimensions: ["safety"],
    likelihood_scale: [1, { score: 5 }],
    thresholds: { low: 20, medium: 40, high: 60, critical: 80 },
    scoring_weights: {
      inherent: 1,
      exposure: 0,
      uncertainty: 0,
      connectivity: 0,
      velocity: 0,
      capacity: 0,
    },
    decision_thresholds: {
      accept: 0,
      monitor: 20,
      investigate: 40,
      treat: 60,
      escalate: 80,
    },
    risk_capacity: {},
    time_factors: {},
  },
  active_competencies: ["synthetic-inspection"],
  generated_at: "2026-10-06T12:00:00Z",
  advisory_only: true,
  human_decision_required: true,
};
const proposal = {
  information_action: "Inspect synthetic bearing",
  information_cost: 10,
  decision_cost_if_wrong: 100,
  uncertainty_reduction: 0.5,
  probability_decision_changes: 0.5,
  currency: "CAD",
};
const ack = {
  ...proposal,
  risk_id: riskId,
  evidence_id: evidenceId,
  expected_value: 25,
  net_value: 15,
  recommendation: "GATHER_INFORMATION",
  recorded_at: "2026-10-06T12:00:00Z",
  human_decision_required: true,
  advisory_only: true,
};
const analysisProposal = {
  analysis_level: "semi_quantitative",
  analysis_method: "risk_matrix",
  analysis_model_reference: null,
  likelihood: 1,
  consequences: { safety: 5 },
  control_effectiveness: 0,
  uncertainty: 0,
  confidence: 100,
  complexity: 0,
  connectivity: 0,
  exposure: 0,
  capacity_load: 0,
  velocity: 0,
  time_to_unacceptable_days: null,
  opportunity_value: 0,
};
const analysisPreview = {
  risk_id: riskId,
  criteria_id: criteriaId,
  criteria_version: 1,
  criteria_status: "adopted",
  analysis: analysisProposal,
  generated_at: "2026-10-06T12:00:00Z",
  advisory_only: true,
  human_decision_required: true,
  inherent_score: 33.3,
  controlled_score: 33.3,
  current_score: 10,
  opportunity_score: 0,
  time_pressure: 0,
  level: "Low",
  recommended_action: "MONITOR",
  authoritative: true,
};
const analysisAck = {
  risk_id: riskId,
  status: "analyzed",
  inherent_score: 33.3,
  current_score: 10,
  opportunity_score: 0,
  level: "Low",
  recommended_action: "MONITOR",
  authoritative: true,
};
const scenarioId = "55555555-5555-4555-8555-555555555555";
const recommendationId = "66666666-6666-4666-8666-666666666666";
const approvalId = "77777777-7777-4777-8777-777777777777";
const childId = "88888888-8888-4888-8888-888888888888";
const treatmentOption = {
  label: "Synthetic repair option",
  strategy: "change_likelihood",
  cost: 10,
  residual_risk: 20,
  introduced_risk: 0,
  introduced_risks: [],
  new_risk_created: [],
  required_resources: [],
  available_resources: [],
  required_competencies: [],
};
const treatmentAck = {
  risk_id: riskId,
  scenario_id: scenarioId,
  selected: false,
  executable: true,
  readiness_gaps: [],
  recommendation_id: null,
  approval_id: null,
  net_risk_change: 20,
  human_approval_required: false,
  secondary_risks: [],
  advisory_only: true,
  human_decision_required: true,
};

describe("risk preview and information runtime qualification through actual SDK", () => {
  beforeEach(() => {
    wire.body = structuredClone(context);
    wire.fail = false;
    wire.requests = [];
  });
  it("accepts canonical complete advisory context and valid information acknowledgement", async () => {
    expect(await getRiskDecisionPreviewContext(riskId)).toEqual(context);
    wire.body = ack;
    expect(await recordRiskValueOfInformation(riskId, proposal)).toEqual(ack);
    expect(wire.requests[1]).toEqual({
      p_risk_id: riskId,
      p_analysis: proposal,
    });
  });
  it.each([
    {},
    { ...context, risk_id: criteriaId },
    { ...context, advisory_only: false },
    { ...context, human_decision_required: false },
    { ...context, active_competencies: [null] },
    { ...context, generated_at: "yesterday" },
    { ...context, criteria: null },
    { ...context, criteria: { ...context.criteria, thresholds: null } },
    { ...context, criteria: { ...context.criteria, likelihood_scale: [null] } },
    {
      ...context,
      criteria: { ...context.criteria, scoring_weights: { inherent: {} } },
    },
    { ...context, error: "" },
    { ...context, criteria: { ...context.criteria, likelihood_scale: ["5"] } },
    {
      ...context,
      criteria: { ...context.criteria, time_factors: { weight: false } },
    },
    { ...context, criteria: { ...context.criteria, risk_capacity: [] } },
  ])(
    "rejects malformed or unbound context %# before rendering",
    async (body) => {
      wire.body = body;
      await expect(getRiskDecisionPreviewContext(riskId)).rejects.toThrow();
    },
  );
  it.each([
    null,
    {},
    { error: "" },
    { ...ack, evidence_id: "not-an-id" },
    { ...ack, risk_id: criteriaId },
    { ...ack, human_decision_required: false },
    { ...ack, advisory_only: false },
    { ...ack, information_cost: 11 },
    { ...ack, information_action: "Another synthetic enquiry" },
    { ...ack, currency: "USD" },
    { ...ack, expected_value: null },
    { ...ack, recommendation: "APPROVED" },
    { ...ack, error: "Persisted but incomplete" },
    { error: "Persisted but incomplete", evidence_id: evidenceId },
    { ...ack, recorded_at: "2026-02-31T00:00:00Z" },
    { ...ack, net_value: 1000 },
  ])("rejects ambiguous information receipt %#", async (body) => {
    wire.body = body;
    await expect(
      recordRiskValueOfInformation(riskId, proposal),
    ).rejects.toThrow(/outcome.*unknown/i);
  });
  it.each(["", " ", null, false, -1, Number.POSITIVE_INFINITY])(
    "refuses invalid numeric input before transport %#",
    async (value) => {
      await expect(
        recordRiskValueOfInformation(riskId, {
          ...proposal,
          information_cost: value,
        }),
      ).rejects.toThrow();
      expect(wire.requests).toHaveLength(0);
    },
  );
  it("distinguishes actual SDK transport failure from a nonempty refusal", async () => {
    wire.fail = true;
    await expect(
      recordRiskValueOfInformation(riskId, proposal),
    ).rejects.toThrow(/outcome.*unknown/i);
    wire.fail = false;
    wire.body = { error: "Synthetic governed refusal" };
    await expect(
      recordRiskValueOfInformation(riskId, proposal),
    ).rejects.toThrow(/refused/i);
  });
  it("preserves valid incomplete draft context without fabricating engineering defaults", async () => {
    wire.body = {
      ...context,
      criteria: {
        ...context.criteria,
        status: "draft",
        likelihood_scale: [],
        thresholds: {},
        scoring_weights: {},
        decision_thresholds: {},
      },
    };
    expect((await getRiskDecisionPreviewContext(riskId)).criteria.status).toBe(
      "draft",
    );
  });
  it("refuses an unrepresentable calculation before recording", async () => {
    await expect(
      recordRiskValueOfInformation(riskId, {
        ...proposal,
        decision_cost_if_wrong: 1e308,
      }),
    ).rejects.toThrow(/representable|finite/i);
    expect(wire.requests).toHaveLength(0);
  });
});

describe("canonical server-numeric analysis preview and write qualification", () => {
  beforeEach(() => {
    wire.body = analysisPreview;
    wire.fail = false;
    wire.requests = [];
  });
  it("preserves server classification rather than reclassifying rounded values", async () => {
    expect(await getRiskAnalysisPreview(riskId, analysisProposal)).toEqual(
      analysisPreview,
    );
    wire.body = analysisAck;
    expect(await recordRiskAnalysis(riskId, analysisProposal)).toEqual(
      analysisAck,
    );
  });
  it("accepts JSONB key reordering and an explicitly diagnostic draft result", async () => {
    const reordered = Object.fromEntries(
      Object.entries(analysisProposal).reverse(),
    );
    wire.body = {
      ...analysisPreview,
      analysis: reordered,
      criteria_status: "draft",
      authoritative: false,
      recommended_action: "INVESTIGATE",
    };
    expect(
      (await getRiskAnalysisPreview(riskId, analysisProposal)).authoritative,
    ).toBe(false);
    wire.body = {
      ...analysisAck,
      authoritative: false,
      recommended_action: "INVESTIGATE",
    };
    expect(
      (await recordRiskAnalysis(riskId, analysisProposal)).authoritative,
    ).toBe(false);
  });
  it.each([
    {},
    { ...analysisPreview, risk_id: criteriaId },
    { ...analysisPreview, analysis: { ...analysisProposal, likelihood: 3 } },
    { ...analysisPreview, criteria_id: "wrong" },
    { ...analysisPreview, criteria_version: 0 },
    { ...analysisPreview, criteria_status: "draft" },
    { ...analysisPreview, current_score: null },
    { ...analysisPreview, authoritative: false },
    { ...analysisPreview, advisory_only: false },
    { ...analysisPreview, human_decision_required: false },
    { ...analysisPreview, level: "APPROVED" },
    { ...analysisPreview, recommended_action: "RUN" },
    {
      ...analysisPreview,
      criteria_status: "draft",
      authoritative: false,
      recommended_action: "STOP",
    },
  ])("refuses malformed or unbound analysis preview %#", async (body) => {
    wire.body = body;
    await expect(
      getRiskAnalysisPreview(riskId, analysisProposal),
    ).rejects.toThrow();
  });
  it.each([
    null,
    {},
    { error: "" },
    { ...analysisAck, risk_id: criteriaId },
    { ...analysisAck, status: "approved" },
    { ...analysisAck, current_score: null },
    { ...analysisAck, authoritative: "true" },
    { ...analysisAck, error: "partial" },
    { ...analysisAck, level: { toString: "High" } },
    { ...analysisAck, recommended_action: { toString: "TREAT" } },
    { ...analysisAck, authoritative: false, recommended_action: "STOP" },
  ])("keeps malformed analysis write receipt %# unknown", async (body) => {
    wire.body = body;
    await expect(recordRiskAnalysis(riskId, analysisProposal)).rejects.toThrow(
      /outcome.*unknown/i,
    );
  });
  it.each(["", null, false, Number.POSITIVE_INFINITY])(
    "refuses invalid analysis numeric input before preview or write %#",
    async (value) => {
      await expect(
        recordRiskAnalysis(riskId, { ...analysisProposal, likelihood: value }),
      ).rejects.toThrow();
      expect(wire.requests).toHaveLength(0);
    },
  );
  it("qualifies the canonical noncommitting contract-gap refusal separately from lost acknowledgement", async () => {
    wire.body = { error: "risk contract incomplete", gaps: ["named owner"] };
    await expect(recordRiskAnalysis(riskId, analysisProposal)).rejects.toThrow(
      /refused/i,
    );
    wire.fail = true;
    await expect(recordRiskAnalysis(riskId, analysisProposal)).rejects.toThrow(
      /outcome.*unknown/i,
    );
  });
});

describe("canonical treatment acknowledgement qualification through actual SDK", () => {
  beforeEach(() => {
    wire.body = treatmentAck;
    wire.fail = false;
    wire.requests = [];
  });
  it("qualifies comparison and selection receipts without treating either as approval", async () => {
    expect(await createRiskTreatment(riskId, treatmentOption, false)).toEqual(
      treatmentAck,
    );
    wire.body = {
      ...treatmentAck,
      selected: true,
      recommendation_id: recommendationId,
      approval_id: approvalId,
      human_approval_required: true,
    };
    expect(
      (await createRiskTreatment(riskId, treatmentOption, true)).selected,
    ).toBe(true);
    expect(wire.requests[1]).toEqual({
      p_risk_id: riskId,
      p_option: treatmentOption,
      p_select: true,
    });
  });
  it.each([
    {},
    { error: "" },
    [],
    { selected: true, executable: true },
    null,
    { ...treatmentAck, risk_id: criteriaId },
    { ...treatmentAck, scenario_id: "not-an-id" },
    { ...treatmentAck, selected: "false" },
    { ...treatmentAck, executable: "true" },
    { ...treatmentAck, executable: false },
    { ...treatmentAck, human_approval_required: "false" },
    { ...treatmentAck, selected: true },
    { ...treatmentAck, recommendation_id: recommendationId },
    { ...treatmentAck, readiness_gaps: [null] },
    { ...treatmentAck, readiness_gaps: ["resource: synthetic"] },
    { ...treatmentAck, net_risk_change: null },
    { ...treatmentAck, secondary_risks: null },
    { ...treatmentAck, advisory_only: false },
    { ...treatmentAck, human_decision_required: false },
    { ...treatmentAck, secondary_risks: [{ risk_id: childId }] },
    { ...treatmentAck, error: "Persisted scenario; selection refused" },
    {
      error: "Persisted scenario; selection refused",
      scenario_id: scenarioId,
      selected: false,
    },
    {
      error: "Persisted children; selection refused",
      secondary_risks: [{ risk_id: childId }],
    },
  ])("keeps malformed/partial treatment receipt %# unknown", async (body) => {
    wire.body = body;
    await expect(
      createRiskTreatment(riskId, treatmentOption, false),
    ).rejects.toThrow(/outcome.*unknown/i);
  });
  it("refuses selected receipts without recommendation and approval identities", async () => {
    wire.body = {
      ...treatmentAck,
      selected: true,
      human_approval_required: true,
    };
    await expect(
      createRiskTreatment(riskId, treatmentOption, true),
    ).rejects.toThrow(/outcome.*unknown/i);
  });
  it("accepts non-executable comparison metadata but does not accept it as a selected result", async () => {
    wire.body = {
      ...treatmentAck,
      executable: false,
      readiness_gaps: ["resource: synthetic crane"],
    };
    expect(
      (await createRiskTreatment(riskId, treatmentOption, false)).executable,
    ).toBe(false);
    wire.body = {
      ...treatmentAck,
      selected: true,
      executable: false,
      readiness_gaps: ["resource: synthetic crane"],
      recommendation_id: recommendationId,
      approval_id: approvalId,
      human_approval_required: true,
    };
    await expect(
      createRiskTreatment(riskId, treatmentOption, true),
    ).rejects.toThrow(/outcome.*unknown/i);
  });
  it("qualifies each requested secondary-risk identity and echoed rating without losing children", async () => {
    const child = {
      title: "Synthetic seal leak",
      event_description: "A synthetic seal fails and leaks",
      current_risk_score: 10,
      current_risk_level: "Low",
    };
    const option = {
      ...treatmentOption,
      introduced_risk: 10,
      introduced_risks: ["Synthetic seal leak"],
      new_risk_created: [child],
    };
    wire.body = {
      ...treatmentAck,
      secondary_risks: [
        { risk_id: childId, title: child.title, score: 10, level: "Low" },
      ],
    };
    expect(
      (await createRiskTreatment(riskId, option, false)).secondary_risks,
    ).toHaveLength(1);
    wire.body = treatmentAck;
    await expect(createRiskTreatment(riskId, option, false)).rejects.toThrow(
      /outcome.*unknown/i,
    );
    wire.body = {
      ...treatmentAck,
      secondary_risks: [
        { risk_id: childId, title: child.title, score: 50, level: "Low" },
      ],
    };
    await expect(createRiskTreatment(riskId, option, false)).rejects.toThrow(
      /outcome.*unknown/i,
    );
  });
  it("distinguishes only proven noncommitting refusals from transport and partial write failures", async () => {
    wire.body = { error: "Synthetic prewrite refusal" };
    await expect(
      createRiskTreatment(riskId, treatmentOption, true),
    ).rejects.toThrow(/refused/i);
    wire.body = {
      error: "treatment is not executable",
      selected: false,
      readiness_gaps: ["competency: synthetic inspection"],
    };
    await expect(
      createRiskTreatment(riskId, treatmentOption, true),
    ).rejects.toThrow(/refused/i);
    wire.fail = true;
    await expect(
      createRiskTreatment(riskId, treatmentOption, true),
    ).rejects.toThrow(/outcome.*unknown/i);
  });
  it.each([
    { select: true, gaps: [], label: "selected treatment without gaps" },
    { select: false, gaps: [], label: "comparison without gaps" },
    {
      select: false,
      gaps: ["competency: synthetic inspection"],
      label: "comparison with readiness gaps",
    },
  ])(
    "keeps impossible $label refusal unknown through the actual SDK",
    async ({ select, gaps }) => {
      wire.body = {
        error: "treatment is not executable",
        selected: false,
        readiness_gaps: gaps,
      };
      await expect(
        createRiskTreatment(riskId, treatmentOption, select),
      ).rejects.toThrow(/outcome.*unknown/i);
      expect(wire.requests).toHaveLength(1);
      expect(wire.requests[0]).toMatchObject({ p_select: select });
    },
  );
  it("refuses missing, parent-reused or duplicate secondary-risk identities", async () => {
    const child = {
      title: "Synthetic seal leak",
      current_risk_score: 10,
      current_risk_level: "Low",
    };
    const option = { ...treatmentOption, new_risk_created: [child] };
    for (const id of ["missing-id", riskId]) {
      wire.body = {
        ...treatmentAck,
        secondary_risks: [
          { risk_id: id, title: child.title, score: 10, level: "Low" },
        ],
      };
      await expect(createRiskTreatment(riskId, option, false)).rejects.toThrow(
        /outcome.*unknown/i,
      );
    }
    wire.body = {
      ...treatmentAck,
      secondary_risks: [
        { risk_id: childId, title: child.title, score: 10, level: "Low" },
        { risk_id: childId, title: child.title, score: 10, level: "Low" },
      ],
    };
    await expect(
      createRiskTreatment(
        riskId,
        { ...option, new_risk_created: [child, child] },
        false,
      ),
    ).rejects.toThrow(/outcome.*unknown/i);
  });
});
