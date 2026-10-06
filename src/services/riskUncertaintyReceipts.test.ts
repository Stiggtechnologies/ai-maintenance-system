import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { evaluateValueOfInformation } from "../lib/risk-operating-system";
import {
  reviewRiskUncertaintyAnalysis,
  submitRiskUncertaintyAnalysis,
  type RiskUncertaintySubmission,
} from "./riskOperatingService";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../lib/supabase", () => ({ supabase: { rpc } }));

const riskId = "a1820000-0000-4000-8000-000000000002";
const analysisId = "a1820000-0000-4000-8000-000000000010";
const otherId = "a1820000-0000-4000-8000-000000000011";
const analysisDigest = "a".repeat(64);
const context = { riskId, analysisDigest };
const submission = {
  voi_information_cost: 10000,
  voi_decision_cost_if_wrong: 250000,
  voi_uncertainty_reduction: 0.5,
  voi_probability_decision_changes: 0.3,
} as RiskUncertaintySubmission;
const submitted = {
  riskId,
  analysisId,
  version: 1,
  analysisDigest,
  validationStatus: "pending_review",
  valueOfInformation: {
    informationCost: 10000,
    decisionCostIfWrong: 250000,
    uncertaintyReduction: 0.5,
    probabilityDecisionChanges: 0.3,
    expectedValue: 37500,
    netValue: 27500,
    recommendation: "GATHER_INFORMATION",
  },
  operationalAuthorization: false,
};
const reviewed = {
  riskId,
  analysisId,
  analysisDigest,
  decision: "validated",
  approvalId: "a1820000-0000-4000-8000-000000000012",
  derivedEvidenceItemId: "a1820000-0000-4000-8000-000000000013",
  operationalAuthorization: false,
};

beforeEach(() => {
  rpc.mockReset();
});

