import { beforeEach, describe, expect, it, vi } from "vitest";
import { getRiskUncertaintyWorkspace } from "./riskOperatingService";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../lib/supabase", () => ({ supabase: { rpc } }));

const organizationId = "a1820000-0000-4000-8000-000000000020";
const actorId = "a1820000-0000-4000-8000-000000000021";
const riskId = "a1820000-0000-4000-8000-000000000002";
const evidenceId = "a1820000-0000-4000-8000-000000000001";
const criteriaId = "a1820000-0000-4000-8000-000000000003";
const originalAuthorId = "a1820000-0000-4000-8000-000000000004";
const replacementAuthorId = originalAuthorId;
const nextAuthorId = originalAuthorId;
const otherAuthorId = "a1820000-0000-4000-8000-000000000007";
const reviewerId = "a1820000-0000-4000-8000-000000000005";
const predecessorId = "a1820000-0000-4000-8000-000000000010";
const successorId = "a1820000-0000-4000-8000-000000000011";
const nextSuccessorId = "a1820000-0000-4000-8000-000000000012";
const intentId = "a1820000-0000-4000-8000-000000000030";
const nextIntentId = "a1820000-0000-4000-8000-000000000031";
const policyDigest = "c".repeat(64);
const context = { organizationId, actorId };
const boundary =
  "Independent review validates the analysis packet. It does not verify an unverified source, accept risk, authorize operation, release work or commit spend.";
const failure = "Could not load the governed uncertainty workspace";

function analysis() {
  const value = {
    id: predecessorId,
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
    reviewDueAt: "2099-10-01T00:00:00+00:00",
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
    authorId: originalAuthorId,
    createdAt: "2026-09-30T00:00:00+00:00",
    reviewerId: null,
    reviewedAt: null,
    reviewNote: null,
    approvalId: null,
    derivedEvidenceItemId: null,
    evidenceItemIds: [evidenceId],
    operationalAuthorization: false,
  };
  return value as typeof value & {
    replacement?: unknown;
    supersession?: unknown;
  };
}

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
    analyses: [analysis()],
    boundary,
    operationalAuthorization: false,
  };
}

function replacementFor(predecessor: ReturnType<typeof analysis>) {
  return {
    predecessorAnalysisId: predecessor.id,
    intentId,
    requestFingerprint: "d".repeat(64),
    compareAndSwap: {
      analysisId: predecessor.id,
      version: predecessor.version,
      digestVersion: predecessor.digestVersion,
      analysisDigest: predecessor.analysisDigest,
      currentDigest: predecessor.currentDigest,
      policyDigest,
    },
    reason: "New verified evidence requires a replacement packet.",
  };
}

function replacementHistory() {
  const data = workspace();
  const predecessor = data.analyses[0];
  Object.assign(predecessor, {
    storedStatus: "superseded",
    validationStatus: "superseded",
    reviewStanding: "replacement_required",
    currentDigest: "a".repeat(64),
    replacement: null,
    supersession: {
      successorAnalysisId: successorId,
      at: "2026-10-02T00:00:00+00:00",
      byUserId: replacementAuthorId,
    },
  });
  const successor = structuredClone(analysis());
  Object.assign(successor, {
    id: successorId,
    version: 2,
    authorId: replacementAuthorId,
    createdAt: "2026-10-02T00:00:00+00:00",
    analysisDigest: "e".repeat(64),
    currentDigest: "e".repeat(64),
    replacement: replacementFor(predecessor),
    supersession: null,
  });
  data.analyses = [successor, predecessor];
  return data;
}

