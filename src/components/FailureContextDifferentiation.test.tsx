import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FailureContextDifferentiation } from "./FailureContextDifferentiation";
import {
  differentiateFailureContexts,
  listFailureContextAssets,
  listFailureContextBindings,
  recordFailureContextBinding,
} from "../services/failureContextRiskModelService";

vi.mock("../services/failureContextRiskModelService", () => ({
  listFailureContextAssets: vi.fn(),
  listFailureContextBindings: vi.fn(),
  recordFailureContextBinding: vi.fn(),
  differentiateFailureContexts: vi.fn(),
}));

const asset = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Export compressor",
  tag: "K-2101",
};

describe("FailureContextDifferentiation", () => {
  beforeEach(() => {
    vi.mocked(listFailureContextAssets).mockResolvedValue([asset]);
    vi.mocked(listFailureContextBindings).mockResolvedValue([]);
    vi.mocked(recordFailureContextBinding).mockReset();
    vi.mocked(differentiateFailureContexts).mockReset();
  });

  it("previews a compressor trip as a different model from a haul truck", async () => {
    vi.mocked(differentiateFailureContexts).mockReturnValue({
      differentiated: true,
      differentWorkflow: true,
      sharedEngines: [],
      distinctA: ["pfd_sil"],
      distinctB: ["censored_weibull"],
      reason:
        "Process trip and mobile plant get genuinely different treatment.",
    });
    render(<FailureContextDifferentiation />);
    expect(
      await screen.findByRole("option", { name: /Export compressor/ }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Asset"), {
      target: { value: asset.id },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Compressor trip versus haul truck" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Preview differentiation" }),
    );

    expect(differentiateFailureContexts).toHaveBeenCalledWith(
      "process_trip",
      "mobile_plant_failure",
    );
    expect(
      screen.getByText(/genuinely different treatment/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/does not approve work, accept risk/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Record failure-context binding" }),
    ).toBeDisabled();
  });

  it("records the human basis and leaves work and risk unauthorized", async () => {
    vi.mocked(differentiateFailureContexts).mockReturnValue({
      differentiated: true,
      differentWorkflow: true,
      sharedEngines: [],
      distinctA: ["pfd_sil"],
      distinctB: ["crow_amsaa"],
      reason: "A trip and a weld defect differ.",
    });
    vi.mocked(recordFailureContextBinding).mockResolvedValue({
      recorded: true,
      workAuthorized: false,
      riskAccepted: false,
    });
    const recorded = {
      id: "binding-1",
      asset_id: asset.id,
      context_key: "process_trip",
      comparison_context_key: "quality_loss",
      workflow: "safety_investigation",
      comparison_workflow: "quality_containment",
      engines: ["pfd_sil"],
      shared_engines: [],
      distinct_subject_engines: ["pfd_sil"],
      distinct_comparison_engines: ["crow_amsaa"],
      different_workflow: true,
      differentiation_reason: "A trip and a weld defect differ.",
      required_data: ["protective function register"],
      basis: "The trip is a protective demand, not a weld escape.",
      recorded_at: "2026-11-13T12:00:00.000Z",
      work_authorized: false as const,
      risk_accepted: false as const,
    };
    let reads = 0;
    vi.mocked(listFailureContextBindings).mockImplementation(async () => {
      reads += 1;
      return reads > 1 ? [recorded] : [];
    });

    render(<FailureContextDifferentiation />);
    expect(
      await screen.findByRole("option", { name: /Export compressor/ }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Asset"), {
      target: { value: asset.id },
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Compressor trip versus weld defect",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Preview differentiation" }),
    );
    fireEvent.change(screen.getByLabelText("Evidence basis"), {
      target: {
        value: "The trip is a protective demand, not a weld escape.",
      },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Record failure-context binding" }),
    );

    await waitFor(() => {
      expect(recordFailureContextBinding).toHaveBeenCalledWith({
        assetId: asset.id,
        contextKey: "process_trip",
        comparisonKey: "quality_loss",
        basis: "The trip is a protective demand, not a weld escape.",
      });
    });
    expect(await screen.findByText(/Work authorized: no/i)).toBeInTheDocument();
  });

  it("shows a refused binding and does not claim it was stored", async () => {
    vi.mocked(differentiateFailureContexts).mockReturnValue({
      differentiated: false,
      differentWorkflow: false,
      sharedEngines: [],
      distinctA: [],
      distinctB: [],
      reason: "Unknown context: nonsense.",
    });
    render(<FailureContextDifferentiation />);
    fireEvent.click(
      screen.getByRole("button", { name: "Preview differentiation" }),
    );
    expect(screen.getByText(/Unknown context/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Record failure-context binding" }),
    ).toBeDisabled();
    expect(recordFailureContextBinding).not.toHaveBeenCalled();
  });
});
