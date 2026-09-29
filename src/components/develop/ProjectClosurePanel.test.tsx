import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ProjectClosurePanel } from "./ProjectClosurePanel";
import {
  getProjectCaVerification,
  startProjectCaVerification,
  attestProjectCaStage,
  listOrgEvidenceItems,
  type ProjectCaVerification,
} from "../../services/developService";
vi.mock("../../services/developService", () => ({
  getProjectCaVerification: vi.fn(),
  startProjectCaVerification: vi.fn(),
  attestProjectCaStage: vi.fn(),
  listOrgEvidenceItems: vi.fn(),
}));
beforeEach(() => vi.resetAllMocks());
const closure: ProjectCaVerification = {
  id: "closure",
  project_lesson_id: "lesson",
  project_started_by: "planner",
  project_start_basis: "Variance review",
  physical_verified_at: null,
  physical_verified_by: null,
  physical_note: null,
  project_implementation_evidence_id: null,
  causal_addressed_at: null,
  causal_addressed_by: null,
  causal_note: null,
  project_causal_evidence_id: null,
};
it("submits named evidence and advances only after reloading the persisted stage", async () => {
  vi.mocked(getProjectCaVerification)
    .mockResolvedValueOnce(closure)
    .mockResolvedValue({
      ...closure,
      physical_verified_at: "2026-09-29",
      physical_verified_by: "planner",
      physical_note: "Observed implementation",
      project_implementation_evidence_id: "evidence",
    });
  vi.mocked(listOrgEvidenceItems).mockResolvedValue([
    {
      id: "evidence",
      description: "Inspection record",
      evidence_class: "measured",
    },
  ]);
  vi.mocked(attestProjectCaStage).mockResolvedValue({
    ok: true,
    stage: "implementation",
    detail: "Recorded",
  });
  render(<ProjectClosurePanel lessonId="lesson" canWrite />);
  fireEvent.click(screen.getByRole("button", { name: "Project closure" }));
  await screen.findByRole("option", { name: /Inspection record/ });
  fireEvent.change(screen.getByLabelText("Supporting evidence"), {
    target: { value: "evidence" },
  });
  fireEvent.change(screen.getByLabelText("Verification note"), {
    target: { value: "Observed implementation" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Attest implementation" }),
  );
  await screen.findByRole("button", { name: "Attest causal" });
  expect(attestProjectCaStage).toHaveBeenCalledWith({
    verificationId: "closure",
    stage: "implementation",
    note: "Observed implementation",
    evidenceId: "evidence",
  });
});
it("holds attestation when evidence loading fails", async () => {
  vi.mocked(getProjectCaVerification).mockResolvedValue(closure);
  vi.mocked(listOrgEvidenceItems).mockRejectedValue(
    new Error("Evidence unavailable"),
  );
  render(<ProjectClosurePanel lessonId="lesson" canWrite />);
  fireEvent.click(screen.getByRole("button", { name: "Project closure" }));
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent("Evidence unavailable"),
  );
  expect(
    screen.getByRole("button", { name: "Attest implementation" }),
  ).toBeDisabled();
});
it("does not load collapsed lessons or offer writes to read-only users", async () => {
  vi.mocked(getProjectCaVerification).mockResolvedValue(null);
  render(<ProjectClosurePanel lessonId="lesson" canWrite={false} />);
  expect(getProjectCaVerification).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Project closure" }));
  await screen.findByText(/No closure record yet/);
  expect(
    screen.queryByRole("button", { name: "Start project closure" }),
  ).toBeNull();
});
it("does not convert a failed read into an empty record", async () => {
  vi.mocked(getProjectCaVerification).mockRejectedValue(
    new Error("Unavailable"),
  );
  render(<ProjectClosurePanel lessonId="lesson" canWrite />);
  fireEvent.click(screen.getByRole("button", { name: "Project closure" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Unavailable");
  expect(screen.queryByText(/No closure record yet/)).toBeNull();
});
it("preserves entered basis when the backend refuses", async () => {
  vi.mocked(getProjectCaVerification).mockResolvedValue(null);
  vi.mocked(startProjectCaVerification).mockRejectedValue(
    new Error("Forbidden"),
  );
  render(<ProjectClosurePanel lessonId="lesson" canWrite />);
  fireEvent.click(screen.getByRole("button", { name: "Project closure" }));
  fireEvent.change(await screen.findByLabelText("Closure basis"), {
    target: { value: "Reviewed variance" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Start project closure" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("Forbidden");
  expect(screen.getByLabelText("Closure basis")).toHaveValue(
    "Reviewed variance",
  );
  expect(startProjectCaVerification).toHaveBeenCalledWith(
    "lesson",
    "Reviewed variance",
  );
});
