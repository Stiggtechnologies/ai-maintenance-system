import { describe, expect, it } from "vitest";
import { instantiateEngineeringTwin, validateEngineeringDnaProfile } from "./engineering-dna";
import { validateInspectionZoneContract } from "./inspection-contracts";
import { getAssetClassTemplate, validateAssetClassTemplate } from "./index";
import { blastholeDrillEngineeringDna } from "./blasthole-drill-dna";
import { blastholeDrillInspectionZones } from "./blasthole-drill-inspections";
import { blastholeDrillTemplate } from "./blasthole-drill";

describe("blasthole drill DNA", () => {
  it("validates the canonical asset hierarchy", () => {
    expect(validateAssetClassTemplate(blastholeDrillTemplate)).toEqual([]);
  });

  it("references only canonical engineering and inspection identities", () => {
    expect(validateEngineeringDnaProfile(blastholeDrillEngineeringDna, blastholeDrillTemplate, blastholeDrillInspectionZones)).toEqual([]);
    const codes = new Set(blastholeDrillTemplate.components.map((component) => component.code));
    expect(blastholeDrillInspectionZones.flatMap((zone) => validateInspectionZoneContract(zone, codes))).toEqual([]);
  });

  it("is available through the canonical registry", () => {
    expect(getAssetClassTemplate("MIN-DRILL-BH")).toBe(blastholeDrillTemplate);
  });

  it("creates an approval-gated customer twin", () => {
    const twin = instantiateEngineeringTwin(blastholeDrillEngineeringDna, { assetId: "drill-01", siteId: "mine-a" });
    expect(twin.assetClassCode).toBe("MIN-DRILL-BH");
    expect(twin.customerOverrides.approvalRequired).toBe(true);
    expect(twin.baselineStatus).toBe("not_started");
  });

  it("keeps operational action and thresholds governed", () => {
    expect(blastholeDrillEngineeringDna.governance.autonomousOperationalActionAllowed).toBe(false);
    expect(blastholeDrillEngineeringDna.governance.thresholdsPolicy).toBe("approved_source_only");
  });
});
