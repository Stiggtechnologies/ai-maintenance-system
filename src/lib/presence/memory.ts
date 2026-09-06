/**
 * Meet Sync session + Decision Case continuity.
 *
 * Session transcript lives in sessionStorage (tab-scoped, user-keyed).
 * Decision Case identity is read from the existing Sync draft store — the
 * same localStorage key the Decision Workspace uses. This is not an Obsidian
 * vault, not a parallel queue, and it never silently binds a seed/demo case.
 */
import {
  DECISION_CASE_STORAGE_KEY,
  writeDecisionCases,
  type DecisionCase,
  type DecisionMessage,
} from "../decision-case";
import {
  filterSeedCasesForOrgSession,
  promptNamesConcreteSubject,
  resolveDecisionAskBinding,
  signalsTopicChange,
} from "../decision-case-honesty";
import { readStoredDecisionDrafts } from "../decision-case-drafts";

export const PRESENCE_MEMORY_KEY_PREFIX = "syncai.presence.session.v1:";

export interface PresenceSessionTurn {
  id: string;
  role: "user" | "sync";
  text: string;
}

export interface PresenceSessionMemory {
  messages: PresenceSessionTurn[];
  subject: string | null;
  caseId: string | null;
}

export interface PresenceDecisionContext {
  bound: boolean;
  caseId: string | null;
  caseNumber: string | null;
  asset: string | null;
  version: string | null;
  contextLines: string[];
}

const EMPTY_MEMORY: PresenceSessionMemory = {
  messages: [],
  subject: null,
  caseId: null,
};

export function presenceMemoryStorageKey(userId: string): string {
  return `${PRESENCE_MEMORY_KEY_PREFIX}${userId}`;
}

export function readPresenceSessionMemory(
  storage: Pick<Storage, "getItem">,
  userId: string,
): PresenceSessionMemory {
  if (!userId) return { ...EMPTY_MEMORY, messages: [] };
  try {
    const raw = storage.getItem(presenceMemoryStorageKey(userId));
    const parsed = raw ? (JSON.parse(raw) as PresenceSessionMemory) : null;
    if (!parsed || !Array.isArray(parsed.messages)) {
      return { ...EMPTY_MEMORY, messages: [] };
    }
    return {
      messages: parsed.messages.filter(
        (item) =>
          item &&
          (item.role === "user" || item.role === "sync") &&
          typeof item.text === "string" &&
          typeof item.id === "string",
      ),
      subject:
        typeof parsed.subject === "string" && parsed.subject.trim()
          ? parsed.subject.trim()
          : null,
      caseId:
        typeof parsed.caseId === "string" && parsed.caseId.trim()
          ? parsed.caseId.trim()
          : null,
    };
  } catch {
    return { ...EMPTY_MEMORY, messages: [] };
  }
}

export function writePresenceSessionMemory(
  storage: Pick<Storage, "setItem">,
  userId: string,
  memory: PresenceSessionMemory,
): void {
  if (!userId) return;
  storage.setItem(
    presenceMemoryStorageKey(userId),
    JSON.stringify({
      messages: memory.messages.slice(-24),
      subject: memory.subject,
      caseId: memory.caseId,
    } satisfies PresenceSessionMemory),
  );
}

export function nextPresenceSubject(
  question: string,
  current: string | null,
): string | null {
  const trimmed = question.trim();
  if (!trimmed) return current;
  if (signalsTopicChange(trimmed) && !promptNamesConcreteSubject(trimmed)) {
    return current;
  }
  if (promptNamesConcreteSubject(trimmed)) {
    return trimmed.slice(0, 160);
  }
  return current;
}

export function resolvePresenceDecisionContext(
  storage: Pick<Storage, "getItem">,
  sessionCaseId: string | null = null,
): PresenceDecisionContext {
  const stored = filterSeedCasesForOrgSession(
    readStoredDecisionDrafts(storage),
  );
  const preferred =
    (sessionCaseId
      ? stored.find((item) => item.id === sessionCaseId)
      : undefined) ??
    stored.find((item) => resolveDecisionAskBinding(item).bound) ??
    stored[0] ??
    null;
  const binding = resolveDecisionAskBinding(preferred);
  if (!binding.bound) {
    return {
      bound: false,
      caseId: preferred?.id ?? null,
      caseNumber: null,
      asset: null,
      version: null,
      contextLines: [
        "No decision case is selected.",
        "Stay general. Do not assume a demo, reference, or seed case.",
        "Do not invent a plant, asset, or case subject the user has not named.",
      ],
    };
  }
  return {
    bound: true,
    caseId: binding.caseId,
    caseNumber: binding.decisionCase.caseNumber,
    asset: binding.decisionCase.asset,
    version: binding.decisionCase.version,
    contextLines: [
      `Decision Case ${binding.decisionCase.caseNumber} ${binding.decisionCase.version}`,
      `Asset: ${binding.decisionCase.asset}`,
      "Use this case only for case claims. Do not invent additional plant readings.",
    ],
  };
}

export function appendPresenceTurnToDecisionCase(
  storage: Pick<Storage, "getItem" | "setItem">,
  input: {
    caseId: string | null;
    question: string;
    reply: string;
  },
): boolean {
  if (!input.caseId) return false;
  const stored = readStoredDecisionDrafts(storage);
  const index = stored.findIndex((item) => item.id === input.caseId);
  if (index < 0) return false;
  if (filterSeedCasesForOrgSession([stored[index]]).length === 0) return false;

  const now = new Date().toISOString();
  const userMessage: DecisionMessage = {
    id: `presence-user-${Date.now()}`,
    role: "user",
    author: "You",
    text: input.question,
    createdAt: now,
    meta: "Meet Sync",
  };
  const syncMessage: DecisionMessage = {
    id: `presence-sync-${Date.now() + 1}`,
    role: "assistant",
    author: "SyncAI",
    text: input.reply,
    createdAt: now,
    meta: "Meet Sync · recommend is not authorize",
  };
  const next: DecisionCase = {
    ...stored[index],
    messages: [...stored[index].messages, userMessage, syncMessage],
    updatedAt: now,
  };
  const cases = stored.map((item, i) => (i === index ? next : item));
  writeDecisionCases(storage, cases, DECISION_CASE_STORAGE_KEY);
  return true;
}
