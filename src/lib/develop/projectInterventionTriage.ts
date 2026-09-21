import type { DevelopmentPortfolioRow } from "./developmentPortfolio";

export type InterventionPosture = "intervene" | "attention" | "evidence_gap";

export interface InterventionReason {
  code:
    | "critical_risk"
    | "gate_blocked"
    | "operational_blocker"
    | "high_risk"
    | "benefit_erosion"
    | "forecast_unavailable"
    | "gate_unassessed"
    | "operations_unassessed"
    | "benefits_unestablished";
  posture: InterventionPosture;
  title: string;
  detail: string;
  sourceRefs: string[];
}

export interface ProjectInterventionItem {
  caseId: string;
  project: string;
  stage: string | null;
  posture: InterventionPosture;
  reasons: InterventionReason[];
  sourceRefs: string[];
}

export interface ProjectInterventionTriage {
  generatedAt: string;
  items: ProjectInterventionItem[];
  reviewedCaseCount: number;
  interventionCount: number;
  attentionCount: number;
  evidenceGapCount: number;
  method: string;
  limitations: string[];
  decisionBoundary: string;
}

const POSTURE_ORDER: Record<InterventionPosture, number> = {
  intervene: 0,
  attention: 1,
  evidence_gap: 2,
};

const REASON_ORDER: Record<InterventionReason["code"], number> = {
  critical_risk: 0,
  gate_blocked: 1,
  operational_blocker: 2,
  high_risk: 3,
  benefit_erosion: 4,
  forecast_unavailable: 5,
  gate_unassessed: 6,
  operations_unassessed: 7,
  benefits_unestablished: 8,
};

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function reasonsFor(row: DevelopmentPortfolioRow): InterventionReason[] {
  const reasons: InterventionReason[] = [];
  const critical = row.risk.leading.filter((risk) => risk.level === "Critical");
  const high = row.risk.leading.filter((risk) => risk.level === "High");

  for (const risk of critical) {
    reasons.push({
      code: "critical_risk",
      posture: "intervene",
      title: "Open Critical project risk",
      detail: risk.title,
      sourceRefs: [`risk_register:${risk.id}`],
    });
  }
  if (row.gateReadiness?.blocked) {
    reasons.push({
      code: "gate_blocked",
      posture: "intervene",
      title: "Next gate is blocked",
      detail: `${row.nextGate?.name ?? "The next gate"} has ${row.gateReadiness.blockers} recorded blocker(s).`,
      sourceRefs: row.gateReadiness.sourceRefs,
    });
  }
  if (row.operationalReadiness.hardBlockers > 0) {
    reasons.push({
      code: "operational_blocker",
      posture: "intervene",
      title: "Operational-readiness hard blockers",
      detail: `${row.operationalReadiness.hardBlockers} hard blocker(s) are recorded.`,
      sourceRefs: row.operationalReadiness.sourceRefs,
    });
  }
  for (const risk of high) {
    reasons.push({
      code: "high_risk",
      posture: "attention",
      title: "Open High project risk",
      detail: risk.title,
      sourceRefs: [`risk_register:${risk.id}`],
    });
  }
  for (const benefit of row.benefits) {
    if (
      benefit.currentForecast != null &&
      Number.isFinite(benefit.currentForecast) &&
      benefit.currentForecast < benefit.expected
    ) {
      reasons.push({
        code: "benefit_erosion",
        posture: "attention",
        title: "Benefit forecast below expectation",
        detail: `${benefit.label}: forecast ${benefit.currentForecast} ${benefit.unit}; expected ${benefit.expected} ${benefit.unit}.`,
        sourceRefs: [
          `value_metrics:${benefit.id}`,
          ...(benefit.forecastMetricId
            ? [`value_metrics:${benefit.forecastMetricId}`]
            : []),
        ],
      });
    }
  }
  const forecastRefusals = unique(
    [row.costForecast.refusal, row.scheduleForecast.refusal].filter(
      (value): value is string => Boolean(value),
    ),
  );
  if (forecastRefusals.length > 0) {
    reasons.push({
      code: "forecast_unavailable",
      posture: "evidence_gap",
      title: "Current project forecast is not defensible",
      detail: forecastRefusals.join(" "),
      sourceRefs: unique([
        ...row.costForecast.sourceRefs,
        ...row.scheduleForecast.sourceRefs,
      ]),
    });
  }
  if (row.nextGate && !row.gateReadiness) {
    reasons.push({
      code: "gate_unassessed",
      posture: "evidence_gap",
      title: "Next-gate readiness is not assessed",
      detail: `${row.nextGate.name} has no current readiness result.`,
      sourceRefs: [`stage_gates:${row.nextGate.id}`],
    });
  }
  if (row.operationalReadiness.percent == null) {
    reasons.push({
      code: "operations_unassessed",
      posture: "evidence_gap",
      title: "Operational readiness is not assessed",
      detail:
        row.operationalReadiness.refusal ??
        "No current operational-readiness result is available.",
      sourceRefs: row.operationalReadiness.sourceRefs,
    });
  }
  if (row.benefits.length === 0) {
    reasons.push({
      code: "benefits_unestablished",
      posture: "evidence_gap",
      title: "Benefit commitments are not established",
      detail: "No canonical case benefit commitment was returned.",
      sourceRefs: [`development_cases:${row.caseId}`],
    });
  }

  return reasons.sort(
    (left, right) => REASON_ORDER[left.code] - REASON_ORDER[right.code],
  );
}

