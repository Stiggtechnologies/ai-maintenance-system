import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { P6ResourceDemandReview } from "./P6ResourceDemandReview";

const recordResourceDemand = vi.fn();

vi.mock("../services/developService", () => ({
  recordResourceDemand: (...args: unknown[]) => recordResourceDemand(...args),
}));

const assignment = {
  activityId: "A1010",
  resourceId: "R1",
  resourceName: "Millwrights",
  resourceType: "RT_Labor",
  sourceUnit: "h",
  plannedUnits: 72,
  remainingUnits: 36,
  plannedStart: "2027-03-02T13:00:00.000Z",
  plannedFinish: "2027-03-04T01:00:00.000Z",
};

describe("P6ResourceDemandReview", () => {
  beforeEach(() => {
    recordResourceDemand.mockReset();
  });

  it("does not infer a governed category or turn detected quantity into hours", () => {
    render(
      <P6ResourceDemandReview
        caseId="11111111-1111-1111-1111-111111111111"
        assignments={[assignment]}
        scheduleReady
      />,
    );

    expect(screen.getByLabelText("A1010 resource category")).toHaveValue("");
    expect(screen.getByLabelText("A1010 demand hours")).toHaveValue("");
    expect(screen.getByText(/detected quantity 36 h/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^approve/i }),
    ).not.toBeInTheDocument();
  });

  it("records only an unapproved canonical demand draft after explicit review", async () => {
    recordResourceDemand.mockResolvedValue({
      answered: true,
      demandId: 42,
      approved: false,
    });
    render(
      <P6ResourceDemandReview
        caseId="11111111-1111-1111-1111-111111111111"
        assignments={[assignment]}
        scheduleReady
      />,
    );

    fireEvent.change(screen.getByLabelText("A1010 resource category"), {
      target: { value: "skilled_trades" },
    });
    fireEvent.change(screen.getByLabelText("A1010 demand hours"), {
      target: { value: "36" },
    });
    fireEvent.change(screen.getByLabelText("A1010 demand basis"), {
      target: { value: "Verified P6 remaining labour units are hours" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Record as unapproved demand" }),
    );

    await waitFor(() =>
      expect(recordResourceDemand).toHaveBeenCalledWith(
        "11111111-1111-1111-1111-111111111111",
        {
          category: "skilled_trades",
          pool: "Millwrights",
          demandHours: "36",
          periodStart: "2027-03-02",
          periodEnd: "2027-03-04",
          sourceKind: "estimate",
          basis:
            "P6 XER assignment A1010: Verified P6 remaining labour units are hours",
        },
      ),
    );
    expect(
      await screen.findByText(/recorded as unapproved demand #42/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Recorded — awaiting human approval",
      }),
    ).toBeDisabled();
  });

  it("keeps the demand act disabled until the schedule import is clean", () => {
    render(
      <P6ResourceDemandReview
        caseId="11111111-1111-1111-1111-111111111111"
        assignments={[assignment]}
        scheduleReady={false}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Record as unapproved demand" }),
    ).toBeDisabled();
    expect(screen.getByText(/without refused rows/i)).toBeInTheDocument();
  });
});
