/**
 * Sync Develop Slice 5A — the Requirement object (D4.16, §10), the
 * Verification object (D4.17, §11) and the Requirements Agent's findings
 * (D12.09, §59).
 *
 * WHAT LIVES HERE AND WHAT DOES NOT — the controls.ts / change.ts precedent,
 * unchanged:
 *
 *   1. THE VOCABULARIES the spec fixes: §10's eleven categories, §11's five
 *      verification methods. They mirror sync_spec10_requirement_categories()
 *      and sync_verification_methods() and the slice test pins each one
 *      against the migration text, so a category cannot appear on a form
 *      that the CHECK would reject, and a method cannot be dropped from one
 *      side only.
 *
 *   2. THE TYPES for the payloads, so a panel cannot read a key the RPC does
 *      not return.
 *
 *   3. PURE PRESENTATION HELPERS, and specifically the wording of an
 *      ABSENCE. Nothing here computes a coverage figure — every percentage
 *      comes off get_case_requirement_traceability, which refuses rather than
 *      dividing by zero. What this module decides is how a REFUSAL and a NULL
 *      are worded, which is the only judgement a surface is allowed to make
 *      about a number it did not compute.
 */

/* ────────────────────────── the vocabularies ─────────────────────────── */

/**
 * Spec III.§10's eleven categories, in the spec's own order.
 *
 * The database's CHECK is the UNION of these and the five reliability-by-
 * design categories design_requirements predates §10 with (20261204090000
 * ruling 2). Both lists are here because a form that offered only eleven
 * would make the other five unwritable through the product while remaining
 * legal in the table — the gap between what the schema allows and what the
 * surface offers is where "the data model supports it" claims come from.
 */
export const SPEC10_REQUIREMENT_CATEGORIES = [
  { key: "functional", label: "Functional" },
  { key: "performance", label: "Performance" },
  { key: "safety", label: "Safety" },
  { key: "reliability", label: "Reliability" },
  { key: "availability", label: "Availability" },
  { key: "maintainability", label: "Maintainability" },
  { key: "environmental", label: "Environmental" },
  { key: "cyber", label: "Cyber" },
  { key: "regulatory", label: "Regulatory" },
  { key: "operability", label: "Operability" },
  { key: "quality", label: "Quality" },
] as const;

/** The five E8.01 categories that are NOT §10 categories, kept and labelled. */
export const RELIABILITY_BY_DESIGN_CATEGORIES = [
  { key: "access", label: "Access" },
  { key: "instrumentation", label: "Instrumentation" },
  { key: "standardisation", label: "Standardisation" },
  { key: "sparing", label: "Sparing" },
  { key: "data_handover", label: "Data handover" },
] as const;

/**
 * What a requirement form OFFERS, §10's eleven first.
 *
 * Both groups are here because a form that offered only the eleven would make
 * the other five unwritable through the product while remaining legal in the
 * table — and the gap between what a schema allows and what a surface offers
 * is where "the data model supports it" claims come from.
 */
export const REQUIREMENT_CATEGORY_GROUPS = [
  { label: "§10 categories", options: SPEC10_REQUIREMENT_CATEGORIES },
  {
    label: "Reliability-by-design categories",
    options: RELIABILITY_BY_DESIGN_CATEGORIES,
  },
] as const;

export type Spec10Category =
  (typeof SPEC10_REQUIREMENT_CATEGORIES)[number]["key"];

export function isSpec10Category(category: string): boolean {
  return SPEC10_REQUIREMENT_CATEGORIES.some((c) => c.key === category);
}

/** Spec III.§11's five verification methods. */
export const VERIFICATION_METHODS = [
  { key: "analysis", label: "Analysis" },
  { key: "inspection", label: "Inspection" },
  { key: "demonstration", label: "Demonstration" },
  { key: "test", label: "Test" },
  { key: "operational_validation", label: "Operational validation" },
] as const;

export type VerificationMethod = (typeof VERIFICATION_METHODS)[number]["key"];

