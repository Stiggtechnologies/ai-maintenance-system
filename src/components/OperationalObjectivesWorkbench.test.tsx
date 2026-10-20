import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OperationalObjectivesWorkbench } from "./OperationalObjectivesWorkbench";
import * as service from "../services/operationalObjectivesService";

vi.mock("../services/operationalObjectivesService", async () => {
  const actual = await vi.importActual<
    typeof import("../services/operationalObjectivesService")
  >("../services/operationalObjectivesService");
  return {
    ...actual,
    loadOperationalObjectiveWorkspace: vi.fn(),
    proposeOperationalRamObjective: vi.fn(),
    reviewOperationalRamObjective: vi.fn(),
  };
});

const workspace: service.OperationalObjectiveWorkspace = {
  requirements: [
    {
      id: 42,
      reference: "OPS-RAM-001",
      requirement: "Cooling water service remains available for production.",
      category: "availability",
      projectId: 7,
      assetId: "asset-1",
      assetName: "Cooling water pump P-1",
      ownerId: "user-1",
      acceptanceCriteria: "Availability is at least 99.5% over a rolling year.",
      verificationMethod: "operational_validation",
      objectiveId: "objective-1",
      objectiveDescription: "Protect cooling-water service through asset life.",
      objectiveTarget: ">=99.5% annual availability",
      objectiveMeasurement: "Verified operating hours divided by planned hours",
      objectiveTimeframe: "Five-year lifecycle horizon",
      objectiveTolerance: "No rolling year below 99.0%",
      operatingKpiKey: "availability",
      operatingKpiName: "Availability",
      eligible: true,
      gaps: [],
    },
  ],
  lifecyclePlans: [
    {
      id: "life-1",
      assetId: "asset-1",
      assetName: "Cooling water pump P-1",
      version: 2,
      horizonYears: 5,
      objective:
        "Retain reliable cooling-water duty through the next overhaul cycle.",
      adoptedAt: "2026-10-05T00:00:00Z",
    },
  ],
  verifiedEvidence: [
    {
      id: "evidence-1",
      assetId: "asset-1",
      description: "Verified fleet duty and failure-history basis.",
      evidenceClass: "HISTORICAL",
      verifiedAt: "2026-10-05T00:00:00Z",
    },
  ],
  translations: [
    {
      id: 99,
      requirementId: 42,
      requirementRef: "OPS-RAM-001",
      assetName: "Cooling water pump P-1",
      systemLabel: "Cooling water train A",
      status: "proposed",
      revision: 1,
      objectiveTarget: ">=99.5% annual availability",
      operatingKpiKey: "availability",
      lifecycleObjective:
        "Retain reliable cooling-water duty through the next overhaul cycle.",
      lifecycleHorizonYears: 5,
      availabilityTarget: 0.995,
      reliabilityTarget: 8760,
      reliabilityUnit: "operating hours between service failures",
      maintainabilityTarget: 8,
      maintainabilityUnit: "hours",
      maintainabilityMeasure: "mean time to restore service",
      basis: "Verified operating history and approved lifecycle strategy.",
      proposedBy: "user-1",
      proposedAt: "2026-10-05T00:00:00Z",
      reviewedBy: null,
      reviewedAt: null,
      reviewNote: null,
    },
  ],
  authority: {
    namedHumanProposal: true,
    independentReview: true,
    mayChangeWork: false,
    mayApprove: false,
    mayAcceptRisk: false,
    mayCommitSpend: false,
    mayChangeOperatingLimits: false,
    mayReturnToService: false,
  },
};

describe("OperationalObjectivesWorkbench", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(service.loadOperationalObjectiveWorkspace).mockResolvedValue(
      workspace,
    );
  });

  it("shows the exact requirement, objective, KPI, lifecycle and pending review", async () => {
    render(<OperationalObjectivesWorkbench />);
    expect(
      await screen.findByText(/Operational requirement → RAM → lifecycle/i),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/OPS-RAM-001/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Availability/).length).toBeGreaterThan(0);
    expect(
      (await screen.findAllByText(/Retain reliable cooling-water duty/i))
        .length,
    ).toBeGreaterThan(0);
    expect(screen.getByText(/Pending independent review/i)).toBeInTheDocument();
  });

  it("does not supply engineering target defaults", async () => {
    render(<OperationalObjectivesWorkbench />);
    await screen.findByText(/Operational requirement → RAM → lifecycle/i);
    expect(screen.getByLabelText("Availability target (fraction)")).toHaveValue(
      null,
    );
    expect(screen.getByLabelText("Reliability target")).toHaveValue(null);
    expect(screen.getByLabelText("Maintainability target")).toHaveValue(null);
  });

  it("sends named-human inputs through the governed proposal RPC", async () => {
    vi.mocked(service.proposeOperationalRamObjective).mockResolvedValue({
      ramTargetId: 100,
      status: "proposed",
      revision: 2,
    });
    render(<OperationalObjectivesWorkbench />);
    await screen.findByText(/Operational requirement → RAM → lifecycle/i);

    fireEvent.change(screen.getByLabelText("System or service boundary"), {
      target: { value: "Cooling water train A" },
    });
    fireEvent.change(screen.getByLabelText("Availability target (fraction)"), {
      target: { value: "0.995" },
    });
    fireEvent.change(screen.getByLabelText("Reliability target"), {
      target: { value: "8760" },
    });
    fireEvent.change(screen.getByLabelText("Reliability unit"), {
      target: { value: "operating hours between service failures" },
    });
    fireEvent.change(screen.getByLabelText("Maintainability target"), {
      target: { value: "8" },
    });
    fireEvent.change(screen.getByLabelText("Maintainability unit"), {
      target: { value: "hours" },
    });
    fireEvent.change(screen.getByLabelText("Maintainability measure"), {
      target: { value: "mean time to restore service" },
    });
    fireEvent.change(
      screen.getByLabelText("Evidence-backed conversion basis"),
      {
        target: {
          value:
            "Verified operating history and the independently adopted lifecycle plan support these targets.",
        },
      },
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Propose conversion/i }),
    );

    await waitFor(() =>
      expect(service.proposeOperationalRamObjective).toHaveBeenCalledWith(
        expect.objectContaining({
          requirementId: 42,
          lifecyclePlanId: "life-1",
          evidenceItemId: "evidence-1",
          availabilityTarget: 0.995,
          reliabilityTarget: 8760,
          maintainabilityTarget: 8,
        }),
      ),
    );
  });

  it("routes verification through the independent-review RPC", async () => {
    vi.mocked(service.reviewOperationalRamObjective).mockResolvedValue({
      ramTargetId: 99,
      status: "verified",
    });
    render(<OperationalObjectivesWorkbench />);
    await screen.findByText(/Pending independent review/i);
    fireEvent.change(screen.getByLabelText("Independent review note"), {
      target: {
        value:
          "Independent review confirms the requirement, evidence, targets and lifecycle objective.",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Verify$/i }));
    await waitFor(() =>
      expect(service.reviewOperationalRamObjective).toHaveBeenCalledWith({
        ramTargetId: 99,
        decision: "verified",
        reviewNote:
          "Independent review confirms the requirement, evidence, targets and lifecycle objective.",
      }),
    );
  });
});
