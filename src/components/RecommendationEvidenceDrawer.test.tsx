import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RecommendationEvidenceDrawer } from "./RecommendationEvidenceDrawer";

const getWorkspace = vi.fn();

vi.mock("../services/recommendationEvidenceService", async () => {
  const actual = await vi.importActual<
    typeof import("../services/recommendationEvidenceService")
  >("../services/recommendationEvidenceService");
  return {
    ...actual,
    getRecommendationEvidenceWorkspace: () => getWorkspace(),
  };
});

const rec = {
  id: "rec-1",
  organization_id: "org-1",
  asset_id: "asset-1",
  agent_id: null,
  title: "Resolve repeated seal failures",
  issue: "Repeated failures",
  action: "Validate causal evidence",
  impact: null,
  confidence: 78,
  urgency: "action",
  status: "pending",
  approval_required: "maintenance_manager",
  accountable: null,
  responsible: null,
  consulted: null,
  informed: null,
  financial_impact: null,
  risk_impact: "High",
  rationale: null,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
  asset: {
    id: "asset-1",
    name: "Pump P-101",
    tag: "P-101",
    criticality: "high",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  getWorkspace.mockResolvedValue({
    recommendation: { id: "rec-1", title: rec.title, status: "pending" },
    evidence: [
      {
        id: "evidence-1",
        description:
          "Inspection conflicts with the proposed failure mechanism.",
        evidenceType: "inspection",
        evidenceClass: "INSPECTED",
        evidenceLevel: "approved_inspection",
        claimRole: "contradicting",
        classificationStatus: "validated",
        sourceSystem: "CMMS",
        sourceReference: "INSP-4401",
        revision: "2",
        sourceDate: "2026-09-01",
        observedAt: "2026-09-01T00:00:00Z",
        applicability:
          "Direct inspection of the exact maintainable item and operating state.",
        verificationStatus: "verified",
        qualityGrade: "high",
        applicabilityGrade: "direct",
        confidence: { evidenceConfidencePct: 84.2 },
        recordedBy: "author-1",
        reviewedBy: "reviewer-1",
        reviewedAt: "2026-09-02T00:00:00Z",
        reviewNote: "Independent review confirms this exact classification.",
      },
      {
        id: "evidence-2",
        description: "AI-generated hypothesis awaiting source grading.",
        evidenceType: "hypothesis",
        evidenceClass: "AI_INFERENCE",
        evidenceLevel: "ai_hypothesis",
        claimRole: "supporting",
        classificationStatus: "validated",
        sourceSystem: "SyncAI",
        sourceReference: "RUN-91",
        revision: "1",
        sourceDate: "2026-09-01",
        observedAt: "2026-09-01T00:00:00Z",
        applicability:
          "Candidate explanation only; field confirmation remains missing.",
        verificationStatus: "unverified",
        qualityGrade: null,
        applicabilityGrade: null,
        confidence: {
          refusal: "missing_factors",
          error: "Quality and applicability are absent.",
        },
        recordedBy: "author-1",
        reviewedBy: "reviewer-1",
        reviewedAt: "2026-09-02T00:00:00Z",
        reviewNote: "Classification reviewed; source truth remains unverified.",
      },
    ],
    missingEvidence: ["Post-maintenance vibration measurement"],
    missingEvidenceBasis:
      "The causal claim was checked against the required confirmation methods.",
    packet: {
      validationStatus: "stale",
      storedDigest: "a".repeat(64),
      currentDigest: "b".repeat(64),
      recordedBy: "author-1",
      reviewedBy: "reviewer-1",
      reviewedAt: "2026-09-02T00:00:00Z",
      reviewNote: "The exact packet was independently reviewed.",
    },
    posture: {
      linkedEvidence: 2,
      validatedClassifications: 2,
      supporting: 1,
      contradicting: 1,
      context: 0,
      unclassified: 0,
      missingCount: 1,
    },
    levels: [],
    boundary:
      "Classification does not approve the recommendation or authorize operation.",
    operationalAuthorization: false,
  });
});

describe("RecommendationEvidenceDrawer", () => {
  it("renders conflicts, exact source provenance, confidence and named refusals", async () => {
    render(
      <RecommendationEvidenceDrawer
        rec={rec}
        currentUserId="viewer-1"
        canGovern={false}
        onClose={() => undefined}
      />,
    );

    expect(await screen.findByText("approved inspection")).toBeInTheDocument();
    expect(screen.getByText("contradicting")).toBeInTheDocument();
    expect(screen.getByText("84.2% EC")).toBeInTheDocument();
    expect(
      screen.getByText(/EC refused · missing factors/i),
    ).toBeInTheDocument();
    expect(screen.getByText("INSP-4401")).toBeInTheDocument();
    expect(
      screen.getByText(/Post-maintenance vibration measurement/),
    ).toBeInTheDocument();
  });

  it("shows stale-packet and non-authorizing boundaries without viewer actions", async () => {
    render(
      <RecommendationEvidenceDrawer
        rec={rec}
        currentUserId="viewer-1"
        canGovern={false}
        onClose={() => undefined}
      />,
    );

    expect(
      await screen.findByText(/Evidence changed after review/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /does not approve the recommendation or authorize operation/i,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Submit classification")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Submit exact packet digest"),
    ).not.toBeInTheDocument();
  });
});
