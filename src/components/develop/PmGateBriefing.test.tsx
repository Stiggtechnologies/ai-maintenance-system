import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { GateReviewPack } from "../../services/developService";
import { PmGateBriefing } from "./PmGateBriefing";

vi.mock("../../lib/develop/pmGateBriefing", () => ({
  buildPmGateBriefing: () => ({
    headline: "Gate 3: BLOCKED at 74%.",
    position: "blocked",
    measures: [
      {
        label: "Gate readiness",
        value: "74%",
        explanation: "Governed evaluator result.",
        recordRefs: ["stage_gates:42", "stage_gate_criteria:11"],
      },
    ],
    blockers: [
      {
        label: "Mandatory requirement",
        name: "Risk closed",
        recordRef: "stage_gate_criteria:12",
      },
    ],
    projection: {
      value: "Not defensible yet",
      explanation: "Only one closure is recorded.",
      recordRefs: ["stage_gate_reviews:91"],
    },
    decisionBoundary:
      "This briefing is advisory. A named eligible human must record the decision separately.",
  }),
}));

describe("PM gate briefing panel", () => {
  it("renders the decision brief, trace controls, blockers and human boundary", () => {
    render(
      <PmGateBriefing
        pack={
          {
            caseTitle: "Expansion train",
            decisionType: "gate",
          } as GateReviewPack
        }
      />,
    );

    expect(
      screen.getByRole("region", { name: "PM gate briefing" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Gate 3: BLOCKED at 74%.")).toBeInTheDocument();
    expect(screen.getByText("Mandatory requirement")).toBeInTheDocument();
    expect(screen.getByText("stage_gate_criteria:12")).toBeInTheDocument();
    expect(screen.getByText("Not defensible yet")).toBeInTheDocument();
    expect(screen.getAllByText("Record trail")).toHaveLength(2);
    expect(
      screen.getByText(/named eligible human must record the decision/i),
    ).toBeInTheDocument();
  });
});
