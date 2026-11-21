import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PmPolicyOptimization } from "./PmPolicyOptimization";

const loadWorkspace = vi.fn();
const recordBasis = vi.fn();
const runPolicy = vi.fn();
const assignReview = vi.fn();
const adopt = vi.fn();

vi.mock("../services/pmPolicyOptimizationService", () => ({
  loadPmPolicyWorkspace: () => loadWorkspace(),
  recordPmGroupingBasis: (input: unknown) => recordBasis(input),
  runPmPolicyOptimization: (assetId: string) => runPolicy(assetId),
  assignPmPolicyReview: (input: unknown) => assignReview(input),
  adoptPmPolicyAssessment: (input: unknown) => adopt(input),
}));

const workspace = {
  basis: "Named-human adoption is required before any interval can change.",
  reviewers: [
    {
      id: "reviewer-1",
      name: "Riley Engineer",
      email: "riley@example.com",
      role: "reliability_engineer",
    },
  ],
  assets: [
    {
      id: "asset-1",
      name: "Ball mill",
      tag: "ML-1",
      groupingBasis: null,
      plans: [
        {
          id: "plan-1",
          taskLabel: "Pinion bearing",
          componentScope: "pinion bearing",
          version: 2,
          plannedItemCost: 200,
          failureCost: 8000,
          costBasis: "Recorded from the maintenance programme.",
          safetyCritical: false,
          regulatoryRequired: false,
          intervalBasis: "run_hours",
          intervalValue: 4000,
          failureEvents: 12,
          suspensionEvents: 3,
        },
      ],
    },
  ],
  assessments: [
    {
      id: "assessment-1",
      assetId: "asset-1",
      assetName: "Ball mill",
      kernelVersion: "pm-policy/1",
      selected: "separate_age",
      createdBy: "author-1",
      createdAt: "2026-11-03T00:00:00.000Z",
      groupingBasisId: null,
      groupingBasisVersion: null,
      limitations: ["Advisory only."],
      recommendation: {
        kind: "separate_age",
        reason: "Separate age-replacement policies are retained.",
        humanApprovalRequired: true,
      },
      adoption: null,
      assignments: [],
      analysis: {
        kernelVersion: "pm-policy/1",
        advisory: true,
        mayChangePmInterval: false,
        mayCreateWork: false,
        mayAcceptRisk: false,
        mayCommitSpend: false,
        mayReturnToService: false,
        selected: "separate_age",
        recommendation: {
          kind: "separate_age",
          reason: "Separate age-replacement policies are retained.",
          humanApprovalRequired: true,
        },
        separateAge: { costRate: 1.2, reason: "Sum of age policies." },
        separateBlock: { costRate: 1.4, reason: "Sum of block policies." },
        commonBlock: {
          recommended: false,
          intervalHours: 900,
          costRate: 1.5,
          memberKeys: [],
          premiumOverSeparateAgePct: 25,
          reason: "The common interval does not beat separate age replacement.",
        },
        opportunistic: {
          applicable: false,
          reason:
            "Opportunistic grouping is not priced until a shared access saving is recorded.",
        },
        refusals: [],
        limitations: ["Advisory only."],
        components: [
          {
            key: "plan-1",
            label: "Pinion bearing",
            method: "mle",
            failures: 12,
            suspensions: 3,
            beta: 2.4,
            eta: 1000,
            eventIds: [1],
            planVersion: 2,
            plannedItemCost: 200,
            failureCost: 8000,
            safetyCritical: false,
            regulatoryRequired: false,
            ageHours: null,
            standingIntervalHours: 640,
            applyInterval: true,
            reason: "Age replacement is cheaper.",
            ageReplacement: {
              recommended: true,
              optimalAge: 640,
              costRateAtOptimum: 1.2,
              runToFailureCostRate: 2,
              savingsPct: 40,
              reason: "Replacing at 640 lowers the cost rate.",
            },
            blockReplacement: {
              recommended: true,
              optimalInterval: 700,
              costRateAtOptimum: 1.4,
              ageReplacement: {
                recommended: true,
                optimalAge: 640,
                costRateAtOptimum: 1.2,
                runToFailureCostRate: 2,
                savingsPct: 40,
                reason: "Age.",
              },
              premiumOverAgePct: 16.7,
              reason: "Replacing every 700 costs more than age replacement.",
            },
            opportunistic: {
              thresholdAge: null,
              preventiveAge: null,
              includeOnOpenAccess: null,
              reason: "No opportunistic window is priced.",
            },
          },
        ],
      },
    },
  ],
};

describe("PmPolicyOptimization", () => {
  beforeEach(() => {
    loadWorkspace.mockReset();
    recordBasis.mockReset();
    runPolicy.mockReset();
    assignReview.mockReset();
    adopt.mockReset();
    loadWorkspace.mockResolvedValue(workspace);
    recordBasis.mockResolvedValue({ id: "basis-1", version: 1 });
    runPolicy.mockResolvedValue({
      assessment_id: "assessment-1",
      advisory: true,
      may_change_pm_interval: false,
    });
    assignReview.mockResolvedValue({ assignmentId: "assignment-1" });
    adopt.mockResolvedValue({
      programmeChanged: false,
      action: "record_policy",
    });
  });

  it("shows the block comparison and refuses to price opportunistic grouping without an access cost", async () => {
    render(<PmPolicyOptimization />);
    expect(
      (await screen.findAllByText(/Pinion bearing/)).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText(/Block every 700 h/)).toBeInTheDocument();
    expect(
      screen.getByText(/Opportunistic grouping is not priced/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Record access cost" }),
    ).toBeDisabled();
  });

  it("records an explicit access fact and an advisory assessment without applying an interval", async () => {
    render(<PmPolicyOptimization />);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Run policy assessment" }),
      ).toBeEnabled(),
    );
    fireEvent.change(screen.getByLabelText("Shared access cost"), {
      target: { value: "5000" },
    });
    fireEvent.change(
      screen.getByLabelText("Task costs exclude this access cost"),
      { target: { value: "yes" } },
    );
    fireEvent.change(screen.getByLabelText("Access-cost provenance"), {
      target: {
        value:
          "Crane and isolation cost from the last two shutdown work orders.",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Record access cost" }));
    await waitFor(() =>
      expect(recordBasis).toHaveBeenCalledWith({
        assetId: "asset-1",
        sharedAccessCostUsd: 5000,
        accessExcludedFromTaskCosts: true,
        basis:
          "Crane and isolation cost from the last two shutdown work orders.",
      }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Run policy assessment" }),
      ).toBeEnabled(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Run policy assessment" }),
    );
    await waitFor(() => expect(runPolicy).toHaveBeenCalledWith("asset-1"));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Record governed decision" }),
      ).toBeEnabled(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Record governed decision" }),
    );
    await waitFor(() =>
      expect(adopt).toHaveBeenCalledWith(
        expect.objectContaining({
          assessmentId: "assessment-1",
          action: "record_policy",
        }),
      ),
    );
  });
});
