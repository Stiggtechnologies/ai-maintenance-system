import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MethodologyLearningPanel } from "./MethodologyLearningPanel";

const analyze = vi.fn();
const propose = vi.fn();
vi.mock("../../services/developService", () => ({
  runMethodologyOutcomeAnalysis: (...args: unknown[]) => analyze(...args),
  proposeMethodologyImprovement: (...args: unknown[]) => propose(...args),
}));

const adopted = [
  {
    id: "framework-1",
    name: "Capital Delivery",
    version: 2,
    sourceAuthority: "CORPORATE_STANDARD",
    gates: 4,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("MethodologyLearningPanel", () => {
  it("renders thin-history refusals without implying a relationship", async () => {
    analyze.mockResolvedValue({
      calculationRunId: "run-refused",
      status: "refused",
      eligiblePatterns: 0,
      criteria: [],
      refusals: [
        "design / Gate 2 / Approved basis withheld: met=2, not_met=1; each cohort requires at least 3 completed projects.",
      ],
      associationNotCausation: true,
      automaticMethodChange: false,
    });
    render(
      <MethodologyLearningPanel
        adopted={adopted}
        canAuthor
        onChanged={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Adopted framework to analyze"), {
      target: { value: "framework-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Analyze outcomes" }));
    expect(await screen.findByText(/withheld: met=2/)).toBeInTheDocument();
    expect(screen.getByText("association ≠ causation")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /propose a governed draft change/ }),
    ).not.toBeInTheDocument();
  });

  it("turns an eligible association into a draft proposal, never adoption", async () => {
    analyze.mockResolvedValue({
      calculationRunId: "12345678-analysis",
      status: "computed",
      eligiblePatterns: 1,
      refusals: [],
      associationNotCausation: true,
      automaticMethodChange: false,
      criteria: [
        {
          criterionId: 42,
          gateId: 8,
          stageKey: "design",
          gateName: "Gate 2",
          criterion: "Approved design basis exists",
          metSample: 5,
          notMetSample: 4,
          means: {
            met: {
              costGrowthPct: 3,
              scheduleGrowthPct: 4,
              commissioningDefects: 2,
              startupReliabilityPct: 97,
            },
            notMet: {
              costGrowthPct: 18,
              scheduleGrowthPct: 22,
              commissioningDefects: 9,
              startupReliabilityPct: 86,
            },
          },
          correlations: {},
          associationNotCausation: true,
          automaticMethodChange: false,
        },
      ],
    });
    propose.mockResolvedValue({
      proposalId: "proposal-1",
      frameworkId: "draft-1",
      version: 3,
      status: "draft",
      action: "strengthen",
      adoptionRequired: true,
      automaticMethodChange: false,
      decisionBoundary: "Human adoption required.",
    });
    const onChanged = vi.fn();
    render(
      <MethodologyLearningPanel
        adopted={adopted}
        canAuthor
        onChanged={onChanged}
      />,
    );
    fireEvent.change(screen.getByLabelText("Adopted framework to analyze"), {
      target: { value: "framework-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Analyze outcomes" }));
    fireEvent.click(
      await screen.findByRole("button", {
        name: "propose a governed draft change",
      }),
    );
    fireEvent.change(screen.getByLabelText("Mandatory setting"), {
      target: { value: "true" },
    });
    fireEvent.change(screen.getByLabelText("Human rationale"), {
      target: {
        value: "The observed outcome gap warrants a stronger evidence gate.",
      },
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Create draft version and proposal",
      }),
    );
    await waitFor(() =>
      expect(propose).toHaveBeenCalledWith(
        expect.objectContaining({
          calculationRunId: "12345678-analysis",
          criterionId: 42,
          action: "strengthen",
          isMandatory: true,
        }),
      ),
    );
    expect(
      await screen.findByText(/Draft framework v3 created/),
    ).toBeInTheDocument();
    expect(screen.getByText(/governs nothing until/)).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalled();
  });
});
