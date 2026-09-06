/**
 * Durable Meet Sync vault — Obsidian-style markdown notes in the browser.
 *
 * Adapted from third_party/jaredrhod/ai-memory-vault (CC BY-SA 4.0,
 * Copyright 2026 Jared Rhodenizer). Sync identity replaces the shipped
 * Jarvis personality. This is conversation memory for the signed-in user,
 * not a Decision Case system of record and not the Obsidian desktop app.
 * Recommend ≠ authorize. No plant execute.
 */

import type { PresenceBoothMessage, PresenceSessionMemory } from "./memory";

export const PRESENCE_VAULT_KEY_PREFIX = "syncai.presence.vault:";
export const VAULT_INDEX_PATH = "VAULT-INDEX.md";
export const VAULT_MEMORY_PATH = "MEMORY.md";
export const VAULT_IDENTITY_PATH = "Meet Sync/IDENTITY.md";
export const VAULT_SESSION_PATH = "Meet Sync/SESSION.md";
export const IDB_NAME = "syncai-presence-vault";
export const IDB_STORE = "vaults";

export interface VaultNote {
  path: string;
  content: string;
  updatedAt: string;
}

export interface PresenceVault {
  version: 1;
  notes: VaultNote[];
}

export interface BoothTurnPersist {
  messages: PresenceBoothMessage[];
  lastSubject: string | null;
  question?: string;
  reply?: string;
}

const EMPTY_VAULT: PresenceVault = { version: 1, notes: [] };

export function presenceVaultKey(userId: string): string {
  return `${PRESENCE_VAULT_KEY_PREFIX}${userId}`;
}

export function dailyNotePath(now: Date): string {
  return `01 - Daily Notes/${now.toISOString().slice(0, 10)}.md`;
}

export function seedSyncVault(
  givenName: string | null,
  now: Date = new Date(),
): PresenceVault {
  const visitor = givenName?.trim() || "the signed-in visitor";
  const iso = now.toISOString();
  return {
    version: 1,
    notes: [
      {
        path: VAULT_INDEX_PATH,
        updatedAt: iso,
        content: [
          "# Meet Sync vault index",
          "",
          "Attribution: structure adapted from Jared Rhodenizer's AI Memory Vault",
          "(https://github.com/jaredrhod/ai-memory-vault), CC BY-SA 4.0.",
          "",
          "## Identity",
          "",
          "You are **Sync**, the Reliability Engineer, meeting moderator for this",
          "signed-in industrial workspace. Professional tone. Recommend is not authorize.",
          "Do not execute plant actions. Do not become a cheeky desktop assistant.",
          "",
          `Visitor given name on file: ${visitor}. Do not invent a different name.`,
          "",
          "## Map",
          "",
          "- `MEMORY.md` — pointer: this vault is Meet Sync conversation memory.",
          "- `Meet Sync/IDENTITY.md` — standing rules.",
          "- `Meet Sync/SESSION.md` — durable transcript.",
          "- `01 - Daily Notes/` — append-only daily log.",
          "",
          "Decision Cases stay on the existing draft store. This vault does not",
          "replace them.",
        ].join("\n"),
      },
      {
        path: VAULT_MEMORY_PATH,
        updatedAt: iso,
        content: [
          "# Memory pointer",
          "",
          "There is no separate sessionStorage-only memory layer for Meet Sync.",
          "The single Meet Sync conversation source of truth in this browser is",
          "this vault (localStorage + IndexedDB), keyed by the signed-in user.",
          "",
          "Write new facts to `Meet Sync/SESSION.md` and today's daily note.",
          "Do not invent plant readings.",
        ].join("\n"),
      },
      {
        path: VAULT_IDENTITY_PATH,
        updatedAt: iso,
        content: [
          "# Sync — Reliability Engineer",
          "",
          "- Recommend ≠ authorize.",
          "- No plant execute.",
          "- Evidence only. Name uncertainty.",
          "- Professional meeting-moderator tone. Not cheeky.",
          "- Stay in maintenance, reliability, and industrial Decision Case work.",
        ].join("\n"),
      },
      {
        path: dailyNotePath(now),
        updatedAt: iso,
        content: `# ${now.toISOString().slice(0, 10)}\n\n- Vault opened for Meet Sync.\n`,
      },
      {
        path: VAULT_SESSION_PATH,
        updatedAt: iso,
        content: "# Meet Sync session\n\n",
      },
    ],
  };
}

export function readPresenceVault(
  storage: Pick<Storage, "getItem">,
  userId: string,
): PresenceVault {
  if (!userId) return { ...EMPTY_VAULT, notes: [] };
  try {
    const raw = storage.getItem(presenceVaultKey(userId));
    if (!raw) return { ...EMPTY_VAULT, notes: [] };
    const parsed = JSON.parse(raw) as Partial<PresenceVault>;
    const notes = Array.isArray(parsed.notes)
      ? parsed.notes.filter(isVaultNote)
      : [];
    return { version: 1, notes };
  } catch {
    return { ...EMPTY_VAULT, notes: [] };
  }
}

export function writePresenceVault(
  storage: Pick<Storage, "setItem">,
  userId: string,
  vault: PresenceVault,
): void {
  if (!userId) return;
  storage.setItem(
    presenceVaultKey(userId),
    JSON.stringify({
      version: 1,
      notes: vault.notes.slice(-80),
    }),
  );
}

export function ensureSeededVault(
  storage: Pick<Storage, "getItem" | "setItem">,
  userId: string,
  givenName: string | null,
  now: Date = new Date(),
): PresenceVault {
  const existing = readPresenceVault(storage, userId);
  if (existing.notes.length > 0) return existing;
  const seeded = seedSyncVault(givenName, now);
  writePresenceVault(storage, userId, seeded);
  return seeded;
}

