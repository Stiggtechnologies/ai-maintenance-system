import { describe, expect, it } from "vitest";
import {
  createDraftDecisionCase,
  createSeedDecisionCases,
  DEFAULT_DECISION_CASE_ID,
} from "./decision-case";
import { createFirstPaintSeed } from "./first-paint-seeds";
import {
  DEMO_CASE_SUBJECT_PATTERN,
  SEED_DECISION_CASE_IDS,
  bootstrapChatCases,
  buildDecisionAskContextPack,
  createHonestEmptyDecisionCase,
  filterSeedCasesForOrgSession,
  hasBoundDecisionSubject,
  isSeedDecisionCaseId,
  pickInitialSelectedCaseId,
  resolveDecisionAskBinding,
} from "./decision-case-honesty";

describe("decision-case-honesty", () => {
  it("knows every industry seed id, including the oil-gas default", () => {
    expect(SEED_DECISION_CASE_IDS.has(DEFAULT_DECISION_CASE_ID)).toBe(true);
    expect(isSeedDecisionCaseId("dc-1048")).toBe(true);
    expect(isSeedDecisionCaseId("mining-crusher-2201")).toBe(true);
    expect(isSeedDecisionCaseId("manufacturing-press-3107")).toBe(true);
    expect(isSeedDecisionCaseId(createFirstPaintSeed(0).id)).toBe(true);
    expect(isSeedDecisionCaseId("draft-12345")).toBe(false);
  });

  it("does not auto-select a seed case when no route case is chosen", () => {
    const seeds = createSeedDecisionCases();
    const draft = createHonestEmptyDecisionCase("Reliability Engineer");

    expect(pickInitialSelectedCaseId(undefined, seeds)).toBeNull();
    expect(pickInitialSelectedCaseId("demo", seeds)).toBeNull();
    expect(pickInitialSelectedCaseId(undefined, [seeds[0], draft])).toBe(
      draft.id,
    );
    expect(pickInitialSelectedCaseId("dc-1048", seeds)).toBe("dc-1048");
  });

  it("strips stored seeds from a normal org session unless the route names that seed", () => {
    const seeds = createSeedDecisionCases();
    const draft = createHonestEmptyDecisionCase("Reliability Engineer");
    expect(filterSeedCasesForOrgSession([...seeds, draft])).toEqual([draft]);
    expect(filterSeedCasesForOrgSession(seeds, "dc-1048")[0]?.id).toBe(
      "dc-1048",
    );
  });

  it("bootstraps a normal org chat without binding the demo case", () => {
    const seeds = createSeedDecisionCases();
    const opened = bootstrapChatCases(undefined, {}, {
      orgSession: true,
      stored: seeds,
      role: "Reliability Engineer",
    });

    expect(opened.cases.every((item) => !isSeedDecisionCaseId(item.id))).toBe(
      true,
    );
    expect(isSeedDecisionCaseId(opened.selectedId)).toBe(false);
    expect(hasBoundDecisionSubject(opened.cases[0])).toBe(false);
    expect(opened.cases[0].organization).toBe("");
    expect(opened.cases[0].site).toBe("");
    expect(opened.cases[0].asset).toMatch(/not yet defined/i);
  });

  it("does not invent a seed case when an unknown org route id is opened", () => {
    const opened = bootstrapChatCases(
      "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      { industry: "oil-gas" },
      { orgSession: true, stored: [], role: "Reliability Engineer" },
    );

    expect(opened.cases).toHaveLength(1);
    expect(isSeedDecisionCaseId(opened.selectedId)).toBe(false);
    expect(opened.cases[0].organization).not.toMatch(DEMO_CASE_SUBJECT_PATTERN);
  });

  it("context pack does not inject a demo case id when none is selected", () => {
    const empty = createHonestEmptyDecisionCase("Reliability Engineer");
    const draft = createDraftDecisionCase("Reliability Engineer");
    const none = buildDecisionAskContextPack(null);
    const unbound = buildDecisionAskContextPack(empty);
    const leftoverDraft = buildDecisionAskContextPack(draft);

    for (const pack of [none, unbound, leftoverDraft]) {
      expect(pack.injectCase).toBe(false);
      expect(pack.caseId).toBeNull();
      expect(pack.contextLines.join("\n")).not.toMatch(DEMO_CASE_SUBJECT_PATTERN);
      expect(pack.contextLines.join("\n")).not.toContain("dc-1048");
    }

    const seed = createSeedDecisionCases()[0];
    const bound = buildDecisionAskContextPack(seed);
    expect(bound.injectCase).toBe(true);
    expect(bound.caseId).toBe(DEFAULT_DECISION_CASE_ID);
    expect(resolveDecisionAskBinding(seed).bound).toBe(true);
    expect(resolveDecisionAskBinding(empty).bound).toBe(false);
  });
});
