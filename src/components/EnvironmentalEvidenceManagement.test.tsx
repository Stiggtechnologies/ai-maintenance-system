import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EnvironmentalEvidenceManagement } from "./EnvironmentalEvidenceManagement";

const getWorkspace = vi.fn();
const recordEvidence = vi.fn();

vi.mock("../services/environmentalEvidenceService", () => ({
  getEnvironmentalEvidenceWorkspace: (...args: unknown[]) =>
    getWorkspace(...args),
  recordEnvironmentalEvidence: (...args: unknown[]) => recordEvidence(...args),
}));

const workspace = {
  canRecord: true,
  requiredAal: "aal2" as const,
  assets: [{ id: "asset-1", name: "Process pump P-101", assetClass: "pump" }],
  sites: [{ id: "site-1", name: "North plant" }],
  verifiedEvidence: [
    {
      id: "evidence-1",
      description: "Verified seal-loss field sheet",
      sourceSystem: "EHS",
      assetId: "asset-1",
      verifiedBy: "reviewer-1",
      verifiedAt: "2026-09-01T00:00:00Z",
    },
  ],
  emissionFactors: [],
  baselines: [
    {
      id: 7,
      assetId: "asset-1",
      assetName: "Process pump P-101",
      metric: "specific energy",
      unit: "kWh/m3",
      designValue: 1.2,
      establishedOn: "2026-01-01",
      interventionCost: null,
      energyCostPerDay: null,
      evidenceItemId: "evidence-1",
      basis: "Verified clean-condition test.",
      sourceReference: "TEST-1",
      version: 1,
    },
  ],
  hazardousInventory: [],
  decisionBoundary: "Evidence only; no compliance or work authority.",
};

beforeEach(() => {
  vi.clearAllMocks();
  getWorkspace.mockResolvedValue(workspace);
  recordEvidence.mockResolvedValue({
    id: 1,
    kind: "environmental_activity",
    status: "recorded",
    complianceCertified: false,
    reportableInventory: false,
    workAuthorized: false,
    riskAccepted: false,
    returnToServiceAuthorized: false,
  });
});

describe("EnvironmentalEvidenceManagement", () => {
  it("shows all governed record types and an explicit no-authority boundary", async () => {
    render(<EnvironmentalEvidenceManagement />);
    expect(
      await screen.findByText("Governed environmental evidence"),
    ).toBeInTheDocument();
    const choices = screen
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(choices).toEqual(
      expect.arrayContaining([
        "Efficiency baseline",
        "Efficiency reading",
        "Environmental activity or loss",
        "Emission factor",
        "Hazardous material or battery",
      ]),
    );
    expect(screen.getByText(/no compliance or work authority/i)).toBeVisible();
  });

  it("records a sourced loss and checks the no-authority receipt", async () => {
    render(<EnvironmentalEvidenceManagement />);
    await screen.findByText("Governed environmental evidence");
    fireEvent.change(screen.getByLabelText("Evidence record type"), {
      target: { value: "environmental_activity" },
    });
    fireEvent.change(screen.getByLabelText("Activity type"), {
      target: { value: "lubricant_loss" },
    });
    fireEvent.change(screen.getByLabelText("Asset (optional)"), {
      target: { value: "asset-1" },
    });
    fireEvent.change(screen.getByLabelText("Period start"), {
      target: { value: "2026-09-01" },
    });
    fireEvent.change(screen.getByLabelText("Period end"), {
      target: { value: "2026-09-01" },
    });
    fireEvent.change(screen.getByLabelText("Quantity"), {
      target: { value: "18" },
    });
    fireEvent.change(screen.getByLabelText("Unit"), {
      target: { value: "L" },
    });
    fireEvent.change(screen.getByLabelText("Substance or product"), {
      target: { value: "ISO VG 46 hydraulic oil" },
    });
    fireEvent.change(screen.getByLabelText("Evidence basis"), {
      target: {
        value:
          "Measured recovered volume and reservoir top-up after the seal leak.",
      },
    });
    fireEvent.change(screen.getByLabelText("Source reference"), {
      target: { value: "INC-2026-0091" },
    });
    fireEvent.change(screen.getByLabelText("Verified evidence"), {
      target: { value: "evidence-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Record evidence" }));

    await waitFor(() =>
      expect(recordEvidence).toHaveBeenCalledWith(
        "environmental_activity",
        expect.objectContaining({
          activityKind: "lubricant_loss",
          assetId: "asset-1",
          quantity: 18,
          unit: "L",
          substance: "ISO VG 46 hydraulic oil",
          evidenceItemId: "evidence-1",
        }),
      ),
    );
    expect(
      await screen.findByText(/no compliance, reporting, work, risk/i),
    ).toBeVisible();
  });

  it("does not expose the writer when the server says the session cannot record", async () => {
    getWorkspace.mockResolvedValue({ ...workspace, canRecord: false });
    render(<EnvironmentalEvidenceManagement />);
    expect(
      await screen.findByText(/AAL2 named-human session is required/i),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Record evidence" }),
    ).not.toBeInTheDocument();
  });
});
