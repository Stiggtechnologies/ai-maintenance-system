import { describe, expect, it } from "vitest";
import type {
  CaseWorkspace,
  GateReadinessResult,
  OperationalReadinessResult,
} from "./index";
import {
  forecastConfidenceFingerprint,
  type CasePerformance,
} from "./performance";
import {
  buildDevelopmentPortfolioRow,
  findNextPortfolioGate,
} from "./developmentPortfolio";

function workspace(over: Partial<CaseWorkspace> = {}): CaseWorkspace {
  return {
    id: "case-1",
    title: "North plant expansion",
    status: "active",
    currentStageKey: "concept",
    stages: [
      {
        stageKey: "concept",
        displayName: "Concept select",
        sequence: 1,
        purpose: null,
        isCurrent: true,
        gates: [
          {
            id: 11,
            name: "Concept gate",
            sequence: 1,
            latestReview: {
              id: 21,
              outcome: "proceed",
              reviewedAt: "2026-01-01",
            },
          },
          { id: 12, name: "Sanction gate", sequence: 2, latestReview: null },
        ],
      },
    ],
    risks: [],
    ...over,
  } as CaseWorkspace;
}

function performance(): CasePerformance {
  const forecastConfidence = {
    cost: {
      costLineCount: 2,
      recordedForecastLineCount: 2,
      percentileRefusal: "No cost distribution",
    },
    schedule: {
      activityCount: 4,
      activitiesWithDurationRange: 4,
      percentileRefusal: "No schedule distribution",
    },
    estimateConfidence: { band: "medium" },
    distribution: { exists: true },
    simulation: { id: "simulation-1" },
  } as CasePerformance["forecastConfidence"];
  return {
    forecastConfidence,
    latestCalculations: {
      case_forecast_confidence: {
        id: "run-1",
        calculationKey: "case_forecast_confidence",
        method: "recorded SQL calculation",
        codeVersion: "1",
        inputs: forecastConfidenceFingerprint(forecastConfidence),
        inputRefs: [],
        outputs: {
          currency: "CAD",
          costDeterministic: 100,
          costP80: 140,
          scheduleDeterministicFinish: "2027-01-01",
          scheduleP80Finish: "2027-02-15",
        },
        refusals: [],
        status: "computed",
        computedAt: "2026-01-02",
        computedBy: null,
      },
    },
  } as unknown as CasePerformance;
}

const operations = {
  caseId: "case-1",
  assets: [
    {
      assetId: "asset-1",
    },
  ],
  hardBlockers: [],
  overall: { pct: 75, hardBlockerCount: 1 },
} as unknown as OperationalReadinessResult;

describe("D13.03 development portfolio composition", () => {
  it("selects the first gate a human has not passed", () => {
    expect(findNextPortfolioGate(workspace())).toEqual({
      id: 12,
      name: "Sanction gate",
    });
  });

  it("does not imply advancement after a terminal decision", () => {
    const stopped = workspace();
    stopped.stages[0].gates[0].latestReview!.outcome = "terminate";
    expect(findNextPortfolioGate(stopped)).toBeNull();
  });

  it("renders only current recorded forecasts and keeps record trails", () => {
    const perf = performance();
    const row = buildDevelopmentPortfolioRow({
      workspace: workspace({
        risks: [
          {
            id: "risk-1",
            title: "Vendor capacity",
            currentRiskLevel: "High",
            status: "open",
          },
        ] as CaseWorkspace["risks"],
      }),
      nextGate: { id: 12, name: "Sanction gate" },
      gateReadiness: {
        gateId: 12,
        readinessPct: 60,
        blocked: true,
        blockers: [{ type: "criterion", id: 5 }],
      } as unknown as GateReadinessResult,
      performance: perf,
      operationalReadiness: operations,
      benefits: [],
    });

    expect(row.costForecast).toMatchObject({
      currency: "CAD",
      deterministic: 100,
      p80: 140,
      refusal: null,
      sourceRefs: [
        "calculation_runs:run-1",
        "schedule_simulation_runs:simulation-1",
      ],
    });
    expect(row.scheduleForecast.p80Finish).toBe("2027-02-15");
    expect(row.gateReadiness).toMatchObject({
      percent: 60,
      blocked: true,
      blockers: 1,
      sourceRefs: ["stage_gates:12", "criterion:5"],
    });
    expect(row.risk.openHighCritical).toBe(1);
    expect(row.risk.sourceRefs).toEqual(["risk_register:risk-1"]);
    expect(row.operationalReadiness).toMatchObject({
      percent: 75,
      hardBlockers: 1,
      sourceRefs: ["development_cases:case-1", "assets:asset-1"],
    });
  });

  it("withholds a recorded forecast when its canonical inputs moved", () => {
    const perf = performance();
    perf.forecastConfidence.schedule.activityCount = 5;
    const row = buildDevelopmentPortfolioRow({
      workspace: workspace(),
      nextGate: null,
      gateReadiness: null,
      performance: perf,
      operationalReadiness: operations,
      benefits: [],
    });

    expect(row.forecastCurrent).toBe(false);
    expect(row.costForecast.p80).toBeNull();
    expect(row.scheduleForecast.p80Finish).toBeNull();
    expect(row.costForecast.refusal).toMatch(/inputs have moved/i);
    expect(row.risk.absenceNote).toMatch(/not proof/i);
  });
});
