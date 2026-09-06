import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../hooks/useOnboardingOperatingLoop", () => ({
  useOnboardingOperatingLoop: () => ({ learningEvents: [] }),
}));

vi.mock("../services/operatingLoopService", async () => {
  const actual = await vi.importActual<
    typeof import("../services/operatingLoopService")
  >("../services/operatingLoopService");
  return {
    ...actual,
    getLearningEvents: () => Promise.resolve([]),
  };
});

vi.mock("../lib/supabase", () => ({
  supabase: {
    rpc: vi.fn((name: string) => {
      if (name === "get_verification_posture") {
        return Promise.resolve({
          data: [
            {
              actionedRecommendations: 1,
              withObligation: 1,
              openObligations: 1,
              overdue: 0,
              achieved: 0,
              notAchieved: 0,
              inconclusive: 0,
              waived: 0,
              actionedWithoutObligation: 0,
            },
          ],
          error: null,
        });
      }
      if (name === "get_open_verifications") {
        return Promise.resolve({
          data: [
            {
              obligationId: "obl-learn",
              recommendationTitle: "Inspect coupling on C-22",
              assetName: "C-22",
              method: "Visual after first cycle",
              dueDate: "2026-09-20",
              dueDateAssumed: true,
              daysOverdue: 0,
              intendedOutcome: "No recurrence",
            },
          ],
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    }),
  },
}));

import { LearningLoop } from "./LearningLoop";

describe("LearningLoop — verification write path is on the page", () => {
  it("mounts the named-human recorder so record_verification_result is reachable", async () => {
    render(<LearningLoop />);
    expect(await screen.findByText("Inspect coupling on C-22")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Record verification" }),
    ).toBeTruthy();
    expect(screen.getByText(/This is still a pilot/)).toBeTruthy();
  });
});
