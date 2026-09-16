import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectAssurancePanel } from "./ProjectAssurancePanel";

const runAssurance = vi.fn();
const getWorkspace = vi.fn();
const recordOutcome = vi.fn();
vi.mock("../services/projectAssuranceService", () => ({
  runProjectAssurance: (...args: unknown[]) => runAssurance(...args),
  getProjectAssuranceWorkspace: (...args: unknown[]) => getWorkspace(...args),
  recordVerifiedProjectOutcome: (...args: unknown[]) => recordOutcome(...args),
}));

function fillAndRun() {
  fireEvent.change(screen.getByLabelText("Active project"), {
    target: { value: "case-1" },
  });
  fireEvent.change(screen.getByLabelText("Current cost forecast"), {
    target: { value: "2000000" },
  });
  fireEvent.change(screen.getAllByLabelText("Original cost baseline")[0], {
    target: { value: "1800000" },
  });
  fireEvent.change(screen.getByLabelText("Original duration (days)"), {
    target: { value: "180" },
  });
  fireEvent.change(screen.getByLabelText("Current duration forecast (days)"), {
    target: { value: "200" },
  });
  fireEvent.change(screen.getAllByLabelText("Complexity (1–5)")[0], {
    target: { value: "3" },
  });
  fireEvent.change(screen.getAllByLabelText("Geography / region")[0], {
    target: { value: "Alberta" },
  });
  fireEvent.change(screen.getAllByLabelText("Technology novelty (1–5)")[0], {
    target: { value: "2" },
  });
  fireEvent.change(screen.getAllByLabelText("Execution strategy")[0], {
    target: { value: "EPCM" },
  });
  fireEvent.change(screen.getByLabelText("Verified forecast evidence"), {
    target: { value: "evidence-1" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Run governed comparison" }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getWorkspace.mockResolvedValue({
    cases: [
      {
        id: "case-1",
        title: "Active project",
        status: "active",
        lifecycleType: "greenfield",
        outcomeRecorded: false,
      },
    ],
    verifiedEvidence: [
      {
        id: "evidence-1",
        description: "Verified forecast basis",
        verifiedAt: "2026-01-01",
      },
    ],
    minimumSample: 5,
    decisionBoundary: "Named humans retain every decision.",
  });
});

describe("ProjectAssurancePanel", () => {
  it("shows the advisory boundary and an explicit thin-history refusal", async () => {
    runAssurance.mockResolvedValue({
      calculationRunId: "run-refused",
      status: "refused",
      sampleSize: 2,
      minimumSample: 5,
      refusals: [
        "Only 2 comparable completed projects exist; at least 5 are required. No pattern, reference-class forecast or benchmark is claimed.",
      ],
      operationalAuthorization: false,
    });
    render(<ProjectAssurancePanel />);
    expect(screen.getByText("Advisory—not authorization")).toBeInTheDocument();
    await screen.findByRole("option", { name: /Active project/ });
    fillAndRun();
    expect(
      await screen.findByText("Insufficient project history"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/No pattern, reference-class forecast or benchmark/),
    ).toBeInTheDocument();
  });

  it("renders reference forecasts, normalization and evidence-backed patterns", async () => {
    runAssurance.mockResolvedValue({
      calculationRunId: "run-1",
      status: "computed",
      sampleSize: 8,
      minimumSample: 5,
      refusals: [],
      referenceForecast: {
        teamCostGrowthPct: 11.1,
        teamDurationGrowthPct: 11.1,
        costP50: 2200000,
        costP80: 2600000,
        durationDaysP50: 215,
        durationDaysP80: 250,
      },
      normalizedBenchmark: {
        teamForecastCostPercentile: 37.5,
        teamForecastDurationPercentile: 25,
        medianStartupDelayDays: 8,
        medianCommissioningDefects: 4,
        medianSafetyIncidentRate: 0.2,
        medianStartupReliabilityPct: 95,
        medianEngineeringHoursPerMillionBaseline: 12000,
        normalization: "six dimensions",
      },
      assurancePatterns: [
        {
          signal: "engineering_maturity_at_execution",
          lowerMaturityMeanScheduleGrowthPct: 24,
          lowerMaturitySample: 5,
          higherMaturityMeanScheduleGrowthPct: 4,
          higherMaturitySample: 5,
          associationNotCausation: true,
        },
      ],
      recommendationOnly: true,
      operationalAuthorization: false,
      method:
        "Same-tenant completed projects normalized to original baselines.",
    });
    render(<ProjectAssurancePanel />);
    await screen.findByRole("option", { name: /Active project/ });
    fillAndRun();
    expect(
      await screen.findByText("Reference-class forecast"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Reference cost P50 2,200,000 · P80 2,600,000/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Team cost forecast percentile 37.5/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Below 80% engineering maturity: 24% mean schedule growth/,
      ),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(runAssurance).toHaveBeenCalledWith({
        caseId: "case-1",
        evidenceItemId: "evidence-1",
        forecastCost: 2000000,
        forecastDurationDays: 200,
        currency: "CAD",
        baselineCost: 1800000,
        baselineDurationDays: 180,
        complexityRating: 3,
        geography: "Alberta",
        technologyNoveltyRating: 2,
        executionStrategy: "EPCM",
      }),
    );
  });
});
