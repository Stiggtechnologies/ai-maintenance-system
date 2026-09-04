import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const recordVerificationResult = vi.fn();
const getOpenVerifications = vi.fn();
const getOpenObligationIdForRecommendation = vi.fn();

vi.mock("../../services/operatingLoopService", () => ({
  recordVerificationResult: (...args: unknown[]) =>
    recordVerificationResult(...args),
  getOpenVerifications: (...args: unknown[]) => getOpenVerifications(...args),
  getOpenObligationIdForRecommendation: (...args: unknown[]) =>
    getOpenObligationIdForRecommendation(...args),
}));

import { ConversationLearn } from "./ConversationLearn";

const openRec = {
  obligationId: "obl-1",
  recommendationTitle: "Replace seal on P-101",
  assetName: "P-101",
  method: "Leak rate after 48h run",
  dueDate: "2026-09-15",
  dueDateAssumed: true,
  daysOverdue: 0,
  intendedOutcome: "Leak stopped",
  subjectKind: "recommendation" as const,
};

function renderLearn(
  props: {
    signedIn?: boolean;
    recommendationId?: string | null;
    simulatedApproval?: boolean;
  } = {},
) {
  return render(
    <MemoryRouter>
      <ConversationLearn
        signedIn
        simulatedApproval
        {...props}
      />
    </MemoryRouter>,
  );
}

describe("ConversationLearn", () => {
  beforeEach(() => {
    recordVerificationResult.mockReset();
    getOpenVerifications.mockReset();
    getOpenObligationIdForRecommendation.mockReset();
  });

  it("stays a pointer when the session is anonymous — no RPC", () => {
    renderLearn({ signedIn: false });
    expect(screen.getByTestId("learn-unpersisted")).toBeTruthy();
    expect(screen.getByText(/nothing was written/i)).toBeTruthy();
    expect(getOpenVerifications).not.toHaveBeenCalled();
    expect(recordVerificationResult).not.toHaveBeenCalled();
  });

  it("stays a pointer when signed in but no recommendation-scoped obligation exists", async () => {
    getOpenVerifications.mockResolvedValue([
      { ...openRec, obligationId: "obl-req", subjectKind: "requirement" },
    ]);
    renderLearn();
    expect(await screen.findByTestId("learn-unpersisted")).toBeTruthy();
    expect(screen.queryByTestId("learn-recorder")).toBeNull();
    expect(recordVerificationResult).not.toHaveBeenCalled();
  });

  it("fails visibly when open verifications cannot be loaded", async () => {
    getOpenVerifications.mockRejectedValue(
      new Error("Could not load open verifications: not in your organization"),
    );
    renderLearn();
    expect(await screen.findByTestId("learn-load-error")).toBeTruthy();
    expect(screen.getByRole("alert")).toHaveTextContent(
      /not in your organization/,
    );
    expect(screen.getByText(/Nothing was written/)).toBeTruthy();
    expect(screen.queryByTestId("learn-recorder")).toBeNull();
    expect(recordVerificationResult).not.toHaveBeenCalled();
  });

  it("fails visibly when a bound recommendation has no open obligation", async () => {
    getOpenVerifications.mockResolvedValue([openRec]);
    getOpenObligationIdForRecommendation.mockResolvedValue(null);
    renderLearn({ recommendationId: "rec-missing", simulatedApproval: false });
    expect(await screen.findByTestId("learn-no-obligation")).toBeTruthy();
    expect(screen.getByRole("alert")).toHaveTextContent(
      /No open verification obligation/,
    );
    expect(screen.queryByTestId("learn-recorder")).toBeNull();
    expect(recordVerificationResult).not.toHaveBeenCalled();
  });

  it("records through recordVerificationResult for a bound open obligation", async () => {
    getOpenVerifications.mockResolvedValue([openRec]);
    getOpenObligationIdForRecommendation.mockResolvedValue("obl-1");
    recordVerificationResult.mockResolvedValue({
      outcome: "recorded",
      learningEventId: null,
      detail:
        "Outcome verified as achieved, with the measurement on record. This loop is closed.",
    });
    renderLearn({ recommendationId: "rec-1", simulatedApproval: false });
    expect(await screen.findByTestId("learn-recorder")).toBeTruthy();
    expect(screen.queryByText(/simulated approval did not create/i)).toBeNull();
    fireEvent.click(screen.getByLabelText("Achieved"));
    fireEvent.change(screen.getByPlaceholderText(/what was measured/i), {
      target: { value: "leak rate 0 drops/min vs 2 after 48h, 2026-09-04" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Record outcome" }));
    await waitFor(() =>
      expect(recordVerificationResult).toHaveBeenCalledWith(
        "obl-1",
        "achieved",
        "leak rate 0 drops/min vs 2 after 48h, 2026-09-04",
      ),
    );
    expect(await screen.findByTestId("learn-recorded")).toHaveTextContent(
      /This loop is closed/,
    );
  });

  it("surfaces an in-band RPC refusal and does not claim success", async () => {
    getOpenVerifications.mockResolvedValue([openRec]);
    getOpenObligationIdForRecommendation.mockResolvedValue("obl-1");
    recordVerificationResult.mockRejectedValue(
      new Error(
        "Obligation is already completed. A verification is recorded once; a second opinion belongs in a new observation, not an overwrite.",
      ),
    );
    renderLearn({ recommendationId: "rec-1", simulatedApproval: false });
    await screen.findByTestId("learn-recorder");
    fireEvent.click(screen.getByLabelText("Inconclusive"));
    fireEvent.change(screen.getByPlaceholderText(/what was measured/i), {
      target: { value: "looked again the next shift" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Record outcome" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/recorded once/);
    expect(screen.queryByTestId("learn-recorded")).toBeNull();
  });

  it("does not write until a named human picks among multiple open obligations", async () => {
    getOpenVerifications.mockResolvedValue([
      openRec,
      { ...openRec, obligationId: "obl-2", recommendationTitle: "Inspect coupling" },
    ]);
    renderLearn();
    expect(await screen.findByTestId("learn-select-needed")).toBeTruthy();
    expect(screen.getByText(/simulated approval did not create/i)).toBeTruthy();
    expect(screen.queryByTestId("learn-recorder")).toBeNull();
    fireEvent.change(screen.getByTestId("learn-obligation-select"), {
      target: { value: "obl-2" },
    });
    expect(await screen.findByTestId("learn-recorder")).toBeTruthy();
    expect(recordVerificationResult).not.toHaveBeenCalled();
  });
});
