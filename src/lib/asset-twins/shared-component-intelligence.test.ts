import { describe, expect, it } from "vitest";
import { compileAssetTwin } from "./compiler";
import { centrifugalPumpTemplate } from "./centrifugal-pump";
import { conveyorSystemTemplate } from "./conveyor-system";
import { draglineTemplate } from "./dragline";
import { electricMotorTemplate } from "./electric-motor";
import { hydraulicMiningShovelTemplate } from "./hydraulic-mining-shovel";
import { industrialGearboxTemplate } from "./industrial-gearbox";
import { electricRopeShovelTemplate } from "./mining-library";
import { primaryCrusherTemplate } from "./primary-crusher";
import { physicsCapabilityLibrary } from "./physics-capability-library";
import {
  inheritSharedIntelligence,
  requiredSharedComponentCategories,
  validateSharedComponentDna,
} from "./shared-component-dna";
import {
  centrifugalPumpComponentDna,
  coolingSystemDna,
  frictionBrakeDna,
  getSharedComponentDna,
  hydraulicCylinderDna,
  industrialAcMotorDna,
  industrialGearboxComponentDna,
  lubricationSystemDna,
  rollingElementBearingDna,
  sheaveDna,
  sharedComponentDnaLibrary,
  switchgearDna,
  transformerDna,
  variableFrequencyDriveDna,
  wireRopeDna,
} from "./shared-component-dna-library";
import type { AssetClassTemplate } from "./types";
import { ultraClassHaulTruckTemplate } from "./ultra-class-haul-truck";
import { ballMillTemplate } from "./ball-mill";
import { blastholeDrillTemplate } from "./blasthole-drill";
import { largeWheelLoaderTemplate } from "./large-wheel-loader";
import { sagMillTemplate } from "./sag-mill";
import { thickenerTemplate } from "./thickener";
import { validateAssetClassTemplate } from "./index";

const referencedTemplates: AssetClassTemplate[] = [
  electricRopeShovelTemplate,
  hydraulicMiningShovelTemplate,
  ultraClassHaulTruckTemplate,
  draglineTemplate,
  electricMotorTemplate,
  industrialGearboxTemplate,
  centrifugalPumpTemplate,
  conveyorSystemTemplate,
  primaryCrusherTemplate,
];

const remainingEmbeddedTemplates: AssetClassTemplate[] = [
  ballMillTemplate,
  sagMillTemplate,
  thickenerTemplate,
  blastholeDrillTemplate,
  largeWheelLoaderTemplate,
];

const requiredProfiles = [
  rollingElementBearingDna,
  industrialAcMotorDna,
  industrialGearboxComponentDna,
  frictionBrakeDna,
  wireRopeDna,
  sheaveDna,
  centrifugalPumpComponentDna,
  hydraulicCylinderDna,
  coolingSystemDna,
  lubricationSystemDna,
  switchgearDna,
  variableFrequencyDriveDna,
  transformerDna,
];

/** Asset-class components that still embed local copies and are scheduled for later reference migration. */
const pendingEmbeddedCopies = [
  "MIN-WHEEL-LOADER:WL-BRAKE-STEER",
  "MIN-WHEEL-LOADER:WL-POWER",
  "PROC-BALL-MILL:BM-DRIVE",
  "PROC-BALL-MILL:BM-LUBE-JACK-COOL",
  "PROC-BALL-MILL:BM-TRUNNION-BEARING",
  "PROC-SAG-MILL:SAG-DRIVE",
  "PROC-SAG-MILL:SAG-LUBE-COOL",
  "PROC-SAG-MILL:SAG-TRUNNION-BEARING",
  "PROC-THICKENER:THK-DRIVE",
  "PROC-THICKENER:THK-LUBE-HYD",
  "PROC-THICKENER:THK-UNDERFLOW",
].sort();

const thresholdClaim =
  /\b\d+(\.\d+)?\s*(°|deg|rpm|mm|psi|bar|hz|hours?|days?)\b/i;

function templateComponents(templates: AssetClassTemplate[]) {
  return templates.flatMap((template) =>
    template.components.map((component) => ({ template, component })),
  );
}

