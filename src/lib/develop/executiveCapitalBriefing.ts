import type { CaseWorkspace, SinceSanctionDelta } from "./index";
import {
  forecastConfidenceFingerprint,
  hasRunOutputs,
  performanceRunIsStale,
  type CasePerformance,
} from "./performance";

export interface ExecutiveCapitalBriefingModel {
  caseId: string;
  caseTitle: string;
  position: "human_review_required" | "evidence_incomplete";
  headline: string;
  cost: {
    currency: string | null;
    sanctioned: number | null;
    deterministicForecast: number | null;
    p80Forecast: number | null;
    comparison: string | null;
    refusal: string | null;
  };
  schedule: {
    deterministicFinish: string | null;
    p80Finish: string | null;
    refusal: string | null;
  };
  value: {
    available: boolean;
    atSanction: number | null;
    current: number | null;
    delta: number | null;
    refusal: string | null;
    sourceRefs: string[];
  };
  benefits: Array<{
    id: string;
    label: string;
    unit: string;
    expected: number;
    forecast: number | null;
    actual: number | null;
    owner: string;
    expectedDate: string;
    basis: string;
    sourceRefs: string[];
  }>;
  majorDrivers: Array<{
    id: string;
    label: string;
    level: string | null;
    p80DaysContribution: number | null;
    reason: string;
    sourceRefs: string[];
  }>;
  forecastCurrent: boolean;
  forecastRunId: string | null;
  forecastSourceRefs: string[];
  limitations: string[];
  decisionBoundary: string;
}

export interface ExecutiveBenefitsInput {
  benefits: Array<{
    id: string;
    label: string;
    unit: string;
    expected: number;
    expectedDate: string;
    owner: string;
    basis: string;
    currentForecast: number | null;
    forecastMetricId: string | null;
    actual: number | null;
    actualMetricId: string | null;
  }>;
}

