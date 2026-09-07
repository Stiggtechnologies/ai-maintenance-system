/**
 * Chat / Decision Workspace honesty — do not silently bind the reference
 * demo case for a signed-in org session.
 *
 * Lives outside `decision-case.ts` on purpose: that file is an RE-2026.08
 * protected surface. Seeding helpers stay there for explicit demo / first-paint
 * pills. This module decides whether those seeds may become the active case
 * or enter the ask context pack.
 */
import {
  createDraftDecisionCase,
  createSeedDecisionCases,
  DEFAULT_DECISION_CASE_ID,
  normalizeDecisionIndustry,
  type DecisionCase,
  type DecisionIndustryId,
  type DecisionJourneyContext,
} from "./decision-case";

export const FORT_MCMURRAY_DEMO_ORG_ID = "11111111-1111-1111-1111-111111111111";
export const DEMO_COWORK_WORKSPACE_ID = "cccccccc-1111-0000-0000-000000000001";

const SEED_INDUSTRIES: DecisionIndustryId[] = [
  "oil-gas",
  "mining",
  "manufacturing",
];

export const SEED_DECISION_CASE_IDS: ReadonlySet<string> = new Set(
  SEED_INDUSTRIES.flatMap((industry) =>
    createSeedDecisionCases({ industry }).map((item) => item.id),
  ),
);

export const DEMO_CASE_SUBJECT_PATTERN =
  /P-101|dc-1048|DC-1048|Fort McMurray|North Ridge Energy|Copper Ridge Mining|cccccccc-1111/i;

export function isSeedDecisionCaseId(id: string | null | undefined): boolean {
  if (!id) return false;
  return (
    SEED_DECISION_CASE_IDS.has(id) ||
    id === DEFAULT_DECISION_CASE_ID ||
    id === DEMO_COWORK_WORKSPACE_ID
  );
}

export function isExplicitDemoRouteId(
  routeId: string | null | undefined,
): boolean {
  return routeId === "demo";
}

export function hasBoundDecisionSubject(
  decisionCase: DecisionCase | null | undefined,
): boolean {
  if (!decisionCase) return false;
  if (isSeedDecisionCaseId(decisionCase.id)) return true;
  const asset = decisionCase.asset.trim();
  if (!asset || /^decision scope not yet defined$/i.test(asset)) return false;
  if (decisionCase.stage === "intent" && decisionCase.evidence.length === 0) {
    return false;
  }
  return true;
}

export type DecisionAskBinding =
  | { bound: false }
  | { bound: true; caseId: string; decisionCase: DecisionCase };

export function resolveDecisionAskBinding(
  decisionCase: DecisionCase | null | undefined,
): DecisionAskBinding {
  if (!decisionCase || !hasBoundDecisionSubject(decisionCase)) {
    return { bound: false };
  }
  return {
    bound: true,
    caseId: decisionCase.id,
    decisionCase,
  };
}

export function buildDecisionAskContextPack(
  decisionCase: DecisionCase | null | undefined,
): {
  caseId: string | null;
  injectCase: boolean;
  contextLines: string[];
} {
  const binding = resolveDecisionAskBinding(decisionCase);
  if (!binding.bound) {
    return {
      caseId: null,
      injectCase: false,
      contextLines: [
        "No decision case is selected.",
        "Stay general. Do not assume a demo, reference, or seed case.",
        "Do not invent a plant, asset, or case subject the user has not named.",
      ],
    };
  }
  return {
    caseId: binding.caseId,
    injectCase: true,
    contextLines: [
      `Decision Case ${binding.decisionCase.caseNumber} ${binding.decisionCase.version}`,
      `Asset: ${binding.decisionCase.asset}`,
    ],
  };
}

export function createHonestEmptyDecisionCase(
  role: string,
  industry: DecisionIndustryId = "oil-gas",
): DecisionCase {
  const draft = createDraftDecisionCase(role, industry);
  return {
    ...draft,
    organization: "",
    site: "",
    industry,
  };
}

export function pickInitialSelectedCaseId(
  routeId: string | undefined,
  cases: DecisionCase[],
): string | null {
  if (routeId && !isExplicitDemoRouteId(routeId)) {
    const routed = cases.find((item) => item.id === routeId);
    if (routed) return routed.id;
  }
  const unbound = cases.find((item) => !isSeedDecisionCaseId(item.id));
  return unbound?.id ?? null;
}

export function filterSeedCasesForOrgSession(
  cases: DecisionCase[],
  routeId?: string,
): DecisionCase[] {
  return cases.filter(
    (item) => !isSeedDecisionCaseId(item.id) || item.id === routeId,
  );
}

const GREETING_PATTERN =
  /^(hi|hello|hey|good morning|good afternoon)[.?!\s]*$/i;
const CAPABILITY_PATTERN =
  /\b(what (?:are )?your capabilities|what can you do|how can you help|capability overview|show (?:me )?your capabilities)\b/i;
const VAGUE_TOPIC_CHANGE_PATTERN =
  /\b(someth\w* else|something different|another thing|different topic|new topic|talk without(?: a)? decision case|without (?:a |the )?decision case|no decision case)\b/i;
const EQUIPMENT_PATTERN =
  /\b(pump|compressor|crusher|conveyor|gearbox|motor|turbine|boiler|furnace|press|stamping press|fan|blower|valve|pipeline|vessel|transformer|generator|truck|haul truck|shovel|mill|kiln|screen|feeder|robot|robotic|weld cell|packaging line|production line)\b/gi;
