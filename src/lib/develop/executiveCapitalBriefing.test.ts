import { describe, expect, it } from "vitest";
import { buildExecutiveCapitalBriefing } from "./executiveCapitalBriefing";
import type { ExecutiveBenefitsInput } from "./executiveCapitalBriefing";
import type { CaseWorkspace, SinceSanctionDelta } from "./index";
import type { CasePerformance } from "./performance";

function fixtures() {
  const workspace = {
    id: "case-1",
    title: "Compressor renewal",
    sanction: {
      sanctionedAt: "2026-01-01",
      sanctionedValue: 340,
      note: null,
      by: "Pat",
    },
    risks: [
      {
        id: "risk-1",
        title: "Compressor delivery",
        status: "open",
        currentRiskLevel: "High",
        residualRiskLevel: null,
        decisionAction: null,
        reviewDate: null,
        owner: "Lee",
      },
    ],
  } as CaseWorkspace;
  const performance = {
    forecastConfidence: {
      cost: {
        costLineCount: 2,
        recordedForecastLineCount: 2,
        percentileRefusal: "",
        deterministicRefusal: null,
      },
      schedule: {
        activityCount: 5,
        activitiesWithDurationRange: 5,
        percentileRefusal: "",
        criticalDrivers: [],
        criticalDriversRefusal: "",
        deterministicHours: 100,
      },
      estimateConfidence: { band: "medium" },
      distribution: { exists: true, reason: "recorded" },
      simulation: { id: "sim-1", current: true },
      againstSanction: "Forecast exceeds the sanctioned value.",
    },
    latestCalculations: {
      case_forecast_confidence: {
        id: "run-1",
        status: "computed",
        refusals: [],
        inputs: {
          costLineCount: 2,
          forecastLineCount: 2,
          activityCount: 5,
          activitiesWithDurationRange: 5,
          estimateConfidenceBand: "medium",
          distributionExists: true,
          simulationId: "sim-1",
        },
        outputs: {
          currency: "CAD",
          costDeterministic: 397,
          costP80: 420,
          scheduleDeterministicFinish: "2027-01-01",
          scheduleP80Finish: "2027-04-22",
        },
      },
    },
  } as unknown as CasePerformance;
  const sinceSanction = {
    caseId: "case-1",
    available: true,
    sanctionBaseline: {
      evaluationId: "eval-1",
      expectedValue: 82,
      evaluatedAt: "2026-01-01",
    },
    current: {
      evaluationId: "eval-2",
      expectedValue: 69,
      evaluatedAt: "2026-06-01",
    },
    dimensions: [
      { dimension: "expected_value", atSanction: 82, current: 69, delta: -13 },
    ],
  } as SinceSanctionDelta;
  const benefits = {
    benefits: [
      {
        id: "benefit-1",
        label: "Avoided downtime",
        expected: 82,
        unit: "M CAD/year",
        expectedDate: "2027-12-31",
        owner: "Alex",
        basis: "approved benefit",
        currentForecast: 69,
        forecastMetricId: "forecast-1",
        actual: null,
        actualMetricId: null,
      },
    ],
  } as ExecutiveBenefitsInput;
  return { workspace, performance, sinceSanction, benefits };
}

describe("buildExecutiveCapitalBriefing", () => {
  it("assembles recorded forecast, value, benefits and risks without deciding the funding action", () => {
    const f = fixtures();
    const model = buildExecutiveCapitalBriefing(
      f.workspace,
      f.performance,
      f.sinceSanction,
      f.benefits,
    );
    expect(model.position).toBe("human_review_required");
    expect(model.cost).toMatchObject({
      sanctioned: 340,
      deterministicForecast: 397,
      p80Forecast: 420,
      currency: "CAD",
    });
    expect(model.schedule.p80Finish).toBe("2027-04-22");
    expect(model.value).toMatchObject({
      available: true,
      atSanction: 82,
      current: 69,
      delta: -13,
    });
    expect(model.benefits[0].sourceRefs).toContain("value_metrics:forecast-1");
    expect(model.forecastSourceRefs).toContain("calculation_runs:run-1");
    expect(model.majorDrivers[0]).toMatchObject({
      id: "risk-1",
      p80DaysContribution: null,
    });
    expect(model.decisionBoundary).toMatch(/named human/i);
  });

  it("withholds a stale recorded forecast and names the evidence gap", () => {
    const f = fixtures();
    f.performance.forecastConfidence.simulation.id = "sim-2";
    const model = buildExecutiveCapitalBriefing(
      f.workspace,
      f.performance,
      f.sinceSanction,
      f.benefits,
    );
    expect(model.forecastCurrent).toBe(false);
    expect(model.cost.p80Forecast).toBeNull();
    expect(model.schedule.p80Finish).toBeNull();
    expect(model.position).toBe("evidence_incomplete");
    expect(model.limitations.join(" ")).toMatch(/inputs have moved/i);
  });

  it("does not treat no major returned risks as proof of no risk", () => {
    const f = fixtures();
    f.workspace.risks = [];
    const model = buildExecutiveCapitalBriefing(
      f.workspace,
      f.performance,
      f.sinceSanction,
      f.benefits,
    );
    expect(model.majorDrivers).toEqual([]);
    expect(model.limitations.join(" ")).toMatch(/not proof.*risk is absent/i);
  });
});
