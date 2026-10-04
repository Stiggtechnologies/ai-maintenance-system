import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GovernedRcmWorkbench } from "./GovernedRcmWorkbench";

const load = vi.fn();
const submit = vi.fn();
const review = vi.fn();

vi.mock("../services/governedRcmService", () => ({
  loadGovernedRcmWorkspace: () => load(),
  submitGovernedRcmAnalysis: (...args: unknown[]) => submit(...args),
  reviewGovernedRcmAnalysis: (...args: unknown[]) => review(...args),
}));
vi.mock("./AuthProvider", () => ({
  useAuth: () => ({ user: { id: "reviewer-1" } }),
}));
vi.mock("react-router-dom", async () => {
  const actual =
    await vi.importActual<typeof import("react-router-dom")>(
      "react-router-dom",
    );
  return { ...actual, useNavigate: () => vi.fn() };
});

const workspace = {
  assets: [
    {
      id: "asset-1",
      tag: "P-101",
      name: "Process pump",
      assetClass: "pump",
      criticality: "high",
    },
  ],
  reviewers: [
    { id: "reviewer-1", name: "Independent reviewer", role: "admin" },
  ],
  evidence: [
    {
      id: "evidence-1",
      assetId: "asset-1",
      type: "failure_history",
      class: "HISTORICAL",
      description: "Verified seal failure history",
      sourceSystem: "CMMS",
      verifiedBy: "reviewer-1",
      verifiedAt: "2026-10-04T00:00:00Z",
      verificationMethod: "Independent reconciliation",
    },
  ],
  analyses: [],
  decisionBoundary: {
    recordsEngineeringDisposition: true,
    changesMaintenancePlan: false,
    createsWork: false,
    acceptsRisk: false,
    commitsSpend: false,
    changesOperatingLimits: false,
    returnsToService: false,
    approvalRequiresAal: "aal2",
    segregationOfDuties: true,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  load.mockResolvedValue(workspace);
});

describe("GovernedRcmWorkbench", () => {
  it("renders the seven-question path and exact authority boundary", async () => {
    render(<GovernedRcmWorkbench />);
    expect(await screen.findByText("Seven-question RCM")).toBeVisible();
    for (const label of [
      /1 · What must the asset do/i,
      /2 · How can it fail/i,
      /3 · What causes/i,
      /4 · What happens/i,
      /5 · Consequence category/i,
      /6 · Candidate proactive task/i,
      /7 · Default action/i,
    ])
      expect(screen.getByLabelText(label)).toBeVisible();
    expect(
      screen.getByText(/No work, plan, risk, spend or operating authority/i),
    ).toBeVisible();
  });

  it("requires verified asset evidence before submission", async () => {
    render(<GovernedRcmWorkbench />);
    const button = await screen.findByRole("button", {
      name: /Submit for independent review/i,
    });
    expect(button).toBeDisabled();
    fireEvent.click(await screen.findByText("Verified seal failure history"));
    expect(button).toBeEnabled();
  });

  it("exposes assigned review without claiming a maintenance change", async () => {
    load.mockResolvedValue({
      ...workspace,
      analyses: [
        {
          failureModeId: "fm-1",
          assetId: "asset-1",
          functionStatement: "Transfer process water at approved duty.",
          functionalFailure: "Unable to maintain approved transfer duty.",
          failureMode: "Seal loses containment",
          effect: "Leakage and process interruption",
          consequenceCategory: "operational",
          hiddenFailure: false,
          status: "submitted",
          version: 1,
          recordedBy: "author-1",
          reviewedBy: null,
          reviewedAt: null,
          reviewNote: null,
          evidenceItemIds: ["evidence-1"],
          strategy: {
            id: "strategy-1",
            type: "condition_based",
            taskApplicable: true,
            taskEffective: true,
            defaultAction: null,
            recommendation: "RCM disposition: condition based",
            status: "submitted",
            reviewerId: "reviewer-1",
            reviewStatus: "required",
            rcmAnswers: {},
          },
        },
      ],
    });
    review.mockResolvedValue(undefined);
    render(<GovernedRcmWorkbench />);
    const note = await screen.findByPlaceholderText(/Independent review note/i);
    fireEvent.change(note, {
      target: {
        value:
          "Independent review confirms consequence and task-selection logic.",
      },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /Approve engineering disposition/i }),
    );
    await waitFor(() =>
      expect(review).toHaveBeenCalledWith({
        strategyId: "strategy-1",
        disposition: "approved",
        note: "Independent review confirms consequence and task-selection logic.",
      }),
    );
    expect(
      await screen.findByText(/maintenance programme remains unchanged/i),
    ).toBeVisible();
  });
});
