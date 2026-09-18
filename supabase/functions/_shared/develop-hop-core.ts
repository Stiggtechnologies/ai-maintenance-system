export const HOP_CATEGORIES = [
  "task_complexity",
  "conflicting_procedures",
  "excessive_handoffs",
  "decision_delays",
  "workarounds",
  "repeat_deviations",
  "overloaded_roles",
  "unclear_authority",
  "error_provoking_conditions",
] as const;

export type HopCategory = (typeof HOP_CATEGORIES)[number];

export interface HopAgentScreen {
  organizationId: string;
  asOf: string;
  lookbackDays: number;
  eventCount: number;
  eventLimit: number;
  eventsTruncated: boolean;
  unclassifiedEventCount: number;
  caseCount: number;
  caseLimit: number;
  casesTruncated: boolean;
  events: Array<{
    id: number;
    occurredAt: string;
    caseId: string | null;
    workOrderId: string | null;
    errorType: string;
    outcomeSeverity: string | null;
    categories: HopCategory[];
    conditions: string;
    correctiveAction: string | null;
    basis: string;
    evidenceRefs: string[];
  }>;
  decisionDelays: Array<{
    decisionId: string;
    caseId: string;
    caseTitle: string;
    requiredDate: string;
    sourceRef: string;
  }>;
  unclearAuthority: Array<{
    constraintId: string;
    eventId: string;
    eventCode: string;
    description: string;
    sourceRef: string;
  }>;
  workarounds: Array<{
    modificationId: number;
    assetId: string;
    kind: string;
    requiredRemovalBy: string;
    sourceRef: string;
  }>;
  repeatDeviations: Array<{
    assetId: string;
    activeCount: number;
    sourceRef: string;
  }>;
  overloadedRoles: Array<{
    caseId: string;
    caseTitle: string;
    overCommittedPools: number;
    sourceRef: string;
  }>;
  basis: string;
}

export interface HopFinding {
  id: string;
  category: HopCategory;
  headline: string;
  detail: string;
  sourceRefs: string[];
  humanAction: string;
  observedAt: string | null;
}

const label: Record<HopCategory, string> = {
  task_complexity: "Task complexity",
  conflicting_procedures: "Conflicting procedures",
  excessive_handoffs: "Excessive handoffs",
  decision_delays: "Decision delay",
  workarounds: "Workaround",
  repeat_deviations: "Repeated deviation",
  overloaded_roles: "Overloaded role or resource pool",
  unclear_authority: "Unclear authority",
  error_provoking_conditions: "Error-provoking condition",
};

