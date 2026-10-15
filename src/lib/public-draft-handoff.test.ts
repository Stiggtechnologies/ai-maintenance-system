import { beforeEach, expect, it } from "vitest";
import { completePublicDraftHandoff } from "./public-draft-handoff";
import {
  buildSpineDecisionCase,
  attachSpineEvidence,
} from "./onboarding/decision-case-spine";
import {
  getPublicDecisionCaseStorageKey,
  readDecisionCaseHandoff,
  stageDecisionCaseHandoff,
} from "./decision-case";
import { readStoredDecisionDrafts } from "./decision-case-drafts";
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
it.each(["oil-gas", "mining", "manufacturing"] as const)(
  "accepts full %s draft, updates repeated revisions and preserves auth return without promotion",
  (industry) => {
    let draft = {
      ...buildSpineDecisionCase({
        question:
          "Review our synthetic inspection evidence before the next shift",
        intent: "coordinate",
      }),
      industry,
    };
    stageDecisionCaseHandoff(sessionStorage, draft);
    const path = `/workspace/cases/${draft.id}?origin=evaluation&industry=wrong&source=marketplace`;
    const target = completePublicDraftHandoff(
      draft,
      path,
      localStorage,
      sessionStorage,
    );
    expect(
      new URL(target, "https://app.test").searchParams.get("industry"),
    ).toBe(industry);
    expect(target).toContain(`/workspace/cases/${draft.id}`);
    expect(target).toContain("source=marketplace");
    expect(readStoredDecisionDrafts(localStorage)).toEqual([draft]);
    expect(
      readStoredDecisionDrafts(
        sessionStorage,
        getPublicDecisionCaseStorageKey(industry),
      ),
    ).toEqual([draft]);
    expect(readDecisionCaseHandoff(sessionStorage)).toBeNull();
    draft = attachSpineEvidence(
      draft,
      "inspection",
      "paste_data",
      "Synthetic inspection evidence added after the first handoff",
    ) as typeof draft;
    stageDecisionCaseHandoff(sessionStorage, draft);
    completePublicDraftHandoff(draft, target, localStorage, sessionStorage);
    expect(readStoredDecisionDrafts(localStorage)).toEqual([draft]);
    expect(readStoredDecisionDrafts(localStorage)[0].messages).toEqual(
      draft.messages,
    );
    expect(readStoredDecisionDrafts(localStorage)[0].intakeRole).toBe(
      "coordinate",
    );
  },
);
it("keeps the staged case after interrupted storage and retries without duplicate drafts", () => {
  const draft = buildSpineDecisionCase({
    question: "Review our synthetic inspection evidence before the next shift",
    intent: "solve",
  });
  stageDecisionCaseHandoff(sessionStorage, draft);
  const interrupted = {
    getItem: sessionStorage.getItem.bind(sessionStorage),
    setItem: () => {
      throw Error("quota");
    },
    removeItem: sessionStorage.removeItem.bind(sessionStorage),
  } as unknown as Storage;
  expect(() =>
    completePublicDraftHandoff(draft, "/workspace", localStorage, interrupted),
  ).toThrow("quota");
  expect(readDecisionCaseHandoff(sessionStorage)?.decisionCase).toEqual(draft);
  completePublicDraftHandoff(draft, "/workspace", localStorage, sessionStorage);
  expect(readStoredDecisionDrafts(localStorage)).toEqual([draft]);
  expect(readDecisionCaseHandoff(sessionStorage)).toBeNull();
});
