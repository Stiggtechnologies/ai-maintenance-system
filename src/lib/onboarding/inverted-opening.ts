/** P0.1 inverted opening — copy + example prompts. Never seed a customer workspace. */

export const INVERTED_OPENING_HEADLINE =
  "Get one real engineering decision through Sync in 20 minutes";

export const INVERTED_OPENING_SUB =
  "Ask a real question. See the evidence. Make the decision. Verify the outcome.";

export const INVERTED_OPENING_AUTHORITY =
  "Sync recommends. Humans authorize. No plant execute.";

/** Labeled examples only — fill the Ask box; do not bind demo cases. */
export const INVERTED_EXAMPLE_PROMPTS = [
  {
    id: "example-seal",
    label: "Example",
    prompt:
      "What should we check first if a critical pump is losing seal water and production is at risk?",
  },
  {
    id: "example-pm",
    label: "Example",
    prompt:
      "Which PM tasks on this line look like candidates to extend or eliminate, and what evidence would we need?",
  },
] as const;

/** Exact example text is an affordance. It must not become a customer case. */
export function isExamplePrompt(text: string): boolean {
  const normalized = text.trim().replace(/\s+/g, " ");
  return INVERTED_EXAMPLE_PROMPTS.some(
    (example) => example.prompt.replace(/\s+/g, " ") === normalized,
  );
}

export type InvertedIntentId = "solve" | "coordinate" | "connect";

export const INVERTED_INTENT_CARDS = [
  {
    id: "solve" as const,
    title: "Solve an engineering question",
    body: "Start with Ask. Save when you want a durable Decision Case.",
  },
  {
    id: "coordinate" as const,
    title: "Coordinate field work",
    body: "Capture observations and route a decision — permissions come later.",
  },
  {
    id: "connect" as const,
    title: "Connect my site",
    body: "Optional after first value — a saved recommendation or saved evidence. It only checks whether this workspace already has a source. It does not add a connector or pull plant data. Paste a note or upload a file with no connection.",
  },
] as const;

export interface WorkedExample {
  recommendation: string;
  steps: string[];
  evidenceThatWouldMakeItSpecific: string[];
  whatWouldChangeIt: string;
}

/**
 * Worked examples shown only when a visitor previews a labelled example
 * prompt, so they can see what a useful recommendation looks like before
 * asking their own question. Illustrative engineering practice only: no
 * plant, no asset, no readings, no numeric limits, and never saved.
 */
const WORKED_EXAMPLES: Record<(typeof INVERTED_EXAMPLE_PROMPTS)[number]["id"], WorkedExample> = {
  "example-seal": {
    recommendation:
      "Check the seal water supply before the seal itself. Confirm flow and pressure at the seal gland against the site's approved seal-support plan, then trace back through the strainer, the flow control and the supply header.",
    steps: [
      "Confirm the symptom at the gland: is flow absent, low or erratic, and is there leakage at the seal faces?",
      "Check the supply side first: isolation valve position, a blocked strainer or orifice, the flow indicator and header pressure.",
      "If the supply is healthy, suspect the seal: worn faces, damaged secondary seals or a dry-running event.",
      "Decide with operations whether to run under watch, switch to the standby pump or take the pump out of service, under the site's operating procedure.",
    ],
    evidenceThatWouldMakeItSpecific: [
      "Recent work orders on the pump and its seal system",
      "The seal-support plan or P&ID for this pump",
      "Operator round readings for seal water flow and pressure",
      "Trip, alarm or leak records for the pump",
    ],
    whatWouldChangeIt:
      "Evidence that the supply is healthy points to the seal itself; repeat events after a seal replacement point to the operating condition or the installation.",
  },
  "example-pm": {
    recommendation:
      "Rank the line's PM tasks by what they have found, not by how often they run. Tasks that keep finding nothing, on failure modes that give warning, are candidates to extend; tasks another check already covers are candidates to remove.",
    steps: [
      "List each PM task with the failure mode it is meant to prevent or detect.",
      "Pull each task's findings history: what was found, and what corrective work followed.",
      "Flag tasks with no findings on failure modes that give warning (extend) and tasks duplicated by condition monitoring or another task (remove).",
      "Leave tasks that protect hidden or safety functions to the approved maintenance policy; finding rates alone do not change them.",
    ],
    evidenceThatWouldMakeItSpecific: [
      "The PM task list with intervals",
      "Completed PM records with their findings",
      "Corrective work orders on the same assets",
      "Failure history for the line",
    ],
    whatWouldChangeIt:
      "A task that found nothing but protects a hidden or safety function stays; a rise in failures after an extension reverses it.",
  },
};

export function workedExampleFor(text: string): WorkedExample | null {
  const normalized = text.trim().replace(/\s+/g, " ");
  const example = INVERTED_EXAMPLE_PROMPTS.find(
    (item) => item.prompt.replace(/\s+/g, " ") === normalized,
  );
  return example ? WORKED_EXAMPLES[example.id] : null;
}
