/**
 * Local decision-case DRAFTS — the visible staging layer for ruling 15 / D13.07.
 *
 * These helpers live OUTSIDE src/lib/decision-case.ts deliberately. That file is
 * an RE-2026.08 protected surface (benchmarks/reliability-engineer/re-2026.08/
 * manifest.json), and changing it requires a captured reference and a
 * qualification report — machinery that exists precisely so the Reliability
 * Engineer's behaviour cannot drift unmeasured. Draft staging is workspace
 * plumbing, not RE behaviour, so it belongs where the floor does not have to
 * care about it. This module IMPORTS from the protected file (safe for the
 * closure walk: the walk protects what protected entrypoints import, and
 * decision-case.ts imports nothing new); it is imported only by pages.
 *
 * The rules the helpers encode, from D13.07: localStorage is never a system of
 * record. The reader returns exactly what the browser holds — no seeding, no
 * fabricated case presented as a record; for most users that is nothing.
 * Removal is a user-visible act (import completed, or an explicit discard) —
 * never called silently.
 */
import { DECISION_CASE_STORAGE_KEY, type DecisionCase } from "./decision-case";

export function readStoredDecisionDrafts(
  storage: Pick<Storage, "getItem">,
  storageKey = DECISION_CASE_STORAGE_KEY,
): DecisionCase[] {
  try {
    const saved = storage.getItem(storageKey);
    const parsed = saved ? (JSON.parse(saved) as DecisionCase[]) : null;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function removeStoredDecisionDraft(
  storage: Pick<Storage, "getItem" | "setItem">,
  draftId: string,
  storageKey = DECISION_CASE_STORAGE_KEY,
) {
  const remaining = readStoredDecisionDrafts(storage, storageKey).filter(
    (draft) => draft.id !== draftId,
  );
  storage.setItem(storageKey, JSON.stringify(remaining));
}
