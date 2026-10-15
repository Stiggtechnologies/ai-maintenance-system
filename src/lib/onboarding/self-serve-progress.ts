/**
 * Self-serve path from sign-up through a first Decision Case to first value.
 * Derived from the ask-first spine. It does not create a second case store.
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
  question: string;
  caseOpen: boolean;
  exampleOnly: boolean;
  suppliedEvidence: number;
  /** Signup screen spotlights the workspace step without erasing later progress. */
  emphasizeSignup?: boolean;
};

export type SelfServeProgress = {
  steps: readonly SelfServeStep[];
  narration: string;
};

export function suppliedEvidenceCount(
  evidence: ReadonlyArray<{ quality?: string }> | null | undefined,
): number {
  return (evidence ?? []).filter(
    (item) => item.quality === "high" || item.quality === "medium",
  ).length;
}

const SIGNUP_NARRATION =
  "Create an evaluation workspace when you want to keep the Decision Case. You can ask a question first. Sync recommends. You authorize. Nothing here runs the plant.";

const QUESTION_NARRATION =
  "Write the engineering decision in your own words. Example buttons show the full question and only fill the box. An example is not saved as your case.";

const CASE_NARRATION =
  "Your Decision Case is open. Add one file, paste, or manual note. Sync will not invent readings or approve the change.";

const VALUE_NARRATION =
  "You attached evidence. Read the recommendation against that evidence. It is not an approval. Record your own decision and how you will check the outcome.";

const COMPLETE_NARRATION = VALUE_NARRATION;

export function selfServeProgress(
  input: SelfServeProgressInput,
): SelfServeProgress {
  const questionText = input.question.trim();
  const example =
    input.exampleOnly ||
    (questionText.length > 0 && isExamplePrompt(questionText));
  const questionDone =
    questionText.length >= SELF_SERVE_QUESTION_MIN && !example;
  const caseDone = questionDone && input.caseOpen && !input.exampleOnly;
  const valueDone = caseDone && input.suppliedEvidence > 0;
  const signupDone = input.signedIn;
  const signupNow = Boolean(input.emphasizeSignup) && !signupDone;

  const productNow: SelfServeStepId | null = !questionDone
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
    return productNow === id ? "now" : "open";
  };

  const questionEmpty = example
    ? "This is still only an example question. Nothing of yours is saved. Rewrite it in your own words to open a Decision Case."
    : "No question yet. Write the engineering decision in the Ask box. Example buttons show the full question and only fill the box.";

  const steps: readonly SelfServeStep[] = [
    {
      id: "signup",
      title: "Create a workspace",
      status: statusFor("signup", signupDone),
      empty:
        "No evaluation workspace yet. You can ask first. Create a workspace when you want to keep the Decision Case. You do not need to talk to anyone to do this.",
      doneDetail:
        "You are signed in. This evaluation workspace can keep the Decision Case.",
      narration: SIGNUP_NARRATION,
    },
    {
      id: "question",
      title: "Ask your question",
      status: statusFor("question", questionDone),
      empty: questionEmpty,
      doneDetail: "Your question is ready. It is not an example preview.",
      narration: QUESTION_NARRATION,
    },
    {
      id: "decision_case",
      title: "Open your first Decision Case",
      status: statusFor("decision_case", caseDone),
      empty:
        "No Decision Case is open yet. Continue with your own question to open one. An example question is not your case and is not saved.",
      doneDetail:
        "Your Decision Case is open. Evidence, the recommendation, and your decision stay on this case.",
      narration: CASE_NARRATION,
    },
    {
      id: "first_value",
      title: "See first value",
      status: statusFor("first_value", valueDone),
      empty:
        "No first value yet. Add one file, paste, or manual note on the Decision Case. Until then the page only shows the case structure. Sync will not invent readings, and a recommendation is not an approval.",
      doneDetail:
        "You attached evidence. Review the recommendation against it. It is not an approval and it does not run the plant.",
      narration: VALUE_NARRATION,
    },
  ];

  const narration = signupNow
    ? SIGNUP_NARRATION
    : (steps.find((step) => step.status === "now")?.narration ??
      COMPLETE_NARRATION);

  return { steps, narration };
}
