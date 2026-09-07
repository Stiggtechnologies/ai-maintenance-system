import {
  FIRST_PAINT_QUESTIONS,
  type FirstPaintSeedIndex,
} from "./first-paint-seeds";

/**
 * Bolt rest-state pills → existing first-paint seeds.
 *
 * Labels are intents, not a demo library. Each pill loads one of the six
 * locked conversion questions via createFirstPaintSeed. P-101 is still banned
 * by that catalog. Question 5 (repair / redesign / replace) has no pill;
 * it remains available as typed ask.
 *
 * There is no Compare/Troubleshoot/Health/Learn/Fact Check RPC or route —
 * these only choose which governed seed to open.
 */
export type PublicAskIntentId =
  "compare" | "troubleshoot" | "health" | "learn" | "fact-check";

export type PublicAskIntent = {
  id: PublicAskIntentId;
  label: string;
  seedIndex: FirstPaintSeedIndex;
  question: (typeof FIRST_PAINT_QUESTIONS)[number];
};

export const PUBLIC_ASK_INTENTS: readonly PublicAskIntent[] = [
  {
    id: "compare",
    label: "Compare",
    seedIndex: 0,
    question: FIRST_PAINT_QUESTIONS[0],
  },
  {
    id: "troubleshoot",
    label: "Troubleshoot",
    seedIndex: 4,
    question: FIRST_PAINT_QUESTIONS[4],
  },
  {
    id: "health",
    label: "Health",
    seedIndex: 1,
    question: FIRST_PAINT_QUESTIONS[1],
  },
  {
    id: "learn",
    label: "Learn",
    seedIndex: 3,
    question: FIRST_PAINT_QUESTIONS[3],
  },
  {
    id: "fact-check",
    label: "Fact Check",
    seedIndex: 2,
    question: FIRST_PAINT_QUESTIONS[2],
  },
];

export function publicAskIntentById(id: string): PublicAskIntent | undefined {
  return PUBLIC_ASK_INTENTS.find((item) => item.id === id);
}
