import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { render, screen } from "@testing-library/react";
import { getRiskUncertaintyWorkspace } from "./riskOperatingService";
import { RiskUncertaintyPanel } from "../components/risk/RiskUncertaintyPanel";

const wire = vi.hoisted(() => ({
  body: null as unknown,
  raw: null as string | null,
  status: 200,
  failure: false,
  requests: [] as unknown[],
  wait: null as Promise<void> | null,
}));
vi.mock("../lib/supabase", async () => {
  const { createClient } = await import("@supabase/supabase-js");
  return {
    supabase: createClient(
      "https://synthetic-uncertainty.invalid",
      "synthetic-key",
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
        global: {
          fetch: async (_url, init) => {
            wire.requests.push(JSON.parse(String(init?.body)));
            if (wire.wait) await wire.wait;
            if (wire.failure)
              throw new TypeError("Private synthetic transport detail");
            return new Response(wire.raw ?? JSON.stringify(wire.body), {
              status: wire.status,
              headers: { "content-type": "application/json" },
            });
          },
        },
      },
    ),
  };
});

const riskId = "a1820000-0000-4000-8000-000000000002";
const organizationId = "a1820000-0000-4000-8000-000000000020";
const actorId = "a1820000-0000-4000-8000-000000000021";
const otherId = "a1820000-0000-4000-8000-000000000099";
const context = { organizationId, actorId };
const evidenceId = "a1820000-0000-4000-8000-000000000001";
const criteriaId = "a1820000-0000-4000-8000-000000000003";
const authorId = "a1820000-0000-4000-8000-000000000004";
const reviewerId = "a1820000-0000-4000-8000-000000000005";
const boundary =
  "Independent review validates the analysis packet. It does not verify an unverified source, accept risk, authorize operation, release work or commit spend.";

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
      policyDigest: "b".repeat(64),
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

function set(target: unknown, path: string, value: unknown) {
  const keys = path.split(".");
  let cursor = target as Record<string, unknown>;
  for (const key of keys.slice(0, -1))
    cursor = cursor[key] as Record<string, unknown>;
  cursor[keys.at(-1)!] = value;
}

beforeEach(() => {
  wire.body = workspace();
  wire.raw = null;
  wire.status = 200;
  wire.failure = false;
  wire.requests = [];
  wire.wait = null;
});

