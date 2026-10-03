import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EthicalBoundariesPanel } from "./EthicalBoundariesPanel";

const getWorkspace = vi.fn();
const createReview = vi.fn();
const setDetermination = vi.fn();
const submitReview = vi.fn();
const reviewBoundaries = vi.fn();

vi.mock("../services/ethicalBoundaryService", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("../services/ethicalBoundaryService")
  >();
  return {
    ...original,
    getEthicalBoundaryWorkspace: (...args: unknown[]) => getWorkspace(...args),
    createEthicalBoundaryReview: (...args: unknown[]) => createReview(...args),
    setEthicalBoundaryDetermination: (...args: unknown[]) =>
      setDetermination(...args),
    submitEthicalBoundaryReview: (...args: unknown[]) => submitReview(...args),
    reviewEthicalBoundaries: (...args: unknown[]) => reviewBoundaries(...args),
  };
});

const definition = {
  key: "uncertainty_visibility",
  title: "Expose uncertainty",
  prohibition:
    "Do not hide material uncertainty, limitations, conflicts or applicability boundaries.",
  controlFamily: "decision_quality",
  verificationRequirement:
    "Verify material uncertainty and evidence gaps before human approval.",
  platformControlReference: "Canonical recommendation contract",
  version: 1,
};

function workspace(status: "draft" | "review_pending") {
  return {
    boundaries: [definition],
    people: [{ id: "owner-1", name: "Named Owner", role: "admin" }],
    verifiedEvidence: [
      {
        id: "evidence-1",
        description: "Independently verified control evidence",
        sourceSystem: "governance",
        evidenceType: "control_test",
        verifiedBy: "reviewer-1",
        verifiedAt: "2026-10-02T00:00:00Z",
        qualityGrade: "high",
        timestamp: "2026-10-01T00:00:00Z",
      },
    ],
    reviews: [
      {
        id: "review-1",
        title: "Annual ethical-boundary review",
        scope: "All production decisions and governed agent outputs.",
        purpose: "Prove the explicit prohibitions are controlled and reviewed.",
        effectiveOn: "2026-10-03",
        nextReviewOn: "2027-10-03",
        status,
        current: false,
        createdBy: "author-1",
        submittedBy: status === "review_pending" ? "author-1" : null,
        reviewedBy: null,
        reviewedAt: null,
        reviewNote: null,
        determinations: [],
      },
    ],
    basis:
      "The register proves reviewed controls and grants no automated authority.",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getWorkspace.mockResolvedValue(workspace("draft"));
  setDetermination.mockResolvedValue({ determinationId: "determination-1" });
  reviewBoundaries.mockResolvedValue({ status: "adopted" });
});

describe("EthicalBoundariesPanel", () => {
  it("captures the control, procedure, evidence and named owner in one governed action", async () => {
    render(<EthicalBoundariesPanel />);

    expect(await screen.findByText("Explicit ethical boundaries")).toBeInTheDocument();
    expect(screen.getByText("No current adopted posture")).toBeInTheDocument();
    await screen.findByText("Determined");
    fireEvent.click(screen.getByText("Expose uncertainty"));
    fireEvent.change(screen.getByLabelText("Implemented control"), {
      target: {
        value:
          "Every consequential output displays uncertainty and unresolved evidence gaps.",
      },
    });
    fireEvent.change(screen.getByLabelText("Verification procedure"), {
      target: {
        value:
          "Replay the governed output and confirm its evidence gaps remain visible to the approver.",
      },
    });
    fireEvent.change(screen.getByLabelText("Independently verified evidence"), {
      target: { value: "evidence-1" },
    });
    fireEvent.change(screen.getByLabelText("Accountable owner"), {
      target: { value: "owner-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save determination" }));

    await waitFor(() =>
      expect(setDetermination).toHaveBeenCalledWith({
        reviewId: "review-1",
        boundaryKey: "uncertainty_visibility",
        outcome: "enforced",
        controlDescription:
          "Every consequential output displays uncertainty and unresolved evidence gaps.",
        verificationProcedure:
          "Replay the governed output and confirm its evidence gaps remain visible to the approver.",
        evidenceItemId: "evidence-1",
        accountableOwnerId: "owner-1",
        remediation: "",
      }),
    );
  });

  it("makes final disposition an explicit independent human action", async () => {
    getWorkspace.mockResolvedValue(workspace("review_pending"));
    render(<EthicalBoundariesPanel />);

    expect(await screen.findByText("Independent disposition")).toBeInTheDocument();
    fireEvent.change(
      screen.getByPlaceholderText(
        "Record the independent review basis and material limitations.",
      ),
      {
        target: {
          value:
            "Independent review confirmed the evidence, owners and control procedures.",
        },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Adopt" }));

    await waitFor(() =>
      expect(reviewBoundaries).toHaveBeenCalledWith({
        reviewId: "review-1",
        decision: "approved",
        reviewNote:
          "Independent review confirmed the evidence, owners and control procedures.",
      }),
    );
  });
});
