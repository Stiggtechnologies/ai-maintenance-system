import { describe, expect, it } from "vitest";
import { centrifugalPumpEngineeringDna } from "./centrifugal-pump-dna";
import { centrifugalPumpTemplate } from "./centrifugal-pump";
import { getEngineeringDnaForAssetClass } from "./electric-rope-shovel-dna";
import { instantiateEngineeringTwin, validateEngineeringDnaProfile } from "./engineering-dna";
import { getAssetClassTemplate, validateAssetClassTemplate } from "./index";
import { physicsCapabilityLibrary } from "./physics-capability-library";
import { sharedComponentDnaLibrary } from "./shared-component-dna-library";

describe("centrifugal pump Digital Engineering DNA", () => {
  it("keeps the canonical hierarchy valid", () => {
    expect(validateAssetClassTemplate(centrifugalPumpTemplate)).toEqual([]);
    expect(new Set(centrifugalPumpTemplate.components.map((component) => component.code)).size).toBe(centrifugalPumpTemplate.components.length);
  });

  it("keeps DNA, shared-component, and physics references canonical and governed", () => {
    expect(validateEngineeringDnaProfile(
      centrifugalPumpEngineeringDna,
      centrifugalPumpTemplate,
      [],
      sharedComponentDnaLibrary,
      physicsCapabilityLibrary,
    )).toEqual([]);
    expect(centrifugalPumpEngineeringDna.capabilities).toContain("shared_component_composition");
    expect(centrifugalPumpEngineeringDna.capabilities).toContain("physics_capability_composition");
    expect(centrifugalPumpEngineeringDna.sharedComponentBindings).toHaveLength(4);
    expect(centrifugalPumpEngineeringDna.physicsCapabilityBindings).toHaveLength(2);
    expect(centrifugalPumpEngineeringDna.governance.thresholdsPolicy).toBe("approved_source_only");
    expect(centrifugalPumpEngineeringDna.governance.autonomousOperationalActionAllowed).toBe(false);
  });

  it("rejects unknown shared component references", () => {
    const invalid = {
      ...centrifugalPumpEngineeringDna,
      sharedComponentBindings: [
        ...(centrifugalPumpEngineeringDna.sharedComponentBindings ?? []),
        { assetComponentCode: "PUMP-SEAL", sharedComponentDnaCode: "COMP-DNA-UNKNOWN", role: "invalid test binding" },
      ],
    };
    expect(validateEngineeringDnaProfile(
      invalid,
      centrifugalPumpTemplate,
      [],
      sharedComponentDnaLibrary,
      physicsCapabilityLibrary,
    )).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "sharedComponentBindings[4].sharedComponentDnaCode" }),
    ]));
  });

  it("rejects unknown physics capability references", () => {
    const invalid = {
      ...centrifugalPumpEngineeringDna,
      physicsCapabilityBindings: [
        ...(centrifugalPumpEngineeringDna.physicsCapabilityBindings ?? []),
        { assetComponentCode: "PUMP-ROTOR-BEARING", physicsCapabilityCode: "PHYS-UNKNOWN", role: "invalid test binding" },
      ],
    };
    expect(validateEngineeringDnaProfile(
      invalid,
      centrifugalPumpTemplate,
      [],
      sharedComponentDnaLibrary,
      physicsCapabilityLibrary,
    )).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "physicsCapabilityBindings[2].physicsCapabilityCode" }),
    ]));
  });

  it("supports registry lookup and governed twin creation", () => {
    expect(getAssetClassTemplate(centrifugalPumpTemplate.code)).toBe(centrifugalPumpTemplate);
    expect(getEngineeringDnaForAssetClass(centrifugalPumpTemplate.code)).toBe(centrifugalPumpEngineeringDna);
    const twin = instantiateEngineeringTwin(centrifugalPumpEngineeringDna, { assetId: "P-101", siteId: "SITE-1" });
    expect(twin.assetClassCode).toBe(centrifugalPumpTemplate.code);
    expect(twin.customerOverrides.approvalRequired).toBe(true);
    expect(twin.customerOverrides.sharedComponentBindings).toEqual(centrifugalPumpEngineeringDna.sharedComponentBindings);
    expect(twin.customerOverrides.physicsCapabilityBindings).toEqual(centrifugalPumpEngineeringDna.physicsCapabilityBindings);
  });
});
