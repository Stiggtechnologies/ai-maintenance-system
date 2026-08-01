import { describe, expect, it } from "vitest";
import { conveyorSystemEngineeringDna } from "./conveyor-system-dna";
import { conveyorSystemInspectionZones } from "./conveyor-system-inspections";
import { conveyorSystemTemplate } from "./conveyor-system";
import { getEngineeringDnaForAssetClass } from "./electric-rope-shovel-dna";
import { instantiateEngineeringTwin, validateEngineeringDnaProfile } from "./engineering-dna";
import { getAssetClassTemplate, validateAssetClassTemplate } from "./index";
import { validateInspectionZoneContract } from "./inspection-contracts";
import { sharedComponentDnaLibrary } from "./shared-component-dna-library";

describe("conveyor system Digital Engineering DNA", () => {
  it("keeps the canonical asset hierarchy valid", () => {
    expect(validateAssetClassTemplate(conveyorSystemTemplate)).toEqual([]);
    expect(new Set(conveyorSystemTemplate.components.map((component) => component.code)).size).toBe(conveyorSystemTemplate.components.length);
  });

  it("keeps all inspection contracts tied to canonical components and site approval", () => {
    const componentCodes = new Set(conveyorSystemTemplate.components.map((component) => component.code));
    for (const contract of conveyorSystemInspectionZones) {
      expect(validateInspectionZoneContract(contract, componentCodes)).toEqual([]);
      expect(contract.safety.siteApprovalRequired).toBe(true);
    }
  });

  it("keeps DNA and shared-component references canonical and governed", () => {
    expect(
      validateEngineeringDnaProfile(
        conveyorSystemEngineeringDna,
        conveyorSystemTemplate,
        conveyorSystemInspectionZones,
        sharedComponentDnaLibrary,
      ),
    ).toEqual([]);
    expect(conveyorSystemEngineeringDna.capabilities).toContain("shared_component_composition");
    expect(conveyorSystemEngineeringDna.sharedComponentBindings).toHaveLength(5);
    expect(conveyorSystemEngineeringDna.governance.thresholdsPolicy).toBe("approved_source_only");
    expect(conveyorSystemEngineeringDna.governance.autonomousOperationalActionAllowed).toBe(false);
  });

  it("supports registry lookup and governed twin creation with component composition", () => {
    expect(getAssetClassTemplate(conveyorSystemTemplate.code)).toBe(conveyorSystemTemplate);
    expect(getEngineeringDnaForAssetClass(conveyorSystemTemplate.code)).toBe(conveyorSystemEngineeringDna);
    const twin = instantiateEngineeringTwin(conveyorSystemEngineeringDna, { assetId: "CV-101", siteId: "SITE-1" });
    expect(twin.assetClassCode).toBe(conveyorSystemTemplate.code);
    expect(twin.customerOverrides.approvalRequired).toBe(true);
    expect(twin.customerOverrides.sharedComponentBindings).toEqual(conveyorSystemEngineeringDna.sharedComponentBindings);
  });

  it("rejects an unknown shared-component endpoint", () => {
    const invalid = {
      ...conveyorSystemEngineeringDna,
      sharedComponentBindings: [
        ...(conveyorSystemEngineeringDna.sharedComponentBindings ?? []),
        {
          assetComponentCode: "CV-DRIVE",
          sharedComponentDnaCode: "COMP-DNA-UNKNOWN",
          role: "invalid test binding",
        },
      ],
    };
    expect(
      validateEngineeringDnaProfile(invalid, conveyorSystemTemplate, conveyorSystemInspectionZones, sharedComponentDnaLibrary),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: expect.stringContaining("sharedComponentDnaCode") }),
      ]),
    );
  });
});
