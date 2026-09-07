/** P0.1 inverted opening — copy + example prompts. Never seed a customer workspace. */

export const INVERTED_OPENING_HEADLINE =
  "Get one real engineering decision through Sync in 20 minutes";

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
    body: "Useful after you have a question — evidence upload/paste/connect, not adapter shopping first.",
  },
] as const;