/**
 * The methods that produce a NUMBER a criterion is compared against. A
 * requirement verified by one of these with no acceptance criteria is the
 * deterministic inconsistency the agent raises (subFamily
 * `testable_without_acceptance_criteria`), and the form demands criteria
 * before it will offer them.
 */
export const MEASURED_VERIFICATION_METHODS: VerificationMethod[] = [
  "test",
  "operational_validation",
];

export const REQUIREMENT_SOURCES = [
  { key: "engineering", label: "Engineering" },
  { key: "operations", label: "Operations" },
  { key: "maintenance", label: "Maintenance" },
  { key: "incident", label: "Incident" },
  { key: "regulatory", label: "Regulatory" },
  { key: "operational_lesson", label: "Operational lesson" },
] as const;

/* ─────────────────────────────── the types ───────────────────────────── */

export interface RequirementChainLink {
  link: string;
  home: string;
  built: boolean;
  count: number | null;
  deferral?: string;
}

export interface RequirementGapRow {
  requirementId: number;
  requirementRef: string;
  category?: string;
  requirement?: string;
  verificationStatus?: string;
  verificationMethod?: string | null;
  owner?: string | null;
  /** Set on the verificationFailed rows: whether the failure still stands. */
  failureStandsUnretracted?: boolean;
  /** Set on the verificationFailed rows: what the failed verification measured. */
  measured?: string | null;
}

export interface RequirementTraceability {
  caseId: string;
  refused: boolean;
  refusal?: string;
  requirementCount: number;
  spec10Categories?: string[];
  hierarchy?: { roots: number; children: number; maxDepth: number };
  threadCoveragePct: number | null;
  verifiedPct: number | null;
  chain: RequirementChainLink[];
  scopeChain?: {
    owner: string;
    /**
     * Whether the delegated WBS question was ANSWERED. False means the
     * delegate refused and the empty arrays below mean "not asked", not
     * "none found" — the distinction every helper here is required to keep.
     */
    answered?: boolean;
    requirementsWithoutWbs: RequirementGapRow[];
    requirementsWithoutNeed: RequirementGapRow[];
    note: string;
  };
  gaps: {
    withoutObjective?: RequirementGapRow[];
    withoutVerificationMethod?: RequirementGapRow[];
    /**
     * status = 'open': nobody has recorded a result yet. Deliberately NOT
     * named `unverified` — the Requirements Agent uses that word for a wider
     * set (open OR failed, minus the missing-method rows) and the two numbers
     * were rendered one above the other under one label.
     */
    awaitingVerification?: RequirementGapRow[];
    /** status = 'failed': somebody looked and it did not meet the criteria. */
    verificationFailed?: RequirementGapRow[];
    withoutOwner?: RequirementGapRow[];
    withoutAcceptanceCriteria?: RequirementGapRow[];
    outsideSpec10Taxonomy?: RequirementGapRow[];
    withoutInstalledAsset?: number;
    withoutCommissioningTest?: number;
    withoutOperatingKpi?: number;
  };
  refusals?: string[];
  calculationRunId?: string | null;
}

export interface RequirementVerification {
  obligationId: string;
  requirementId: number;
  requirementRef: string;
  requirement: string;
  methodCode: VerificationMethod | string;
  procedure: string | null;
  acceptanceCriteria: string | null;
  status: string;
  result: string | null;
  measuredNote: string | null;
  dueDate: string;
  dueDateAssumed: boolean;
  daysOverdue: number;
  evidenceId: string | null;
  /** The recorded failure this verification was planned to re-test (§11 / ruling 8). */
  supersedesObligationId?: string | null;
  /** The completed achieved verification that retracted THIS failure, if any. */
  supersededByObligationId?: string | null;
  verifiedAt: string | null;
  verifiedBy: string | null;
}

