import { supabase } from "../lib/supabase";

export interface NorthStarLeg {
  key: string;
  label: string;
  count: number;
  complete: boolean;
}

export interface ArchitecturalNorthStar {
  caseId: string;
  caseTitle: string;
  complete: boolean;
  gaps: string[];
  legs: NorthStarLeg[];
  relationshipCount: number;
  outcomes: Array<{
    id: string;
    title: string;
    evidenceItemId: string;
    createdAt: string;
  }>;
  lessons: Array<{ id: string; title: string; createdAt: string }>;
  candidateNextDecisions: Array<{
    id: string;
    question: string;
    caseId: string;
    caseTitle: string;
    createdAt: string;
  }>;
  learningDecisionLinks: Array<{
    id: string;
    outcomeEventId: string;
    lessonEventId: string;
    nextDecisionId: string;
    evidenceItemId: string;
    basis: string;
    createdAt: string;
  }>;
  decisionBoundary: string;
}

function unwrap<T>(data: T | null, error: { message: string } | null): T {
  if (error) throw new Error(error.message);
  const payload = data as T & { error?: string };
  if (payload?.error) throw new Error(payload.error);
  if (!data)
    throw new Error("The architectural north-star read returned no result");
  return data;
}

export async function getCaseArchitecturalNorthStar(caseId: string) {
  const { data, error } = await supabase.rpc(
    "get_case_architectural_north_star",
    { p_case_id: caseId },
  );
  return unwrap<ArchitecturalNorthStar>(data, error);
}

export async function linkCaseLearningToNextDecision(input: {
  caseId: string;
  outcomeEventId: string;
  lessonEventId: string;
  nextDecisionId: string;
  evidenceItemId: string;
  basis: string;
}) {
  const { data, error } = await supabase.rpc(
    "link_case_learning_to_next_decision",
    {
      p_case_id: input.caseId,
      p_outcome_event_id: input.outcomeEventId,
      p_lesson_event_id: input.lessonEventId,
      p_next_decision_id: input.nextDecisionId,
      p_evidence_item_id: input.evidenceItemId,
      p_basis: input.basis,
    },
  );
  return unwrap<{ linkId: string; relationship: string }>(data, error);
}