const OEM_MODEL_PATTERN =
  /\b(?:caterpillar|cat|komatsu|hitachi|liebherr|volvo|terex|sandvik|epiroc|john deere|cummins)\s+[a-z0-9][a-z0-9-]{1,20}\b/i;
const RELIABILITY_PROBLEM_PATTERN =
  /\b(availability|mtbf|mttr|mttf|fmea|fmeca|rcm|rca|fracas|pm interval|inspection interval|condition monitoring|vibration|downtime|bad actor|onboard|commission|optimization|optimise|optimize|stocking|lookahead|backlog)\b/i;
const NON_ASSET_PREFIXES = new Set([
  "API",
  "DC",
  "FMEA",
  "FRACAS",
  "IEC",
  "ISO",
  "MOC",
  "NPSH",
  "OEM",
  "PFD",
  "PFT",
  "PM",
  "PO",
  "RCA",
  "RCM",
  "RAM",
  "WO",
  "WP",
]);
const COMMON_CAPS_WORDS = new Set([
  "AND",
  "ARE",
  "CAN",
  "FOR",
  "HOW",
  "NOT",
  "THE",
  "YOU",
  "WANT",
  "TALK",
  "THIS",
  "THAT",
  "WHAT",
  "WITH",
  "FROM",
  "HAVE",
  "WILL",
]);

/** Existing classify trigger in reliability-agent-contract (`new subject`). */
export const UNBOUND_LIVE_SUBJECT_PREFIX = "New subject.";

export function isGreetingPrompt(prompt: string): boolean {
  return GREETING_PATTERN.test(prompt.trim());
}

export function isCapabilityPrompt(prompt: string): boolean {
  return CAPABILITY_PATTERN.test(prompt.toLowerCase());
}

export function signalsTopicChange(prompt: string): boolean {
  const lower = prompt.toLowerCase();
  return (
    VAGUE_TOPIC_CHANGE_PATTERN.test(lower) ||
    (/\b(look|review|check|examine|analy[sz]e)\b/.test(lower) &&
      /\b(other|else|different|another)\b/.test(lower))
  );
}

export function promptNamesConcreteSubject(prompt: string): boolean {
  const text = prompt.trim();
  if (!text || isGreetingPrompt(text) || isCapabilityPrompt(text)) {
    return false;
  }
  const words = text.split(/\s+/).filter(Boolean);
  if (/\b[A-Z]{1,6}[- ]?\d{2,6}\b/.test(text)) {
    const prefix = text
      .toUpperCase()
      .match(/\b([A-Z]{1,6})[- ]?\d{2,6}\b/)?.[1];
    if (!prefix || !NON_ASSET_PREFIXES.has(prefix)) return true;
  }
  if (OEM_MODEL_PATTERN.test(text)) return true;
  if ([...text.matchAll(EQUIPMENT_PATTERN)].length > 0) return true;
  if (namedSiteOrFleetCode(text)) return true;
  if (/[:\n]/.test(text) && words.length >= 4) return true;
  if (words.length > 14) return true;
  if (RELIABILITY_PROBLEM_PATTERN.test(text) && words.length >= 6) {
    return !signalsTopicChange(text) || words.length > 10;
  }
  return false;
}

function namedSiteOrFleetCode(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed === trimmed.toUpperCase()) return false;
  const tokens = trimmed.match(/\b[A-Z]{3,8}\b/g) || [];
  return tokens.some(
    (token) => !NON_ASSET_PREFIXES.has(token) && !COMMON_CAPS_WORDS.has(token),
  );
}

/**
 * Prefix that the existing gated classifier already treats as
 * `provisional_new_subject`, so the live RE path is used without editing
 * that contract.
 */
export function formatUnboundLiveQuestion(prompt: string): string {
  const trimmed = prompt.trim();
  if (/^new subject\b/i.test(trimmed)) return trimmed.slice(0, 2400);
  return `${UNBOUND_LIVE_SUBJECT_PREFIX} ${trimmed}`.slice(0, 2400);
}

/** Strip leftover seed plant facts before calling the public agent unbound. */
export function sanitizeUnboundAskCase(
  decisionCase: DecisionCase,
): DecisionCase {
  const empty = createHonestEmptyDecisionCase(
    "Reliability Engineer",
    normalizeDecisionIndustry(decisionCase.industry),
  );
  return {
    ...empty,
    id: decisionCase.id,
    caseNumber: decisionCase.caseNumber,
    industry: normalizeDecisionIndustry(decisionCase.industry),
    organization: "",
    site: "",
    messages: decisionCase.messages,
  };
}

export function bootstrapChatCases(
  routeId: string | undefined,
  context: DecisionJourneyContext,
  options: {
    orgSession: boolean;
    stored: DecisionCase[];
    role: string;
  },
): { cases: DecisionCase[]; selectedId: string } {
  const industry = normalizeDecisionIndustry(context.industry);
  const empty = createHonestEmptyDecisionCase(options.role, industry);
  const stored = options.orgSession
    ? filterSeedCasesForOrgSession(options.stored, routeId)
    : options.stored;

  const cases = stored.length > 0 ? stored : [empty];
  const selectedId = pickInitialSelectedCaseId(routeId, cases);
  if (selectedId) return { cases, selectedId };

  if (cases.some((item) => item.id === empty.id)) {
    return { cases, selectedId: empty.id };
  }
  return { cases: [empty, ...cases], selectedId: empty.id };
}
