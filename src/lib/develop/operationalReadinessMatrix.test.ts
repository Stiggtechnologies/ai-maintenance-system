import { describe, expect, it } from "vitest";
import type { SystemOperationalReadinessResult } from "./index";
import { buildOperationalReadinessMatrix } from "./operationalReadinessMatrix";

const source: SystemOperationalReadinessResult = {
  caseId: "case-1",
  systems: [
    {
      systemId: 7,
      systemRef: "SYS-007",
      title: "Cooling water",
      currentState: "mechanically_complete",
      assetCount: 2,
      itemCount: 3,
      satisfiedCount: 1,
      overdueOpenCount: 1,
      items: [
        {
          scopeId: 1,
          itemId: "item-1",
          assetId: "asset-1",
          asset: "Pump one",
          assetTag: "P-101",
          requirementKey: "maintenance-plan",
          item: "Approved maintenance plan",
          category: "maintenance",
          ownerId: "user-1",
          owner: "Jordan Lee",
          requiredBefore: "2027-01-15",
          status: "human_provided",
          evidenceItemId: "evidence-1",
          evidenceReady: true,
          overdue: false,
        },
        {
          scopeId: 2,
          itemId: "item-2",
          assetId: "asset-2",
          asset: "Pump two",
          assetTag: "P-102",
          requirementKey: "maintenance-plan",
          item: "Approved maintenance plan",
          category: "maintenance",
          ownerId: "user-1",
          owner: "Jordan Lee",
          requiredBefore: "2027-01-10",
          status: "pending",
          evidenceItemId: null,
          evidenceReady: false,
          overdue: true,
        },
        {
          scopeId: 3,
          itemId: "item-3",
          assetId: "asset-1",
          asset: "Pump one",
          assetTag: "P-101",
          requirementKey: "training",
          item: "Operator training complete",
          category: "training",
          ownerId: "user-2",
          owner: null,
          requiredBefore: "2027-02-01",
          status: "pending",
          evidenceItemId: null,
          evidenceReady: false,
          overdue: false,
        },
      ],
    },
  ],
  readinessStore: "asset_onboarding_items",
  decisionBoundary: "A human accepts operations ownership.",
};

describe("D13.10 operational-readiness matrix", () => {
  it("groups canonical items by system and category without inventing a verdict", () => {
    const matrix = buildOperationalReadinessMatrix(source);

    expect(matrix.categories).toEqual(["maintenance", "training"]);
    expect(matrix.rows[0]).toMatchObject({
      systemRef: "SYS-007",
      total: 3,
      evidenced: 1,
      open: 2,
      overdueOpen: 1,
    });
    expect(matrix.rows[0].cells.maintenance).toMatchObject({
      total: 2,
      evidenced: 1,
      percent: 50,
      earliestRequiredBefore: "2027-01-10",
      owners: ["Jordan Lee"],
    });
    expect(matrix.rows[0].cells.training.gaps[0]).toMatchObject({
      asset: "P-101",
      owner: "user-2",
    });
    expect(matrix.rows[0].cells.maintenance.recordRefs).toEqual(
      expect.arrayContaining([
        "asset_onboarding_items:item-1",
        "assets:asset-1",
        "evidence_items:evidence-1",
      ]),
    );
  });

  it("names missing scope as absence rather than readiness", () => {
    const matrix = buildOperationalReadinessMatrix({ ...source, systems: [] });
    expect(matrix.emptyState).toMatch(/cannot be shown/i);
    expect(matrix.interpretationLimits.join(" ")).toMatch(/does not mean ready/i);
  });
});
