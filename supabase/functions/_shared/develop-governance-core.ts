export interface GovernanceAgentScreen {
  organizationId: string;
  asOf: string;
  lookbackDays: number;
  caseCount: number;
  caseLimit: number;
  casesTruncated: boolean;
  cases: Array<{
    caseId: string;
    caseTitle: string;
    currentStageKey: string;
    demands: {
      waiver_reverted?: string[];
      non_independent_gates?: string[];
      criteria_unmet?: string[];
      unlinked_mandatory?: string[];
      composite_unmet?: string[];
    };
  }>;
  instruments: Array<{
    id: string;
    subjectType: "standard" | "gate_requirement";
    caseId: string | null;
    status: string;
    requestedAt: string;
    expiresAt: string;
    subjectLabel: string;
  }>;
  blockedAttemptCount: number;
  blockedAttemptsTruncated: boolean;
  blockedAttempts: Array<{
    id: string;
    severity: "info" | "notice" | "warning" | "critical";
    detail: string | null;
    actorLabel: string | null;
    createdAt: string;
  }>;
  basis: string;
}

export type GovernanceFindingKind =
  | "expired_waiver_reliance"
  | "separation_of_duty"
  | "unapproved_deviation"
  | "policy_requirement_gap"
  | "evidence_policy_gap"
  | "composite_authority_gap"
  | "blocked_control_attempt"
  | "expired_instrument";

export interface GovernanceFinding {
  id: string;
  kind: GovernanceFindingKind;
  severity: "notice" | "warning" | "critical";
  headline: string;
  detail: string;
  caseId: string | null;
  caseTitle: string | null;
  occurredAt: string | null;
  sourceRefs: string[];
  humanAction: string;
}

const values = (value?: string[]): string[] =>
  Array.isArray(value) ? value.filter(Boolean) : [];

