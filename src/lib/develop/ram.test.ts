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
    expect(RAM_KERNEL_VERSION).toBe("develop-ram/5D/2026-12-07");
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
