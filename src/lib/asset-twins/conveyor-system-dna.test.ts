import { describe, expect, it } from "vitest";
import { conveyorSystemEngineeringDna } from "./conveyor-system-dna";
import { conveyorSystemInspectionZones } from "./conveyor-system-inspections";
import { conveyorSystemTemplate } from "./conveyor-system";
import { getEngineeringDnaForAssetClass } from "./electric-rope-shovel-dna";
import { instantiateEngineeringTwin, validateEngineeringDnaProfile } from "./engineering-dna";
import { getAssetClassTemplate, validateAssetClassTemplate } from "./index";
import { validateInspectionZoneContract } from "./inspection-contracts";

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

  it("keeps DNA references canonical and governed", () => {
    expect(validateEngineeringDnaProfile(conveyorSystemEngineeringDna, conveyorSystemTemplate, conveyorSystemInspectionZones)).toEqual([]);
    expect(conveyorSystemEngineeringDna.governance.thresholdsPolicy).toBe("approved_source_only");
    expect(conveyorSystemEngineeringDna.governance.autonomousOperationalActionAllowed).toBe(false);
  });

  it("supports registry lookup and governed twin creation", () => {
    expect(getAssetClassTemplate(conveyorSystemTemplate.code)).toBe(conveyorSystemTemplate);
    expect(getEngineeringDnaForAssetClass(conveyorSystemTemplate.code)).toBe(conveyorSystemEngineeringDna);
    const twin = instantiateEngineeringTwin(conveyorSystemEngineeringDna, { assetId: "CV-101", siteId: "SITE-1" });
    expect(twin.assetClassCode).toBe(conveyorSystemTemplate.code);
    expect(twin.customerOverrides.approvalRequired).toBe(true);
  });
});
