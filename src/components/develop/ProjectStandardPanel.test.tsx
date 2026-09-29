import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ProjectStandardPanel } from "./ProjectStandardPanel";
import {
  listProjectStandardWork,
  requestProjectStandardRevision,
  decideProjectStandardRevision,
  type ProjectCaVerification,
  type ProjectStandardWorkOption,
} from "../../services/developService";
vi.mock("../../services/developService", () => ({
  listProjectStandardWork: vi.fn(),
  requestProjectStandardRevision: vi.fn(),
  decideProjectStandardRevision: vi.fn(),
  screenProjectCaExposure: vi.fn(),
}));
const closure = { id: "closure" } as ProjectCaVerification;
const standard: ProjectStandardWorkOption = {
  id: 1,
  work_key: "estimate",
  title: "Estimate review",
  version: 1,
  basis: "Manual",
  source_project_ca_id: null,
  previous_standard_work_id: null,
  change_summary: null,
  revision_requested_by: null,
  revision_approval_id: null,
  approval: null,
  procedures: [
    {
      language_code: "en",
      content: "Review scope",
      translation_status: "human_verified",
      verified_by: "engineer",
      verified_at: "2026-09-29",
    },
  ],
};
beforeEach(() => vi.resetAllMocks());
it("reloads a newly saved high-ID revision without skipping unloaded pages", async () => {
  const revision = {
    ...standard, id: 901, version: 2, source_project_ca_id: "closure",
    approval: { status: "required", approver_user_id: null, decided_at: null },
    procedures: [{ ...standard.procedures[0], translation_status: "draft" }],
  };
  vi.mocked(listProjectStandardWork).mockImplementation(async (afterId, exactId) =>
    exactId === 901 ? [revision] : afterId === 1 ? [{ ...standard, id: 2 }] : [standard],
  );
  vi.mocked(requestProjectStandardRevision).mockResolvedValue({
    revisionId: 901, approvalId: "approval", status: "draft",
  });
  render(<ProjectStandardPanel closure={closure} canWrite onChanged={vi.fn()} />);
  await selectProcedure();
  fireEvent.change(screen.getByLabelText("Proposed procedure"), { target: { value: "Review scope and interfaces" } });
  fireEvent.change(screen.getByLabelText("Exact change summary"), { target: { value: "Add interface review" } });
  fireEvent.change(screen.getByLabelText("Revision source basis"), { target: { value: "Failure evidence" } });
  fireEvent.click(screen.getByRole("button", { name: "Request draft revision" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Draft revision 901");
  expect(screen.getByLabelText("Standard / revision")).toHaveValue("901");
  fireEvent.click(screen.getByRole("button", { name: "Load more standards" }));
  await screen.findByText("Additional standards loaded");
  expect(listProjectStandardWork).toHaveBeenCalledWith(1);
  expect(screen.getByLabelText("Standard / revision")).toHaveValue("901");
});
async function selectProcedure() {
  await screen.findByRole("option", { name: /Estimate review/ });
  fireEvent.change(screen.getByLabelText("Standard / revision"), {
    target: { value: "1" },
  });
  fireEvent.change(screen.getByLabelText("Procedure language"), {
    target: { value: "en" },
  });
}
it("refuses unchanged requests and preserves proposed content after a backend refusal", async () => {
  vi.mocked(listProjectStandardWork).mockResolvedValue([standard]);
  vi.mocked(requestProjectStandardRevision).mockRejectedValue(
    new Error("Stale revision"),
  );
  render(
    <ProjectStandardPanel closure={closure} canWrite onChanged={vi.fn()} />,
  );
  await selectProcedure();
  expect(
    screen.getByRole("button", { name: "Request draft revision" }),
  ).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Proposed procedure"), {
    target: { value: "Review scope and interfaces" },
  });
  fireEvent.change(screen.getByLabelText("Exact change summary"), {
    target: { value: "Add interface check" },
  });
  fireEvent.change(screen.getByLabelText("Revision source basis"), {
    target: { value: "Lessons review" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Request draft revision" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("Stale revision");
  expect(screen.getByLabelText("Proposed procedure")).toHaveValue(
    "Review scope and interfaces",
  );
});
it("surfaces self-approval refusal without claiming adoption", async () => {
  vi.mocked(listProjectStandardWork).mockResolvedValue([
    {
      ...standard,
      source_project_ca_id: "closure",
      approval: {
        status: "required",
        approver_user_id: null,
        decided_at: null,
      },
      procedures: [{ ...standard.procedures[0], translation_status: "draft" }],
    },
  ]);
  vi.mocked(decideProjectStandardRevision).mockRejectedValue(
    new Error("Requester cannot approve"),
  );
  const changed = vi.fn();
  render(
    <ProjectStandardPanel closure={closure} canWrite onChanged={changed} />,
  );
  await selectProcedure();
  fireEvent.change(screen.getByLabelText("Decision basis"), {
    target: { value: "Reviewed change" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Approve adoption" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Requester cannot approve",
  );
  expect(changed).not.toHaveBeenCalled();
  expect(screen.queryByRole("status")).toBeNull();
});