export function analyzeHopScreen(screen: HopAgentScreen) {
  const findings: HopFinding[] = [];
  const counts = Object.fromEntries(
    HOP_CATEGORIES.map((key) => [key, 0]),
  ) as Record<HopCategory, number>;
  for (const event of screen.events) {
    for (const category of event.categories ?? []) {
      if (!HOP_CATEGORIES.includes(category)) continue;
      counts[category] += 1;
      findings.push({
        id: `observed:${event.id}:${category}`,
        category,
        headline: `${label[category]} was recorded as a system condition`,
        detail: event.conditions,
        sourceRefs: [
          `human_performance_events:${event.id}`,
          ...(event.evidenceRefs ?? []),
        ],
        observedAt: event.occurredAt,
        humanAction:
          event.correctiveAction ||
          "A qualified human should review the condition, its evidence and the work system before selecting an intervention.",
      });
    }
  }
  for (const row of screen.decisionDelays) {
    counts.decision_delays += 1;
    findings.push({
      id: `decision:${row.decisionId}`,
      category: "decision_delays",
      headline: "A required decision remains open past its recorded date",
      detail: `${row.caseTitle} has an open decision required by ${row.requiredDate}. No cause or individual fault is inferred.`,
      sourceRefs: [row.sourceRef, `development_cases:${row.caseId}`],
      observedAt: null,
      humanAction:
        "The accountable authority should clarify the decision path, evidence needed and escalation route.",
    });
  }
  for (const row of screen.unclearAuthority) {
    counts.unclear_authority += 1;
    findings.push({
      id: `authority:${row.constraintId}`,
      category: "unclear_authority",
      headline: "An active recovery constraint has no assigned owner role",
      detail: `${row.eventCode}: ${row.description}`,
      sourceRefs: [row.sourceRef, `restoration_events:${row.eventId}`],
      observedAt: null,
      humanAction:
        "A human recovery lead should assign a role and clarify the decision boundary.",
    });
  }
  for (const row of screen.workarounds) {
    counts.workarounds += 1;
    findings.push({
      id: `workaround:${row.modificationId}`,
      category: "workarounds",
      headline: "A recorded workaround remains active",
      detail: `Recorded ${row.kind.replaceAll("_", " ")} remains open until ${row.requiredRemovalBy}. This describes plant configuration, not worker behavior.`,
      sourceRefs: [row.sourceRef, `assets:${row.assetId}`],
      observedAt: null,
      humanAction:
        "The responsible human should confirm the risk basis, removal plan and whether the system is normalizing the workaround.",
    });
  }
  for (const row of screen.repeatDeviations) {
    counts.repeat_deviations += 1;
    findings.push({
      id: `repeat:${row.assetId}`,
      category: "repeat_deviations",
      headline: "Multiple active deviations affect one asset",
      detail: `${row.activeCount} active temporary modifications are recorded against the same asset. This is a recurrence signal, not a finding of individual conduct.`,
      sourceRefs: [row.sourceRef, `assets:${row.assetId}`],
      observedAt: null,
      humanAction:
        "A qualified human should examine common system causes and decide whether a permanent engineered correction is required.",
    });
  }
  for (const row of screen.overloadedRoles) {
    counts.overloaded_roles += 1;
    findings.push({
      id: `overload:${row.caseId}`,
      category: "overloaded_roles",
      headline: "Recorded demand exceeds one or more resource pools",
      detail: `${row.caseTitle} has ${row.overCommittedPools} over-committed resource pool(s) in the governed 12-week balance. No individual workload is exposed.`,
      sourceRefs: [row.sourceRef, `development_cases:${row.caseId}`],
      observedAt: null,
      humanAction:
        "A human planner should validate capacity evidence and rebalance scope, timing or resources.",
    });
  }
  return {
    headline: findings.length
      ? `${findings.length} system-condition signal${findings.length === 1 ? "" : "s"} require human review.`
      : "No system-condition signals were detected in the bounded records screened.",
    findings,
    categoryCounts: HOP_CATEGORIES.map((key) => ({
      key,
      label: label[key],
      count: counts[key],
    })),
    coverage: {
      lookbackDays: screen.lookbackDays,
      eventCount: screen.eventCount,
      eventLimit: screen.eventLimit,
      eventsTruncated: screen.eventsTruncated,
      unclassifiedEventCount: screen.unclassifiedEventCount,
      caseCount: screen.caseCount,
      caseLimit: screen.caseLimit,
      casesTruncated: screen.casesTruncated,
    },
    basis: screen.basis,
    limitations: [
      "This is system-condition analysis, not worker surveillance. It identifies, ranks and scores no person.",
      "Signals are advisory and cannot assign blame, approve an intervention, accept risk or alter a governed record.",
      "No signal means none was detected in the stated sources and bounded window; it is not proof that conditions are safe or effective.",
      "Excessive handoffs and conflicting procedures are reported only when a human records them; no unsupported threshold is invented.",
      ...(screen.unclassifiedEventCount > 0
        ? [
            `${screen.unclassifiedEventCount} legacy event(s) have no nine-category classification and are excluded from category counts.`,
          ]
        : []),
      ...(screen.eventsTruncated || screen.casesTruncated
        ? [
            "The screen reached a stated record limit, so the result is not complete for the organization.",
          ]
        : []),
    ],
  };
}
