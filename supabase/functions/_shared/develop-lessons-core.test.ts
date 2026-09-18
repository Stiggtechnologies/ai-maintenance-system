import { describe, expect, it } from "vitest";
import {
  analyzeApplicableLessons,
  type LessonsAgentScreen,
} from "./develop-lessons-core";

const screen: LessonsAgentScreen = {
  caseId: "target-case",
  lifecycleType: "brownfield",
  count: 1,
  lessons: [
    {
      id: "lesson-1",
      title: "Freeze vendor data before IFC issue",
      failureModeKey: "project_delivery.late_vendor_data",
      cause: "Vendor data dates were not tied to the engineering release plan.",
      correctiveAction:
        "Add vendor-data dates and acceptance owners to the release plan.",
      applicability:
        "Brownfield rotating-equipment projects with vendor interfaces.",
      sourceCaseId: "source-case",
      sourceLifecycleType: "brownfield",
      matchReason: "source case shares this lifecycle type",
      createdAt: "2026-09-01T00:00:00Z",
    },
  ],
  basis: "Deterministic match on canonical project lessons.",
};

describe("Lessons Agent governed analysis", () => {
  it("copies the deterministic findings with canonical record provenance", () => {
    const result = analyzeApplicableLessons(screen);
    expect(result.verdict).toBe("applicable_lessons_identified");
    expect(result.lessonCount).toBe(1);
    expect(result.findings[0]).toMatchObject({
      lessonId: "lesson-1",
      sourceRefs: ["learning_events:lesson-1", "development_cases:source-case"],
    });
    expect(result.evidenceRefs).toEqual([
      "development_cases:target-case",
      "learning_events:lesson-1",
      "development_cases:source-case",
    ]);
  });

  it("does not turn an empty tenant history into evidence that no lesson exists", () => {
    const result = analyzeApplicableLessons({
      ...screen,
      count: 0,
      lessons: [],
      emptyReason: "0 applicable lessons — no recorded project lesson matched",
    });
    expect(result.verdict).toBe("none_identified");
    expect(result.lessonCount).toBe(0);
    expect(result.headline).toContain("0 applicable lessons");
    expect(result.limitations.join(" ")).toContain("does not prove");
  });

  it("uses the returned lesson array rather than trusting a caller count", () => {
    const result = analyzeApplicableLessons({ ...screen, count: 23 });
    expect(result.lessonCount).toBe(1);
    expect(result.headline).toContain("1 applicable project lesson");
  });
});
