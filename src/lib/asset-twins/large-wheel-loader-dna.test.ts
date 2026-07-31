import { describe, expect, it } from "vitest";
import { instantiateEngineeringTwin, validateEngineeringDnaProfile } from "./engineering-dna";
import { getAssetClassTemplate, validateAssetClassTemplate } from "./index";
import { largeWheelLoaderEngineeringDna } from "./large-wheel-loader-dna";
import { largeWheelLoaderTemplate } from "./large-wheel-loader";

describe("large wheel loader Digital Engineering DNA", () => {
  it("has a valid canonical hierarchy", () => {
    expect(validateAssetClassTemplate(largeWheelLoaderTemplate)).toEqual([]);
  });

  it("references only canonical definitions", () => {
    expect(validateEngineeringDnaProfile(largeWheelLoaderEngineeringDna, largeWheelLoaderTemplate, [])).toEqual([]);
  });

  it("is available through the canonical registry", () => {
    expect(getAssetClassTemplate(largeWheelLoaderTemplate.code)).toBe(largeWheelLoaderTemplate);
  });

  it("creates a governed customer twin", () => {
    const twin = instantiateEngineeringTwin(largeWheelLoaderEngineeringDna, {
      assetId: "WL-001",
      siteId: "SITE-001",
    });
    expect(twin.assetClassCode).toBe(largeWheelLoaderTemplate.code);
    expect(twin.customerOverrides.approvalRequired).toBe(true);
  });

  it("keeps operational autonomy disabled", () => {
    expect(largeWheelLoaderEngineeringDna.governance.autonomousOperationalActionAllowed).toBe(false);
    expect(largeWheelLoaderEngineeringDna.governance.thresholdsPolicy).toBe("approved_source_only");
  });
});