export interface RequirementVerificationView {
  caseId: string;
  refused: boolean;
  refusal?: string;
  requirementCount: number;
  requirementsWithAVerification?: number;
  /** Requirements carrying a recorded failure nothing has superseded. */
  requirementsWithAStandingFailure?: number;
  openVerifications?: number;
  overdue?: number;
  verificationCoveragePct: number | null;
  methods: string[];
  verifications: RequirementVerification[];
  refusals?: string[];
}

export interface RequirementFinding {
  family: string;
  subFamily?: string;
  severity: "blocking" | "attention" | "informational" | string;
  source: "deterministic" | "ai_suggestion" | string;
  aiGenerated?: boolean;
  requirementId?: number | null;
  requirementRef?: string | null;
  relatedRequirementId?: number | null;
  relatedRequirementRef?: string | null;
  category?: string | null;
  verificationStatus?: string | null;
  detail?: string | null;
}

export interface RequirementFindings {
  caseId: string;
  refused: boolean;
  refusal?: string;
  requirementCount: number;
  findingCount: number | null;
  headline?: string;
  byFamily?: Record<string, number>;
  findings: RequirementFinding[];
  refusals?: string[];
  advisory?: boolean;
  disclaimer?: string;
}

/* ─────────────────────── presentation, not arithmetic ────────────────── */

/**
 * How a coverage percentage is WORDED when it is absent.
 *
 * The server returns null for a percentage it refused to compute (an empty
 * denominator, a non-finite ratio). This never turns that null into 0 and
 * never into 100 — the two numbers a reader would act on in opposite
 * directions, both of them wrong. It says the figure is absent and why.
 */
export function coverageLabel(
  pct: number | null | undefined,
  subject: string,
): string {
  if (pct === null || pct === undefined) {
    return `${subject}: not stated — the server refused the figure rather than dividing by an empty set`;
  }
  if (!Number.isFinite(pct)) {
    return `${subject}: not stated — the figure was non-finite`;
  }
  return `${subject}: ${pct}%`;
}

/**
 * The one-line verdict over a traceability payload.
 *
 * A REFUSED payload returns the server's refusal verbatim. It is deliberately
 * NOT softened into "no data yet": the refusal says why zero findings over an
 * empty requirement set is not good news, and that sentence is the whole
 * point of the refusal existing.
 */
export function traceabilityHeadline(
  trace: RequirementTraceability | null,
): string {
  if (!trace) return "Traceability has not been read.";
  if (trace.refused) {
    return (
      trace.refusal ?? "Traceability was refused over an empty requirement set."
    );
  }
  const missingMethod = trace.gaps.withoutVerificationMethod?.length ?? 0;
  const awaiting = trace.gaps.awaitingVerification?.length ?? 0;
  const failed = trace.gaps.verificationFailed?.length ?? 0;
  const noObjective = trace.gaps.withoutObjective?.length ?? 0;
  return (
    `${trace.requirementCount} requirement(s). ` +
    `${coverageLabel(trace.threadCoveragePct, "Thread coverage")}; ` +
    `${coverageLabel(trace.verifiedPct, "verified")}. ` +
    `${missingMethod} have no verification method, ${awaiting} are open with no result recorded, ` +
    `${failed} were verified and FAILED, ${noObjective} trace to no objective, ` +
    `${wbsClause(trace)}.`
  );
}

/**
 * The WBS clause, and the reason it is a function rather than a number.
 *
 * The requirement → WBS question is DELEGATED to get_case_scope_traceability.
 * When that delegate refuses, the server appends a refusal and leaves the list
 * empty — and `list.length` on an empty list is 0, which rendered as
 * "0 do not appear in the WBS": an unanswered question printed as a clean
 * answer, in the one sentence a reader takes away from the panel. The server
 * now says whether it was ANSWERED and this reads that flag before the count.
 */
export function wbsClause(trace: RequirementTraceability): string {
  if (trace.scopeChain?.answered === false) {
    return "whether any requirement is absent from the WBS was NOT answered — the scope-chain delegate refused, and that is not the same as none";
  }
  const noWbs = trace.scopeChain?.requirementsWithoutWbs?.length ?? 0;
  return `${noWbs} do not appear in the WBS`;
}

