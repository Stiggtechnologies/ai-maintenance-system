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
        costOfPoorQuality: 70,
        totalCostOfQuality: 100,
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
    expect(
      screen.getByLabelText("Quality action").querySelectorAll("option"),
    ).toHaveLength(13);
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
