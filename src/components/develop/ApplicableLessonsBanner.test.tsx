import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  runLessonsAgent,
  screenApplicableProjectLessons,
} from "../../services/developService";
import { ApplicableLessonsBanner } from "./RealizePanels";

vi.mock("../../services/developService", () => ({
  screenApplicableProjectLessons: vi.fn(),
  runLessonsAgent: vi.fn(),
}));

vi.mock("../../services/operatingLoopService", () => ({
  verifyValueMetric: vi.fn(),
}));

describe("ApplicableLessonsBanner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(screenApplicableProjectLessons).mockResolvedValue({
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
});
