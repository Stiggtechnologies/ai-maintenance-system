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
import { getAssetClassTemplate, validateAssetClassTemplate } from "./index";
import { validateInspectionZoneContract } from "./inspection-contracts";
import { miningDozerTemplate } from "./mining-dozer";
import { miningGraderEngineeringDna } from "./mining-grader-dna";
import { miningGraderInspectionZones } from "./mining-grader-inspections";
import { miningGraderTemplate } from "./mining-grader";
import { inheritSharedIntelligence } from "./shared-component-dna";
import {
  frictionBrakeDna,
  hydraulicCylinderDna,
  industrialGearboxComponentDna,
  rollingElementBearingDna,
  sharedComponentDnaLibrary,
} from "./shared-component-dna-library";
import { ultraClassHaulTruckTemplate } from "./ultra-class-haul-truck";

const thresholdClaim =
  /\b\d+(\.\d+)?\s*(°|deg|rpm|mm|psi|bar|hz|hours?|days?)\b/i;

describe("mining-grader Digital Engineering DNA", () => {
  it("keeps the canonical hierarchy valid and locally identified", () => {
    expect(validateAssetClassTemplate(miningGraderTemplate)).toEqual([]);
    expect(miningGraderTemplate.reviewState).toBe("draft");
    expect(
      new Set(
        miningGraderTemplate.components.map((component) => component.code),
      ).size,
    ).toBe(miningGraderTemplate.components.length);
    expect(
      new Set(
        miningGraderTemplate.components.flatMap((component) =>
          component.failureModes.map((failure) => failure.code),
        ),
      ).size,
    ).toBe(
      miningGraderTemplate.components.flatMap(
        (component) => component.failureModes,
      ).length,
    );
    expect(miningGraderTemplate.code).toBe("MIN-GRADER");
    expect(miningGraderTemplate.code).not.toBe(miningDozerTemplate.code);
    expect(miningGraderTemplate.components.map((component) => component.code)).not.toEqual(
      expect.arrayContaining(["DZ-UNDERCARRIAGE", "WL-HYD", "HT-STEER-SUSP"]),
    );
  });

  it("reuses dozer, haul, and wheel-loader shared DNA without copying those classes", () => {
    const circle = miningGraderTemplate.components.find(
      (component) => component.code === "GR-CIRCLE-BLADE",
    );
    const drive = miningGraderTemplate.components.find(
      (component) => component.code === "GR-DRIVE",
    );
    const brakes = miningGraderTemplate.components.find(
      (component) => component.code === "GR-BRAKE",
    );
    const dozerHyd = miningDozerTemplate.components.find(
      (component) => component.code === "DZ-HYD",
    );
    const haulBrake = ultraClassHaulTruckTemplate.components.find(
      (component) => component.code === "HT-BRAKE",
    );
    const inheritedCylinder = inheritSharedIntelligence(
      hydraulicCylinderDna.code,
      sharedComponentDnaLibrary,
    );

    expect(circle?.sharedComponentDnaCodes).toEqual(
      expect.arrayContaining([hydraulicCylinderDna.code]),
    );
    expect(dozerHyd?.sharedComponentDnaCodes).toEqual(
      expect.arrayContaining([hydraulicCylinderDna.code]),
    );
    expect(drive?.sharedComponentDnaCodes).toEqual(
      expect.arrayContaining([
        industrialGearboxComponentDna.code,
        rollingElementBearingDna.code,
      ]),
    );
    expect(brakes?.sharedComponentDnaCodes).toEqual(
      expect.arrayContaining([frictionBrakeDna.code]),
    );
    expect(haulBrake?.sharedComponentDnaCodes).toEqual(
      expect.arrayContaining([frictionBrakeDna.code]),
    );
    expect(circle?.failureModes.map((failure) => failure.code)).not.toEqual(
      inheritedCylinder?.failureReferenceCodes,
    );
    expect(JSON.stringify(miningGraderTemplate)).not.toMatch(thresholdClaim);
  });

  it("keeps inspection contracts tied to canonical components and site approval", () => {
    const componentCodes = new Set(
      miningGraderTemplate.components.map((component) => component.code),
    );
    for (const contract of miningGraderInspectionZones) {
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
        miningGraderEngineeringDna,
        miningGraderTemplate,
        miningGraderInspectionZones,
        sharedComponentDnaLibrary,
      ),
    ).toEqual([]);
    expect(miningGraderEngineeringDna.capabilities).toContain(
      "shared_component_composition",
    );
    expect(
      miningGraderEngineeringDna.sharedComponentBindings?.length,
    ).toBeGreaterThanOrEqual(8);
    expect(miningGraderEngineeringDna.governance.thresholdsPolicy).toBe(
      "approved_source_only",
    );
    expect(
      miningGraderEngineeringDna.governance.autonomousOperationalActionAllowed,
    ).toBe(false);
    expect(
      miningGraderEngineeringDna.governance.engineeringApprovalRequired,
    ).toBe(true);
  });

  it("supports registry lookup and governed twin creation without copying definitions", () => {
    expect(getAssetClassTemplate(miningGraderTemplate.code)).toBe(
      miningGraderTemplate,
    );
    expect(getEngineeringDnaProfile(miningGraderEngineeringDna.code)).toBe(
      miningGraderEngineeringDna,
    );
    expect(getEngineeringDnaForAssetClass(miningGraderTemplate.code)).toBe(
      miningGraderEngineeringDna,
    );
    const twin = instantiateEngineeringTwin(miningGraderEngineeringDna, {
      assetId: "GR-001",
      siteId: "MINE-1",
    });
    expect(twin.assetClassCode).toBe(miningGraderTemplate.code);
    expect(twin.customerOverrides.approvalRequired).toBe(true);
    expect(twin.customerOverrides).not.toHaveProperty("components");
    expect(twin.customerOverrides).not.toHaveProperty("failureModes");
    expect(twin.customerOverrides.sharedComponentBindings).toEqual(
      miningGraderEngineeringDna.sharedComponentBindings,
    );
  });

  it("compiles deterministically and records shared references in provenance", () => {
    const compiledA = compileAssetTwin(
      miningGraderTemplate,
      {
        assetId: "GR-001",
        assetClassCode: miningGraderTemplate.code,
        siteId: "MINE-1",
        operatingContext: {},
        telemetryMap: {},
        customerOverrides: {},
        baselineStatus: "not_started",
      },
      undefined,
      new Date("2026-09-06T00:00:00.000Z"),
      miningGraderEngineeringDna,
    );
    const compiledB = compileAssetTwin(
      miningGraderTemplate,
      {
        assetId: "GR-001",
        assetClassCode: miningGraderTemplate.code,
        siteId: "MINE-1",
        operatingContext: {},
        telemetryMap: {},
        customerOverrides: {},
        baselineStatus: "not_started",
      },
      undefined,
      new Date("2026-09-06T00:00:00.000Z"),
      miningGraderEngineeringDna,
    );

    expect(compiledA).toEqual(compiledB);
    expect(compiledA.compiledAt).toBe("2026-09-06T00:00:00.000Z");
    expect(compiledA.provenance.sharedComponentReferences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assetComponentCode: "GR-CIRCLE-BLADE",
          sharedComponentDnaCode: hydraulicCylinderDna.code,
          reviewState: "draft",
        }),
      ]),
    );
    expect(
      compiledA.template.components
        .flatMap((component) => component.failureModes)
        .map((failure) => failure.code),
    ).not.toContain("CYLINDER-SEAL-LEAK");
  });

  it("rejects an unknown shared-component endpoint", () => {
    const invalid = {
      ...miningGraderEngineeringDna,
      sharedComponentBindings: [
        ...(miningGraderEngineeringDna.sharedComponentBindings ?? []),
        {
          assetComponentCode: "GR-DRIVE",
          sharedComponentDnaCode: "COMP-DNA-UNKNOWN",
          role: "invalid test binding",
        },
      ],
    };
    expect(
      validateEngineeringDnaProfile(
        invalid,
        miningGraderTemplate,
        miningGraderInspectionZones,
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
