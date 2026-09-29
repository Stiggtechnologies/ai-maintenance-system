import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { LearningRevisionPanel } from "./LearningRevisionPanel";
const api = vi.hoisted(() => ({
  getObservedProcedure: vi.fn(),
  listProjectStandardWork: vi.fn(),
  requestLearningStandardRevision: vi.fn(),
  decideLearningStandardRevision: vi.fn(),
}));
vi.mock("../../services/developService", () => api);
beforeEach(() => {
  vi.resetAllMocks();
  api.getObservedProcedure.mockResolvedValue({
    id: 3,
    language_code: "en",
    content: "Original observed content",
  });
  api.listProjectStandardWork.mockResolvedValue([]);
});
function open(canWrite = true) {
  render(
    <LearningRevisionPanel
      observationId="obs"
      procedureId={3}
      canWrite={canWrite}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Review procedure revisions" }),
  );
}
const revision = {
  id: 7,
  title: "Inspection",
  version: 2,
  change_summary: "Added hold point",
  basis: "Observed evidence",
  revision_requested_by: "requester",
  procedures: [{ id: 8, language_code: "en", content: "Changed content" }],
  approval: { status: "required", approver_user_id: null, decided_at: null },
};
it("loads beyond the first page without dropping older revision decisions", async () => {
  const first = Array.from({ length: 100 }, (_, index) => ({
    ...revision,
    id: index + 1,
    version: index + 1,
    approval: { ...revision.approval, status: "rejected" },
  }));
  api.listProjectStandardWork
    .mockResolvedValueOnce(first)
    .mockResolvedValueOnce([{ ...revision, id: 101, version: 101 }]);
  open(false);
  expect(
    await screen.findByText("Inspection · version 101 · required"),
  ).toBeInTheDocument();
  expect(
    screen.getByText("Inspection · version 1 · rejected"),
  ).toBeInTheDocument();
  expect(api.listProjectStandardWork).toHaveBeenNthCalledWith(
    2,
    100,
    undefined,
    "obs",
  );
});
it("reports a later-page failure rather than displaying an incomplete history as complete", async () => {
  api.listProjectStandardWork
    .mockResolvedValueOnce(
      Array.from({ length: 100 }, (_, index) => ({
        ...revision,
        id: index + 1,
      })),
    )
    .mockRejectedValueOnce(new Error("Second page unavailable"));
  open(false);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Second page unavailable",
  );
  expect(
    screen.queryByText("No revisions requested from this observation."),
  ).not.toBeInTheDocument();
});
it("loads exact source and observation-scoped history only when opened", async () => {
  render(
    <LearningRevisionPanel
      observationId="obs"
      procedureId={3}
      canWrite={false}
    />,
  );
  expect(api.getObservedProcedure).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Review procedure revisions" }),
  );
  expect(
    await screen.findByText("Original observed content"),
  ).toBeInTheDocument();
  expect(api.getObservedProcedure).toHaveBeenCalledWith(3);
  expect(api.listProjectStandardWork).toHaveBeenCalledWith(
    undefined,
    undefined,
    "obs",
  );
  expect(
    screen.queryByRole("button", { name: "Request procedure revision" }),
  ).not.toBeInTheDocument();
});
it("keeps a single durable draft status while revision history reloads", async () => {
  let releaseSource: (value: {
    id: number;
    language_code: string;
    content: string;
  }) => void = () => {};
  const pendingSource = new Promise<{
    id: number;
    language_code: string;
    content: string;
  }>((resolve) => {
    releaseSource = resolve;
  });
  let releaseHistory: (rows: unknown[]) => void = () => {};
  const pendingHistory = new Promise<unknown[]>((resolve) => {
    releaseHistory = resolve;
  });
  api.getObservedProcedure
    .mockResolvedValueOnce({
      id: 3,
      language_code: "en",
      content: "Original observed content",
    })
    .mockReturnValueOnce(pendingSource);
  api.requestLearningStandardRevision.mockResolvedValue({
    revisionId: 7,
    approvalId: "a",
    status: "draft",
  });
  open();
  await screen.findByText("Original observed content");
  fireEvent.change(screen.getByLabelText("Changed procedure content"), {
    target: { value: "Changed content" },
  });
  fireEvent.change(screen.getByLabelText("Change summary"), {
    target: { value: "Added hold point" },
  });
  fireEvent.change(screen.getByLabelText("Evidence and applicability basis"), {
    target: { value: "Observed evidence" },
  });
  api.listProjectStandardWork.mockReturnValue(pendingHistory);
  fireEvent.click(
    screen.getByRole("button", { name: "Request procedure revision" }),
  );
  const panel = screen.getByRole("button", {
    name: "Review procedure revisions",
  }).parentElement;
  await waitFor(() => expect(panel).toHaveAttribute("aria-busy", "true"));
  expect(screen.getAllByRole("status")).toHaveLength(1);
  expect(screen.getByRole("status")).toHaveTextContent(
    /Draft revision \d+ requested/,
  );
  // The receipt text is not an accessible name. role=status is named by the author only.
  expect(
    screen.queryByRole("status", { name: /Draft revision \d+ requested/ }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByText("Loading source and revision history…"),
  ).not.toBeInTheDocument();
  releaseSource({
    id: 3,
    language_code: "en",
    content: "Original observed content",
  });
  releaseHistory([revision]);
  expect(
    await screen.findByText("Inspection · version 2 · required"),
  ).toBeInTheDocument();
  expect(screen.getAllByRole("status")).toHaveLength(1);
  await waitFor(() => expect(panel).toHaveAttribute("aria-busy", "false"));
});
it("requests a draft and reloads history instead of locally inventing adoption", async () => {
  api.requestLearningStandardRevision.mockResolvedValue({
    revisionId: 7,
    approvalId: "a",
    status: "draft",
  });
  open();
  await screen.findByText("Original observed content");
  fireEvent.change(screen.getByLabelText("Changed procedure content"), {
    target: { value: "Changed content" },
  });
  fireEvent.change(screen.getByLabelText("Change summary"), {
    target: { value: "Added hold point" },
  });
  fireEvent.change(screen.getByLabelText("Evidence and applicability basis"), {
    target: { value: "Observed evidence" },
  });
  api.listProjectStandardWork.mockResolvedValue([revision]);
  fireEvent.click(
    screen.getByRole("button", { name: "Request procedure revision" }),
  );
  expect(
    await screen.findByText(/Draft revision 7 requested/),
  ).toBeInTheDocument();
  expect(
    await screen.findByText(/Inspection · version 2 · required/),
  ).toBeInTheDocument();
  expect(api.requestLearningStandardRevision).toHaveBeenCalledWith({
    observationId: "obs",
    content: "Changed content",
    changeSummary: "Added hold point",
    basis: "Observed evidence",
  });
});
it("preserves decision basis on a self-approval refusal", async () => {
  api.listProjectStandardWork.mockResolvedValue([revision]);
  api.decideLearningStandardRevision.mockRejectedValue(
    new Error("Requester cannot decide their own adoption"),
  );
  open();
  await screen.findByText(/Inspection · version 2/);
  fireEvent.change(screen.getByLabelText("Decision"), {
    target: { value: "approved" },
  });
  fireEvent.change(screen.getByLabelText("Decision basis"), {
    target: { value: "My review basis" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Record human decision" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(/cannot decide/);
  expect(screen.getByLabelText("Decision basis")).toHaveValue(
    "My review basis",
  );
  expect(api.decideLearningStandardRevision).toHaveBeenCalledWith(
    7,
    "approved",
    "My review basis",
  );
});
it("reloads a successful decision and removes decided controls", async () => {
  api.listProjectStandardWork
    .mockResolvedValueOnce([revision])
    .mockResolvedValue([
      {
        ...revision,
        approval: {
          status: "approved",
          approver_user_id: "other-human",
          decided_at: "2026-09-28",
        },
      },
    ]);
  api.decideLearningStandardRevision.mockResolvedValue({
    revisionId: 7,
    status: "approved",
    detail: "Decision recorded; improvement unproven",
  });
  open();
  await screen.findByText(/Inspection · version 2/);
  fireEvent.change(screen.getByLabelText("Decision"), {
    target: { value: "approved" },
  });
  fireEvent.change(screen.getByLabelText("Decision basis"), {
    target: { value: "Reviewed exact content" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Record human decision" }),
  );
  expect(
    await screen.findByText(/Inspection · version 2 · approved/),
  ).toBeInTheDocument();
  expect(screen.getByText(/Decision by: other-human/)).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Record human decision" }),
  ).not.toBeInTheDocument();
});
it("reports failed source reads rather than an empty history and supports retry", async () => {
  api.getObservedProcedure
    .mockRejectedValueOnce(new Error("Source read failed"))
    .mockResolvedValue({
      id: 3,
      language_code: "en",
      content: "Recovered source",
    });
  open();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Source read failed",
  );
  expect(
    screen.queryByText("No revisions requested from this observation."),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Reload revisions" }));
  await waitFor(() =>
    expect(screen.getByText("Recovered source")).toBeInTheDocument(),
  );
});
