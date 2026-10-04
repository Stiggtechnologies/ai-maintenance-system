import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MaintenanceExecutiveAgentWorkbench } from "./MaintenanceExecutiveAgentWorkbench";

const auth = {
  role: "executive",
  userId: "user-executive",
};

const loadWorkspace = vi.fn();
const runAgent = vi.fn();
const assignReview = vi.fn();
const acknowledge = vi.fn();

vi.mock("./AuthProvider", () => ({
  useAuth: () => ({
    profile: { role: auth.role },
    user: { id: auth.userId },
  }),
}));

vi.mock("../services/maintenanceExecutiveAgentService", () => ({
  loadMaintenanceExecutiveWorkspace: () => loadWorkspace(),
  runMaintenanceExecutiveAgent: () => runAgent(),
  assignMaintenanceExecutiveReview: (input: unknown) => assignReview(input),
  acknowledgeMaintenanceExecutiveBriefing: (input: unknown) =>
    acknowledge(input),
}));

function workspace(options?: {
  assignedTo?: string;
  receiptBy?: string;
}) {
  return {
    basis: "Immutable advisory evidence.",
    reviewers: [
      {
        id: "user-admin",
        name: "Avery Admin",
        email: "admin@example.com",
        role: "admin",
      },
    ],
    briefings: [
      {
        id: "briefing-1",
        agentRunId: "run-1",
        asOf: "2026-10-04T00:00:00.000Z",
        sourceSnapshot: { kpis: { count: 1, sha256: "abc" } },
        performance: { latestMeasured: 1 },
        governance: { pendingApprovals: 0 },
        budgets: {
          lineCount: 1,
          currencyStatus: "not_recorded_by_budget_lines",
        },
        risks: { riskCount: 1 },
        strategy: { assessments: 1 },
        evidenceGaps: [
          {
            key: "budget_currency_missing",
            count: 1,
            humanActionRequired: true,
          },
        ],
        limitations: ["No budget currency is inferred."],
        createdBy: "user-executive",
        createdAt: "2026-10-04T00:00:00.000Z",
        assignments: options?.assignedTo
          ? [
              {
                id: "assignment-1",
                assignedTo: options.assignedTo,
                reviewerName: "Avery Admin",
                reviewerEmail: "admin@example.com",
                dueDate: "2026-10-11",
                note: "Review the exact evidence packet.",
                assignedAt: "2026-10-04T00:01:00.000Z",
              },
            ]
          : [],
        acknowledgements: options?.receiptBy
          ? [
              {
                id: "receipt-1",
                disposition: "acknowledged" as const,
                reviewNote: "Independent review completed against source evidence.",
                evidenceReference: null,
                reviewedBy: options.receiptBy,
                reviewerName: "Avery Admin",
                reviewedAt: "2026-10-04T00:02:00.000Z",
              },
            ]
          : [],
      },
    ],
  };
}

beforeEach(() => {
  auth.role = "executive";
  auth.userId = "user-executive";
  loadWorkspace.mockReset().mockResolvedValue(workspace());
  runAgent.mockReset().mockResolvedValue({ briefingId: "briefing-2" });
  assignReview.mockReset().mockResolvedValue({ status: "assigned" });
  acknowledge.mockReset().mockResolvedValue({ status: "acknowledged" });
});

describe("MaintenanceExecutiveAgentWorkbench", () => {
  it("does not call the privileged workspace for a lower-authority role", () => {
    auth.role = "maintenance_manager";
    render(<MaintenanceExecutiveAgentWorkbench />);

    expect(
      screen.queryByTestId("maintenance-executive-agent"),
    ).not.toBeInTheDocument();
    expect(loadWorkspace).not.toHaveBeenCalled();
  });

  it("shows explicit budget uncertainty and the independent-review trail", async () => {
    render(<MaintenanceExecutiveAgentWorkbench />);

    expect(
      await screen.findByText("budget currency missing"),
    ).toBeInTheDocument();
    expect(screen.getByText("No independent reviewer assigned.")).toBeInTheDocument();
    expect(screen.getByText("No review receipt recorded.")).toBeInTheDocument();
  });

  it("enables a receipt only for the assigned reviewer with a substantive note", async () => {
    auth.role = "admin";
    auth.userId = "user-admin";
    loadWorkspace.mockResolvedValue(workspace({ assignedTo: "user-admin" }));
    render(<MaintenanceExecutiveAgentWorkbench />);

    const button = await screen.findByRole("button", {
      name: "Record review receipt",
    });
    expect(button).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Review note"), {
      target: {
        value:
          "I independently verified the retained facts and authority boundary.",
      },
    });
    expect(button).toBeEnabled();
  });

  it("keeps an existing receipt immutable in the customer workflow", async () => {
    auth.role = "admin";
    auth.userId = "user-admin";
    loadWorkspace.mockResolvedValue(
      workspace({ assignedTo: "user-admin", receiptBy: "user-admin" }),
    );
    render(<MaintenanceExecutiveAgentWorkbench />);

    expect(
      await screen.findByText(/Your acknowledged receipt is retained/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Record review receipt" }),
    ).toBeDisabled();
  });
});
