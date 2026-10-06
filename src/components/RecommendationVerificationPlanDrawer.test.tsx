import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getPlan = vi.fn();
const getOwners = vi.fn();
const recordPlan = vi.fn();

vi.mock("../services/operatingLoopService", () => ({
  getRecommendationVerificationPlan: (...args: unknown[]) => getPlan(...args),
  getVerificationPlanOwners: (...args: unknown[]) => getOwners(...args),
  recordRecommendationVerificationPlan: (...args: unknown[]) =>
    recordPlan(...args),
}));

import { RecommendationVerificationPlanDrawer } from "./RecommendationVerificationPlanDrawer";

const EMPTY_PLAN = {
  recommendationId: "rec-1",
  obligationId: null,
  recommendationStatus: "pending",
  method: null,
  acceptanceCriteria: null,
  intendedOutcome: null,
  dueDate: null,
  dueDateAssumed: false,
  ownerId: null,
  ownerName: null,
  plannedBy: null,
  plannedAt: null,
  planComplete: false,
  state: "recommendation",
  legacyDebt: false,
  operationalAuthorization: false,
};

describe("RecommendationVerificationPlanDrawer", () => {
  beforeEach(() => {
    getPlan.mockReset();
    getOwners.mockReset();
    recordPlan.mockReset();
    getPlan.mockResolvedValue(EMPTY_PLAN);
    getOwners.mockResolvedValue([
      {
        ownerId: "owner-1",
        fullName: "Riley Chen",
        role: "reliability_engineer",
      },
    ]);
  });

  it("makes the approval-blocking plan and authority boundary visible", async () => {
    render(
      <RecommendationVerificationPlanDrawer
        recommendationId="rec-1"
        recommendationTitle="Replace P-101 seal"
        canGovern={false}
        onClose={() => undefined}
      />,
    );

    expect(
      await screen.findByText(/Approval is blocked until this plan is complete/),
    ).toBeTruthy();
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
    expect(screen.getByText(/do not authorize work/)).toBeTruthy();
    expect(screen.getByText(/Read-only view/)).toBeTruthy();
    expect(
      screen.queryByRole("button", {
        name: "Record governed verification plan",
      }),
    ).toBeNull();
  });

  it("records all five explicit plan elements through the governed service", async () => {
    recordPlan.mockResolvedValue({
      ...EMPTY_PLAN,
      method: "Measure seal leak rate after a 72-hour run",
      acceptanceCriteria:
        "Leak rate remains below 1 drop per minute for the full 72-hour window",
      intendedOutcome: "Sustained seal containment",
      dueDate: "2026-10-20",
      ownerId: "owner-1",
      ownerName: "Riley Chen",
      planComplete: true,
    });

    render(
      <RecommendationVerificationPlanDrawer
        recommendationId="rec-1"
        recommendationTitle="Replace P-101 seal"
        canGovern
        onClose={() => undefined}
      />,
    );
    await screen.findByText(/Approval is blocked/);

    fireEvent.change(screen.getByLabelText("Verification method"), {
      target: { value: "Measure seal leak rate after a 72-hour run" },
    });
    fireEvent.change(screen.getByLabelText("Intended outcome"), {
      target: { value: "Sustained seal containment" },
    });
    fireEvent.change(screen.getByLabelText("Acceptance criteria"), {
      target: {
        value:
          "Leak rate remains below 1 drop per minute for the full 72-hour window",
      },
    });
    fireEvent.change(screen.getByLabelText("Outcome verification date"), {
      target: { value: "2026-10-20" },
    });
    fireEvent.change(screen.getByLabelText("Named verification owner"), {
      target: { value: "owner-1" },
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Record governed verification plan",
      }),
    );

    await waitFor(() =>
      expect(recordPlan).toHaveBeenCalledWith({
        recommendationId: "rec-1",
        method: "Measure seal leak rate after a 72-hour run",
        acceptanceCriteria:
          "Leak rate remains below 1 drop per minute for the full 72-hour window",
        intendedOutcome: "Sustained seal containment",
        dueDate: "2026-10-20",
        ownerId: "owner-1",
      }),
    );
    expect(await screen.findByText(/Approval will snapshot it/)).toBeTruthy();
  });
});
