import { describe, expect, it } from "vitest";
import { instantiateEngineeringTwin, validateEngineeringDnaProfile } from "./engineering-dna";
import { hydraulicMiningShovelEngineeringDna } from "./hydraulic-mining-shovel-dna";
import { hydraulicMiningShovelInspectionZones } from "./hydraulic-mining-shovel-inspections";
import { hydraulicMiningShovelTemplate } from "./hydraulic-mining-shovel";
import { getAssetClassTemplate, validateAssetClassTemplate } from "./index";
import { validateInspectionZoneContract } from "./inspection-contracts";

describe("hydraulic mining shovel DNA", () => {
  it("validates the canonical template and DNA references", () => {
    expect(validateAssetClassTemplate(hydraulicMiningShovelTemplate)).toEqual([]);
    expect(
      validateEngineeringDnaProfile(
        hydraulicMiningShovelEngineeringDna,
        hydraulicMiningShovelTemplate,
        hydraulicMiningShovelInspectionZones,
      ),
    ).toEqual([]);
  });

  it("keeps inspection contracts governed and linked to canonical components", () => {
    const components = new Set(hydraulicMiningShovelTemplate.components.map((component) => component.code));
    for (const zone of hydraulicMiningShovelInspectionZones) {
      expect(validateInspectionZoneContract(zone, components)).toEqual([]);
      expect(zone.reviewState).toBe("draft");
      expect(zone.safety.siteApprovalRequired).toBe(true);
    }
  });

  it("registers the template and creates a governed customer twin", () => {
    expect(getAssetClassTemplate(hydraulicMiningShovelTemplate.code)).toBe(hydraulicMiningShovelTemplate);
    const twin = instantiateEngineeringTwin(hydraulicMiningShovelEngineeringDna, {
      assetId: "SHOVEL-001",
      siteId: "SITE-001",
      manufacturer: "customer-approved-manufacturer",
      model: "customer-approved-model",
    });
    expect(twin.assetClassCode).toBe(hydraulicMiningShovelTemplate.code);
    expect(twin.baselineStatus).toBe("not_started");
    expect(twin.customerOverrides.approvalRequired).toBe(true);
  });

  it("prohibits autonomous operational action and invented thresholds", () => {
    expect(hydraulicMiningShovelEngineeringDna.governance.autonomousOperationalActionAllowed).toBe(false);
    expect(hydraulicMiningShovelEngineeringDna.governance.thresholdsPolicy).toBe("approved_source_only");
    for (const component of hydraulicMiningShovelTemplate.components) {
      for (const failure of component.failureModes) {
        expect(failure.evidence).toEqual([]);
        expect(failure.reviewState).toBe("draft");
        expect(failure.recommendedActions).toEqual([]);
      }
    }
  });
});
