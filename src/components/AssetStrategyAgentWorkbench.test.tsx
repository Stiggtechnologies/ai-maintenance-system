import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssetStrategyAgentWorkbench } from "./AssetStrategyAgentWorkbench";

const load = vi.fn();

vi.mock("../services/assetStrategyAgentService", () => ({
  loadAssetStrategyWorkspace: () => load(),
  recordAssetStrategyContext: vi.fn(),
  runAssetStrategyAgent: vi.fn(),
  assignAssetStrategyReview: vi.fn(),
  adoptAssetStrategyAssessment: vi.fn(),
}));

const fieldExperience = {
  eventIds: ["learning-1", "learning-2"],
  effectiveCount: 1,
  ineffectiveCount: 1,
  currentEffectiveCount: 1,
  currentIneffectiveCount: 1,
  refreshRequired: true,
  revisionRequired: true,
  latestEvaluatedAt: "2026-10-04T00:00:00Z",
  currentPlanVersion: 3,
  basis:
    "Only concluded corrective-action outcomes tied to the exact adopted lifecycle-plan are included.",
};

const workspace = {
  plans: [
    {
      id: "plan-1",
      assetId: "asset-1",
      assetName: "Process pump",
      assetTag: "P-101",
      assetClass: "pump",
      taskCode: "PM-001",
      taskLabel: "Seal inspection",
      intervalBasis: "calendar_days",
      intervalValue: 30,
      active: true,
      source: "CMMS",
      componentScope: "mechanical seal",
      failureMode: "seal leakage",
      strategyKind: "condition_based",
      plannedTaskCostUsd: 500,
      failureConsequenceCostUsd: 5000,
      costBasis: "Approved maintenance and production-loss estimate.",
      safetyCritical: false,
      regulatoryRequired: false,
      lifecycleObjective:
        "Reduce recurring seal failures without unsafe deferral.",
      version: 3,
      updatedAt: "2026-10-04T00:00:00Z",
    },
  ],
  assessments: [
    {
      id: "assessment-1",
      planId: "plan-1",
      assetId: "asset-1",
      assetName: "Process pump",
      taskLabel: "Seal inspection",
      planVersion: 3,
      kernelVersion: "asset-strategy/1",
      sourceEventIds: [1, 2],
      analysis: {
        methodSelection: {
          method: "rank_regression",
          beta: 2,
          eta: 1000,
          failures: 2,
          suspensions: 0,
        },
        ageReplacement: { recommended: false },
        inspection: { intervalDays: null },
        recommendation: {
          kind: "strategy_review",
          proposedStrategyKind: null,
          proposedIntervalBasis: null,
          proposedIntervalValue: null,
          reason: "Verified recurrence requires strategy review.",
          humanApprovalRequired: true,
        },
        fieldExperience,
        refusals: [],
        lifecyclePlan: { objective: "Review current strategy", actions: [] },
      },
      recommendation: {
        kind: "strategy_review",
        proposedStrategyKind: null,
        proposedIntervalBasis: null,
        proposedIntervalValue: null,
        reason: "Verified recurrence requires strategy review.",
        humanApprovalRequired: true,
      },
      limitations: [],
      createdBy: "manager-1",
      createdAt: "2026-10-04T00:00:00Z",
      assignments: [],
    },
  ],
  lifecyclePlans: [],
  reviewers: [],
  learning: [
    {
      planId: "plan-1",
      assetId: "asset-1",
      taskLabel: "Seal inspection",
      state: { ...fieldExperience, events: [] },
    },
  ],
  learningBoundary: {
    refreshesAssessment: true,
    changesMaintenancePlan: false,
    createsWork: false,
    acceptsRisk: false,
    commitsSpend: false,
    changesOperatingLimits: false,
    returnsToService: false,
    requiresIndependentReviewAndHumanAdoption: true,
  },
  basis: "Canonical strategy workspace",
};

beforeEach(() => {
  vi.clearAllMocks();
  load.mockResolvedValue(workspace);
});

describe("AssetStrategyAgentWorkbench field learning", () => {
  it("surfaces verified recurrence as a governed refresh, not an automatic change", async () => {
    render(<AssetStrategyAgentWorkbench />);
    expect(
      await screen.findByText("Verified recurrence requires strategy review"),
    ).toBeVisible();
    expect(
      screen.getByRole("button", {
        name: "Refresh from verified field experience",
      }),
    ).toBeEnabled();
    expect(
      screen.getByText(
        /Independent review and named-human adoption remain mandatory/i,
      ),
    ).toBeVisible();
  });

  it("shows the exact frozen effective and ineffective outcome counts", async () => {
    render(<AssetStrategyAgentWorkbench />);
    expect(await screen.findByText("Frozen field experience")).toBeVisible();
    const frozenCounts = screen.getAllByText(/1 effective.*1 ineffective/i);
    expect(frozenCounts).toHaveLength(2);
    for (const item of frozenCounts) expect(item).toBeVisible();
    expect(
      screen.getByText(
        /Only concluded corrective-action outcomes tied to the exact adopted lifecycle-plan/i,
      ),
    ).toBeVisible();
  });
});
