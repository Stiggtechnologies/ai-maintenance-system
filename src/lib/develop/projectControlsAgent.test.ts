import { describe, expect, it } from "vitest";
import type { CasePerformance } from "./performance";
import { buildProjectControlsAgent } from "./projectControlsAgent";

function performance(): CasePerformance {
  return {
    caseId: "case-1",
    caseTitle: "Plant expansion",
    progressIntegrity: {
      caseId: "case-1",
      period: { id: "period-1", periodRef: "2026-09", periodEnd: "2026-09-30", status: "closed" },
      elements: [
        {
          wbsCode: "1.2",
          title: "Install pump",
          ruleRef: "ROC-1",
          stepLabel: "Installed",
          claimedPercent: 80,
          bindingSource: "field_installation",
          bindingUnit: "units",
          observedComplete: 4,
          observedTotal: 10,
          observedPercent: 40,
          divergencePoints: 40,
          sourceCount: 1,
          confidence: "low",
          refusal: null,
          discrepancy: "1.2 is claimed 80 percent complete but field installation supports 40 percent.",
        },
        {
          wbsCode: "1.3",
          title: "Commission pump",
          ruleRef: "ROC-2",
          stepLabel: "Tested",
          claimedPercent: 25,
          bindingSource: null,
          bindingUnit: null,
          observedComplete: null,
          observedTotal: null,
          observedPercent: null,
          divergencePoints: null,
          sourceCount: 0,
          confidence: null,
          refusal: "No independent observation is recorded.",
          discrepancy: null,
        },
      ],
      claimedElementCount: 2,
      coveredElementCount: 1,
      coverage: 50,
      evidenceCount: 1,
      basisDigest: "digest",
      lowCount: 1,
      mediumCount: 0,
      highCount: 0,
      confidence: "low",
      headline: "Material discrepancy.",
      bands: {},
      refusal: null,
    },
    trend: {
      caseId: "case-1",
      points: [{ runId: "run-1" }],
      gaps: [{ periodRef: "2026-08", periodEnd: "2026-08-31", kind: "not_computed", reason: "No earned-value run was recorded." }],
      periodCount: 2,
      recordedPointCount: 1,
      measuredPointCount: 1,
      refusedPointCount: 0,
      costTrend: "deteriorating",
      costTrendRefusal: null,
      costTrendInterval: "2026-07 to 2026-09",
      costTrendVolatility: null,
      scheduleTrend: null,
      scheduleTrendRefusal: "Too few points.",
      scheduleTrendInterval: null,
      scheduleTrendVolatility: null,
      refusal: null,
      basis: "Recorded runs only.",
    },
    latestCalculations: {
      case_performance_trend: { id: "trend-run" },
    },
  } as unknown as CasePerformance;
}

describe("D12.11 Project Controls Agent", () => {
  it("places recorded progress disagreement before trends and unknowns", () => {
    const result = buildProjectControlsAgent([
      {
        caseId: "case-1",
        caseTitle: "Plant expansion",
        status: "active",
        performance: performance(),
        scopeCreep: {
          caseId: "case-1",
          caseTitle: "Plant expansion",
          status: "active",
          potentialScopeCreepCount: 1,
          evidenceGapCount: 0,
          flags: [{ kind: "baseline_drift", classification: "potential_scope_creep", title: "WBS moved", detail: "Two elements added.", sourceRefs: ["development_baselines:baseline-1"] }],
        },
      },
    ]);

    expect(result.cases[0].posture).toBe("intervene");
    expect(result.cases[0].findings.map((item) => item.code)).toEqual([
      "progress_low",
      "cost_trend_deteriorating",
      "scope_movement",
      "progress_unrated",
      "trend_gap",
    ]);
    expect(result.cases[0].findings[0].sourceRefs).toContain("project_progress_periods:period-1");
    expect(result.method).toContain("does not reinterpret claimed progress");
    expect(result.decisionBoundary).toContain("named human");
  });
});
