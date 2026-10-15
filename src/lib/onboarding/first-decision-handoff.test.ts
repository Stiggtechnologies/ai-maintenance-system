import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  persistFirstDecisionHandoff,
  readFirstDecisionDraft,
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