describe("shared component intelligence library", () => {
  it("covers the required manufacturer-neutral component classes", () => {
    expect(
      validateSharedComponentDna(
        sharedComponentDnaLibrary,
        physicsCapabilityLibrary,
      ),
    ).toEqual([]);
    for (const category of requiredSharedComponentCategories) {
      expect(
        sharedComponentDnaLibrary.some(
          (profile) => profile.category === category,
        ),
      ).toBe(true);
    }
    for (const profile of requiredProfiles) {
      expect(getSharedComponentDna(profile.code)).toBe(profile);
    }
    expect(
      getSharedComponentDna("COMP-DNA-BEARING-ROLLING")?.schemaVersion,
    ).toBe("0.2.0");
    expect(
      getSharedComponentDna("COMP-DNA-COUPLING-FLEXIBLE")?.schemaVersion,
    ).toBe("0.2.0");
    expect(getSharedComponentDna("COMP-DNA-SEAL-MECHANICAL")?.schemaVersion).toBe(
      "0.1.0",
    );
    expect(
      getSharedComponentDna("COMP-DNA-LUBRICATION-SYSTEM")?.schemaVersion,
    ).toBe("0.1.0");
  });

  it("keeps shared failure identities unique and distinct from asset-class failure codes", () => {
    const sharedFailureCodes = sharedComponentDnaLibrary.flatMap((profile) =>
      profile.failureReferences.map((failure) => failure.code),
    );
    expect(new Set(sharedFailureCodes).size).toBe(sharedFailureCodes.length);

    const assetFailureCodes = templateComponents([
      ...referencedTemplates,
      ...remainingEmbeddedTemplates,
    ]).flatMap(({ component }) =>
      component.failureModes.map((failure) => failure.code),
    );
    for (const code of sharedFailureCodes) {
      expect(assetFailureCodes).not.toContain(code);
    }
  });

  it("does not invent numeric engineering thresholds or authorize work", () => {
    const serialized = JSON.stringify(sharedComponentDnaLibrary);
    expect(serialized).not.toMatch(thresholdClaim);
    expect(serialized).not.toMatch(/replace after/i);
    expect(serialized).not.toMatch(/alarm limit/i);
    for (const profile of sharedComponentDnaLibrary) {
      expect(profile.governance.reviewState).toBe("draft");
      expect(profile.governance.autonomousOperationalActionAllowed).toBe(false);
      expect(profile.governance.recommendDoesNotAuthorize).toBe(true);
      expect(profile.evidence).toEqual([]);
    }
  });

  it("lets asset templates reference shared intelligence without copying it", () => {
    for (const template of referencedTemplates) {
      expect(validateAssetClassTemplate(template)).toEqual([]);
      expect(
        template.components.some(
          (component) => (component.sharedComponentDnaCodes ?? []).length > 0,
        ),
      ).toBe(true);
    }

    const compiled = compileAssetTwin(electricMotorTemplate, {
      assetId: "MTR-REF",
      assetClassCode: electricMotorTemplate.code,
      siteId: "SITE-1",
      operatingContext: {},
      telemetryMap: {},
      customerOverrides: {},
      baselineStatus: "not_started",
    });
    const inherited = inheritSharedIntelligence(
      rollingElementBearingDna.code,
      sharedComponentDnaLibrary,
    );
    const bearing = compiled.template.components.find(
      (component) => component.code === "EM-BEARING",
    );

    expect(bearing?.sharedComponentDnaCodes).toContain(
      rollingElementBearingDna.code,
    );
    expect(bearing?.failureModes.map((failure) => failure.code)).not.toEqual(
      inherited?.failureReferenceCodes,
    );
    expect(compiled.provenance.sharedComponentReferences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assetComponentCode: "EM-BEARING",
          sharedComponentDnaCode: rollingElementBearingDna.code,
          reviewState: "draft",
        }),
      ]),
    );
  });

  it("names remaining embedded copies instead of silently treating them as shared DNA", () => {
    const residuals = templateComponents(remainingEmbeddedTemplates)
      .filter(({ component }) => {
        const name = `${component.name} ${component.code}`.toLowerCase();
        return /bearing|gearbox|brake|wire.?rope|sheave|motor|cylinder|switchgear|transformer|vfd|cooling|lubricat|pump/.test(
          name,
        );
      })
      .map(({ template, component }) => `${template.code}:${component.code}`)
      .sort();

    expect(residuals).toEqual(pendingEmbeddedCopies);
    for (const { component } of templateComponents(
      remainingEmbeddedTemplates,
    )) {
      expect(component.sharedComponentDnaCodes ?? []).toEqual([]);
    }
  });
});
