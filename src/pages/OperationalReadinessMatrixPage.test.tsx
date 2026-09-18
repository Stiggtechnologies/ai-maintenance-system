import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

const listDevelopmentCases = vi.fn();
const getOperationalReadinessMatrix = vi.fn();

vi.mock("../services/developService", () => ({
  listDevelopmentCases: () => listDevelopmentCases(),
}));
vi.mock("../services/operationalReadinessMatrixService", () => ({
  getOperationalReadinessMatrix: (caseId: string) =>
    getOperationalReadinessMatrix(caseId),
}));

import { OperationalReadinessMatrixPage } from "./OperationalReadinessMatrixPage";

describe("D13.10 Operational Readiness Matrix page", () => {
  it("renders systems against recorded dimensions, gaps, provenance and authority limits", async () => {
    listDevelopmentCases.mockResolvedValue([
      { id: "case-1", title: "North plant expansion" },
    ]);
    getOperationalReadinessMatrix.mockResolvedValue({
      caseId: "case-1",
      categories: ["maintenance", "training"],
      rows: [
        {
          systemId: 7,
          systemRef: "SYS-007",
          title: "Cooling water",
          currentState: "mechanically_complete",
          assetCount: 2,
          total: 2,
          evidenced: 1,
          open: 1,
          overdueOpen: 1,
          recordRefs: ["commissioning_systems:7"],
          cells: {
            maintenance: {
              category: "maintenance",
              total: 1,
              evidenced: 0,
              open: 1,
              overdueOpen: 1,
              percent: 0,
              earliestRequiredBefore: "2027-01-10",
              owners: ["Jordan Lee"],
              gaps: [{
                itemId: "item-1",
                label: "Approved maintenance plan",
                asset: "P-101",
                owner: "Jordan Lee",
                requiredBefore: "2027-01-10",
                overdue: true,
              }],
              recordRefs: ["asset_onboarding_items:item-1"],
            },
            training: {
              category: "training",
              total: 1,
              evidenced: 1,
              open: 0,
              overdueOpen: 0,
              percent: 100,
              earliestRequiredBefore: "2027-02-01",
              owners: ["Sam Patel"],
              gaps: [],
              recordRefs: ["asset_onboarding_items:item-2"],
            },
          },
        },
      ],
      emptyState: null,
      readinessStore: "asset_onboarding_items",
      interpretationLimits: ["No blended readiness verdict."],
      decisionBoundary: "A named human accepts operations ownership.",
    });

    render(
      <MemoryRouter initialEntries={["/develop/operational-readiness?case=case-1"]}>
        <OperationalReadinessMatrixPage />
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(screen.getByText(/SYS-007.*Cooling water/)).toBeInTheDocument(),
    );
    expect(getOperationalReadinessMatrix).toHaveBeenCalledWith("case-1");
    expect(screen.getByRole("columnheader", { name: "maintenance" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "training" })).toBeTruthy();
    expect(screen.getByText("0%")).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(screen.getByText(/1 named gap/)).toBeInTheDocument();
    expect(screen.getByText("asset_onboarding_items:item-1")).toBeInTheDocument();
    expect(screen.getByText("No blended readiness verdict.")).toBeInTheDocument();
    expect(screen.getByText("A named human accepts operations ownership.")).toBeInTheDocument();
  });
});
