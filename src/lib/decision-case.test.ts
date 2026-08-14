import { describe, expect, it } from "vitest";
import {
  clearDecisionCaseHandoff,
  createSeedDecisionCases,
  getPublicDecisionCaseStorageKey,
  normalizeDecisionIndustry,
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

describe("Decision Case industry proofs", () => {
  it("builds isolated, domain-specific mining and manufacturing portfolios", () => {
    const mining = createSeedDecisionCases({ industry: "mining" });
    const manufacturing = createSeedDecisionCases({
      industry: "manufacturing",
    });

    expect(mining).toHaveLength(3);
    expect(mining.every((item) => item.industry === "mining")).toBe(true);
    expect(mining.map((item) => item.asset)).toEqual([
      "CR-01 primary crusher",
      "CV-204 overland conveyor",
      "HT-27 haul truck",
    ]);
    expect(mining[0].decisionMetrics).toContainEqual({
      label: "Lost tonnes",
      value: "14,800 t",
      detail: "reconciled",
    });

    expect(manufacturing).toHaveLength(3);
    expect(
      manufacturing.every((item) => item.industry === "manufacturing"),
    ).toBe(true);
    expect(manufacturing.map((item) => item.asset)).toEqual([
      "PR-07 stamping press",
      "PKG-04 cartoner",
      "OV-12 cure oven",
    ]);
    expect(manufacturing[0].evidence.map((item) => item.title)).toContain(
      "Approved PFMEA and control plan",
    );
  });

  it("normalizes campaign aliases and keeps public sessions separate", () => {
    expect(normalizeDecisionIndustry("factory")).toBe("manufacturing");
    expect(normalizeDecisionIndustry("MINING")).toBe("mining");
    expect(normalizeDecisionIndustry("unknown")).toBe("oil-gas");
    expect(getPublicDecisionCaseStorageKey("mining")).not.toBe(
      getPublicDecisionCaseStorageKey("oil-gas"),
    );
  });
});
