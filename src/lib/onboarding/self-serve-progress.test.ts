import { describe, expect, it } from "vitest";
import {
  stripForSpeech,
  SYNC_TTS_MAX_CHARS,
} from "../../../supabase/functions/_shared/sync-tts-core";
import { INVERTED_EXAMPLE_PROMPTS } from "./inverted-opening";
import {
  selfServeProgress,
  suppliedEvidenceCount,
} from "./self-serve-progress";

const empty = {
  signedIn: false,
  question: "",
  caseOpen: false,
  exampleOnly: false,
  suppliedEvidence: 0,
};

describe("self-serve progress", () => {
  it("starts with an empty state on every step and spotlights the question", () => {
    const progress = selfServeProgress(empty);
    expect(progress.steps.map((step) => step.status)).toEqual([
      "open",
      "now",
      "open",
      "open",
    ]);
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
      caseOpen: true,
      exampleOnly: true,
      suppliedEvidence: 2,
    });
    expect(progress.steps.map((step) => step.status)).toEqual([
      "open",
      "now",
      "open",
      "open",
    ]);
    expect(progress.steps[1].empty).toMatch(/example question/);
  });

  it("opens the Decision Case before first value, and value only after supplied evidence", () => {
    const asked = selfServeProgress({
      ...empty,
      question:
        "Should we hold the inspection interval on the reclaim pump until the next outage?",
      caseOpen: true,
    });
    expect(asked.steps.map((step) => [step.id, step.status])).toEqual([
      ["signup", "open"],
      ["question", "done"],
      ["decision_case", "done"],
      ["first_value", "now"],
    ]);
    expect(asked.steps[3].empty).toMatch(/not an approval/);

    const valued = selfServeProgress({
      ...empty,
      signedIn: true,
      question:
        "Should we hold the inspection interval on the reclaim pump until the next outage?",
      caseOpen: true,
      suppliedEvidence: 1,
    });
    expect(valued.steps.every((step) => step.status === "done")).toBe(true);
    expect(valued.steps[3].doneDetail).toMatch(/does not run the plant/);
    expect(valued.narration).toMatch(/not an approval/);
  });

  it("spotlights signup without hiding a question already written", () => {
    const progress = selfServeProgress({
      ...empty,
      emphasizeSignup: true,
      question:
        "Should we hold the inspection interval on the reclaim pump until the next outage?",
      caseOpen: true,
    });
    expect(progress.steps[0].status).toBe("now");
    expect(progress.steps[1].status).toBe("done");
    expect(progress.steps[2].status).toBe("done");
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
    const progress = selfServeProgress(empty);
    for (const step of progress.steps) {
      expect(stripForSpeech(step.narration)).toBe(step.narration);
      expect(step.narration.length).toBeLessThanOrEqual(SYNC_TTS_MAX_CHARS);
    }
  });
});
