import {
  isPassingOutcome,
  isTerminalOutcome,
  type CaseWorkspace,
  type GateReadinessResult,
  type OperationalReadinessResult,
} from "./index";
import {
  forecastConfidenceFingerprint,
  hasRunOutputs,
  performanceRunIsStale,
  type CasePerformance,
} from "./performance";

export interface PortfolioBenefitInput {
  id: string;
  label: string;
  unit: string;
  expected: number;
  currentForecast: number | null;
  actual: number | null;
  owner: string;
  expectedDate: string;
  forecastMetricId: string | null;
  actualMetricId: string | null;
}

export interface DevelopmentPortfolioRow {
  caseId: string;
  project: string;
  status: string;
  stage: string | null;
  nextGate: { id: number; name: string } | null;
  gateReadiness: {
    percent: number | null;
    blocked: boolean;
    blockers: number;
    sourceRefs: string[];
  } | null;
  costForecast: {
    currency: string | null;
    deterministic: number | null;
    p80: number | null;
    refusal: string | null;
    sourceRefs: string[];
  };
  scheduleForecast: {
    deterministicFinish: string | null;
    p80Finish: string | null;
    refusal: string | null;
    sourceRefs: string[];
  };
  risk: {
    openHighCritical: number;
    leading: Array<{ id: string; title: string; level: string }>;
    absenceNote: string | null;
    sourceRefs: string[];
  };
  operationalReadiness: {
    percent: number | null;
    hardBlockers: number;
    refusal: string | null;
    sourceRefs: string[];
  };
  benefits: PortfolioBenefitInput[];
  forecastCurrent: boolean;
}

export function findNextPortfolioGate(
  workspace: CaseWorkspace,
): { id: number; name: string } | null {
  const stages = [...workspace.stages].sort((a, b) => a.sequence - b.sequence);
  const currentIndex = stages.findIndex(
    (stage) => stage.isCurrent || stage.stageKey === workspace.currentStageKey,
  );
  const candidates = stages
    .slice(Math.max(0, currentIndex))
    .flatMap((stage) =>
      [...stage.gates].sort((a, b) => a.sequence - b.sequence),
    );

  // A terminal decision ends the case at that gate. Showing a later gate as
  // "next" would imply that work may advance past a human termination.
  if (
    ["completed", "cancelled", "terminated"].includes(workspace.status) ||
    stages.some((stage) =>
      stage.gates.some((gate) =>
        isTerminalOutcome(gate.latestReview?.outcome ?? null),
      ),
    )
  ) {
    return null;
  }

  const gate = candidates.find(
    (candidate) => !isPassingOutcome(candidate.latestReview?.outcome ?? null),
  );
  return gate ? { id: gate.id, name: gate.name } : null;
}

function numberFrom(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringFrom(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

/** Read-only presentation composition. No score, percentile, risk rank or benefit total is calculated here. */
export function buildDevelopmentPortfolioRow(input: {
  workspace: CaseWorkspace;
  nextGate: { id: number; name: string } | null;
  gateReadiness: GateReadinessResult | null;
  performance: CasePerformance;
  operationalReadiness: OperationalReadinessResult;
  benefits: PortfolioBenefitInput[];
}): DevelopmentPortfolioRow {
  const { workspace, performance } = input;
  const forecast = performance.forecastConfidence;
  const run = performance.latestCalculations.case_forecast_confidence;
  const forecastCurrent =
    hasRunOutputs(run) &&
    !performanceRunIsStale(run, forecastConfidenceFingerprint(forecast));
  const outputs = forecastCurrent ? run.outputs : null;
  const forecastRefs = [
    ...(run?.id ? [`calculation_runs:${run.id}`] : []),
    ...(forecast.simulation.id
      ? [`schedule_simulation_runs:${forecast.simulation.id}`]
      : []),
  ];
  const forecastRefusal = !hasRunOutputs(run)
    ? (run?.refusals[0] ?? "No forecast calculation has been recorded.")
    : !forecastCurrent
      ? "The recorded forecast inputs have moved; its figures are withheld until recomputed."
      : null;
  const leading = workspace.risks
    .filter(
      (risk) =>
        ["High", "Critical"].includes(risk.currentRiskLevel ?? "") &&
        !["closed", "archived", "accepted"].includes(risk.status),
    )
    .map((risk) => ({
      id: risk.id,
      title: risk.title,
      level: risk.currentRiskLevel!,
    }));

  return {
    caseId: workspace.id,
    project: workspace.title,
    status: workspace.status,
    stage:
      workspace.stages.find(
        (stage) =>
          stage.isCurrent || stage.stageKey === workspace.currentStageKey,
      )?.displayName ?? workspace.currentStageKey,
    nextGate: input.nextGate,
    gateReadiness: input.gateReadiness
      ? {
          percent: input.gateReadiness.readinessPct,
          blocked: input.gateReadiness.blocked,
          blockers: input.gateReadiness.blockers.length,
          sourceRefs: [
            `stage_gates:${input.gateReadiness.gateId}`,
            ...input.gateReadiness.blockers.map(
              (blocker) => `${blocker.type}:${blocker.id}`,
            ),
          ],
        }
      : null,
    costForecast: {
      currency: outputs ? stringFrom(outputs.currency) : null,
      deterministic: outputs ? numberFrom(outputs.costDeterministic) : null,
      p80: outputs ? numberFrom(outputs.costP80) : null,
      refusal:
        forecastRefusal ??
        (outputs && numberFrom(outputs.costP80) == null
          ? forecast.cost.percentileRefusal
          : null),
      sourceRefs: forecastRefs,
    },
    scheduleForecast: {
      deterministicFinish: outputs
        ? stringFrom(outputs.scheduleDeterministicFinish)
        : null,
      p80Finish: outputs ? stringFrom(outputs.scheduleP80Finish) : null,
      refusal:
        forecastRefusal ??
        (outputs && stringFrom(outputs.scheduleP80Finish) == null
          ? forecast.schedule.percentileRefusal
          : null),
      sourceRefs: forecastRefs,
    },
    risk: {
      openHighCritical: leading.length,
      leading,
      absenceNote:
        leading.length === 0
          ? "No open High/Critical case risk was returned. This is not proof that project risk is absent."
          : null,
      sourceRefs: leading.map((risk) => `risk_register:${risk.id}`),
    },
    operationalReadiness: {
      percent: input.operationalReadiness.overall?.pct ?? null,
      hardBlockers:
        input.operationalReadiness.overall?.hardBlockerCount ??
        input.operationalReadiness.hardBlockers.length,
      refusal: input.operationalReadiness.overall
        ? null
        : (input.operationalReadiness.note ??
          "Operational readiness has not been assessed."),
      sourceRefs: [
        `development_cases:${workspace.id}`,
        ...input.operationalReadiness.assets.map(
          (asset) => `assets:${asset.assetId}`,
        ),
      ],
    },
    benefits: input.benefits,
    forecastCurrent,
  };
}
