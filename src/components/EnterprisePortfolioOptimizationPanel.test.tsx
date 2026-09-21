import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EnterprisePortfolioOptimizationPanel } from "./EnterprisePortfolioOptimizationPanel";

const getWorkspace = vi.fn();
const runOptimization = vi.fn();
const proposePlan = vi.fn();
const getFrontier = vi.fn();
const runFrontier = vi.fn();
const proposeFrontier = vi.fn();

vi.mock("../services/enterprisePortfolioOptimizationService", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("../services/enterprisePortfolioOptimizationService")
  >();
  return {
    ...original,
    getEnterprisePortfolioWorkspace: (...args: unknown[]) => getWorkspace(...args),
    getEnterprisePortfolioFrontier: (...args: unknown[]) => getFrontier(...args),
    runEnterprisePortfolioOptimization: (...args: unknown[]) => runOptimization(...args),
    runEnterprisePortfolioFrontier: (...args: unknown[]) => runFrontier(...args),
    proposeEnterprisePortfolioPlan: (...args: unknown[]) => proposePlan(...args),
    proposeEnterprisePortfolioFrontier: (...args: unknown[]) => proposeFrontier(...args),
    configurePortfolioCandidate: vi.fn(),
    configurePortfolioCandidateDimensions: vi.fn(),
  };
});

const run = {
  calculationRunId: "run-1",
  planYear: 2026,
  currency: "CAD",
  budget: 1_000_000,
  selected: [
    {
      caseId: "case-1",
      title: "Critical reliability renewal",
      category: "reliability",
      cost: 600_000,
      riskAdjustedValue: 900_000,
      mandatory: false,
      evidenceItemId: "evidence-1",
      earliestStart: "2026-01-01",
      latestStart: "2026-06-01",
      durationMonths: 4,
    },
  ],
  deferred: [
    {
      caseId: "case-2",
      title: "Capacity expansion",
      category: "capacity",
      reason: "Deferred because the remaining budget is insufficient.",
    },
  ],
  selectedCount: 1,
  candidateCount: 2,
  cost: { low: 550_000, base: 600_000, high: 700_000 },
  riskAdjustedValue: { low: 700_000, base: 900_000, high: 1_100_000 },
  remainingBudget: 400_000,
  globallyOptimal: false,
  operationalAuthorization: false,
  method: "Mandatory-first, then descending risk-adjusted value per cost.",
  refusals: [],
} as const;

const frontier = {
  calculationRunId: "frontier-run-1",
  planYear: 2026,
  currency: "CAD",
  budget: 1_000_000,
  candidateCount: 3,
  feasiblePortfolioCount: 3,
  frontierCount: 2,
  dimensions: [
    "regulatory_necessity", "safety_risk", "production_benefit", "reliability", "npv",
    "asset_life", "sustainability", "resource_demand", "execution_risk",
  ],
  globallyOptimal: false,
  frontierExhaustive: false,
  operationalAuthorization: false,
  method: "Generate objective-led feasible portfolios and remove dominated alternatives.",
  refusals: [],
  frontier: [
    {
      portfolioId: "pf-safety",
      objective: "safety_risk",
      selectedCount: 1,
      selected: [{ caseId: "case-1", title: "Safety renewal", category: "safety_risk", cost: 600_000, mandatory: false, evidenceItemId: "evidence-1", dimensions: {} }],
      deferred: [],
      cost: { low: 550_000, base: 600_000, high: 700_000 },
      riskAdjustedValue: { low: 700_000, base: 900_000, high: 1_100_000 },
      dimensions: { regulatoryNecessity: 80, safetyRisk: 95, productionBenefit: 20, reliability: 50, npv: 40, assetLife: 55, sustainability: 30, resourceDemand: 70, executionRisk: 20 },
    },
    {
      portfolioId: "pf-production",
      objective: "production_benefit",
      selectedCount: 1,
      selected: [{ caseId: "case-2", title: "Capacity renewal", category: "capacity", cost: 650_000, mandatory: false, evidenceItemId: "evidence-2", dimensions: {} }],
      deferred: [],
      cost: { low: 600_000, base: 650_000, high: 725_000 },
      riskAdjustedValue: { low: 800_000, base: 950_000, high: 1_200_000 },
      dimensions: { regulatoryNecessity: 20, safetyRisk: 30, productionBenefit: 98, reliability: 55, npv: 90, assetLife: 40, sustainability: 45, resourceDemand: 30, executionRisk: 75 },
    },
  ],
} as const;

