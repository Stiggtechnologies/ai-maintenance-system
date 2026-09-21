import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getProjectStartKnowledge,
  runLessonsAgent,
} from "../../services/developService";
import { ApplicableLessonsBanner } from "./RealizePanels";

vi.mock("../../services/developService", () => ({
  getProjectStartKnowledge: vi.fn(),
  runLessonsAgent: vi.fn(),
}));

vi.mock("../../services/operatingLoopService", () => ({
  verifyValueMetric: vi.fn(),
}));

describe("ApplicableLessonsBanner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getProjectStartKnowledge).mockResolvedValue({
      caseId: "target-case",
      lifecycleType: "brownfield",
      lessons: {
        caseId: "target-case",
        lifecycleType: "brownfield",
        count: 1,
        basis: "Deterministic tenant history comparison.",
        lessons: [
          {
            id: "lesson-1",
            title: "Freeze vendor data before IFC issue",
            failureModeKey: "project_delivery.poor_vendor_data",
            cause: "Vendor dates were not tied to the release plan.",
            correctiveAction: "Add vendor-data dates and acceptance owners.",
            applicability: "Brownfield projects with vendor interfaces.",
            sourceCaseId: "source-case",
            sourceLifecycleType: "brownfield",
            matchReason: "source case shares this lifecycle type",
            createdAt: "2026-09-01T00:00:00Z",
          },
        ],
      },
      historicalEstimates: {
        count: 1,
        items: [
          {
            learningEventId: "outcome-1",
            sourceCaseId: "source-case",
            sourceCaseTitle: "Compressor upgrade",
            baselineCost: 1000000,
            actualCost: 1120000,
            baselineDurationDays: 90,
            actualDurationDays: 103,
            currency: "CAD",
            outcomeEvidenceItemId: "evidence-1",
            sourceRefs: [{ table: "learning_events", id: "outcome-1" }],
            matchReason: "completed project shares this lifecycle type",
          },
        ],
      },
      vendorPerformance: {
        count: 1,
        items: [
          {
            supplierId: 9,
            supplier: "Measured Fabrication Ltd.",
            sourceCaseIds: ["source-case"],
            packageIds: [22],
            performancePeriodIds: [33],
            record: { dataStatus: "measured" },
            sourceRefs: [{ table: "suppliers", id: 9 }],
            matchReason:
              "measured supplier on a completed project sharing this lifecycle type",
          },
        ],
      },
      startupProblems: {
        count: 1,
        items: [
          {
            learningEventId: "startup-1",
            sourceCaseId: "source-case",
            sourceCaseTitle: "Compressor upgrade",
            title: "Seal failure at first start",
            cause: "Commissioning flush was incomplete",
            correctiveAction: "Require witnessed flush acceptance",
            applicability: "Rotating equipment startups",
            sourceRefs: [{ table: "learning_events", id: "startup-1" }],
            matchReason: "source case shares this lifecycle type",
          },
        ],
      },
      method: "Deterministic same-tenant retrieval from canonical records.",
      recommendationOnly: true,
      authorization: false,
      decisionBoundary:
        "This retrieval prepares evidence for named humans and does not authorize work.",
    });
    vi.mocked(runLessonsAgent).mockResolvedValue({
      advisory: true,
      caseId: "target-case",
      question: "What recorded project lessons apply here?",
      narrativeSource: "deterministic_governed_records",
      disclaimer: "A named human must confirm applicability.",
      analysis: {
        verdict: "applicable_lessons_identified",
        headline:
          "1 applicable project lesson identified from recorded history.",
        lessonCount: 1,
        basis: "Deterministic tenant history comparison.",
        evidenceRefs: [
          "development_cases:target-case",
          "learning_events:lesson-1",
        ],
        limitations: ["Human review is required."],
        findings: [
          {
            lessonId: "lesson-1",
            title: "Freeze vendor data before IFC issue",
            failureModeKey: "project_delivery.poor_vendor_data",
            cause: "Vendor dates were not tied to the release plan.",
            correctiveAction: "Add vendor-data dates and acceptance owners.",
            applicability: "Brownfield projects with vendor interfaces.",
            matchReason: "source case shares this lifecycle type",
            sourceLifecycleType: "brownfield",
            sourceRefs: [
              "learning_events:lesson-1",
              "development_cases:source-case",
            ],
          },
        ],
      },
    });
  });

  it("opens the governed agent result from the case header", async () => {
    render(<ApplicableLessonsBanner caseId="target-case" />);

    const button = await screen.findByRole("button", {
      name: "Run Lessons Agent",
    });
    fireEvent.click(button);

    await waitFor(() =>
      expect(runLessonsAgent).toHaveBeenCalledWith("target-case"),
    );
    expect(
      await screen.findByText(
        "1 applicable project lesson identified from recorded history.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/learning_events:lesson-1/)).toBeInTheDocument();
    expect(screen.getByText("Human review is required.")).toBeInTheDocument();
  });

  it("surfaces the three additional project-start knowledge families", async () => {
    render(<ApplicableLessonsBanner caseId="target-case" />);

    expect(await screen.findByText("Project-start knowledge")).toBeInTheDocument();
    expect(screen.getByText("Historical estimates · 1")).toBeInTheDocument();
    expect(screen.getByText(/Compressor upgrade: CAD 1,000,000 baseline/)).toBeInTheDocument();
    expect(screen.getByText("Measured vendor records · 1")).toBeInTheDocument();
    expect(screen.getByText("Measured Fabrication Ltd.")).toBeInTheDocument();
    expect(screen.getByText("Startup problems · 1")).toBeInTheDocument();
    expect(screen.getByText(/Seal failure at first start/)).toBeInTheDocument();
    expect(
      screen.getByText(/does not authorize work/i),
    ).toBeInTheDocument();
  });
});