/**
 * The links of the §10 chain that are NOT built, with the reason.
 *
 * They are surfaced, never filtered out. A deferred link dropped from the
 * rendering reads as a link that does not exist rather than one that is not
 * built yet, which is precisely the confusion the migration's chain array
 * exists to prevent.
 */
export function deferredChainLinks(
  trace: RequirementTraceability | null,
): RequirementChainLink[] {
  return (trace?.chain ?? []).filter((l) => !l.built);
}

/** Whether the acceptance-criteria demand applies to a chosen method. */
export function methodDemandsAcceptanceCriteria(method: string): boolean {
  return (MEASURED_VERIFICATION_METHODS as string[]).includes(method);
}

/**
 * Groups findings for display, ordered by severity then family.
 *
 * AI-suggested findings are NEVER promoted above deterministic ones no matter
 * what severity arrives on them — the RPC already caps them at `attention`,
 * and this ordering is the second half of the same rule so a payload that
 * somehow carried `blocking` on an ai_suggestion would still render below the
 * facts.
 */
export function orderedFindings(
  findings: RequirementFinding[],
): RequirementFinding[] {
  const severityRank: Record<string, number> = {
    blocking: 0,
    attention: 1,
    informational: 2,
  };
  return [...findings].sort((a, b) => {
    const aiA = a.source === "ai_suggestion" ? 1 : 0;
    const aiB = b.source === "ai_suggestion" ? 1 : 0;
    if (aiA !== aiB) return aiA - aiB;
    const sa = severityRank[a.severity] ?? 3;
    const sb = severityRank[b.severity] ?? 3;
    if (sa !== sb) return sa - sb;
    if (a.family !== b.family) return a.family.localeCompare(b.family);
    return (a.requirementRef ?? "").localeCompare(b.requirementRef ?? "");
  });
}

/**
 * The findings headline, refusal-first.
 *
 * A refused payload returns the refusal. A payload with zero findings over a
 * NON-empty requirement set is a real "nothing found" and says so, with the
 * denominator attached — because "0 findings" only means anything beside the
 * number of requirements it looked at.
 */
export function findingsHeadline(findings: RequirementFindings | null): string {
  if (!findings) return "The Requirements Agent has not been run.";
  if (findings.refused) {
    return (
      findings.refusal ??
      "The agent refused: there are no requirements on this case to check."
    );
  }
  if ((findings.findingCount ?? 0) === 0) {
    return `No findings across ${findings.requirementCount} requirement(s) — every one carries a verification method, an owner and a traced position.`;
  }
  return (
    findings.headline ??
    `${findings.findingCount} finding(s) across ${findings.requirementCount} requirement(s).`
  );
}

/** Whether any finding on this payload came from a model rather than a query. */
export function hasAiGeneratedFindings(
  findings: RequirementFindings | null,
): boolean {
  return (findings?.findings ?? []).some((f) => f.source === "ai_suggestion");
}

/**
 * The gap lists a reader can act on, in one shape, with the wording of each
 * absence attached.
 *
 * These were COMPUTED by the server (each row carrying its record link) and
 * rendered nowhere: the panel showed the headline, two coverage cards, the
 * hierarchy, the chain table and the deferred links, and never the gaps
 * object. A requirement outside the §10 taxonomy, a requirement with no owner
 * and a requirement with no acceptance criteria were therefore all silently
 * counted as compliant, which is precisely what the migration's ruling 2 says
 * it refuses.
 */
export interface RequirementGapList {
  key: string;
  label: string;
  tone: "blocking" | "attention" | "informational";
  rows: RequirementGapRow[];
  emptyNote: string;
}

