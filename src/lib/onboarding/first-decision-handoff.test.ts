import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  persistFirstDecisionHandoff,
  readFirstDecisionDraft,
  readFirstDecisionImportId,
  returnToSavedDecisionCase,
} from "./first-decision-handoff";
import {
  attachSpineEvidence,
  buildSpineDecisionCase,
} from "./decision-case-spine";
import { INVERTED_EXAMPLE_PROMPTS } from "./inverted-opening";
import { stageDecisionCaseHandoff, type DecisionCase } from "../decision-case";
import { rememberEvaluationDraft } from "./evaluation-assistant-handoff";

const QUESTION =
  "Should we hold the inspection interval on the reclaim pump until the next outage?";

function draft(): DecisionCase {
  return buildSpineDecisionCase({ question: QUESTION, intent: "solve" });
}

beforeEach(() => {
  sessionStorage.clear();
});

describe("first decision handoff", () => {
  it("reads the staged question and evidence, including a returnTo draft", () => {
    const withEvidence = attachSpineEvidence(
      draft(),
      "inspection",
      "paste_data",
      "Synthetic inspection note kept for signup",
    );
    const restore = rememberEvaluationDraft(
      withEvidence,
      "?industry=mining&utm_source=partner",
      sessionStorage,
    );
    stageDecisionCaseHandoff(sessionStorage, withEvidence);
    const fromHandoff = readFirstDecisionDraft(sessionStorage, "?view=signup");
    expect(fromHandoff?.objective).toBe(QUESTION);
    expect(JSON.stringify(fromHandoff?.evidence)).toContain(
      "Synthetic inspection note kept for signup",
    );

    sessionStorage.removeItem("syncai.pendingDecisionCaseHandoff.v1");
    const fromReturn = readFirstDecisionDraft(
      sessionStorage,
      `?view=signup&returnTo=${encodeURIComponent(restore)}`,
    );
    expect(fromReturn?.id).toBe(withEvidence.id);
    expect(JSON.stringify(fromReturn?.evidence)).toContain(
      "Synthetic inspection note kept for signup",
    );
  });

  it("does not send an unsaved draft id to the workspace case route", () => {
    const decision = draft();
    const requested = `/workspace/cases/${decision.id}?industry=mining`;
    const safe = returnToSavedDecisionCase(
      decision,
      requested,
      "?industry=mining&utm_source=partner",
    );
    expect(safe.startsWith("/get-started?")).toBe(true);
    expect(safe).toContain(`case=${decision.id}`);
    expect(safe).not.toContain("/workspace/cases/");
    expect(safe).toContain(`industry=${decision.industry}`);
    expect(safe).toContain("utm_source=partner");
  });

  it("persists a browser draft as the first saved Decision Case and returns to it", async () => {
    const withEvidence = attachSpineEvidence(
      draft(),
      "inspection",
      "paste_data",
      "Synthetic inspection note kept for signup",
    );
    const createdId = "11111111-1111-4111-8111-111111111111";
    const create = vi.fn(async (seed: DecisionCase) => ({
      ...seed,
      id: createdId,
      updatedAt: "2026-10-15T00:00:00.000Z",
    }));
    const save = vi.fn(async () => undefined);
    const result = await persistFirstDecisionHandoff(
      withEvidence,
      "?industry=mining",
      `/workspace/cases/${withEvidence.id}?industry=mining`,
      {
        isPersisted: (id) => id === createdId,
        create,
        save,
      },
    );
    expect(create).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(result.persisted).toBe(true);
    expect(result.decisionCase.id).toBe(createdId);
    expect(result.decisionCase.objective).toBe(QUESTION);
    expect(JSON.stringify(result.decisionCase.evidence)).toContain(
      "Synthetic inspection note kept for signup",
    );
    expect(result.returnTo).toContain(`/get-started?`);
    expect(result.returnTo).toContain(`case=${createdId}`);
    expect(result.returnTo).not.toContain(withEvidence.id);
  });

  it("two saves of the same draft yield one case", async () => {
    const decision = draft();
    const createdId = "11111111-1111-4111-8111-111111111111";
    const create = vi.fn(async (seed: DecisionCase) => ({
      ...seed,
      id: createdId,
      updatedAt: "2026-10-15T00:00:00.000Z",
    }));
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error("acknowledgement lost"))
      .mockResolvedValueOnce(undefined);
    const deps = {
      isPersisted: (id: string) => id === createdId,
      create,
      save,
      storage: sessionStorage,
    };
    const first = await persistFirstDecisionHandoff(
      decision,
      "?industry=mining",
      `/workspace/cases/${decision.id}`,
      deps,
    );
    const second = await persistFirstDecisionHandoff(
      decision,
      "?industry=mining",
      `/workspace/cases/${decision.id}`,
      deps,
    );
    expect(create).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(2);
    expect(first.decisionCase.id).toBe(createdId);
    expect(second.decisionCase.id).toBe(createdId);
    expect(decision.importKey).toBeTruthy();
    expect(readFirstDecisionImportId(sessionStorage, decision.importKey!)).toBe(
      createdId,
    );
    expect(readFirstDecisionImportId(sessionStorage, decision.id)).toBeNull();
  });

  it("two drafts with the same DRAFT- suffix produce two cases, and a replay stays one", async () => {
    const suffix = "12345";
    const firstKey = "11111111-1111-4111-8111-111111111111";
    const secondKey = "22222222-2222-4222-8222-222222222222";
    const firstWorkspace = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const secondWorkspace = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const base = draft();
    const first: DecisionCase = {
      ...base,
      id: `draft-${suffix}`,
      caseNumber: `DRAFT-${suffix}`,
      importKey: firstKey,
      objective: "Hold the reclaim pump inspection until the next outage?",
    };
    const second: DecisionCase = {
      ...base,
      id: `draft-${suffix}`,
      caseNumber: `DRAFT-${suffix}`,
      importKey: secondKey,
      objective: "Replace the seal on the transfer pump before winter?",
    };
    const workspaceByImport = new Map<string, string>([
      [firstKey, firstWorkspace],
      [secondKey, secondWorkspace],
    ]);
    const rows = new Map<string, DecisionCase>();
    const create = vi.fn(async (seed: DecisionCase) => {
      const workspaceId = workspaceByImport.get(seed.importKey ?? "");
      if (!workspaceId) throw new Error("missing import key");
      return {
        ...seed,
        id: workspaceId,
        updatedAt: "2026-10-15T00:00:00.000Z",
      };
    });
    const save = vi.fn(async (saved: DecisionCase) => {
      rows.set(saved.id, saved);
    });
    const deps = {
      isPersisted: (id: string) =>
        id === firstWorkspace || id === secondWorkspace,
      create,
      save,
      storage: sessionStorage,
    };
    const savedFirst = await persistFirstDecisionHandoff(first, "", "/", deps);
    const savedSecond = await persistFirstDecisionHandoff(
      second,
      "",
      "/",
      deps,
    );
    const replay = await persistFirstDecisionHandoff(first, "", "/", deps);
    expect(savedFirst.decisionCase.id).toBe(firstWorkspace);
    expect(savedSecond.decisionCase.id).toBe(secondWorkspace);
    expect(savedFirst.decisionCase.id).not.toBe(savedSecond.decisionCase.id);
    expect(replay.decisionCase.id).toBe(firstWorkspace);
    expect(create).toHaveBeenCalledTimes(2);
    expect(rows.get(firstWorkspace)?.objective).toBe(first.objective);
    expect(rows.get(secondWorkspace)?.objective).toBe(second.objective);
    expect(savedFirst.decisionCase.caseNumber).toBe("DRAFT-12345");
    expect(savedSecond.decisionCase.caseNumber).toBe("DRAFT-12345");
    expect(readFirstDecisionImportId(sessionStorage, firstKey)).toBe(
      firstWorkspace,
    );
    expect(readFirstDecisionImportId(sessionStorage, secondKey)).toBe(
      secondWorkspace,
    );
  });

  it("does not persist an example prompt", async () => {
    const example = {
      ...draft(),
      objective: INVERTED_EXAMPLE_PROMPTS[0].prompt,
    };
    const create = vi.fn();
    const save = vi.fn();
    const result = await persistFirstDecisionHandoff(example, "", "/", {
      isPersisted: () => false,
      create,
      save,
    });
    expect(create).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(result.persisted).toBe(false);
    expect(result.decisionCase.id).toBe(example.id);
    expect(result.returnTo.startsWith("/get-started?")).toBe(true);
  });

  it("keeps the browser draft when workspace save fails", async () => {
    const decision = draft();
    const result = await persistFirstDecisionHandoff(
      decision,
      "?industry=mining",
      `/workspace/cases/${decision.id}`,
      {
        isPersisted: () => false,
        create: async () => {
          throw new Error("workspace unavailable");
        },
        save: async () => undefined,
      },
    );
    expect(result.persisted).toBe(false);
    expect(result.decisionCase.id).toBe(decision.id);
    expect(result.returnTo).toContain(`case=${decision.id}`);
    expect(result.returnTo).not.toContain("/workspace/cases/");
  });
});
