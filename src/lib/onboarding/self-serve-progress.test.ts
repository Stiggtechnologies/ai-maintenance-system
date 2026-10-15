import { describe, expect, it } from "vitest";
import {
  stripForSpeech,
  SYNC_TTS_MAX_CHARS,
} from "../../../supabase/functions/_shared/sync-tts-core";
import { INVERTED_EXAMPLE_PROMPTS } from "./inverted-opening";
import {
  isReviewableSavedRecommendation,
  selfServeProgress,
  suppliedEvidenceCount,
} from "./self-serve-progress";

const empty = {
  signedIn: false,
  hasWorkspace: false,
  accountExists: false,
  question: "",
  draftOpen: false,
  caseSaved: false,
  exampleOnly: false,
  savedSuppliedEvidence: 0,
  savedRecommendation: false,
};

const question =
  "Should we hold the inspection interval on the reclaim pump until the next outage?";

describe("self-serve progress", () => {
  it("starts with an empty state on every step and spotlights the question", () => {
    const progress = selfServeProgress(empty);
    expect(progress.steps.map((step) => step.status)).toEqual([
      "open",
      "now",
      "open",
      "open",
    ]);
    expect(progress.offerWorkspace).toBe(true);
    for (const step of progress.steps) {
      expect(step.empty.length).toBeGreaterThan(20);
    }
    expect(progress.steps[0].empty).toMatch(/No evaluation workspace yet/);
    expect(progress.steps[1].empty).toMatch(/No question yet/);
    expect(progress.steps[2].empty).toMatch(/No Decision Case is open yet/);
    expect(progress.steps[3].empty).toMatch(/No first value yet/);
    expect(progress.narration).toMatch(/your own words/);
  });

  it("treats an example preview as not a question, case, or value", () => {
    const progress = selfServeProgress({
      ...empty,
      question: INVERTED_EXAMPLE_PROMPTS[0].prompt,
      draftOpen: true,
      caseSaved: true,
      exampleOnly: true,
      savedSuppliedEvidence: 2,
      savedRecommendation: true,
    });
    expect(progress.steps.map((step) => step.status)).toEqual([
      "open",
      "now",
      "open",
      "open",
    ]);
    expect(progress.steps[1].empty).toMatch(/example question/);
  });

  it("keeps an unsaved draft off the done checklist", () => {
    const draft = selfServeProgress({
      ...empty,
      question,
      draftOpen: true,
      savedSuppliedEvidence: 1,
      savedRecommendation: true,
    });
    expect(draft.steps.map((step) => [step.id, step.status])).toEqual([
      ["signup", "open"],
      ["question", "open"],
      ["decision_case", "now"],
      ["first_value", "open"],
    ]);
    expect(draft.steps[1].empty).toMatch(/only in this browser/);
    expect(draft.steps[2].empty).toMatch(/not saved, so it is not done/);
    expect(draft.steps[3].empty).toMatch(/does not count/);
    expect(draft.narration).toMatch(/not saved, so it is not done/);
  });

  it("marks the case and first value done only from a saved revision", () => {
    const savedCase = selfServeProgress({
      ...empty,
      signedIn: true,
      hasWorkspace: true,
      accountExists: true,
      question,
      caseSaved: true,
    });
    expect(savedCase.offerWorkspace).toBe(false);
    expect(savedCase.steps.map((step) => [step.id, step.status])).toEqual([
      ["signup", "done"],
      ["question", "done"],
      ["decision_case", "done"],
      ["first_value", "now"],
    ]);
    expect(savedCase.steps[2].doneDetail).toMatch(
      /saved on the evaluation workspace/,
    );
    expect(savedCase.steps[3].empty).toMatch(/No saved first value yet/);
    expect(savedCase.steps[3].empty).toMatch(/not an approval/);

    const valued = selfServeProgress({
      ...empty,
      signedIn: true,
      hasWorkspace: true,
      accountExists: true,
      question,
      caseSaved: true,
      savedSuppliedEvidence: 1,
    });
    expect(valued.steps.every((step) => step.status === "done")).toBe(true);
    expect(valued.steps[3].doneDetail).toMatch(/does not run the plant/);
    expect(valued.narration).toMatch(/not an approval/);

    const fromRecommendation = selfServeProgress({
      ...empty,
      hasWorkspace: true,
      question,
      caseSaved: true,
      savedRecommendation: true,
    });
    expect(fromRecommendation.steps[3].status).toBe("done");
  });

  it("does not offer another workspace after signup", () => {
    const progress = selfServeProgress({
      ...empty,
      accountExists: true,
      emphasizeSignup: true,
      question,
      draftOpen: true,
    });
    expect(progress.offerWorkspace).toBe(false);
    expect(progress.steps[0].status).toBe("now");
    expect(progress.steps[0].empty).toMatch(
      /will not create another workspace/,
    );
    expect(progress.steps[2].status).toBe("open");
    expect(progress.narration).toMatch(/ask a question first/i);
  });

  it("counts only supplied evidence and keeps narration inside the speech cap", () => {
    expect(
      suppliedEvidenceCount([
        { quality: "missing" },
        { quality: "medium" },
        { quality: "high" },
        { quality: "conflict" },
      ]),
    ).toBe(2);
    expect(
      isReviewableSavedRecommendation(
        "No asset-specific recommendation yet. The case structure is ready; the decision is not.",
      ),
    ).toBe(false);
    expect(
      isReviewableSavedRecommendation(
        "Preliminary recommendation can be reviewed against the attached evidence. It is still not authorization.",
      ),
    ).toBe(true);
    const progress = selfServeProgress(empty);
    for (const step of progress.steps) {
      expect(stripForSpeech(step.narration)).toBe(step.narration);
      expect(step.narration.length).toBeLessThanOrEqual(SYNC_TTS_MAX_CHARS);
    }
    const valued = selfServeProgress({
      ...empty,
      hasWorkspace: true,
      question,
      caseSaved: true,
      savedSuppliedEvidence: 1,
    });
    expect(stripForSpeech(valued.narration)).toBe(valued.narration);
    expect(valued.narration.length).toBeLessThanOrEqual(SYNC_TTS_MAX_CHARS);
  });
});