function object(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

function set(target: unknown, path: string, value: unknown) {
  const keys = path.split(".");
  let cursor = target as Record<string, unknown>;
  for (const key of keys.slice(0, -1))
    cursor = cursor[key] as Record<string, unknown>;
  cursor[keys.at(-1)!] = value;
}

function reply(data: unknown) {
  rpc.mockResolvedValue({ data, error: null, status: 200 });
}

async function expectRefusal(data: unknown) {
  reply(data);
  await expect(getRiskUncertaintyWorkspace(riskId, context)).rejects.toThrow(
    failure,
  );
}

beforeEach(() => rpc.mockReset());

describe("uncertainty atomic replacement history qualification", () => {
  it("keeps omitted history fields backward-compatible only for an ordinary row", async () => {
    const data = workspace();
    reply(data);
    await expect(getRiskUncertaintyWorkspace(riskId, context)).resolves.toEqual(
      data,
    );
  });

  it("retains explicit null history fields for an ordinary row", async () => {
    const data = workspace();
    Object.assign(data.analyses[0], {
      replacement: null,
      supersession: null,
    });
    reply(data);
    await expect(getRiskUncertaintyWorkspace(riskId, context)).resolves.toEqual(
      data,
    );
  });

  it("retains a reciprocal replacement pair and terminal superseded predecessor", async () => {
    const data = replacementHistory();
    reply(data);
    const result = await getRiskUncertaintyWorkspace(riskId, context);
    expect(result).toEqual(data);
    expect(result.analyses[1].storedStatus).toBe("superseded");
    expect(result.analyses[1].validationStatus).toBe("superseded");
    expect(result.analyses[1].reviewerId).toBeNull();
  });

  it("retains a middle chain row with both replacement and supersession metadata", async () => {
    const data = replacementHistory();
    const first = data.analyses[1];
    const middle = data.analyses[0];
    Object.assign(middle, {
      storedStatus: "superseded",
      validationStatus: "stale",
      reviewStanding: "replacement_required",
      currentDigest: "f".repeat(64),
      supersession: {
        successorAnalysisId: nextSuccessorId,
        at: "2026-10-03T00:00:00Z",
        byUserId: nextAuthorId,
      },
    });
    const last = structuredClone(analysis());
    const middleReplacement = replacementFor(middle);
    middleReplacement.intentId = nextIntentId;
    Object.assign(last, {
      id: nextSuccessorId,
      version: 3,
      authorId: nextAuthorId,
      createdAt: "2026-10-02T18:00:00-06:00",
      analysisDigest: "1".repeat(64),
      currentDigest: "1".repeat(64),
      replacement: middleReplacement,
      supersession: null,
    });
    data.analyses = [last, middle, first];
    reply(data);

    await expect(getRiskUncertaintyWorkspace(riskId, context)).resolves.toEqual(
      data,
    );
  });

  it("preserves request-time current and policy CAS digests without comparing them to later live state", async () => {
    const data = replacementHistory();
    const replacement = object(data.analyses[0].replacement);
    const compareAndSwap = object(replacement.compareAndSwap);
    compareAndSwap.currentDigest = "9".repeat(64);
    compareAndSwap.policyDigest = "8".repeat(64);
    data.criteria.policyDigest = "7".repeat(64);
    reply(data);

    await expect(getRiskUncertaintyWorkspace(riskId, context)).resolves.toEqual(
      data,
    );
  });

  it.each(["stale", "pending_review", "rejected", "validated"])(
    "refuses a superseded row mislabeled as %s",
    async (validationStatus) => {
      const data = replacementHistory();
      data.analyses[1].validationStatus = validationStatus;
      await expectRefusal(data);
    },
  );

  it("retains stale validation on a superseded packet whose live digest drifted", async () => {
    const data = replacementHistory();
    Object.assign(data.analyses[1], {
      currentDigest: "b".repeat(64),
      validationStatus: "stale",
    });
    reply(data);

    await expect(getRiskUncertaintyWorkspace(riskId, context)).resolves.toEqual(
      data,
    );
  });

  it("refuses a superseded validation label when the stored and live digests differ", async () => {
    const data = replacementHistory();
    data.analyses[1].currentDigest = "b".repeat(64);
    await expectRefusal(data);
  });

  it("refuses superseded history presented as a human review lifecycle", async () => {
    const data = replacementHistory();
    Object.assign(data.analyses[1], {
      reviewerId,
      reviewedAt: "2026-10-02T00:00:00Z",
      reviewNote: "Synthetic human rejection should not be inferred.",
      approvalId: "a1820000-0000-4000-8000-000000000040",
    });
    await expectRefusal(data);
  });

  it.each([
    ["predecessorAnalysisId", "not-a-uuid"],
    ["intentId", "not-a-uuid"],
    ["requestFingerprint", "D".repeat(64)],
    ["requestFingerprint", "d".repeat(63)],
    ["reason", "too short"],
    ["compareAndSwap", null],
    ["compareAndSwap.analysisId", "not-a-uuid"],
    ["compareAndSwap.version", 0],
    ["compareAndSwap.digestVersion", 3],
    ["compareAndSwap.analysisDigest", "A".repeat(64)],
    ["compareAndSwap.currentDigest", "b".repeat(63)],
    ["compareAndSwap.policyDigest", "g".repeat(64)],
  ])("refuses malformed replacement metadata %s=%j", async (path, value) => {
    const data = replacementHistory();
    const replacement = data.analyses[0].replacement;
    set(replacement, path as string, value);
    await expectRefusal(data);
  });

  it.each([
    ["successorAnalysisId", "not-a-uuid"],
    ["at", "not-a-date"],
    ["byUserId", "not-a-uuid"],
  ])("refuses malformed supersession metadata %s=%j", async (path, value) => {
    const data = replacementHistory();
    const supersession = data.analyses[1].supersession;
    set(supersession, path as string, value);
    await expectRefusal(data);
  });

  it("refuses missing or null supersession metadata on a superseded row", async () => {
    for (const mode of ["missing", "null"] as const) {
      const data = replacementHistory();
      if (mode === "missing") delete object(data.analyses[1]).supersession;
      else object(data.analyses[1]).supersession = null;
      await expectRefusal(data);
    }
  });

  it("refuses supersession metadata on a non-superseded row", async () => {
    const data = workspace();
    object(data.analyses[0]).supersession = {
      successorAnalysisId: successorId,
      at: "2026-10-02T00:00:00Z",
      byUserId: replacementAuthorId,
    };
    await expectRefusal(data);
  });

  it.each([
    ["predecessorAnalysisId", successorId],
    ["compareAndSwap.analysisId", successorId],
    ["compareAndSwap.version", 2],
    ["compareAndSwap.digestVersion", 1],
    ["compareAndSwap.analysisDigest", "6".repeat(64)],
  ])(
    "refuses replacement/predecessor CAS contradiction %s",
    async (path, value) => {
      const data = replacementHistory();
      set(data.analyses[0].replacement, path as string, value);
      await expectRefusal(data);
    },
  );

  it.each([
    ["analyses.1.supersession.successorAnalysisId", nextSuccessorId],
    ["analyses.1.supersession.byUserId", otherAuthorId],
    ["analyses.1.supersession.at", "2026-10-02T00:00:01Z"],
  ])("refuses nonreciprocal replacement history %s", async (path, value) => {
    const data = replacementHistory();
    set(data, path as string, value);
    await expectRefusal(data);
  });

  it("refuses a replacement relationship whose successor version does not increase", async () => {
    const data = replacementHistory();
    const predecessor = data.analyses[1];
    const successor = data.analyses[0];
    predecessor.version = 2;
    successor.version = 1;
    object(predecessor.supersession).successorAnalysisId = successor.id;
    const replacement = object(successor.replacement);
    object(replacement.compareAndSwap).version = predecessor.version;
    data.analyses = [predecessor, successor];
    await expectRefusal(data);
  });

  it("refuses a replacement relationship whose successor skips a canonical version", async () => {
    const data = replacementHistory();
    data.analyses[0].version = 3;
    await expectRefusal(data);
  });

  it("refuses a replacement relationship whose successor has a different author", async () => {
    const data = replacementHistory();
    data.analyses[0].authorId = otherAuthorId;
    object(data.analyses[1].supersession).byUserId = otherAuthorId;
    await expectRefusal(data);
  });
});
