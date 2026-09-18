import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QualityManagementWorkbench } from "./QualityManagementWorkbench";

vi.mock("../services/qualityManagementService", () => ({
  getQualityCockpit: vi.fn().mockResolvedValue({
    metrics: [
      "First-pass yield",
      "Defect rate",
      "Rework rate",
      "Scrap rate",
      "Acceptance-test pass rate",
      "NCR closure rate",
      "Overdue open-NCR rate",
    ].map((label, index) => ({
      key: `metric-${index}`,
      label,
      value: 90,
      unit: "%",
      numerator: 9,
      denominator: 10,
      formula: "derived",
    })),
    ncrAging: {
      open: 1,
      overdue: 1,
      averageOpenAgeDays: 3,
      oldestOpenAgeDays: 3,
    },
    costByCurrency: [
      {
        currency: "CAD",
        prevention: 10,
        appraisal: 20,
        internalFailure: 30,
        externalFailure: 40,
        copqByTerm: {
          rework: 10,
          scrap: 5,
          retesting: 4,
          delay: 6,
          claims: 40,
          startup_failures: 5,
        },
        unattributedFailure: 0,
        costOfPoorQuality: 70,
        totalCostOfQuality: 100,
      },
    ],
    forecastAttribution: [
      {
        developmentCaseId: "case-1",
        caseRef: "DEV-001",
        caseTitle: "Debottleneck project",
        currency: "CAD",
        qualityFailureGrowth: 7_800_000,
        scopeGrowth: 2_200_000,
        combinedGrowth: 10_000_000,
        qualitySharePct: 78,
        qualityEntryCount: 3,
        scopeChangeCount: 2,
        uncostedScopeChangeCount: 0,
        basis: "Recorded attribution only.",
      },
    ],
    requirements: [],
    itps: [],
    itpPoints: [],
    ncrs: [],
    defects: [],
    rework: [],
    acceptanceTests: [],
    basis: "Derived from atomic evidence.",
  }),
  executeQualityAction: vi.fn().mockResolvedValue({ id: 1, status: "draft" }),
}));

describe("QualityManagementWorkbench", () => {
  it("exposes the seven metrics, COPQ and all controlled quality actions", async () => {
    render(<QualityManagementWorkbench />);
    expect(
      await screen.findByText("Quality management & assurance"),
    ).toBeInTheDocument();
    expect(screen.getByText("First-pass yield")).toBeInTheDocument();
    expect(screen.getByText("Overdue open-NCR rate")).toBeInTheDocument();
    expect(
      screen.getByText(/COPQ = internal 30 \+ external 40/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Rework 10/)).toBeInTheDocument();
    expect(screen.getByText(/Quality-driven 7,800,000/)).toBeInTheDocument();
    expect(screen.getByText(/78% of attributed growth/)).toBeInTheDocument();
    expect(
      screen.getByLabelText("Quality action").querySelectorAll("option"),
    ).toHaveLength(13);
    expect(
      screen.getByText(/ONE project requirement table/),
    ).toBeInTheDocument();
  });

  it("refuses malformed action JSON before execution", async () => {
    render(<QualityManagementWorkbench />);
    await screen.findByText("Quality management & assurance");
    fireEvent.change(screen.getByLabelText("Governed quality payload"), {
      target: { value: "{" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Validate & record" }));
    expect(screen.getByText("Payload must be valid JSON.")).toBeInTheDocument();
  });
});
