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

export const FORT_MCMURRAY_DEMO_ORG_ID =
  "11111111-1111-1111-1111-111111111111";
export const DEMO_COWORK_WORKSPACE_ID =
  "cccccccc-1111-0000-0000-000000000001";

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
        "Do not cite Fort McMurray, P-101, DC-1048, or other seeded assets unless the user just named them.",
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
