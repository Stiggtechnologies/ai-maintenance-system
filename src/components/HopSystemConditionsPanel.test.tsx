import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
vi.mock("../services/hopAgentService", async () => {
  const actual = await vi.importActual<
    typeof import("../services/hopAgentService")
  >("../services/hopAgentService");
  return { ...actual, runHopAgent: vi.fn(), recordHopSystemCondition: vi.fn() };
});
import { HopSystemConditionsPanel } from "./HopSystemConditionsPanel";
describe("HOP system-condition surface", () => {
  it("states the non-surveillance boundary and exposes all nine categories", () => {
    render(<HopSystemConditionsPanel />);
    expect(
      screen.getByText(/does not identify, rank, score/i),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /record condition/i }));
    for (const label of [
      "Task complexity",
      "Conflicting procedures",
      "Excessive handoffs",
      "Decision delays",
      "Workarounds",
      "Repeat deviations",
      "Overloaded roles",
      "Unclear authority",
      "Error-provoking conditions",
    ])
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    expect(screen.getByText(/Do not enter names/i)).toBeInTheDocument();
  });
});
