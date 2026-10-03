import { describe, expect, it } from "vitest";
import {
  RAM_KERNEL_VERSION,
  computeCaseRamProfile,
  ramProfileLines,
  type RamScopePayload,
} from "./ram";

const scope = (over: Partial<RamScopePayload> = {}): RamScopePayload => ({
  caseId: "c1",
  refused: false,
  assets: [],
  targets: [],
  refusals: [],
  ...over,
});

describe("the RAM kernel is REUSED, never re-implemented (D12.13)", () => {
  it("pins the kernel version the server also pins", () => {
    expect(RAM_KERNEL_VERSION).toBe("develop-ram/5E/2026-12-20");
  });

  it("allocates a target across its subsystems using the shipped kernel", () => {
    const profile = computeCaseRamProfile(
      scope({
        targets: [
          {
            targetId: 1,
            systemLabel: "Underflow train",
            targetAvailability: 0.96,
            configuration: "series",
            basis: "Vendor guarantee",
            allocations: [
              {
                label: "Pump",
                demonstrated: 0.99,
                recordedAllocation: null,
                evidence: "fleet",
                complexityWeight: 2,
              },
              {
                label: "Motor",
                demonstrated: 0.995,
                recordedAllocation: null,
                evidence: "fleet",
                complexityWeight: 1,
              },
            ],
            allocationCount: 2,
          },
        ],
      }),
    );
    expect(profile.refused).toBe(false);
    expect(profile.targets[0].allocation.subsystems).toHaveLength(2);
    // Series shares multiply back to the target.
    const product = profile.targets[0].allocation.subsystems.reduce(
      (p, s) => p * s.allocated,
      1,
    );
    expect(product).toBeCloseTo(0.96, 6);
  });
});

describe("every leg that cannot be computed refuses BY NAME", () => {
  it("a refused scope produces NO profile at all", () => {
    const profile = computeCaseRamProfile(
      scope({
        refused: true,
        refusal: "No asset is bound to this case.",
        refusals: ["No asset is bound to this case."],
      }),
    );
    expect(profile.refused).toBe(true);
    expect(profile.targets).toHaveLength(0);
    expect(profile.assets).toHaveLength(0);
    expect(profile.headline).toContain("No asset is bound");
  });

  it("a target with no allocations is refused, not allocated across nothing", () => {
    const profile = computeCaseRamProfile(
      scope({
        targets: [
          {
            targetId: 1,
            systemLabel: "Empty system",
            targetAvailability: 0.98,
            configuration: "series",
            basis: null,
            allocations: [],
            allocationCount: 0,
          },
        ],
      }),
    );
    expect(profile.targets[0].allocation.feasible).toBe(false);
    expect(profile.refusals.join(" ")).toContain("Empty system");
    expect(profile.refusals.join(" ")).toContain("nothing to allocate");
  });

  it("a MIXED configuration is refused rather than silently treated as series", () => {
    const profile = computeCaseRamProfile(
      scope({
        targets: [
          {
            targetId: 2,
            systemLabel: "Mixed train",
            targetAvailability: 0.98,
            configuration: "mixed",
            basis: null,
            allocations: [
              {
                label: "A",
                demonstrated: 0.99,
                recordedAllocation: null,
                evidence: null,
                complexityWeight: 1,
              },
            ],
            allocationCount: 1,
          },
        ],
      }),
    );
    expect(profile.targets[0].allocation.subsystems).toHaveLength(0);
    expect(profile.refusals.join(" ")).toContain("MIXED");
  });

  it("an asset with one failure fits nothing and says why", () => {
    const profile = computeCaseRamProfile(
      scope({
        assets: [
          {
            assetId: "a1",
            assetTag: "P-102",
            name: "Underflow pump",
            criticality: "high",
            failureTimes: [1200],
            suspensionTimes: [3000],
            failureCount: 1,
            suspensionCount: 1,
          },
        ],
      }),
    );
    expect(profile.assets[0].selection.method).toBe("none");
    expect(profile.assets[0].selection.beta).toBeNull();
    expect(profile.refusals.join(" ")).toContain("P-102");
    expect(profile.refusals.join(" ")).toContain("Two distinct failures");
  });

  it("a demonstrated figure that is ABSENT is reported unknown, never assumed met", () => {
    const profile = computeCaseRamProfile(
      scope({
        targets: [
          {
            targetId: 3,
            systemLabel: "Partly evidenced",
            targetAvailability: 0.97,
            configuration: "series",
            basis: null,
            allocations: [
              {
                label: "A",
                demonstrated: 0.99,
                recordedAllocation: null,
                evidence: null,
                complexityWeight: 1,
              },
              {
                label: "B",
                demonstrated: null,
                recordedAllocation: null,
                evidence: null,
                complexityWeight: 1,
              },
            ],
            allocationCount: 2,
          },
        ],
      }),
    );
    const b = profile.targets[0].allocation.subsystems.find(
      (s) => s.label === "B",
    );
    expect(b?.demonstrated).toBeNull();
    expect(b?.shortfall).toBeNull();
    // The kernel is STRICTER than "report it unknown": an unquantified
    // subsystem makes the whole allocation infeasible and says so.
    expect(profile.targets[0].allocation.feasible).toBe(false);
    expect(ramProfileLines(profile).join(" ")).toContain(
      "UNKNOWN rather than met",
    );
  });

  it("carries the SERVER's refusals through — including the absent RBD structure", () => {
    const profile = computeCaseRamProfile(
      scope({
        refusals: [
          "No system reliability (RBD) is computed for this case: nothing stores a redundancy structure.",
        ],
      }),
    );
    expect(profile.refusals.join(" ")).toContain("RBD");
  });
});