export function upsertVaultNote(
  vault: PresenceVault,
  path: string,
  content: string,
  now: Date = new Date(),
): PresenceVault {
  const updatedAt = now.toISOString();
  const notes = vault.notes.filter((note) => note.path !== path);
  notes.push({ path, content, updatedAt });
  return { version: 1, notes };
}

export function appendDailyNote(
  vault: PresenceVault,
  line: string,
  now: Date = new Date(),
): PresenceVault {
  const path = dailyNotePath(now);
  const existing = vault.notes.find((note) => note.path === path);
  const next = existing
    ? `${existing.content.trimEnd()}\n- ${line}\n`
    : `# ${now.toISOString().slice(0, 10)}\n\n- ${line}\n`;
  return upsertVaultNote(vault, path, next, now);
}

export function persistBoothTurnToVault(
  storage: Pick<Storage, "getItem" | "setItem">,
  userId: string,
  turn: BoothTurnPersist,
  givenName: string | null = null,
  now: Date = new Date(),
): PresenceVault {
  if (!userId) return { ...EMPTY_VAULT, notes: [] };
  let vault = ensureSeededVault(storage, userId, givenName, now);
  const sessionBody = [
    "# Meet Sync session",
    "",
    turn.lastSubject
      ? `Last subject: ${turn.lastSubject}`
      : "Last subject: (none)",
    "",
    ...turn.messages.slice(-24).map((message) => {
      const who = message.role === "user" ? "You" : "Sync";
      return `- ${who}: ${message.text.replace(/\s+/g, " ").trim().slice(0, 400)}`;
    }),
    "",
  ].join("\n");
  vault = upsertVaultNote(vault, VAULT_SESSION_PATH, sessionBody, now);
  if (turn.question) {
    vault = appendDailyNote(vault, `You: ${turn.question.slice(0, 220)}`, now);
  }
  if (turn.reply) {
    vault = appendDailyNote(vault, `Sync: ${turn.reply.slice(0, 220)}`, now);
  }
  writePresenceVault(storage, userId, vault);
  void persistVaultToIndexedDb(userId, vault);
  return vault;
}

export function vaultContextLines(vault: PresenceVault, limit = 8): string[] {
  const session = vault.notes.find((note) => note.path === VAULT_SESSION_PATH);
  const identity = vault.notes.find(
    (note) => note.path === VAULT_IDENTITY_PATH,
  );
  const lines: string[] = [];
  if (identity) {
    lines.push(
      "Vault identity: Sync, Reliability Engineer. Recommend is not authorize.",
    );
  }
  if (!session) return lines;
  const bullets = session.content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "));
  return [...lines, ...bullets.slice(-limit)];
}

export function sessionMemoryFromVault(
  vault: PresenceVault,
): PresenceSessionMemory {
  const session = vault.notes.find((note) => note.path === VAULT_SESSION_PATH);
  if (!session) return { messages: [], lastSubject: null };
  const lastSubjectMatch = session.content.match(/^Last subject: (.+)$/m);
  const lastSubject =
    lastSubjectMatch && lastSubjectMatch[1] && lastSubjectMatch[1] !== "(none)"
      ? lastSubjectMatch[1].trim().slice(0, 80)
      : null;
  const messages: PresenceBoothMessage[] = session.content
    .split("\n")
    .filter((line) => line.startsWith("- You:") || line.startsWith("- Sync:"))
    .map((line, index) => {
      const user = line.startsWith("- You:");
      return {
        id: `vault-${index}`,
        role: user ? "user" : "sync",
        text: line.replace(/^- (You|Sync): /, "").trim(),
      };
    });
  return { messages, lastSubject };
}

export function loadBoothMemory(
  session: Pick<Storage, "getItem">,
  durable: Pick<Storage, "getItem">,
  userId: string,
  readSession: (
    storage: Pick<Storage, "getItem">,
    userId: string,
  ) => PresenceSessionMemory,
): PresenceSessionMemory {
  const fromSession = readSession(session, userId);
  if (fromSession.messages.length > 0) return fromSession;
  return sessionMemoryFromVault(readPresenceVault(durable, userId));
}

export async function persistVaultToIndexedDb(
  userId: string,
  vault: PresenceVault,
): Promise<void> {
  if (!userId || typeof indexedDB === "undefined") return;
  try {
    const db = await openVaultDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore(IDB_STORE).put({ userId, vault });
    });
    db.close();
  } catch {
    // IndexedDB is best-effort. localStorage remains the durable fallback.
  }
}

export async function readVaultFromIndexedDb(
  userId: string,
): Promise<PresenceVault | null> {
  if (!userId || typeof indexedDB === "undefined") return null;
  try {
    const db = await openVaultDb();
    const row = await new Promise<{ vault?: PresenceVault } | undefined>(
      (resolve, reject) => {
        const tx = db.transaction(IDB_STORE, "readonly");
        const request = tx.objectStore(IDB_STORE).get(userId);
        request.onsuccess = () =>
          resolve(request.result as { vault?: PresenceVault } | undefined);
        request.onerror = () => reject(request.error);
      },
    );
    db.close();
    return row?.vault?.notes ? row.vault : null;
  } catch {
    return null;
  }
}

function openVaultDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { keyPath: "userId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function isVaultNote(value: unknown): value is VaultNote {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<VaultNote>;
  return (
    typeof row.path === "string" &&
    typeof row.content === "string" &&
    typeof row.updatedAt === "string"
  );
}
