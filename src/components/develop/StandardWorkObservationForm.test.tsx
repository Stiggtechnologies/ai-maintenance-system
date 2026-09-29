import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { StandardWorkObservationForm } from "./StandardWorkObservationForm";
const api = vi.hoisted(() => ({ getCaseWorkPackages: vi.fn(), listOrgEvidenceItems: vi.fn(), listProjectStandardWork: vi.fn(), recordStandardWorkObservation: vi.fn() }));
vi.mock("../../services/developService", () => api);
beforeEach(() => {
  vi.resetAllMocks();
  api.listProjectStandardWork.mockResolvedValue([{ id: 1, title: "Installation", version: 2, procedures: [{ id: 3, language_code: "en", translation_status: "human_verified", verified_by: "human", verified_at: "today" }] }]);
  api.getCaseWorkPackages.mockResolvedValue({ answered: true, packages: [{ workOrders: [{ workOrderId: "work", title: "Install", executionStatus: "in_progress" }] }] });
  api.listOrgEvidenceItems.mockResolvedValue([{ id: "evidence", description: "Inspection" }]);
});
it("records the selected canonical references and refreshes only on success", async () => {
  api.recordStandardWorkObservation.mockResolvedValue({ id: "observation", status: "observed" });
  const refreshed = vi.fn();
  render(<StandardWorkObservationForm caseId="case" onRecorded={refreshed} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Record observation" })).toBeEnabled());
  for (const [label, value] of [["Procedure version", "3"], ["Actual work order", "work"], ["Observed at (local time)", "2026-09-28T10:00"], ["Title", "Observed installation"], ["Actual execution", "Witnessed installation"], ["Variation basis", "Intermediate steps not visible"], ["Observed outcome", "Inspection completed only"], ["Attribution limits", "One observation with no causal counterfactual"], ["Learning", "Retain inspection points"], ["Applicability", "Equivalent installations"], ["Execution evidence", "evidence"], ["Outcome evidence", "evidence"]]) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
  fireEvent.click(screen.getByRole("button", { name: "Record observation" }));
  expect(await screen.findByText(/Observation recorded: observation/)).toBeInTheDocument();
  expect(api.recordStandardWorkObservation).toHaveBeenCalledWith(expect.objectContaining({ caseId: "case", procedureId: 3, workOrderId: "work", variationKind: "undetermined", executionEvidenceId: "evidence", outcomeEvidenceId: "evidence", outcomeKind: "qualitative", attributionLimit: "One observation with no causal counterfactual" }));
  expect(refreshed).toHaveBeenCalledTimes(1);
});
it("captures an explicit quantitative value and unit without claiming improvement", async () => {
  api.recordStandardWorkObservation.mockResolvedValue({ id: "quantitative-observation", status: "observed" });
  const { container } = render(<StandardWorkObservationForm caseId="case" onRecorded={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Record observation" })).toBeEnabled());
  fireEvent.change(screen.getByLabelText("Outcome representation"), { target: { value: "quantitative" } });
  fireEvent.change(screen.getByLabelText("Outcome value"), { target: { value: "4.75" } });
  fireEvent.change(screen.getByLabelText("Outcome unit"), { target: { value: "hours" } });
  fireEvent.change(screen.getByLabelText("Observed at (local time)"), { target: { value: "2026-09-28T10:00" } });
  fireEvent.submit(container.querySelector("form")!);
  await waitFor(() => expect(api.recordStandardWorkObservation).toHaveBeenCalledWith(expect.objectContaining({ outcomeKind: "quantitative", outcomeValue: 4.75, outcomeUnit: "hours" })));
});
it("refuses to enable recording when case context is denied", async () => {
  api.getCaseWorkPackages.mockResolvedValue({ answered: false, refusal: "Not authorized" });
  render(<StandardWorkObservationForm caseId="case" onRecorded={vi.fn()} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Not authorized");
  expect(screen.getByRole("button", { name: "Record observation" })).toBeDisabled();
});
it("excludes an unadopted learning revision even if a procedure claims verification", async () => {
  api.listProjectStandardWork.mockResolvedValue([{ id: 2, title: "Unadopted learning revision", version: 2,
    previous_standard_work_id: 1, source_project_ca_id: null, approval: { status: "pending" },
    procedures: [{ id: 4, language_code: "en", translation_status: "human_verified", verified_by: "human", verified_at: "today" }] }]);
  render(<StandardWorkObservationForm caseId="case" onRecorded={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Record observation" })).toBeEnabled());
  expect(screen.queryByRole("option", { name: /Unadopted learning revision/ })).not.toBeInTheDocument();
});
it("preserves entered work and does not refresh history when the server refuses a save", async () => {
  api.recordStandardWorkObservation.mockRejectedValue(new Error("Evidence no longer available"));
  const refreshed = vi.fn();
  const { container } = render(<StandardWorkObservationForm caseId="case" onRecorded={refreshed} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Record observation" })).toBeEnabled());
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Preserve my observation" } });
  fireEvent.change(screen.getByLabelText("Observed at (local time)"), { target: { value: "2026-09-28T10:00" } });
  fireEvent.submit(container.querySelector("form")!);
  expect(await screen.findByRole("alert")).toHaveTextContent("Evidence no longer available");
  expect(screen.getByLabelText("Title")).toHaveValue("Preserve my observation");
  expect(refreshed).not.toHaveBeenCalled();
  expect(screen.queryByText(/Observation recorded:/)).not.toBeInTheDocument();
});
