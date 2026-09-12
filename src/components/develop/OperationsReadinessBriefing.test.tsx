import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { CaseSystemHandoverPackages } from "../../services/handoverPackageService";
import type { SystemOperationalReadinessResult } from "../../lib/develop";
import { OperationsReadinessBriefing } from "./OperationsReadinessBriefing";

const model: CaseSystemHandoverPackages = {
  caseId: "case-1",
  readinessStores: {},
  decisionBoundary:
    "A named operations owner must record final human acceptance.",
  equipmentReleaseBoundary: "This does not release equipment to service.",
  systems: [
    {
      systemId: 1,
      systemRef: "SYS-001",
      title: "Process water",
      systemOwnerId: "outgoing",
      currentState: "READY_FOR_ACCEPTANCE",
      package: null,
      readiness: {
        systemId: 1,
        currentState: "READY_FOR_ACCEPTANCE",
        physicalReadiness: {
          status: "NOT_ASSESSED",
          satisfied: 0,
          total: 0,
          percent: null,
          source: "acceptance_tests",
          gaps: [],
        },
        informationReadiness: {
          status: "NOT_READY",
          satisfied: 2,
          total: 3,
          percent: 66.67,
          source: "asset_onboarding_items",
          gaps: [],
        },
        operationalReadiness: {
          status: "READY",
          satisfied: 5,
          total: 5,
          percent: 100,
          source: "asset_onboarding_items",
          gaps: [],
        },
        residualRisks: [],
        residualRiskCount: 0,
        acceptedResidualRiskCount: 0,
        canAccept: false,
        blockers: ["Physical readiness is not assessed."],
        decisionBoundary: "Readiness is advisory.",
      },
    },
  ],
};

const systemReadiness: SystemOperationalReadinessResult = {
  caseId: "case-1",
  readinessStore: "asset_onboarding_items",
  decisionBoundary: "This read cannot accept handover.",
  systems: [
    {
      systemId: 1,
      systemRef: "SYS-001",
      title: "Process water",
      currentState: "READY_FOR_ACCEPTANCE",
      assetCount: 1,
      itemCount: 1,
      satisfiedCount: 1,
      overdueOpenCount: 0,
      items: [
        {
          scopeId: 10,
          itemId: "item-10",
          assetId: "asset-10",
          asset: "Pump 10",
          assetTag: "P-010",
          requirementKey: "training",
          item: "Operator training",
          category: "training",
          ownerId: "owner",
          owner: "Operations Manager",
          requiredBefore: "2026-10-01",
          status: "human_provided",
          evidenceItemId: "evidence-10",
          evidenceReady: true,
          overdue: false,
        },
      ],
    },
  ],
};

describe("OperationsReadinessBriefing", () => {
  it("renders the pre-handover summary and the two human boundaries", () => {
    render(
      <OperationsReadinessBriefing
        model={model}
        systemReadiness={systemReadiness}
      />,
    );

    expect(
      screen.getByRole("region", { name: "Operations readiness briefing" }),
    ).toBeInTheDocument();
    expect(screen.getByText("SYS-001 · Process water")).toBeInTheDocument();
    expect(screen.getByText("Blocked before handover")).toBeInTheDocument();
    expect(screen.getByText("Not assessed")).toBeInTheDocument();
    expect(
      screen.getByText("Readiness-category evidence coverage"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "A named operations owner must record final human acceptance.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("This does not release equipment to service."),
    ).toBeInTheDocument();
  });
});
