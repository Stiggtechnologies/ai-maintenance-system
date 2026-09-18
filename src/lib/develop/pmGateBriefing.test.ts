import { describe, expect, it } from "vitest";
import type { GateReviewPack } from "../../services/developService";
import { buildPmGateBriefing } from "./pmGateBriefing";

function pack(
  overrides: Partial<GateReviewPack["readiness"]> = {},
): GateReviewPack {
  return {
    caseId: "case-1",
    caseTitle: "Expansion train",
    gateId: 42,
    gateName: "Gate 3",
    decisionType: "gate",
    independentAssuranceRequired: true,
    readiness: {
      caseId: "case-1",
      gateId: 42,
      gateName: "Gate 3",
      decisionType: "gate",
      readinessThreshold: 80,
      blocked: true,
      readinessPct: 74,
      weightSum: 10,
      criteriaTotal: 2,
      mandatoryTotal: 2,
      mandatoryMet: 1,
      latestReview: { id: 91, outcome: "hold", reviewedAt: "2026-09-10" },
      criteria: [
        {
          id: 11,
          criterion: "Design accepted",
          category: "technical",
          isMandatory: true,
          weight: 5,
          sourceAuthority: "framework",
          evidenceType: "document",
          status: "met",
          findingEvidence: "reviewed",
          deliverables: { total: 1, accepted: 1 },
        },
        {
          id: 12,
          criterion: "Risk closed",
          category: "risk",
          isMandatory: true,
          weight: 5,
          sourceAuthority: "framework",
          evidenceType: "risk",
          status: "not_met",
          findingEvidence: null,
          deliverables: { total: 0, accepted: 0 },
        },
      ],
      categories: [],
      blockers: [
        {
          type: "mandatory_criterion",
          id: 12,
          name: "Risk closed",
          status: "not_met",
          category: "risk",
        },
      ],
      successContract: null,
      evidenceSummary: {
        total: 2,
        verified: 1,
        rejected: 0,
        unverified: 1,
        aiInferenceUnverified: 0,
      },
      assurance: {
        required: true,
        demandedLevel: "independent",
        bindingLevel: "high",
        independentRequiredByBinding: true,
        gateId: 42,
        satisfiedByReviewId: null,
        satisfied: false,
        reviews: [],
      },
      projection: {
        available: false,
        closureEvents: 1,
        requiredEvents: 3,
        remaining: 1,
        reason: "not yet: 1 of 3 closure events recorded",
      },
      ...overrides,
    },
    requirements: [
      {
        id: 11,
        criterion: "Design accepted",
        category: "technical",
        isMandatory: true,
        weight: 5,
        sourceAuthority: "framework",
        evidenceType: "document",
        status: "met",
        findingEvidence: "reviewed",
        deliverables: { total: 1, accepted: 1 },
        assembled: {
          criterionId: 11,
          deliverables: [],
          evidence: [
            {
              id: "evidence-7",
              evidenceClass: "TEST_RESULT",
              verificationStatus: "verified",
              description: "Signed result",
              sourceSystem: "cde",
              sourceReference: "T-7",
              observedAt: "2026-09-09",
              verifiedAt: "2026-09-10",
              verifiedBy: "reviewer",
              link: "/evidence/evidence-7",
              confidence: { evidenceConfidence: 0.9 },
            },
          ],
          evidenceCount: 1,
          withheldCount: 0,
          verifiedCount: 1,
          statement: "One verified item",
        },
        activeWaiver: null,
      },
    ],
    waivers: [],
    assurance: null,
    evidenceConfidence: {},
    sod: {
      actorId: "reviewer",
      actorRole: "manager",
      isSponsorOrCreator: false,
      mayRecord: true,
      blockedBy: [],
      pairs: [],
    },
    openSession: null,
  };
}

describe("PM gate briefing", () => {
  it("copies the governed position and attaches exact record trails", () => {
    const result = buildPmGateBriefing(pack());

    expect(result.position).toBe("blocked");
    expect(result.headline).toBe("Gate 3: BLOCKED at 74%.");
    expect(result.measures.map((measure) => measure.value)).toContain(
      "1 of 2 met",
    );
    expect(
      result.measures.every((measure) => measure.recordRefs.length > 0),
    ).toBe(true);
    expect(result.measures.flatMap((measure) => measure.recordRefs)).toContain(
      "evidence_items:evidence-7",
    );
    expect(result.blockers).toEqual([
      {
        label: "Mandatory requirement",
        name: "Risk closed",
        recordRef: "stage_gate_criteria:12",
      },
    ]);
    expect(result.decisionBoundary).toContain("A named eligible human");
  });

  it("does not turn an undefined readiness or refused projection into zero", () => {
    const result = buildPmGateBriefing(
      pack({
        blocked: false,
        readinessPct: null,
        criteriaTotal: 0,
        mandatoryTotal: 0,
        mandatoryMet: 0,
        latestReview: null,
        criteria: [],
        blockers: [],
        projection: {
          available: false,
          closureEvents: 0,
          requiredEvents: 3,
          remaining: 0,
          reason: "no weighted requirements",
        },
      }),
    );

    expect(result.position).toBe("undefined");
    expect(result.headline).not.toContain("0%");
    expect(result.measures[0].value).toBe("Not available");
    expect(result.projection.value).toBe("Not defensible yet");
    expect(result.projection.explanation).toBe("no weighted requirements");
  });

  it("never calls not-blocked an approval or recommendation", () => {
    const result = buildPmGateBriefing(
      pack({ blocked: false, blockers: [], readinessPct: 92 }),
    );

    expect(result.position).toBe("not_blocked");
    expect(result.headline).toContain("no deterministic blocker is recorded");
    expect(result.headline.toLowerCase()).not.toContain("approved");
    expect(result.decisionBoundary).toContain("‘Not blocked’ is not approval");
  });
});