export function analyzeGovernanceScreen(screen: GovernanceAgentScreen) {
  const findings: GovernanceFinding[] = [];
  for (const item of screen.cases) {
    const ref = `development_cases:${item.caseId}`;
    for (const detail of values(item.demands.waiver_reverted)) {
      findings.push({
        id: `waiver-reverted:${item.caseId}:${detail}`,
        kind: "expired_waiver_reliance",
        severity: "critical",
        headline: "A recorded gate pass relies on a waiver that has expired",
        detail,
        caseId: item.caseId,
        caseTitle: item.caseTitle,
        occurredAt: null,
        sourceRefs: [ref, "rpc:case_binding_gate_demands"],
        humanAction:
          "Re-satisfy the requirement and re-record the gate, or obtain a newly authorized waiver.",
      });
    }
    for (const detail of values(item.demands.non_independent_gates)) {
      findings.push({
        id: `sod:${item.caseId}:${detail}`,
        kind: "separation_of_duty",
        severity: "critical",
        headline: "A passing gate does not meet its independence requirement",
        detail,
        caseId: item.caseId,
        caseTitle: item.caseTitle,
        occurredAt: null,
        sourceRefs: [ref, "rpc:case_binding_gate_demands"],
        humanAction:
          "Have an eligible independent reviewer record the gate determination.",
      });
    }
    for (const detail of values(item.demands.criteria_unmet)) {
      findings.push({
        id: `criterion:${item.caseId}:${detail}`,
        kind: "policy_requirement_gap",
        severity: "warning",
        headline: "A passing gate does not answer a mandatory requirement",
        detail,
        caseId: item.caseId,
        caseTitle: item.caseTitle,
        occurredAt: null,
        sourceRefs: [ref, "rpc:case_binding_gate_demands"],
        humanAction:
          "Provide accepted evidence and re-record the gate, or request a governed waiver.",
      });
    }
    for (const detail of values(item.demands.unlinked_mandatory)) {
      findings.push({
        id: `evidence:${item.caseId}:${detail}`,
        kind: "evidence_policy_gap",
        severity: "warning",
        headline:
          "A mandatory requirement lacks an accepted evidence deliverable",
        detail,
        caseId: item.caseId,
        caseTitle: item.caseTitle,
        occurredAt: null,
        sourceRefs: [ref, "rpc:case_binding_gate_demands"],
        humanAction:
          "Link and accept the required evidence through the governed deliverable workflow.",
      });
    }
    for (const detail of values(item.demands.composite_unmet)) {
      findings.push({
        id: `authority:${item.caseId}:${detail}`,
        kind: "composite_authority_gap",
        severity: "critical",
        headline: "A composite governance rule is not satisfied",
        detail,
        caseId: item.caseId,
        caseTitle: item.caseTitle,
        occurredAt: null,
        sourceRefs: [ref, "rpc:case_binding_gate_demands"],
        humanAction:
          "Complete the named independent assurance or route the matter to the stated authority.",
      });
    }
  }

  for (const row of screen.instruments) {
    const sourceRef = `standard_site_variances:${row.id}`;
    if (row.status === "pending") {
      findings.push({
        id: `pending:${row.id}`,
        kind: "unapproved_deviation",
        severity: "notice",
        headline: "A requested deviation remains unapproved",
        detail: `${row.subjectLabel}. The request grants no authority while pending.`,
        caseId: row.caseId,
        caseTitle: null,
        occurredAt: row.requestedAt,
        sourceRefs: [sourceRef],
        humanAction:
          "An authorized human must approve or reject the request through the existing variance workflow.",
      });
    } else {
      findings.push({
        id: `expired:${row.id}`,
        kind: "expired_instrument",
        severity: "notice",
        headline: "A governance instrument has expired",
        detail: `${row.subjectLabel}. Expiry restores the underlying requirement automatically.`,
        caseId: row.caseId,
        caseTitle: null,
        occurredAt: row.expiresAt,
        sourceRefs: [sourceRef],
        humanAction:
          "Confirm no active decision still depends on this instrument; renew only through a new authorized decision.",
      });
    }
  }

  for (const event of screen.blockedAttempts) {
    findings.push({
      id: `blocked:${event.id}`,
      kind: "blocked_control_attempt",
      severity: event.severity === "critical" ? "critical" : "warning",
      headline: "A governance control blocked an attempted action",
      detail: event.detail ?? "The security log contains no further detail.",
      caseId: null,
      caseTitle: null,
      occurredAt: event.createdAt,
      sourceRefs: [`security_events:${event.id}`],
      humanAction:
        "An administrator should review the source event and determine whether escalation or remediation is required.",
    });
  }

  const order = { critical: 0, warning: 1, notice: 2 } as const;
  findings.sort(
    (a, b) => order[a.severity] - order[b.severity] || a.id.localeCompare(b.id),
  );
  return {
    verdict: findings.some((row) => row.severity === "critical")
      ? "critical_findings_detected"
      : findings.length
        ? "findings_detected"
        : "no_findings_detected",
    headline: findings.length
      ? `${findings.length} governance finding${findings.length === 1 ? "" : "s"} require human review.`
      : "No governance findings were detected in the bounded records screened.",
    findings,
    counts: {
      critical: findings.filter((row) => row.severity === "critical").length,
      warning: findings.filter((row) => row.severity === "warning").length,
      notice: findings.filter((row) => row.severity === "notice").length,
    },
    coverage: {
      caseCount: screen.caseCount,
      caseLimit: screen.caseLimit,
      casesTruncated: screen.casesTruncated,
      lookbackDays: screen.lookbackDays,
      blockedAttemptCount: screen.blockedAttemptCount,
      blockedAttemptsTruncated: screen.blockedAttemptsTruncated,
    },
    basis: screen.basis,
    limitations: [
      "Detection is advisory. The agent cannot approve, reject, waive, accept risk, pass a gate or alter any governed record.",
      "No finding means none was detected in the stated bounded records; it is not proof that no governance issue exists.",
      ...(screen.casesTruncated
        ? [
            "The case screen reached its stated limit; increase or narrow the governed review before relying on completeness.",
          ]
        : []),
      ...(screen.blockedAttemptsTruncated
        ? [
            "The blocked-attempt screen reached its 200-event limit for the selected window.",
          ]
        : []),
    ],
  };
}
