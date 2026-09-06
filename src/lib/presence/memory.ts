/**
 * Meet Sync session + Decision Case continuity.
 *
 * Uses the existing Decision Case draft store and honesty helpers.
 * sessionStorage holds this-tab transcript only — not a system of record,
 * not an Obsidian vault, not a parallel case store.
 * Seed / demo cases are not auto-bound for a signed-in org session.
 */

import type { DecisionCase } from "../decision-case";
import { readStoredDecisionDrafts } from "../decision-case-drafts";
import {
  buildDecisionAskContextPack,
  filterSeedCasesForOrgSession,
  promptNamesConcreteSubject,
  resolveDecisionAskBinding,
} from "../decision-case-honesty";
export interface PresenceBoothMessage {
  id: string;
  role: "user" | "sync";
  text: string;
}

export const PRESENCE_MEMORY_KEY_PREFIX = "syncai.presence.memory:";

export interface PresenceSessionMemory {
  messages: PresenceBoothMessage[];
  lastSubject: string | null;
}

export interface PresenceWorkingSubject {
  bound: boolean;
  caseId: string | null;
  caseNumber: string | null;
  asset: string | null;
  contextLines: string[];
  sessionSubject: string | null;
}

const EMPTY_MEMORY: PresenceSessionMemory = {
  messages: [],
  lastSubject: null,
};

export function presenceMemoryKey(userId: string): string {
  return `${PRESENCE_MEMORY_KEY_PREFIX}${userId}`;
}

export function readPresenceMemory(
  storage: Pick<Storage, "getItem">,
  userId: string,
): PresenceSessionMemory {
  if (!userId) return { ...EMPTY_MEMORY };
  try {
    const raw = storage.getItem(presenceMemoryKey(userId));
    if (!raw) return { ...EMPTY_MEMORY };
    const parsed = JSON.parse(raw) as Partial<PresenceSessionMemory>;
    const messages = Array.isArray(parsed.messages)
      ? parsed.messages.filter(isPresenceMessage)
      : [];
    const lastSubject =
      typeof parsed.lastSubject === "string" && parsed.lastSubject.trim()
        ? parsed.lastSubject.trim().slice(0, 80)
        : null;
    return { messages, lastSubject };
  } catch {
    return { ...EMPTY_MEMORY };
  }
}

export function writePresenceMemory(
  storage: Pick<Storage, "setItem">,
  userId: string,
  memory: PresenceSessionMemory,
): void {
  if (!userId) return;
  storage.setItem(
    presenceMemoryKey(userId),
    JSON.stringify({
      messages: memory.messages.slice(-24),
      lastSubject: memory.lastSubject,
    }),
  );
}

export function extractSessionSubjectLabel(question: string): string | null {
  const trimmed = question.trim();
  if (!trimmed || !promptNamesConcreteSubject(trimmed)) return null;
  return trimmed.slice(0, 80);
}

export function rememberNamedSubject(
  question: string,
  current: string | null,
): string | null {
  return extractSessionSubjectLabel(question) ?? current;
}

export function sessionMemoryLines(
  memory: PresenceSessionMemory,
  limit = 4,
): string[] {
  const recent = memory.messages.slice(-limit);
  if (recent.length === 0) return [];
  const lines = recent.map((message) => {
    const who = message.role === "user" ? "You" : "Sync";
    return `${who}: ${message.text.replace(/\s+/g, " ").trim().slice(0, 220)}`;
  });
  if (memory.lastSubject) {
    return [`Last subject: ${memory.lastSubject}`, ...lines];
  }
  return lines;
}

export function loadStoredPresenceCases(
  storage: Pick<Storage, "getItem">,
): DecisionCase[] {
  return filterSeedCasesForOrgSession(readStoredDecisionDrafts(storage));
}

export function resolvePresenceWorkingSubject(
  stored: DecisionCase[],
  sessionSubject: string | null = null,
): PresenceWorkingSubject {
  const orgCases = filterSeedCasesForOrgSession(stored);
  const boundCase = pickLatestBoundCase(orgCases);
  const pack = buildDecisionAskContextPack(boundCase);
  if (!boundCase || !pack.injectCase) {
    return {
      bound: false,
      caseId: null,
      caseNumber: null,
      asset: null,
      contextLines: pack.contextLines,
      sessionSubject: sessionSubject?.trim() ? sessionSubject.trim() : null,
    };
  }
  return {
    bound: true,
    caseId: pack.caseId,
    caseNumber: boundCase.caseNumber,
    asset: boundCase.asset,
    contextLines: pack.contextLines,
    sessionSubject: sessionSubject?.trim() ? sessionSubject.trim() : null,
  };
}

export function describePresenceWork(subject: PresenceWorkingSubject | null): string {
  if (subject?.bound && subject.caseNumber && subject.asset) {
    return `We're on Decision Case ${subject.caseNumber} for ${subject.asset}.`;
  }
  if (subject?.sessionSubject) {
    return `Last we discussed: ${subject.sessionSubject}. That remains provisional until a Decision Case is bound.`;
  }
  return "No Decision Case is bound yet — name the asset or subject. Analysis stays provisional.";
}

function pickLatestBoundCase(stored: DecisionCase[]): DecisionCase | null {
  const bound = stored.filter((item) => resolveDecisionAskBinding(item).bound);
  if (bound.length === 0) return null;
  return [...bound].sort(
    (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
  )[0];
}

function isPresenceMessage(value: unknown): value is PresenceBoothMessage {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<PresenceBoothMessage>;
  return (
    typeof row.id === "string" &&
    (row.role === "user" || row.role === "sync") &&
    typeof row.text === "string"
  );
}