describe("uncertainty acknowledgement qualification", () => {
  it.each([
    { id: "not-a-uuid", ctx: context, decision: "validated" },
    {
      id: analysisId,
      ctx: { ...context, riskId: "not-a-uuid" },
      decision: "validated",
    },
    {
      id: analysisId,
      ctx: { ...context, analysisDigest: "not-a-sha256" },
      decision: "validated",
    },
    { id: analysisId, ctx: context, decision: "approve-operation" },
  ])(
    "refuses malformed review context before any RPC ($id, $decision)",
    async ({ id, ctx, decision }) => {
      await expect(
        reviewRiskUncertaintyAnalysis(
          id,
          decision as "validated",
          "Independent exact packet review basis.",
          ctx,
        ),
      ).rejects.toThrow("selected canonical risk and frozen packet digest");
      expect(rpc).not.toHaveBeenCalled();
    },
  );

  it("accepts the same canonical submission UUID when PostgreSQL normalizes caller case", async () => {
    rpc.mockResolvedValue({ data: submitted, error: null });
    await expect(
      submitRiskUncertaintyAnalysis(riskId.toUpperCase(), submission, []),
    ).resolves.toEqual(submitted);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it.each(["risk", "analysis", "receipt"])(
    "preserves review identity across UUID case in %s",
    async (branch) => {
      const receipt =
        branch === "receipt"
          ? {
              ...reviewed,
              riskId: riskId.toUpperCase(),
              analysisId: analysisId.toUpperCase(),
            }
          : reviewed;
      rpc.mockResolvedValue({ data: receipt, error: null });
      await expect(
        reviewRiskUncertaintyAnalysis(
          branch === "analysis" ? analysisId.toUpperCase() : analysisId,
          "validated",
          "Independent exact packet review basis.",
          {
            ...context,
            riskId: branch === "risk" ? riskId.toUpperCase() : riskId,
          },
        ),
      ).resolves.toEqual(receipt);
      expect(rpc).toHaveBeenCalledTimes(1);
    },
  );

  it.each([false, true])(
    "captures the original review risk/digest before dispatch despite later context mutation (rebound %s)",
    async (rebound) => {
      let release!: (value: unknown) => void;
      rpc.mockReturnValue(
        new Promise((resolve) => {
          release = resolve;
        }),
      );
      const mutable = { ...context };
      const pending = reviewRiskUncertaintyAnalysis(
        analysisId,
        "validated",
        "Independent exact packet review basis.",
        mutable,
      );
      mutable.riskId = otherId;
      mutable.analysisDigest = "b".repeat(64);
      const receipt = rebound
        ? {
            ...reviewed,
            riskId: mutable.riskId,
            analysisDigest: mutable.analysisDigest,
          }
        : reviewed;
      release({ data: receipt, error: null });
      if (rebound)
        await expect(pending).rejects.toMatchObject({ outcomeUnknown: true });
      else await expect(pending).resolves.toEqual(reviewed);
      expect(rpc).toHaveBeenCalledTimes(1);
    },
  );

  it("retains the complete canonical submission receipt", async () => {
    rpc.mockResolvedValue({ data: submitted, error: null });
    await expect(
      submitRiskUncertaintyAnalysis(riskId, submission, []),
    ).resolves.toEqual(submitted);
  });

  it.each([0, -2])(
    "retains a coherent non-positive VOI receipt (%s)",
    async (netValue) => {
      const receipt = {
        ...submitted,
        valueOfInformation: {
          informationCost: 1 - netValue,
          decisionCostIfWrong: 1,
          uncertaintyReduction: 1,
          probabilityDecisionChanges: 1,
          expectedValue: 1,
          netValue,
          recommendation: "DECIDE_WITH_CURRENT_INFORMATION",
        },
      };
      rpc.mockResolvedValue({ data: receipt, error: null });
      await expect(
        submitRiskUncertaintyAnalysis(
          riskId,
          {
            ...submission,
            voi_information_cost: 1 - netValue,
            voi_decision_cost_if_wrong: 1,
            voi_uncertainty_reduction: 1,
            voi_probability_decision_changes: 1,
          },
          [],
        ),
      ).resolves.toEqual(receipt);
    },
  );

  it.each(
    [
      null,
      {},
      [],
      { error: "" },
      { ...submitted, riskId: otherId },
      { ...submitted, analysisId: "not-an-id" },
      { ...submitted, analysisDigest: "" },
      { ...submitted, version: 0 },
      { ...submitted, version: Number.MAX_SAFE_INTEGER + 1 },
      { ...submitted, validationStatus: "validated" },
      { ...submitted, operationalAuthorization: true },
      { ...submitted, valueOfInformation: null },
      {
        ...submitted,
        valueOfInformation: { ...submitted.valueOfInformation, netValue: NaN },
      },
      {
        ...submitted,
        valueOfInformation: {
          ...submitted.valueOfInformation,
          recommendation: "APPROVE_SPEND",
        },
      },
      {
        ...submitted,
        valueOfInformation: {
          expectedValue: 1,
          netValue: -2,
          recommendation: "GATHER_INFORMATION",
        },
      },
      {
        ...submitted,
        valueOfInformation: {
          expectedValue: 1,
          netValue: 2,
          recommendation: "GATHER_INFORMATION",
        },
      },
      {
        ...submitted,
        valueOfInformation: {
          expectedValue: 1,
          netValue: 0,
          recommendation: "GATHER_INFORMATION",
        },
      },
      {
        ...submitted,
        valueOfInformation: {
          expectedValue: 1,
          netValue: 1,
          recommendation: "DECIDE_WITH_CURRENT_INFORMATION",
        },
      },
    ].map((data) => [data]),
  )(
    "does not report a partial or mismatched submission as success: %j",
    async (data) => {
      rpc.mockResolvedValue({ data, error: null });
      await expect(
        submitRiskUncertaintyAnalysis(riskId, submission, []),
      ).rejects.toThrow();
    },
  );

  it("retains the complete review receipt bound to the selected packet", async () => {
    rpc.mockResolvedValue({ data: reviewed, error: null });
    await expect(
      reviewRiskUncertaintyAnalysis(
        analysisId,
        "validated",
        "Independent frozen packet review.",
        context,
      ),
    ).resolves.toEqual(reviewed);
  });

  it.each(
    [
      {},
      [],
      { error: "" },
      { ...reviewed, riskId: otherId },
      { ...reviewed, analysisId: otherId },
      { ...reviewed, analysisDigest: "b".repeat(64) },
      { ...reviewed, decision: "rejected" },
      { ...reviewed, approvalId: null },
      { ...reviewed, derivedEvidenceItemId: null },
      { ...reviewed, operationalAuthorization: "false" },
    ].map((data) => [data]),
  )("does not record an incomplete or different review: %j", async (data) => {
    rpc.mockResolvedValue({ data, error: null });
    await expect(
      reviewRiskUncertaintyAnalysis(
        analysisId,
        "validated",
        "Independent frozen packet review.",
        context,
      ),
    ).rejects.toThrow();
  });

  it("permits a complete rejected review only without derived validated evidence", async () => {
    const rejected = {
      ...reviewed,
      decision: "rejected",
      derivedEvidenceItemId: null,
    };
    rpc.mockResolvedValue({ data: rejected, error: null });
    await expect(
      reviewRiskUncertaintyAnalysis(
        analysisId,
        "rejected",
        "Independent frozen packet rejection.",
        context,
      ),
    ).resolves.toEqual(rejected);
  });

  it("classifies a lost acknowledgement as unknown rather than a safe retry", async () => {
    rpc.mockRejectedValue(new Error("connection lost after dispatch"));
    await expect(
      submitRiskUncertaintyAnalysis(riskId, submission, []),
    ).rejects.toMatchObject({ outcomeUnknown: true });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("does not treat identity-bearing error data as a qualified refusal", async () => {
    rpc.mockResolvedValue({
      data: { error: "Denied", analysisId },
      error: null,
    });
    await expect(
      submitRiskUncertaintyAnalysis(riskId, submission, []),
    ).rejects.toMatchObject({ outcomeUnknown: true });
  });

  it("retains a plain explicit server refusal without a success identity", async () => {
    rpc.mockResolvedValue({
      data: { error: "Archived risks cannot receive a packet" },
      error: null,
    });
    await expect(
      submitRiskUncertaintyAnalysis(riskId, submission, []),
    ).rejects.toThrow("Archived risks");
  });
});

const parityCases = [
  [
    "previous false-overflow witness",
    10,
    1e308,
    0.5,
    0.5,
    2.5e307,
    2.5e307,
    "GATHER_INFORMATION",
  ],
  [
    "maximum finite equality",
    Number.MAX_VALUE,
    Number.MAX_VALUE,
    1,
    1,
    Number.MAX_VALUE,
    0,
    "DECIDE_WITH_CURRENT_INFORMATION",
  ],
  [
    "maximum finite positive",
    0,
    Number.MAX_VALUE,
    1,
    1,
    Number.MAX_VALUE,
    Number.MAX_VALUE,
    "GATHER_INFORMATION",
  ],
  [
    "maximum finite negative",
    Number.MAX_VALUE,
    0,
    1,
    1,
    0,
    -Number.MAX_VALUE,
    "DECIDE_WITH_CURRENT_INFORMATION",
  ],
  [
    "large positive cents",
    0,
    100000000000000.03,
    0.999,
    1,
    99900000000000.03,
    99900000000000.03,
    "GATHER_INFORMATION",
  ],
  [
    "large negative cents",
    100000000000000.03,
    0,
    1,
    1,
    0,
    -100000000000000.03,
    "DECIDE_WITH_CURRENT_INFORMATION",
  ],
  [
    "finite scientific positive",
    0,
    1e307,
    1,
    1,
    1e307,
    1e307,
    "GATHER_INFORMATION",
  ],
  [
    "finite scientific negative",
    1e307,
    0,
    1,
    1,
    0,
    -1e307,
    "DECIDE_WITH_CURRENT_INFORMATION",
  ],
  ["positive sub-cent", 1, 1.004, 1, 1, 1, 0, "GATHER_INFORMATION"],
  ["exact equality", 1, 1, 1, 1, 1, 0, "DECIDE_WITH_CURRENT_INFORMATION"],
  [
    "negative sub-cent",
    1,
    0.996,
    1,
    1,
    1,
    0,
    "DECIDE_WITH_CURRENT_INFORMATION",
  ],
  ["sub-cent benefit", 0, 0.004, 1, 1, 0, 0, "GATHER_INFORMATION"],
  ["positive half-cent", 0, 0.005, 1, 1, 0.01, 0.01, "GATHER_INFORMATION"],
  [
    "negative half-cent",
    0.005,
    0,
    1,
    1,
    0,
    -0.01,
    "DECIDE_WITH_CURRENT_INFORMATION",
  ],
  ["normal", 10000, 250000, 0.5, 0.3, 37500, 27500, "GATHER_INFORMATION"],
  [
    "fractional exact equality",
    0.006,
    0.1,
    0.2,
    0.3,
    0.01,
    0,
    "DECIDE_WITH_CURRENT_INFORMATION",
  ],
  [
    "no intermediate rounding",
    0.004,
    0.014,
    0.5,
    1,
    0.01,
    0,
    "GATHER_INFORMATION",
  ],
] as const;

describe("uncertainty canonical unrounded VOI acknowledgement parity", () => {
  it.each(parityCases)(
    "qualifies %s through the actual SDK transport",
    async (
      _label,
      informationCost,
      decisionCostIfWrong,
      uncertaintyReduction,
      probabilityDecisionChanges,
      expectedValue,
      netValue,
      recommendation,
    ) => {
      const { createClient } = await import("@supabase/supabase-js");
      const actual = createClient(
        "https://synthetic-uncertainty.invalid",
        "synthetic-public-key",
        {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
            storageKey: `synthetic-uncertainty-${_label}`,
          },
          global: {
            fetch: async (_url, init) => {
              const args = JSON.parse(String(init?.body));
              expect(args.p_analysis.voi_information_cost).toBe(
                informationCost,
              );
              return new Response(JSON.stringify(receipt), {
                status: 200,
                headers: { "content-type": "application/json" },
              });
            },
          },
        },
      );
      const input = {
        ...submission,
        voi_information_cost: informationCost,
        voi_decision_cost_if_wrong: decisionCostIfWrong,
        voi_uncertainty_reduction: uncertaintyReduction,
        voi_probability_decision_changes: probabilityDecisionChanges,
      };
      const receipt = {
        ...submitted,
        valueOfInformation: {
          informationCost,
          decisionCostIfWrong,
          uncertaintyReduction,
          probabilityDecisionChanges,
          expectedValue,
          netValue,
          recommendation,
        },
      };
      const canonical = evaluateValueOfInformation({
        informationCost,
        decisionCostIfWrong,
        uncertaintyReduction,
        probabilityDecisionChanges,
      });
      expect(canonical).toMatchObject({
        expectedValue,
        netValue,
        recommendation,
      });
      rpc.mockImplementation((name, args) => actual.rpc(name, args));
      await expect(
        submitRiskUncertaintyAnalysis(riskId, input, []),
      ).resolves.toEqual(receipt);
      expect(rpc).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    "informationCost",
    "decisionCostIfWrong",
    "uncertaintyReduction",
    "probabilityDecisionChanges",
  ])("rejects a missing or changed %s sign basis", async (field) => {
    for (const value of [undefined, "1", Infinity, -1, 0.123]) {
      const basis: Record<string, unknown> = {
        ...submitted.valueOfInformation,
      };
      if (value === undefined) delete basis[field];
      else basis[field] = value;
      rpc.mockResolvedValue({
        data: { ...submitted, valueOfInformation: basis },
        error: null,
      });
      await expect(
        submitRiskUncertaintyAnalysis(riskId, submission, []),
      ).rejects.toMatchObject({ outcomeUnknown: true });
    }
  });

  it.each([
    { expectedValue: 37501 },
    { netValue: 27501 },
    { recommendation: "DECIDE_WITH_CURRENT_INFORMATION" },
  ])(
    "rejects mismatched canonical display or sign result %j",
    async (mismatch) => {
      rpc.mockResolvedValue({
        data: {
          ...submitted,
          valueOfInformation: { ...submitted.valueOfInformation, ...mismatch },
        },
        error: null,
      });
      await expect(
        submitRiskUncertaintyAnalysis(riskId, submission, []),
      ).rejects.toMatchObject({ outcomeUnknown: true });
    },
  );

  it.each([
    { voi_information_cost: -1 },
    { voi_information_cost: NaN },
    { voi_decision_cost_if_wrong: Infinity },
    { voi_decision_cost_if_wrong: -1 },
    { voi_uncertainty_reduction: 1.1 },
    { voi_probability_decision_changes: -0.1 },
    { voi_uncertainty_reduction: undefined },
    {
      voi_decision_cost_if_wrong: -Infinity,
      voi_information_cost: 0,
      voi_uncertainty_reduction: 1,
      voi_probability_decision_changes: 1,
    },
  ])("refuses unsafe VOI input before dispatch %j", async (invalid) => {
    rpc.mockResolvedValue({ data: submitted, error: null });
    await expect(
      submitRiskUncertaintyAnalysis(
        riskId,
        { ...submission, ...invalid } as RiskUncertaintySubmission,
        [],
      ),
    ).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("binds the sign calculation and wire inputs to an immutable pre-await proposal", async () => {
    const input = { ...submission };
    rpc.mockImplementation((_name, args) => {
      input.voi_information_cost = 40000;
      expect(args.p_analysis.voi_information_cost).toBe(10000);
      return Promise.resolve({ data: submitted, error: null });
    });
    await expect(
      submitRiskUncertaintyAnalysis(riskId, input, []),
    ).resolves.toEqual(submitted);
  });

  it("specifies raw numeric classification before independently rounded displays and four input echoes", () => {
    const sql = readFileSync(
      "supabase/migrations/20270103050000_risk_uncertainty_analysis.sql",
      "utf8",
    );
    expect(sql).toContain(
      "v_voi_expected_raw:=v_wrong_cost*v_uncertainty_reduction*v_change_probability;",
    );
    expect(sql).toContain("v_voi_net_raw:=v_voi_expected_raw-v_info_cost;");
    const sign = sql.indexOf("case when v_voi_net_raw>0 then");
    expect(sign).toBeGreaterThan(sql.indexOf("v_voi_net_raw:="));
    expect(
      sql.indexOf("v_voi_expected:=round(v_voi_expected_raw,2);"),
    ).toBeGreaterThan(sign);
    expect(sql.indexOf("v_voi_net:=round(v_voi_net_raw,2);")).toBeGreaterThan(
      sign,
    );
    expect(sql).toContain(
      "'informationCost',v_info_cost,'decisionCostIfWrong',v_wrong_cost",
    );
    expect(sql).toContain(
      "'uncertaintyReduction',v_uncertainty_reduction,'probabilityDecisionChanges',v_change_probability",
    );
  });

  it("retains additive native canonical-writer parity cases inside the original rollback", () => {
    const sql = readFileSync(
      "scripts/tests/risk-uncertainty-analysis-postgres-tests.sql",
      "utf8",
    );
    const start = sql.indexOf("-- U18 VOI PARITY BEGIN");
    const end = sql.indexOf("-- U18 VOI PARITY END");
    expect(start).toBeGreaterThan(sql.indexOf("begin;"));
    expect(end).toBeGreaterThan(start);
    expect(end).toBeLessThan(sql.indexOf("rollback;"));
    const cases = sql.slice(start, end);
    for (const label of [
      "large_positive_cents",
      "large_negative_cents",
      "finite_scientific_positive",
      "finite_scientific_negative",
      "maximum_finite_positive",
      "maximum_finite_negative",
      "previous_false_overflow_witness",
      "maximum_finite_equality",
      "positive_sub_cent",
      "exact_equality",
      "negative_sub_cent",
      "sub_cent_benefit",
      "positive_half_cent",
      "negative_half_cent",
      "normal",
      "fractional_exact_equality",
      "no_intermediate_rounding",
    ])
      expect(cases).toContain(`'${label}'`);
    expect(cases).toContain("public.record_risk_value_of_information(f.risk");
    expect(cases).toContain(
      "canonical->>'recommendation' is distinct from sample.recommendation",
    );
    expect(cases).toContain(
      "result->'valueOfInformation' is distinct from jsonb_build_object(",
    );
    expect(cases).toContain(
      "if not qualified or pg_temp.u18_state() is distinct from baseline then",
    );
    expect(cases).toContain("if attempts<>17 then");
    // PostgreSQL retains the subtraction exactly even when JSON-number decoding
    // cannot distinguish this net value from the displayed benefit at this scale.
    expect(cases).toContain("2.5e307::numeric,(2.5e307::numeric-10)");
    expect(cases).not.toMatch(/\b(commit|truncate|delete)\b/i);
  });
});
