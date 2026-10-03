import { describe, expect, it } from "vitest";
import type { CaseControls } from "./controls";
import { buildScopeCreepDetection, detectCaseScopeCreep } from "./scopeCreepDetection";

function controls(over: Partial<CaseControls> = {}): CaseControls {
  return {
    caseId: "case-1",
    caseTitle: "Plant expansion",
    needs: [],
    wbs: [],
    cbs: [],
    controlAccounts: [],
    costItems: [],
    scheduleActivities: [],
    systemNodes: [],
    traceability: {} as CaseControls["traceability"],
    controlsBaseline: {
      caseId: "case-1",
      structures: [],
      structureCount: 0,
      capturedCount: 0,
      driftedCount: 0,
      baselineComplete: null,
    },
    scopeGrowth: {
      caseId: "case-1",
      evaluable: true,
      baseline: {
        id: "baseline-1",
        version: 1,
        approvedAt: "2026-01-01",
        approvedBy: "owner@syncai.ca",
        description: "Approved scope",
      },
      additions: [],
    },
    costReconciliation: {} as CaseControls["costReconciliation"],
    latestCalculations: {},
    notInThisSlice: [],
    ...over,
  };
}

describe("D12.01 scope-creep detection", () => {
  it("flags unapproved post-baseline scope and its missing cost from canonical records", () => {
    const result = detectCaseScopeCreep({
      caseId: "case-1",
      caseTitle: "Plant expansion",
      status: "active",
      controls: controls({
        scopeGrowth: {
          caseId: "case-1",
          evaluable: true,
          baseline: {
            id: "baseline-1",
            version: 1,
            approvedAt: "2026-01-01",
            approvedBy: "owner@syncai.ca",
            description: "Approved scope",
          },
          additions: [
            {
              id: "growth-1",
              changeRef: "SG-001",
              description: "Add a second transfer pump",
              origin: "design_development",
              addedAt: "2026-02-01",
              wbsCode: "1.2",
              costEffect: null,
              costBasis: null,
              currency: "CAD",
              approvedChangeRef: null,
              recordedBy: "planner@syncai.ca",
            },
          ],
        },
      }),
    });

    expect(result.potentialScopeCreepCount).toBe(1);
    expect(result.evidenceGapCount).toBe(1);
    expect(result.flags.map((flag) => flag.kind)).toEqual([
      "unapproved_addition",
      "uncosted_addition",
    ]);
    expect(result.flags[0].sourceRefs).toContain("project_scope_changes:growth-1");
    expect(result.flags[0].sourceRefs).toContain("development_baselines:baseline-1");
  });

  it("flags captured structure drift without declaring that scope changed", () => {
    const result = detectCaseScopeCreep({
      caseId: "case-1",
      caseTitle: "Plant expansion",
      status: "active",
      controls: controls({
        controlsBaseline: {
          caseId: "case-1",
          structureCount: 1,
          capturedCount: 1,
          driftedCount: 1,
          baselineComplete: false,
          structures: [
            {
              structure: "wbs",
              home: "project_wbs_elements",
              currentCount: 12,
              refusal: null,
              baselined: true,
              baseline: {
                baselineId: "baseline-1",
                baselineType: "SCOPE",
                version: 1,
                approvedAt: "2026-01-01",
                capturedAt: "2026-01-01",
                capturedBy: "owner@syncai.ca",
                structureLastChangedAt: "2025-12-31",
                elementCount: 10,
              },
              drifted: true,
              driftDetail: "WBS contains two more elements than the approved capture.",
            },
          ],
        },
      }),
    });

    expect(result.flags).toMatchObject([
      { kind: "baseline_drift", classification: "potential_scope_creep" },
    ]);
  });

  it("reports absent baselines as an evidence gap and does not call it creep", () => {
    const result = buildScopeCreepDetection([
      {
        caseId: "case-1",
        caseTitle: "Plant expansion",
        status: "active",
        controls: controls({
          scopeGrowth: {
            caseId: "case-1",
            evaluable: false,
            refusal: "No approved SCOPE baseline exists.",
          },
        }),
      },
    ]);

    expect(result.cases[0]).toMatchObject({
      potentialScopeCreepCount: 0,
      evidenceGapCount: 1,
    });
    expect(result.decisionBoundary).toContain("named human");
    expect(result.limitations.join(" ")).toContain("not a determination");
  });
});
