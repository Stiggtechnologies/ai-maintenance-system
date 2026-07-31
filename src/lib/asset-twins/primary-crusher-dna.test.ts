import { describe, expect, it } from "vitest";
import {
  engineeringDnaLibrary,
  getAssetClassTemplate,
  getEngineeringDnaForAssetClass,
  getEngineeringDnaProfile,
  instantiateEngineeringTwin,
  primaryCrusherEngineeringDna,
  primaryCrusherTemplate,
  validateAssetClassTemplate,
} from "./index";

describe("primary crusher Digital Engineering DNA", () => {
  it("validates the canonical hierarchy", () => {
    expect(validateAssetClassTemplate(primaryCrusherTemplate)).toEqual([]);
    expect(new Set(primaryCrusherTemplate.components.map((component) => component.code)).size).toBe(
      primaryCrusherTemplate.components.length,
    );
  });

  it("references only canonical components and failure modes", () => {
    const components = new Set(primaryCrusherTemplate.components.map((component) => component.code));
    const failures = new Set(
      primaryCrusherTemplate.components.flatMap((component) => component.failureModes.map((failure) => failure.code)),
    );
    expect(primaryCrusherEngineeringDna.componentCodes.every((code) => components.has(code))).toBe(true);
    expect(primaryCrusherEngineeringDna.failureModeCodes.every((code) => failures.has(code))).toBe(true);
  });

  it("registers every production-shaped DNA profile without duplicate asset classes", () => {
    expect(getEngineeringDnaProfile(primaryCrusherEngineeringDna.code)).toBe(primaryCrusherEngineeringDna);
    expect(getEngineeringDnaForAssetClass(primaryCrusherTemplate.code)).toBe(primaryCrusherEngineeringDna);
    expect(new Set(engineeringDnaLibrary.map((profile) => profile.assetClassCode)).size).toBe(engineeringDnaLibrary.length);
  });

  it("creates a governed customer twin", () => {
    const twin = instantiateEngineeringTwin(primaryCrusherEngineeringDna, {
      assetId: "crusher-01",
      siteId: "mine-a",
      manufacturer: "customer-defined",
    });
    expect(twin.assetClassCode).toBe(primaryCrusherTemplate.code);
    expect(twin.customerOverrides.approvalRequired).toBe(true);
    expect(primaryCrusherEngineeringDna.governance.autonomousOperationalActionAllowed).toBe(false);
    expect(primaryCrusherEngineeringDna.governance.thresholdsPolicy).toBe("approved_source_only");
    expect(getAssetClassTemplate(primaryCrusherTemplate.code)).toBe(primaryCrusherTemplate);
  });
});