export function requirementGapLists(
  trace: RequirementTraceability | null,
): RequirementGapList[] {
  if (!trace || trace.refused) return [];
  const g = trace.gaps ?? {};
  const lists: RequirementGapList[] = [
    {
      key: "verificationFailed",
      label: "Verified and FAILED",
      tone: "blocking",
      rows: g.verificationFailed ?? [],
      emptyNote:
        "No requirement on this case has been verified and found wanting.",
    },
    {
      key: "withoutVerificationMethod",
      label: "No verification method",
      tone: "blocking",
      rows: g.withoutVerificationMethod ?? [],
      emptyNote: "Every requirement states how it would be verified.",
    },
    {
      key: "awaitingVerification",
      label: "Open — no result recorded",
      tone: "attention",
      rows: g.awaitingVerification ?? [],
      emptyNote: "No requirement is still waiting on a first result.",
    },
    {
      key: "withoutObjective",
      label: "Traces to no objective",
      tone: "attention",
      rows: g.withoutObjective ?? [],
      emptyNote: "Every requirement traces to an objective.",
    },
    {
      key: "withoutOwner",
      label: "No accountable owner",
      tone: "attention",
      rows: g.withoutOwner ?? [],
      emptyNote: "Every requirement names an owner.",
    },
    {
      key: "withoutAcceptanceCriteria",
      label: "No acceptance criteria",
      tone: "attention",
      rows: g.withoutAcceptanceCriteria ?? [],
      emptyNote: "Every requirement states measurably what 'met' means.",
    },
    {
      key: "outsideSpec10Taxonomy",
      label: "Outside the §10 taxonomy",
      tone: "informational",
      rows: g.outsideSpec10Taxonomy ?? [],
      emptyNote:
        "Every requirement is categorised inside the eleven §10 categories.",
    },
  ];
  return lists;
}

/**
 * The model's semantic candidates, shaped as findings so they render in the
 * same list as the deterministic ones.
 *
 * They arrive from the edge function as raw pairs and were read NOWHERE — the
 * `source === "ai_suggestion"` badge, the "capped at attention" disclaimer and
 * `orderedFindings`' AI-below-facts sort were all unreachable, because the
 * only source of the rendered list was the SQL engine, which writes
 * `deterministic` on every row it produces. The label is written HERE, from a
 * literal, exactly as the RPC writes it from a SQL literal — a model never
 * labels its own output.
 */
export function aiFindingsAsFindings(
  ai: {
    requirement_ref: string;
    related_requirement_ref: string | null;
    concern: string;
  }[],
  resolve?: (ref: string) => number | undefined,
): RequirementFinding[] {
  return (ai ?? []).map((a) => ({
    family: "inconsistent",
    subFamily: "semantic_inconsistency",
    severity: "attention" as const,
    source: "ai_suggestion" as const,
    aiGenerated: true,
    requirementId: resolve?.(a.requirement_ref) ?? null,
    requirementRef: a.requirement_ref,
    relatedRequirementRef: a.related_requirement_ref,
    detail: a.concern,
  }));
}

/**
 * What the agent's model half did, stated even when it found nothing.
 *
 * A steered or unlucky model returning an empty array rendered as TOTAL
 * SILENCE: "asked and found nothing" was indistinguishable on screen from
 * "never asked". That is the "0 findings reads as healthy" failure this slice
 * refuses everywhere else, so it is refused here too.
 */
export function agentModelNote(res: {
  refused?: boolean;
  providerNote?: string | null;
  model?: string | null;
  aiFindings?: unknown[];
  aiDropped?: string[];
}): string | null {
  if (res.refused) return null;
  if (res.providerNote) return res.providerNote;
  if (!res.model) return null;
  const found = (res.aiFindings ?? []).length;
  const dropped = (res.aiDropped ?? []).length;
  const base =
    found === 0
      ? `${res.model} was asked whether any two requirement statements contradict each other and returned none. That is a model's reading, not a finding of no contradictions.`
      : `${res.model} proposed ${found} semantic contradiction(s), labelled AI-generated and capped at "attention" by the server.`;
  return dropped === 0
    ? base
    : `${base} ${dropped} candidate(s) were DROPPED rather than matched to the nearest requirement: ${res.aiDropped?.join(" ")}`;
}
