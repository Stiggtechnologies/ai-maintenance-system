import type { DecisionCase } from "./decision-case";
import "./decision-case-governance";

/** Canonical authority wins on recovery; retain only unrecorded dialogue. */
export function reconcileLoadedDecisionConversation(
  local: DecisionCase,
  saved: DecisionCase,
): DecisionCase {
  if (local.id !== saved.id) return saved;
  if ((local.revision ?? 0) > (saved.revision ?? 0)) return local;
  const savedIds = new Set(saved.messages.map((message) => message.id));
  const unrecorded = local.messages.filter(
    (message) =>
      !savedIds.has(message.id) &&
      (message.role === "user" || message.role === "assistant") &&
      !message.actorId &&
      !message.actorRole,
  );
  if (!unrecorded.length) return saved;
  return {
    ...saved,
    messages: [...saved.messages, ...unrecorded],
    tokensUsed: Math.max(saved.tokensUsed, local.tokensUsed),
  };
}

/** Apply a serialized save receipt without erasing edits made during delivery. */
export function reconcileDecisionCaseSave(
  current: DecisionCase,
  submitted: DecisionCase,
  saved: DecisionCase,
): DecisionCase {
  if (current.id !== saved.id || submitted.id !== saved.id) return current;
  if ((current.revision ?? 0) > (saved.revision ?? 0)) return current;
  if (JSON.stringify(current) === JSON.stringify(submitted)) return saved;
  const savedIds = new Set(saved.messages.map((message) => message.id));
  const appended = current.messages.filter(
    (message) => !savedIds.has(message.id),
  );
  return {
    ...current,
    revision: saved.revision,
    messages: [...saved.messages, ...appended],
    tokensUsed:
      saved.tokensUsed + Math.max(0, current.tokensUsed - submitted.tokensUsed),
  };
}
