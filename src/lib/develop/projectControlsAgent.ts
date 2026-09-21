import type { CasePerformance } from "./performance";
import type { ScopeCreepCaseResult } from "./scopeCreepDetection";

export type ControlsFindingPosture = "intervene" | "attention" | "evidence_gap";

export interface ProjectControlsFinding {
  code:
    | "progress_low"
    | "progress_medium"
    | "progress_unrated"
    | "cost_trend_deteriorating"
    | "schedule_trend_deteriorating"
    | "trend_gap"
    | "scope_movement"
    | "scope_evidence_gap";
  posture: ControlsFindingPosture;
  title: string;
  detail: string;
  sourceRefs: string[];
}

export interface ProjectControlsAgentCase {
  caseId: string;
  caseTitle: string;
  status: string;
  findings: ProjectControlsFinding[];
  posture: ControlsFindingPosture;
}

export interface ProjectControlsAgentResult {
  cases: ProjectControlsAgentCase[];
  reviewedCaseCount: number;
  findingCount: number;
  method: string;
  limitations: string[];
  decisionBoundary: string;
}

const POSTURE_ORDER: Record<ControlsFindingPosture, number> = {
  intervene: 0,
  attention: 1,
  evidence_gap: 2,
};

function postureFor(findings: ProjectControlsFinding[]): ControlsFindingPosture {
  if (findings.some((finding) => finding.posture === "intervene")) return "intervene";
  if (findings.some((finding) => finding.posture === "attention")) return "attention";
  return "evidence_gap";
}

export function analyzeProjectControls(input: {
  caseId: string;
  caseTitle: string;
  status: string;
  performance: CasePerformance;
  scopeCreep?: ScopeCreepCaseResult;
}): ProjectControlsAgentCase | null {
  const findings: ProjectControlsFinding[] = [];
  const period = input.performance.progressIntegrity.period;
  const periodRef = period?.periodRef ?? "the current reporting position";

  for (const element of input.performance.progressIntegrity.elements) {
    const refs = [
      `development_cases:${input.caseId}`,
      ...(period?.id ? [`project_progress_periods:${period.id}`] : []),
      `project_wbs_elements:${element.wbsCode}`,
    ];
    if (element.confidence === "low") {
      findings.push({
        code: "progress_low",
        posture: "intervene",
        title: "Claimed progress materially conflicts with independent evidence",
        detail:
          element.discrepancy ??
          `${element.wbsCode} carries low progress confidence in ${periodRef}.`,
        sourceRefs: refs,
      });
    } else if (element.confidence === "medium") {
      findings.push({
        code: "progress_medium",
        posture: "attention",
        title: "Claimed progress needs reconciliation",
        detail:
          element.discrepancy ??
          `${element.wbsCode} carries medium progress confidence in ${periodRef}.`,
        sourceRefs: refs,
      });
    } else if (element.confidence == null) {
      findings.push({
        code: "progress_unrated",
        posture: "evidence_gap",
        title: "Claimed progress has no independent cross-check",
        detail:
          element.refusal ??
          `${element.wbsCode} is claimed but no independent observation is recorded.`,
        sourceRefs: refs,
      });
    }
  }

  const trend = input.performance.trend;
  const trendRun = input.performance.latestCalculations.case_performance_trend;
  const trendRefs = [
    ...(trendRun?.id ? [`calculation_runs:${trendRun.id}`] : []),
    ...trend.points.map((point) => `calculation_runs:${point.runId}`),
  ];
  if (trend.costTrend === "deteriorating") {
    findings.push({
      code: "cost_trend_deteriorating",
      posture: "attention",
      title: "Recorded cost-performance trend is deteriorating",
      detail: trend.costTrendInterval
        ? `The recorded cost trend deteriorated across ${trend.costTrendInterval}.`
        : "The canonical trend read reports deteriorating cost performance.",
      sourceRefs: trendRefs,
    });
  }
  if (trend.scheduleTrend === "deteriorating") {
    findings.push({
      code: "schedule_trend_deteriorating",
      posture: "attention",
      title: "Recorded schedule-performance trend is deteriorating",
      detail: trend.scheduleTrendInterval
        ? `The recorded schedule trend deteriorated across ${trend.scheduleTrendInterval}.`
        : "The canonical trend read reports deteriorating schedule performance.",
      sourceRefs: trendRefs,
    });
  }
  for (const gap of trend.gaps) {
    findings.push({
      code: "trend_gap",
      posture: "evidence_gap",
      title: "Performance trend has a reporting gap",
      detail: `${gap.periodRef}: ${gap.reason}`,
      sourceRefs: [`development_cases:${input.caseId}`],
    });
  }

  for (const flag of input.scopeCreep?.flags ?? []) {
    findings.push({
      code:
        flag.classification === "potential_scope_creep"
          ? "scope_movement"
          : "scope_evidence_gap",
      posture:
        flag.classification === "potential_scope_creep"
          ? "attention"
          : "evidence_gap",
      title: flag.title,
      detail: flag.detail,
      sourceRefs: flag.sourceRefs,
    });
  }

  if (findings.length === 0) return null;
  findings.sort(
    (left, right) =>
      POSTURE_ORDER[left.posture] - POSTURE_ORDER[right.posture] ||
      left.title.localeCompare(right.title),
  );
  return {
    caseId: input.caseId,
    caseTitle: input.caseTitle,
    status: input.status,
    findings,
    posture: postureFor(findings),
  };
}

export function buildProjectControlsAgent(
  cases: Array<{
    caseId: string;
    caseTitle: string;
    status: string;
    performance: CasePerformance;
    scopeCreep?: ScopeCreepCaseResult;
  }>,
): ProjectControlsAgentResult {
  const results = cases
    .map((item) => analyzeProjectControls(item))
    .filter((item): item is ProjectControlsAgentCase => item !== null)
    .sort(
      (left, right) =>
        POSTURE_ORDER[left.posture] - POSTURE_ORDER[right.posture] ||
        left.caseTitle.localeCompare(right.caseTitle),
    );
  return {
    cases: results,
    reviewedCaseCount: cases.length,
    findingCount: results.reduce((total, item) => total + item.findings.length, 0),
    method:
      "Deterministic composition of canonical progress-integrity, recorded performance-trend and scope-movement evidence. It does not reinterpret claimed progress, recalculate trends or blend findings into a score.",
    limitations: [
      "Findings identify recorded disagreement, deterioration or missing evidence; they do not diagnose cause.",
      "A project absent from this list is not proven on plan because unrecorded conditions remain invisible.",
      "Trend gaps and unrated claims are unknowns, not favorable performance.",
    ],
    decisionBoundary:
      "The Project Controls Agent is advisory. A named human investigates, corrects records and authorizes any baseline, funding, gate, risk or work decision through existing controls.",
  };
}
