import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RiskUncertaintyPanel } from "./RiskUncertaintyPanel";

const getWorkspace = vi.fn();

vi.mock("../../services/riskOperatingService", async () => {
  const actual = await vi.importActual<
    typeof import("../../services/riskOperatingService")
  >("../../services/riskOperatingService");
  return {
    ...actual,
    getRiskUncertaintyWorkspace: () => getWorkspace(),
    submitRiskUncertaintyAnalysis: vi.fn(),
    reviewRiskUncertaintyAnalysis: vi.fn(),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  getWorkspace.mockResolvedValue({
    risk: {
      id: "risk-1",
      title: "Loss of cooling",
      status: "analyzed",
      currency: "CAD",
    },
    criteria: {
      id: "criteria-1",
      name: "Enterprise risk criteria",
      version: 3,
      status: "adopted",
      decisionThresholds: { escalateAbove: 16 },
    },
    evidence: [
      {
        id: "evidence-1",
        description: "Verified inspection and operating-history extract",
        sourceSystem: "CMMS",
        sourceReference: "WO-4401",
        verificationStatus: "verified",
        verifiedBy: "reviewer-1",
        verifiedAt: "2026-09-30T00:00:00Z",
        evidenceClass: "INSPECTED",
        qualityGrade: "high",
        applicabilityGrade: "direct",
      },
      {
        id: "evidence-2",
        description: "Unverified operator recollection",
        sourceSystem: "interview",
        sourceReference: null,
        verificationStatus: "unverified",
        verifiedBy: null,
        verifiedAt: null,
        evidenceClass: "EXPERT_JUDGEMENT",
        qualityGrade: null,
        applicabilityGrade: null,
      },
    ],
    analyses: [
      {
        id: "analysis-1",
        version: 2,
        validationStatus: "stale",
        method: "Three-point estimate",
        basis: "Based on the exact verified inspection and operating extract.",
        probability: { lower: 0.15, central: 0.3, upper: 0.55 },
        confidence: { level: 0.9, lower: 0.1, upper: 0.6 },
        lossCases: {
          best: 10000,
          expected: 60000,
          worst: 250000,
          currency: "CAD",
        },
        sensitivityInputs: [],
        sensitivityResults: [
          {
            name: "Startup exposure",
            basis: "Verified startup log",
            lowInput: 2,
            baseInput: 5,
            highInput: 8,
            lowOutput: 10000,
            baseOutput: 60000,
            highOutput: 180000,
            swing: 170000,
          },
        ],
        thresholdProfileId: "criteria-1",
        decisionThresholds: { escalateAbove: 16 },
        reassessmentTriggers: ["Two starts inside one operating shift"],
        reviewDueAt: "2026-11-01T00:00:00Z",
        valueOfInformation: {
          action: "Inspect seal system during the next outage",
          informationCost: 10000,
          decisionCostIfWrong: 250000,
          uncertaintyReduction: 0.5,
          probabilityDecisionChanges: 0.3,
          expectedValue: 37500,
          netValue: 27500,
          recommendation: "GATHER_INFORMATION",
        },
        analysisDigest: "a".repeat(64),
        currentDigest: "b".repeat(64),
        authorId: "author-1",
        createdAt: "2026-09-30T00:00:00Z",
        reviewerId: "reviewer-1",
        reviewedAt: "2026-10-01T00:00:00Z",
        reviewNote: "Exact packet independently reviewed.",
        approvalId: "approval-1",
        derivedEvidenceItemId: "evidence-3",
        evidenceItemIds: ["evidence-1"],
        operationalAuthorization: false,
      },
    ],
    boundary:
      "Independent review validates the analysis packet. It does not verify an unverified source, accept risk, authorize operation, release work or commit spend.",
    operationalAuthorization: false,
  });
});

describe("RiskUncertaintyPanel", () => {
  it("shows governed ranges, sensitivity, VOI, thresholds and stale state", async () => {
    render(
      <RiskUncertaintyPanel
        riskId="risk-1"
        currentUserId="viewer-1"
        currentUserRole="viewer"
      />,
    );

    expect(await screen.findByText("Probability and confidence")).toBeInTheDocument();
    expect(screen.getByText(/Probability 0.15–0.55/)).toBeInTheDocument();
    expect(screen.getByText("Sensitivity ranking")).toBeInTheDocument();
    expect(screen.getByText(/Startup exposure · swing 170000/)).toBeInTheDocument();
    expect(screen.getByText("Value of information")).toBeInTheDocument();
    expect(screen.getByText("stale")).toBeInTheDocument();
    expect(screen.getByText(/Enterprise risk criteria · v3/)).toBeInTheDocument();
    expect(screen.getByText(/1 unverified and excluded/)).toBeInTheDocument();
  });

  it("keeps viewer and author boundaries visible and non-operational", async () => {
    render(
      <RiskUncertaintyPanel
        riskId="risk-1"
        currentUserId="viewer-1"
        currentUserRole="viewer"
      />,
    );

    expect(
      await screen.findByText(/does not accept risk or authorize operation/i),
    ).toBeInTheDocument();
    expect(screen.queryByText("Submit a new version")).not.toBeInTheDocument();
    expect(screen.queryByText("Review packet")).not.toBeInTheDocument();
  });
});
