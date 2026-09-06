/**
 * Sync-native Meet Sync vault shape.
 *
 * Behavior reference only (persistent markdown/JSON notes outside the model).
 * Sync-native notes, not a third-party vault and not a parallel case store.
 * Signed-in org notes only. Recommend ≠ authorize.
 */

import type { PresenceBoothMessage, PresenceSessionMemory } from "./memory";

export const VAULT_GOVERNANCE = "recommend_not_authorize" as const;

export const VAULT_PATHS = {
  index: "index.md",
  session: "session.json",
} as const;

export type PresenceVaultKind =
  "index" | "session" | "daily_meeting" | "decision_continuity";

export interface PresenceVaultDocument {
  path: string;
  kind: PresenceVaultKind;
  title: string;
  bodyMarkdown: string;
  bodyJson: Record<string, unknown>;
  decisionCaseId: string | null;
}

export interface PresenceVaultWriteInput {
  memory: PresenceSessionMemory;
  caseId?: string | null;
  caseNumber?: string | null;
  asset?: string | null;
  now?: Date;
}

export function meetingNotePath(day: Date): string {
  return `meetings/${utcDayStamp(day)}.md`;
}

export function decisionNotePath(caseId: string): string | null {
  const id = caseId.trim();
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(id)) return null;
  return `decisions/${id}.md`;
}