beforeEach(() => {
  vi.clearAllMocks();
  getWorkspace.mockResolvedValue({
    planYear: 2026,
    categories: ["reliability", "capacity"],
    candidates: [],
    latestRun: null,
    decisionBoundary:
      "Funding, sanction, risk acceptance and operational authorization remain named-human decisions.",
  });
  getFrontier.mockResolvedValue(null);
  runOptimization.mockResolvedValue(run);
  runFrontier.mockResolvedValue(frontier);
  proposePlan.mockResolvedValue({
    recommendationId: "recommendation-1",
    approvalId: "approval-1",
    status: "pending_human_review",
    fundsCommitted: false,
    projectsSanctioned: false,
  });
  proposeFrontier.mockResolvedValue({
    recommendationId: "recommendation-frontier-1",
    approvalId: "approval-frontier-1",
    portfolioId: "pf-production",
    status: "pending_human_review",
    fundsCommitted: false,
    projectsSanctioned: false,
  });
});

describe("EnterprisePortfolioOptimizationPanel", () => {
  it("shows the decision boundary before any calculation", async () => {
    render(<EnterprisePortfolioOptimizationPanel />);

    expect(await screen.findByText("Enterprise portfolio optimization")).toBeInTheDocument();
    expect(screen.getByText("Not a funding decision")).toBeInTheDocument();
    expect(
      screen.getByText(/Funding, sanction, risk acceptance and operational authorization/),
    ).toBeInTheDocument();
  });

  it("shows transparent selected and deferred results and routes only a recommendation", async () => {
    render(<EnterprisePortfolioOptimizationPanel />);
    await screen.findByText("Enterprise portfolio optimization");

    fireEvent.change(screen.getByLabelText("Portfolio budget"), {
      target: { value: "1000000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run governed optimization" }));

    expect(await screen.findByText(/does not claim a global mathematical optimum/)).toBeInTheDocument();
    expect(screen.getByText(/Critical reliability renewal/)).toBeInTheDocument();
    expect(screen.getByText(/Capacity expansion/)).toBeInTheDocument();
    expect(runOptimization).toHaveBeenCalledWith(
      expect.objectContaining({ budget: 1_000_000, currency: "CAD" }),
    );

    fireEvent.change(screen.getByPlaceholderText(/Explain the trade-off/), {
      target: {
        value: "Advance the reliability renewal because its verified risk reduction is highest.",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Propose for human review" }));

    await waitFor(() =>
      expect(proposePlan).toHaveBeenCalledWith(
        "run-1",
        "Advance the reliability renewal because its verified risk reduction is highest.",
      ),
    );
    expect(await screen.findByText(/pending human review; no funds were committed/)).toBeInTheDocument();
  });

  it("shows multiple non-dominated portfolios and sends only the named human choice to review", async () => {
    render(<EnterprisePortfolioOptimizationPanel />);
    await screen.findByText("Enterprise portfolio optimization");
    fireEvent.change(screen.getByLabelText("Portfolio budget"), { target: { value: "1000000" } });
    fireEvent.click(screen.getByRole("button", { name: "Build nine-dimension frontier" }));

    expect(await screen.findByText("Nine-dimension efficient frontier")).toBeInTheDocument();
    expect(screen.getByText("safety risk portfolio")).toBeInTheDocument();
    expect(screen.getByText("production benefit portfolio")).toBeInTheDocument();
    const choices = screen.getAllByRole("button", { name: "Choose this portfolio for human review" });
    fireEvent.click(choices[1]);
    fireEvent.change(screen.getByPlaceholderText(/selected frontier trade-off/), {
      target: { value: "Select the production portfolio after reviewing its evidence and execution trade-offs." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Propose chosen frontier portfolio" }));

    await waitFor(() => expect(proposeFrontier).toHaveBeenCalledWith(
      "frontier-run-1",
      "pf-production",
      "Select the production portfolio after reviewing its evidence and execution trade-offs.",
    ));
    expect(await screen.findByText(/pending human review; no funds were committed/)).toBeInTheDocument();
  });
});
