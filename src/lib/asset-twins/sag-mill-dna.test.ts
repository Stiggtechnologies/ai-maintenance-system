import { describe, expect, it } from "vitest";
import { getEngineeringDnaForAssetClass, getEngineeringDnaProfile } from "./electric-rope-shovel-dna";
import { instantiateEngineeringTwin, validateEngineeringDnaProfile } from "./engineering-dna";
import { getAssetClassTemplate, validateAssetClassTemplate } from "./index";
import { sagMillEngineeringDna } from "./sag-mill-dna";
import { sagMillTemplate } from "./sag-mill";

describe("SAG mill Digital Engineering DNA", () => {
  it("keeps the canonical hierarchy and identifiers valid", () => {
    expect(validateAssetClassTemplate(sagMillTemplate)).toEqual([]);
    expect(new Set(sagMillTemplate.components.map((component) => component.code)).size).toBe(
      sagMillTemplate.components.length,
    );
    const failureCodes = sagMillTemplate.components.flatMap((component) =>
      component.failureModes.map((failure) => failure.code),
    );
    expect(new Set(failureCodes).size).toBe(failureCodes.length);
  });

  it("keeps DNA references canonical and governed", () => {
    expect(validateEngineeringDnaProfile(sagMillEngineeringDna, sagMillTemplate, [])).toEqual([]);
    expect(sagMillEngineeringDna.governance.siteApprovalRequired).toBe(true);
    expect(sagMillEngineeringDna.governance.engineeringApprovalRequired).toBe(true);
    expect(sagMillEngineeringDna.governance.customerOverridesRequireApproval).toBe(true);
    expect(sagMillEngineeringDna.governance.autonomousOperationalActionAllowed).toBe(false);
    expect(sagMillEngineeringDna.governance.thresholdsPolicy).toBe("approved_source_only");
  });

  it("supports canonical asset and DNA lookup", () => {
    expect(getAssetClassTemplate(sagMillTemplate.code)).toBe(sagMillTemplate);
    expect(getEngineeringDnaProfile(sagMillEngineeringDna.code)).toBe(sagMillEngineeringDna);
    expect(getEngineeringDnaForAssetClass(sagMillTemplate.code)).toBe(sagMillEngineeringDna);
  });

  it("creates an approval-gated customer twin", () => {
    const twin = instantiateEngineeringTwin(sagMillEngineeringDna, {
      assetId: "SAG-001",
      siteId: "MINE-1",
      manufacturer: "SITE-APPROVED-OEM",
      model: "SITE-APPROVED-MODEL",
    });
    expect(twin.assetClassCode).toBe(sagMillTemplate.code);
    expect(twin.customerOverrides.engineeringDnaProfileCode).toBe(sagMillEngineeringDna.code);
    expect(twin.customerOverrides.approvalRequired).toBe(true);
    expect(twin.baselineStatus).toBe("not_started");
  });

  it("rejects unknown canonical component references", () => {
    const invalid = {
      ...sagMillEngineeringDna,
      componentCodes: [...sagMillEngineeringDna.componentCodes, "SAG-UNKNOWN"],
    };
    expect(validateEngineeringDnaProfile(invalid, sagMillTemplate, [])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: `componentCodes[${sagMillEngineeringDna.componentCodes.length}]` }),
      ]),
    );
  });
});
