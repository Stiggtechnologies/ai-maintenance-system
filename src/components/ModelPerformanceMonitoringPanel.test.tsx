import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ModelPerformanceMonitoringPanel,
} from "./ModelPerformanceMonitoringPanel";
import { parseMonitoringDistribution } from "../lib/model-monitoring";

const getWorkspace = vi.fn();
const runAssessment = vi.fn();
const captureSnapshot = vi.fn();
const reviewAssessment = vi.fn();
const recordOutcome = vi.fn();

vi.mock("./AuthProvider", () => ({
  useAuth: () => ({ profile: { role: "reliability_engineer" } }),
}));
vi.mock("../services/modelMonitoringService", () => ({
  getModelMonitoringWorkspace: (...args: unknown[]) => getWorkspace(...args),
  runModelPerformanceAssessment: (...args: unknown[]) =>
    runAssessment(...args),
  captureModelInputSnapshot: (...args: unknown[]) => captureSnapshot(...args),
  reviewModelPerformanceAssessment: (...args: unknown[]) =>
    reviewAssessment(...args),
}));
vi.mock("../services/engineeringModelService", () => ({
  recordEngineeringModelFieldOutcome: (...args: unknown[]) =>
    recordOutcome(...args),
}));

const workspace = {
  boundary:
    "Drift and cohort gaps are screening alerts; a different named human controls model disposition.",
  models: [
    {
      id: 7,
      modelKey: "pump.failure.screen",
      version: "2.0.0",
      name: "Pump failure screen",
      lifecycleState: "production_eligible",
      productionEligible: true,
    },
  ],
  snapshots: [
    {
      id: 10,
      modelRegisterId: 7,
      feature: "operating_regime",
      label: "Reference",
      windowStart: "2026-01-01",
      windowEnd: "2026-03-31",
      distribution: { steady: 80, cycling: 20 },
      reference: true,
      checksum: "a",
      evidenceItemId: "e1",
      capturedBy: "u1",
      capturedAt: "2026-04-01T00:00:00Z",
    },
    {
      id: 11,
      modelRegisterId: 7,
      feature: "operating_regime",
      label: "Current",
      windowStart: "2026-04-01",
      windowEnd: "2026-06-30",
      distribution: { steady: 50, cycling: 50 },
      reference: false,
      checksum: "b",
      evidenceItemId: "e1",
      capturedBy: "u1",
      capturedAt: "2026-07-01T00:00:00Z",
    },
  ],
  assessments: [],
  openOutcomes: [
    {
      calculationRunId: "run-1",
      modelRegisterId: 7,
      modelKey: "pump.failure.screen",
      modelVersion: "2.0.0",
      assetId: "asset-1",
      computedAt: "2026-06-01T00:00:00Z",
      predictedProbability: 0.4,
      horizonDays: 30,
    },
  ],
  evidence: [
    {
      id: "e1",
      description: "Verified monitoring extract",
      sourceSystem: "historian",
      qualityGrade: "high",
    },
  ],
};

describe("ModelPerformanceMonitoringPanel", () => {
  beforeEach(() => {
    getWorkspace.mockReset().mockResolvedValue(workspace);
    runAssessment.mockReset().mockResolvedValue({ assessmentId: "a1" });
    captureSnapshot.mockReset().mockResolvedValue({ snapshotId: 12 });
    reviewAssessment.mockReset().mockResolvedValue({ reviewId: "r1" });
    recordOutcome.mockReset().mockResolvedValue({ model_prediction_id: 4 });
  });

  it("parses explicit bucket counts and refuses ambiguous input", () => {
    expect(parseMonitoringDistribution("steady=8\ncycling:2")).toEqual({
      steady: 8,
      cycling: 2,
    });
    expect(() => parseMonitoringDistribution("not a distribution")).toThrow(
      /bucket=count/,
    );
    expect(() => parseMonitoringDistribution("steady=8")).toThrow(
      /at least two/,
    );
  });

  it("recomputes a live PSI preview and records only through the governed RPC", async () => {
    render(<ModelPerformanceMonitoringPanel />);
    await screen.findByText("Model performance & drift");

    fireEvent.change(screen.getByLabelText("Assessment model version"), {
      target: { value: "7" },
    });
    fireEvent.change(screen.getByLabelText("Reference snapshot"), {
      target: { value: "10" },
    });
    fireEvent.change(screen.getByLabelText("Current snapshot"), {
      target: { value: "11" },
    });
    expect(await screen.findByText(/Preview PSI/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Assessment basis"), {
      target: {
        value:
          "The same operating-state taxonomy and verified extraction method cover both periods.",
      },
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Assess drift, calibration & cohort gaps",
      }),
    );
    expect(runAssessment).toHaveBeenCalledWith({
      modelRegisterId: 7,
      referenceSnapshotId: 10,
      currentSnapshotId: 11,
      assessmentBasis:
        "The same operating-state taxonomy and verified extraction method cover both periods.",
    });
  });

  it("makes canonical field-outcome capture customer reachable", async () => {
    render(<ModelPerformanceMonitoringPanel />);
    await screen.findByText("Model performance & drift");
    fireEvent.change(screen.getByLabelText("Calculation awaiting field outcome"), {
      target: { value: "run-1" },
    });
    fireEvent.change(screen.getByLabelText("Observed evidence basis"), {
      target: { value: "Verified work history" },
    });
    fireEvent.change(screen.getByLabelText("Prediction assessment"), {
      target: { value: "The event did not occur" },
    });
    fireEvent.change(screen.getByLabelText("Design / strategy feedback"), {
      target: { value: "Retain and monitor" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Record governed outcome" }),
    );
    expect(recordOutcome).toHaveBeenCalledWith({
      calculationRunId: "run-1",
      outcome: false,
      counterfactualReview: {
        observedBasis: "Verified work history",
        predictionAssessment: "The event did not occur",
        designFeedback: "Retain and monitor",
      },
    });
  });
});
