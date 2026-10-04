import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MaintenanceInducedFailureReview } from "./MaintenanceInducedFailureReview";

const load = vi.fn();
const review = vi.fn();

vi.mock("../services/maintenanceInducedFailureService", () => ({
  loadMaintenanceInducedWorkspace: (...args: unknown[]) => load(...args),
  reviewMaintenanceInducedFailure: (...args: unknown[]) => review(...args),
}));

const candidate = {
  failureWorkOrderId: "failure-1",
  failureWorkOrderNumber: "WO-FAIL-1",
  failureTitle: "Seal failed after maintenance",
  assetId: "asset-1",
  assetTag: "P-101",
  assetName: "Process pump",
  mechanismKey: "seal_damage",
  mechanismName: "Seal damage",
  failureRecordedAt: "2026-10-03T00:00:00Z",
  failureCompletedAt: "2026-10-03T04:00:00Z",
  precedingWorkOrderId: "maintenance-1",
  precedingWorkOrderNumber: "WO-PM-1",
  precedingTitle: "Seal inspection and reassembly",
  precedingWorkType: "preventive",
  precedingCompletedAt: "2026-10-01T00:00:00Z",
  observedGapHours: 48,
  fracasInvestigationPackId: "pack-1",
  readyForReview: true,
  currentReview: null,
};

const workspace = {
  available: true,
  exposureWindowHours: 168,
  candidateCount: 1,
  reviewedCount: 0,
  confirmedCount: 0,
  rejectedCount: 0,
  inconclusiveCount: 0,
  basis:
    "Temporal proximity is never causation; a named human classifies from verified evidence.",
  verifiedEvidence: [
    {
      id: "evidence-1",
      description: "Approved seven-day post-maintenance exposure basis",
      evidenceClass: "DOCUMENTED",
      assetId: null,
      verifiedAt: "2026-10-01T00:00:00Z",
      verifiedBy: "manager-1",
      independentlyVerified: true,
      verificationMethod: "engineering review",
    },
  ],
  candidates: [candidate],
};

beforeEach(() => {
  vi.clearAllMocks();
  load.mockResolvedValue(workspace);
  review.mockResolvedValue(undefined);
});

describe("MaintenanceInducedFailureReview", () => {
  it("labels temporal candidates honestly and exposes the retained FRACAS gate", async () => {
    render(<MaintenanceInducedFailureReview />);
    expect(
      await screen.findByText("Maintenance-induced failure review"),
    ).toBeVisible();
    expect(await screen.findByText("FRACAS retained")).toBeVisible();
    expect(screen.getAllByText(/time proximity/i).length).toBeGreaterThan(0);
    expect(
      screen.getByText(/no work, approval, risk, spending/i),
    ).toBeVisible();
  });

  it("requires verified support before enabling a confirmed classification", async () => {
    render(<MaintenanceInducedFailureReview />);
    await screen.findByText("Maintenance-induced failure review");
    fireEvent.change(screen.getByLabelText("Human verdict"), {
      target: { value: "confirmed" },
    });
    fireEvent.change(screen.getByLabelText("Review basis"), {
      target: {
        value:
          "Teardown evidence shows incorrect seal reassembly after the intervention.",
      },
    });
    expect(
      screen.getByRole("button", { name: "Record named-human review" }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByLabelText(
        "Approved seven-day post-maintenance exposure basis",
      ),
    );
    expect(
      screen.getByRole("button", { name: "Record named-human review" }),
    ).toBeEnabled();
  });

  it("submits the exact work pair, retained pack and canonical evidence", async () => {
    render(<MaintenanceInducedFailureReview />);
    await screen.findByText("Maintenance-induced failure review");
    fireEvent.change(screen.getByLabelText("Human verdict"), {
      target: { value: "confirmed" },
    });
    fireEvent.change(screen.getByLabelText("Maintenance-origin code"), {
      target: { value: "reassembly" },
    });
    fireEvent.click(
      screen.getByLabelText(
        "Approved seven-day post-maintenance exposure basis",
      ),
    );
    fireEvent.change(screen.getByLabelText("Review basis"), {
      target: {
        value:
          "Verified teardown evidence proves an incorrect reassembly sequence.",
      },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Record named-human review" }),
    );
    await waitFor(() =>
      expect(review).toHaveBeenCalledWith(
        expect.objectContaining({
          candidate,
          verdict: "confirmed",
          causeCode: "reassembly",
          exposureWindowHours: 168,
          windowBasisEvidenceItemId: "evidence-1",
          supportingEvidenceItemIds: ["evidence-1"],
        }),
      ),
    );
  });
});
