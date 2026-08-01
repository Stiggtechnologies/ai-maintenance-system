import { describe, expect, it } from "vitest";
import { centrifugalPumpEngineeringDna } from "./centrifugal-pump-dna";
import { centrifugalPumpTemplate } from "./centrifugal-pump";
import { getEngineeringDnaForAssetClass } from "./electric-rope-shovel-dna";
import { instantiateEngineeringTwin, validateEngineeringDnaProfile } from "./engineering-dna";
import { getAssetClassTemplate, validateAssetClassTemplate } from "./index";
import { sharedComponentDnaLibrary } from "./shared-component-dna-library";

describe("centrifugal pump Digital Engineering DNA", () => {
  it("keeps the canonical hierarchy valid", () => {
    expect(validateAssetClassTemplate(centrifugalPumpTemplate)).toEqual([]);
    expect(new Set(centrifugalPumpTemplate.components.map((component) => component.code)).size).toBe(centrifugalPumpTemplate.components.length);
  });

  it("keeps DNA and shared-component references canonical and governed", () => {
    expect(validateEngineeringDnaProfile(
      centrifugalPumpEngineeringDna,
      centrifugalPumpTemplate,
      [],
      sharedComponentDnaLibrary,
    )).toEqual([]);
    expect(centrifugalPumpEngineeringDna.capabilities).toContain("shared_component_composition");
    expect(centrifugalPumpEngineeringDna.sharedComponentBindings).toHaveLength(4);
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
    expect(validateEngineeringDnaProfile(invalid, centrifugalPumpTemplate, [], sharedComponentDnaLibrary))
      .toEqual(expect.arrayContaining([expect.objectContaining({ path: "sharedComponentBindings[4].sharedComponentDnaCode" })]));
  });

  it("supports registry lookup and governed twin creation", () => {
    expect(getAssetClassTemplate(centrifugalPumpTemplate.code)).toBe(centrifugalPumpTemplate);
    expect(getEngineeringDnaForAssetClass(centrifugalPumpTemplate.code)).toBe(centrifugalPumpEngineeringDna);
    const twin = instantiateEngineeringTwin(centrifugalPumpEngineeringDna, { assetId: "P-101", siteId: "SITE-1" });
    expect(twin.assetClassCode).toBe(centrifugalPumpTemplate.code);
    expect(twin.customerOverrides.approvalRequired).toBe(true);
    expect(twin.customerOverrides.sharedComponentBindings).toEqual(centrifugalPumpEngineeringDna.sharedComponentBindings);
  });
});
