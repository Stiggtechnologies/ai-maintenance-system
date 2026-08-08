import { describe, expect, it } from "vitest";
import { physicsCapabilityLibrary } from "./physics-capability-library";
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
    expect(validateSharedComponentDna(sharedComponentDnaLibrary, physicsCapabilityLibrary)).toEqual([]);
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

  it("binds only applicable canonical physics capabilities", () => {
    expect(rollingElementBearingDna.physicsCapabilityCodes).toHaveLength(2);
    expect(flexibleCouplingDna.physicsCapabilityCodes).toHaveLength(1);
    const availablePhysics = new Set(physicsCapabilityLibrary.map((capability) => capability.code));
    for (const profile of sharedComponentDnaLibrary) {
      expect((profile.physicsCapabilityCodes ?? []).every((code) => availablePhysics.has(code))).toBe(true);
    }
  });

  it("rejects unknown physics capability references", () => {
    const invalid = sharedComponentDnaLibrary.map((profile, index) =>
      index === 0 ? { ...profile, physicsCapabilityCodes: [...(profile.physicsCapabilityCodes ?? []), "PHYS-UNKNOWN"] } : profile,
    );
    expect(validateSharedComponentDna(invalid, physicsCapabilityLibrary)).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: expect.stringContaining("physicsCapabilityCodes") })]),
    );
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
