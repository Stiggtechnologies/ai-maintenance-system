// Deterministic half of D12.17. It explains the canonical project-history
// screening result without changing a lesson, standard, framework or case.

export interface LessonsAgentScreen {
  caseId: string;
  lifecycleType: string;
  count: number;
  lessons: Array<{
    id: string;
    title: string;
    failureModeKey: string;
    cause: string;
    correctiveAction: string;
    applicability: string;
    sourceCaseId: string;
    sourceLifecycleType: string | null;
    matchReason: string;
    createdAt: string;
  }>;
  emptyReason?: string | null;
  basis?: string;
}

export interface LessonsAgentAnalysis {
  verdict: "applicable_lessons_identified" | "none_identified";
  headline: string;
  lessonCount: number;
  findings: Array<{
    lessonId: string;
    title: string;
    failureModeKey: string;
    cause: string;
    correctiveAction: string;
    applicability: string;
    matchReason: string;
    sourceLifecycleType: string | null;
    sourceRefs: string[];
  }>;
  evidenceRefs: string[];
  basis: string;
  limitations: string[];
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export function analyzeApplicableLessons(
  screen: LessonsAgentScreen,
): LessonsAgentAnalysis {
  const findings = screen.lessons.map((lesson) => ({
    lessonId: lesson.id,
    title: lesson.title,
    failureModeKey: lesson.failureModeKey,
    cause: lesson.cause,
    correctiveAction: lesson.correctiveAction,
    applicability: lesson.applicability,
    matchReason: lesson.matchReason,
    sourceLifecycleType: lesson.sourceLifecycleType,
    sourceRefs: [
      `learning_events:${lesson.id}`,
      `development_cases:${lesson.sourceCaseId}`,
    ],
  }));
  const lessonCount = findings.length;
  const verdict =
    lessonCount > 0 ? "applicable_lessons_identified" : "none_identified";
  const headline =
    lessonCount > 0
      ? `${lessonCount} applicable project lesson${lessonCount === 1 ? "" : "s"} identified from recorded history.`
      : (screen.emptyReason ??
        "0 applicable lessons identified in this organization's recorded project history.");

  return {
    verdict,
    headline,
    lessonCount,
    findings,
    evidenceRefs: unique([
      `development_cases:${screen.caseId}`,
      ...findings.flatMap((finding) => finding.sourceRefs),
    ]),
    basis:
      screen.basis ??
      "Deterministic comparison of canonical learning_events against the new case.",
    limitations: [
      "Applicability is a deterministic screening result for human review, not an adopted requirement or approved action.",
      lessonCount === 0
        ? "No match means no matching lesson was found in the recorded tenant history; it does not prove that no relevant lesson exists."
        : "The named human reviewer must confirm each lesson's applicability and decide whether any corrective action belongs in this case.",
      "The agent cannot create or modify a lesson, standard, framework, requirement, decision, approval or project record.",
    ],
  };
}