function numberFrom(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringFrom(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/**
 * Presentation-only composition over canonical tenant-scoped reads. It never
 * computes a project verdict, a percentile, a benefit total or a risk score.
 * Forecast figures come only from the recorded calculation run, and a stale
 * run is rendered as absent rather than allowed to become an executive fact.
 */
export function buildExecutiveCapitalBriefing(
  workspace: CaseWorkspace,
  performance: CasePerformance,
  sinceSanction: SinceSanctionDelta,
  benefits: ExecutiveBenefitsInput,
): ExecutiveCapitalBriefingModel {
  const forecast = performance.forecastConfidence;
  const run = performance.latestCalculations.case_forecast_confidence;
  const forecastCurrent =
    hasRunOutputs(run) &&
    !performanceRunIsStale(run, forecastConfidenceFingerprint(forecast));
  const outputs = forecastCurrent ? run.outputs : null;
  const currency = outputs ? stringFrom(outputs.currency) : null;

  const limitations: string[] = [];
  if (workspace.sanction == null) {
    limitations.push(
      "No human sanction record exists, so there is no approved capital anchor to compare with the forecast.",
    );
  }
  if (!hasRunOutputs(run)) {
    limitations.push(
      run?.refusals[0] ??
        "No forecast calculation has been computed and recorded for this case.",
    );
  } else if (!forecastCurrent) {
    limitations.push(
      "The recorded forecast inputs have moved. Its figures are withheld until a human recomputes and records the forecast.",
    );
  }
  if (benefits.benefits.length === 0) {
    limitations.push("No canonical case benefits are recorded.");
  }

  const expectedValue = sinceSanction.dimensions?.find(
    (row) => row.dimension === "expected_value",
  );
  const valueRefs = [
    sinceSanction.sanctionBaseline?.evaluationId,
    sinceSanction.current?.evaluationId,
  ]
    .filter((id): id is string => Boolean(id))
    .map((id) => `lifecycle_evaluations:${id}`);

  const attributedDrivers =
    forecastCurrent && forecast.simulation.current
      ? (forecast.schedule.criticalDrivers ?? [])
          .filter(
            (
              driver,
            ): driver is typeof driver & {
              riskId: string;
              riskTitle: string;
              p80DaysContribution: number;
              reason: string;
            } =>
              "riskId" in driver &&
              "riskTitle" in driver &&
              "p80DaysContribution" in driver &&
              "reason" in driver,
          )
          .map((driver) => ({
            id: driver.riskId,
            label: driver.riskTitle,
            level: null,
            p80DaysContribution: driver.p80DaysContribution,
            reason: driver.reason,
            sourceRefs: [
              `risks:${driver.riskId}`,
              ...(forecast.simulation.id
                ? [`schedule_simulation_runs:${forecast.simulation.id}`]
                : []),
            ],
          }))
      : [];

  const recordedRiskDrivers = workspace.risks
    .filter(
      (risk) =>
        ["High", "Critical"].includes(risk.currentRiskLevel ?? "") &&
        !["closed", "archived", "accepted"].includes(risk.status),
    )
    .map((risk) => ({
      id: risk.id,
      label: risk.title,
      level: risk.currentRiskLevel,
      p80DaysContribution: null,
      reason:
        "Open case risk. No current recorded simulation attribution is being claimed for this row.",
      sourceRefs: [`risks:${risk.id}`],
    }));

  const attributedRiskIds = new Set(attributedDrivers.map((row) => row.id));
  const majorDrivers = [
    ...attributedDrivers,
    ...recordedRiskDrivers.filter((row) => !attributedRiskIds.has(row.id)),
  ];
  if (majorDrivers.length === 0) {
    limitations.push(
      "No current attributed schedule driver or open High/Critical case risk is available. This is not proof that project risk is absent.",
    );
  }
  if (!sinceSanction.available || expectedValue == null) {
    limitations.push(
      sinceSanction.reason ??
        "The case expected-value change since sanction is not comparable from the recorded evaluations.",
    );
  }

  const evidenceIncomplete =
    workspace.sanction == null ||
    !forecastCurrent ||
    benefits.benefits.length === 0;

  return {
    caseId: workspace.id,
    caseTitle: workspace.title,
    position: evidenceIncomplete
      ? "evidence_incomplete"
      : "human_review_required",
    headline: evidenceIncomplete
      ? "The next-dollar decision is not evidence-complete."
      : "The evidence is assembled for a human next-dollar review.",
    cost: {
      currency,
      sanctioned: workspace.sanction?.sanctionedValue ?? null,
      deterministicForecast: outputs
        ? numberFrom(outputs.costDeterministic)
        : null,
      p80Forecast: outputs ? numberFrom(outputs.costP80) : null,
      comparison: forecastCurrent ? forecast.againstSanction : null,
      refusal: forecastCurrent
        ? forecast.cost.percentileRefusal
        : (limitations.find((line) => /forecast/i.test(line)) ?? null),
    },
    schedule: {
      deterministicFinish: outputs
        ? stringFrom(outputs.scheduleDeterministicFinish)
        : null,
      p80Finish: outputs ? stringFrom(outputs.scheduleP80Finish) : null,
      refusal: forecastCurrent
        ? forecast.schedule.percentileRefusal
        : (limitations.find((line) => /forecast/i.test(line)) ?? null),
    },
    value: {
      available: Boolean(sinceSanction.available && expectedValue),
      atSanction: expectedValue?.atSanction ?? null,
      current: expectedValue?.current ?? null,
      delta: expectedValue?.delta ?? null,
      refusal:
        sinceSanction.available && expectedValue
          ? null
          : (sinceSanction.reason ??
            "The expected-value change since sanction is not comparable."),
      sourceRefs: valueRefs,
    },
    benefits: benefits.benefits.map((benefit) => ({
      id: benefit.id,
      label: benefit.label,
      unit: benefit.unit,
      expected: benefit.expected,
      forecast: benefit.currentForecast,
      actual: benefit.actual,
      owner: benefit.owner,
      expectedDate: benefit.expectedDate,
      basis: benefit.basis,
      sourceRefs: [
        `value_metrics:${benefit.id}`,
        ...(benefit.forecastMetricId
          ? [`value_metrics:${benefit.forecastMetricId}`]
          : []),
        ...(benefit.actualMetricId
          ? [`value_metrics:${benefit.actualMetricId}`]
          : []),
      ],
    })),
    majorDrivers,
    forecastCurrent,
    forecastRunId: run?.id ?? null,
    forecastSourceRefs: [
      ...(run?.id ? [`calculation_runs:${run.id}`] : []),
      ...(forecast.simulation.id
        ? [`schedule_simulation_runs:${forecast.simulation.id}`]
        : []),
    ],
    limitations,
    decisionBoundary:
      "This briefing assembles recorded evidence. It does not approve, continue, pause, defer or cancel capital. A named human with delegated authority owns that decision.",
  };
}
