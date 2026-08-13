import { describe, expect, it } from "vitest";
import {
  clearDecisionCaseHandoff,
  createSeedDecisionCases,
  readDecisionCaseHandoff,
  stageDecisionCaseHandoff,
} from "./decision-case";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

describe("Decision Case authentication handoff", () => {
  it("stages, reads, and clears the active public case", () => {
    const storage = memoryStorage();
    const [decisionCase] = createSeedDecisionCases();

    stageDecisionCaseHandoff(storage, decisionCase);
    const handoff = readDecisionCaseHandoff(storage);

    expect(handoff?.decisionCase.caseNumber).toBe("DC-1048");
    expect(handoff?.decisionCase.asset).toBe("P-101 process pump");
    expect(handoff?.stagedAt).toBeTruthy();

    clearDecisionCaseHandoff(storage);
    expect(readDecisionCaseHandoff(storage)).toBeNull();
  });

  it("rejects malformed handoff state", () => {
    const storage = memoryStorage();
    storage.setItem("syncai.pendingDecisionCaseHandoff.v1", "{not-json");

    expect(readDecisionCaseHandoff(storage)).toBeNull();
  });
});
