import { describe, expect, it } from "vitest";
import {
  createDraftDecisionCase,
  createSeedDecisionCases,
} from "../decision-case";
import { DECISION_CASE_STORAGE_KEY } from "../decision-case";
import { createHonestEmptyDecisionCase } from "../decision-case-honesty";
import {
  describePresenceWork,
  extractSessionSubjectLabel,
  loadStoredPresenceCases,
  presenceMemoryKey,
  readPresenceMemory,
  rememberNamedSubject,
  resolvePresenceWorkingSubject,
  sessionMemoryLines,
  writePresenceMemory,
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
  it("isolates transcript by user and restores last subject", () => {
    const session = memoryStorage();
    writePresenceMemory(session, "user-a", {
      messages: [
        { id: "1", role: "user", text: "How is emergency work trending?" },
      ],
      lastSubject: "How is emergency work trending?",
    });

    expect(readPresenceMemory(session, "user-b")).toEqual({
      messages: [],
      lastSubject: null,
    });
    expect(readPresenceMemory(session, "user-a").messages).toHaveLength(1);
    expect(session.getItem(presenceMemoryKey("user-a"))).toContain(
      "emergency work",
    );
  });

  it("only remembers a subject the user actually named", () => {
    expect(extractSessionSubjectLabel("hi")).toBeNull();
    expect(extractSessionSubjectLabel("What should we fix first?")).toBeNull();
    expect(
      extractSessionSubjectLabel("HMER haul truck availability optimization"),
    ).toBe("HMER haul truck availability optimization");
    expect(rememberNamedSubject("hi", "prior subject")).toBe("prior subject");
  });

  it("summarizes recent turns without inventing plant state", () => {
    const lines = sessionMemoryLines({
      lastSubject: "compressor C-330 MTBF",
      messages: [
        {
          id: "u1",
          role: "user",
          text: "Calculate MTBF for compressor C-330.",
        },
        {
          id: "s1",
          role: "sync",
          text: "Provisional until a Decision Case is bound. I recommend, I do not authorize.",
        },
      ],
    });
    expect(lines[0]).toBe("Last subject: compressor C-330 MTBF");
    expect(lines.join("\n")).toMatch(/recommend, I do not authorize/i);
    expect(lines.join("\n")).not.toMatch(/plant is healthy|87%/i);
  });
});

describe("presence Decision Case continuity", () => {
  it("does not auto-bind a seed or empty draft", () => {
    const seeds = createSeedDecisionCases();
    const empty = createHonestEmptyDecisionCase("Reliability Engineer");
    const leftover = createDraftDecisionCase("Reliability Engineer");

    const fromSeeds = resolvePresenceWorkingSubject(seeds);
    expect(fromSeeds.bound).toBe(false);
    expect(fromSeeds.contextLines.join("\n")).not.toMatch(/P-101|dc-1048/i);

    const fromEmpty = resolvePresenceWorkingSubject([empty, leftover]);
    expect(fromEmpty.bound).toBe(false);
    expect(fromEmpty.asset).toBeNull();
    expect(describePresenceWork(fromEmpty)).toMatch(
      /No Decision Case is bound/i,
    );
    expect(describePresenceWork(fromEmpty)).not.toMatch(/P-101|Fort McMurray/i);
  });

  it("names a bound stored case without inventing readings", () => {
    const seed = createSeedDecisionCases()[0];
    const stored = { ...seed, id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" };
    const subject = resolvePresenceWorkingSubject([stored]);
    expect(subject.bound).toBe(true);
    expect(subject.caseNumber).toBe(seed.caseNumber);
    expect(subject.asset).toBe(seed.asset);
    expect(describePresenceWork(subject)).toContain(seed.caseNumber);
    expect(describePresenceWork(subject)).toContain(seed.asset);
    expect(describePresenceWork(subject)).not.toMatch(/\b87%|healthy\b/i);
  });

  it("strips seed drafts from localStorage for a signed-in org session", () => {
    const storage = memoryStorage({
      [DECISION_CASE_STORAGE_KEY]: JSON.stringify(createSeedDecisionCases()),
    });
    expect(loadStoredPresenceCases(storage)).toEqual([]);
  });

  it("keeps a session subject provisional when no case is bound", () => {
    const subject = resolvePresenceWorkingSubject(
      [createHonestEmptyDecisionCase("Reliability Engineer")],
      "HMER haul truck availability optimization",
    );
    expect(subject.bound).toBe(false);
    expect(describePresenceWork(subject)).toMatch(/HMER haul truck/);
    expect(describePresenceWork(subject)).toMatch(/provisional/i);
  });
});
