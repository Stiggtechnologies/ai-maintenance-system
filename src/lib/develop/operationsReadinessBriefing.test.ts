import { describe, expect, it } from "vitest";
import type { CaseSystemHandoverPackages } from "../../services/handoverPackageService";
import { buildOperationsReadinessBriefing } from "./operationsReadinessBriefing";

function model(
  overrides: Partial<CaseSystemHandoverPackages> = {},
): CaseSystemHandoverPackages {
  return {
    caseId: "case-1",
    readinessStores: {
      physical: "acceptance_tests",
      information: "asset_onboarding_items",
      operational: "asset_onboarding_items",
    },
    decisionBoundary:
      "Only the named operations owner can accept operations ownership.",
    equipmentReleaseBoundary:
      "System handover does not release equipment to service.",
    systems: [
      {
        systemId: 41,
        systemRef: "SYS-041",
        title: "Cooling water",
        systemOwnerId: "owner-from",
        currentState: "READY_FOR_ACCEPTANCE",
        package: {
          id: 72,
          version: 2,
          status: "draft",
          ownerFromId: "owner-from",
          ownerFrom: "Commissioning Lead",
          ownerToId: "owner-to",
          ownerTo: "Operations Manager",
          requiredAcceptanceDate: "2026-10-01",
          preparedBy: "preparer",
          preparedAt: "2026-09-12T00:00:00Z",
          preparationEvidenceItemId: "evidence-prep",
          acceptedBy: null,
          acceptedAt: null,
          acceptanceEvidenceItemId: null,
        },
        readiness: {
          systemId: 41,
          currentState: "READY_FOR_ACCEPTANCE",
          physicalReadiness: {
            status: "READY",
            satisfied: 4,
            total: 4,
            percent: 100,
            source: "acceptance_tests + equipment_releases",
            gaps: [],
          },
          informationReadiness: {
            status: "NOT_READY",
            satisfied: 2,
            total: 3,
            percent: 66.67,
            source: "asset_onboarding_items",
            gaps: [
              {
                itemId: "item-9",
                assetId: "asset-3",
                asset: "Pump 3",
                item: "As-built drawing",
                category: "documentation",
              },
            ],
          },
          operationalReadiness: {
            status: "NOT_ASSESSED",
            satisfied: 0,
            total: 0,
            percent: null,
            source: "asset_onboarding_items",
            gaps: [],
          },
          residualRisks: [
            {
              riskId: "risk-8",
              title: "Temporary bypass remains",
              status: "open",
              riskLevel: "high",
              accepted: false,
            },
          ],
          residualRiskCount: 1,
          acceptedResidualRiskCount: 0,
          canAccept: false,
          blockers: ["Information readiness has one open gap."],
          decisionBoundary: "Readiness cannot accept operations ownership.",
        },
      },
    ],
    ...overrides,
  };
}

describe("operations readiness briefing", () => {
  it("copies each governed dimension and traces its underlying records", () => {
    const briefing = buildOperationsReadinessBriefing(model());
    const system = briefing.systems[0];

    expect(system.position).toBe("blocked");
    expect(system.measures.map((item) => item.value)).toEqual([
      "100%",
      "66.67%",
      "Not assessed",
      "0/1",
    ]);
    expect(system.measures[1].recordRefs).toEqual(
      expect.arrayContaining([
        "commissioning_systems:41",
        "source:asset_onboarding_items",
        "asset_onboarding_items:item-9",
        "assets:asset-3",
      ]),
    );
    expect(system.measures[3].recordRefs).toContain("risks:risk-8");
    expect(system.recordRefs).toEqual(
      expect.arrayContaining([
        "commissioning_systems:41",
        "system_handover_packages:72",
        "evidence_items:evidence-prep",
      ]),
    );
  });

  it("does not turn an empty denominator or absent risk rows into reassurance", () => {
    const briefing = buildOperationsReadinessBriefing(model());
    const operational = briefing.systems[0].measures[2];
    const residualRisk = briefing.systems[0].measures[3];

    expect(operational.value).toBe("Not assessed");
    expect(operational.explanation).toContain("Absence is not treated");
    expect(residualRisk.explanation).not.toContain("No current");
  });

  it("uses the server's canAccept result without calling it approval", () => {
    const source = model();
    source.systems[0].readiness.canAccept = true;
    source.systems[0].readiness.blockers = [];
    const system = buildOperationsReadinessBriefing(source).systems[0];

    expect(system.position).toBe("ready_for_human_acceptance");
    expect(system.positionLabel).toContain("human acceptance required");
    expect(system.positionLabel).not.toBe("Accepted");
  });

  it("does not let historical acceptance hide current readiness gaps", () => {
    const source = model();
    source.systems[0].package!.status = "accepted";
    const system = buildOperationsReadinessBriefing(source).systems[0];

    expect(system.position).toBe("accepted_with_current_gaps");
    expect(system.positionLabel).toBe("Accepted · current gaps require review");
    expect(system.blockers).toContain(
      "Information readiness has one open gap.",
    );
  });

  it("reports no systems as unassessable rather than ready", () => {
    const briefing = buildOperationsReadinessBriefing(model({ systems: [] }));

    expect(briefing.systems).toEqual([]);
    expect(briefing.emptyState).toContain("cannot be assessed");
  });
});
