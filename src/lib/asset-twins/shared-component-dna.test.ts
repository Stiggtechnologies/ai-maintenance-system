import { describe, expect, it } from "vitest";
import {
  flexibleCouplingDna,
  getSharedComponentDna,
  lubricationSystemDna,
  mechanicalSealDna,
  rollingElementBearingDna,
  sharedComponentDependencyGraph,
  sharedComponentDnaLibrary,
} from "./shared-component-dna-library";
import { validateComponentDependencyGraph, validateSharedComponentDna } from "./shared-component-dna";

describe("shared component DNA", () => {
  it("keeps the shared component library valid and unique", () => {
    expect(validateSharedComponentDna(sharedComponentDnaLibrary)).toEqual([]);
    expect(new Set(sharedComponentDnaLibrary.map((profile) => profile.code)).size).toBe(sharedComponentDnaLibrary.length);
  });

  it("keeps dependency edges canonical and non-duplicated", () => {
    expect(validateComponentDependencyGraph(sharedComponentDnaLibrary, sharedComponentDependencyGraph)).toEqual([]);
  });

  it("supports canonical lookup for initial shared components", () => {
    expect(getSharedComponentDna(rollingElementBearingDna.code)).toBe(rollingElementBearingDna);
    expect(getSharedComponentDna(flexibleCouplingDna.code)).toBe(flexibleCouplingDna);
    expect(getSharedComponentDna(mechanicalSealDna.code)).toBe(mechanicalSealDna);
    expect(getSharedComponentDna(lubricationSystemDna.code)).toBe(lubricationSystemDna);
  });

  it("keeps every shared component approval-gated", () => {
    for (const profile of sharedComponentDnaLibrary) {
      expect(profile.governance.engineeringApprovalRequired).toBe(true);
      expect(profile.governance.customerOverridesRequireApproval).toBe(true);
      expect(profile.governance.autonomousOperationalActionAllowed).toBe(false);
      expect(profile.governance.thresholdsPolicy).toBe("approved_source_only");
    }
  });

  it("rejects unknown dependency endpoints", () => {
    const invalid = [
      ...sharedComponentDependencyGraph,
      {
        fromComponentCode: "COMP-DNA-UNKNOWN",
        toComponentCode: rollingElementBearingDna.code,
        relationship: "supports" as const,
        rationale: "Invalid test dependency.",
      },
    ];
    expect(validateComponentDependencyGraph(sharedComponentDnaLibrary, invalid)).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: expect.stringContaining("fromComponentCode") })]),
    );
  });
});
