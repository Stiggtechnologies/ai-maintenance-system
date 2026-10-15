/**
 * Self-serve path from sign-up through a first Decision Case to first value.
 * Derived from the ask-first spine. It does not create a second case store.
 *
 * "Decision Case open" and "first value" are done only from a persisted
 * server receipt. A browser draft is not done.
 */
import { isExamplePrompt } from "./inverted-opening";

export const SELF_SERVE_QUESTION_MIN = 12;

export type SelfServeStepId =
  "signup" | "question" | "decision_case" | "first_value";

export type SelfServeStepStatus = "done" | "now" | "open";

export type SelfServeStep = {
  id: SelfServeStepId;
  title: string;
  status: SelfServeStepStatus;
  /** Shown while the step is not done. */
  empty: string;
  /** Shown once the step is done. */
  doneDetail: string;
  narration: string;
};

export type SelfServeProgressInput = {
  signedIn: boolean;
  /** Canonical workspace membership. The signup step is done only from this. */
  hasWorkspace: boolean;
  /** A session exists, or signup already created the account. */
  accountExists: boolean;
  question: string;
  /** The spine is showing a case with no server receipt for this revision. */
  draftOpen: boolean;
  /** Server receipt for the current Decision Case revision. */
  caseSaved: boolean;
  exampleOnly: boolean;
  /** Supplied evidence on the saved revision only. */
  savedSuppliedEvidence: number;
  /** Reviewable recommendation text on the saved revision. */
  savedRecommendation: boolean;
  /** Signup screen spotlights the workspace step without erasing later progress. */
  emphasizeSignup?: boolean;
};

export type SelfServeProgress = {
  steps: readonly SelfServeStep[];
  narration: string;
  /** False once an account or workspace already exists. */
  offerWorkspace: boolean;
};

export function suppliedEvidenceCount(
  evidence: ReadonlyArray<{ quality?: string }> | null | undefined,
): number {
  return (evidence ?? []).filter(
    (item) => item.quality === "high" || item.quality === "medium",
  ).length;
}

/** Placeholder spine copy is the case structure, not a saved recommendation. */
const NOT_A_SAVED_RECOMMENDATION = /no asset-specific recommendation/i;

export function isReviewableSavedRecommendation(
  text: string | null | undefined,
): boolean {
  const value = text?.trim() ?? "";
  if (value.length < SELF_SERVE_QUESTION_MIN) return false;
  return !NOT_A_SAVED_RECOMMENDATION.test(value);
}

const SIGNUP_NARRATION =
  "Create an evaluation workspace when you want to keep the Decision Case. You can ask a question first. Sync recommends. You authorize. Nothing here runs the plant.";

const QUESTION_NARRATION =
  "Write the engineering decision in your own words. Example buttons show the full question and only fill the box. An example is not saved as your case.";

const DRAFT_CASE_NARRATION =
  "This Decision Case is only in the browser. It is not saved, so it is not done. Save it on an evaluation workspace before it counts. Sync will not invent readings or approve the change.";

const VALUE_NARRATION =
  "First value counts only after a saved recommendation or saved evidence is on the Decision Case. A note still in this browser does not count. A recommendation is not an approval.";

const COMPLETE_NARRATION =
  "A saved recommendation or saved evidence is on this Decision Case. Read it against that evidence. It is not an approval. Record your own decision and how you will check the outcome.";