function postureFor(reasons: InterventionReason[]): InterventionPosture {
  if (reasons.some((reason) => reason.posture === "intervene")) {
    return "intervene";
  }
  if (reasons.some((reason) => reason.posture === "attention")) {
    return "attention";
  }
  return "evidence_gap";
}

/**
 * Read-only, deterministic triage over the canonical portfolio composition.
 * It deliberately does not blend unlike measures into a score or infer that
 * a project absent from the list is healthy.
 */
export function buildProjectInterventionTriage(
  rows: DevelopmentPortfolioRow[],
  generatedAt = new Date().toISOString(),
): ProjectInterventionTriage {
  const items = rows
    .map((row): ProjectInterventionItem | null => {
      const reasons = reasonsFor(row);
      if (reasons.length === 0) return null;
      return {
        caseId: row.caseId,
        project: row.project,
        stage: row.stage,
        posture: postureFor(reasons),
        reasons,
        sourceRefs: unique(reasons.flatMap((reason) => reason.sourceRefs)),
      };
    })
    .filter((item): item is ProjectInterventionItem => item !== null)
    .sort((left, right) => {
      const posture = POSTURE_ORDER[left.posture] - POSTURE_ORDER[right.posture];
      if (posture !== 0) return posture;
      const leftReason = REASON_ORDER[left.reasons[0].code];
      const rightReason = REASON_ORDER[right.reasons[0].code];
      return leftReason - rightReason || left.project.localeCompare(right.project);
    });

  return {
    generatedAt,
    items,
    reviewedCaseCount: rows.length,
    interventionCount: items.filter((item) => item.posture === "intervene").length,
    attentionCount: items.filter((item) => item.posture === "attention").length,
    evidenceGapCount: items.filter((item) => item.posture === "evidence_gap").length,
    method:
      "Deterministic precedence: Critical risk, blocked gate and operational hard blockers first; then High risk and benefit erosion; then missing or stale evidence. No blended score is calculated.",
    limitations: [
      "The list reflects current returned records, not a claim that unlisted risk or delay is absent.",
      "Evidence gaps are not adverse findings and adverse findings are not approvals to intervene.",
      "Cost and schedule uncertainty ranges are shown in the portfolio but are not treated as overruns without an approved comparison baseline.",
    ],
    decisionBoundary:
      "This triage is advisory. A named human must investigate, choose an intervention and use the existing approval, funding, gate, risk and work-authority controls.",
  };
}
