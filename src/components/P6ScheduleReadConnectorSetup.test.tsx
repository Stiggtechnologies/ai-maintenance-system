import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { P6ScheduleReadConnectorSetup } from "./P6ScheduleReadConnectorSetup";

const auth = vi.hoisted(() => ({ role: "admin" }));
const actions = vi.hoisted(() => ({
  configure: vi.fn(),
  pull: vi.fn(),
}));
const listDevelopmentCases = vi.hoisted(() => vi.fn());

vi.mock("./AuthProvider", () => ({
  useAuth: () => ({ profile: { role: auth.role } }),
}));
vi.mock("../services/p6ScheduleRead", () => ({
  p6ScheduleReadActions: actions,
}));
vi.mock("../services/developService", () => ({
  listDevelopmentCases,
}));
vi.mock("./P6ScheduleRevisionReview", () => ({
  P6ScheduleRevisionReview: ({ runId }: { runId: string }) => (
    <div>Revision review for {runId}</div>
  ),
}));

beforeEach(() => {
  auth.role = "admin";
  actions.configure.mockReset().mockResolvedValue({
    note: "Enabled bounded user-triggered P6 reads.",
  });
  actions.pull.mockReset().mockResolvedValue({
    dry_run: true,
    activities: 2,
    relationships: 1,
    bytes: 880,
  });
  listDevelopmentCases.mockReset().mockResolvedValue([
    {
      id: "0f8fad5b-d9cb-469f-a165-70867728950e",
      title: "Turnaround 2027",
    },
  ]);
});

describe("P6 schedule read connector setup", () => {
  it("records the exact approved project, case and duration conversion", async () => {
    const onConfigured = vi.fn().mockResolvedValue(undefined);
    render(<P6ScheduleReadConnectorSetup onConfigured={onConfigured} />);

    await screen.findByRole("option", { name: "Turnaround 2027" });
    fireEvent.change(screen.getByPlaceholderText("P6 connector key"), {
      target: { value: "site-a-p6" },
    });
    fireEvent.change(screen.getByPlaceholderText("P6 display name"), {
      target: { value: "Site A Primavera" },
    });
    fireEvent.change(
      screen.getByPlaceholderText("https://p6.example.com/p6ws/restapi"),
      { target: { value: "https://p6.site-a.example.com/p6ws/restapi" } },
    );
    fireEvent.change(screen.getByLabelText("P6 ProjectObjectId"), {
      target: { value: "4101" },
    });
    fireEvent.change(screen.getByLabelText("Development case"), {
      target: { value: "0f8fad5b-d9cb-469f-a165-70867728950e" },
    });
    fireEvent.change(screen.getByPlaceholderText("Canonical schedule name"), {
      target: { value: "Turnaround 2027" },
    });
    fireEvent.change(screen.getByLabelText("P6 duration unit to hours"), {
      target: { value: "8" },
    });
    fireEvent.change(
      screen.getByPlaceholderText("vault://tenant/primavera-p6"),
      { target: { value: "vault://site-a/primavera-p6" } },
    );
    fireEvent.change(
      screen.getByPlaceholderText(
        "Activation authority, approved project scope, and duration-conversion basis (20+ characters)",
      ),
      {
        target: {
          value:
            "The turnaround manager approved project 4101 and verified P6 durations are eight-hour days.",
        },
      },
    );
    fireEvent.click(
      screen.getByLabelText(/Enable only after the exact P6 host/i),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save and enable" }));

    await waitFor(() => expect(actions.configure).toHaveBeenCalledTimes(1));
    expect(actions.configure).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "site-a-p6",
        projectObjectId: 4101,
        developmentCaseId: "0f8fad5b-d9cb-469f-a165-70867728950e",
        durationToHours: 8,
        maxActivities: 5000,
        maxRelationships: 20000,
        enabled: true,
      }),
    );
    expect(onConfigured).toHaveBeenCalledTimes(1);
  });

  it("does not guess a duration conversion or expose configuration to planners", async () => {
    const { rerender } = render(
      <P6ScheduleReadConnectorSetup onConfigured={vi.fn()} />,
    );
    expect(screen.getByLabelText("P6 duration unit to hours")).toHaveValue(
      null,
    );
    expect(
      screen.getByRole("button", { name: "Save disabled configuration" }),
    ).toBeDisabled();

    auth.role = "planner";
    rerender(<P6ScheduleReadConnectorSetup onConfigured={vi.fn()} />);
    expect(
      screen.getByText(
        "An administrator must configure or enable this source.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("P6 connector key")).toBeNull();

    auth.role = "ai_admin";
    rerender(<P6ScheduleReadConnectorSetup onConfigured={vi.fn()} />);
    expect(
      screen.getByText(
        "An administrator must configure or enable this source.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("P6 connector key")).toBeNull();
  });

  it("opens the canonical human review when a committed pull retains duplicates", async () => {
    actions.pull.mockResolvedValue({
      dry_run: false,
      run_id: "run-with-change",
      status: "success",
      activities: 2,
      relationships: 1,
      bytes: 880,
      duplicate: 2,
    });
    render(<P6ScheduleReadConnectorSetup onConfigured={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("P6 connector key"), {
      target: { value: "site-a-p6" },
    });
    fireEvent.click(
      screen.getByLabelText(/Enable only after the exact P6 host/i),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Import complete project snapshot" }),
    );

    expect(
      await screen.findByText("Revision review for run-with-change"),
    ).toBeInTheDocument();
    expect(actions.pull).toHaveBeenCalledWith("site-a-p6", false);
  });
});
