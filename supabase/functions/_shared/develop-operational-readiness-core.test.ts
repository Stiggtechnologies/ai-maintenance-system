import { describe, expect, it } from "vitest";
import { analyzeOperationalReadiness } from "./develop-operational-readiness-core.ts";

describe("D12.14 Operational Readiness Agent deterministic analysis", () => {
  it("answers no and preserves every named hard blocker and source reference", () => {
    const result = analyzeOperationalReadiness({
      caseId: "case-1",
      readinessStore: "asset_onboarding_items",
      decisionBoundary: "cannot accept handover",
      calculation: {
        index: 82.5,
        status: "BLOCKED",
        profileId: "profile-1",
        profileVersion: 2,
        evidenceItemId: "evidence-1",
        factors: [
          {
            key: "safety",
            weight: 2,
            categories: ["emergency_response"],
            satisfied: 1,
            total: 2,
            percent: 50,
          },
        ],
        hardBlockers: [
          {
            systemId: 4,
            systemRef: "SYS-04",
            itemId: "item-1",
            assetId: "asset-1",
            asset: "Pump",
            assetTag: "P-101",
            requirementKey: "emergency",
            item: "Emergency drill",
            category: "emergency_response",
            status: "missing",
            kind: "safety_mission_critical",
          },
        ],
      },
    });
    expect(result.answer).toBe("no");
    expect(result.status).toBe("BLOCKED");
    expect(result.headline).toContain("82.5%");
    expect(result.blockers[0]?.item).toBe("Emergency drill");
    expect(result.blockers[0]?.sourceRefs).toEqual([
      "commissioning_systems:4",
      "asset_onboarding_items:item-1",
      "assets:asset-1",
    ]);
    expect(result.evidenceRefs).toContain("evidence_items:evidence-1");
  });

  it("keeps missing policy and missing inputs not assessable rather than zero", () => {
    for (const refusal of [
      "no_adopted_profile",
      "missing_factor_inputs",
    ] as const) {
      const result = analyzeOperationalReadiness({
        caseId: "case-1",
        readinessStore: "asset_onboarding_items",
        profiles:
          refusal === "missing_factor_inputs"
            ? [
                {
                  profileId: "profile-1",
                  version: 3,
                  status: "adopted",
                  evidenceItemId: "evidence-1",
                },
              ]
            : [],
        calculation: {
          refusal,
          error: "No governed calculation",
          missingFactors: ["training"],
        },
      });
      expect(result.answer).toBe("not_assessable");
      expect(result.index).toBeNull();
      expect(result.status).toBe("NOT_ASSESSABLE");
      expect(result.limitations.join(" ")).toContain("training");
      if (refusal === "missing_factor_inputs") {
        expect(result.profileVersion).toBe(3);
        expect(result.evidenceRefs).toContain(
          "operational_readiness_index_profiles:profile-1",
        );
        expect(result.evidenceRefs).toContain("evidence_items:evidence-1");
      }
    }
  });

  it("explains a non-blocked partial index as incomplete weighted factors", () => {
    const result = analyzeOperationalReadiness({
      caseId: "case-1",
      readinessStore: "asset_onboarding_items",
      calculation: { index: 91, status: "NOT_READY", hardBlockers: [] },
    });
    expect(result.answer).toBe("no");
    expect(result.headline).toContain("weighted factors remain incomplete");
    expect(result.headline).not.toContain("hard blocker(s) remain");
  });

  it("answers yes only when the deterministic index itself is READY", () => {
    const result = analyzeOperationalReadiness({
      caseId: "case-1",
      readinessStore: "asset_onboarding_items",
      calculation: { index: 100, status: "READY", factors: [] },
    });
    expect(result.answer).toBe("yes");
    expect(result.headline).toContain(
      "Human handover acceptance is still required",
    );
  });
});