describe("uncertainty canonical workspace read qualification", () => {
  it("retains a complete canonical packet without coercing or changing its source", async () => {
    await expect(getRiskUncertaintyWorkspace(riskId, context)).resolves.toEqual(
      wire.body,
    );
    expect(wire.requests).toEqual([{ p_risk_id: riskId }]);
  });

  it.each([
    [1, "legacy_metadata"],
    [2, "evidence_content_and_current_criteria"],
  ])(
    "retains explicit coverage %s/%s without upgrading legacy history",
    async (digestVersion, digestCoverage) => {
      const data = workspace();
      Object.assign(data.analyses[0], { digestVersion, digestCoverage });
      wire.body = data;
      await expect(
        getRiskUncertaintyWorkspace(riskId, context),
      ).resolves.toEqual(data);
      expect(wire.requests).toEqual([{ p_risk_id: riskId }]);
    },
  );

  it.each([
    [undefined, "evidence_content_and_current_criteria"],
    [null, "evidence_content_and_current_criteria"],
    ["2", "evidence_content_and_current_criteria"],
    [true, "legacy_metadata"],
    [0, "legacy_metadata"],
    [3, "evidence_content_and_current_criteria"],
    [2, undefined],
    [2, null],
    [2, "legacy_metadata"],
    [1, "evidence_content_and_current_criteria"],
    [2, "source_approved"],
    [2, {}],
  ])(
    "refuses malformed or falsely upgraded coverage %s/%s",
    async (digestVersion, digestCoverage) => {
      const data = workspace();
      Object.assign(data.analyses[0], { digestVersion, digestCoverage });
      wire.body = data;
      await expect(
        getRiskUncertaintyWorkspace(riskId, context),
      ).rejects.toThrow();
      expect(wire.requests).toEqual([{ p_risk_id: riskId }]);
    },
  );

  it("shows canonical coverage through the real reader and panel, without source approval inference", async () => {
    render(
      createElement(RiskUncertaintyPanel, {
        riskId,
        currentOrganizationId: organizationId,
        currentUserId: actorId,
        currentUserRole: "viewer",
      }),
    );
    expect(
      await screen.findByText(
        "Digest v2 · evidence content and current criteria",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Digest coverage does not establish source approval, claim fitness or operational authority.",
      ),
    ).toBeInTheDocument();
    expect(wire.requests).toEqual([{ p_risk_id: riskId }]);
  });

  it("labels legacy coverage through the real reader and panel, never as full content coverage", async () => {
    const data = workspace();
    Object.assign(data.analyses[0], {
      digestVersion: 1,
      digestCoverage: "legacy_metadata",
    });
    wire.body = data;
    render(
      createElement(RiskUncertaintyPanel, {
        riskId,
        currentOrganizationId: organizationId,
        currentUserId: actorId,
        currentUserRole: "viewer",
      }),
    );
    expect(
      await screen.findByText("Digest v1 · legacy evidence metadata only"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Digest v2 · evidence content and current criteria"),
    ).not.toBeInTheDocument();
  });

  it.each([
    ["risk UUID", "not-a-uuid", context],
    ["organization UUID", riskId, { ...context, organizationId: "org-1" }],
    ["actor UUID", riskId, { ...context, actorId: "actor-1" }],
    ["missing context", riskId, undefined],
    ["null context", riskId, null],
  ])(
    "refuses invalid observed %s before dispatch",
    async (_name, id, observed) => {
      await expect(
        getRiskUncertaintyWorkspace(id as string, observed as typeof context),
      ).rejects.toThrow(/canonical/i);
      expect(wire.requests).toHaveLength(0);
    },
  );

  it("retains a canonical positive raw NUMERIC sign after JSON decoding loses operand precision", async () => {
    const data = workspace();
    Object.assign(data.analyses[0].valueOfInformation, {
      informationCost: 1,
      decisionCostIfWrong: 1,
      expectedValue: 1,
      netValue: 0,
      recommendation: "GATHER_INFORMATION",
    });
    wire.raw = JSON.stringify(data).replace(
      '"decisionCostIfWrong":1,',
      '"decisionCostIfWrong":1.000000000000000000000000001,',
    );
    await expect(getRiskUncertaintyWorkspace(riskId, context)).resolves.toEqual(
      data,
    );
  });

  it.each(["negative", "equality"])(
    "retains canonical %s raw NUMERIC sign without inventing a sign from rounded operands",
    async (kind) => {
      const data = workspace();
      Object.assign(data.analyses[0].valueOfInformation, {
        informationCost: 1,
        decisionCostIfWrong: 1,
        expectedValue: 1,
        netValue: 0,
        recommendation: "DECIDE_WITH_CURRENT_INFORMATION",
      });
      wire.raw = JSON.stringify(data).replace(
        '"informationCost":1,',
        '"informationCost":1.000000000000000000000000001,',
      );
      if (kind === "equality")
        wire.raw = wire.raw.replace(
          '"decisionCostIfWrong":1,',
          '"decisionCostIfWrong":1.000000000000000000000000001,',
        );
      await expect(
        getRiskUncertaintyWorkspace(riskId, context),
      ).resolves.toEqual(data);
    },
  );

  it.each([
    "informationCost",
    "decisionCostIfWrong",
    "uncertaintyReduction",
    "probabilityDecisionChanges",
    "expectedValue",
    "netValue",
  ])(
    "refuses nonnumeric/nonfinite VOI %s without substituting a safe default",
    async (field) => {
      for (const value of [NaN, Infinity, -Infinity, null, "1", true]) {
        const data = workspace();
        set(data, `analyses.0.valueOfInformation.${field}`, value);
        wire.body = data;
        await expect(
          getRiskUncertaintyWorkspace(riskId, context),
        ).rejects.toThrow();
      }
    },
  );

  it("captures observed identities before awaiting, even if the caller mutates its context", async () => {
    const observed = { ...context };
    let finish!: () => void;
    wire.wait = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const pending = getRiskUncertaintyWorkspace(riskId, observed);
    observed.organizationId = otherId;
    observed.actorId = otherId;
    finish();
    await expect(pending).resolves.toEqual(wire.body);
  });

  it("validates and binds each captured context value once rather than rereading accessors", async () => {
    let organizations = 0;
    let actors = 0;
    const observed = {
      get organizationId() {
        return ++organizations === 1 ? organizationId : otherId;
      },
      get actorId() {
        return ++actors === 1 ? actorId : otherId;
      },
    };
    await expect(
      getRiskUncertaintyWorkspace(riskId, observed),
    ).resolves.toEqual(wire.body);
    expect(organizations).toBe(1);
    expect(actors).toBe(1);
  });

  it.each([
    null,
    [],
    {},
    "synthetic",
    1,
    { error: "" },
    { error: null },
    { error: "Private synthetic identity detail" },
  ])(
    "refuses a malformed top-level read (%j) with a fixed diagnostic",
    async (reply) => {
      wire.body = reply;
      await expect(
        getRiskUncertaintyWorkspace(riskId, context),
      ).rejects.toThrow("Could not load the governed uncertainty workspace");
      await expect(
        getRiskUncertaintyWorkspace(riskId, context),
      ).rejects.not.toThrow("Private synthetic identity detail");
    },
  );

  it.each([400, 401, 403, 500])(
    "refuses non-successful transport %s even with a plausible packet",
    async (status) => {
      wire.status = status;
      await expect(
        getRiskUncertaintyWorkspace(riskId, context),
      ).rejects.toThrow("Could not load the governed uncertainty workspace");
    },
  );

  it("refuses a lost transport without exposing provider detail", async () => {
    wire.failure = true;
    await expect(getRiskUncertaintyWorkspace(riskId, context)).rejects.toThrow(
      "Could not load the governed uncertainty workspace",
    );
    await expect(
      getRiskUncertaintyWorkspace(riskId, context),
    ).rejects.not.toThrow("Private synthetic transport detail");
  });

  const malformed: [string, unknown][] = [
    ["organizationId", otherId],
    ["actorId", otherId],
    ["risk.id", otherId],
    ["risk.organizationId", otherId],
    ["risk", null],
    ["risk.title", null],
    ["risk.status", "approved"],
    ["risk.currency", null],
    ["criteria", []],
    ["criteria.id", "criteria-1"],
    ["criteria.organizationId", otherId],
    ["criteria.version", 0],
    ["criteria.status", "verified"],
    ["criteria.decisionThresholds", []],
    ["evidence", {}],
    ["evidence.0", null],
    ["evidence.0.id", "evidence-1"],
    ["evidence.0.organizationId", otherId],
    ["evidence.0.riskId", otherId],
    ["evidence.0.description", 1],
    ["evidence.0.sourceSystem", false],
    ["evidence.0.verificationStatus", "approved"],
    ["evidence.0.verifiedBy", null],
    ["evidence.0.verifiedAt", null],
    ["evidence.0.verifiedAt", "infinity"],
    ["evidence.0.evidenceClass", "TRUSTED"],
    ["evidence.0.qualityGrade", "good"],
    ["evidence.0.applicabilityGrade", "current"],
    ["analyses", {}],
    ["analyses.0", null],
    ["analyses.0.id", "analysis-1"],
    ["analyses.0.organizationId", otherId],
    ["analyses.0.riskId", otherId],
    ["analyses.0.version", 1.5],
    ["analyses.0.version", 0],
    ["analyses.0.storedStatus", "stale"],
    ["analyses.0.validationStatus", "approved"],
    ["analyses.0.method", ""],
    ["analyses.0.method", "😀😀"],
    ["analyses.0.basis", "short"],
    ["analyses.0.basis", "😀".repeat(10)],
    ["analyses.0.probability", []],
    ["analyses.0.probability.lower", "NaN"],
    ["analyses.0.probability.central", 0.01],
    ["analyses.0.probability.upper", 2],
    ["analyses.0.confidence.level", -1],
    ["analyses.0.confidence.level", 2],
    ["analyses.0.confidence.level", "0.9"],
    ["analyses.0.confidence.level", null],
    ["analyses.0.confidence.level", true],
    ["analyses.0.confidence.lower", 0.9],
    ["analyses.0.lossCases.best", -1],
    ["analyses.0.lossCases.expected", 4],
    ["analyses.0.lossCases.currency", "cad"],
    ["analyses.0.sensitivityInputs", []],
    ["analyses.0.sensitivityInputs.0", []],
    ["analyses.0.sensitivityInputs.0.low_input", ""],
    ["analyses.0.sensitivityInputs.0.low_input", "0x10"],
    ["analyses.0.sensitivityInputs.0.low_input", "Infinity"],
    ["analyses.0.sensitivityInputs.0.low_input", "1e999"],
    ["analyses.0.sensitivityInputs.0.low_input", 2],
    ["analyses.0.sensitivityInputs.0.low_output", -1],
    ["analyses.0.sensitivityResults", {}],
    ["analyses.0.sensitivityResults.0.lowInput", "-1"],
    ["analyses.0.sensitivityResults.0.swing", -1],
    ["analyses.0.thresholdProfileId", "criteria-1"],
    ["analyses.0.decisionThresholds", []],
    ["analyses.0.reassessmentTriggers", []],
    ["analyses.0.reassessmentTriggers.0", "short"],
    ["analyses.0.reviewDueAt", "infinity"],
    ["analyses.0.reviewDueAt", "2026-09-01T00:00:00Z"],
    ["analyses.0.createdAt", "not-a-date"],
    ["analyses.0.createdAt", "0000-09-30T00:00:00Z"],
    ["analyses.0.valueOfInformation", null],
    ["analyses.0.valueOfInformation.action", "short"],
    ["analyses.0.valueOfInformation.informationCost", "1"],
    ["analyses.0.valueOfInformation.uncertaintyReduction", 2],
    ["analyses.0.valueOfInformation.expectedValue", -1],
    ["analyses.0.valueOfInformation.netValue", -1],
    ["analyses.0.valueOfInformation.netValue", 3],
    ["analyses.0.valueOfInformation.recommendation", "AUTHORIZE_OPERATION"],
    [
      "analyses.0.valueOfInformation.recommendation",
      "DECIDE_WITH_CURRENT_INFORMATION",
    ],
    ["analyses.0.analysisDigest", "A".repeat(64)],
    ["analyses.0.currentDigest", null],
    ["analyses.0.currentDigest", "b".repeat(64)],
    ["analyses.0.authorId", "author-1"],
    ["analyses.0.reviewerId", reviewerId],
    ["analyses.0.approvalId", otherId],
    ["analyses.0.evidenceItemIds", []],
    ["analyses.0.evidenceItemIds.0", "evidence-1"],
    ["analyses.0.operationalAuthorization", true],
    ["boundary", "Review authorizes industrial operation"],
    ["operationalAuthorization", true],
  ];
  it.each(malformed)(
    "refuses malformed or rebound %s (%j)",
    async (path, value) => {
      const data = workspace();
      set(data, path, value);
      wire.body = data;
      await expect(
        getRiskUncertaintyWorkspace(riskId, context),
      ).rejects.toThrow("Could not load the governed uncertainty workspace");
    },
  );

  it.each([NaN, Infinity, -Infinity, null, true])(
    "refuses unsafe JSON numeric probability (%s)",
    async (value) => {
      const data = workspace();
      set(data, "analyses.0.probability.central", value);
      wire.body = data;
      await expect(
        getRiskUncertaintyWorkspace(riskId, context),
      ).rejects.toThrow();
    },
  );

  it.each(["evidence", "analyses", "analyses.0.evidenceItemIds"])(
    "refuses duplicate canonical identities in %s",
    async (path) => {
      const data = workspace();
      if (path === "evidence")
        data.evidence.push(structuredClone(data.evidence[0]));
      else if (path === "analyses")
        data.analyses.push(structuredClone(data.analyses[0]));
      else data.analyses[0].evidenceItemIds.push(evidenceId);
      wire.body = data;
      await expect(
        getRiskUncertaintyWorkspace(riskId, context),
      ).rejects.toThrow();
    },
  );

  it.each(["version duplicate", "version ascending"])(
    "refuses %s despite unique packet IDs",
    async (kind) => {
      const data = workspace();
      const next = structuredClone(data.analyses[0]);
      next.id = otherId;
      next.version = kind === "version duplicate" ? 1 : 2;
      set(next, "storedStatus", "rejected");
      set(next, "validationStatus", "rejected");
      set(next, "reviewerId", reviewerId);
      set(next, "reviewedAt", "2026-09-30T00:00:00Z");
      set(next, "reviewNote", "Independent synthetic rejection reason.");
      set(next, "approvalId", otherId);
      data.analyses.push(next);
      wire.body = data;
      await expect(
        getRiskUncertaintyWorkspace(riskId, context),
      ).rejects.toThrow();
    },
  );

  it("accepts a truly empty workspace without adopted criteria or fabricated evidence", async () => {
    const data = workspace();
    set(data, "criteria", null);
    data.evidence = [];
    data.analyses = [];
    wire.body = data;
    await expect(getRiskUncertaintyWorkspace(riskId, context)).resolves.toEqual(
      data,
    );
  });

  it("accepts draft criteria with empty thresholds and nullable legacy evidence text and grades", async () => {
    const data = workspace();
    data.criteria.status = "draft";
    data.criteria.decisionThresholds =
      {} as typeof data.criteria.decisionThresholds;
    data.analyses = [];
    for (const field of [
      "description",
      "sourceSystem",
      "sourceReference",
      "verifiedBy",
      "verifiedAt",
      "evidenceClass",
      "qualityGrade",
      "applicabilityGrade",
    ])
      set(data, `evidence.0.${field}`, null);
    data.evidence[0].verificationStatus = "unverified";
    wire.body = data;
    await expect(getRiskUncertaintyWorkspace(riskId, context)).resolves.toEqual(
      data,
    );
  });

  it("preserves finite decimal/exponent sensitivity strings, signed inputs, repeated names and nonmonotonic outputs", async () => {
    const data = workspace();
    set(data, "analyses.0.sensitivityInputs.0.low_input", " -1.0 ");
    set(data, "analyses.0.sensitivityInputs.0.base_input", "+0e0");
    set(data, "analyses.0.sensitivityInputs.0.high_input", ".10e1");
    data.analyses[0].sensitivityInputs.push(
      structuredClone(data.analyses[0].sensitivityInputs[0]),
    );
    data.analyses[0].sensitivityResults.push(
      structuredClone(data.analyses[0].sensitivityResults[0]),
    );
    wire.body = data;
    await expect(getRiskUncertaintyWorkspace(riskId, context)).resolves.toEqual(
      data,
    );
  });

  it("uses PostgreSQL codepoint lengths and space-only btrim without rewriting Unicode source text", async () => {
    const data = workspace();
    data.analyses[0].method = "\t\t\t";
    data.analyses[0].basis = "😀".repeat(20);
    data.analyses[0].reassessmentTriggers = ["😀".repeat(300)];
    wire.body = data;
    await expect(getRiskUncertaintyWorkspace(riskId, context)).resolves.toEqual(
      data,
    );
  });

  it.each([
    "2026-02-30T00:00:00Z",
    "2026-10-01T00:00:00",
    "2026-10-01T00:00:00+24:00",
    "2026-10-01T00:00:00+00:60",
  ])("refuses noncanonical or nonexistent timestamp %s", async (stamp) => {
    const data = workspace();
    data.analyses[0].reviewDueAt = stamp;
    wire.body = data;
    await expect(
      getRiskUncertaintyWorkspace(riskId, context),
    ).rejects.toThrow();
  });

  it("refuses reversed microsecond chronology that a millisecond Date would collapse", async () => {
    const data = workspace();
    data.analyses[0].createdAt = "2020-01-01T00:00:00.123457Z";
    data.analyses[0].reviewDueAt = "2020-01-01T00:00:00.123456Z";
    wire.body = data;
    await expect(
      getRiskUncertaintyWorkspace(riskId, context),
    ).rejects.toThrow();
  });

  it("accepts canonical finite PostgreSQL year 280000 without a JavaScript Date limit", async () => {
    const data = workspace();
    data.analyses[0].reviewDueAt = "280000-02-29T00:00:00.123456+00:00";
    wire.body = data;
    await expect(getRiskUncertaintyWorkspace(riskId, context)).resolves.toEqual(
      data,
    );
  });

  it("compares distant-year timezone and microsecond chronology without normalizing the source", async () => {
    const data = workspace();
    data.analyses[0].createdAt = "280000-03-01T00:30:00+01:00";
    data.analyses[0].reviewDueAt = "280000-02-29T23:30:00.000001Z";
    wire.body = data;
    await expect(getRiskUncertaintyWorkspace(riskId, context)).resolves.toEqual(
      data,
    );
  });

  it("retains the canonical positive confidence that underflows on the actual JSON number wire", async () => {
    const data = workspace();
    data.analyses[0].confidence.level = 0;
    wire.raw = JSON.stringify(data).replace('"level":0,', '"level":1e-999,');
    await expect(getRiskUncertaintyWorkspace(riskId, context)).resolves.toEqual(
      data,
    );
  });

  it.each([NaN, Infinity, -Infinity])(
    "refuses nonfinite confidence JSON (%s), without inferring exact positivity from decoded zero",
    async (value) => {
      const data = workspace();
      data.analyses[0].confidence.level = value;
      wire.body = data;
      await expect(
        getRiskUncertaintyWorkspace(riskId, context),
      ).rejects.toThrow();
    },
  );

  it.each([
    "280001-02-29T00:00:00Z",
    "280000-02-30T00:00:00Z",
    "280000-01-01T24:00:00Z",
  ])("refuses invalid distant-year Gregorian timestamp %s", async (stamp) => {
    const data = workspace();
    data.analyses[0].reviewDueAt = stamp;
    wire.body = data;
    await expect(
      getRiskUncertaintyWorkspace(riskId, context),
    ).rejects.toThrow();
  });

  it.each(["294276-12-31T23:59:59.999999Z", "294277-01-01T00:30:00+01:00"])(
    "accepts a timestamp within PostgreSQL's actual finite UTC boundary (%s)",
    async (stamp) => {
      const data = workspace();
      data.analyses[0].reviewDueAt = stamp;
      wire.body = data;
      await expect(
        getRiskUncertaintyWorkspace(riskId, context),
      ).resolves.toEqual(data);
    },
  );

  it.each([
    "294277-01-01T00:00:00Z",
    "294276-12-31T23:00:00-01:00",
    "999999-01-01T00:00:00Z",
  ])(
    "refuses a nonfinite PostgreSQL upper-bound timestamp (%s)",
    async (stamp) => {
      const data = workspace();
      data.analyses[0].reviewDueAt = stamp;
      wire.body = data;
      await expect(
        getRiskUncertaintyWorkspace(riskId, context),
      ).rejects.toThrow();
    },
  );

  it("refuses a sensitivity string inversion hidden by JavaScript floating-point rounding", async () => {
    const data = workspace();
    set(
      data,
      "analyses.0.sensitivityInputs.0.low_input",
      "1.000000000000000002",
    );
    set(
      data,
      "analyses.0.sensitivityInputs.0.base_input",
      "1.000000000000000001",
    );
    set(
      data,
      "analyses.0.sensitivityInputs.0.high_input",
      "1.000000000000000003",
    );
    wire.body = data;
    await expect(
      getRiskUncertaintyWorkspace(riskId, context),
    ).rejects.toThrow();
  });

  it("retains decimal sensitivity strings without replacing a finite subnormal snapshot with zero", async () => {
    const data = workspace();
    set(data, "analyses.0.sensitivityInputs.0.low_input", "1e-999");
    set(data, "analyses.0.sensitivityInputs.0.base_input", "2e-999");
    set(data, "analyses.0.sensitivityInputs.0.high_input", "3e-999");
    Object.assign(data.analyses[0].sensitivityResults[0], {
      lowInput: 0,
      baseInput: 0,
      highInput: 0,
    });
    wire.body = data;
    await expect(getRiskUncertaintyWorkspace(riskId, context)).resolves.toEqual(
      data,
    );
  });

  it("binds equivalent UUID letter casing without rewriting the retained receipt", async () => {
    const data = workspace();
    wire.body = data;
    await expect(
      getRiskUncertaintyWorkspace(riskId.toUpperCase(), {
        organizationId: organizationId.toUpperCase(),
        actorId: actorId.toUpperCase(),
      }),
    ).resolves.toEqual(data);
  });

  it("accepts historical snapshots with different current criteria and currency, past-due review, and fractional timestamp precision", async () => {
    const data = workspace();
    data.criteria.id = otherId;
    data.criteria.status = "superseded";
    data.analyses[0].reviewStanding = "policy_unavailable";
    data.risk.currency = "USD";
    data.risk.status = "archived";
    data.analyses[0].createdAt = "2020-01-01T00:00:00.123456+00:00";
    data.analyses[0].reviewDueAt = "2020-01-01T00:00:00.123457+00:00";
    wire.body = data;
    await expect(getRiskUncertaintyWorkspace(riskId, context)).resolves.toEqual(
      data,
    );
  });

  it.each(["pending_review", "validated", "rejected"])(
    "accepts a coherent retained stale %s lifecycle",
    async (status) => {
      const data = workspace();
      const item = data.analyses[0];
      set(item, "storedStatus", status);
      item.validationStatus = "stale";
      item.currentDigest = "b".repeat(64);
      item.reviewStanding = "replacement_required";
      if (status !== "pending_review") {
        set(item, "reviewerId", reviewerId);
        set(item, "reviewedAt", "2026-09-30T00:00:00Z");
        set(
          item,
          "reviewNote",
          "Independent synthetic review of exact packet.",
        );
        set(item, "approvalId", otherId);
        if (status === "validated")
          set(item, "derivedEvidenceItemId", evidenceId);
      }
      wire.body = data;
      await expect(
        getRiskUncertaintyWorkspace(riskId, context),
      ).resolves.toEqual(data);
    },
  );

  it.each(["validated", "rejected"])(
    "accepts a coherent current %s lifecycle",
    async (status) => {
      const data = workspace();
      const item = data.analyses[0];
      set(item, "storedStatus", status);
      item.validationStatus = status;
      set(item, "reviewerId", reviewerId);
      set(item, "reviewedAt", "2026-09-30T00:00:00Z");
      set(item, "reviewNote", "Independent synthetic review of exact packet.");
      set(item, "approvalId", otherId);
      if (status === "validated")
        set(item, "derivedEvidenceItemId", evidenceId);
      wire.body = data;
      await expect(
        getRiskUncertaintyWorkspace(riskId, context),
      ).resolves.toEqual(data);
    },
  );

  it.each([
    ["reviewerId", null],
    ["reviewerId", authorId],
    ["reviewedAt", null],
    ["reviewedAt", "infinity"],
    ["reviewNote", "short"],
    ["approvalId", null],
    ["derivedEvidenceItemId", null],
  ])(
    "refuses an incoherent validated lifecycle field %s (%j)",
    async (field, value) => {
      const data = workspace();
      const item = data.analyses[0];
      Object.assign(item, {
        storedStatus: "validated",
        validationStatus: "validated",
        reviewerId,
        reviewedAt: "2026-09-30T00:00:00Z",
        reviewNote: "Independent synthetic review of exact packet.",
        approvalId: otherId,
        derivedEvidenceItemId: evidenceId,
      });
      set(item, field as string, value);
      wire.body = data;
      await expect(
        getRiskUncertaintyWorkspace(riskId, context),
      ).rejects.toThrow();
    },
  );

  it("refuses two underlying pending packets even when one is displayed as stale", async () => {
    const data = workspace();
    const newer = structuredClone(data.analyses[0]);
    newer.id = otherId;
    newer.version = 2;
    newer.currentDigest = "b".repeat(64);
    newer.validationStatus = "stale";
    data.analyses.unshift(newer);
    wire.body = data;
    await expect(
      getRiskUncertaintyWorkspace(riskId, context),
    ).rejects.toThrow();
  });

  it("retains historical citation IDs without pretending they must currently be verified workspace members", async () => {
    const data = workspace();
    data.analyses[0].evidenceItemIds = [otherId];
    data.analyses[0].validationStatus = "stale";
    data.analyses[0].currentDigest = "b".repeat(64);
    data.analyses[0].reviewStanding = "replacement_required";
    wire.body = data;
    await expect(getRiskUncertaintyWorkspace(riskId, context)).resolves.toEqual(
      data,
    );
  });

  it.each([
    [1, 1.004, 1, 0, "GATHER_INFORMATION"],
    [1, 0.996, 1, 0, "DECIDE_WITH_CURRENT_INFORMATION"],
    [1, 1, 1, 0, "DECIDE_WITH_CURRENT_INFORMATION"],
  ])(
    "uses canonical raw VOI sign at a rounded-zero boundary (%s/%s)",
    async (cost, wrong, expected, net, recommendation) => {
      const data = workspace();
      Object.assign(data.analyses[0].valueOfInformation, {
        informationCost: cost,
        decisionCostIfWrong: wrong,
        expectedValue: expected,
        netValue: net,
        recommendation,
      });
      wire.body = data;
      await expect(
        getRiskUncertaintyWorkspace(riskId, context),
      ).resolves.toEqual(data);
    },
  );

  it("does not convert a historical rejected packet with a recorded derived reference into validation", async () => {
    const data = workspace();
    const item = data.analyses[0];
    set(item, "storedStatus", "rejected");
    item.validationStatus = "rejected";
    set(item, "reviewerId", reviewerId);
    set(item, "reviewedAt", "2026-09-30T00:00:00Z");
    set(item, "reviewNote", "Independent synthetic rejection of exact packet.");
    set(item, "approvalId", otherId);
    set(item, "derivedEvidenceItemId", evidenceId);
    wire.body = data;
    await expect(getRiskUncertaintyWorkspace(riskId, context)).resolves.toEqual(
      data,
    );
  });

  it("uses the real reader from the panel with the observed canonical actor and organization", async () => {
    render(
      createElement(RiskUncertaintyPanel, {
        riskId,
        currentUserId: actorId,
        currentOrganizationId: organizationId,
        currentUserRole: "viewer",
      }),
    );
    await screen.findByText("Probability and confidence");
    expect(wire.requests).toEqual([{ p_risk_id: riskId }]);
    expect(screen.getByText(/Synthetic criteria · v1/)).toBeInTheDocument();
  });

  it("does not render rebound nested data or review controls through the actual SDK and panel", async () => {
    const data = workspace();
    data.organizationId = otherId;
    wire.body = data;
    render(
      createElement(RiskUncertaintyPanel, {
        riskId,
        currentUserId: actorId,
        currentOrganizationId: organizationId,
        currentUserRole: "reliability_engineer",
      }),
    );
    await screen.findByText(
      "Could not load the governed uncertainty workspace",
    );
    expect(
      screen.queryByText("Probability and confidence"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Synthetic criteria/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Review packet" }),
    ).not.toBeInTheDocument();
  });

  it("refuses a panel read with noncanonical observed actor before any actual-SDK dispatch", async () => {
    render(
      createElement(RiskUncertaintyPanel, {
        riskId,
        currentUserId: "actor-1",
        currentOrganizationId: organizationId,
        currentUserRole: "viewer",
      }),
    );
    await screen.findByText(
      /Canonical risk, organization and actor identifiers/,
    );
    expect(wire.requests).toHaveLength(0);
  });
});
