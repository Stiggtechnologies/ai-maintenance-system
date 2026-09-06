import { describe, expect, it } from "vitest";
import { compileAssetTwin } from "./compiler";
import { conveyorSystemTemplate } from "./conveyor-system";
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
import { mobileCrusherEngineeringDna } from "./mobile-crusher-dna";
import { mobileCrusherInspectionZones } from "./mobile-crusher-inspections";
import { mobileCrusherTemplate } from "./mobile-crusher";
import { primaryCrusherTemplate } from "./primary-crusher";
import { inheritSharedIntelligence } from "./shared-component-dna";
import {
  flexibleCouplingDna,
  industrialAcMotorDna,
  rollingElementBearingDna,
  sharedComponentDnaLibrary,
} from "./shared-component-dna-library";

const thresholdClaim =
  /\b\d+(\.\d+)?\s*(°|deg|rpm|mm|psi|bar|hz|hours?|days?)\b/i;

describe("mobile-crusher Digital Engineering DNA", () => {
  it("keeps the canonical hierarchy valid and locally identified", () => {
    expect(validateAssetClassTemplate(mobileCrusherTemplate)).toEqual([]);
    expect(mobileCrusherTemplate.reviewState).toBe("draft");
    expect(
      new Set(
        mobileCrusherTemplate.components.map((component) => component.code),
      ).size,
    ).toBe(mobileCrusherTemplate.components.length);
    expect(
      new Set(
        mobileCrusherTemplate.components.flatMap((component) =>
          component.failureModes.map((failure) => failure.code),
        ),
      ).size,
    ).toBe(
      mobileCrusherTemplate.components.flatMap(
        (component) => component.failureModes,
      ).length,
    );
    expect(mobileCrusherTemplate.code).toBe("MIN-MOBILE-CRUSH");
    expect(mobileCrusherTemplate.code).not.toBe(primaryCrusherTemplate.code);
    expect(mobileCrusherTemplate.code).not.toBe(conveyorSystemTemplate.code);
    expect(mobileCrusherTemplate.components.map((component) => component.code)).not.toEqual(
      expect.arrayContaining(["PCR-DRIVE", "PCR-CRUSH", "CV-BELT", "CV-DRIVE"]),
    );
  });

  it("reuses primary-crusher and conveyor shared DNA instead of copying those templates", () => {
    const drive = mobileCrusherTemplate.components.find(
      (component) => component.code === "MC-DRIVE",
    );
    const feed = mobileCrusherTemplate.components.find(
      (component) => component.code === "MC-FEED-CONV",
    );
    const primaryDrive = primaryCrusherTemplate.components.find(
      (component) => component.code === "PCR-DRIVE",
    );
    const conveyorDrive = conveyorSystemTemplate.components.find(
      (component) => component.code === "CV-DRIVE",
    );
    const inheritedBearing = inheritSharedIntelligence(
      rollingElementBearingDna.code,
      sharedComponentDnaLibrary,
    );

    expect(drive?.sharedComponentDnaCodes).toEqual(
      expect.arrayContaining([
        rollingElementBearingDna.code,
        flexibleCouplingDna.code,
        industrialAcMotorDna.code,
      ]),
    );
    expect(primaryDrive?.sharedComponentDnaCodes).toEqual(
      expect.arrayContaining([
        rollingElementBearingDna.code,
        flexibleCouplingDna.code,
        industrialAcMotorDna.code,
      ]),
    );
    expect(feed?.sharedComponentDnaCodes).toEqual(
      expect.arrayContaining([
        rollingElementBearingDna.code,
        industrialAcMotorDna.code,
      ]),
    );
    expect(conveyorDrive?.sharedComponentDnaCodes).toEqual(
      expect.arrayContaining([
        rollingElementBearingDna.code,
        industrialAcMotorDna.code,
      ]),
    );
    expect(drive?.failureModes.map((failure) => failure.code)).not.toEqual(
      inheritedBearing?.failureReferenceCodes,
    );
    expect(drive?.failureModes.map((failure) => failure.code)).not.toContain(
      "BEARING-FATIGUE",
    );
    expect(JSON.stringify(mobileCrusherTemplate)).not.toMatch(thresholdClaim);
  });

  it("keeps inspection contracts tied to canonical components and site approval", () => {
    const componentCodes = new Set(
      mobileCrusherTemplate.components.map((component) => component.code),
    );
    for (const contract of mobileCrusherInspectionZones) {
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
        mobileCrusherEngineeringDna,
        mobileCrusherTemplate,
        mobileCrusherInspectionZones,
        sharedComponentDnaLibrary,
      ),
    ).toEqual([]);
    expect(mobileCrusherEngineeringDna.capabilities).toContain(
      "shared_component_composition",
    );
    expect(
      mobileCrusherEngineeringDna.sharedComponentBindings?.length,
    ).toBeGreaterThanOrEqual(18);
    expect(mobileCrusherEngineeringDna.governance.thresholdsPolicy).toBe(
      "approved_source_only",
    );
    expect(
      mobileCrusherEngineeringDna.governance.autonomousOperationalActionAllowed,
    ).toBe(false);
    expect(
      mobileCrusherEngineeringDna.governance.engineeringApprovalRequired,
    ).toBe(true);
  });

  it("supports registry lookup and governed twin creation without copying definitions", () => {
    expect(getAssetClassTemplate(mobileCrusherTemplate.code)).toBe(
      mobileCrusherTemplate,
    );
    expect(getEngineeringDnaProfile(mobileCrusherEngineeringDna.code)).toBe(
      mobileCrusherEngineeringDna,
    );
    expect(getEngineeringDnaForAssetClass(mobileCrusherTemplate.code)).toBe(
      mobileCrusherEngineeringDna,
    );
    const twin = instantiateEngineeringTwin(mobileCrusherEngineeringDna, {
      assetId: "MC-001",
      siteId: "PIT-1",
    });
    expect(twin.assetClassCode).toBe(mobileCrusherTemplate.code);
    expect(twin.customerOverrides.approvalRequired).toBe(true);
    expect(twin.customerOverrides).not.toHaveProperty("components");
    expect(twin.customerOverrides).not.toHaveProperty("failureModes");
    expect(twin.customerOverrides.sharedComponentBindings).toEqual(
      mobileCrusherEngineeringDna.sharedComponentBindings,
    );
  });

  it("compiles deterministically and records shared references in provenance", () => {
    const compiledA = compileAssetTwin(
      mobileCrusherTemplate,
      {
        assetId: "MC-001",
        assetClassCode: mobileCrusherTemplate.code,
        siteId: "PIT-1",
        operatingContext: {},
        telemetryMap: {},
        customerOverrides: {},
        baselineStatus: "not_started",
      },
      undefined,
      new Date("2026-09-06T00:00:00.000Z"),
      mobileCrusherEngineeringDna,
    );
    const compiledB = compileAssetTwin(
      mobileCrusherTemplate,
      {
        assetId: "MC-001",
        assetClassCode: mobileCrusherTemplate.code,
        siteId: "PIT-1",
        operatingContext: {},
        telemetryMap: {},
        customerOverrides: {},
        baselineStatus: "not_started",
      },
      undefined,
      new Date("2026-09-06T00:00:00.000Z"),
      mobileCrusherEngineeringDna,
    );

    expect(compiledA).toEqual(compiledB);
    expect(compiledA.compiledAt).toBe("2026-09-06T00:00:00.000Z");
    expect(compiledA.provenance.sharedComponentReferences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assetComponentCode: "MC-DRIVE",
          sharedComponentDnaCode: rollingElementBearingDna.code,
          reviewState: "draft",
        }),
        expect.objectContaining({
          assetComponentCode: "MC-DISCH-CONV",
          sharedComponentDnaCode: industrialAcMotorDna.code,
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
      ...mobileCrusherEngineeringDna,
      sharedComponentBindings: [
        ...(mobileCrusherEngineeringDna.sharedComponentBindings ?? []),
        {
          assetComponentCode: "MC-DRIVE",
          sharedComponentDnaCode: "COMP-DNA-UNKNOWN",
          role: "invalid test binding",
        },
      ],
    };
    expect(
      validateEngineeringDnaProfile(
        invalid,
        mobileCrusherTemplate,
        mobileCrusherInspectionZones,
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
