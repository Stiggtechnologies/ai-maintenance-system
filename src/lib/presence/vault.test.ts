import { describe, expect, it } from "vitest";
import { readPresenceMemory } from "./memory";
import {
  VAULT_IDENTITY_PATH,
  VAULT_SESSION_PATH,
  dailyNotePath,
  ensureSeededVault,
  loadBoothMemory,
  persistBoothTurnToVault,
  presenceVaultKey,
  readPresenceVault,
  seedSyncVault,
  sessionMemoryFromVault,
  vaultContextLines,
} from "./vault";

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    get length() {
      return data.size;
    },
    clear() {
      data.clear();
    },
    getItem(key: string) {
      return data.has(key) ? data.get(key)! : null;
    },
    key(index: number) {
      return [...data.keys()][index] ?? null;
    },
    removeItem(key: string) {
      data.delete(key);
    },
    setItem(key: string, value: string) {
      data.set(key, value);
    },
  };
}

describe("presence vault", () => {
  it("seeds a Sync Reliability Engineer vault, not the Jarvis personality", () => {
    const vault = seedSyncVault("Orville", new Date("2026-09-06T12:00:00Z"));
    const index = vault.notes.find((note) => note.path === "VAULT-INDEX.md");
    const identity = vault.notes.find(
      (note) => note.path === VAULT_IDENTITY_PATH,
    );
    expect(index?.content).toMatch(/Reliability Engineer/i);
    expect(index?.content).toMatch(/Recommend is not authorize/i);
    expect(index?.content).toMatch(/Jared Rhodenizer/i);
    expect(index?.content).toMatch(/Orville/);
    expect(identity?.content).toMatch(/Professional meeting-moderator/i);
    expect(index?.content).not.toMatch(/vulgar|curse freely|sir\/boss/i);
    expect(identity?.content).not.toMatch(/curse freely|guy friend at a bar/i);
  });

  it("isolates durable notes by signed-in user", () => {
    const store = memoryStorage();
    persistBoothTurnToVault(
      store,
      "user-a",
      {
        messages: [
          { id: "1", role: "user", text: "How is emergency work trending?" },
        ],
        lastSubject: "How is emergency work trending?",
        question: "How is emergency work trending?",
      },
      "Ava",
    );
    expect(readPresenceVault(store, "user-b").notes).toHaveLength(0);
    expect(store.getItem(presenceVaultKey("user-a"))).toContain(
      "emergency work",
    );
  });

  it("survives a cleared sessionStorage by restoring from the durable vault", () => {
    const durable = memoryStorage();
    const session = memoryStorage();
    persistBoothTurnToVault(
      durable,
      "user-orville",
      {
        messages: [
          {
            id: "u1",
            role: "user",
            text: "HMER haul truck availability optimization",
          },
          {
            id: "s1",
            role: "sync",
            text: "That subject stays provisional until a Decision Case is bound.",
          },
        ],
        lastSubject: "HMER haul truck availability optimization",
        question: "HMER haul truck availability optimization",
        reply: "That subject stays provisional until a Decision Case is bound.",
      },
      "Orville",
      new Date("2026-09-06T12:00:00Z"),
    );

    const restored = loadBoothMemory(
      session,
      durable,
      "user-orville",
      readPresenceMemory,
    );
    expect(restored.messages.length).toBeGreaterThanOrEqual(2);
    expect(restored.lastSubject).toMatch(/HMER haul truck/);
    expect(
      sessionMemoryFromVault(readPresenceVault(durable, "user-orville"))
        .messages[0]?.text,
    ).toMatch(/HMER/);
    expect(
      readPresenceVault(durable, "user-orville").notes.some(
        (note) => note.path === dailyNotePath(new Date("2026-09-06T12:00:00Z")),
      ),
    ).toBe(true);
  });

  it("feeds vault context without inventing plant state", () => {
    const store = memoryStorage();
    const vault = persistBoothTurnToVault(
      store,
      "user-orville",
      {
        messages: [
          { id: "1", role: "user", text: "Give me OEE" },
          {
            id: "2",
            role: "sync",
            text: "No sourced KPI values are available yet.",
          },
        ],
        lastSubject: null,
      },
      "Orville",
    );
    const lines = vaultContextLines(vault);
    expect(lines.join("\n")).toMatch(/Reliability Engineer/);
    expect(lines.join("\n")).toMatch(/No sourced KPI values/);
    expect(lines.join("\n")).not.toMatch(/\b87%\b/);
    expect(lines.join("\n")).not.toMatch(/plant is healthy/i);
  });

  it("does not re-seed an existing vault", () => {
    const store = memoryStorage();
    const first = ensureSeededVault(store, "user-orville", "Orville");
    first.notes[0].content = "kept";
    persistBoothTurnToVault(
      store,
      "user-orville",
      { messages: [], lastSubject: null },
      "Orville",
    );
    const again = ensureSeededVault(store, "user-orville", "Someone Else");
    expect(again.notes.some((note) => note.path === VAULT_SESSION_PATH)).toBe(
      true,
    );
  });
});
