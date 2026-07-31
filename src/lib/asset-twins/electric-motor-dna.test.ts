import { describe, expect, it } from "vitest";
import { electricMotorEngineeringDna } from "./electric-motor-dna";
import { electricMotorTemplate } from "./electric-motor";
import { instantiateEngineeringTwin, validateEngineeringDnaProfile } from "./engineering-dna";
import { getEngineeringDnaForAssetClass } from "./electric-rope-shovel-dna";
import { getAssetClassTemplate, validateAssetClassTemplate } from "./index";

describe("industrial electric motor Digital Engineering DNA", () => {
  it("keeps the canonical hierarchy valid", () => {
    expect(validateAssetClassTemplate(electricMotorTemplate)).toEqual([]);
  });

  it("keeps DNA references canonical and governed", () => {
    expect(validateEngineeringDnaProfile(electricMotorEngineeringDna, electricMotorTemplate, [])).toEqual([]);
    expect(electricMotorEngineeringDna.governance.thresholdsPolicy).toBe("approved_source_only");
    expect(electricMotorEngineeringDna.governance.autonomousOperationalActionAllowed).toBe(false);
  });

  it("supports registry lookup and governed twin creation", () => {
    expect(getAssetClassTemplate(electricMotorTemplate.code)).toBe(electricMotorTemplate);
    expect(getEngineeringDnaForAssetClass(electricMotorTemplate.code)).toBe(electricMotorEngineeringDna);
    const twin = instantiateEngineeringTwin(electricMotorEngineeringDna, { assetId: "MTR-101", siteId: "SITE-1" });
    expect(twin.assetClassCode).toBe(electricMotorTemplate.code);
    expect(twin.customerOverrides.approvalRequired).toBe(true);
  });
});
