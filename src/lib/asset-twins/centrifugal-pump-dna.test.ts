import { describe, expect, it } from "vitest";
import { centrifugalPumpEngineeringDna } from "./centrifugal-pump-dna";
import { centrifugalPumpTemplate } from "./centrifugal-pump";
import { getEngineeringDnaForAssetClass } from "./electric-rope-shovel-dna";
import { instantiateEngineeringTwin, validateEngineeringDnaProfile } from "./engineering-dna";
import { getAssetClassTemplate, validateAssetClassTemplate } from "./index";

describe("centrifugal pump Digital Engineering DNA", () => {
  it("keeps the canonical hierarchy valid", () => {
    expect(validateAssetClassTemplate(centrifugalPumpTemplate)).toEqual([]);
    expect(new Set(centrifugalPumpTemplate.components.map((component) => component.code)).size).toBe(centrifugalPumpTemplate.components.length);
  });

  it("keeps DNA references canonical and governed", () => {
    expect(validateEngineeringDnaProfile(centrifugalPumpEngineeringDna, centrifugalPumpTemplate, [])).toEqual([]);
    expect(centrifugalPumpEngineeringDna.governance.thresholdsPolicy).toBe("approved_source_only");
    expect(centrifugalPumpEngineeringDna.governance.autonomousOperationalActionAllowed).toBe(false);
  });

  it("supports registry lookup and governed twin creation", () => {
    expect(getAssetClassTemplate(centrifugalPumpTemplate.code)).toBe(centrifugalPumpTemplate);
    expect(getEngineeringDnaForAssetClass(centrifugalPumpTemplate.code)).toBe(centrifugalPumpEngineeringDna);
    const twin = instantiateEngineeringTwin(centrifugalPumpEngineeringDna, { assetId: "P-101", siteId: "SITE-1" });
    expect(twin.assetClassCode).toBe(centrifugalPumpTemplate.code);
    expect(twin.customerOverrides.approvalRequired).toBe(true);
  });
});