describe("the printed reading never renders a refusal as a result", () => {
  it("a fitted asset prints its estimator and its sample, not just a beta", () => {
    const profile = computeCaseRamProfile(
      scope({
        assets: [
          {
            assetId: "a1",
            assetTag: "P-103",
            name: "Second pump",
            criticality: "high",
            failureTimes: [900, 1400, 2100, 2600, 3300],
            suspensionTimes: [],
            failureCount: 5,
            suspensionCount: 0,
          },
        ],
      }),
    );
    const line = ramProfileLines(profile).join("\n");
    expect(line).toContain("P-103");
    expect(line).toMatch(/beta \d/);
    expect(line).toContain("failure(s)");
  });

  it("a refused profile prints the refusals and NO figures", () => {
    const lines = ramProfileLines(
      computeCaseRamProfile(
        scope({
          refused: true,
          refusals: ["No availability target is recorded."],
        }),
      ),
    );
    expect(lines.join("\n")).toContain("No availability target is recorded.");
    expect(lines.join("\n")).not.toMatch(/beta/);
  });
});

describe("the case RAM profile composes the canonical RBD and growth kernels", () => {
  const observedAsset = (
    assetId: string,
    assetTag: string,
    downtimeHours: number[],
    failureEventHours: number[],
  ) => ({
    assetId,
    assetTag,
    name: assetTag,
    criticality: "high",
    failureTimes: [100, 200],
    suspensionTimes: [],
    failureCount: 2,
    suspensionCount: 0,
    observationWindow: {
      startAt: "2026-01-01T00:00:00Z",
      endAt: "2026-02-11T16:00:00Z",
      calendarHours: 1000,
      operatingHoursDelta: 760,
      meterReadingIds: [`${assetId}-start`, `${assetId}-end`],
      downtimeHours,
      failureEventHours,
      workOrderIds: failureEventHours.map(
        (_, index) => `${assetId}-wo-${index}`,
      ),
      basis:
        "Two governed operating-hour readings bound the calendar observation window; corrective work-order downtime inside that window supplies the numerator.",
    },
  });

  it("evaluates the declared case dependency graph with observed availability", () => {
    const profile = computeCaseRamProfile(
      scope({
        assets: [
          observedAsset("dependent", "TRAIN-1", [4], [400]),
          observedAsset("supplier", "P-201", [10, 5], [200, 600]),
        ],
        topology: {
          edges: [
            {
              edgeId: 41,
              dependentAssetId: "dependent",
              supplierAssetId: "supplier",
              dependencyKind: "functional",
              redundancyGroup: null,
              minRequired: 1,
              evidence: "Approved P&ID P-100 rev C",
              source: "p_and_id",
              confirmedAt: "2026-01-10T00:00:00Z",
              confirmedBy: "engineer-1",
              commonCauseGroups: [],
            },
          ],
          commonCauseGroups: [],
          note: "Declared case graph only; completeness is not inferred.",
        },
      }),
    );

    expect(profile.rbd?.result.computable).toBe(true);
    expect(profile.rbd?.result.systemReliability).toBeCloseTo(0.985, 6);
    expect(profile.rbd?.edgeIds).toEqual([41]);
    expect(
      profile.assets.find((a) => a.assetId === "supplier")?.availability,
    ).toMatchObject({ failures: 2, downtimeHours: 15, calendarHours: 1000 });
  });

  it("refuses an unconfirmed topology instead of evaluating a convenient subset", () => {
    const profile = computeCaseRamProfile(
      scope({
        assets: [observedAsset("supplier", "P-202", [8], [300])],
        topology: {
          edges: [
            {
              edgeId: 42,
              dependentAssetId: "dependent",
              supplierAssetId: "supplier",
              dependencyKind: "utility",
              redundancyGroup: "duty-standby",
              minRequired: 1,
              evidence: null,
              source: "derived",
              confirmedAt: null,
              confirmedBy: null,
              commonCauseGroups: [],
            },
          ],
          commonCauseGroups: [],
          note: "Declared case graph only; completeness is not inferred.",
        },
      }),
    );

    expect(profile.rbd).toBeNull();
    expect(profile.refusals.join(" ")).toMatch(/edge 42.*confirmed.*evidence/i);
  });

  it("reports common cause without beta as an upper bound", () => {
    const profile = computeCaseRamProfile(
      scope({
        assets: [
          observedAsset("p1", "P-203A", [10], [200]),
          observedAsset("p2", "P-203B", [12], [300]),
        ],
        topology: {
          edges: [
            {
              edgeId: 43,
              dependentAssetId: "train",
              supplierAssetId: "p1",
              dependencyKind: "functional",
              redundancyGroup: "pumps",
              minRequired: 1,
              evidence: "Approved RBD-17",
              source: "human",
              confirmedAt: "2026-01-10T00:00:00Z",
              confirmedBy: "engineer-1",
              commonCauseGroups: ["shared-header"],
            },
            {
              edgeId: 44,
              dependentAssetId: "train",
              supplierAssetId: "p2",
              dependencyKind: "functional",
              redundancyGroup: "pumps",
              minRequired: 1,
              evidence: "Approved RBD-17",
              source: "human",
              confirmedAt: "2026-01-10T00:00:00Z",
              confirmedBy: "engineer-1",
              commonCauseGroups: ["shared-header"],
            },
          ],
          commonCauseGroups: [
            {
              groupId: 7,
              name: "shared-header",
              causeKind: "shared_supply",
              memberAssetIds: ["p1", "p2"],
              betaFactor: null,
            },
          ],
          note: "Declared case graph only; completeness is not inferred.",
        },
      }),
    );

    expect(profile.rbd?.result.computable).toBe(true);
    expect(profile.rbd?.result.groupsWithUnquantifiedCommonCause).toEqual([
      "pumps",
    ]);
    expect(profile.rbd?.result.reason).toContain("upper bound");
  });

  it("runs Crow-AMSAA only inside the governed observation window", () => {
    const profile = computeCaseRamProfile(
      scope({
        assets: [
          observedAsset("a-growth", "P-204", [3, 4, 5], [100, 400, 800]),
        ],
      }),
    );
    const asset = profile.assets[0];
    expect(asset.growth?.failures).toBe(3);
    expect(asset.growth?.totalTime).toBe(1000);
    expect(asset.growthReason).toContain("Crow-AMSAA");
  });

  it("case-scopes existing FMEA and PM strategy rows without approving them", () => {
    const profile = computeCaseRamProfile(
      scope({
        fmea: [
          {
            id: "fmea-1",
            assetId: "a1",
            assetTag: "P-205",
            failureMode: "Seal leakage",
            failureMechanism: "abrasive wear",
            cause: "solids ingress",
            effect: "loss of containment",
            detectionMethod: "leak inspection",
            consequence: "environmental release",
            currentControls: "weekly round",
            recommendedControls: "flush plan review",
            source: "human_reviewed_library",
          },
        ],
        pmStrategies: [
          {
            id: "pm-1",
            assetId: "a1",
            assetTag: "P-205",
            recommendation: "Inspect seal flush differential pressure",
            failureModeAddressed: "Seal leakage",
            riskReduced: "loss of containment",
            evidenceUsed: { refs: ["inspection-77"] },
            assumptions: { duty: "solids-bearing water" },
            confidence: "medium",
            requiredApproval: "reliability_engineer",
            implementationWorkOrder: null,
            status: "draft",
          },
        ],
      }),
    );

    expect(profile.fmea.map((row) => row.id)).toEqual(["fmea-1"]);
    expect(profile.pmStrategies.map((row) => row.id)).toEqual(["pm-1"]);
    expect(profile.pmStrategies[0].status).toBe("draft");
    expect(profile.decisionBoundary).toMatch(/human/i);
  });
});
