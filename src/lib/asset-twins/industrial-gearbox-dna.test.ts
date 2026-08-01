import { describe, expect, it } from "vitest";
import { getEngineeringDnaForAssetClass } from "./electric-rope-shovel-dna";
import { instantiateEngineeringTwin, validateEngineeringDnaProfile } from "./engineering-dna";
import { getAssetClassTemplate, validateAssetClassTemplate } from "./index";
import { industrialGearboxEngineeringDna } from "./industrial-gearbox-dna";
import { industrialGearboxTemplate } from "./industrial-gearbox";

describe("industrial gearbox Digital Engineering DNA", () => {
  it("keeps hierarchy and references valid", () => {
    expect(validateAssetClassTemplate(industrialGearboxTemplate)).toEqual([]);
    expect(validateEngineeringDnaProfile(industrialGearboxEngineeringDna, industrialGearboxTemplate, [])).toEqual([]);
  });

  it("registers the asset and DNA profile uniquely", () => {
    expect(getAssetClassTemplate(industrialGearboxTemplate.code)).toBe(industrialGearboxTemplate);
    expect(getEngineeringDnaForAssetClass(industrialGearboxTemplate.code)).toBe(industrialGearboxEngineeringDna);
    expect(new Set(industrialGearboxEngineeringDna.componentCodes).size).toBe(industrialGearboxEngineeringDna.componentCodes.length);
    expect(new Set(industrialGearboxEngineeringDna.failureModeCodes).size).toBe(industrialGearboxEngineeringDna.failureModeCodes.length);
  });

  it("creates a governed customer twin", () => {
    const twin = instantiateEngineeringTwin(industrialGearboxEngineeringDna, { assetId: "GB-101", siteId: "SITE-1" });
    expect(twin.assetClassCode).toBe(industrialGearboxTemplate.code);
    expect(twin.customerOverrides.approvalRequired).toBe(true);
    expect(industrialGearboxEngineeringDna.governance.autonomousOperationalActionAllowed).toBe(false);
    expect(industrialGearboxEngineeringDna.governance.thresholdsPolicy).toBe("approved_source_only");
  });
});
