import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CaseOptionComparison, WorkspaceEvidence } from "../../lib/develop";
import { ConceptSelectionPanel } from "./ConceptSelectionPanel";
import {
  recordOptionSustainabilityObservation,
  reviewClimateResilienceAssessment,
} from "../../services/developService";

vi.mock("../../services/developService", () => ({
  createClimateResilienceAssessment: vi.fn(),
  recordClimateResilienceHazard: vi.fn(),
  recordOptionSustainabilityObservation: vi.fn().mockResolvedValue({ id: 1 }),
  reviewClimateResilienceAssessment: vi.fn().mockResolvedValue({ status: "reviewed" }),
}));

const evidence = [
  {
    id: "70000000-0000-4000-8000-000000000001",
    description: "Approved future-conditions basis",
    sourceReference: "CLIMATE-001",
  } as WorkspaceEvidence,
];

const comparison: CaseOptionComparison = {
  caseId: "case-1",
  available: true,
  comparisonComplete: false,
  requiredDimensions: 11,
  requiredClimateHazards: 8,
  decisionBoundary:
    "SyncAI does not score, rank, certify or select an option.",
  options: [
    {
      id: 44,
      label: "Raised electrical building",
      isDoNothing: false,
      comparisonComplete: false,
      missingDimensions: ["opex", "climate_resilience"],
      dimensions: [
        {
          dimension: "capex",
          status: "recorded",
          observation: "Class 4 estimate recorded",
          value: 12000000,
          unit: "CAD",
          basis: "Estimate EST-44",
          evidenceItemId: evidence[0].id,
        },
        {
          dimension: "climate_resilience",
          status: "missing",
          observation: "Eight-hazard climate resilience assessment CRA-44 revision 1",
          value: null,
          unit: null,
          basis: "Regional projection through 2065",
          evidenceItemId: null,
        },
      ],
      climateAssessment: {
        id: "assessment-1",
        assessmentRef: "CRA-44",
        revision: 1,
        status: "draft",
        futureConditionsBasis: "Regional projection through 2065",
        reviewedAt: null,
        reviewNote: null,
        hazards: [],
        missingHazards: [
          "extreme_temperature",
          "wildfire",
          "flood",
          "precipitation",
          "water_availability",
          "freeze_thaw",
          "permafrost",
          "storm_severity",
        ],
      },
    },
  ],
};

describe("ConceptSelectionPanel", () => {
  it("renders named gaps and the no-ranking decision boundary", () => {
    render(
      <ConceptSelectionPanel
        comparison={comparison}
        evidence={evidence}
        canPlan={false}
        canReview={false}
        busy={false}
        run={async (fn) => void (await fn())}
      />,
    );
    expect(screen.getByText(/Named gaps: opex, climate resilience/i)).toBeInTheDocument();
    expect(screen.getByText(/0\/8 hazards recorded/i)).toBeInTheDocument();
    expect(screen.getByText(/does not score, rank, certify or select/i)).toBeInTheDocument();
    expect(screen.queryByText(/recommended option/i)).toBeNull();
  });

  it("records an evidence-backed dimension through the governed service", async () => {
    render(
      <ConceptSelectionPanel
        comparison={comparison}
        evidence={evidence}
        canPlan
        canReview={false}
        busy={false}
        run={async (fn) => void (await fn())}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Record dimension" }));
    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[0], {
      target: { value: "opex" },
    });
    fireEvent.change(selects[1], { target: { value: evidence[0].id } });
    const inputs = screen.getAllByRole("textbox");
    fireEvent.change(inputs[0], { target: { value: "Lower inspected maintenance burden" } });
    fireEvent.change(inputs[2], { target: { value: "Lifecycle estimate comparison" } });
    fireEvent.click(screen.getByRole("button", { name: "Record observation" }));
    await waitFor(() =>
      expect(recordOptionSustainabilityObservation).toHaveBeenCalledWith(
        expect.objectContaining({ optionId: 44, dimension: "opex", evidenceItemId: evidence[0].id }),
      ),
    );
  });

  it("exposes independent review but preserves the server decision", async () => {
    render(
      <ConceptSelectionPanel
        comparison={comparison}
        evidence={evidence}
        canPlan={false}
        canReview
        busy={false}
        run={async (fn) => void (await fn())}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Independent review/i }));
    fireEvent.change(screen.getByPlaceholderText(/Independent review note/i), {
      target: { value: "All eight records independently checked against their evidence." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Record review" }));
    await waitFor(() =>
      expect(reviewClimateResilienceAssessment).toHaveBeenCalledWith(
        expect.objectContaining({ assessmentId: "assessment-1" }),
      ),
    );
  });
});
