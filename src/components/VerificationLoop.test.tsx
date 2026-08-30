import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const recordVerificationResult = vi.fn();

vi.mock("../services/operatingLoopService", () => ({
  recordVerificationResult: (...args: unknown[]) =>
    recordVerificationResult(...args),
}));

vi.mock("../lib/supabase", () => ({
  supabase: {
    rpc: vi.fn((name: string) => {
      if (name === "get_verification_posture") {
        return Promise.resolve({
          data: [
            {
              actionedRecommendations: 2,
              withObligation: 2,
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
              obligationId: "obl-1",
              recommendationTitle: "Replace seal on P-101",
              assetName: "P-101",
              method: "Leak rate after 48h run",
              dueDate: "2026-09-15",
              dueDateAssumed: true,
              daysOverdue: 0,
              intendedOutcome: "Leak stopped",
            },
          ],
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: { message: "unknown rpc" } });
    }),
  },
}));

import { VerificationLoop } from "./VerificationLoop";

describe("VerificationLoop — named-human recorder", () => {
  beforeEach(() => {
    recordVerificationResult.mockReset();
  });

  it("renders the open obligation and the record form", async () => {
    render(<VerificationLoop />);
    expect(await screen.findByText("Replace seal on P-101")).toBeTruthy();
    expect(screen.getByText(/This is a pilot attestation/)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Record verification" }),
    ).toBeTruthy();
    expect(screen.getByLabelText("Achieved")).toBeTruthy();
    expect(screen.getByLabelText("Not achieved")).toBeTruthy();
    expect(screen.getByLabelText("Inconclusive")).toBeTruthy();
  });

  it("records not_achieved with the measured note through the service wrapper", async () => {
    recordVerificationResult.mockResolvedValue({
      outcome: "recorded",
      learningEventId: "le-1",
      detail:
        "Outcome NOT achieved — recorded honestly, and a learning event now carries it.",
    });
    render(<VerificationLoop />);
    await screen.findByText("Replace seal on P-101");

    fireEvent.click(screen.getByLabelText("Not achieved"));
    fireEvent.change(screen.getByPlaceholderText(/vibration at 4.1 mm\/s/i), {
      target: {
        value: "leak rate unchanged at 4 drops/min after seal change",
      },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Record verification" }),
    );

    await waitFor(() =>
      expect(recordVerificationResult).toHaveBeenCalledWith(
        "obl-1",
        "not_achieved",
        "leak rate unchanged at 4 drops/min after seal change",
      ),
    );
    expect(
      await screen.findByText(/Outcome NOT achieved — recorded honestly/),
    ).toBeTruthy();
  });

  it("surfaces a second-call refusal from the wrapper", async () => {
    recordVerificationResult.mockRejectedValue(
      new Error(
        "Obligation is already completed. A verification is recorded once; a second opinion belongs in a new observation, not an overwrite.",
      ),
    );
    render(<VerificationLoop />);
    await screen.findByText("Replace seal on P-101");

    fireEvent.change(screen.getByPlaceholderText(/vibration at 4.1 mm\/s/i), {
      target: { value: "looked again the next shift" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Record verification" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(/recorded once/);
  });

  it("does not submit an empty measured note", async () => {
    render(<VerificationLoop />);
    await screen.findByText("Replace seal on P-101");
    const submit = screen.getByRole("button", { name: "Record verification" });
    expect(submit).toBeDisabled();
    expect(recordVerificationResult).not.toHaveBeenCalled();
  });
});
