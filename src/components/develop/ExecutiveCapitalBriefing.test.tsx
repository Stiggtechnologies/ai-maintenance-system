import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ExecutiveCapitalBriefing } from "./ExecutiveCapitalBriefing";
import type { ExecutiveCapitalBriefingModel } from "../../lib/develop/executiveCapitalBriefing";

const model: ExecutiveCapitalBriefingModel = {
  caseId: "case-1",
  caseTitle: "Compressor renewal",
  position: "human_review_required",
  headline: "The evidence is assembled for a human next-dollar review.",
  cost: {
    currency: "CAD",
    sanctioned: 340,
    deterministicForecast: 397,
    p80Forecast: 420,
    comparison: "Forecast exceeds sanction.",
    refusal: null,
  },
  schedule: {
    deterministicFinish: "2027-01-01",
    p80Finish: "2027-04-22",
    refusal: null,
  },
  value: {
    available: true,
    atSanction: 82,
    current: 69,
    delta: -13,
    refusal: null,
    sourceRefs: ["lifecycle_evaluations:eval-1"],
  },
  benefits: [
    {
      id: "b-1",
      label: "Avoided downtime",
      unit: "M CAD/year",
      expected: 82,
      forecast: 69,
      actual: null,
      owner: "Alex",
      expectedDate: "2027-12-31",
      basis: "approved",
      sourceRefs: ["value_metrics:b-1"],
    },
  ],
  majorDrivers: [
    {
      id: "r-1",
      label: "Compressor delivery",
      level: "High",
      p80DaysContribution: null,
      reason: "Open case risk.",
      sourceRefs: ["risks:r-1"],
    },
  ],
  forecastCurrent: true,
  forecastRunId: "run-1",
  forecastSourceRefs: ["calculation_runs:run-1"],
  limitations: [],
  decisionBoundary:
    "A named human with delegated authority owns that decision.",
};

describe("ExecutiveCapitalBriefing", () => {
  it("renders the five decision inputs and the human authority boundary", () => {
    render(<ExecutiveCapitalBriefing model={model} />);
    expect(screen.getByText("Approved capital")).toBeInTheDocument();
    expect(screen.getByText("Cost P80")).toBeInTheDocument();
    expect(screen.getByText("Completion P80")).toBeInTheDocument();
    expect(
      screen.getByText("Expected value since sanction"),
    ).toBeInTheDocument();
    expect(screen.getByText("Benefit commitments")).toBeInTheDocument();
    expect(screen.getByText("Compressor delivery")).toBeInTheDocument();
    expect(
      screen.getByText(/named human with delegated authority/i),
    ).toBeInTheDocument();
  });

  it("renders missing evidence as incomplete rather than a clean capital position", () => {
    render(
      <ExecutiveCapitalBriefing
        model={{
          ...model,
          position: "evidence_incomplete",
          headline: "The next-dollar decision is not evidence-complete.",
          cost: { ...model.cost, p80Forecast: null },
          limitations: ["No current forecast."],
        }}
      />,
    );
    expect(screen.getByText("Evidence incomplete")).toBeInTheDocument();
    expect(screen.getAllByText("Not available").length).toBeGreaterThan(0);
    expect(screen.getByText("No current forecast.")).toBeInTheDocument();
  });
});
