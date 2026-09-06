import { describe, expect, it } from "vitest";
import { compileAssetTwin } from "./compiler";
import {
  getEngineeringDnaForAssetClass,
  getEngineeringDnaProfile,
} from "./electric-rope-shovel-dna";
import {
  instantiateEngineeringTwin,
  validateEngineeringDnaProfile,
} from "./engineering-dna";
import { hydraulicMiningShovelTemplate } from "./hydraulic-mining-shovel";
import { getAssetClassTemplate, validateAssetClassTemplate } from "./index";
import { validateInspectionZoneContract } from "./inspection-contracts";
import { miningDozerEngineeringDna } from "./mining-dozer-dna";
import { miningDozerInspectionZones } from "./mining-dozer-inspections";
import { miningDozerTemplate } from "./mining-dozer";
import { inheritSharedIntelligence } from "./shared-component-dna";
import {
  centrifugalPumpComponentDna,
  hydraulicCylinderDna,
  industrialGearboxComponentDna,
  rollingElementBearingDna,
  sharedComponentDnaLibrary,
} from "./shared-component-dna-library";
import { ultraClassHaulTruckTemplate } from "./ultra-class-haul-truck";

const thresholdClaim =
  /\b\d+(\.\d+)?\s*(°|deg|rpm|mm|psi|bar|hz|hours?|days?)\b/i;

