import { describe, expect, it } from "vitest";
import { electricMotorEngineeringDna } from "./electric-motor-dna";
import { electricMotorTemplate } from "./electric-motor";
import { instantiateEngineeringTwin, validateEngineeringDnaProfile } from "./engineering-dna";
import { getEngineeringDnaForAssetClass } from "./electric-rope-shovel-dna";
import { getAssetClassTemplate, validateAssetClassTemplate } from "./index";
import { sharedComponentDnaLibrary } from "./shared-component-dna-library";

describe("industrial electric motor Digital Engineering DNA", () => {
  it("keeps the canonical hierarchy valid", () => {
    expect(validateAssetClassTemplate(electricMotorTemplate)).toEqual([]);
  });

  it("keeps shared-component composition canonical and governed", () => {
    expect(
      validateEngineeringDnaProfile(
        electricMotorEngineeringDna,
        electricMotorTemplate,
        [],
        sharedComponentDnaLibrary,
      ),
    ).toEqual([]);
    expect(electricMotorEngineeringDna.capabilities).toContain("shared_component_composition");
    expect(electricMotorEngineeringDna.sharedComponentBindings).toHaveLength(2);
    expect(electricMotorEngineeringDna.governance.thresholdsPolicy).toBe("approved_source_only");
    expect(electricMotorEngineeringDna.governance.autonomousOperationalActionAllowed).toBe(false);
  });

  it("supports registry lookup and governed twin creation", () => {
    expect(getAssetClassTemplate(electricMotorTemplate.code)).toBe(electricMotorTemplate);
    expect(getEngineeringDnaForAssetClass(electricMotorTemplate.code)).toBe(electricMotorEngineeringDna);
    const twin = instantiateEngineeringTwin(electricMotorEngineeringDna, { assetId: "MTR-101", siteId: "SITE-1" });
    expect(twin.assetClassCode).toBe(electricMotorTemplate.code);
    expect(twin.customerOverrides.approvalRequired).toBe(true);
    expect(twin.customerOverrides.sharedComponentBindings).toEqual(electricMotorEngineeringDna.sharedComponentBindings);
  });

  it("rejects unknown shared-component endpoints", () => {
    const invalid = {
      ...electricMotorEngineeringDna,
      sharedComponentBindings: [
        ...(electricMotorEngineeringDna.sharedComponentBindings ?? []),
        { assetComponentCode: "EM-BEARING", sharedComponentDnaCode: "UNKNOWN", role: "invalid" },
      ],
    };
    expect(
      validateEngineeringDnaProfile(invalid, electricMotorTemplate, [], sharedComponentDnaLibrary),
    ).toEqual(expect.arrayContaining([expect.objectContaining({ path: "sharedComponentBindings[2].sharedComponentDnaCode" })]));
  });
});