export function profileOrganizationId(profile: unknown): string | null {
  if (!profile || typeof profile !== "object") return null;
  const id = (profile as { organization_id?: unknown }).organization_id;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

export function shouldHydrateFromVault(
  tab: PresenceSessionMemory,
  vault: PresenceSessionMemory | null,
): boolean {
  if (!vault) return false;
  if (vault.messages.length === 0 && !vault.lastSubject) return false;
  if (tab.messages.length === 0) return true;
  return vault.messages.length >= tab.messages.length;
}

export function buildPresenceVaultDocuments(
  input: PresenceVaultWriteInput,
): PresenceVaultDocument[] {
  const now = input.now ?? new Date();
  const memory: PresenceSessionMemory = {
    messages: input.memory.messages.slice(-24),
    lastSubject: input.memory.lastSubject,
  };
  const docs = [
    buildIndexDocument(memory, now, input),
    buildSessionDocument(memory, input),
    buildDailyMeetingDocument(memory, now, input),
  ];
  const decision = buildDecisionContinuityDocument(memory, input);
  if (decision) docs.push(decision);
  return docs;
}

export function parseSessionDocument(
  value: unknown,
): PresenceSessionMemory | null {
  if (!value || typeof value !== "object") return null;
  const row = value as {
    body_json?: unknown;
    bodyJson?: unknown;
  };
  const json = asObject(row.body_json) ?? asObject(row.bodyJson);
  if (!json) return null;
  const messages = Array.isArray(json.messages)
    ? json.messages.filter(isPresenceMessage)
    : [];
  const lastSubject =
    typeof json.lastSubject === "string" && json.lastSubject.trim()
      ? json.lastSubject.trim().slice(0, 80)
      : null;
  if (messages.length === 0 && !lastSubject) return null;
  return { messages, lastSubject };
}

function buildSessionDocument(
  memory: PresenceSessionMemory,
  input: PresenceVaultWriteInput,
): PresenceVaultDocument {
  const bodyJson = governanceJson({
    lastSubject: memory.lastSubject,
    messages: memory.messages,
    caseId: input.caseId ?? null,
    caseNumber: input.caseNumber ?? null,
    asset: input.asset ?? null,
  });
  return {
    path: VAULT_PATHS.session,
    kind: "session",
    title: "Meet Sync session memory",
    bodyMarkdown: renderSessionMarkdown(memory, input),
    bodyJson,
    decisionCaseId: input.caseId ?? null,
  };
}

function buildDailyMeetingDocument(
  memory: PresenceSessionMemory,
  now: Date,
  input: PresenceVaultWriteInput,
): PresenceVaultDocument {
  const day = utcDayStamp(now);
  return {
    path: meetingNotePath(now),
    kind: "daily_meeting",
    title: `Meet Sync — ${day}`,
    bodyMarkdown: renderDailyMarkdown(memory, day, input),
    bodyJson: governanceJson({
      day,
      lastSubject: memory.lastSubject,
      messages: memory.messages,
      caseId: input.caseId ?? null,
    }),
    decisionCaseId: input.caseId ?? null,
  };
}

function buildDecisionContinuityDocument(
  memory: PresenceSessionMemory,
  input: PresenceVaultWriteInput,
): PresenceVaultDocument | null {
  const caseId = input.caseId?.trim() ?? "";
  const path = decisionNotePath(caseId);
  if (!path) return null;
  const caseNumber = input.caseNumber?.trim() || caseId;
  return {
    path,
    kind: "decision_continuity",
    title: `Decision Case ${caseNumber} continuity`,
    bodyMarkdown: renderDecisionMarkdown(memory, input, caseNumber),
    bodyJson: governanceJson({
      caseId,
      caseNumber,
      asset: input.asset ?? null,
      lastSubject: memory.lastSubject,
      messages: memory.messages,
    }),
    decisionCaseId: caseId,
  };
}

function buildIndexDocument(
  memory: PresenceSessionMemory,
  now: Date,
  input: PresenceVaultWriteInput,
): PresenceVaultDocument {
  const paths = [VAULT_PATHS.session, meetingNotePath(now)];
  const decisionPath = input.caseId ? decisionNotePath(input.caseId) : null;
  if (decisionPath) paths.push(decisionPath);
  return {
    path: VAULT_PATHS.index,
    kind: "index",
    title: "Meet Sync vault index",
    bodyMarkdown: [
      "# Meet Sync notes",
      "",
      "Signed-in continuity for Decision Case work and meeting notes.",
      "I recommend, I do not authorize. This vault does not approve or execute.",
      "",
      memory.lastSubject
        ? `Last subject: ${memory.lastSubject}`
        : "Last subject: none yet.",
      "",
      "## Paths",
      ...paths.map((path) => `- \`${path}\``),
      "",
    ].join("\n"),
    bodyJson: governanceJson({
      lastSubject: memory.lastSubject,
      paths,
    }),
    decisionCaseId: input.caseId ?? null,
  };
}

function renderSessionMarkdown(
  memory: PresenceSessionMemory,
  input: PresenceVaultWriteInput,
): string {
  return [
    "# Meet Sync session",
    "",
    "I recommend, I do not authorize.",
    input.caseNumber
      ? `Decision Case: ${input.caseNumber}${input.asset ? ` — ${input.asset}` : ""}`
      : "Decision Case: unbound. Named subjects stay provisional.",
    memory.lastSubject
      ? `Last subject: ${memory.lastSubject}`
      : "Last subject: none yet.",
    "",
    ...renderTurns(memory.messages),
    "",
  ].join("\n");
}

function renderDailyMarkdown(
  memory: PresenceSessionMemory,
  day: string,
  input: PresenceVaultWriteInput,
): string {
  return [
    `# Meet Sync — ${day}`,
    "",
    "I recommend, I do not authorize.",
    input.caseNumber
      ? `Decision Case: ${input.caseNumber}`
      : "Decision Case: unbound.",
    memory.lastSubject
      ? `Last subject: ${memory.lastSubject}`
      : "Last subject: none yet.",
    "",
    "## Turns",
    ...renderTurns(memory.messages),
    "",
  ].join("\n");
}

function renderDecisionMarkdown(
  memory: PresenceSessionMemory,
  input: PresenceVaultWriteInput,
  caseNumber: string,
): string {
  return [
    `# Decision Case ${caseNumber}`,
    "",
    "Continuity notes only. This is not the Decision Case record and not an approval.",
    "I recommend, I do not authorize.",
    input.asset ? `Asset: ${input.asset}` : "Asset: not bound on this note.",
    memory.lastSubject
      ? `Last subject: ${memory.lastSubject}`
      : "Last subject: none yet.",
    "",
    "## Recent turns",
    ...renderTurns(memory.messages),
    "",
  ].join("\n");
}

function renderTurns(messages: PresenceBoothMessage[]): string[] {
  if (messages.length === 0) return ["(no turns yet)"];
  return messages.flatMap((message) => [
    `### ${message.role === "user" ? "You" : "Sync"}`,
    message.text.replace(/\s+/g, " ").trim(),
    "",
  ]);
}

function governanceJson(
  rest: Record<string, unknown>,
): Record<string, unknown> {
  return { ...rest, governance: VAULT_GOVERNANCE };
}

function utcDayStamp(day: Date): string {
  return day.toISOString().slice(0, 10);
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
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
