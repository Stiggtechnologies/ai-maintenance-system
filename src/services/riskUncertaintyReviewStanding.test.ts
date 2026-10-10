import { beforeEach, describe, expect, it, vi } from "vitest";
import { getRiskUncertaintyWorkspace } from "./riskOperatingService";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../lib/supabase", () => ({ supabase: { rpc } }));

const riskId = "a1820000-0000-4000-8000-000000000002";
const organizationId = "a1820000-0000-4000-8000-000000000020";
const actorId = "a1820000-0000-4000-8000-000000000021";
const evidenceId = "a1820000-0000-4000-8000-000000000001";
const criteriaId = "a1820000-0000-4000-8000-000000000003";
const authorId = "a1820000-0000-4000-8000-000000000004";
const reviewerId = "a1820000-0000-4000-8000-000000000005";
const otherId = "a1820000-0000-4000-8000-000000000099";
const policyDigest = "b".repeat(64);
const context = { organizationId, actorId };
const boundary =
  "Independent review validates the analysis packet. It does not verify an unverified source, accept risk, authorize operation, release work or commit spend.";
const genericReadFailure = "Could not load the governed uncertainty workspace";

function workspace() {
  return {
    organizationId,
    actorId,
    risk: {
      id: riskId,
      organizationId,
      title: "Synthetic risk",
      status: "draft",
      currency: "CAD",
    },
    criteria: {
      id: criteriaId,
      organizationId,
      name: "Synthetic criteria",
      version: 1,
      status: "adopted",
      decisionThresholds: { investigate: 40 },
      policyDigest,
    },
    evidence: [
      {
        id: evidenceId,
        organizationId,
        riskId,
        description: "Synthetic measured evidence",
        sourceSystem: "synthetic",
        sourceReference: null,
        verificationStatus: "verified",
        verifiedBy: reviewerId,
        verifiedAt: "2026-09-29T00:00:00+00:00",
        evidenceClass: "MEASURED",
        qualityGrade: "high",
        applicabilityGrade: "direct",
      },
    ],
    analyses: [
      {
        id: "a1820000-0000-4000-8000-000000000010",
        organizationId,
        riskId,
        version: 1,
        digestVersion: 2,
        digestCoverage: "evidence_content_and_current_criteria",
        storedStatus: "pending_review",
        validationStatus: "pending_review",
        reviewStanding: "reviewable",
        method: "Synthetic estimate",
        basis: "Sourced synthetic assumption and method basis.",
        probability: { lower: 0.1, central: 0.2, upper: 0.4 },
        confidence: { level: 0.9, lower: 0.05, upper: 0.5 },
        lossCases: { best: 1, expected: 2, worst: 3, currency: "CAD" },
        sensitivityInputs: [
          {
            name: "Synthetic input",
            basis: "Sourced synthetic input and range basis.",
            low_input: -1,
            base_input: 0,
            high_input: 1,
            low_output: 3,
            base_output: 1,
            high_output: 2,
          },
        ],
        sensitivityResults: [
          {
            name: "Synthetic input",
            basis: "Sourced synthetic input and range basis.",
            lowInput: -1,
            baseInput: 0,
            highInput: 1,
            lowOutput: 3,
            baseOutput: 1,
            highOutput: 2,
            swing: 1,
          },
        ],
        thresholdProfileId: criteriaId,
        decisionThresholds: { investigate: 40 },
        reassessmentTriggers: ["Synthetic measured reassessment trigger"],
        reviewDueAt: "2026-10-01T00:00:00+00:00",
        valueOfInformation: {
          action: "Synthetic information action",
          informationCost: 1,
          decisionCostIfWrong: 2,
          uncertaintyReduction: 1,
          probabilityDecisionChanges: 1,
          expectedValue: 2,
          netValue: 1,
          recommendation: "GATHER_INFORMATION",
        },
        analysisDigest: "a".repeat(64),
        currentDigest: "a".repeat(64),
        authorId,
        createdAt: "2026-09-30T00:00:00+00:00",
        reviewerId: null,
        reviewedAt: null,
        reviewNote: null,
        approvalId: null,
        derivedEvidenceItemId: null,
        evidenceItemIds: [evidenceId],
        operationalAuthorization: false,
      },
    ],
    boundary,
    operationalAuthorization: false,
  };
}

