import { describe, expect, it } from "vitest";
import {
  getEngineeringDnaForAssetClass,
  getEngineeringDnaProfile,
} from "./electric-rope-shovel-dna";
import {
  instantiateEngineeringTwin,
  validateEngineeringDnaProfile,
} from "./engineering-dna";
import { getAssetClassTemplate, validateAssetClassTemplate } from "./index";
import { thickenerEngineeringDna } from "./thickener-dna";
import { thickenerTemplate } from "./thickener";

describe("Thickener Digital Engineering DNA", () => {
  it("keeps the canonical hierarchy and identifiers valid", () => {
    expect(validateAssetClassTemplate(thickenerTemplate)).toEqual([]);
    expect(
      new Set(thickenerTemplate.components.map((component) => component.code))
        .size,
    ).toBe(thickenerTemplate.components.length);
    const failureCodes = thickenerTemplate.components.flatMap((component) =>
      component.failureModes.map((failure) => failure.code),
    );
    expect(new Set(failureCodes).size).toBe(failureCodes.length);
  });

  it("covers thickener-specific systems without prohibited prescribed values", () => {
    const componentCodes = thickenerTemplate.components.map(
      (component) => component.code,
    );
    expect(componentCodes).toEqual(
      expect.arrayContaining([
        "THK-STRUCTURE",
        "THK-RAKE-LIFT",
        "THK-DRIVE",
        "THK-FEEDWELL",
        "THK-OVERFLOW",
        "THK-UNDERFLOW",
        "THK-LUBE-HYD",
        "THK-CTRL-PROTECT",
      ]),
    );
    expect(thickenerEngineeringDna.telemetryConcepts).toEqual(
      expect.arrayContaining(["torque", "bed_level", "rake_position"]),
    );
    expect(JSON.stringify(thickenerTemplate)).not.toMatch(
      /torque_limit|bed_level_setpoint|setpoint|maintenance_interval|hydraulic_pressure|oem_threshold/i,
    );
  });

  it("keeps DNA references canonical and governed", () => {
    expect(
      validateEngineeringDnaProfile(
        thickenerEngineeringDna,
        thickenerTemplate,
        [],
      ),
    ).toEqual([]);
    expect(thickenerEngineeringDna.governance.siteApprovalRequired).toBe(true);
    expect(thickenerEngineeringDna.governance.engineeringApprovalRequired).toBe(
      true,
    );
    expect(
      thickenerEngineeringDna.governance.customerOverridesRequireApproval,
    ).toBe(true);
    expect(
      thickenerEngineeringDna.governance.autonomousOperationalActionAllowed,
    ).toBe(false);
    expect(thickenerEngineeringDna.governance.thresholdsPolicy).toBe(
      "approved_source_only",
    );
  });

  it("supports canonical asset and DNA lookup", () => {
    expect(getAssetClassTemplate(thickenerTemplate.code)).toBe(
      thickenerTemplate,
    );
    expect(getEngineeringDnaProfile(thickenerEngineeringDna.code)).toBe(
      thickenerEngineeringDna,
    );
    expect(getEngineeringDnaForAssetClass(thickenerTemplate.code)).toBe(
      thickenerEngineeringDna,
    );
  });

  it("creates an approval-gated customer twin", () => {
    const twin = instantiateEngineeringTwin(thickenerEngineeringDna, {
      assetId: "THK-001",
      siteId: "MINE-1",
      manufacturer: "SITE-APPROVED-OEM",
      model: "SITE-APPROVED-MODEL",
    });
    expect(twin.assetClassCode).toBe(thickenerTemplate.code);
    expect(twin.customerOverrides.engineeringDnaProfileCode).toBe(
      thickenerEngineeringDna.code,
    );
    expect(twin.customerOverrides.approvalRequired).toBe(true);
    expect(twin.baselineStatus).toBe("not_started");
  });

  it("rejects unknown canonical component references", () => {
    const invalid = {
      ...thickenerEngineeringDna,
      componentCodes: [
        ...thickenerEngineeringDna.componentCodes,
        "THK-UNKNOWN",
      ],
    };
    expect(
      validateEngineeringDnaProfile(invalid, thickenerTemplate, []),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: `componentCodes[${thickenerEngineeringDna.componentCodes.length}]`,
        }),
      ]),
    );
  });
});
