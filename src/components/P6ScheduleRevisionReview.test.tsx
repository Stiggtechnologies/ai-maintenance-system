import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { P6ScheduleRevisionReview } from "./P6ScheduleRevisionReview";

const propose = vi.fn();
const decide = vi.fn();

vi.mock("../services/developService", () => ({
  proposeScheduleImportRevision: (...args: unknown[]) => propose(...args),
  decideScheduleImportRevision: (...args: unknown[]) => decide(...args),
}));

describe("P6ScheduleRevisionReview", () => {
  beforeEach(() => {
    propose.mockReset();
    decide.mockReset();
  });

  it("renders exact before/after evidence and requires a written human decision", async () => {
    propose.mockResolvedValue({
      answered: true,
      revisionId: "revision-1",
      status: "pending",
      changeCount: 1,
      changes: [
        {
          taskId: 7,
          eventId: "event-1",
          caseId: "case-1",
          activityKey: "A1010",
          stagingRowId: 11,
          fields: { durationHours: { from: 36, to: 40 } },
        },
      ],
    });
    decide.mockResolvedValue({
      answered: true,
      revisionId: "revision-1",
      status: "approved",
      applied: true,
      note: "Reviewed revision applied to the analysis copy only.",
    });

    render(<P6ScheduleRevisionReview runId="run-1" />);

    expect(await screen.findByText("A1010")).toBeInTheDocument();
    expect(screen.getByText("36")).toBeInTheDocument();
    expect(screen.getByText("40")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Accept reviewed revision" }),
    );
    expect(
      await screen.findByText(/at least 20 characters/i),
    ).toBeInTheDocument();
    expect(decide).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("P6 revision decision basis"), {
      target: {
        value: "Compared with the approved P6 export and accepted the change.",
      },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Accept reviewed revision" }),
    );

    await waitFor(() =>
      expect(decide).toHaveBeenCalledWith({
        revisionId: "revision-1",
        decision: "approved",
        note: "Compared with the approved P6 export and accepted the change.",
      }),
    );
    expect(
      await screen.findByText(/decision recorded: approved/i),
    ).toBeInTheDocument();
  });

  it("does not create review noise for an identical replay", async () => {
    propose.mockResolvedValue({
      answered: false,
      refusal: "No changed duplicate activity was found in this run.",
    });
    const { container } = render(<P6ScheduleRevisionReview runId="run-2" />);
    await waitFor(() => expect(propose).toHaveBeenCalledWith("run-2"));
    expect(container).toBeEmptyDOMElement();
  });
});
