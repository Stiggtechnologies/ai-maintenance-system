import { describe, expect, it } from "vitest";
import type { DevelopmentPortfolioRow } from "./developmentPortfolio";
import { buildProjectInterventionTriage } from "./projectInterventionTriage";

function row(
  caseId: string,
  project: string,
  over: Partial<DevelopmentPortfolioRow> = {},
): DevelopmentPortfolioRow {
  return {
    caseId,
    project,
    status: "active",
    stage: "Execute",
    nextGate: { id: 11, name: "Ready for startup" },
    gateReadiness: {
      percent: 90,
      blocked: false,
      blockers: 0,
      sourceRefs: ["stage_gates:11"],
    },
    costForecast: {
      currency: "CAD",
      deterministic: 100,
      p80: 130,
      refusal: null,
      sourceRefs: ["calculation_runs:cost-1"],
    },
    scheduleForecast: {
      deterministicFinish: "2027-01-01",
      p80Finish: "2027-02-01",
      refusal: null,
      sourceRefs: ["calculation_runs:schedule-1"],
    },
    risk: { openHighCritical: 0, leading: [], absenceNote: null, sourceRefs: [] },
    operationalReadiness: {
      percent: 85,
      hardBlockers: 0,
      refusal: null,
      sourceRefs: ["assets:asset-1"],
    },
    benefits: [
      {
        id: "benefit-1",
        label: "Throughput",
        unit: "%",
        expected: 10,
        currentForecast: 10,
        actual: null,
        owner: "owner@syncai.ca",
        expectedDate: "2027-06-01",
        forecastMetricId: "forecast-1",
        actualMetricId: null,
      },
    ],
    forecastCurrent: true,
    ...over,
  };
}

describe("D12.04 project intervention triage", () => {
  it("puts explicit hard conditions ahead of attention and evidence gaps without a score", () => {
    const triage = buildProjectInterventionTriage(
      [
        row("gap", "Evidence gap", {
          costForecast: {
            currency: null,
            deterministic: null,
            p80: null,
            refusal: "No current forecast calculation has been recorded.",
            sourceRefs: [],
          },
        }),
        row("attention", "Benefit erosion", {
          benefits: [
            {
              id: "benefit-2",
              label: "Availability",
              unit: "%",
              expected: 98,
              currentForecast: 94,
              actual: null,
              owner: "owner@syncai.ca",
              expectedDate: "2027-06-01",
              forecastMetricId: "forecast-2",
              actualMetricId: null,
            },
          ],
        }),
        row("blocked", "Blocked startup", {
          gateReadiness: {
            percent: 80,
            blocked: true,
            blockers: 2,
            sourceRefs: ["stage_gates:11", "criterion:8"],
          },
        }),
      ],
      "2026-09-20T12:00:00.000Z",
    );

    expect(triage.items.map((item) => item.caseId)).toEqual([
      "blocked",
      "attention",
      "gap",
    ]);
    expect(triage.items[0]).toMatchObject({
      posture: "intervene",
      reasons: [{ code: "gate_blocked" }],
    });
    expect(triage.method).toContain("No blended score");
    expect(triage.decisionBoundary).toContain("named human");
  });

  it("keeps missing evidence distinct from a negative finding", () => {
    const triage = buildProjectInterventionTriage([
      row("case-1", "Unassessed project", {
        nextGate: { id: 12, name: "Sanction" },
        gateReadiness: null,
        operationalReadiness: {
          percent: null,
          hardBlockers: 0,
          refusal: "No operational-readiness scope exists.",
          sourceRefs: ["development_cases:case-1"],
        },
        benefits: [],
      }),
    ]);

    expect(triage.items[0].posture).toBe("evidence_gap");
    expect(triage.items[0].reasons.map((reason) => reason.code)).toEqual([
      "gate_unassessed",
      "operations_unassessed",
      "benefits_unestablished",
    ]);
    expect(triage.limitations.join(" ")).toContain("not adverse findings");
  });

  it("does not claim that a project with no explicit trigger is healthy", () => {
    const triage = buildProjectInterventionTriage([
      row("case-1", "No returned trigger"),
    ]);
    expect(triage.items).toEqual([]);
    expect(triage.limitations.join(" ")).toContain("not a claim");
  });
});
