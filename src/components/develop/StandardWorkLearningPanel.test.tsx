import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { StandardWorkLearningPanel } from "./StandardWorkLearningPanel";
const list = vi.hoisted(() => vi.fn());
vi.mock("../../services/developService", () => ({ listStandardWorkObservations: list }));
beforeEach(() => list.mockReset());
it("shows an honest empty state without claiming improvement", async () => {
  list.mockResolvedValue([]);
  render(<StandardWorkLearningPanel caseId="case" />);
  expect(await screen.findByText("No standard-work observations recorded for this case.")).toBeInTheDocument();
  expect(screen.getByText(/does not establish improvement/)).toBeInTheDocument();
  expect(list).toHaveBeenCalledWith("case", undefined);
});
it("surfaces read failure and allows a successful retry", async () => {
  list.mockRejectedValueOnce(new Error("Read unavailable")).mockResolvedValue([]);
  render(<StandardWorkLearningPanel caseId="case" />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Read unavailable");
  expect(screen.queryByText(/No standard-work observations recorded/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry history" }));
  expect(await screen.findByText(/No standard-work observations recorded/)).toBeInTheDocument();
});
it("renders recorded learning and exact provenance without verification claims", async () => {
  list.mockResolvedValue([{ id: "obs-1", title: "Inspection sequence", detail: "Retain inspection point",
    applicability: "Equivalent assemblies", standard_variation_kind: "undetermined",
    standard_execution_description: "Installation witnessed", standard_variation_basis: "Intermediate steps not visible",
    standard_outcome_description: "Inspection completed", standard_procedure_id: 3,
    standard_outcome_kind: "quantitative", standard_outcome_value: 4.75, standard_outcome_unit: "hours",
    standard_outcome_attribution_limit: "One observation; no causal counterfactual",
    standard_execution_work_order_id: "wo-1", standard_execution_evidence_id: "ev-1",
    standard_outcome_evidence_id: "ev-2", standard_execution_recorded_by: "human-1",
    standard_execution_observed_at: "2026-09-28T00:00:00Z" }]);
  render(<StandardWorkLearningPanel caseId="case" />);
  expect(await screen.findByText("Inspection sequence")).toBeInTheDocument();
  expect(screen.getByText("Execution evidence: ev-1")).toBeInTheDocument();
  expect(screen.getByText("Outcome evidence: ev-2")).toBeInTheDocument();
  expect(screen.getByText("4.75 hours")).toBeInTheDocument();
  expect(screen.getByText("One observation; no causal counterfactual")).toBeInTheDocument();
  expect(screen.getByText(/Recorded observation · undetermined/)).toBeInTheDocument();
});
