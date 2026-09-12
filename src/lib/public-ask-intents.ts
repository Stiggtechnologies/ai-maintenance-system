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
 * There is no parallel Compare/Troubleshoot/Health/Learn/Fact Check RPC or
 * route. Each intent opens a governed seed and the relevant section of that
 * same canonical Decision Case record.
 */
export type PublicAskIntentId =
  "compare" | "troubleshoot" | "health" | "learn" | "fact-check";

export type PublicAskRecordTab =
  "decision" | "evidence" | "authority" | "work" | "value";

export type PublicAskIntent = {
  id: PublicAskIntentId;
  label: string;
  showcase: string;
  module: string;
  explanation: string;
  recordTab: PublicAskRecordTab;
  seedIndex: FirstPaintSeedIndex;
  question: (typeof FIRST_PAINT_QUESTIONS)[number];
};

export const PUBLIC_ASK_INTENTS: readonly PublicAskIntent[] = [
  {
    id: "compare",
    label: "Compare",
    showcase: "Production opportunity",
    module: "Decision comparison",
    explanation: "Compare options, consequences, value, and evidence gaps.",
    recordTab: "decision",
    seedIndex: 0,
    question: FIRST_PAINT_QUESTIONS[0],
  },
  {
    id: "troubleshoot",
    label: "Troubleshoot",
    showcase: "Repeat failure",
    module: "Failure elimination",
    explanation: "Trace the repeat pattern, hypotheses, and evidence plan.",
    recordTab: "evidence",
    seedIndex: 4,
    question: FIRST_PAINT_QUESTIONS[4],
  },
  {
    id: "health",
    label: "Health",
    showcase: "Operating risk",
    module: "Run-or-intervene decision",
    explanation: "Review condition evidence before deciding whether to run.",
    recordTab: "decision",
    seedIndex: 1,
    question: FIRST_PAINT_QUESTIONS[1],
  },
  {
    id: "learn",
    label: "Learn",
    showcase: "PM effectiveness",
    module: "Learning and value loop",
    explanation: "See how an approved change is verified against its baseline.",
    recordTab: "value",
    seedIndex: 3,
    question: FIRST_PAINT_QUESTIONS[3],
  },
  {
    id: "fact-check",
    label: "Fact Check",
    showcase: "Downtime evidence",
    module: "Evidence assurance",
    explanation: "Separate established facts from assumptions and missing proof.",
    recordTab: "evidence",
    seedIndex: 2,
    question: FIRST_PAINT_QUESTIONS[2],
  },
];

export function publicAskIntentById(id: string): PublicAskIntent | undefined {
  return PUBLIC_ASK_INTENTS.find((item) => item.id === id);
}