function object(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

function reply(data: unknown) {
  rpc.mockResolvedValue({ data, error: null, status: 200 });
}

async function expectGenericRefusal(data: unknown) {
  reply(data);
  await expect(getRiskUncertaintyWorkspace(riskId, context)).rejects.toThrow(
    genericReadFailure,
  );
  expect(rpc).toHaveBeenCalledWith("get_risk_uncertainty_workspace", {
    p_risk_id: riskId,
  });
}

function makePolicyUnavailable(
  data: ReturnType<typeof workspace>,
  mode: "absent" | "draft" | "superseded" | "empty",
) {
  if (mode === "absent") {
    data.criteria = null as unknown as ReturnType<typeof workspace>["criteria"];
  } else if (mode === "draft" || mode === "superseded") {
    data.criteria.status = mode;
  } else {
    data.criteria.decisionThresholds =
      {} as typeof data.criteria.decisionThresholds;
  }
}

beforeEach(() => {
  rpc.mockReset();
});

describe("uncertainty review-standing read qualification", () => {
  it("retains a fresh reviewable packet and exact current policy digest", async () => {
    const data = workspace();
    reply(data);

    await expect(getRiskUncertaintyWorkspace(riskId, context)).resolves.toEqual(
      data,
    );
    expect(data.analyses[0].reviewStanding).toBe("reviewable");
    expect(data.criteria.policyDigest).toBe(policyDigest);
    expect(rpc).toHaveBeenCalledWith("get_risk_uncertainty_workspace", {
      p_risk_id: riskId,
    });
  });

  it("retains a legacy v1 replacement requirement without rewriting its validation status", async () => {
    const data = workspace();
    Object.assign(data.analyses[0], {
      digestVersion: 1,
      digestCoverage: "legacy_metadata",
      reviewStanding: "replacement_required",
    });
    data.criteria.decisionThresholds = { investigate: 41 };
    reply(data);

    const result = await getRiskUncertaintyWorkspace(riskId, context);
    expect(result).toEqual(data);
    expect(result.analyses[0].validationStatus).toBe("pending_review");
    expect(result.analyses[0].analysisDigest).toBe(
      result.analyses[0].currentDigest,
    );
  });

  it.each(["absent", "draft", "superseded", "empty"] as const)(
    "retains policy_unavailable when the current policy is %s",
    async (mode) => {
      const data = workspace();
      makePolicyUnavailable(data, mode);
      data.analyses[0].reviewStanding = "policy_unavailable";
      reply(data);

      await expect(
        getRiskUncertaintyWorkspace(riskId, context),
      ).resolves.toEqual(data);
    },
  );

  it("does not disprove replacement_required from decoded equality alone", async () => {
    const data = workspace();
    data.analyses[0].reviewStanding = "replacement_required";
    reply(data);

    await expect(getRiskUncertaintyWorkspace(riskId, context)).resolves.toEqual(
      data,
    );
    expect(data.analyses[0].analysisDigest).toBe(
      data.analyses[0].currentDigest,
    );
    expect(data.analyses[0].decisionThresholds).toEqual(
      data.criteria.decisionThresholds,
    );
  });

  it("preserves case-insensitive canonical context while making no client-side RLS claim", async () => {
    const data = workspace();
    reply(data);

    await expect(
      getRiskUncertaintyWorkspace(riskId.toUpperCase(), {
        organizationId: organizationId.toUpperCase(),
        actorId: actorId.toUpperCase(),
      }),
    ).resolves.toEqual(data);
    expect(rpc).toHaveBeenCalledWith("get_risk_uncertainty_workspace", {
      p_risk_id: riskId.toUpperCase(),
    });
  });

  it("refuses an analysis with missing review standing", async () => {
    const data = workspace();
    delete object(data.analyses[0]).reviewStanding;
    await expectGenericRefusal(data);
  });

  it.each([null, true, 1, ["reviewable"], "Reviewable", "ready"])(
    "refuses a coerced or invented review standing %j",
    async (standing) => {
      const data = workspace();
      object(data.analyses[0]).reviewStanding = standing;
      await expectGenericRefusal(data);
    },
  );

  it.each([
    undefined,
    null,
    true,
    7,
    "a".repeat(63),
    "A".repeat(64),
    "g".repeat(64),
  ])(
    "refuses a missing or malformed current policy digest %j",
    async (digest) => {
      const data = workspace();
      if (digest === undefined) delete object(data.criteria).policyDigest;
      else object(data.criteria).policyDigest = digest;
      await expectGenericRefusal(data);
    },
  );

  it("refuses reviewable when the current packet digest differs", async () => {
    const data = workspace();
    data.analyses[0].currentDigest = "c".repeat(64);
    data.analyses[0].validationStatus = "stale";
    await expectGenericRefusal(data);
  });

  it("refuses reviewable when the current criterion pointer differs", async () => {
    const data = workspace();
    data.analyses[0].thresholdProfileId = otherId;
    await expectGenericRefusal(data);
  });

  it("refuses reviewable when its decoded threshold snapshot differs from current policy", async () => {
    const data = workspace();
    data.criteria.decisionThresholds = { investigate: 41 };
    await expectGenericRefusal(data);
  });

  it.each(["missing", "unverified"] as const)(
    "refuses reviewable when a linked input is not currently same-risk verified: %s",
    async (mode) => {
      const data = workspace();
      if (mode === "missing") {
        data.analyses[0].evidenceItemIds = [otherId];
      } else {
        Object.assign(data.evidence[0], {
          verificationStatus: "unverified",
          verifiedBy: null,
          verifiedAt: null,
        });
      }
      await expectGenericRefusal(data);
    },
  );

  it("refuses policy_unavailable while an adopted nonempty current policy exists", async () => {
    const data = workspace();
    data.analyses[0].reviewStanding = "policy_unavailable";
    await expectGenericRefusal(data);
  });

  it.each([
    ["absent", "reviewable"],
    ["absent", "replacement_required"],
    ["draft", "reviewable"],
    ["draft", "replacement_required"],
    ["superseded", "reviewable"],
    ["superseded", "replacement_required"],
    ["empty", "reviewable"],
    ["empty", "replacement_required"],
  ] as const)(
    "refuses %s current policy with non-unavailable standing %s",
    async (mode, standing) => {
      const data = workspace();
      makePolicyUnavailable(data, mode);
      data.analyses[0].reviewStanding = standing;
      await expectGenericRefusal(data);
    },
  );
});