describe("mining-dozer Digital Engineering DNA", () => {
  it("keeps the canonical hierarchy valid and locally identified", () => {
    expect(validateAssetClassTemplate(miningDozerTemplate)).toEqual([]);
    expect(miningDozerTemplate.reviewState).toBe("draft");
    expect(
      new Set(
        miningDozerTemplate.components.map((component) => component.code),
      ).size,
    ).toBe(miningDozerTemplate.components.length);
    expect(
      new Set(
        miningDozerTemplate.components.flatMap((component) =>
          component.failureModes.map((failure) => failure.code),
        ),
      ).size,
    ).toBe(
      miningDozerTemplate.components.flatMap(
        (component) => component.failureModes,
      ).length,
    );
    expect(miningDozerTemplate.code).toBe("MIN-DOZER");
    expect(miningDozerTemplate.code).not.toBe(ultraClassHaulTruckTemplate.code);
    expect(miningDozerTemplate.components.map((component) => component.code)).not.toEqual(
      expect.arrayContaining(["HT-DRIVE", "WL-HYD", "HMS-HYD"]),
    );
  });

  it("reuses haul and hydraulic-shovel shared DNA instead of copying those templates", () => {
    const undercarriage = miningDozerTemplate.components.find(
      (component) => component.code === "DZ-UNDERCARRIAGE",
    );
    const hydraulics = miningDozerTemplate.components.find(
      (component) => component.code === "DZ-HYD",
    );
    const haulDrive = ultraClassHaulTruckTemplate.components.find(
      (component) => component.code === "HT-DRIVE",
    );
    const shovelHyd = hydraulicMiningShovelTemplate.components.find(
      (component) => component.code === "HMS-HYD",
    );
    const inheritedBearing = inheritSharedIntelligence(
      rollingElementBearingDna.code,
      sharedComponentDnaLibrary,
    );

    expect(undercarriage?.sharedComponentDnaCodes).toEqual(
      expect.arrayContaining([
        rollingElementBearingDna.code,
      ]),
    );
    expect(haulDrive?.sharedComponentDnaCodes).toEqual(
      expect.arrayContaining([
        rollingElementBearingDna.code,
        industrialGearboxComponentDna.code,
      ]),
    );
    expect(hydraulics?.sharedComponentDnaCodes).toEqual(
      expect.arrayContaining([
        hydraulicCylinderDna.code,
        centrifugalPumpComponentDna.code,
      ]),
    );
    expect(shovelHyd?.sharedComponentDnaCodes).toEqual(
      expect.arrayContaining([
        hydraulicCylinderDna.code,
        centrifugalPumpComponentDna.code,
      ]),
    );
    expect(undercarriage?.failureModes.map((failure) => failure.code)).not.toEqual(
      inheritedBearing?.failureReferenceCodes,
    );
    expect(undercarriage?.failureModes.map((failure) => failure.code)).not.toContain(
      "BEARING-FATIGUE",
    );
    expect(JSON.stringify(miningDozerTemplate)).not.toMatch(thresholdClaim);
  });

  it("keeps inspection contracts tied to canonical components and site approval", () => {
    const componentCodes = new Set(
      miningDozerTemplate.components.map((component) => component.code),
    );
    for (const contract of miningDozerInspectionZones) {
      expect(validateInspectionZoneContract(contract, componentCodes)).toEqual(
        [],
      );
      expect(contract.safety.siteApprovalRequired).toBe(true);
      expect(contract.reviewState).toBe("draft");
    }
  });

  it("keeps DNA and shared-component references canonical and governed", () => {
    expect(
      validateEngineeringDnaProfile(
        miningDozerEngineeringDna,
        miningDozerTemplate,
        miningDozerInspectionZones,
        sharedComponentDnaLibrary,
      ),
    ).toEqual([]);
    expect(miningDozerEngineeringDna.capabilities).toContain(
      "shared_component_composition",
    );
    expect(
      miningDozerEngineeringDna.sharedComponentBindings?.length,
    ).toBeGreaterThanOrEqual(10);
    expect(miningDozerEngineeringDna.governance.thresholdsPolicy).toBe(
      "approved_source_only",
    );
    expect(
      miningDozerEngineeringDna.governance.autonomousOperationalActionAllowed,
    ).toBe(false);
    expect(
      miningDozerEngineeringDna.governance.engineeringApprovalRequired,
    ).toBe(true);
  });

  it("supports registry lookup and governed twin creation without copying definitions", () => {
    expect(getAssetClassTemplate(miningDozerTemplate.code)).toBe(
      miningDozerTemplate,
    );
    expect(getEngineeringDnaProfile(miningDozerEngineeringDna.code)).toBe(
      miningDozerEngineeringDna,
    );
    expect(getEngineeringDnaForAssetClass(miningDozerTemplate.code)).toBe(
      miningDozerEngineeringDna,
    );
    const twin = instantiateEngineeringTwin(miningDozerEngineeringDna, {
      assetId: "DZ-001",
      siteId: "MINE-1",
    });
    expect(twin.assetClassCode).toBe(miningDozerTemplate.code);
    expect(twin.customerOverrides.approvalRequired).toBe(true);
    expect(twin.customerOverrides).not.toHaveProperty("components");
    expect(twin.customerOverrides).not.toHaveProperty("failureModes");
    expect(twin.customerOverrides.sharedComponentBindings).toEqual(
      miningDozerEngineeringDna.sharedComponentBindings,
    );
  });

  it("compiles deterministically and records shared references in provenance", () => {
    const compiledA = compileAssetTwin(
      miningDozerTemplate,
      {
        assetId: "DZ-001",
        assetClassCode: miningDozerTemplate.code,
        siteId: "MINE-1",
        operatingContext: {},
        telemetryMap: {},
        customerOverrides: {},
        baselineStatus: "not_started",
      },
      undefined,
      new Date("2026-09-06T00:00:00.000Z"),
      miningDozerEngineeringDna,
    );
    const compiledB = compileAssetTwin(
      miningDozerTemplate,
      {
        assetId: "DZ-001",
        assetClassCode: miningDozerTemplate.code,
        siteId: "MINE-1",
        operatingContext: {},
        telemetryMap: {},
        customerOverrides: {},
        baselineStatus: "not_started",
      },
      undefined,
      new Date("2026-09-06T00:00:00.000Z"),
      miningDozerEngineeringDna,
    );

    expect(compiledA).toEqual(compiledB);
    expect(compiledA.compiledAt).toBe("2026-09-06T00:00:00.000Z");
    expect(compiledA.provenance.sharedComponentReferences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assetComponentCode: "DZ-UNDERCARRIAGE",
          sharedComponentDnaCode: rollingElementBearingDna.code,
          reviewState: "draft",
        }),
      ]),
    );
    expect(
      compiledA.template.components
        .flatMap((component) => component.failureModes)
        .map((failure) => failure.code),
    ).not.toContain("BEARING-FATIGUE");
  });

  it("rejects an unknown shared-component endpoint", () => {
    const invalid = {
      ...miningDozerEngineeringDna,
      sharedComponentBindings: [
        ...(miningDozerEngineeringDna.sharedComponentBindings ?? []),
        {
          assetComponentCode: "DZ-DRIVE",
          sharedComponentDnaCode: "COMP-DNA-UNKNOWN",
          role: "invalid test binding",
        },
      ],
    };
    expect(
      validateEngineeringDnaProfile(
        invalid,
        miningDozerTemplate,
        miningDozerInspectionZones,
        sharedComponentDnaLibrary,
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: expect.stringContaining("sharedComponentDnaCode"),
        }),
      ]),
    );
  });
});
