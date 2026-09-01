import {
  createSeedDecisionCases,
  type DecisionCase,
  type DecisionIndustryId,
  type DecisionJourneyContext,
} from "./decision-case";

/**
 * Empty first-paint conversion set. One chip rotates through these
 * questions in this order. P-101 seal inspection is not in the set.
 *
 * Each entry reuses an existing governed Decision Case. Overlaying the
 * chip question as the user turn does not invent ROI or thresholds.
 */
export const FIRST_PAINT_CYCLE_MS = 6000;

export const FIRST_PAINT_QUESTIONS = [
  "What should we fix first to recover the most production?",
  "Can this asset safely run until the next planned shutdown?",
  "Which assets are costing us the most in avoidable downtime?",
  "Which PM tasks can we extend or eliminate?",
  "Why does this equipment keep failing after repair?",
  "Should we repair, redesign, or replace this asset?",
] as const;

export type FirstPaintSeedIndex = 0 | 1 | 2 | 3 | 4 | 5;

type FirstPaintSeedSpec = {
  question: (typeof FIRST_PAINT_QUESTIONS)[number];
  industry: DecisionIndustryId;
  caseIndex: number;
};

export const FIRST_PAINT_SEEDS: readonly FirstPaintSeedSpec[] = [
  {
    question: FIRST_PAINT_QUESTIONS[0],
    industry: "mining",
    caseIndex: 0,
  },
  {
    question: FIRST_PAINT_QUESTIONS[1],
    industry: "oil-gas",
    caseIndex: 1,
  },
  {
    question: FIRST_PAINT_QUESTIONS[2],
    industry: "mining",
    caseIndex: 1,
  },
  {
    question: FIRST_PAINT_QUESTIONS[3],
    industry: "mining",
    caseIndex: 2,
  },
  {
    question: FIRST_PAINT_QUESTIONS[4],
    industry: "manufacturing",
    caseIndex: 0,
  },
  {
    question: FIRST_PAINT_QUESTIONS[5],
    industry: "manufacturing",
    caseIndex: 1,
  },
];

const BANNED_FIRST_PAINT_ASSET = /P-101/i;
const BANNED_FIRST_PAINT_TITLE = /seal inspection/i;

export function normalizeFirstPaintIndex(index: number): FirstPaintSeedIndex {
  if (index >= 0 && index < FIRST_PAINT_SEEDS.length) {
    return index as FirstPaintSeedIndex;
  }
  return 0;
}

function withFirstPaintQuestion(
  seed: DecisionCase,
  question: string,
): DecisionCase {
  const userMessage = {
    id: `${seed.id}-first-paint-user`,
    role: "user" as const,
    author: "You",
    text: question,
    createdAt: seed.updatedAt,
  };
  const withoutUser = seed.messages.filter((item) => item.role !== "user");
  const messages = withoutUser.map((item) => {
    if (item.role !== "assistant") return item;
    const meta = item.meta ?? "Deterministic analysis";
    return {
      ...item,
      meta: /recommendation/i.test(meta)
        ? meta
        : `${meta} · governed recommendation`,
    };
  });
  const assistantAt = messages.findIndex((item) => item.role === "assistant");
  const next = [...messages];
  next.splice(assistantAt === -1 ? next.length : assistantAt, 0, userMessage);
  return { ...seed, messages: next };
}

export function createFirstPaintSeed(
  index: number,
  context: DecisionJourneyContext = {},
): DecisionCase {
  const spec = FIRST_PAINT_SEEDS[normalizeFirstPaintIndex(index)];
  const pack = createSeedDecisionCases({
    ...context,
    industry: spec.industry,
  });
  const base = pack[spec.caseIndex];
  if (
    !base ||
    BANNED_FIRST_PAINT_ASSET.test(base.asset) ||
    BANNED_FIRST_PAINT_TITLE.test(base.title)
  ) {
    const fallback = createSeedDecisionCases({
      ...context,
      industry: "mining",
    })[0];
    return withFirstPaintQuestion(fallback, spec.question);
  }
  return withFirstPaintQuestion(base, spec.question);
}
