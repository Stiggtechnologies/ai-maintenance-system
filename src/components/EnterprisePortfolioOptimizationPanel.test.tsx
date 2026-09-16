import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EnterprisePortfolioOptimizationPanel } from "./EnterprisePortfolioOptimizationPanel";

const getWorkspace = vi.fn();
const runOptimization = vi.fn();
const proposePlan = vi.fn();

vi.mock("../services/enterprisePortfolioOptimizationService", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("../services/enterprisePortfolioOptimizationService")
  >();
  return {
    ...original,
    getEnterprisePortfolioWorkspace: (...args: unknown[]) => getWorkspace(...args),
    runEnterprisePortfolioOptimization: (...args: unknown[]) => runOptimization(...args),
    proposeEnterprisePortfolioPlan: (...args: unknown[]) => proposePlan(...args),
    configurePortfolioCandidate: vi.fn(),
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
  runOptimization.mockResolvedValue(run);
  proposePlan.mockResolvedValue({
    recommendationId: "recommendation-1",
    approvalId: "approval-1",
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
});
