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
import { inheritSharedIntelligence } from "./shared-component-dna";
import {
  industrialAcMotorDna,
  rollingElementBearingDna,
  sharedComponentDnaLibrary,
} from "./shared-component-dna-library";
import { stackerReclaimerEngineeringDna } from "./stacker-reclaimer-dna";
import { stackerReclaimerInspectionZones } from "./stacker-reclaimer-inspections";
import { stackerReclaimerTemplate } from "./stacker-reclaimer";
import { conveyorSystemTemplate } from "./conveyor-system";

const thresholdClaim =
  /\b\d+(\.\d+)?\s*(°|deg|rpm|mm|psi|bar|hz|hours?|days?)\b/i;

describe("stacker-reclaimer Digital Engineering DNA", () => {
  it("keeps the canonical hierarchy valid and locally identified", () => {
    expect(validateAssetClassTemplate(stackerReclaimerTemplate)).toEqual([]);
    expect(stackerReclaimerTemplate.reviewState).toBe("draft");
    expect(
      new Set(
        stackerReclaimerTemplate.components.map((component) => component.code),
      ).size,
    ).toBe(stackerReclaimerTemplate.components.length);
    expect(
      new Set(
        stackerReclaimerTemplate.components.flatMap((component) =>
          component.failureModes.map((failure) => failure.code),
        ),
      ).size,
    ).toBe(
      stackerReclaimerTemplate.components.flatMap(
        (component) => component.failureModes,
      ).length,
    );
    expect(stackerReclaimerTemplate.code).toBe("MIN-STACK-RECLAIM");
    expect(stackerReclaimerTemplate.code).not.toBe(conveyorSystemTemplate.code);
  });

  it("references shared component DNA instead of copying conveyor or motor intelligence", () => {
    const boomConveyor = stackerReclaimerTemplate.components.find(
      (component) => component.code === "SR-BOOM-CONV",
    );
    const inheritedBearing = inheritSharedIntelligence(
      rollingElementBearingDna.code,
      sharedComponentDnaLibrary,
    );

    expect(boomConveyor?.sharedComponentDnaCodes).toEqual(
      expect.arrayContaining([
        rollingElementBearingDna.code,
        industrialAcMotorDna.code,
      ]),
    );
    expect(boomConveyor?.failureModes.map((failure) => failure.code)).not.toEqual(
      inheritedBearing?.failureReferenceCodes,
    );
    expect(boomConveyor?.failureModes.map((failure) => failure.code)).not.toContain(
      "BEARING-FATIGUE",
    );
    expect(JSON.stringify(stackerReclaimerTemplate)).not.toMatch(thresholdClaim);
  });

  it("keeps inspection contracts tied to canonical components and site approval", () => {
    const componentCodes = new Set(
      stackerReclaimerTemplate.components.map((component) => component.code),
    );
    for (const contract of stackerReclaimerInspectionZones) {
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
        stackerReclaimerEngineeringDna,
        stackerReclaimerTemplate,
        stackerReclaimerInspectionZones,
        sharedComponentDnaLibrary,
      ),
    ).toEqual([]);
    expect(stackerReclaimerEngineeringDna.capabilities).toContain(
      "shared_component_composition",
    );
    expect(
      stackerReclaimerEngineeringDna.sharedComponentBindings?.length,
    ).toBeGreaterThanOrEqual(20);
    expect(stackerReclaimerEngineeringDna.governance.thresholdsPolicy).toBe(
      "approved_source_only",
    );
    expect(
      stackerReclaimerEngineeringDna.governance
        .autonomousOperationalActionAllowed,
    ).toBe(false);
    expect(
      stackerReclaimerEngineeringDna.governance.engineeringApprovalRequired,
    ).toBe(true);
  });

  it("supports registry lookup and governed twin creation without copying definitions", () => {
    expect(getAssetClassTemplate(stackerReclaimerTemplate.code)).toBe(
      stackerReclaimerTemplate,
    );
    expect(getEngineeringDnaProfile(stackerReclaimerEngineeringDna.code)).toBe(
      stackerReclaimerEngineeringDna,
    );
    expect(getEngineeringDnaForAssetClass(stackerReclaimerTemplate.code)).toBe(
      stackerReclaimerEngineeringDna,
    );
    const twin = instantiateEngineeringTwin(stackerReclaimerEngineeringDna, {
      assetId: "SR-001",
      siteId: "YARD-1",
    });
    expect(twin.assetClassCode).toBe(stackerReclaimerTemplate.code);
    expect(twin.customerOverrides.approvalRequired).toBe(true);
    expect(twin.customerOverrides).not.toHaveProperty("components");
    expect(twin.customerOverrides).not.toHaveProperty("failureModes");
    expect(twin.customerOverrides.sharedComponentBindings).toEqual(
      stackerReclaimerEngineeringDna.sharedComponentBindings,
    );
  });

  it("compiles deterministically and records shared references in provenance", () => {
    const compiledA = compileAssetTwin(
      stackerReclaimerTemplate,
      {
        assetId: "SR-001",
        assetClassCode: stackerReclaimerTemplate.code,
        siteId: "YARD-1",
        operatingContext: {},
        telemetryMap: {},
        customerOverrides: {},
        baselineStatus: "not_started",
      },
      undefined,
      new Date("2026-09-06T00:00:00.000Z"),
      stackerReclaimerEngineeringDna,
    );
    const compiledB = compileAssetTwin(
      stackerReclaimerTemplate,
      {
        assetId: "SR-001",
        assetClassCode: stackerReclaimerTemplate.code,
        siteId: "YARD-1",
        operatingContext: {},
        telemetryMap: {},
        customerOverrides: {},
        baselineStatus: "not_started",
      },
      undefined,
      new Date("2026-09-06T00:00:00.000Z"),
      stackerReclaimerEngineeringDna,
    );

    expect(compiledA).toEqual(compiledB);
    expect(compiledA.compiledAt).toBe("2026-09-06T00:00:00.000Z");
    expect(compiledA.provenance.sharedComponentReferences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assetComponentCode: "SR-BOOM-CONV",
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
      ...stackerReclaimerEngineeringDna,
      sharedComponentBindings: [
        ...(stackerReclaimerEngineeringDna.sharedComponentBindings ?? []),
        {
          assetComponentCode: "SR-SLEW",
          sharedComponentDnaCode: "COMP-DNA-UNKNOWN",
          role: "invalid test binding",
        },
      ],
    };
    expect(
      validateEngineeringDnaProfile(
        invalid,
        stackerReclaimerTemplate,
        stackerReclaimerInspectionZones,
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