export function selfServeProgress(
  input: SelfServeProgressInput,
): SelfServeProgress {
  const questionText = input.question.trim();
  const example =
    input.exampleOnly ||
    (questionText.length > 0 && isExamplePrompt(questionText));
  const questionWritten =
    questionText.length >= SELF_SERVE_QUESTION_MIN && !example;
  const caseSaved = input.caseSaved && questionWritten && !input.exampleOnly;
  const questionDone = caseSaved;
  const caseDone = caseSaved;
  const valueDone =
    caseDone && (input.savedSuppliedEvidence > 0 || input.savedRecommendation);
  const signupDone = input.hasWorkspace;
  const signupNow = Boolean(input.emphasizeSignup) && !signupDone;
  const offerWorkspace =
    !input.signedIn && !input.hasWorkspace && !input.accountExists;

  const productNow: SelfServeStepId | null = !questionWritten
    ? "question"
    : !caseDone
      ? "decision_case"
      : !valueDone
        ? "first_value"
        : null;

  const statusFor = (
    id: SelfServeStepId,
    done: boolean,
  ): SelfServeStepStatus => {
    if (done) return "done";
    if (id === "signup") return signupNow ? "now" : "open";
    if (signupNow) return "open";
    // An example and a written question that is not saved yet are both Now.
    // Done waits until that question is on a saved Decision Case.
    if (id === "question" && (example || questionWritten) && !questionDone) {
      return "now";
    }
    return productNow === id ? "now" : "open";
  };

  const questionEmpty = example
    ? "This is still only an example question. Nothing of yours is saved. Rewrite it in your own words to open a Decision Case."
    : questionWritten
      ? "This question is only in this browser. It is not a saved Decision Case."
      : "No question yet. Write the engineering decision in the Ask box. Example buttons show the full question and only fill the box.";

  const caseEmpty = input.draftOpen
    ? "This Decision Case is only a browser draft. It is not saved, so it is not done."
    : questionWritten && !caseSaved
      ? "No Decision Case is saved yet. Continue with your question, then save it on a workspace. A browser draft is not done."
      : "No Decision Case is open yet. Continue with your own question to open one. An example question is not your case and is not saved.";

  const valueEmpty = input.draftOpen
    ? "No saved first value yet. A note still only in this browser does not count. A recommendation is not an approval."
    : caseSaved
      ? "No saved first value yet. Save a recommendation or one piece of evidence on this Decision Case. A browser draft does not count, and a recommendation is not an approval."
      : "No first value yet. Save the Decision Case, then save one file, paste, or manual note. A browser draft does not count. Sync will not invent readings, and a recommendation is not an approval.";

  const signupEmpty =
    input.accountExists || input.signedIn
      ? "This account already exists. This screen will not create another workspace. A Decision Case counts only after it is saved on the workspace you have."
      : "No evaluation workspace yet. You can ask first. Create a workspace when you want to keep the Decision Case. You do not need to talk to anyone to do this.";

  const steps: readonly SelfServeStep[] = [
    {
      id: "signup",
      title: "Create a workspace",
      status: statusFor("signup", signupDone),
      empty: signupEmpty,
      doneDetail:
        "Your evaluation workspace is saved on this account. This screen will not create another one.",
      narration: SIGNUP_NARRATION,
    },
    {
      id: "question",
      title: "Ask your question",
      status: statusFor("question", questionDone),
      empty: questionEmpty,
      doneDetail: "Your question is saved on the Decision Case.",
      narration: QUESTION_NARRATION,
    },
    {
      id: "decision_case",
      title: "Open your first Decision Case",
      status: statusFor("decision_case", caseDone),
      empty: caseEmpty,
      doneDetail:
        "This Decision Case is saved on the evaluation workspace. A browser draft does not count.",
      narration: DRAFT_CASE_NARRATION,
    },
    {
      id: "first_value",
      title: "See first value",
      status: statusFor("first_value", valueDone),
      empty: valueEmpty,
      doneDetail:
        "A saved recommendation or saved evidence is on this Decision Case. Review it. It is not an approval and it does not run the plant.",
      narration: valueDone ? COMPLETE_NARRATION : VALUE_NARRATION,
    },
  ];

  const narration = signupNow
    ? SIGNUP_NARRATION
    : productNow === "question"
      ? QUESTION_NARRATION
      : productNow === "decision_case"
        ? DRAFT_CASE_NARRATION
        : productNow === "first_value"
          ? VALUE_NARRATION
          : COMPLETE_NARRATION;

  return { steps, narration, offerWorkspace };
}
