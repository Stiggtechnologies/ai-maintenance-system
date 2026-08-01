import { describe, expect, it } from "vitest";
import {
  engineeringDnaLibrary,
  getAssetClassTemplate,
  getEngineeringDnaForAssetClass,
  getEngineeringDnaProfile,
  instantiateEngineeringTwin,
  primaryCrusherEngineeringDna,
  primaryCrusherTemplate,
  sharedComponentDnaLibrary,
  validateAssetClassTemplate,
  validateEngineeringDnaProfile,
} from "./index";

describe("primary crusher Digital Engineering DNA", () => {
  it("validates the canonical hierarchy", () => {
    expect(validateAssetClassTemplate(primaryCrusherTemplate)).toEqual([]);
    expect(new Set(primaryCrusherTemplate.components.map((component) => component.code)).size).toBe(
      primaryCrusherTemplate.components.length,
    );
  });

  it("keeps shared component composition canonical and governed", () => {
    expect(
      validateEngineeringDnaProfile(
        primaryCrusherEngineeringDna,
        primaryCrusherTemplate,
        [],
        sharedComponentDnaLibrary,
      ),
    ).toEqual([]);
    expect(primaryCrusherEngineeringDna.capabilities).toContain("shared_component_composition");
    expect(primaryCrusherEngineeringDna.sharedComponentBindings).toHaveLength(3);
    expect(primaryCrusherEngineeringDna.governance.autonomousOperationalActionAllowed).toBe(false);
    expect(primaryCrusherEngineeringDna.governance.thresholdsPolicy).toBe("approved_source_only");
  });

  it("registers every production-shaped DNA profile without duplicate asset classes", () => {
    expect(getEngineeringDnaProfile(primaryCrusherEngineeringDna.code)).toBe(primaryCrusherEngineeringDna);
    expect(getEngineeringDnaForAssetClass(primaryCrusherTemplate.code)).toBe(primaryCrusherEngineeringDna);
    expect(new Set(engineeringDnaLibrary.map((profile) => profile.assetClassCode)).size).toBe(engineeringDnaLibrary.length);
  });

  it("carries shared components into a governed customer twin", () => {
    const twin = instantiateEngineeringTwin(primaryCrusherEngineeringDna, {
      assetId: "crusher-01",
      siteId: "mine-a",
      manufacturer: "customer-defined",
    });
    expect(twin.assetClassCode).toBe(primaryCrusherTemplate.code);
    expect(twin.customerOverrides.approvalRequired).toBe(true);
    expect(twin.customerOverrides.sharedComponentBindings).toEqual(
      primaryCrusherEngineeringDna.sharedComponentBindings,
    );
    expect(getAssetClassTemplate(primaryCrusherTemplate.code)).toBe(primaryCrusherTemplate);
  });

  it("rejects unknown shared component references", () => {
    const invalid = {
      ...primaryCrusherEngineeringDna,
      sharedComponentBindings: [
        ...(primaryCrusherEngineeringDna.sharedComponentBindings ?? []),
        {
          assetComponentCode: "PCR-DRIVE",
          sharedComponentDnaCode: "COMP-DNA-UNKNOWN",
          role: "invalid test binding",
        },
      ],
    };
    expect(
      validateEngineeringDnaProfile(invalid, primaryCrusherTemplate, [], sharedComponentDnaLibrary),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: expect.stringContaining("sharedComponentDnaCode") }),
      ]),
    );
  });
});
