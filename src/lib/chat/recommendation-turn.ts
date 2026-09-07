import type {
  ApprovalStatus,
  DecisionApproval,
  DecisionEvidence,
  DecisionMessage,
} from "../decision-case";

export interface EstablishedFact {
  id: string;
  fact: string;
  sourceTitle: string;
  record: string;
  lineage: string;
  sourceSystem: string;
}

export function isRecommendationTurn(message: DecisionMessage): boolean {
  return (
    message.role === "assistant" && /recommendation/i.test(message.meta ?? "")
  );
}

export function establishedFromEvidence(
  evidence: DecisionEvidence[],
): EstablishedFact[] {
  return evidence
    .filter((item) => item.quality === "high" || item.quality === "medium")
    .map((item) => ({
      id: item.id,
      fact: item.finding || item.summary,
      sourceTitle: item.title,
      record: item.record,
      lineage: item.lineage,
      sourceSystem: item.sourceSystem,
    }));
}

export function notProvenFromEvidence(evidence: DecisionEvidence[]): string[] {
  return evidence
    .filter((item) => item.quality === "missing" || item.quality === "conflict")
    .map((item) => item.finding || item.state || item.summary);
}

export function reviewingAuthority(
  approvals: DecisionApproval[],
): DecisionApproval | undefined {
  return approvals.find((item) => item.status === "reviewing");
}

export function isNamedAuthority(
  viewerName: string | null | undefined,
  authorityName: string,
): boolean {
  if (!viewerName?.trim()) return false;
  return viewerName.trim().toLowerCase() === authorityName.trim().toLowerCase();
}

export function frozenDisposition(
  approvals: DecisionApproval[],
): ApprovalStatus | null {
  const decided = approvals.find(
    (item) =>
      item.status === "approved" ||
      item.status === "changes_requested" ||
      item.status === "delegated" ||
      item.status === "rejected",
  );
  return decided?.status ?? null;
}

export function conversationIsEmpty(messages: DecisionMessage[]): boolean {
  return !messages.some(
    (item) => item.role === "user" || item.role === "assistant",
  );
}

/** After Approve, show in-thread LEARN. Persist is ConversationLearn's job. */
export function shouldShowLearnPointer(approvals: DecisionApproval[]): boolean {
  return approvals.some((item) => item.status === "approved");
}

export function delegateCandidates(
  approvals: DecisionApproval[],
  currentName?: string,
): DecisionApproval[] {
  return approvals.filter(
    (item) =>
      item.name !== currentName &&
      item.name !== "SyncAI analysis" &&
      item.status !== "complete",
  );
}
