import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ContractStrategyAgentPanel } from "./ContractStrategyAgentPanel";

vi.mock("../../services/developService", () => ({
  runContractStrategyAgent: vi.fn(),
}));

describe("ContractStrategyAgentPanel", () => {
  it("renders all six evidence factors and the human authority boundary", () => {
    render(
      <ContractStrategyAgentPanel caseId="case-1" canPlan evidence={[]} />,
    );
    for (const label of [
      "Definition maturity",
      "Uncertainty",
      "Market conditions",
      "Owner capability",
      "Interface complexity",
      "Risk allocation",
    ])
      expect(screen.getByText(label)).toBeInTheDocument();
    expect(
      screen.getByText(/not a bidder selection, commitment or award/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /generate and record/i }),
    ).toBeDisabled();
    expect(
      screen.getByText(/No case evidence is available/i),
    ).toBeInTheDocument();
  });

  it("does not offer the agent act to a role outside the planning boundary", () => {
    render(
      <ContractStrategyAgentPanel
        caseId="case-1"
        canPlan={false}
        evidence={[]}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /generate and record/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/planning, engineering or governance role/i),
    ).toBeInTheDocument();
  });
});
