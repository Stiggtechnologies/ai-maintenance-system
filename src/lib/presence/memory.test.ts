import { beforeEach, describe, expect, it } from "vitest";
import { DECISION_CASE_STORAGE_KEY } from "../decision-case";
import { createHonestEmptyDecisionCase } from "../decision-case-honesty";
import { createFirstPaintSeed } from "../first-paint-seeds";
import {
  appendPresenceTurnToDecisionCase,
  nextPresenceSubject,
  presenceMemoryStorageKey,
  readPresenceSessionMemory,
  resolvePresenceDecisionContext,
  writePresenceSessionMemory,
} from "./memory";

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

describe("presence session memory", () => {
  let session: Storage;

  beforeEach(() => {
    session = memoryStorage();
  });

  it("persists transcript and subject per user", () => {
    writePresenceSessionMemory(session, "user-a", {
      messages: [
        { id: "u1", role: "user", text: "HMER haul truck availability" },
        { id: "s1", role: "sync", text: "Provisional — no case selected." },
      ],
      subject: "HMER haul truck availability",
      caseId: "draft-1",
    });

    expect(readPresenceSessionMemory(session, "user-a").subject).toBe(
      "HMER haul truck availability",
    );
    expect(readPresenceSessionMemory(session, "user-b")).toEqual({
      messages: [],
      subject: null,
      caseId: null,
    });
    expect(session.getItem(presenceMemoryStorageKey("user-a"))).toContain(
      "HMER",
    );
  });

  it("does not invent a subject from a greeting or empty store", () => {
    expect(readPresenceSessionMemory(session, "user-a").messages).toEqual([]);
    expect(nextPresenceSubject("Hello", null)).toBeNull();
    expect(nextPresenceSubject("what can you do", "HMER haul truck")).toBe(
      "HMER haul truck",
    );
    expect(
      nextPresenceSubject("HMER haul truck availability optimization", null),
    ).toBe("HMER haul truck availability optimization");
    expect(
      nextPresenceSubject("something else", "HMER haul truck availability"),
    ).toBe("HMER haul truck availability");
  });
});

describe("presence Decision Case continuity", () => {
  let persistent: Storage;

  beforeEach(() => {
    persistent = memoryStorage();
  });

  it("does not bind a seed or demo case from the store", () => {
    persistent.setItem(
      DECISION_CASE_STORAGE_KEY,
      JSON.stringify([createFirstPaintSeed(0)]),
    );
    const context = resolvePresenceDecisionContext(persistent);
    expect(context.bound).toBe(false);
    expect(context.caseNumber).toBeNull();
    expect(context.contextLines.join(" ")).toMatch(/no decision case/i);
    expect(context.contextLines.join(" ")).not.toMatch(/P-101|Fort McMurray/i);
  });

  it("continues a bound stored case without inventing plant readings", () => {
    const draft = createHonestEmptyDecisionCase("Reliability Engineer");
    const bound = {
      ...draft,
      asset: "CV-204 conveyor",
      stage: "evidence" as const,
      evidence: [
        {
          id: "ev-1",
          title: "Delay log",
          summary: "Named delay records",
          quality: "medium" as const,
          state: "Governed",
          record: "DL-1",
          finding: "Start-up delays after changeover.",
          lineage: "Site log",
          sourceSystem: "CMMS",
        },
      ],
    };
    persistent.setItem(DECISION_CASE_STORAGE_KEY, JSON.stringify([bound]));

    const context = resolvePresenceDecisionContext(persistent, bound.id);
    expect(context.bound).toBe(true);
    expect(context.caseNumber).toBe(bound.caseNumber);
    expect(context.asset).toBe("CV-204 conveyor");
    expect(context.contextLines.join(" ")).toMatch(/CV-204/);
    expect(context.contextLines.join(" ")).not.toMatch(/\b87%|healthy\b/i);
  });

  it("appends Meet Sync turns only onto a non-seed stored case", () => {
    const draft = createHonestEmptyDecisionCase("Reliability Engineer");
    persistent.setItem(DECISION_CASE_STORAGE_KEY, JSON.stringify([draft]));

    expect(
      appendPresenceTurnToDecisionCase(persistent, {
        caseId: draft.id,
        question: "HMER haul truck availability",
        reply: "Provisional analysis. Recommend is not authorize.",
      }),
    ).toBe(true);

    const stored = JSON.parse(
      persistent.getItem(DECISION_CASE_STORAGE_KEY) ?? "[]",
    ) as Array<{ messages: Array<{ text: string; meta?: string }> }>;
    expect(stored[0].messages.some((item) => item.text.includes("HMER"))).toBe(
      true,
    );
    expect(
      stored[0].messages.some((item) => item.meta?.includes("Meet Sync")),
    ).toBe(true);

    expect(
      appendPresenceTurnToDecisionCase(persistent, {
        caseId: createFirstPaintSeed(0).id,
        question: "Should not write",
        reply: "No",
      }),
    ).toBe(false);
  });
});
